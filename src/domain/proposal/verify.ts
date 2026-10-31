import { analyzeJob } from '../analysis/analyze.js';
import { declaredCountry } from '../analysis/coverage.js';
import { rateFloorOf } from '../analysis/rate.js';
import { placeIncludes, findPlaces } from '../dictionary/geo.js';
import { techById, techIdsIn } from '../dictionary/tech.js';
import type { Config } from '../config/config.js';
import { extractNumbers, type FactAssessment } from '../facts/claim-policy.js';
import type { FactBase } from '../facts/fact-base.js';
import type { JobPosting } from '../job/posting.js';
import { extractLocationRestriction, findMoney } from '../job/terms.js';
import { toSentences } from '../job/sentences.js';
import { findContactDetails } from '../policy/contact.js';
import { BOILERPLATE_PHRASES, findAutomationDirective, findPhrases, findSuperlatives } from '../policy/phrases.js';
import { countLookalikes, foldForMatch, hasUnsafeCharacters } from '../shared/text-safety.js';
import { contentTokens, foldText, splitSentences, truncate, wordCount } from '../shared/text.js';

export type ViolationRule =
  | 'unsafe-characters'
  | 'lookalike-characters'
  | 'too-long'
  | 'too-many-questions'
  | 'contact-details'
  | 'unverified-link'
  | 'boilerplate'
  | 'superlative-without-evidence'
  | 'excluded-fact'
  | 'untraceable-number'
  | 'unverified-capability'
  | 'unverified-technology'
  | 'unsupported-claim'
  | 'automation-text'
  | 'location-claim-mismatch'
  | 'job-location-mismatch'
  | 'rate-below-floor'
  | 'availability-overclaim'
  | 'job-hard-warning';

export interface Violation {
  readonly rule: ViolationRule;
  /** Errors fail the check (exit status 1); warnings are reported only. */
  readonly severity: 'error' | 'warning';
  /** 1-based sentence number, when the finding is about one sentence. */
  readonly sentence?: number;
  readonly excerpt: string;
  readonly detail: string;
}

export interface SentenceTrace {
  readonly index: number;
  readonly text: string;
  /** Facts the sentence was matched to, by content. This is the independent trace, not the draft's own provenance. */
  readonly factIds: readonly string[];
}

export interface CheckReport {
  readonly ok: boolean;
  readonly violations: readonly Violation[];
  readonly trace: readonly SentenceTrace[];
  readonly stats: { readonly words: number; readonly sentences: number; readonly questions: number; readonly wordCap: number };
}

