import { findTechs, techById } from '../dictionary/tech.js';
import type { Mode, Sentence } from './sentences.js';
import { truncate } from '../shared/text.js';

export type Priority = 'must' | 'nice';
export type RequirementKind = 'tech' | 'experience' | 'language' | 'availability' | 'location' | 'timezone';

export interface Requirement {
  /** Stable id derived from the content, e.g. `tech:react`, `exp:5`, `lang:english`. */
  readonly id: string;
  readonly kind: RequirementKind;
  readonly label: string;
  readonly priority: Priority;
  readonly techId?: string;
  readonly years?: number;
  readonly hoursPerWeek?: number;
  readonly language?: string;
  /** Why this priority was chosen: the cue phrase, the section heading or "default". Shown in the report. */
  readonly cue: string;
  /** The sentence the requirement came from, truncated. */
  readonly source: string;
}

const NICE_CUE =
  /\b(?:nice[- ]to[- ]have|a plus|is a plus|are a plus|bonus|preferred|preferably|ideally|would be (?:great|nice|a plus|an advantage)|desirable|familiarity|optional|not required|not mandatory|not necessary|extra points|good to have|an advantage|an asset|helpful)\b/gi;
const MUST_CUE =
  /\b(?:must|required|requires?|requirement|needs? to|needed|essential|mandatory|have to|you have|you will have|proven|strong|solid|expert|hands-on|extensive|minimum|at least|deep)\b/gi;

interface Cue {
  readonly priority: Priority;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function cuesIn(text: string): Cue[] {
  const nice: Cue[] = [...text.matchAll(NICE_CUE)].map((m) => ({ priority: 'nice', start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }));
  const must: Cue[] = [...text.matchAll(MUST_CUE)]
    .map((m): Cue => ({ priority: 'must', start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }))
    .filter((c) => !nice.some((n) => c.start < n.end && n.start < c.end));
  return [...nice, ...must];
}

/** The cue closest to `position` wins; without a cue the section decides; a plain section means "must". */
export function priorityAt(sentence: Sentence, position: number): { priority: Priority; cue: string } | undefined {
  if (sentence.mode === 'ignore') return undefined;
  const cues = cuesIn(sentence.text);
  const clause = clauseAround(sentence.text, position);
  const inClause = cues.filter((c) => c.start >= clause.start && c.end <= clause.end);
  const best = nearest(inClause.length > 0 ? inClause : cues, position, inClause.length > 0 ? Number.POSITIVE_INFINITY : 60);
  if (best !== undefined) return { priority: best.priority, cue: best.text.toLowerCase() };
  return sectionPriority(sentence.mode, sentence.heading);
}

/** The comma- or semicolon-delimited stretch of the sentence that contains `position`. */
function clauseAround(text: string, position: number): { start: number; end: number } {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(/[;,]/g)) {
    const at = m.index ?? 0;
    if (at < position) start = at + 1;
    else {
      end = at;
      break;
    }
  }
  return { start, end };
}

