import { describe, expect, it } from 'vitest';
import { computeScore, recommend, scoreBand } from '../../src/domain/analysis/score.js';
import type { CoverageRow } from '../../src/domain/analysis/coverage.js';
import type { RiskFlag } from '../../src/domain/analysis/risk.js';
import { defaultConfig } from '../../src/domain/config/config.js';
import { EXAMPLE_JOB, analyze, exampleFacts } from '../support/analysis.js';

const config = defaultConfig();
const row = (id: string, priority: 'must' | 'nice', status: CoverageRow['status'], weight = priority === 'must' ? 3 : 1): CoverageRow => ({
  requirementId: id, kind: 'tech', label: id, priority, status, factIds: [], weight, credit: status === 'covered' ? 1 : status === 'partial' ? 0.5 : 0, note: '',
});
const flag = (severity: RiskFlag['severity'], ruleId = 'x'): RiskFlag => ({ ruleId, severity, title: `${severity} flag`, detail: '' });

describe('fit score', () => {
  it('prints a formula with the real numbers', () => {
    const rows = [row('a', 'must', 'covered'), row('b', 'must', 'partial'), row('c', 'nice', 'uncovered')];
    const score = computeScore(rows, [flag('warn'), flag('info'), flag('info')], config);
    expect(score.coverage).toBe(64.3);
    expect(score.penalty).toBe(16);
    expect(score.value).toBe(48.3);
    expect(score.formula).toEqual([
      'weights: must-have = 3, nice-to-have = 1; credit: covered = 1, partial = 0.5, uncovered = 0',
      'coverage = 100 x sum(weight x credit) / sum(weight) = 100 x 4.5 / 7 = 64.3',
      'penalty = hard 0 x 40 + warn 1 x 10 + info 2 x 3 = 16',
      'fit = clamp(coverage - penalty, 0, 100) = 48.3',
    ]);
  });

  it('ignores zero-weight gates and clamps to 0-100', () => {
    const gate = { ...row('location', 'must', 'uncovered'), kind: 'location' as const, weight: 0 };
    expect(computeScore([row('a', 'must', 'covered'), gate], [], config).value).toBe(100);
    expect(computeScore([row('a', 'must', 'covered')], [flag('hard'), flag('hard'), flag('hard')], config).value).toBe(0);
    const none = computeScore([], [], config);
    expect(none).toMatchObject({ coverage: 0, value: 0 });
    expect(none.formula[1]).toContain('no scorable requirements');
  });

  it('maps score bands from the configured thresholds', () => {
    expect(scoreBand(70, config)).toBe('high');
    expect(scoreBand(69.9, config)).toBe('middle');
    expect(scoreBand(45, config)).toBe('middle');
    expect(scoreBand(44.9, config)).toBe('low');
  });
});

describe('recommendation', () => {
  const all = (rows: CoverageRow[], flags: RiskFlag[] = []) => recommend(computeScore(rows, flags, config), rows, flags, config);

  it('applies when fit is high, nothing is uncovered and nothing warns', () => {
    const verdict = all([row('a', 'must', 'covered'), row('b', 'must', 'partial')]);
    expect(verdict.recommendation).toBe('apply');
    expect(verdict.reasons[0]).toContain('at or above the apply threshold 70');
  });

  it('applies with caveats for uncovered must-haves or warnings despite a high fit', () => {
    const rows = [row('a', 'must', 'covered'), row('b', 'must', 'covered'), row('c', 'must', 'covered'), row('d', 'must', 'uncovered')];
    const v = all(rows);
    expect(v.recommendation).toBe('apply-with-caveats');
    expect(v.reasons).toEqual(['fit 75 is at or above the apply threshold 70, but:', 'uncovered must-haves: d']);
    const w = all([row('a', 'must', 'covered')], [flag('warn')]);
    expect(w.recommendation).toBe('apply-with-caveats');
    expect(w.reasons).toContain('warning: warn flag');
  });

  it('applies with caveats in the middle band and skips below it', () => {
    const middle = all([row('a', 'must', 'covered'), row('b', 'must', 'uncovered')]);
    expect(middle).toMatchObject({ recommendation: 'apply-with-caveats' });
    expect(middle.reasons[0]).toContain('below the apply threshold 70 and at or above the caveat threshold 45');
    const low = all([row('a', 'must', 'covered'), row('b', 'must', 'uncovered'), row('c', 'must', 'uncovered')]);
    expect(low.recommendation).toBe('skip');
    expect(low.reasons).toEqual(['fit 33.3 is below the caveat threshold 45', 'uncovered must-haves: b, c']);
    expect(all([row('a', 'must', 'uncovered')], [flag('warn')]).reasons).toContain('warning: warn flag');
  });

  it('always skips while a hard warning stands', () => {
    const v = all([row('a', 'must', 'covered')], [flag('hard', 'credentials-request')]);
    expect(v.recommendation).toBe('skip');
    expect(v.reasons[0]).toBe('hard warning: hard flag');
  });

  it('says so when nothing could be matched', () => {
    const v = all([]);
    expect(v.recommendation).toBe('skip');
    expect(v.reasons[0]).toContain('no requirements were recognised');
  });
});

describe('analysis', () => {
  it('scores the shipped example as documented in the README', () => {
    const { analysis } = analyze(EXAMPLE_JOB, exampleFacts());
    expect(analysis.score).toMatchObject({ coverage: 83.9, penalty: 3, value: 80.9 });
    expect(analysis.verdict.recommendation).toBe('apply-with-caveats');
    expect(analysis.rate.suggestion).toEqual({ amount: 53, currency: 'USD', unit: 'hour' });
    expect(analysis.flags.map((f) => f.ruleId)).toEqual(['location-excluded']);
  });

  it('is deterministic and independent of the object identity of its inputs', () => {
    const a = analyze(EXAMPLE_JOB, exampleFacts());
    const b = analyze(EXAMPLE_JOB, exampleFacts());
    expect(JSON.stringify(a.analysis)).toBe(JSON.stringify(b.analysis));
    expect('sentences' in a.analysis.spec).toBe(false);
  });
});
