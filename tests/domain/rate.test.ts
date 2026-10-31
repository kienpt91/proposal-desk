import { describe, expect, it } from 'vitest';
import { rateFloorOf } from '../../src/domain/analysis/rate.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { rateFact } from '../support/builders.js';
import { analyze, factBase, typicalFacts } from '../support/analysis.js';

const rate = (text: string, facts: FactBase = typicalFacts()) => analyze(text, facts).analysis.rate;
const META = (extra: string) => `---proposal-desk\n${extra}\n---\n`;

describe('rate guidance', () => {
  it('makes no suggestion without a rate fact', () => {
    const r = rate('We need TypeScript. Budget: $40-$60/hr.', FactBase.empty());
    expect(r).toMatchObject({ verdict: 'no-floor', suggestion: undefined, belowFloor: false });
    expect(rateFloorOf(FactBase.empty())).toBeUndefined();
  });

  it('suggests the floor when the post gives no range', () => {
    expect(rate('We need TypeScript help.')).toMatchObject({ verdict: 'no-range', suggestion: { amount: 40, currency: 'USD', unit: 'hour' } });
  });

  it('suggests the midpoint of the range, clamped between the floor and the client maximum', () => {
    expect(rate('We need TypeScript. Budget: $40-$60/hr.').suggestion?.amount).toBe(50);
    expect(rate(`${META('bid-min: 35\nbid-max: 70\ncurrency: USD')}We need TypeScript. Budget: $40-$60/hr.`).suggestion?.amount).toBe(53);
    expect(rate('We need TypeScript. Budget: $10-$100/hr.').suggestion?.amount).toBe(55);
    expect(rate(`${META('bid-min: 80\nbid-max: 120')}We need TypeScript. Budget: $30-$60/hr.`).suggestion?.amount).toBe(60);
    expect(rate(`${META('bid-min: 10\nbid-max: 20')}We need TypeScript. Budget: $30-$60/hr.`).suggestion?.amount).toBe(40);
  });

  it('never suggests less than the floor and flags a budget below it', () => {
    const r = rate('We need TypeScript. Budget: $20-$30/hr.');
    expect(r).toMatchObject({ verdict: 'below-floor', belowFloor: true, suggestion: { amount: 40 } });
    expect(r.reasoning.join('\n')).toContain('below your floor');
  });

  it('reads a bid range when the post has no budget, in the unit of the floor', () => {
    const r = rate(`${META('bid-min: 30\nbid-max: 70')}We need TypeScript help.`);
    expect(r).toMatchObject({ verdict: 'ok', suggestion: { amount: 50, unit: 'hour' } });
    expect(r.reasoning.join('\n')).toContain("read in your floor's unit");
    expect(rate(`${META('bid-min: 10\nbid-max: 20')}We need TypeScript help.`)).toMatchObject({ belowFloor: true, suggestion: { amount: 40 } });
  });

  it('refuses to compare different currencies', () => {
    expect(rate('We need TypeScript. Budget: €40-€60/hr.')).toMatchObject({ verdict: 'currency-mismatch', suggestion: undefined });
    expect(rate(`${META('bid-min: 30\nbid-max: 70\ncurrency: EUR')}We need TypeScript.`).verdict).toBe('currency-mismatch');
  });

  it('prices fixed budgets against the scope implied by the must-have technologies', () => {
    const musts = 'Requirements:\n- TypeScript\n- PostgreSQL\n';
    const ok = rate(`${musts}Fixed price $3000.`);
    expect(ok).toMatchObject({ verdict: 'ok', lowBudget: false, hoursCovered: 75, suggestion: { amount: 3000, unit: 'project' } });
    expect(ok.reasoning.join('\n')).toContain('5 hours x 2 must-have technologies = 10 hours');
    const low = rate(`${musts}Fixed price $200.`);
    expect(low).toMatchObject({ verdict: 'below-floor', lowBudget: true, hoursCovered: 5, suggestion: { amount: 400 } });
    expect(rate('Requirements:\n- TypeScript\nFixed price $5,000.').suggestion?.amount).toBe(5000);
  });

  it('handles project floors', () => {
    const facts = factBase(rateFact(1000, 'USD', 'project'));
    expect(rate('TypeScript work. Fixed price $800.', facts)).toMatchObject({ verdict: 'below-floor', belowFloor: true, suggestion: { amount: 1000, unit: 'project' } });
    expect(rate('TypeScript work. Fixed price $3000.', facts)).toMatchObject({ verdict: 'ok', suggestion: { amount: 3000, unit: 'project' } });
    expect(rate('TypeScript work. Budget: $30-$60/hr.', facts)).toMatchObject({ verdict: 'unsupported', suggestion: undefined });
  });

  it('declines when the pay type is unknown', () => {
    expect(rate('We pay $1,200 per month for TypeScript work.')).toMatchObject({ verdict: 'unsupported', suggestion: undefined });
  });
});
