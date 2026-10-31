import { describe, expect, it } from 'vitest';
import { addFact, listFacts, staleFacts, verifyFacts, type AddFactInput } from '../../src/application/usecases/facts.js';
import { AppError } from '../../src/application/errors.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { harness } from '../support/fakes.js';
import { fact, selfDeclared } from '../support/builders.js';

const input = (over: Partial<AddFactInput> = {}): AddFactInput => ({
  factsPath: undefined,
  id: 'ts-services',
  claim: 'Built and maintained TypeScript services on Node.js',
  category: 'skill',
  evidenceKind: 'file-hash',
  reference: 'evidence/ts.md',
  tags: ['typescript'],
  attrs: {},
  ...over,
});

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('addFact', () => {
  it('hashes checkable evidence at once and stores the fact as verified', async () => {
    const h = harness();
    h.evidenceFake.files.set('evidence/ts.md', 'proof');
    const result = await addFact(h, input());
    expect(result.fact).toMatchObject({ status: 'verified', checkedAt: '2026-10-31', evidence: { kind: 'file-hash', digest: sha256('proof') } });
    expect(result.assessment.usable).toBe(true);
    expect(h.factStore.base?.facts).toHaveLength(1);
    expect(h.logFake.entries.map((e) => e.type)).toEqual(['fact.added']);
    expect(h.logFake.entries[0]?.payload).toEqual({ factId: 'ts-services', evidenceKind: 'file-hash' });
  });

  it('stores anything else as declared, never verified', async () => {
    const h = harness();
    const result = await addFact(h, input({ evidenceKind: 'repo-url', reference: 'https://github.com/example/ts' }));
    expect(result.fact.status).toBe('declared');
    expect(result.fact.checkedAt).toBeUndefined();
    const self = await addFact(h, input({ id: 'own', claim: 'Worked with Docker daily', evidenceKind: 'self-declared', reference: 'own statement', tags: ['docker'] }));
    expect(self.assessment.trust).toBe('self-declared');
  });

  it('refuses evidence it cannot hash', async () => {
    const h = harness();
    const error = await rejection(addFact(h, input()));
    expect(error).toMatchObject({ kind: 'invalid', message: 'cannot verify the evidence file: no such file' });
    expect(h.factStore.base).toBeUndefined();
    expect(h.logFake.entries).toEqual([]);
  });

  it('rejects invalid and duplicate facts with every reason', async () => {
    const h = harness();
    h.evidenceFake.files.set('evidence/ts.md', 'proof');
    const invalid = await rejection(addFact(h, input({ id: 'Bad Id', claim: 'short' })));
    expect(invalid.details.join('\n')).toContain('fact.id');
    expect(invalid.details.join('\n')).toContain('fact.claim');
    await addFact(h, input());
    const duplicate = await rejection(addFact(h, input()));
    expect(duplicate.details.join()).toContain('duplicate id ts-services');
    expect(h.factStore.base?.facts).toHaveLength(1);
  });
});

describe('listFacts', () => {
  it('lists assessments, and says so when there is no facts file', async () => {
    const h = harness({ facts: FactBase.empty().add(fact()).value.add(selfDeclared({ claim: 'Ten years of TypeScript', id: 'boast' })).value, pin: true });
    const listed = await listFacts(h, { factsPath: undefined });
    expect(listed.assessments.map((a) => [a.fact.id, a.usable])).toEqual([['ts-services', true], ['boast', false]]);
    expect(listed.notices).toEqual([]);
    const error = await rejection(listFacts(harness(), { factsPath: undefined }));
    expect(error).toMatchObject({ kind: 'missing' });
    expect(error.message).toContain('/memory/facts.json');
  });
});

describe('listFacts re-checks evidence', () => {
  it('shows a fact whose evidence changed as stale, with a notice, without writing anything', async () => {
    const h = harness({ facts: FactBase.empty().add(fact({ evidence: { digest: sha256('proof') } })).value.add(fact({ id: 'other', claim: 'Built Go services', tags: ['go'], evidence: { reference: 'evidence/other.md', digest: sha256('other') } })).value });
    h.evidenceFake.files.set('evidence/ts.md', 'tampered');
    h.evidenceFake.files.set('evidence/other.md', 'other');
    const listed = await listFacts(h, { factsPath: undefined });
    expect(listed.assessments.map((a) => [a.fact.id, a.fact.status, a.usable])).toEqual([['ts-services', 'stale', false], ['other', 'verified', true]]);
    expect(listed.notices).toEqual(['ts-services: evidence/ts.md no longer matches the recorded digest (treated as stale; run `facts verify` after fixing the evidence)']);
    expect(h.factStore.base?.get('ts-services')?.status).toBe('verified');
    expect(h.logFake.entries).toEqual([]);
  });

  it('promotes a declared fact whose checkable evidence matches, and reports a missing file', async () => {
    const h = harness({ facts: FactBase.empty().add(fact({ status: 'declared', checkedAt: undefined, evidence: { digest: sha256('proof') } })).value.add(fact({ id: 'gone', evidence: { reference: 'evidence/gone.md' } })).value });
    h.evidenceFake.files.set('evidence/ts.md', 'proof');
    const listed = await listFacts(h, { factsPath: undefined });
    expect(listed.assessments.map((a) => [a.fact.id, a.fact.status])).toEqual([['ts-services', 'verified'], ['gone', 'stale']]);
    expect(listed.notices).toEqual(['gone: evidence/gone.md: no such file (treated as stale; run `facts verify` after fixing the evidence)']);
  });
});

