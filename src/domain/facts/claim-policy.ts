import { findTechs, techIdsIn } from '../dictionary/tech.js';
import { findSuperlatives } from '../policy/phrases.js';
import { tagTechIds, type Fact } from './fact.js';

/**
 * How far a fact can be trusted when it is used in a proposal.
 *  verified      – evidence is a local file whose SHA-256 was re-checked successfully
 *  evidenced     – evidence exists (a repository URL, or a file not yet re-checked) but the tool cannot verify it offline
 *  self-declared – the freelancer's own word only
 */
export type Trust = 'verified' | 'evidenced' | 'self-declared';

export function trustOf(fact: Fact): Trust {
  if (fact.status === 'verified') return 'verified';
  return fact.evidence.kind === 'self-declared' ? 'self-declared' : 'evidenced';
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100, thousand: 1000, million: 1000000,
  dozen: 12, dozens: 12, hundreds: 100, thousands: 1000,
};
const WORD_PATTERN = Object.keys(WORD_NUMBERS).join('|');
const NUMBER_TOKEN = new RegExp(
  `(?<![A-Za-z0-9.#+/-])(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?(k|m|%)?(?![A-Za-z0-9])|\\b(${WORD_PATTERN})\\b`,
  'gi',
);

/**
 * Numbers mentioned in `text`, normalised ("1,200" and "1200" agree, "five" and "5" agree, "10k" is 10000).
 * Digits that belong to a technology name ("Vue 3", "Java 17") are not numbers.
 */
export function extractNumbers(text: string): string[] {
  let scrubbed = text;
  for (const match of [...findTechs(text)].sort((a, b) => b.index - a.index)) {
    scrubbed = `${scrubbed.slice(0, match.index)}${' '.repeat(match.length)}${scrubbed.slice(match.index + match.length)}`;
  }
  const out: string[] = [];
  for (const m of scrubbed.matchAll(NUMBER_TOKEN)) {
    if (m[3] !== undefined) {
      out.push(String(WORD_NUMBERS[m[3].toLowerCase()]));
      continue;
    }
    let value = Number((m[1] as string).replace(/,/g, ''));
    const suffix = m[2]?.toLowerCase();
    if (suffix === 'k') value *= 1000;
    if (suffix === 'm') value *= 1_000_000;
    out.push(String(value));
  }
  return out;
}

const OUTCOME_WORDS =
  /\b(?:increased?|reduced?|cut|saved?|grew|growth|boosted?|improved?|revenue|profit|conversions?|uptime|latency|throughput|roi|sales|traffic|subscribers|downloads|ranked|rating|rated|awards?|awarded)\b/i;

/** Categories that describe the freelancer's own terms; numbers there are declarations, not outcome claims. */
const TERMS_CATEGORIES: readonly string[] = ['availability', 'rate', 'constraint'];

/** A claim about a measurable outcome: a number, an years-of-experience attribute or an outcome word. */
export function isMeasurable(fact: Fact): boolean {
  if (TERMS_CATEGORIES.includes(fact.category)) return false;
  return extractNumbers(fact.claim).length > 0 || typeof fact.attrs.years === 'number' || OUTCOME_WORDS.test(fact.claim);
}

/** Canonical technology ids a fact is about: its tags plus technologies named in the claim. */
export function factTechIds(fact: Fact): string[] {
  return [...new Set([...tagTechIds(fact), ...techIdsIn(fact.claim)])];
}

export interface FactAssessment {
  readonly fact: Fact;
  readonly trust: Trust;
  readonly usable: boolean;
  /** Why the fact may not be used in a proposal (empty when usable). */
  readonly exclusions: readonly string[];
  readonly techs: readonly string[];
}

/** Decides whether a fact may appear in a proposal, and why not when it may not. */
export function assessFact(fact: Fact): FactAssessment {
  const trust = trustOf(fact);
  const exclusions: string[] = [];
  if (fact.status === 'stale') exclusions.push('stale: re-verify the evidence or update the fact');
  if (isMeasurable(fact) && fact.evidence.kind === 'self-declared') {
    exclusions.push('numbers and outcomes need evidence beyond a self-declaration');
  }
  if (trust !== 'verified' && findSuperlatives(fact.claim).length > 0) {
    exclusions.push('superlatives are only allowed in verified facts');
  }
  return { fact, trust, usable: exclusions.length === 0, exclusions, techs: factTechIds(fact) };
}
