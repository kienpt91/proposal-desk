import { describe, expect, it } from 'vitest';
import { assessFact, extractNumbers, factTechIds, isMeasurable, trustOf } from '../../src/domain/facts/claim-policy.js';
import { factAgeDays, isCheckable, parseFact, tagTechIds } from '../../src/domain/facts/fact.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { DomainError } from '../../src/domain/shared/result.js';
import { availabilityFact, fact, locationFact, rateFact, selfDeclared, timezoneFact } from '../support/builders.js';
import { forSeeds } from '../support/random.js';

const valid = {
  id: 'ts-services',
  claim: 'Built and maintained TypeScript services on Node.js',
  category: 'skill',
  evidence: { kind: 'file-hash', reference: 'evidence/ts.md', digest: 'b'.repeat(64), date: '2026-05-01' },
  status: 'verified',
  checkedAt: '2026-10-01',
  tags: ['typescript', 'node.js'],
};

function issuesOf(overrides: Record<string, unknown>): string[] {
  const result = parseFact({ ...valid, ...overrides });
  return result.ok ? [] : result.error;
}

describe('fact schema', () => {
  it('accepts a valid fact and trims the claim', () => {
    const result = parseFact({ ...valid, claim: '  Built and maintained TypeScript services  ' });
    expect(result.ok && result.value.claim).toBe('Built and maintained TypeScript services');
    expect(isCheckable('file-hash')).toBe(true);
    expect(isCheckable('repo-url')).toBe(false);
  });

  it('rejects unknown fields at every level', () => {
    expect(issuesOf({ extra: 1 })).toContain('fact.extra: unknown field');
    expect(issuesOf({ evidence: { ...valid.evidence, extra: 1 } })).toContain('fact.evidence.extra: unknown field');
    expect(issuesOf({ attrs: { years: 5, bogus: 1 } }).join()).toContain('fact.attrs.bogus: not allowed for category skill');
  });

  it('rejects malformed ids, claims, categories and tags', () => {
    expect(issuesOf({ id: 'Bad Id' }).join()).toContain('fact.id');
    expect(issuesOf({ claim: 'short' }).join()).toContain('fact.claim');
    expect(issuesOf({ claim: 'x'.repeat(201) }).join()).toContain('fact.claim');
    expect(issuesOf({ claim: 'Contains a\ncontrol line break here' }).join()).toContain('single line');
    expect(issuesOf({ claim: 'Reach me at jane@example.com for details' }).join()).toContain('contact details');
    expect(issuesOf({ claim: 'Open source work at https://example.com/repo' }).join()).toContain('evidence reference');
    expect(issuesOf({ category: 'hobby' }).join()).toContain('fact.category');
    expect(issuesOf({ tags: ['ok', 'ok'] }).join()).toContain('duplicate tag');
    expect(issuesOf({ tags: ['Bad Tag!'] }).join()).toContain('fact.tags[0]');
    expect(issuesOf({ tags: new Array(13).fill('a') }).join()).toContain('at most 12');
  });

  it('requires checkable evidence for verified facts and a digest for checkable kinds', () => {
    expect(issuesOf({ evidence: { kind: 'self-declared', reference: 'me' } }).join()).toContain('"verified" needs mechanically checkable evidence');
    expect(issuesOf({ evidence: { kind: 'file-hash', reference: 'x.md' } }).join()).toContain('digest: required');
    expect(issuesOf({ evidence: { kind: 'repo-url', reference: 'https://example.com/a', digest: 'b'.repeat(64) }, status: 'declared' }).join()).toContain('only allowed for');
    expect(issuesOf({ evidence: { kind: 'repo-url', reference: 'ftp://example.com/a' }, status: 'declared' }).join()).toContain('https URL');
    expect(issuesOf({ checkedAt: undefined }).join()).toContain('checkedAt: required');
    expect(issuesOf({ evidence: { ...valid.evidence, digest: 'XYZ' } }).join()).toContain('64 lowercase hex');
    expect(issuesOf({ evidence: { ...valid.evidence, date: '2026-13-40' } }).join()).toContain('YYYY-MM-DD');
    expect(issuesOf({ evidence: { ...valid.evidence, note: 'x'.repeat(201) } }).join()).toContain('evidence.note');
    expect(issuesOf({ evidence: 'file' }).join()).toContain('fact.evidence: must be an object');
    expect(issuesOf({ status: 'maybe' }).join()).toContain('fact.status');
  });

  it('validates attributes per category', () => {
    const rate = { category: 'rate', status: 'declared', evidence: { kind: 'self-declared', reference: 'me' }, checkedAt: undefined };
    expect(issuesOf({ ...rate, attrs: {} }).join()).toContain('attrs.floor: required');
    expect(issuesOf({ ...rate, attrs: { floor: -1, currency: 'usd', unit: 'day' } }).join()).toContain('attrs.currency');
    expect(issuesOf({ ...rate, attrs: { floor: 40, currency: 'USD', unit: 'hour' } })).toEqual([]);
    const constraint = { category: 'constraint', status: 'declared', evidence: { kind: 'self-declared', reference: 'me' }, checkedAt: undefined };
    expect(issuesOf({ ...constraint, attrs: { kind: 'timezone', value: 'seven' } }).join()).toContain('timezone must look like');
    expect(issuesOf({ ...constraint, attrs: { kind: 'location', value: '' } }).join()).toContain('attrs.value');
    expect(issuesOf({ attrs: { years: 99 } }).join()).toContain('attrs.years');
    expect(issuesOf({ attrs: 'x' }).join()).toContain('fact.attrs: must be an object');
  });

  it('rejects non-objects', () => {
    expect(parseFact(null)).toEqual({ ok: false, error: ['fact: must be an object'] });
    expect(parseFact([], 'facts[0]')).toEqual({ ok: false, error: ['facts[0]: must be an object'] });
  });

  it('reads technologies from tags and claims', () => {
    const f = fact({ claim: 'Shipped React dashboards with GraphQL', tags: ['node.js', 'unknown-thing'] });
    expect(tagTechIds(f)).toEqual(['nodejs']);
    expect(factTechIds(f).sort()).toEqual(['graphql', 'nodejs', 'react']);
  });

  it('computes fact age from the last check, else the evidence date', () => {
    expect(factAgeDays(fact({ checkedAt: '2026-10-01' }), '2026-10-31')).toBe(30);
    expect(factAgeDays(selfDeclared(), '2026-10-31')).toBe(183);
    expect(factAgeDays(selfDeclared({ evidence: { date: undefined } }), '2026-10-31')).toBeUndefined();
  });
});