describe('verifyFacts', () => {
  function withEvidence(content: string) {
    const h = harness({ facts: FactBase.empty().add(fact({ evidence: { digest: sha256('proof') } })).value.add(selfDeclared()).value });
    h.evidenceFake.files.set('evidence/ts.md', content);
    return h;
  }

  it('re-verifies facts whose file still matches', async () => {
    const h = withEvidence('proof');
    const results = await verifyFacts(h, { factsPath: undefined });
    expect(results).toEqual([
      { factId: 'ts-services', outcome: 'verified', detail: 'evidence/ts.md matches the recorded digest' },
      { factId: 'self-fact', outcome: 'skipped', detail: 'evidence kind self-declared cannot be re-checked offline' },
    ]);
    expect(h.factStore.base?.get('ts-services')?.checkedAt).toBe('2026-10-31');
    expect(h.logFake.entries.map((e) => e.type)).toEqual(['fact.verified']);
  });

  it('marks facts stale when the file changed or vanished, and records why', async () => {
    const changed = withEvidence('tampered');
    expect((await verifyFacts(changed, { factsPath: undefined }))[0]).toMatchObject({ outcome: 'stale', detail: 'evidence/ts.md no longer matches the recorded digest' });
    expect(changed.factStore.base?.get('ts-services')?.status).toBe('stale');
    const missing = harness({ facts: FactBase.empty().add(fact()).value });
    expect((await verifyFacts(missing, { factsPath: undefined }))[0]).toMatchObject({ outcome: 'stale', detail: 'evidence/ts.md: no such file' });
    expect(missing.logFake.entries[0]).toMatchObject({ type: 'fact.marked-stale', payload: { factId: 'ts-services' } });
  });

  it('brings a stale fact back when its evidence matches again, and promotes a declared one', async () => {
    const h = harness({ facts: FactBase.empty().add(fact({ status: 'stale', evidence: { digest: sha256('proof') } })).value });
    h.evidenceFake.files.set('evidence/ts.md', 'proof');
    await verifyFacts(h, { factsPath: undefined });
    expect(h.factStore.base?.get('ts-services')?.status).toBe('verified');
    const declared = harness({ facts: FactBase.empty().add(fact({ status: 'declared', checkedAt: undefined, evidence: { digest: sha256('proof') } })).value });
    declared.evidenceFake.files.set('evidence/ts.md', 'proof');
    await verifyFacts(declared, { factsPath: undefined });
    expect(declared.factStore.base?.get('ts-services')?.status).toBe('verified');
  });

  it('can be limited to named facts and rejects unknown names', async () => {
    const h = withEvidence('proof');
    expect(await verifyFacts(h, { factsPath: undefined, ids: ['ts-services'] })).toHaveLength(1);
    expect(await rejection(verifyFacts(h, { factsPath: undefined, ids: ['nope'] }))).toMatchObject({ kind: 'missing' });
  });
});

describe('staleFacts', () => {
  const base = () =>
    FactBase.empty()
      .add(fact({ id: 'fresh', checkedAt: '2026-10-20' })).value
      .add(fact({ id: 'old', checkedAt: '2026-01-01' })).value
      .add(fact({ id: 'gone', status: 'stale' })).value
      .add(selfDeclared({ id: 'undated', evidence: { date: undefined } })).value;

  it('lists stale and overdue facts without changing anything', async () => {
    const h = harness({ facts: base() });
    const result = await staleFacts(h, { factsPath: undefined, mark: false });
    expect(result.days).toBe(180);
    expect(result.entries.map((e) => [e.factId, e.reason, e.marked])).toEqual([
      ['gone', 'already stale', false],
      ['old', 'last checked or dated 303 days ago (limit 180)', false],
      ['undated', 'no check date or evidence date', false],
    ]);
    expect(h.logFake.entries).toEqual([]);
    expect(h.factStore.base?.get('old')?.status).toBe('verified');
  });

  it('marks the overdue ones stale on request and honours --days', async () => {
    const h = harness({ facts: base() });
    const result = await staleFacts(h, { factsPath: undefined, days: 5, mark: true });
    expect(result.days).toBe(5);
    expect(result.entries.filter((e) => e.marked).map((e) => e.factId)).toEqual(['fresh', 'old', 'undated']);
    expect(h.factStore.base?.facts.filter((f) => f.status === 'stale').map((f) => f.id)).toEqual(['fresh', 'old', 'gone', 'undated']);
    expect(h.logFake.entries.map((e) => e.type)).toEqual(['fact.marked-stale', 'fact.marked-stale', 'fact.marked-stale']);
  });
});
