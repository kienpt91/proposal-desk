import type { Config } from '../config/config.js';
import type { CoverageRow } from './coverage.js';
import type { RiskFlag, Severity } from './risk.js';

export interface FitScore {
  /** 0-100: weighted share of requirements covered. */
  readonly coverage: number;
  /** Points subtracted for risk flags. */
  readonly penalty: number;
  /** The fit score: clamp(coverage - penalty, 0, 100). */
  readonly value: number;
  /** The formula with the actual numbers, one step per line. Nothing is hidden. */
  readonly formula: readonly string[];
}

export type Recommendation = 'apply' | 'apply-with-caveats' | 'skip';

export interface Verdict {
  readonly recommendation: Recommendation;
  readonly reasons: readonly string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function computeScore(rows: readonly CoverageRow[], flags: readonly RiskFlag[], config: Config): FitScore {
  const scored = rows.filter((r) => r.weight > 0);
  const totalWeight = scored.reduce((sum, r) => sum + r.weight, 0);
  const earned = scored.reduce((sum, r) => sum + r.weight * r.credit, 0);
  const coverage = totalWeight === 0 ? 0 : round1((100 * earned) / totalWeight);

  const count = (severity: Severity): number => flags.filter((f) => f.severity === severity).length;
  const { penaltyHard, penaltyWarn, penaltyInfo } = config.scoring;
  const penalty = round1(count('hard') * penaltyHard + count('warn') * penaltyWarn + count('info') * penaltyInfo);
  const value = Math.max(0, Math.min(100, round1(coverage - penalty)));

  const { mustWeight, niceWeight, coveredCredit, partialCredit } = config.scoring;
  const formula = [
    `weights: must-have = ${mustWeight}, nice-to-have = ${niceWeight}; credit: covered = ${coveredCredit}, partial = ${partialCredit}, uncovered = 0`,
    totalWeight === 0
      ? 'coverage = 0 (no scorable requirements were recognised)'
      : `coverage = 100 x sum(weight x credit) / sum(weight) = 100 x ${fmt(round1(earned))} / ${fmt(totalWeight)} = ${fmt(coverage)}`,
    `penalty = hard ${count('hard')} x ${penaltyHard} + warn ${count('warn')} x ${penaltyWarn} + info ${count('info')} x ${penaltyInfo} = ${fmt(penalty)}`,
    `fit = clamp(coverage - penalty, 0, 100) = ${fmt(value)}`,
  ];
  return { coverage, penalty, value, formula };
}

export function recommend(score: FitScore, rows: readonly CoverageRow[], flags: readonly RiskFlag[], config: Config): Verdict {
  const reasons: string[] = [];
  const { applyThreshold, caveatThreshold } = config.scoring;
  const hard = flags.filter((f) => f.severity === 'hard');
  const warn = flags.filter((f) => f.severity === 'warn');
  const uncoveredMust = rows.filter((r) => r.weight > 0 && r.priority === 'must' && r.status === 'uncovered');
  const scorable = rows.some((r) => r.weight > 0);

  if (hard.length > 0) {
    for (const f of hard) reasons.push(`hard warning: ${f.title}`);
    reasons.push(`fit ${fmt(score.value)} does not matter while a hard warning stands`);
    return { recommendation: 'skip', reasons };
  }
  if (!scorable) reasons.push('no requirements were recognised, so there is nothing to match against');
  if (score.value >= applyThreshold && uncoveredMust.length === 0 && warn.length === 0 && scorable) {
    reasons.push(`fit ${fmt(score.value)} is at or above the apply threshold ${applyThreshold}`, 'every must-have is covered or partially covered and there are no warnings');
    return { recommendation: 'apply', reasons };
  }
  if (score.value >= caveatThreshold) {
    if (score.value >= applyThreshold) reasons.push(`fit ${fmt(score.value)} is at or above the apply threshold ${applyThreshold}, but:`);
    else reasons.push(`fit ${fmt(score.value)} is below the apply threshold ${applyThreshold} and at or above the caveat threshold ${caveatThreshold}`);
    if (uncoveredMust.length > 0) reasons.push(`uncovered must-haves: ${uncoveredMust.map((r) => r.label).join(', ')}`);
    for (const f of warn) reasons.push(`warning: ${f.title}`);
    return { recommendation: 'apply-with-caveats', reasons };
  }
  reasons.push(`fit ${fmt(score.value)} is below the caveat threshold ${caveatThreshold}`);
  if (uncoveredMust.length > 0) reasons.push(`uncovered must-haves: ${uncoveredMust.map((r) => r.label).join(', ')}`);
  for (const f of warn) reasons.push(`warning: ${f.title}`);
  return { recommendation: 'skip', reasons };
}

/** Score band used by the insights report. */
export function scoreBand(value: number, config: Config): 'low' | 'middle' | 'high' {
  if (value >= config.scoring.applyThreshold) return 'high';
  return value >= config.scoring.caveatThreshold ? 'middle' : 'low';
}
