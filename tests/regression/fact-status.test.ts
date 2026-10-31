import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessFact } from '../../src/domain/facts/claim-policy.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { draftIdOf, session, type Session } from '../support/cli.js';
import { fact, selfDeclared } from '../support/builders.js';

// Security review finding "fact-verified-not-enforced": the status field of facts.json is never trusted on its own;
// checkable evidence is re-hashed every time facts are used.

function addForgedFact(s: Session, extra: Record<string, unknown>): void {
  const doc = JSON.parse(readFileSync(s.facts, 'utf8')) as { facts: unknown[] };
  doc.facts.push({
    id: 'forged',
    claim: 'Cut Redis latency by forty percent for a payments platform',
    category: 'metric',
    evidence: { kind: 'document', reference: 'evidence/nope.md', digest: 'a'.repeat(64), date: '2026-05-01' },
    status: 'verified',
    tags: ['redis'],
    attrs: {},
    checkedAt: '2026-10-30',
    ...extra,
  });
  writeFileSync(s.facts, JSON.stringify(doc));
}

describe('the status field of facts.json is not trusted', () => {
  it('a hand-written "verified" fact whose evidence file does not exist is not used', async () => {
    const s = session();
    addForgedFact(s, {});
    const job = join(s.dir, 'redis.txt');
    writeFileSync(job, 'Requirements:\n- Redis\n');
    const analysis = await s.run(['analyze', job, '--facts', s.facts, '--json']);
    const rows = (JSON.parse(analysis.stdout) as { coverage: { requirementId: string; status: string }[] }).coverage;
    expect(rows.find((r) => r.requirementId === 'tech:redis')?.status).toBe('uncovered');
    expect(analysis.stderr).toContain('forged: evidence/nope.md: no such file');
    const draft = await s.run(['draft', job, '--facts', s.facts]);
    expect(draft.code).toBe(1);
    expect(draft.stderr).toContain('nothing honest to say');
  });

  it('a hand-written "verified" fact with the wrong digest is treated as stale, and check rejects a proposal that repeats it', async () => {
    const s = session();
    writeFileSync(join(s.dir, 'examples', 'evidence', 'redis.md'), 'real content');
    addForgedFact(s, { evidence: { kind: 'document', reference: 'evidence/redis.md', digest: 'b'.repeat(64) } });
    const listed = await s.run(['facts', 'list', '--facts', s.facts, '--json']);
    expect((JSON.parse(listed.stdout) as { id: string; status: string; usable: boolean }[]).find((f) => f.id === 'forged')).toMatchObject({ status: 'stale', usable: false });
    const proposal = 'Cut Redis latency by forty percent for a payments platform.';
    const check = await s.run(['check', '-', '--job', s.job, '--facts', s.facts], { stdin: proposal });
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('excluded-fact');
    expect(check.stderr).toContain('no longer matches');
  });

  it('changing an evidence file after approval voids the approval, without running facts verify', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    expect((await s.run(['approve', id, '--facts', s.facts])).code).toBe(0);
    writeFileSync(join(s.dir, 'examples', 'evidence', 'postgres-explain.txt'), 'someone rewrote the proof');
    const result = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('facts behind the draft changed after approval');
    expect(result.stderr).toContain('postgres-tuning: evidence/postgres-explain.txt no longer matches');
  });

  it('re-checks evidence for approve as well, and restoring the file restores the fact', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    const file = join(s.dir, 'examples', 'evidence', 'docker-ci.md');
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, 'changed');
    const draftAgain = await s.run(['draft', s.job, '--facts', s.facts, '--json']);
    expect(draftAgain.stderr).toContain('docker-ci: evidence/docker-ci.md no longer matches');
    writeFileSync(file, original);
    expect((await s.run(['approve', id, '--facts', s.facts])).code).toBe(0);
    expect((await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts])).code).toBe(0);
    expect(sha256(readFileSync(join(s.dir, 'final.md'), 'utf8')).length).toBe(64);
  });
});

describe('claims about numbers and outcomes need verified evidence', () => {
  it('a declared fact with a number or outcome is not usable, whatever its evidence kind', () => {
    const declared = (claim: string, kind: 'repo-url' | 'self-declared' = 'repo-url') =>
      assessFact(fact({ claim, status: 'declared', checkedAt: undefined, tags: ['typescript'], evidence: kind === 'repo-url' ? { kind: 'repo-url', reference: 'https://github.com/example/x', digest: undefined } : { kind: 'self-declared', reference: 'own', digest: undefined } }));
    expect(declared('Served 10k users with a TypeScript service')).toMatchObject({ usable: false, trust: 'evidenced' });
    expect(declared('Served 10k users with a TypeScript service').exclusions.join()).toContain('verified evidence');
    expect(declared('Reduced build times substantially').usable).toBe(false);
    expect(declared('Built a TypeScript command line tool').usable).toBe(true);
    expect(assessFact(fact({ claim: 'Served 10k users with a TypeScript service' })).usable).toBe(true);
    expect(assessFact(selfDeclared({ claim: 'Served 10k users with a TypeScript service' })).usable).toBe(false);
  });
});
