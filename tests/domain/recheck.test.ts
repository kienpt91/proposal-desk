import { describe, expect, it } from 'vitest';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { recheckFacts, referencesToCheck, type EvidenceCheck } from '../../src/domain/facts/recheck.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { fact, selfDeclared } from '../support/builders.js';
import { forSeeds } from '../support/random.js';

const base = (...facts: ReturnType<typeof fact>[]) => {
  const parsed = FactBase.fromFacts(facts);
  if (!parsed.ok) throw new Error(parsed.error.join());
  return parsed.value;
};

describe('recheckFacts', () => {
  const good = fact({ id: 'good', evidence: { reference: 'a.md', digest: sha256('a') } });
  const checks = (entries: Record<string, EvidenceCheck>) => new Map(Object.entries(entries));

  it('lists each checkable, non-stale reference once', () => {
    const b = base(good, fact({ id: 'same', claim: 'Another claim on the same file', evidence: { reference: 'a.md', digest: sha256('a') } }), selfDeclared(), fact({ id: 'old', status: 'stale', evidence: { reference: 'old.md' } }));
    expect(referencesToCheck(b)).toEqual(['a.md']);
  });

  it('keeps verified facts verified when the digest matches, and stamps the check date', () => {
    const result = recheckFacts(base(good), checks({ 'a.md': { ok: true, digest: sha256('a') } }), '2026-11-02');
    expect(result.notices).toEqual([]);
    expect(result.base.get('good')).toMatchObject({ status: 'verified', checkedAt: '2026-11-02' });
  });

  it('makes a fact stale when the digest differs, the file is missing or nothing was checked', () => {
    const b = base(good);
    expect(recheckFacts(b, checks({ 'a.md': { ok: true, digest: sha256('b') } }), '2026-11-02').base.get('good')?.status).toBe('stale');
    expect(recheckFacts(b, checks({ 'a.md': { ok: false, reason: 'no such file' } }), '2026-11-02').notices[0]).toContain('a.md: no such file');
    expect(recheckFacts(b, checks({}), '2026-11-02').notices[0]).toContain('was not checked');
  });

  it('never believes the status field: declared + matching evidence becomes verified, hand-written verified + wrong evidence becomes stale', () => {
    const declared = fact({ id: 'declared', status: 'declared', checkedAt: undefined, evidence: { reference: 'a.md', digest: sha256('a') } });
    const forged = fact({ id: 'forged', claim: 'A forged verified claim', evidence: { reference: 'f.md', digest: 'f'.repeat(64) } });
    const result = recheckFacts(base(declared, forged), checks({ 'a.md': { ok: true, digest: sha256('a') }, 'f.md': { ok: true, digest: sha256('real') } }), '2026-11-02');
    expect(result.base.get('declared')).toMatchObject({ status: 'verified', checkedAt: '2026-11-02' });
    expect(result.base.get('forged')?.status).toBe('stale');
  });

  it('leaves stale facts and facts without checkable evidence alone', () => {
    const stale = fact({ id: 'old', status: 'stale', evidence: { reference: 'old.md', digest: sha256('old') } });
    const result = recheckFacts(base(stale, selfDeclared()), checks({ 'old.md': { ok: true, digest: sha256('old') } }), '2026-11-02');
    expect(result.base.get('old')?.status).toBe('stale');
    expect(result.base.get('self-fact')?.status).toBe('declared');
    expect(result.notices).toEqual([]);
  });

  it('only ever moves a fact to stale or to verified with a date (property)', () => {
    forSeeds(60, (random) => {
      const facts = Array.from({ length: 1 + random.int(6) }, (_, i) => fact({ id: `f${i}`, claim: `Claim number ${i} about services`, status: 'declared', checkedAt: undefined, evidence: { reference: `r${i}.md`, digest: sha256(`r${i}`) } }));
      const results = new Map(facts.map((f, i) => [f.evidence.reference, random.pick([{ ok: true, digest: sha256(`r${i}`) }, { ok: true, digest: 'x'.repeat(64) }, { ok: false, reason: 'no such file' }] as EvidenceCheck[])]));
      const out = recheckFacts(base(...facts), results, '2026-11-02');
      for (const f of out.base.facts) {
        const check = results.get(f.evidence.reference) as EvidenceCheck;
        expect(f.status).toBe(check.ok && check.digest === f.evidence.digest ? 'verified' : 'stale');
      }
      expect(out.notices.length).toBe(out.base.facts.filter((f) => f.status === 'stale').length);
    });
  });
});
