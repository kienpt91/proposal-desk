// What a sentence of a proposal claims about the author. Deterministic, pattern-based, and deliberately narrow:
// it only has to separate "I have no experience with X" (an honest gap) from everything that asserts something.
//
// A negation word does not exempt a sentence. It exempts a *technology mention* only when a negator that is tied to
// an experience word ("no verified experience with", "have not worked with", "new to") sits in the same clause, before
// the mention, and no scope-breaking word ("but", "however", "and I built", ";") comes in between.

export const FIRST_PERSON = /\b(?:i|i'm|i've|i'd|i'll|my|me|we|we've|our|mine)\b/i;

const VERBS =
  'built|shipped|led|lead|delivered|managed|designed|developed|worked|launched|created|implemented|maintained|architected|scaled|optimi[sz]ed|reduced|increased|saved|grew|written|wrote|deployed|migrated|founded|ran|run|operated|operate|owned|mentored|taught|trained|authored|published|won|earned|received|hold|holds|held|graduated|studied|served|joined|handled|supported|contributed|coded|programmed|tested|debugged|configured|automated|integrated|refactored|rebuilt|mastered|speak|spoke|know|learned';
/** "I built", "I have shipped", "we also led" ... */
const ACTION = new RegExp(`\\b(?:i|we)(?:'ve|'d)?(?:\\s+(?:have|had|also|previously|once|recently|already|successfully|personally))*\\s+(?:${VERBS})\\b`, 'i');
const SELF_DESCRIPTION = /\b(?:i am|i'm|we are|we're)\s+(?:an?\s+|the\s+)?(?:experienced|skilled|seasoned|senior|junior|proficient|expert|specialist|professional|certified|fluent|qualified|accomplished|trained|licensed)\b/i;
const EXPERIENCE_TALK = /\bmy\s+(?:experience|expertise|background|track record|portfolio|skills|career|degree|work)\b|\bexperience\s+(?:with|in|of)\b|\byears?\s+of\s+(?:experience|work)\b/i;
/** Titles, degrees, awards, employers and the like: facts about the author that no fact in the base supports. */
const CREDENTIAL =
  /\b(?:ph\.?d|doctorate|master'?s|bachelor'?s|m\.?sc|b\.?sc|mba|degree|diploma|certified|certification|certificate|award(?:ed|s)?|prize|patents?|patented|publications?|alumni|alumnus|graduate[ds]?|former|formerly|previously|ex-[a-z]+|lead engineer|principal engineer|staff engineer|cto|ceo|cfo|founder|co-?founder|vp of|director of|head of|fellowship|fellow|laureate|turing)\b/i;

/**
 * Phrases of intent or interest ("would love to talk about", "happy to start with") that say nothing about what the author has done.
 * A mention after one of them is not a claim unless the text in between asserts something ("would love to explain how I built").
 */
const INTENT =
  /\b(?:would\s+love\s+to|love\s+to|happy\s+to|glad\s+to|keen\s+to|interested\s+in|curious\s+about|looking\s+forward\s+to|excited\s+(?:about|to)|want\s+to|like\s+to|would\s+like\s+to|plan\s+to|hope\s+to|ready\s+to|can\s+start|talk\s+about|discuss)\b/i;

export function isIntentMention(text: string, index: number): boolean {
  const scope = scopeAround(text, index);
  const before = scope.text.slice(0, index - scope.start);
  const intent = INTENT.exec(before);
  return intent !== null && !claimsSomething(before.slice(intent.index + intent[0].length));
}

/** Verbs that, when the author is the subject, describe a past or present fact about the author. */
export function claimsSomething(text: string): boolean {
  return ACTION.test(text) || SELF_DESCRIPTION.test(text) || EXPERIENCE_TALK.test(text) || CREDENTIAL.test(text);
}

/** A first-person negation scoping a verb: "I have not worked with", "we do not have", "I have no". */
const FIRST_PERSON_GAP = /\b(?:i|we)(?:'ve)?\s+(?:(?:have|has|had|do|did|am|are|was|were|will|would|can|could)\s+)?(?:not|never|no)\b|\b(?:i|we)\s+(?:don't|do not|haven't|have not|didn't|did not|won't|will not|can't|cannot)\b|^\s*(?:limited|little|no|without)\b/i;

const NOT_A_GAP =
  /\b(?:not\s+(?:only|just|merely|simply|even|once)|no\s+(?:problem|problems|doubt|doubts|issue|issues|trouble|worries|hesitation|matter)|not\s+a\s+problem|nothing\s+but|never\s+mind|not\s+afraid|not\s+shy)\b/i;

/** Where a negator's scope ends: a contrast, a new clause with its own subject or verb, or a stronger punctuation mark. */
const SCOPE_BREAK =
  /\b(?:but|however|although|though|while|whereas|yet|except|instead|rather|and\s+(?:i|we|also|have|had|built|shipped|led|delivered|managed|designed|developed|worked|launched|created|implemented|maintained|architected|scaled|deployed|migrated))\b|[;:!?]|\.(?=\s|$)/gi;

/** A negator tied to an experience word, reading left to right inside one scope. */
const NEGATED_EXPERIENCE =
  /\b(?:no|not|never|without|limited|little|lack(?:s|ing)?\s+of|haven't|have\s+not|hasn't|don't|do\s+not|didn't|did\s+not|new\s+to|unfamiliar\s+with)\b[^.;:!?]{0,50}?\b(?:experience|exposure|knowledge|background|familiarity|expertise|worked|work|used|use|built|build|shipped|touched|claim|claimed|claiming|proficien\w+|skills?|production|hands-on|to)\b|\b(?:new\s+to|unfamiliar\s+with)\b/i;

/** The scope (clause) around `index`: from the last scope break before it to the next one after it. */
export function scopeAround(text: string, index: number): { readonly start: number; readonly text: string } {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(SCOPE_BREAK)) {
    const at = m.index ?? 0;
    if (at + m[0].length <= index) start = at + m[0].length;
    else if (at >= index) {
      end = at;
      break;
    }
  }
  return { start, text: text.slice(start, end) };
}

/**
 * True when the mention at `index` is something the author says they do NOT have experience with: a negator tied to an
 * experience word stands in the same clause and comes before the mention.
 */
export function isNegatedMention(text: string, index: number): boolean {
  const scope = scopeAround(text, index);
  const negation = NEGATED_EXPERIENCE.exec(scope.text);
  if (negation === null || NOT_A_GAP.test(scope.text)) return false;
  return scope.start + negation.index < index;
}

/**
 * Splits a sentence into clauses at the same boundaries that end a negation's scope (contrast words, a new subject,
 * semicolons), so a gap statement and a claim in one sentence are judged separately.
 */
export function clausesOf(sentence: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const m of sentence.matchAll(SCOPE_BREAK)) {
    const at = m.index ?? 0;
    const isMark = m[0].length === 1;
    parts.push(sentence.slice(start, at));
    start = isMark ? at + 1 : at;
  }
  parts.push(sentence.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** An honest statement that the author does NOT have something ("I have no verified experience with Redis"). */
export function isGapClause(clause: string): boolean {
  return FIRST_PERSON_GAP.test(clause) && !NOT_A_GAP.test(clause) && NEGATED_EXPERIENCE.test(clause);
}
