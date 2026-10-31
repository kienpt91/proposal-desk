import { findPlaces, ZONE_ABBREVIATIONS, parseUtcOffset, zoneOffset } from '../dictionary/geo.js';
import { truncate } from '../shared/text.js';
import type { Sentence } from './sentences.js';

// ---------------------------------------------------------------- budget

export type PayType = 'hourly' | 'fixed' | 'unknown';

export interface Budget {
  readonly type: PayType;
  readonly min: number;
  readonly max: number;
  readonly currency: string;
  readonly excerpt: string;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { '$': 'USD', 'us$': 'USD', '€': 'EUR', '£': 'GBP' };
const AMOUNT = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
const SYMBOL = 'US\\$|\\$|€|£';
const CODE = 'USD|EUR|GBP|CAD|AUD|SGD';
const UNIT = '(?:\\s*(?:\\/|per|an|a)\\s*(hr|hour|h|week|wk|month|mo)\\b)?';
const PREFIXED = new RegExp(`(${SYMBOL}|${CODE})\\s?(${AMOUNT})(\\s?[kK]\\b)?(?:\\s*(?:-|–|—|to)\\s*(?:${SYMBOL}|${CODE})?\\s?(${AMOUNT})(\\s?[kK]\\b)?)?${UNIT}`, 'gi');
const SUFFIXED = new RegExp(`(${AMOUNT})(\\s?[kK]\\b)?(?:\\s*(?:-|–|—|to)\\s*(${AMOUNT})(\\s?[kK]\\b)?)?\\s?(${CODE})\\b${UNIT}`, 'gi');
const BUDGET_CONTEXT = /\b(?:budget|rate|pay|paying|paid|compensation|hourly|fixed|price|salary|offer|offering|per hour|fee|cost)\b|\/\s?(?:hr|hour|h)\b/i;

function scaled(amount: string, suffix: string | undefined): number {
  const n = Number(amount.replace(/,/g, ''));
  return suffix !== undefined && suffix.trim() !== '' ? n * 1000 : n;
}

function currencyOf(token: string): string {
  return CURRENCY_SYMBOLS[token.toLowerCase()] ?? token.toUpperCase();
}

function typeOf(unit: string | undefined, sentence: string): PayType {
  const u = unit?.toLowerCase();
  if (u === 'hr' || u === 'hour' || u === 'h') return 'hourly';
  if (u !== undefined) return 'unknown'; // per week or per month: not comparable with a total or an hourly rate
  if (/\bhourly\b|\bper hour\b|\/\s?(?:hr|hour|h)\b/i.test(sentence)) return 'hourly';
  if (/\bfixed\b|\btotal\b|\bone[- ]time\b|\bproject budget\b|\bbudget\b|\bflat\b/i.test(sentence)) return 'fixed';
  return 'unknown';
}

/** The first money mention that sits in a pay-related sentence. Currency symbols default to USD. */
export function extractBudget(sentences: readonly Sentence[]): Budget | undefined {
  for (const sentence of sentences) {
    for (const money of findMoney(sentence.text)) {
      const type = typeOf(money.unit, sentence.text);
      if (money.max > 0 && (BUDGET_CONTEXT.test(sentence.text) || type === 'hourly')) {
        return { type, min: money.min, max: money.max, currency: money.currency, excerpt: truncate(money.excerpt, 80) };
      }
    }
  }
  return undefined;
}

export interface Money {
  readonly min: number;
  readonly max: number;
  readonly currency: string;
  readonly unit: string | undefined;
  readonly index: number;
  readonly excerpt: string;
}

/** Every money mention in `text`, in reading order ("$40", "30-50 EUR/hr", "£2.5k"). */
export function findMoney(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(PREFIXED)) {
    const min = scaled(m[2] as string, m[3]);
    const max = m[4] === undefined ? min : scaled(m[4], m[5]);
    out.push({ min: Math.min(min, max), max: Math.max(min, max), currency: currencyOf(m[1] as string), unit: m[6]?.toLowerCase(), index: m.index ?? 0, excerpt: m[0].trim() });
  }
  for (const m of text.matchAll(SUFFIXED)) {
    const min = scaled(m[1] as string, m[2]);
    const max = m[3] === undefined ? min : scaled(m[3], m[4]);
    out.push({ min: Math.min(min, max), max: Math.max(min, max), currency: currencyOf(m[5] as string), unit: m[6]?.toLowerCase(), index: m.index ?? 0, excerpt: m[0].trim() });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------- duration

export interface Duration {
  readonly minDays: number;
  readonly maxDays: number;
  readonly excerpt: string;
}

const WORD_NUMBER: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const DURATION = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)(?:\s*(?:-|–|to)\s*(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve))?\s*\+?\s*(days?|weeks?|months?)\b/i;
const DURATION_CONTEXT = /\b(?:duration|timeline|deadline|within|next|over|lasting|long|complete|completed|deliver|delivered|done|finish|finished|estimated|expected|term|contract|project length|ready|launch)\b/i;

function numberOf(token: string): number {
  return WORD_NUMBER[token.toLowerCase()] ?? Number(token);
}

/** Project length from phrases like "2-3 months", "within two weeks", "estimated duration: 6 weeks". */
export function extractDuration(sentences: readonly Sentence[]): Duration | undefined {
  for (const sentence of sentences) {
    if (!DURATION_CONTEXT.test(sentence.text)) continue;
    const m = DURATION.exec(sentence.text);
    if (m === null) continue;
    const unit = (m[3] as string).toLowerCase();
    const perUnit = unit.startsWith('day') ? 1 : unit.startsWith('week') ? 7 : 30;
    const low = numberOf(m[1] as string);
    const high = m[2] === undefined ? low : numberOf(m[2]);
    return { minDays: Math.min(low, high) * perUnit, maxDays: Math.max(low, high) * perUnit, excerpt: truncate(m[0], 60) };
  }
  return undefined;
}

// ---------------------------------------------------------------- attachments

export type AttachmentKind = 'video' | 'portfolio' | 'code-samples' | 'resume' | 'references' | 'test-task';

const ATTACHMENT_PATTERNS: readonly (readonly [AttachmentKind, RegExp])[] = [
  ['video', /\b(?:video (?:intro\w*|message|pitch|call|introduction|response)|loom|record(?:ed|ing)? (?:a |an )?(?:short |quick )?(?:video|screen)|short video|screen ?recording)\b/i],
  ['portfolio', /\b(?:portfolio|previous work|past work|work samples?|samples? of (?:your )?(?:previous |past )?work|case stud(?:y|ies))\b/i],
  ['code-samples', /\b(?:github (?:profile|link|repo\w*|account)|link to your github|code samples?|sample code|repositor(?:y|ies) link)\b/i],
  ['resume', /\b(?:resume|résumé|cv|curriculum vitae)\b/i],
  ['references', /\b(?:references?|testimonials?)\b(?! to)/i],
  ['test-task', /\b(?:test task|coding (?:test|challenge|exercise)|take-?home|trial task|sample task|skills? test|technical test|short test|paid test)\b/i],
];

export interface Attachment {
  readonly kind: AttachmentKind;
  readonly excerpt: string;
}

/** Things the post asks the applicant to include or do before being hired. */
export function extractAttachments(sentences: readonly Sentence[]): Attachment[] {
  const out: Attachment[] = [];
  for (const [kind, pattern] of ATTACHMENT_PATTERNS) {
    const hit = sentences.find((s) => pattern.test(s.text));
    if (hit !== undefined) out.push({ kind, excerpt: truncate(hit.text, 140) });
  }
  return out;
}

// ---------------------------------------------------------------- client asks

export interface ClientAsk {
  readonly kind: 'question' | 'request';
  readonly text: string;
}

const REQUEST = /^(?:please\s+)?(?:tell|describe|explain|share|answer|include|mention|provide|send|attach|let (?:us|me) know|give|list)\b/i;

/** Questions and explicit asks addressed to applicants. Surfaced for the human; never answered by the tool. */
export function extractClientAsks(sentences: readonly Sentence[]): ClientAsk[] {
  const out: ClientAsk[] = [];
  for (const sentence of sentences) {
    const words = sentence.text.split(/\s+/).length;
    if (sentence.text.endsWith('?') && words >= 3) out.push({ kind: 'question', text: truncate(sentence.text, 200) });
    else if (REQUEST.test(sentence.text) && words >= 3) out.push({ kind: 'request', text: truncate(sentence.text, 200) });
    if (out.length >= 12) break;
  }
  return out;
}

// ---------------------------------------------------------------- restrictions

export interface LocationRestriction {
  /** only: applicants must be in these places; excluding: applicants from these places are not accepted; preferred: soft. */
  readonly mode: 'only' | 'excluding' | 'preferred';
  /** Strong cues ("only", "must be located in", "residents") are firm requirements. */
  readonly strong: boolean;
  readonly places: readonly string[];
  readonly excerpt: string;
}

const EXCLUDING = /\b(?:not open to|(?:cannot|can't|can not|do not|don't|unable to|won't|will not) (?:accept|hire|consider|work with)|no (?:applicants|candidates|freelancers|developers|agencies) from|excluding|except(?: for)?|outside of)\b/i;
const STRONG_ONLY =
  /\b(?:only|must (?:be|live|reside|work)|have to be|need to be|required to be|residents?|citizens?|citizenship|work authori[sz]ation|right to work)\b/i;
const CANDIDATE_WORD = /\b(?:candidates?|applicants?|freelancers?|contractors?|developers?|engineers?|talent|you|team members?|professionals?|designers?|writers?)\b/i;
const WEAK_ONLY = /\b(?:based in|located in|living in|from|within|preferred|preference|ideally)\b|-based\b/i;

export function extractLocationRestriction(sentences: readonly Sentence[]): LocationRestriction | undefined {
  for (const sentence of sentences) {
    if (sentence.mode === 'ignore') continue;
    const places = findPlaces(sentence.text);
    if (places.length === 0) continue;
    const ids = [...new Set(places.map((p) => p.id))];
    const excerpt = truncate(sentence.text, 140);
    if (EXCLUDING.test(sentence.text)) return { mode: 'excluding', strong: true, places: ids, excerpt };
    const placeOnly = /\b(?:only|exclusively)\b/i.test(sentence.text) && /(?:^|\b)(?:\w+\s+)?(?:only|exclusively)\b/i.test(sentence.text);
    const strong = STRONG_ONLY.test(sentence.text) && (placeOnly || CANDIDATE_WORD.test(sentence.text) || /\bresidents?|citizens?\b/i.test(sentence.text));
    if (strong) return { mode: 'only', strong: true, places: ids, excerpt };
    if (WEAK_ONLY.test(sentence.text) && CANDIDATE_WORD.test(sentence.text)) {
      return { mode: /\b(?:preferred|preference|ideally)\b/i.test(sentence.text) ? 'preferred' : 'only', strong: false, places: ids, excerpt };
    }
  }
  return undefined;
}

export interface TimezoneRequirement {
  /** UTC offset in hours of the zone the client works in. */
  readonly offset: number;
  readonly label: string;
  readonly excerpt: string;
}

const ZONE_WORDS: readonly (readonly [RegExp, number, string])[] = [
  [/\bus (?:time ?zones?|hours|business hours|working hours)\b/i, -6, 'US hours'],
  [/\bpacific(?: standard| daylight)? (?:time|hours|time ?zone)\b/i, -8, 'Pacific time'],
  [/\beastern(?: standard| daylight)? (?:time|hours|time ?zone)\b/i, -5, 'Eastern time'],
  [/\bcentral (?:standard |daylight )?(?:time|hours) \(?(?:us|usa|america)\b|\bcentral time\b/i, -6, 'Central time'],
  [/\bmountain(?: standard| daylight)? (?:time|hours|time ?zone)\b/i, -7, 'Mountain time'],
  [/\b(?:european|eu|europe) (?:time ?zones?|hours|business hours|working hours)\b/i, 1, 'European hours'],
  [/\b(?:australian|aus|australia) (?:time ?zones?|hours|business hours)\b/i, 10, 'Australian hours'],
  [/\b(?:uk|british) (?:time ?zones?|hours|business hours)\b/i, 0, 'UK hours'],
];
const OVERLAP_CONTEXT = /\b(?:overlap|available|availability|working hours|core hours|business hours|online|time ?zone|hours|standup|meetings?|sync|calls?)\b/i;
const ZONE_ABBR = new RegExp(`\\b(${ZONE_ABBREVIATIONS.join('|').toUpperCase()})\\b`);
const UTC_OFFSET = /\b(?:UTC|GMT)\s?[+-]\s?\d{1,2}(?::?\d{2})?\b/;

export function extractTimezoneRequirement(sentences: readonly Sentence[]): TimezoneRequirement | undefined {
  for (const sentence of sentences) {
    if (sentence.mode === 'ignore' || !OVERLAP_CONTEXT.test(sentence.text)) continue;
    const excerpt = truncate(sentence.text, 140);
    const utc = UTC_OFFSET.exec(sentence.text);
    if (utc !== null) {
      const offset = parseUtcOffset(utc[0].replace(/\s+/g, ''));
      if (offset !== undefined) return { offset, label: utc[0], excerpt };
    }
    const abbr = ZONE_ABBR.exec(sentence.text);
    if (abbr !== null) {
      const offset = zoneOffset(abbr[1] as string);
      if (offset !== undefined) return { offset, label: abbr[1] as string, excerpt };
    }
    for (const [pattern, offset, label] of ZONE_WORDS) if (pattern.test(sentence.text)) return { offset, label, excerpt };
  }
  return undefined;
}
