import { foldForMatch } from '../shared/text-safety.js';

// Phrase lists behind the "no boilerplate, no exaggeration" rules. Matching is case-insensitive
// on word boundaries. The lists are data: extend them here, tests keep them well-formed.

/** Openers and filler that clients skim past; also a sign of a template that was not read. */
export const BOILERPLATE_PHRASES: readonly string[] = [
  'i am writing to apply',
  'i am writing to express',
  'i came across your',
  'i saw your job',
  'i saw your post',
  'dear sir',
  'dear madam',
  'dear hiring manager',
  'dear client',
  'dear sir/madam',
  'to whom it may concern',
  'greetings of the day',
  'hope this message finds you well',
  'hope you are doing well',
  'i am very interested in your project',
  'i am interested in your job',
  'i am excited to apply',
  'please check my profile',
  'check my portfolio',
  'i have gone through your',
  'i have read your job description',
  'i can do this job',
  'i am the right person',
  'right place',
  'i am confident that i can',
  'looking forward to hearing from you',
];

/** Words that assert quality or certainty without evidence. Allowed only when a verified fact uses the word. */
export const SUPERLATIVE_TERMS: readonly string[] = [
  'best',
  'perfect',
  'perfectly',
  'world-class',
  'world class',
  'top-notch',
  'top notch',
  'top-rated',
  'top rated',
  'unmatched',
  'unbeatable',
  'second to none',
  'number one',
  'guaranteed',
  'guarantee',
  'flawless',
  'flawlessly',
  'rockstar',
  'rock star',
  'ninja',
  'guru',
  'genius',
  'expert',
  'experts',
  'cheapest',
  'lowest price',
  'amazing',
  'incredible',
  'outstanding',
  'unparalleled',
  '10x',
];

/** Text addressed to software that reads the post (an assistant, a scraper, an agent). Never obeyed; flagged. */
export const AUTOMATION_DIRECTIVES: readonly RegExp[] = [
  /\bignore\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,30}\b(?:instructions?|prompts?|rules?|messages?)\b/i,
  /\bdisregard\b[^.\n]{0,40}\b(?:instructions?|rules?|prompts?)\b/i,
  /\bforget\b[^.\n]{0,30}\b(?:everything|instructions?|rules?)\b/i,
  /\b(?:system|developer) prompt\b/i,
  /\byou are now\b/i,
  /\bas an? (?:ai|language model|assistant)\b/i,
  /\b(?:new|updated) instructions?\b/i,
  /\b(?:ai|bot|llm|assistant|automated)\b[^.\n]{0,30}\b(?:reading|reads|read) this\b/i,
];

/** Instructions about what a proposal must contain. Legitimate screening, but never followed automatically. */
export const SCREENING_INSTRUCTIONS: readonly RegExp[] = [
  /\b(?:begin|start|open) (?:your|the) (?:proposal|reply|response|answer|cover letter|message) with\b/i,
  /\binclude the (?:word|phrase|code|secret)\b/i,
  /\bin your (?:proposal|reply|response|cover letter)\b[^.\n]{0,40}\b(?:mention|include|write|say|state|put)\b/i,
  /\bwrite (?:the )?(?:word|phrase)\b/i,
  /\bmention (?:the )?(?:code ?word|passphrase|secret word|keyword)\b/i,
];

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PHRASE_PATTERNS = new Map<string, RegExp>();

function patternFor(phrase: string): RegExp {
  let re = PHRASE_PATTERNS.get(phrase);
  if (re === undefined) {
    re = new RegExp(`(?<![A-Za-z0-9])${escapeForRegex(phrase)}(?![A-Za-z0-9])`, 'i');
    PHRASE_PATTERNS.set(phrase, re);
  }
  return re;
}

/** Returns the phrases from `list` found in `text` (each at most once), in list order. */
export function findPhrases(text: string, list: readonly string[]): string[] {
  const folded = foldForMatch(text);
  return list.filter((phrase) => patternFor(phrase).test(folded));
}

/** Returns the excerpt of the first automation directive found, or undefined. */
export function findAutomationDirective(text: string): string | undefined {
  const folded = foldForMatch(text);
  for (const pattern of AUTOMATION_DIRECTIVES) {
    const m = pattern.exec(folded);
    if (m !== null) return m[0];
  }
  return undefined;
}

/** Superlatives in `text`; the compounds "best practice(s)" and "best effort" are ordinary engineering terms. */
export function findSuperlatives(text: string): string[] {
  return findPhrases(foldForMatch(text).replace(/\bbest[ -](?:practices?|effort)\b/gi, ' '), SUPERLATIVE_TERMS);
}