describe('claim policy', () => {
  it('extracts normalised numbers and ignores digits inside technology names', () => {
    expect(extractNumbers('Five years, 1,200 users, 99.5% uptime, 10k downloads')).toEqual(['5', '1200', '99.5', '10000']);
    expect(extractNumbers('Vue 3, Java 17, Python3 and ES6')).toEqual([]);
    expect(extractNumbers('about a dozen clients')).toEqual(['12']);
    expect(extractNumbers('since 2019, 3.5 years')).toEqual(['2019', '3.5']);
  });

  it('computes trust from status and evidence kind', () => {
    expect(trustOf(fact())).toBe('verified');
    expect(trustOf(fact({ status: 'declared', checkedAt: undefined }))).toBe('evidenced');
    expect(trustOf(selfDeclared())).toBe('self-declared');
  });

  it('treats numbers, years and outcome words as measurable, except for the freelancer\'s own terms', () => {
    expect(isMeasurable(fact({ claim: 'Served 10k users with TypeScript' }))).toBe(true);
    expect(isMeasurable(fact({ claim: 'Cut build time substantially', tags: [] }))).toBe(true);
    expect(isMeasurable(fact({ attrs: { years: 5 } }))).toBe(true);
    expect(isMeasurable(fact({ claim: 'Worked with TypeScript', tags: [] }))).toBe(false);
    expect(isMeasurable(rateFact())).toBe(false);
    expect(isMeasurable(availabilityFact(20))).toBe(false);
  });

  it('excludes stale facts, self-declared measurable claims and unverified superlatives', () => {
    expect(assessFact(fact()).usable).toBe(true);
    expect(assessFact(fact({ status: 'stale' })).exclusions[0]).toContain('stale');
    const numeric = assessFact(selfDeclared({ claim: 'Ten years of TypeScript work', tags: ['typescript'] }));
    expect(numeric.usable).toBe(false);
    expect(numeric.exclusions.join()).toContain('numbers and outcomes');
    expect(assessFact(selfDeclared({ claim: 'Worked with TypeScript daily', tags: ['typescript'] })).usable).toBe(true);
    expect(assessFact(selfDeclared({ claim: 'The best TypeScript engineer around', tags: [] })).exclusions.join()).toContain('superlatives');
    expect(assessFact(fact({ claim: 'Recognised as an expert TypeScript maintainer', tags: [] })).usable).toBe(true);
    expect(assessFact(rateFact(40)).usable).toBe(true);
  });
});

