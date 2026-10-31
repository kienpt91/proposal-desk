import type { Config } from '../config/config.js';
import type { FactBase } from '../facts/fact-base.js';
import type { JobPosting } from '../job/posting.js';
import type { JobSpec } from '../job/spec.js';

export interface RateFloor {
  readonly factId: string;
  readonly amount: number;
  readonly currency: string;
  readonly unit: 'hour' | 'project';
}

export interface Bid {
  readonly amount: number;
  readonly currency: string;
  readonly unit: 'hour' | 'project';
}

export type RateVerdict = 'no-floor' | 'no-range' | 'currency-mismatch' | 'unsupported' | 'below-floor' | 'ok';

export interface RateGuidance {
  readonly verdict: RateVerdict;
  readonly floor: RateFloor | undefined;
  /** The suggested bid; never below the floor. Undefined when no honest suggestion can be made. */
  readonly suggestion: Bid | undefined;
  /** The client's maximum is below the floor (hourly), or the budget cannot cover the estimated scope (fixed). */
  readonly belowFloor: boolean;
  readonly lowBudget: boolean;
  readonly hoursCovered: number | undefined;
  /** Each line is a step of the reasoning, in order. */
  readonly reasoning: readonly string[];
}

const round = (n: number): number => Math.round(n);

export function rateFloorOf(base: FactBase): RateFloor | undefined {
  const fact = base.usable().find((a) => a.fact.category === 'rate' && a.fact.status !== 'stale')?.fact;
  if (fact === undefined) return undefined;
  return { factId: fact.id, amount: fact.attrs.floor as number, currency: fact.attrs.currency as string, unit: fact.attrs.unit as 'hour' | 'project' };
}

function mustTechCount(spec: JobSpec): number {
  return spec.requirements.filter((r) => r.kind === 'tech' && r.priority === 'must').length;
}

/**
 * Suggests a bid from the freelancer's declared floor and the ranges in the post and the listing metadata.
 * The suggestion is max(floor, min(midpoint of the reference range, client's maximum)); it is never below the floor.
 */
