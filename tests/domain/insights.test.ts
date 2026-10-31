import { describe, expect, it } from 'vitest';
import { defaultConfig, setConfigValue, configDigest, type Config } from '../../src/domain/config/config.js';
import { checkProposalApplies, proposalDigest, proposeConfig } from '../../src/domain/config/proposal.js';
import { OUTCOMES, computeInsights, type DraftRecord, type Outcome } from '../../src/domain/learning/insights.js';
import { forSeeds } from '../support/random.js';

const config = defaultConfig();
const draft = (id: string, over: Partial<DraftRecord> = {}): DraftRecord => ({
  draftId: id, tone: 'plain', fit: 80, hasWarning: false,
  budget: { min: 40, max: 60, currency: 'USD', type: 'hourly' }, bid: { amount: 50, currency: 'USD', unit: 'hour' }, ...over,
});

function run(records: DraftRecord[], outcomes: Record<string, Outcome | { outcome: Outcome; bid?: number }>, cfg: Config = config) {
  const map = new Map(Object.entries(outcomes).map(([id, o]) => [id, typeof o === 'string' ? { outcome: o } : o]));
  return computeInsights(records, map, cfg);
}

describe('insights', () => {
  it('warns that nothing can be said without outcomes', () => {
    const insights = run([draft('a')], {});
    expect(insights).toMatchObject({ drafts: 1, withOutcome: 0, pending: 1 });
    expect(insights.warnings[0]).toContain('No outcomes recorded yet');
    expect(insights.suggestions).toEqual([]);
  });

  it('counts replies, interviews, hires and declines as replies, not silence', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const insights = run(ids.map((id) => draft(id)), { a: 'replied', b: 'interview', c: 'hired', d: 'declined', e: 'no-response' });
    expect(insights.overall).toMatchObject({ n: 5, replies: 4, rate: 0.8, small: true });
    expect(insights.warnings[0]).toContain('Only 5 outcomes (minimum 20)');
    expect(OUTCOMES).toHaveLength(5);
  });

  it('groups by warnings, fit band, bid against budget and tone, with sample sizes', () => {
    const records = [
      draft('a', { hasWarning: true, fit: 50 }),
      draft('b', { fit: 30, bid: { amount: 70, currency: 'USD', unit: 'hour' } }),
      draft('c', { tone: 'concise', bid: { amount: 55, currency: 'USD', unit: 'hour' } }),
      draft('d', { budget: undefined }),
      draft('e', { bid: { amount: 3000, currency: 'USD', unit: 'project' } }),
    ];
    const insights = run(records, { a: 'replied', b: 'no-response', c: 'hired', d: 'no-response', e: { outcome: 'replied', bid: 55 } });
    const byName = Object.fromEntries(insights.groups.map((g) => [g.name, Object.fromEntries(g.buckets.map((b) => [b.label, `${b.replies}/${b.n}`]))]));
    expect(byName['reply rate by risk flags']).toEqual({ 'no warnings': '2/4', 'with warnings': '1/1' });
    expect(byName['reply rate by fit score']).toEqual({ 'high fit': '2/3', 'middle fit': '1/1', 'low fit': '0/1' });
    expect(byName['reply rate by bid against budget']).toEqual({
      'bid in the lower half of the budget': '1/1',
      'bid in the upper half of the budget': '1/1',
      'bid above the budget maximum': '0/1',
      'no comparable bid and budget': '1/2',
    });
    expect(byName['reply rate by tone']).toEqual({ plain: '2/4', concise: '1/1' });
  });

  it('uses the recorded bid over the suggested bid when comparing with the budget', () => {
    const insights = run([draft('a')], { a: { outcome: 'replied', bid: 70 } });
    const bids = insights.groups.find((g) => g.name.includes('bid'))?.buckets ?? [];
    expect(bids.find((b) => b.label === 'bid above the budget maximum')?.n).toBe(1);
  });

  it('only suggests changes when the compared groups are large enough, and always as proposals', () => {
    const many = (prefix: string, count: number, over: Partial<DraftRecord>) => Array.from({ length: count }, (_, i) => draft(`${prefix}${i}`, over));
    const records = [...many('h', 25, { fit: 90 }), ...many('m', 25, { fit: 60 }), ...many('l', 25, { fit: 20 })];
    const outcomes: Record<string, Outcome> = {};
    for (const r of records) outcomes[r.draftId] = r.draftId.startsWith('h') ? (Number(r.draftId.slice(1)) < 5 ? 'replied' : 'no-response') : r.draftId.startsWith('m') ? (Number(r.draftId.slice(1)) < 10 ? 'replied' : 'no-response') : (Number(r.draftId.slice(1)) < 10 ? 'replied' : 'no-response');
    const insights = run(records, outcomes);
    expect(insights.warnings.some((w) => w.includes('correlations'))).toBe(true);
    expect(insights.suggestions.join('\n')).toContain('apply threshold 70 may be too strict');
    expect(insights.suggestions.join('\n')).toContain('config propose --set scoring.applyThreshold=65');
    expect(insights.suggestions.join('\n')).toContain('caveat threshold 45 may be too strict');
    const small = run(records.slice(0, 8), outcomes);
    expect(small.suggestions).toEqual([]);
  });

  it('suggests about warnings and tone from solid samples', () => {
    const records = [
      ...Array.from({ length: 22 }, (_, i) => draft(`w${i}`, { hasWarning: true, tone: 'concise' })),
      ...Array.from({ length: 22 }, (_, i) => draft(`c${i}`, { tone: 'plain' })),
    ];
    const outcomes: Record<string, Outcome> = {};
    for (const r of records) outcomes[r.draftId] = r.draftId.startsWith('w') ? 'replied' : Number(r.draftId.slice(1)) < 5 ? 'replied' : 'no-response';
    const text = run(records, outcomes).suggestions.join('\n');
    expect(text).toContain('warning penalty 10 may be too high');
    expect(text).toContain('concise tone got clearly more replies');
    expect(text).toContain('scoring.penaltyWarn=5');
    const plainWins = Object.fromEntries(records.map((r) => [r.draftId, r.draftId.startsWith('c') ? 'replied' : Number(r.draftId.slice(1)) < 5 ? 'replied' : 'no-response'])) as Record<string, Outcome>;
    expect(run(records, plainWins).suggestions.join('\n')).toContain('plain tone got clearly more replies');
  });

  it('never produces rates outside 0-1 and always accounts for every outcome (property)', () => {
    forSeeds(40, (random) => {
      const records = Array.from({ length: 1 + random.int(40) }, (_, i) => draft(`x${i}`, { fit: random.int(101), hasWarning: random.next() > 0.5, tone: random.pick(['plain', 'concise'] as const) }));
      const outcomes = Object.fromEntries(records.filter(() => random.next() > 0.3).map((r) => [r.draftId, random.pick(OUTCOMES)])) as Record<string, Outcome>;
      const insights = run(records, outcomes);
      expect(insights.withOutcome + insights.pending).toBe(records.length);
      for (const g of insights.groups) {
        expect(g.buckets.reduce((sum, b) => sum + b.n, 0)).toBe(insights.withOutcome);
        for (const b of g.buckets) if (b.rate !== undefined) expect(b.rate).toBeGreaterThanOrEqual(0), expect(b.rate).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('configuration proposals', () => {
  it('describes the change, bumps the version and binds to the current configuration', () => {
    const proposal = proposeConfig(config, [{ path: 'scoring.applyThreshold', value: '65' }], 'try a looser threshold');
    if (!proposal.ok) throw new Error(proposal.error.join());
    expect(proposal.value.changes).toEqual([{ path: 'scoring.applyThreshold', before: 70, after: 65 }]);
    expect(proposal.value.proposed.version).toBe(2);
    expect(proposal.value.fromVersion).toBe(1);
    expect(proposal.value.note).toBe('try a looser threshold');
    expect(proposal.value.digest).toBe(proposalDigest(configDigest(config), proposal.value.proposed));
    expect(checkProposalApplies(config, proposal.value)).toEqual({ ok: true, value: proposal.value.proposed });
  });

  it('rejects empty, invalid and no-op proposals', () => {
    expect(proposeConfig(config, [])).toEqual({ ok: false, error: ['nothing to propose: pass at least one --set path=value'] });
    expect(proposeConfig(config, [{ path: 'scoring.applyThreshold', value: '500' }])).toMatchObject({ ok: false });
    expect(proposeConfig(config, [{ path: 'scoring.applyThreshold', value: '70' }])).toEqual({ ok: false, error: ['the proposal changes nothing'] });
  });

  it('refuses a proposal that no longer fits the configuration or was edited', () => {
    const proposal = proposeConfig(config, [{ path: 'scoring.applyThreshold', value: '65' }]);
    if (!proposal.ok) throw new Error('unexpected');
    const moved = setConfigValue(config, 'scoring.mustWeight', '4');
    if (!moved.ok) throw new Error('unexpected');
    expect(checkProposalApplies(moved.value, proposal.value)).toMatchObject({ ok: false });
    const edited = { ...proposal.value, proposed: { ...proposal.value.proposed, scoring: { ...proposal.value.proposed.scoring, applyThreshold: 60 } } };
    expect(checkProposalApplies(config, edited)).toEqual({ ok: false, error: ['the proposal digest does not match its content'] });
    const wrongVersion = { ...proposal.value, proposed: { ...proposal.value.proposed, version: 5 } };
    expect(checkProposalApplies(config, { ...wrongVersion, digest: proposalDigest(wrongVersion.fromDigest, wrongVersion.proposed) })).toEqual({ ok: false, error: ['the proposal does not follow the current configuration version'] });
  });

  it('applies several settings in order', () => {
    const proposal = proposeConfig(config, [
      { path: 'scoring.applyThreshold', value: '75' },
      { path: 'drafting.templates.plain.closing', value: 'Thanks for reading.' },
    ]);
    expect(proposal.ok && proposal.value.changes.map((c) => c.path)).toEqual(['drafting.templates.plain.closing', 'scoring.applyThreshold']);
  });
});