describe('FactBase', () => {
  const doc = (facts: unknown[]) => ({ schema: 1, facts });

  it('round-trips through its document form', () => {
    const base = FactBase.empty().add(fact()).value.add(rateFact()).value;
    const parsed = FactBase.parse(JSON.parse(JSON.stringify(base.toDocument())));
    expect(parsed.ok && parsed.value.facts).toEqual(base.facts);
  });

  it('rejects malformed documents with every issue listed', () => {
    expect(FactBase.parse([])).toEqual({ ok: false, error: ['facts.json: must be an object'] });
    const bad = FactBase.parse({ schema: 2, extra: true, facts: 'no' });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toEqual(['facts.json.extra: unknown field', 'facts.json.schema: must be 1', 'facts.json.facts: must be a list']);
    const nested = FactBase.parse(doc([{ ...valid, id: 'A' }, { ...valid, claim: 'x' }]));
    expect(!nested.ok && nested.error.length).toBe(2);
    expect(FactBase.parse(doc(new Array(501).fill(valid))).ok).toBe(false);
  });

  it('enforces unique ids and a single live rate, availability, location and timezone', () => {
    expect(FactBase.fromFacts([fact(), fact()]).ok).toBe(false);
    expect(FactBase.fromFacts([rateFact(40), { ...rateFact(50), id: 'rate-2' }]).ok).toBe(false);
    expect(FactBase.fromFacts([rateFact(40), { ...rateFact(50), id: 'rate-2', status: 'stale' }]).ok).toBe(true);
    expect(FactBase.fromFacts([locationFact(), { ...locationFact('Canada'), id: 'loc-2' }]).ok).toBe(false);
    expect(FactBase.fromFacts([timezoneFact(), { ...timezoneFact('UTC+1'), id: 'tz-2' }]).ok).toBe(false);
    expect(FactBase.fromFacts([availabilityFact(), { ...availabilityFact(10), id: 'av-2' }]).ok).toBe(false);
    expect(FactBase.fromFacts([locationFact(), timezoneFact(), availabilityFact(), rateFact()]).ok).toBe(true);
  });

  it('changes by returning new bases and events', () => {
    const empty = FactBase.empty();
    const added = empty.add(fact({ status: 'declared', checkedAt: undefined }));
    expect(empty.facts).toHaveLength(0);
    expect(added.events).toEqual([{ type: 'fact.added', factId: 'ts-services', evidenceKind: 'file-hash' }]);
    const verified = added.value.markVerified('ts-services', '2026-10-31');
    expect(verified.value.get('ts-services')).toMatchObject({ status: 'verified', checkedAt: '2026-10-31' });
    const stale = verified.value.markStale('ts-services', 'file changed');
    expect(stale.value.get('ts-services')?.status).toBe('stale');
    expect(stale.events).toEqual([{ type: 'fact.marked-stale', factId: 'ts-services', reason: 'file changed' }]);
    expect(stale.value.markStale('ts-services', 'again').events).toEqual([]);
    expect(() => stale.value.markVerified('nope', '2026-10-31')).toThrow(DomainError);
    expect(() => added.value.add(fact())).toThrow(/duplicate id/);
  });

  it('lists overdue facts and usable facts', () => {
    const base = FactBase.empty()
      .add(fact({ id: 'fresh', checkedAt: '2026-10-20' })).value
      .add(fact({ id: 'old', checkedAt: '2026-01-01' })).value
      .add(fact({ id: 'gone', status: 'stale' })).value
      .add(selfDeclared({ id: 'undated', evidence: { date: undefined } })).value;
    expect(base.overdue('2026-10-31', 180).map((f) => f.id)).toEqual(['old', 'undated']);
    expect(base.usable().map((a) => a.fact.id)).toEqual(['fresh', 'old', 'undated']);
    expect(base.assessments()).toHaveLength(4);
  });

  it('keeps the snapshot digest stable across re-checks but not across edits (property)', () => {
    forSeeds(30, (random) => {
      const claim = `Built service number ${random.int(1000)} with TypeScript`;
      const a = FactBase.empty().add(fact({ claim, checkedAt: '2026-09-01' })).value;
      const recheck = a.markVerified('ts-services', '2026-10-30').value;
      expect(recheck.snapshotDigest(['ts-services'])).toBe(a.snapshotDigest(['ts-services']));
      const edited = FactBase.empty().add(fact({ claim: `${claim} extra` })).value;
      expect(edited.snapshotDigest(['ts-services'])).not.toBe(a.snapshotDigest(['ts-services']));
      expect(a.markStale('ts-services', 'x').value.snapshotDigest(['ts-services'])).not.toBe(a.snapshotDigest(['ts-services']));
    });
    const base = FactBase.empty();
    expect(base.snapshotDigest(['missing'])).toHaveLength(64);
    expect(base.snapshotDigest(['b', 'a', 'a'])).toBe(base.snapshotDigest(['a', 'b']));
  });
});
