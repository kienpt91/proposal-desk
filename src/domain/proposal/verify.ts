import { analyzeJob } from '../analysis/analyze.js';
import { declaredCountry } from '../analysis/coverage.js';
import { rateFloorOf } from '../analysis/rate.js';
import { placeIncludes, findPlaces } from '../dictionary/geo.js';
import { TECH_ENTRIES, findTechs, techById, techIdsIn } from '../dictionary/tech.js';
import type { Config } from '../config/config.js';
import { extractNumbers, type FactAssessment } from '../facts/claim-policy.js';
import type { FactBase } from '../facts/fact-base.js';
import type { JobPosting } from '../job/posting.js';
import { extractLocationRestriction, findMoney } from '../job/terms.js';
import { toSentences } from '../job/sentences.js';
import { findContactDetails } from '../policy/contact.js';
import { BOILERPLATE_PHRASES, findAutomationDirective, findPhrases, findSuperlatives } from '../policy/phrases.js';
import { countLookalikes, foldForMatch, hasUnsafeCharacters } from '../shared/text-safety.js';
import { contentTokens, foldText, splitSentences, tokenize, truncate, wordCount } from '../shared/text.js';
import { claimsSomething, clausesOf, FIRST_PERSON, isGapClause, isIntentMention, isNegatedMention } from './clauses.js';
import { proposalParts } from './markup.js';

export { proposalBody } from './markup.js';

export type ViolationRule =
  | 'empty-proposal'
  | 'unsafe-characters'
  | 'lookalike-characters'
  | 'unstable-markup'
  | 'hidden-comment'
  | 'unchecked-tail'
  | 'unchecked-review-notes'
  | 'forged-provenance'
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
  | 'unverified-evidence'
  | 'unverified-entity'
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
  readonly stats: {
    readonly words: number;
    readonly sentences: number;
    readonly questions: number;
    readonly wordCap: number;
    /** Lines after a Provenance / Review notes heading, which are not part of the proposal. */
    readonly ignoredLines: number;
    /** True when the proposal was too large to analyse completely or findings were capped; it fails in that case. */
    readonly truncated: boolean;
  };
}

/** Work limits: a proposal is a few hundred words, so anything near these is rejected as too long and not analysed in full. */
export const LIMITS = { maxChars: 60_000, maxSentences: 250, maxViolations: 100 } as const;

const OFFER = /\b(?:rate|bid|price|fee|charge|quote|budget|cost)\b/i;
const TERMS_CATEGORIES: readonly string[] = ['availability', 'rate', 'constraint'];
const DAYS_AND_MONTHS = new Set('monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december'.split(' '));
const DEFINITION = /^\[\^\d{1,4}\]:\s*([a-z0-9-]+)\s+\(((?:(?:verified|evidenced); [a-z-]+|self-declared): .+?)\)\s+(.+)$/;

