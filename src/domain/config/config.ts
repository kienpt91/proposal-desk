import { digestOf, type Json } from '../shared/canonical-json.js';
import { fail, ok, type Result } from '../shared/result.js';
import { hasUnsafeCharacters } from '../shared/text-safety.js';
import { extractNumbers } from '../facts/claim-policy.js';
import { hasPersonalContact } from '../policy/contact.js';
import { BOILERPLATE_PHRASES, findPhrases, findSuperlatives } from '../policy/phrases.js';

export const TONES = ['plain', 'concise'] as const;
export type Tone = (typeof TONES)[number];

export const TEMPLATE_SLOTS = ['opening', 'evidence', 'evidencePartial', 'gap', 'question', 'availability', 'rate', 'closing'] as const;
export type TemplateSlot = (typeof TEMPLATE_SLOTS)[number];

export type Templates = { readonly [slot in TemplateSlot]: string };

/** Placeholders a slot may use, and the ones it must use. */
const PLACEHOLDERS: Readonly<Record<TemplateSlot, { readonly allowed: readonly string[]; readonly required: readonly string[] }>> = {
  opening: { allowed: ['focus'], required: ['focus'] },
  evidence: { allowed: ['label', 'claim'], required: ['claim'] },
  evidencePartial: { allowed: ['label', 'claim'], required: ['claim'] },
  gap: { allowed: ['labels'], required: ['labels'] },
  question: { allowed: ['label'], required: ['label'] },
  availability: { allowed: ['claim'], required: ['claim'] },
  rate: { allowed: ['amount', 'currency', 'unit'], required: ['amount', 'currency', 'unit'] },
  closing: { allowed: [], required: [] },
};

export interface Config {
  readonly schema: 1;
  /** Starts at 1 for the built-in defaults; every applied proposal adds one. */
  readonly version: number;
  readonly scoring: {
    readonly mustWeight: number;
    readonly niceWeight: number;
    readonly coveredCredit: number;
    readonly partialCredit: number;
    readonly penaltyHard: number;
    readonly penaltyWarn: number;
    readonly penaltyInfo: number;
    readonly applyThreshold: number;
    readonly caveatThreshold: number;
  };
  readonly risk: {
    readonly manyProposals: number;
    readonly newAccountDays: number;
    readonly maxTimezoneGapHours: number;
    readonly hoursPerMustHave: number;
    readonly vaguePostMinWords: number;
    readonly maxMustTechFamilies: number;
    readonly unrealisticScopeDays: number;
    readonly unrealisticScopeMusts: number;
  };
  readonly drafting: {
    readonly wordCap: number;
    readonly maxEvidence: number;
    readonly maxGaps: number;
    readonly templates: { readonly [tone in Tone]: Templates };
  };
  readonly facts: { readonly staleAfterDays: number };
  readonly insights: { readonly minSample: number };
}

export const DEFAULT_TEMPLATES: { readonly [tone in Tone]: Templates } = {
  plain: {
    opening: 'Hello, your post asks for {focus}.',
    evidence: 'On {label}: {claim}.',
    evidencePartial: 'Closest to {label}: {claim}.',
    gap: 'I have no verified experience with {labels}, so I will not claim it.',
    question: 'Which part of the {label} work would you like handled first?',
    availability: '{claim}.',
    rate: 'For this work my rate would be {amount} {currency} per {unit}.',
    closing: 'Thank you for reading.',
  },
  concise: {
    opening: 'Re: {focus}.',
    evidence: '{label}: {claim}.',
    evidencePartial: 'Nearest to {label}: {claim}.',
    gap: 'No verified experience with {labels}.',
    question: 'Which {label} part comes first?',
    availability: '{claim}.',
    rate: 'Rate: {amount} {currency} per {unit}.',
    closing: 'Thanks.',
  },
};

