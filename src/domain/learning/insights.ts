import type { Config, Tone } from '../config/config.js';
import { scoreBand } from '../analysis/score.js';

export const OUTCOMES = ['replied', 'interview', 'hired', 'no-response', 'declined'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes in which the client answered. `declined` means the client replied with a rejection. */
export const REPLY_OUTCOMES: readonly Outcome[] = ['replied', 'interview', 'hired', 'declined'];

export interface DraftRecord {
  readonly draftId: string;
  readonly tone: Tone;
  readonly fit: number;
  /** At least one warning or hard flag was present when the draft was written. */
  readonly hasWarning: boolean;
  readonly budget: { readonly min: number; readonly max: number; readonly currency: string; readonly type: 'hourly' | 'fixed' | 'unknown' } | undefined;
  readonly bid: { readonly amount: number; readonly currency: string; readonly unit: 'hour' | 'project' } | undefined;
}

export interface Bucket {
  readonly label: string;
  readonly n: number;
  readonly replies: number;
  /** replies / n, or undefined when n is 0. */
  readonly rate: number | undefined;
  /** n is below the configured minimum sample: the rate is noise. */
  readonly small: boolean;
}

export interface Group {
  readonly name: string;
  readonly buckets: readonly Bucket[];
}

export interface Insights {
  readonly drafts: number;
  readonly withOutcome: number;
  readonly pending: number;
  readonly overall: Bucket;
  readonly groups: readonly Group[];
  readonly warnings: readonly string[];
  /** Proposals for the human; nothing here is applied automatically. */
  readonly suggestions: readonly string[];
}

interface Row {
  readonly draft: DraftRecord;
  readonly outcome: Outcome;
  /** The bid the freelancer actually placed, when recorded; otherwise the suggested bid in the draft. */
  readonly bid: number | undefined;
}

function bucket(label: string, rows: readonly Row[], minSample: number): Bucket {
  const replies = rows.filter((r) => REPLY_OUTCOMES.includes(r.outcome)).length;
  return { label, n: rows.length, replies, rate: rows.length === 0 ? undefined : replies / rows.length, small: rows.length < minSample };
}

export function bidPosition(row: Row): string {
  const { budget, bid } = row.draft;
  const amount = row.bid ?? bid?.amount;
  if (budget === undefined || bid === undefined || amount === undefined || budget.currency !== bid.currency) return 'no comparable bid and budget';
  const compatible = (budget.type === 'hourly' && bid.unit === 'hour') || (budget.type === 'fixed' && bid.unit === 'project');
  if (!compatible) return 'no comparable bid and budget';
  if (amount > budget.max) return 'bid above the budget maximum';
  return amount > (budget.min + budget.max) / 2 ? 'bid in the upper half of the budget' : 'bid in the lower half of the budget';
}

const pct = (rate: number | undefined): string => (rate === undefined ? 'n/a' : `${Math.round(rate * 100)}%`);

export function computeInsights(
  drafts: readonly DraftRecord[],
  outcomes: ReadonlyMap<string, { readonly outcome: Outcome; readonly bid?: number }>,
  config: Config,
): Insights {
  const minSample = config.insights.minSample;
  const rows: Row[] = [];
  for (const draft of drafts) {
    const o = outcomes.get(draft.draftId);
    if (o !== undefined) rows.push({ draft, outcome: o.outcome, bid: o.bid });
  }
  const group = (name: string, labels: readonly string[], of: (row: Row) => string): Group => ({
    name,
    buckets: labels.map((label) => bucket(label, rows.filter((r) => of(r) === label), minSample)),
  });
  const flags = group('reply rate by risk flags', ['no warnings', 'with warnings'], (r) => (r.draft.hasWarning ? 'with warnings' : 'no warnings'));
  const bands = group('reply rate by fit score', ['high fit', 'middle fit', 'low fit'], (r) => `${scoreBand(r.draft.fit, config)} fit`);
  const bids = group(
    'reply rate by bid against budget',
    ['bid in the lower half of the budget', 'bid in the upper half of the budget', 'bid above the budget maximum', 'no comparable bid and budget'],
    bidPosition,
  );
  const tones = group('reply rate by tone', ['plain', 'concise'], (r) => r.draft.tone);
  const overall = bucket('all drafts with an outcome', rows, minSample);

  const warnings: string[] = [];
  if (overall.n === 0) warnings.push('No outcomes recorded yet: record some with `outcome record`.');
  else if (overall.small) warnings.push(`Only ${overall.n} outcomes (minimum ${minSample}): every rate below is noise. Do not change anything because of it.`);
  const smallBuckets = [flags, bands, bids, tones].flatMap((g) => g.buckets).filter((b) => b.n > 0 && b.small);
  if (overall.n >= minSample && smallBuckets.length > 0) warnings.push(`${smallBuckets.length} groups have fewer than ${minSample} outcomes and are marked small.`);
  warnings.push('These are correlations in a personal sample, not causes. The tool never changes scoring or templates by itself.');

  const suggestions: string[] = [];
  const [high, middle, low] = bands.buckets as [Bucket, Bucket, Bucket];
  const solid = (a: Bucket, b: Bucket): boolean => !a.small && !b.small && a.rate !== undefined && b.rate !== undefined;
  if (solid(middle, high) && (middle.rate as number) >= (high.rate as number)) {
    suggestions.push(`Middle-fit drafts got replies as often as high-fit ones (${pct(middle.rate)} of ${middle.n} against ${pct(high.rate)} of ${high.n}): the apply threshold ${config.scoring.applyThreshold} may be too strict. Review with: config propose --set scoring.applyThreshold=${Math.max(config.scoring.caveatThreshold + 1, config.scoring.applyThreshold - 5)}`);
  }
  if (solid(low, middle) && (low.rate as number) >= (middle.rate as number)) {
    suggestions.push(`Low-fit drafts got replies as often as middle-fit ones (${pct(low.rate)} of ${low.n} against ${pct(middle.rate)} of ${middle.n}): the caveat threshold ${config.scoring.caveatThreshold} may be too strict. Review with: config propose --set scoring.caveatThreshold=${Math.max(0, config.scoring.caveatThreshold - 5)}`);
  }
  const [without, withWarn] = flags.buckets as [Bucket, Bucket];
  if (solid(without, withWarn) && (withWarn.rate as number) >= (without.rate as number)) {
    suggestions.push(`Drafts with warnings got replies as often as clean ones (${pct(withWarn.rate)} of ${withWarn.n} against ${pct(without.rate)} of ${without.n}): the warning penalty ${config.scoring.penaltyWarn} may be too high. Review with: config propose --set scoring.penaltyWarn=${Math.max(config.scoring.penaltyInfo, config.scoring.penaltyWarn - 5)}`);
  }
  const [plain, concise] = tones.buckets as [Bucket, Bucket];
  if (solid(plain, concise) && Math.abs((plain.rate as number) - (concise.rate as number)) >= 0.15) {
    const better = (plain.rate as number) > (concise.rate as number) ? plain : concise;
    suggestions.push(`The ${better.label} tone got clearly more replies (${pct(better.rate)} of ${better.n}): consider using --tone ${better.label}, or adjust the templates of the other tone with config propose.`);
  }

  return { drafts: drafts.length, withOutcome: rows.length, pending: drafts.length - rows.length, overall, groups: [flags, bands, bids, tones], warnings, suggestions };
}