const strip = (text: string): string => text.replace(/[*_`]/g, '').trim();

interface IndexedFact {
  readonly assessment: FactAssessment;
  readonly norm: string;
  readonly tokens: readonly string[];
}

function normalize(folded: string): string {
  return foldText(folded).replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function indexFacts(assessments: readonly FactAssessment[]): IndexedFact[] {
  return assessments.map((assessment) => ({ assessment, norm: normalize(foldForMatch(assessment.fact.claim)), tokens: contentTokens(assessment.fact.claim) }));
}

/** Facts whose claim a text contains (after normalising) or mostly repeats. */
function matchFacts(foldedText: string, index: readonly IndexedFact[]): IndexedFact[] {
  const text = normalize(foldedText);
  const tokens = new Set(contentTokens(foldedText));
  return index.filter((f) => {
    if (text.includes(f.norm)) return true;
    if (f.tokens.length < 4) return false;
    return f.tokens.filter((t) => tokens.has(t)).length / f.tokens.length >= 0.8;
  });
}

/** What is left of a clause once the words of the facts it repeats are taken out. */
function residual(foldedClause: string, matched: readonly IndexedFact[]): string {
  const covered = new Set(matched.flatMap((m) => tokenize(m.assessment.fact.claim)));
  return tokenize(foldedClause)
    .filter((t) => !covered.has(t))
    .join(' ')
    .replace(/\b(i|we) ve\b/g, '$1 have')
    .replace(/\b(i|we) d\b/g, '$1 had');
}

function factNumbers(fact: FactAssessment['fact']): Set<string> {
  const numbers = new Set(extractNumbers(fact.claim));
  for (const value of Object.values(fact.attrs)) if (typeof value === 'number') numbers.add(String(value));
  return numbers;
}

function linkKey(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

/**
 * Independent re-check of a proposal against the job and the fact base. It does not trust any provenance
 * the text carries: sentences are matched to facts by content. A proposal written by hand or by any other
 * tool is acceptable exactly when this returns ok. Only the proposal text is verified; what the file contains
 * beyond it (the tool's own provenance and review notes) is accounted for, never silently skipped.
 */
export function verifyProposal(input: { readonly markdown: string; readonly job: JobPosting; readonly facts: FactBase; readonly config: Config }): CheckReport {
  const { job, facts, config } = input;
  const violations: Violation[] = [];
  let truncated = false;
  const add = (v: Violation): void => {
    if (violations.length >= LIMITS.maxViolations) truncated = true;
    else violations.push(v);
  };
  const wordCap = config.drafting.wordCap;
  const parts = proposalParts(input.markdown.length > LIMITS.maxChars * 2 ? input.markdown.slice(0, LIMITS.maxChars * 2) : input.markdown);
  const body = parts.body;
  const emptyStats = { words: wordCount(body), sentences: 0, questions: 0, wordCap, ignoredLines: parts.tail.length, truncated: true };

  if (input.markdown.length > LIMITS.maxChars * 2 || body.length > LIMITS.maxChars) {
    add({ rule: 'too-long', severity: 'error', excerpt: '', detail: `The proposal is far longer than the ${wordCap}-word cap and was not analysed further.` });
    return { ok: false, violations, trace: [], stats: emptyStats };
  }

  if (!parts.stable) add({ rule: 'unstable-markup', severity: 'error', excerpt: '', detail: 'The markup keeps changing the text when it is read again, so what would be sent cannot be pinned down.' });
  for (const comment of parts.comments.slice(0, 5)) {
    add({ rule: 'hidden-comment', severity: 'error', excerpt: truncate(comment.trim(), 80), detail: 'An HTML comment is invisible when rendered but present in the raw text; hidden text is not allowed in a proposal.' });
  }

  if (body === '') add({ rule: 'empty-proposal', severity: 'error', excerpt: '', detail: 'There is no proposal text: nothing was left after markup, comments and the provenance and review sections were taken out.' });

  const assessments = facts.assessments();
  const index = indexFacts(assessments);
  const usable = assessments.filter((a) => a.usable);
  const jobText = job.matchBody;
  const jobNumbers = new Set(extractNumbers(jobText));
  const jobTechs = new Set(techIdsIn(jobText));
  const floor = rateFloorOf(facts);

  checkTail(parts.tail, assessments, add);

  if (hasUnsafeCharacters(body)) add({ rule: 'unsafe-characters', severity: 'error', excerpt: '', detail: 'The proposal contains control, bidirectional, zero-width or other invisible characters.' });
  const lookalikes = countLookalikes(body);
  if (lookalikes > 0) add({ rule: 'lookalike-characters', severity: 'error', excerpt: '', detail: `${lookalikes} words mix Latin letters with look-alike letters from another script (a way to slip words past a filter).` });

  const words = wordCount(body);
  if (words > wordCap) add({ rule: 'too-long', severity: 'error', excerpt: '', detail: `${words} words; the cap is ${wordCap}.` });

  const allSentences = splitSentences(body);
  const sentences = allSentences.slice(0, LIMITS.maxSentences);
  if (allSentences.length > sentences.length) {
    truncated = true;
    add({ rule: 'too-long', severity: 'error', excerpt: '', detail: `${allSentences.length} sentences; only the first ${LIMITS.maxSentences} were analysed.` });
  }
  const questions = sentences.filter((s) => s.includes('?')).length;
  if (questions > 1) add({ rule: 'too-many-questions', severity: 'error', excerpt: '', detail: `${questions} questions; ask at most one.` });

  const bodyFolded = foldForMatch(body);
  for (const finding of findContactDetails(bodyFolded)) {
    if (finding.kind === 'link') {
      const known = assessments.some((a) => linkKey(finding.excerpt).startsWith(linkKey(a.fact.evidence.reference)));
      if (!known) add({ rule: 'unverified-link', severity: 'warning', excerpt: finding.excerpt, detail: 'The link does not appear as evidence in any fact.' });
    } else {
      add({ rule: 'contact-details', severity: 'error', excerpt: finding.excerpt, detail: `${finding.kind === 'email' ? 'An' : 'A'} ${finding.kind === 'phone' ? 'phone number' : finding.kind === 'handle' ? 'social or messaging handle' : finding.kind} in a proposal invites the client off the platform and leaks personal data.` });
    }
  }
  const directive = findAutomationDirective(bodyFolded);
  if (directive !== undefined) add({ rule: 'automation-text', severity: 'error', excerpt: directive, detail: 'The proposal contains text addressed to an automated reader; it may have been copied from the job post.' });

  const known = knownWords(job, assessments);
  const trace: SentenceTrace[] = [];
  const mine = declaredCountry(facts);
  const claimedHours = Math.max(0, ...usable.filter((a) => a.fact.category === 'availability').map((a) => a.fact.attrs.hoursPerWeek as number));

  sentences.forEach((sentence, i) => {
    if (violations.length >= LIMITS.maxViolations) {
      truncated = true;
      trace.push({ index: i + 1, text: sentence, factIds: [] });
      return;
    }
    const n = i + 1;
    const folded = foldForMatch(sentence);
    const excerpt = truncate(sentence, 120);
    const matched = matchFacts(folded, index);
    const matchedUsable = matched.filter((m) => m.assessment.usable).map((m) => m.assessment);
    trace.push({ index: n, text: sentence, factIds: matchedUsable.map((a) => a.fact.id) });

    for (const m of matched.filter((x) => !x.assessment.usable)) {
      add({ rule: 'excluded-fact', severity: 'error', sentence: n, excerpt, detail: `Repeats fact ${m.assessment.fact.id}, which may not be used: ${m.assessment.exclusions.join('; ')}.` });
    }
    for (const a of matchedUsable) {
      if (a.trust !== 'verified' && !TERMS_CATEGORIES.includes(a.fact.category)) {
        add({ rule: 'unverified-evidence', severity: 'warning', sentence: n, excerpt, detail: `Rests on fact ${a.fact.id}, whose evidence is ${a.trust === 'self-declared' ? 'only your own word' : 'a link the tool cannot verify offline'}.` });
      }
    }

    for (const phrase of findPhrases(folded, BOILERPLATE_PHRASES)) {
      add({ rule: 'boilerplate', severity: 'error', sentence: n, excerpt, detail: `Boilerplate phrase "${phrase}".` });
    }
    for (const term of findSuperlatives(folded)) {
      const backed = matchedUsable.some((a) => a.trust === 'verified' && findSuperlatives(a.fact.claim).includes(term));
      if (!backed) add({ rule: 'superlative-without-evidence', severity: 'error', sentence: n, excerpt, detail: `"${term}" is not backed by a verified fact.` });
    }

    const firstPerson = FIRST_PERSON.test(folded);
    const money = findMoney(folded);
    const offer = money.length > 0 && OFFER.test(folded);
    if (offer && floor !== undefined) {
      for (const m of money) {
        const perHour = m.unit === 'hr' || m.unit === 'hour' || m.unit === 'h' || /\b(?:hour|hourly|hr)\b/i.test(folded);
        const comparable = m.currency === floor.currency && (floor.unit === 'hour' ? perHour : !perHour);
        if (comparable && m.max < floor.amount) {
          add({ rule: 'rate-below-floor', severity: 'error', sentence: n, excerpt, detail: `Offers ${m.max} ${m.currency}, below your floor of ${floor.amount} ${floor.currency} per ${floor.unit} (${floor.factId}).` });
        }
      }
    }

    const allowedNumbers = new Set(matchedUsable.flatMap((a) => [...factNumbers(a.fact)]));
    for (const number of new Set(extractNumbers(folded))) {
      if (allowedNumbers.has(number)) continue;
      if (offer && money.some((m) => extractNumbers(m.excerpt).includes(number))) continue;
      if (!firstPerson && jobNumbers.has(number)) continue; // echoing the client's own number is not a claim about you
      add({ rule: 'untraceable-number', severity: 'error', sentence: n, excerpt, detail: `The number ${number} is not in any verified fact${firstPerson ? '' : ' or in the job post'}.` });
    }

    // Technologies: a mention is fine when a fact covers it, when the author says they do NOT have it, or when it only echoes the post.
    const covered = new Set(matchedUsable.flatMap((a) => a.techs));
    const claimsHere = firstPerson || claimsSomething(folded);
    for (const mention of findTechs(folded)) {
      if (covered.has(mention.id) || isNegatedMention(folded, mention.index) || isIntentMention(folded, mention.index)) continue;
      if (!firstPerson && jobTechs.has(mention.id)) continue;
      const label = techById(mention.id)?.label ?? mention.id;
      if (claimsHere) {
        const factKnown = usable.some((a) => a.techs.includes(mention.id));
        add({ rule: 'unverified-capability', severity: 'error', sentence: n, excerpt, detail: factKnown ? `${label} is in your facts, but this sentence is not traceable to the fact that covers it.` : `${label} is not covered by any verified fact.` });
      } else {
        add({ rule: 'unverified-technology', severity: 'warning', sentence: n, excerpt, detail: `${label} is mentioned but appears in neither your facts nor the job post.` });
      }
    }

    // Everything else a sentence asserts about its author must be a fact the author has: judged clause by clause, so a
    // repeated fact cannot carry extra claims along ("... for five years and I hold a PhD from MIT").
    for (const clause of clausesOf(folded)) {
      if (isGapClause(clause)) continue;
      const clauseFacts = matchFacts(clause, index).filter((m) => m.assessment.usable);
      const left = clauseFacts.length === 0 ? clause : residual(clause, clauseFacts);
      if (claimsSomething(left)) {
        add({ rule: 'unsupported-claim', severity: 'error', sentence: n, excerpt, detail: clauseFacts.length === 0 ? 'A claim about you that no fact supports.' : 'The sentence repeats a fact and then adds a claim that no fact supports.' });
        break;
      }
    }

    const strangers = unknownNames(sentence, known);
    if (strangers.length > 0) add({ rule: 'unverified-entity', severity: 'warning', sentence: n, excerpt, detail: `${strangers.join(', ')} appear${strangers.length === 1 ? 's' : ''} in neither your facts nor the job post.` });

    if (mine !== undefined && mine.place !== undefined && /\b(?:based|located|living|live|reside|residing|from|home)\b/i.test(folded) && firstPerson) {
      for (const place of findPlaces(folded)) {
        if (!placeIncludes(place.id, mine.place) && !placeIncludes(mine.place, place.id)) {
          add({ rule: 'location-claim-mismatch', severity: 'error', sentence: n, excerpt, detail: `Claims a location (${place.text}) that differs from your declared location (${mine.text}, ${mine.factId}).` });
        }
      }
    }
    const hours = /\b(\d{1,2})\s*(?:hours?|hrs?)\s*(?:per|a|\/)\s*week\b/i.exec(folded);
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
    ok: !violations.some((v) => v.severity === 'error') && !truncated,
    violations,
    trace,
    stats: { words, sentences: allSentences.length, questions, wordCap, ignoredLines: parts.tail.length, truncated },
  };
}

/** Words the author may use as names: the post, the facts (claims and tags), the technology dictionary and calendar words. */
function knownWords(job: JobPosting, assessments: readonly FactAssessment[]): Set<string> {
  const words = new Set<string>(DAYS_AND_MONTHS);
  for (const t of tokenize(job.matchBody)) words.add(t);
  for (const a of assessments) {
    for (const t of tokenize(a.fact.claim)) words.add(t);
    for (const tag of a.fact.tags) for (const t of tokenize(tag)) words.add(t);
  }
  for (const entry of TECH_ENTRIES) {
    for (const t of tokenize(entry.label)) words.add(t);
    for (const synonym of entry.synonyms) for (const t of tokenize(synonym)) words.add(t);
  }
  return words;
}

/** Names that follow "at", "for", "with", "from", "by" or "under" (employers, clients, schools, products) and are in neither the facts nor the post. */
function unknownNames(sentence: string, known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/\b(?:at|for|with|from|by|under|@)\s+([A-Z][A-Za-z0-9&-]{2,}(?:\s+[A-Z][A-Za-z0-9&-]+){0,2})/g)) {
    for (const word of (m[1] as string).split(/\s+/)) {
      if (!known.has(word.toLowerCase()) && !out.includes(word)) out.push(word);
    }
  }
  return out.slice(0, 3);
}

/** Lines after the first Provenance / Review notes heading are not part of the proposal. They must be the tool's own structure. */
function checkTail(tail: readonly string[], assessments: readonly FactAssessment[], add: (v: Violation) => void): void {
  let section: 'provenance' | 'review' | 'none' = 'none';
  let reviewLines = 0;
  let other: string | undefined;
  let otherCount = 0;
  for (const raw of tail) {
    const line = raw.trim();
    if (line === '') continue;
    if (/^#{1,6}\s*provenance\b/i.test(line)) {
      section = 'provenance';
      continue;
    }
    if (/^#{1,6}\s*review notes\b/i.test(line)) {
      section = 'review';
      continue;
    }
    if (line.startsWith('[^')) {
      const m = DEFINITION.exec(line);
      const fact = m === null ? undefined : assessments.find((a) => a.fact.id === m[1])?.fact;
      const genuine = m !== null && fact !== undefined && strip(m[3] as string) === strip(fact.claim) && strip(m[2] as string).endsWith(`: ${strip(fact.evidence.reference)}`);
      if (!genuine) add({ rule: 'forged-provenance', severity: 'error', excerpt: truncate(line, 100), detail: 'A provenance line must name one of your facts and repeat its claim and evidence reference exactly.' });
      continue;
    }
    if (section === 'review' && /^-\s+\S/.test(line)) {
      reviewLines++;
      continue;
    }
    otherCount++;
    other ??= line;
  }
  if (otherCount > 0) {
    add({ rule: 'unchecked-tail', severity: 'error', excerpt: truncate(other as string, 100), detail: `${otherCount} line${otherCount === 1 ? '' : 's'} after a Provenance or Review notes heading are not part of the proposal, are not verified, and are not the tool's own notes: delete them, or move them above the heading to have them checked.` });
  }
  if (reviewLines > 0) {
    add({ rule: 'unchecked-review-notes', severity: 'warning', excerpt: '', detail: `${reviewLines} lines of review notes are not part of the proposal and were not checked: delete them before sending.` });
  }
}