export function guideRate(job: JobPosting, spec: JobSpec, base: FactBase, config: Config): RateGuidance {
  const floor = rateFloorOf(base);
  const reasoning: string[] = [];
  const none = (verdict: RateVerdict, line: string): RateGuidance => ({ verdict, floor, suggestion: undefined, belowFloor: false, lowBudget: false, hoursCovered: undefined, reasoning: [...reasoning, line] });

  if (floor === undefined) return none('no-floor', 'No usable rate fact: add one with category "rate" to get a bid suggestion.');
  reasoning.push(`Your floor (${floor.factId}): ${floor.amount} ${floor.currency} per ${floor.unit}.`);

  const budget = spec.budget;
  const meta = job.metadata;
  const bidRange = meta.bidMin !== undefined && meta.bidMax !== undefined ? { min: meta.bidMin, max: meta.bidMax, currency: meta.currency ?? budget?.currency ?? floor.currency } : undefined;
  if (budget !== undefined) reasoning.push(`Client budget in the post: ${budget.min === budget.max ? budget.min : `${budget.min}-${budget.max}`} ${budget.currency} (${budget.type}).`);
  if (bidRange !== undefined) reasoning.push(`Bid range from the listing: ${bidRange.min}-${bidRange.max} ${bidRange.currency}.`);

  if (budget === undefined && bidRange === undefined) {
    return { verdict: 'no-range', floor, suggestion: { amount: floor.amount, currency: floor.currency, unit: floor.unit }, belowFloor: false, lowBudget: false, hoursCovered: undefined, reasoning: [...reasoning, 'No budget or bid range found: quote at or above your floor.'] };
  }
  const effective = budget ?? (bidRange === undefined ? undefined : { type: floor.unit === 'hour' ? ('hourly' as const) : ('fixed' as const), min: bidRange.min, max: bidRange.max, currency: bidRange.currency });
  const currencies = [budget?.currency, bidRange?.currency].filter((c): c is string => c !== undefined);
  if (currencies.some((c) => c !== floor.currency)) {
    return { ...none('currency-mismatch', `The post uses ${currencies.find((c) => c !== floor.currency)} but your floor is in ${floor.currency}: no conversion is attempted, so no bid is suggested.`) };
  }

  if (budget === undefined && bidRange !== undefined) reasoning.push(`The post has no budget, so the bid range is read in your floor's unit (${floor.unit}).`);
  const reference = bidRange ?? effective;
  const midpoint = reference === undefined ? undefined : (reference.min + reference.max) / 2;
  const ceiling = budget?.max ?? effective?.max;

  if (effective?.type === 'hourly' && floor.unit === 'hour') {
    if (effective.max < floor.amount) {
      reasoning.push(`The client's maximum ${effective.max} is below your floor ${floor.amount}. Quoting your floor will likely not match; bid only if you can negotiate.`);
      return { verdict: 'below-floor', floor, suggestion: { amount: floor.amount, currency: floor.currency, unit: 'hour' }, belowFloor: true, lowBudget: false, hoursCovered: undefined, reasoning };
    }
    const target = round(Math.max(floor.amount, Math.min(midpoint as number, ceiling as number)));
    reasoning.push(`Suggested bid = max(floor ${floor.amount}, min(midpoint ${midpoint}, client maximum ${ceiling})) = ${target}.`);
    return { verdict: 'ok', floor, suggestion: { amount: target, currency: floor.currency, unit: 'hour' }, belowFloor: false, lowBudget: false, hoursCovered: undefined, reasoning };
  }

  if (effective?.type === 'fixed') {
    if (floor.unit === 'hour') {
      const musts = Math.max(1, mustTechCount(spec));
      const estimatedHours = config.risk.hoursPerMustHave * musts;
      const minimum = round(estimatedHours * floor.amount);
      const hoursCovered = Math.floor(effective.max / floor.amount);
      reasoning.push(`Estimated scope: ${config.risk.hoursPerMustHave} hours x ${musts} must-have technologies = ${estimatedHours} hours; at your floor that is ${minimum} ${floor.currency}. The effective covers ${hoursCovered} hours at your floor.`);
      if (effective.max < minimum) {
        return { verdict: 'below-floor', floor, suggestion: { amount: minimum, currency: floor.currency, unit: 'project' }, belowFloor: false, lowBudget: true, hoursCovered, reasoning: [...reasoning, `The effective ${effective.max} is below the ${minimum} your floor implies for this scope.`] };
      }
      const target = round(Math.max(minimum, Math.min(midpoint as number, effective.max)));
      reasoning.push(`Suggested bid = max(scope minimum ${minimum}, min(midpoint ${midpoint}, effective maximum ${effective.max})) = ${target}.`);
      return { verdict: 'ok', floor, suggestion: { amount: target, currency: floor.currency, unit: 'project' }, belowFloor: false, lowBudget: false, hoursCovered, reasoning };
    }
    if (effective.max < floor.amount) {
      reasoning.push(`The effective ${effective.max} is below your project floor ${floor.amount}.`);
      return { verdict: 'below-floor', floor, suggestion: { amount: floor.amount, currency: floor.currency, unit: 'project' }, belowFloor: true, lowBudget: false, hoursCovered: undefined, reasoning };
    }
    const target = round(Math.max(floor.amount, Math.min(midpoint as number, effective.max)));
    reasoning.push(`Suggested bid = max(floor ${floor.amount}, min(midpoint ${midpoint}, effective maximum ${effective.max})) = ${target}.`);
    return { verdict: 'ok', floor, suggestion: { amount: target, currency: floor.currency, unit: 'project' }, belowFloor: false, lowBudget: false, hoursCovered: undefined, reasoning };
  }

  return none('unsupported', `The pay type (${effective?.type ?? 'bid range only'}) does not match your floor unit (${floor.unit}): quote at or above your floor yourself.`);
}