function nearest(cues: readonly Cue[], position: number, maxDistance: number): Cue | undefined {
  let best: Cue | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    const distance = position < cue.start ? cue.start - position : position > cue.end ? position - cue.end : 0;
    if (distance < bestDistance) {
      best = cue;
      bestDistance = distance;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

function sectionPriority(mode: Mode, heading: string | undefined): { priority: Priority; cue: string } {
  if (mode === 'nice') return { priority: 'nice', cue: `section "${heading ?? 'nice to have'}"` };
  if (mode === 'must') return { priority: 'must', cue: `section "${heading ?? 'requirements'}"` };
  return { priority: 'must', cue: 'default' };
}

const NEGATION = /\b(?:no|not|without|never|don't|do not|doesn't|does not|avoid|except)\s+(?:(?!only\b)\w+\s+){0,3}$/i;

function isNegated(sentence: string, index: number): boolean {
  return NEGATION.test(sentence.slice(Math.max(0, index - 40), index));
}

const WORD_NUMBER: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, twenty: 20,
};
const NUMBER = '\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty';
const YEARS = new RegExp(`\\b(${NUMBER})\\s*\\+?\\s*(?:(?:-|–|to)\\s*(?:${NUMBER})\\s*\\+?\\s*)?(?:years?|yrs?)\\b(?!\\s+old)`, 'gi');

function toNumber(text: string): number {
  return WORD_NUMBER[text.toLowerCase()] ?? Number(text);
}

const LANGUAGES = 'english|spanish|german|french|portuguese|italian|dutch|russian|chinese|mandarin|japanese|korean|arabic|hindi|vietnamese|polish|turkish|ukrainian';
const LANGUAGE_BEFORE = new RegExp(
  `\\b(?:fluent|fluency|native|proficient|proficiency|good|strong|excellent|advanced|professional|business|written|spoken|verbal|conversational|perfect)\\s+(?:in\\s+|level\\s+)?(?:written\\s+and\\s+spoken\\s+|spoken\\s+and\\s+written\\s+)?(${LANGUAGES})\\b`,
  'gi',
);
const LANGUAGE_AFTER = new RegExp(`\\b(${LANGUAGES})(?:[ -]speaking|\\s+speaker|\\s+communication|\\s+proficiency|\\s+skills|\\s+fluency|\\s+required|\\s+only)\\b`, 'gi');

const HOURS = /\b(\d{1,2})\s*(?:(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:hours?|hrs?)\s*(?:per|a|\/|each|every)\s*(?:week|wk)\b/i;

export function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Extracts technology, experience, language and availability requirements from the sentences of a post. */
export function extractRequirements(sentences: readonly Sentence[]): Requirement[] {
  const found = new Map<string, Requirement>();
  const consider = (candidate: Requirement): void => {
    const existing = found.get(candidate.id);
    if (existing === undefined) {
      found.set(candidate.id, candidate);
      return;
    }
    const merged: Requirement = {
      ...(existing.priority === 'nice' && candidate.priority === 'must' ? candidate : existing),
      ...(existing.years !== undefined || candidate.years !== undefined
        ? { years: Math.max(existing.years ?? 0, candidate.years ?? 0) }
        : {}),
    };
    found.set(candidate.id, merged);
  };

  for (const sentence of sentences) {
    if (sentence.mode === 'ignore') continue;
    const text = sentence.text;
    const source = truncate(text, 140);
    const techs = findTechs(text).filter((m) => !isNegated(text, m.index));

    for (const tech of techs) {
      const verdict = priorityAt(sentence, tech.index);
      if (verdict === undefined) continue;
      consider({
        id: `tech:${tech.id}`,
        kind: 'tech',
        label: (techById(tech.id) as NonNullable<ReturnType<typeof techById>>).label,
        priority: verdict.priority,
        techId: tech.id,
        cue: verdict.cue,
        source,
      });
    }

    for (const m of text.matchAll(YEARS)) {
      const years = toNumber(m[1] as string);
      if (!(years >= 1)) continue;
      const end = (m.index ?? 0) + m[0].length;
      const after = techs.find((t) => t.index >= end && t.index - end <= 45);
      const before = [...techs].reverse().find((t) => t.index + t.length <= (m.index ?? 0) && (m.index ?? 0) - (t.index + t.length) <= 30);
      const target = after ?? before;
      if (target !== undefined) {
        const verdict = priorityAt(sentence, target.index);
        if (verdict === undefined) continue;
        consider({
          id: `tech:${target.id}`,
          kind: 'tech',
          label: (techById(target.id) as NonNullable<ReturnType<typeof techById>>).label,
          priority: verdict.priority,
          techId: target.id,
          years,
          cue: verdict.cue,
          source,
        });
      } else {
        const verdict = priorityAt(sentence, m.index ?? 0);
        if (verdict === undefined) continue;
        consider({
          id: `exp:${years}`,
          kind: 'experience',
          label: `${years}+ years of relevant experience`,
          priority: verdict.priority,
          years,
          cue: verdict.cue,
          source,
        });
      }
    }

    for (const pattern of [LANGUAGE_BEFORE, LANGUAGE_AFTER]) {
      for (const m of text.matchAll(pattern)) {
        const verdict = priorityAt(sentence, m.index ?? 0);
        if (verdict === undefined) continue;
        const language = (m[1] as string).toLowerCase();
        consider({ id: `lang:${language}`, kind: 'language', label: titleCase(language), priority: verdict.priority, language, cue: verdict.cue, source });
      }
    }

    const hours = HOURS.exec(text);
    const fullTime = /\bfull[- ]time\b/i.exec(text);
    const partTime = /\bpart[- ]time\b/i.exec(text);
    const availability =
      hours !== null
        ? { hoursPerWeek: Number(hours[1]), at: hours.index }
        : fullTime !== null
          ? { hoursPerWeek: 40, at: fullTime.index }
          : partTime !== null
            ? { hoursPerWeek: 20, at: partTime.index }
            : undefined;
    if (availability !== undefined && availability.hoursPerWeek > 0 && availability.hoursPerWeek <= 80) {
      const verdict = priorityAt(sentence, availability.at);
      if (verdict !== undefined) {
        consider({
          id: 'avail',
          kind: 'availability',
          label: `${availability.hoursPerWeek} hours per week`,
          priority: verdict.priority,
          hoursPerWeek: availability.hoursPerWeek,
          cue: verdict.cue,
          source,
        });
      }
    }
  }
  return [...found.values()];
}
