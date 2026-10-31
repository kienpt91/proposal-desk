import { splitSentences } from '../shared/text.js';

export type Mode = 'must' | 'nice' | 'neutral' | 'ignore';

export interface Sentence {
  readonly text: string;
  /** The section the sentence sits in, from the nearest heading. */
  readonly mode: Mode;
  readonly heading: string | undefined;
  /** Position in reading order. */
  readonly order: number;
}

const MUST_HEADING = /\b(?:requirements?|must[- ]haves?|required|qualifications?|what you(?:'| wi)?ll need|what we(?:'|’)re looking for|you have|about you|essential|skills (?:needed|required)|responsibilit\w+ and skills)\b/i;
const NICE_HEADING = /\b(?:nice[- ]to[- ]haves?|bonus|preferred|a plus|optional|good to have|desirable|extras?)\b/i;
const IGNORE_HEADING = /\b(?:benefits|perks|about us|about the company|about our company|who we are|how to apply|what we offer|our values|equal opportunity)\b/i;

export function modeOfHeading(heading: string): Mode {
  if (NICE_HEADING.test(heading)) return 'nice';
  if (IGNORE_HEADING.test(heading)) return 'ignore';
  if (MUST_HEADING.test(heading)) return 'must';
  return 'neutral';
}

const KNOWN_HEADING =
  /^(?:the\s+)?(?:about us|about the company|about our company|who we are|our values|benefits|perks|how to apply|what we offer|requirements?|must[- ]haves?|nice[- ]to[- ]haves?|bonus(?: points)?|qualifications?|responsibilities|preferred skills|required skills|about the role|the role|the project|about the project|project overview|what you(?:'|’)?ll do|what you will do|what you(?:'|’)?ll need|about you|overview|description)$/i;

function headingOf(line: string): string | undefined {
  const t = line.trim();
  if (KNOWN_HEADING.test(t)) return t;
  if (/^[-*•·]\s|^\d+[.)]\s/.test(t)) return undefined;
  const stripped = t.replace(/^#{1,6}\s*/, '').replace(/^\*\*(.+?)\*\*:?$/, '$1');
  if (/^#{1,6}\s/.test(t)) return stripped.replace(/:$/, '');
  if (stripped.endsWith(':') && stripped.length <= 60 && !/[.?!]\s/.test(stripped)) return stripped.slice(0, -1);
  if (/^[A-Z][A-Z &/'-]{3,50}$/.test(stripped)) return stripped;
  return undefined;
}

const INLINE_LABEL = /^(requirements?|must[- ]haves?|required(?: skills)?|nice[- ]to[- ]haves?|bonus|preferred(?: skills)?|qualifications?)\s*[:-]\s+(\S.*)$/i;

/** Splits a post into sentences, each tagged with the section mode (must / nice / neutral / ignore). */
export function toSentences(body: string): Sentence[] {
  const out: Sentence[] = [];
  let mode: Mode = 'neutral';
  let heading: string | undefined;
  let contentSinceHeading = 0;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const trimmed = line.trim();
    if (trimmed === '') {
      const next = lines.slice(i + 1).find((l) => l.trim() !== '');
      const nextIsBullet = next !== undefined && /^\s*(?:[-*•·]\s|\d+[.)]\s)/.test(next);
      if (contentSinceHeading > 0 && !nextIsBullet && next !== undefined && headingOf(next) === undefined) {
        mode = 'neutral';
        heading = undefined;
      }
      continue;
    }
    const head = headingOf(line);
    if (head !== undefined) {
      mode = modeOfHeading(head);
      heading = head;
      contentSinceHeading = 0;
      continue;
    }
    let content = trimmed.replace(/^(?:[-*•·]|\d+[.)])\s+/, '');
    let lineMode: Mode = mode;
    let lineHeading: string | undefined = heading;
    const inline = INLINE_LABEL.exec(content);
    if (inline !== null) {
      lineMode = modeOfHeading(inline[1] as string);
      lineHeading = inline[1] as string;
      content = inline[2] as string;
      mode = lineMode;
      heading = lineHeading;
      contentSinceHeading = 0;
    }
    contentSinceHeading++;
    for (const sentence of splitSentences(content)) {
      out.push({ text: sentence, mode: lineMode, heading: lineHeading, order: out.length });
    }
  }
  return out;
}