export function defaultConfig(): Config {
  return {
    schema: 1,
    version: 1,
    scoring: {
      mustWeight: 3,
      niceWeight: 1,
      coveredCredit: 1,
      partialCredit: 0.5,
      penaltyHard: 40,
      penaltyWarn: 10,
      penaltyInfo: 3,
      applyThreshold: 70,
      caveatThreshold: 45,
    },
    risk: {
      manyProposals: 15,
      newAccountDays: 30,
      maxTimezoneGapHours: 8,
      hoursPerMustHave: 5,
      vaguePostMinWords: 40,
      maxMustTechFamilies: 4,
      unrealisticScopeDays: 7,
      unrealisticScopeMusts: 5,
    },
    drafting: { wordCap: 200, maxEvidence: 3, maxGaps: 3, templates: DEFAULT_TEMPLATES },
    facts: { staleAfterDays: 180 },
    insights: { minSample: 20 },
  };
}

// ------------------------------------------------------------------ validation

type Leaf = { readonly kind: 'number'; readonly min: number; readonly max: number; readonly integer: boolean } | { readonly kind: 'template'; readonly slot: TemplateSlot };
type Spec = { readonly [key: string]: Spec | Leaf };

const isLeaf = (rule: Spec | Leaf): rule is Leaf => typeof (rule as { kind?: unknown }).kind === 'string';
const num = (min: number, max: number, integer = false): Leaf => ({ kind: 'number', min, max, integer });
const tpl = (slot: TemplateSlot): Leaf => ({ kind: 'template', slot });
const templatesSpec = (): Spec => Object.fromEntries(TEMPLATE_SLOTS.map((slot) => [slot, tpl(slot)]));

const SPEC: Spec = {
  scoring: {
    mustWeight: num(1, 10),
    niceWeight: num(0, 10),
    coveredCredit: num(0, 1),
    partialCredit: num(0, 1),
    penaltyHard: num(0, 100),
    penaltyWarn: num(0, 100),
    penaltyInfo: num(0, 100),
    applyThreshold: num(1, 100),
    caveatThreshold: num(0, 99),
  },
  risk: {
    manyProposals: num(1, 1000, true),
    newAccountDays: num(1, 3650, true),
    maxTimezoneGapHours: num(1, 24),
    hoursPerMustHave: num(1, 200),
    vaguePostMinWords: num(1, 500, true),
    maxMustTechFamilies: num(1, 20, true),
    unrealisticScopeDays: num(1, 365, true),
    unrealisticScopeMusts: num(1, 50, true),
  },
  drafting: {
    wordCap: num(60, 400, true),
    maxEvidence: num(1, 5, true),
    maxGaps: num(0, 5, true),
    templates: { plain: templatesSpec(), concise: templatesSpec() },
  },
  facts: { staleAfterDays: num(1, 3650, true) },
  insights: { minSample: num(5, 1000, true) },
};

/** Why a template is unacceptable, or undefined. Templates may not smuggle in claims, numbers or contact details. */
export function templateProblem(slot: TemplateSlot, text: string): string | undefined {
  if (text.trim() === '' || text.length > 160) return 'must be 1-160 characters';
  if (hasUnsafeCharacters(text)) return 'must not contain control characters';
  const rule = PLACEHOLDERS[slot];
  const used = [...text.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1] as string);
  for (const name of used) if (!rule.allowed.includes(name)) return `unknown placeholder {${name}}`;
  for (const name of rule.required) if (!used.includes(name)) return `must use {${name}}`;
  const stripped = text.replace(/\{[A-Za-z]+\}/g, 'x');
  if (/[{}]/.test(stripped)) return 'has an unmatched brace';
  if (extractNumbers(stripped).length > 0) return 'must not contain numbers; templates carry no claims';
  if (hasPersonalContact(stripped) || /https?:\/\//i.test(stripped)) return 'must not contain contact details or links';
  if (findPhrases(stripped, BOILERPLATE_PHRASES).length > 0 || findSuperlatives(stripped).length > 0) return 'must not contain boilerplate or superlatives';
  const questions = (stripped.match(/\?/g) ?? []).length;
  if (slot === 'question' ? questions !== 1 : questions !== 0) return slot === 'question' ? 'must contain exactly one question mark' : 'must not contain a question mark';
  return undefined;
}

