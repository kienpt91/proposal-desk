import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../support/analysis.js';
import { cpSync } from 'node:fs';

// The compiled program, run as a separate process: what a user (or a script) actually gets.

let dist = '';
let work = '';

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'proposal-desk-dist-'));
  execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.build.json'), '--outDir', dist], { cwd: ROOT });
  work = mkdtempSync(join(tmpdir(), 'proposal-desk-bin-'));
  cpSync(join(ROOT, 'examples'), join(work, 'examples'), { recursive: true });
}, 120_000);

function run(args: string[], input?: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [join(dist, 'composition', 'main.js'), ...args], {
    input,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: work, PROPOSAL_DESK_STATE: join(work, 'state'), ...env },
    cwd: work,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('compiled binary', () => {
  it('has a shebang and prints its version and help', () => {
    expect(readFileSync(join(dist, 'composition', 'main.js'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(run(['--version'])).toMatchObject({ code: 0, stdout: 'proposal-desk 0.1.0\n' });
    expect(run(['--help']).stdout).toContain('Commands:');
    expect(run([]).code).toBe(2);
  });

  it('analyses a job piped on standard input and keeps its state private', () => {
    const job = readFileSync(join(work, 'examples', 'job-post.txt'), 'utf8');
    const result = run(['analyze', '-', '--facts', 'examples/facts.json'], job);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Recommendation: APPLY WITH CAVEATS');
    expect(statSync(join(work, 'state')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(work, 'state')).sort()).toEqual(['log.jsonl', 'objects']);
    expect(run(['verify-log']).stdout).toContain('Hash chain: OK, 1 entries');
  });

  it('cannot be made to approve anything from a script or a pipe', () => {
    const draft = run(['draft', 'examples/job-post.txt', '--facts', 'examples/facts.json']);
    expect(draft.code).toBe(0);
    const id = /Draft (d-[0-9a-f]{12}):/.exec(draft.stderr)?.[1] as string;
    const approve = run(['approve', id, '--facts', 'examples/facts.json'], 'approve 12345678\nyes\ny\n');
    expect(approve.code).toBe(1);
    expect(approve.stderr).toContain('needs a person at an interactive terminal');
    const exported = run(['export', id, '--out', 'final.md', '--facts', 'examples/facts.json']);
    expect(exported.code).toBe(1);
    expect(exported.stderr).toContain('has not been approved');
  });

  it('uses status 2 for usage errors and 3 for an unsafe state directory', () => {
    expect(run(['analyze']).code).toBe(2);
    const bad = run(['verify-log'], undefined, { PROPOSAL_DESK_STATE: join(work, 'examples', 'facts.json') });
    expect(bad.code).toBe(3);
    expect(bad.stderr).toContain('proposal-desk:');
  });
});