/** The part of a Markdown file that is the proposal itself: provenance and review sections are cut, footnote markers removed. */
export function proposalBody(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const cut = lines.findIndex((line) => /^#{1,6}\s*(?:provenance|review notes)\b/i.test(line) || /^\[\^[^\]]+\]:/.test(line));
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  return kept
    .join('\n')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s{0,3}(?:[-*]\s+|>\s*)/gm, '')
    .replace(/[*_`]/g, '')
    .trim();
}

const FIRST_PERSON = /\b(?:i|i'm|i've|i'd|i'll|my|me|we|we've|our|mine)\b/i;
const GAP_CUE = /\b(?:no|not|without|limited|lack of|never|haven't|have not|new to|unfamiliar with|don't have|do not have)\b/i;
const NOT_A_GAP = /\b(?:not only|no problem|no doubt|no issue|no trouble|not a problem|no worries|no hesitation)\b/i;
const CAPABILITY_CLAIM =
  /\b(?:i|we)(?:'ve| have| had)? (?:built|shipped|led|delivered|managed|designed|developed|worked|launched|created|implemented|maintained|architected|scaled|optimi[sz]ed|reduced|increased|saved|grew|written|wrote|deployed|migrated)\b|\b(?:i am|i'm) (?:an? )?(?:experienced|skilled|seasoned|senior|proficient|expert|specialist|professional|certified|fluent)\b|\bmy (?:experience|expertise|background|track record|portfolio|skills)\b|\bexperience (?:with|in|of)\b|\byears? of (?:experience|work)\b/i;
const OFFER = /\b(?:rate|bid|price|fee|charge|quote|budget|cost)\b/i;

function normalize(text: string): string {
  return foldText(foldForMatch(text)).replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Facts whose claim a sentence contains (after normalising) or mostly repeats. */
function matchFacts(sentence: string, facts: readonly FactAssessment[]): FactAssessment[] {
  const text = normalize(sentence);
  const tokens = new Set(contentTokens(sentence));
  return facts.filter((a) => {
    const claim = normalize(a.fact.claim);
    if (text.includes(claim)) return true;
    const claimTokens = contentTokens(a.fact.claim);
    if (claimTokens.length < 4) return false;
    const shared = claimTokens.filter((t) => tokens.has(t)).length;
    return shared / claimTokens.length >= 0.8;
  });
}

function factNumbers(fact: FactAssessment['fact']): Set<string> {
  const numbers = new Set(extractNumbers(fact.claim));
  for (const value of Object.values(fact.attrs)) if (typeof value === 'number') numbers.add(String(value));
  return numbers;
}

function isGapStatement(sentence: string): boolean {
  return GAP_CUE.test(sentence) && !NOT_A_GAP.test(sentence);
}

/**
 * Independent re-check of a proposal against the job and the fact base. It does not trust any provenance
 * the text carries: sentences are matched to facts by content. A proposal written by hand or by any other
 * tool is acceptable exactly when this returns ok.
 */
export function verifyProposal(input: { readonly markdown: string; readonly job: JobPosting; readonly facts: FactBase; readonly config: Config }): CheckReport {
  const { job, facts, config } = input;
  const body = proposalBody(input.markdown);
  const violations: Violation[] = [];
  const add = (v: Violation): void => void violations.push(v);
  const assessments = facts.assessments();
  const usable = assessments.filter((a) => a.usable);
  const jobText = job.body;
  const jobNumbers = new Set(extractNumbers(jobText));
  const jobTechs = new Set(techIdsIn(jobText));
  const floor = rateFloorOf(facts);

  if (hasUnsafeCharacters(body)) add({ rule: 'unsafe-characters', severity: 'error', excerpt: '', detail: 'The proposal contains control, bidirectional or zero-width characters.' });

  const lookalikes = countLookalikes(body);
  if (lookalikes > 0) add({ rule: 'lookalike-characters', severity: 'error', excerpt: '', detail: `${lookalikes} words mix Latin letters with look-alike letters from another script (a way to slip words past a filter).` });

  const words = wordCount(body);
  if (words > config.drafting.wordCap) add({ rule: 'too-long', severity: 'error', excerpt: '', detail: `${words} words; the cap is ${config.drafting.wordCap}.` });

  const sentences = splitSentences(body);
  const questions = sentences.filter((s) => s.includes('?')).length;
  if (questions > 1) add({ rule: 'too-many-questions', severity: 'error', excerpt: '', detail: `${questions} questions; ask at most one.` });

  for (const finding of findContactDetails(body)) {
    if (finding.kind === 'link') {
      const known = assessments.some((a) => a.fact.evidence.reference === finding.excerpt || finding.excerpt.startsWith(a.fact.evidence.reference));
      if (!known) add({ rule: 'unverified-link', severity: 'warning', excerpt: finding.excerpt, detail: 'The link does not appear as evidence in any fact.' });
    } else {
      add({ rule: 'contact-details', severity: 'error', excerpt: finding.excerpt, detail: `${finding.kind === 'email' ? 'An' : 'A'} ${finding.kind === 'phone' ? 'phone number' : finding.kind} in a proposal invites the client off the platform and leaks personal data.` });
    }
  }

  const directive = findAutomationDirective(body);
  if (directive !== undefined) add({ rule: 'automation-text', severity: 'error', excerpt: directive, detail: 'The proposal contains text addressed to an automated reader; it may have been copied from the job post.' });

  const trace: SentenceTrace[] = [];
  const mine = declaredCountry(facts);
  const claimedHours = Math.max(0, ...usable.filter((a) => a.fact.category === 'availability').map((a) => a.fact.attrs.hoursPerWeek as number));

  sentences.forEach((sentence, i) => {
    const n = i + 1;
    const excerpt = truncate(sentence, 120);
    const matched = matchFacts(sentence, assessments);
    const matchedUsable = matched.filter((a) => a.usable);
    trace.push({ index: n, text: sentence, factIds: matchedUsable.map((a) => a.fact.id) });

    for (const a of matched.filter((m) => !m.usable)) {
      add({ rule: 'excluded-fact', severity: 'error', sentence: n, excerpt, detail: `Repeats fact ${a.fact.id}, which may not be used: ${a.exclusions.join('; ')}.` });
    }

    for (const phrase of findPhrases(sentence, BOILERPLATE_PHRASES)) {
      add({ rule: 'boilerplate', severity: 'error', sentence: n, excerpt, detail: `Boilerplate phrase "${phrase}".` });
    }

    for (const term of findSuperlatives(sentence)) {
      const backed = matchedUsable.some((a) => a.trust === 'verified' && findSuperlatives(a.fact.claim).includes(term));
      if (!backed) add({ rule: 'superlative-without-evidence', severity: 'error', sentence: n, excerpt, detail: `"${term}" is not backed by a verified fact.` });
    }

    const firstPerson = FIRST_PERSON.test(sentence);
    const gap = isGapStatement(sentence);
    const money = findMoney(sentence);
    const offer = money.length > 0 && OFFER.test(sentence);

    if (offer && floor !== undefined) {
      for (const m of money) {
        const perHour = m.unit === 'hr' || m.unit === 'hour' || m.unit === 'h' || /\b(?:hour|hourly|hr)\b/i.test(sentence);
        const comparable = m.currency === floor.currency && (floor.unit === 'hour' ? perHour : !perHour);
        if (comparable && m.max < floor.amount) {
          add({ rule: 'rate-below-floor', severity: 'error', sentence: n, excerpt, detail: `Offers ${m.max} ${m.currency}, below your floor of ${floor.amount} ${floor.currency} per ${floor.unit} (${floor.factId}).` });
        }
      }
    }

    const allowedNumbers = new Set(matchedUsable.flatMap((a) => [...factNumbers(a.fact)]));
    for (const number of new Set(extractNumbers(sentence))) {
      if (allowedNumbers.has(number)) continue;
      if (offer && money.some((m) => extractNumbers(m.excerpt).includes(number))) continue;
      if (!firstPerson && jobNumbers.has(number)) continue; // echoing the client's own number is not a claim about you
      add({ rule: 'untraceable-number', severity: 'error', sentence: n, excerpt, detail: `The number ${number} is not in any verified fact${firstPerson ? '' : ' or in the job post'}.` });
    }

    const covered = new Set(matchedUsable.flatMap((a) => a.techs));
    for (const tech of techIdsIn(foldForMatch(sentence))) {
      if (covered.has(tech) || gap) continue;
      if (!firstPerson && jobTechs.has(tech)) continue;
      const known = usable.some((a) => a.techs.includes(tech));
      const label = techById(tech)?.label ?? tech;
      if (firstPerson || CAPABILITY_CLAIM.test(sentence)) {
        add({ rule: 'unverified-capability', severity: 'error', sentence: n, excerpt, detail: known ? `${label} is in your facts, but this sentence is not traceable to the fact that covers it.` : `${label} is not covered by any verified fact.` });
      } else {
        add({ rule: 'unverified-technology', severity: 'warning', sentence: n, excerpt, detail: `${label} is mentioned but appears in neither your facts nor the job post.` });
      }
    }

    if (matchedUsable.length === 0 && !gap && CAPABILITY_CLAIM.test(sentence) && !violations.some((v) => v.sentence === n && v.rule === 'unverified-capability')) {
      add({ rule: 'unsupported-claim', severity: 'error', sentence: n, excerpt, detail: 'A claim about your experience that no fact supports.' });
    }

    if (mine !== undefined && mine.place !== undefined && /\b(?:based|located|living|live|reside|residing|from|home)\b/i.test(sentence) && firstPerson) {
      for (const place of findPlaces(sentence)) {
        if (!placeIncludes(place.id, mine.place) && !placeIncludes(mine.place, place.id)) {
          add({ rule: 'location-claim-mismatch', severity: 'error', sentence: n, excerpt, detail: `Claims a location (${place.text}) that differs from your declared location (${mine.text}, ${mine.factId}).` });
        }
      }
    }

    const hours = /\b(\d{1,2})\s*(?:hours?|hrs?)\s*(?:per|a|\/)\s*week\b/i.exec(sentence);
    if (hours !== null && claimedHours > 0 && Number(hours[1]) > claimedHours) {
      add({ rule: 'availability-overclaim', severity: 'error', sentence: n, excerpt, detail: `Promises ${hours[1]} hours per week; your availability fact says ${claimedHours}.` });
    }
  });

  const restriction = extractLocationRestriction(toSentences(job.body));
  if (restriction !== undefined && restriction.mode !== 'preferred' && mine !== undefined && mine.place !== undefined) {
    const inside = restriction.places.some((p) => placeIncludes(p, mine.place as string));
    if (restriction.mode === 'excluding' ? inside : !inside) {
      add({ rule: 'job-location-mismatch', severity: restriction.strong ? 'error' : 'warning', excerpt: restriction.excerpt, detail: `The job restricts location to ${restriction.places.join(', ')}; your declared location is ${mine.text}.` });
    }
  }

  for (const flag of analyzeJob(job, facts, config).analysis.flags) {
    if (flag.severity === 'hard' && flag.ruleId !== 'location-excluded') {
      add({ rule: 'job-hard-warning', severity: 'warning', excerpt: flag.excerpt ?? '', detail: `The job has a hard warning: ${flag.title}.` });
    }
  }

  return {
    ok: !violations.some((v) => v.severity === 'error'),
    violations,
    trace,
    stats: { words, sentences: sentences.length, questions, wordCap: config.drafting.wordCap },
  };
}
