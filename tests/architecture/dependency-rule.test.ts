import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// The dependency rule, enforced mechanically:
//   domain <- application <- infrastructure <- composition
// An arrow points from the outer layer (which may import) to the inner one (which may not).

const SRC = resolve(import.meta.dirname, '../../src');
const LAYERS = ['domain', 'application', 'infrastructure', 'composition'] as const;
type Layer = (typeof LAYERS)[number];

const MAY_IMPORT: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  composition: ['domain', 'application', 'infrastructure', 'composition'],
};

const NODE_BUILTINS_ALLOWED: Record<Layer, boolean> = { domain: false, application: false, infrastructure: true, composition: true };

// Anything that could reach the network. The tool never talks to a network.
const NETWORK_MODULES = ['net', 'http', 'https', 'http2', 'dns', 'tls', 'dgram', 'cluster', 'inspector', 'worker_threads'];
const NETWORK_TOKENS = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /\bnavigator\.sendBeacon\b/];

// Impurities the domain and application layers must not use: clock, randomness, IO, ambient process state.
const IMPURE_TOKENS: readonly [string, RegExp][] = [
  ['Date.now', /\bDate\.now\s*\(/],
  ['new Date()', /\bnew Date\s*\(\s*\)/],
  ['Date()', /(?<![.\w])(?<!new\s)Date\s*\(\s*\)/],
  ['Math.random', /\bMath\.random\b/],
  ['performance.now', /\bperformance\.now\b/],
  ['process', /\bprocess\./],
  ['require', /(?<![.\w])require\s*\(/],
  ['globalThis', /\bglobalThis\b/],
  ['crypto', /\bcrypto\./],
  ['timers', /\b(?:setTimeout|setInterval|setImmediate)\s*\(/],
  ['console', /\bconsole\./],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

function specifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s+['"]([^'"]+)['"]/g];
  for (const pattern of patterns) for (const m of source.matchAll(pattern)) out.push(m[1] as string);
  return out;
}

function layerOf(file: string): Layer {
  const top = relative(SRC, file).split(sep)[0] as string;
  if (!(LAYERS as readonly string[]).includes(top)) throw new Error(`${file} is not inside a known layer`);
  return top as Layer;
}

interface Entry {
  readonly file: string;
  readonly layer: Layer;
  readonly source: string;
}

function importViolations(entries: readonly Entry[]): string[] {
  const violations: string[] = [];
  for (const { file, layer, source } of entries) {
    for (const spec of specifiers(source)) {
      const where = `${relative(SRC, file)} imports ${spec}`;
      if (spec.startsWith('node:')) {
        const name = spec.slice(5).split('/')[0] as string;
        if (!NODE_BUILTINS_ALLOWED[layer]) violations.push(`${where} (layer ${layer} may not use node builtins)`);
        if (NETWORK_MODULES.includes(name)) violations.push(`${where} (network module)`);
      } else if (spec.startsWith('.')) {
        const target = layerOf(resolve(dirname(file), spec).replace(/\.js$/, '.ts'));
        if (!MAY_IMPORT[layer].includes(target)) violations.push(`${where} (${layer} may not depend on ${target})`);
      } else {
        violations.push(`${where} (bare package imports are not allowed: zero runtime dependencies)`);
      }
    }
  }
  return violations;
}

function impurityViolations(entries: readonly Entry[]): string[] {
  const violations: string[] = [];
  for (const { file, layer, source } of entries) {
    if (layer !== 'domain' && layer !== 'application') continue;
    for (const [name, pattern] of IMPURE_TOKENS) if (pattern.test(source)) violations.push(`${relative(SRC, file)} uses ${name}`);
  }
  return violations;
}

function networkViolations(entries: readonly Entry[]): string[] {
  const violations: string[] = [];
  for (const { file, source } of entries) {
    for (const pattern of NETWORK_TOKENS) if (pattern.test(source)) violations.push(`${relative(SRC, file)} matches ${pattern}`);
  }
  return violations;
}

const files: Entry[] = walk(SRC).map((file) => ({ file, layer: layerOf(file), source: stripComments(readFileSync(file, 'utf8')) }));

const entry = (path: string, source: string): Entry => {
  const file = join(SRC, path);
  return { file, layer: layerOf(file), source: stripComments(source) };
};

describe('architecture', () => {
  it('finds source files in every layer that exists', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const dir of readdirSync(SRC)) expect(LAYERS as readonly string[]).toContain(dir);
  });

  it('only imports inward: domain <- application <- infrastructure <- composition', () => {
    expect(importViolations(files)).toEqual([]);
  });

  it('keeps clock, randomness, IO and ambient state out of the domain and application layers', () => {
    expect(impurityViolations(files)).toEqual([]);
  });

  it('has no network access anywhere', () => {
    expect(networkViolations(files)).toEqual([]);
  });

  it('declares zero runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC, '../package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});

describe('architecture checks detect what they claim to detect', () => {
  it('flags outward and bare imports', () => {
    const bad = [
      entry('domain/a.ts', "import { x } from '../application/use.js';"),
      entry('domain/b.ts', "import { readFileSync } from 'node:fs';"),
      entry('application/c.ts', "export { y } from '../infrastructure/fs.js';"),
      entry('infrastructure/d.ts', "import('../composition/main.js');"),
      entry('infrastructure/e.ts', "import 'left-pad';"),
      entry('infrastructure/f.ts', "import net from 'node:net';"),
    ];
    expect(importViolations(bad)).toEqual([
      'domain/a.ts imports ../application/use.js (domain may not depend on application)',
      'domain/b.ts imports node:fs (layer domain may not use node builtins)',
      'application/c.ts imports ../infrastructure/fs.js (application may not depend on infrastructure)',
      'infrastructure/d.ts imports ../composition/main.js (infrastructure may not depend on composition)',
      'infrastructure/e.ts imports left-pad (bare package imports are not allowed: zero runtime dependencies)',
      'infrastructure/f.ts imports node:net (network module)',
    ]);
  });

  it('accepts inward imports and ignores commented-out code', () => {
    const good = [
      entry('application/a.ts', "import { x } from '../domain/x.js';\n// import { bad } from '../infrastructure/y.js';"),
      entry('composition/b.ts', "import { y } from '../infrastructure/y.js';\nimport { z } from './z.js';"),
    ];
    expect(importViolations(good)).toEqual([]);
  });

  it('flags clock, randomness, process and network use', () => {
    const bad = [
      entry('domain/a.ts', 'const t = Date.now(); const r = Math.random(); const d = new Date();'),
      entry('application/b.ts', 'const e = process.env; console.log(1); setTimeout(f, 1);'),
    ];
    expect(impurityViolations(bad)).toEqual([
      'domain/a.ts uses Date.now',
      'domain/a.ts uses new Date()',
      'domain/a.ts uses Math.random',
      'application/b.ts uses process',
      'application/b.ts uses timers',
      'application/b.ts uses console',
    ]);
    expect(impurityViolations([entry('domain/c.ts', 'const d = new Date(2020, 1, 1); this.require(x);')])).toEqual([]);
    expect(networkViolations([entry('infrastructure/g.ts', "await fetch('https://example.com');")])).toHaveLength(1);
  });
});