function validate(raw: unknown, spec: Spec, path: string, issues: string[]): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push(`${path}: must be an object`);
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!Object.hasOwn(spec, key)) issues.push(`${path}.${key}: unknown field`);
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(spec)) {
    const at = `${path}.${key}`;
    const value = record[key];
    if (value === undefined) {
      issues.push(`${at}: required`);
    } else if (isLeaf(rule)) {
      if (rule.kind === 'number') {
        const valid = typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max && (!rule.integer || Number.isInteger(value));
        if (valid) out[key] = value;
        else issues.push(`${at}: must be ${rule.integer ? 'an integer' : 'a number'} between ${rule.min} and ${rule.max}`);
      } else if (typeof value !== 'string') {
        issues.push(`${at}: must be text`);
      } else {
        const problem = templateProblem(rule.slot, value);
        if (problem === undefined) out[key] = value;
        else issues.push(`${at}: ${problem}`);
      }
    } else {
      out[key] = validate(value, rule, at, issues);
    }
  }
  return out;
}

/** Strict parser for a configuration document. Every problem is reported. */
export function parseConfig(raw: unknown): Result<Config> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(['config: must be an object']);
  const record = raw as Record<string, unknown>;
  const issues: string[] = [];
  for (const key of Object.keys(record)) if (key !== 'schema' && key !== 'version' && !Object.hasOwn(SPEC, key)) issues.push(`config.${key}: unknown field`);
  if (record.schema !== 1) issues.push('config.schema: must be 1');
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1 || record.version > 1_000_000) {
    issues.push('config.version: must be a positive integer');
  }
  const body = validate(Object.fromEntries(Object.keys(SPEC).map((k) => [k, record[k]])), SPEC, 'config', issues) as Record<string, unknown> | undefined;
  if (issues.length === 0 && body !== undefined) {
    const scoring = body.scoring as Config['scoring'];
    if (scoring.caveatThreshold >= scoring.applyThreshold) issues.push('config.scoring.caveatThreshold: must be below applyThreshold');
    if (scoring.partialCredit > scoring.coveredCredit) issues.push('config.scoring.partialCredit: must not exceed coveredCredit');
    if (!(scoring.penaltyInfo <= scoring.penaltyWarn && scoring.penaltyWarn <= scoring.penaltyHard)) {
      issues.push('config.scoring: penalties must satisfy info <= warn <= hard');
    }
  }
  if (issues.length > 0) return fail(issues);
  return ok({ schema: 1, version: record.version as number, ...(body as object) } as Config);
}

// ------------------------------------------------------------------ digest, diff, edits

export function configToJson(config: Config): Json {
  return config as unknown as Json;
}

export function configDigest(config: Config): string {
  return digestOf(configToJson(config));
}

export interface ConfigChange {
  readonly path: string;
  readonly before: string | number;
  readonly after: string | number;
}

function flatten(value: unknown, path: string, out: Map<string, string | number>): void {
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) flatten(child, path === '' ? key : `${path}.${key}`, out);
  } else if (typeof value === 'string' || typeof value === 'number') {
    out.set(path, value);
  }
}

/** Leaf-by-leaf differences, sorted by path. The version field is reported like any other. */
export function diffConfig(before: Config, after: Config): ConfigChange[] {
  const a = new Map<string, string | number>();
  const b = new Map<string, string | number>();
  flatten(before, '', a);
  flatten(after, '', b);
  const changes: ConfigChange[] = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(path);
    const y = b.get(path);
    if (x !== undefined && y !== undefined && x !== y) changes.push({ path, before: x, after: y });
  }
  return changes;
}

/** Sets one leaf (`scoring.applyThreshold`, `drafting.templates.plain.closing`) and validates the result. */
export function setConfigValue(config: Config, path: string, value: string): Result<Config> {
  const parts = path.split('.');
  const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  let target: Record<string, unknown> = clone;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (typeof next !== 'object' || next === null) return fail([`${path}: unknown setting`]);
    target = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] as string;
  const current = target[last];
  if (path === 'version' || path === 'schema' || (typeof current !== 'number' && typeof current !== 'string')) return fail([`${path}: unknown or read-only setting`]);
  if (typeof current === 'number') {
    if (!/^-?\d+(?:\.\d+)?$/.test(value.trim())) return fail([`${path}: expected a number`]);
    target[last] = Number(value);
  } else {
    target[last] = value;
  }
  return parseConfig(clone);
}
