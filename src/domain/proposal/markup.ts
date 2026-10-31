// Reading a proposal file. A file may be the bare proposal or the tool's audit view (proposal, "## Provenance",
// "## Review notes"). Only the proposal text is verified, approved and exported, so it has to be extracted the same
// way everywhere: `proposalParts` reaches a fixed point (extracting twice changes nothing), which is what lets
// the verifier, `approve` and `export` agree on exactly which string is the proposal.
//
// All scans are linear or bounded: no regular expression here can backtrack on unclosed markup.

export interface ProposalParts {
  /** The proposal text: emphasis, comments, footnote markers, link syntax and list/quote prefixes removed, tail cut. */
  readonly body: string;
  /** Lines after the first Provenance / Review notes heading or footnote definition, which are not part of the proposal. */
  readonly tail: readonly string[];
  /** HTML comments (invisible when rendered, present in the raw text). */
  readonly comments: readonly string[];
  /** False when markup kept changing the text for the whole iteration budget; such a file is refused. */
  readonly stable: boolean;
}

const MAX_PASSES = 8;
const MAX_LINK_TEXT = 300;
const MAX_LINK_TARGET = 600;
const MAX_MARKER = 64;
const CUT_LINE = /^#{1,6}\s*(?:provenance|review notes)\b|^\[\^[^\]]{1,64}\]:/i;

function removeComments(text: string, found: string[]): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    if (open === -1) break;
    const close = text.indexOf('-->', open + 4);
    if (close === -1) {
      out += text.slice(at, open);
      found.push(text.slice(open + 4, open + 84));
      at = text.length; // an unclosed comment hides the rest of the file: drop it and report it
      break;
    }
    out += text.slice(at, open);
    found.push(text.slice(open + 4, Math.min(close, open + 84)));
    at = close + 3;
  }
  return out + text.slice(at);
}

function removeFootnoteMarkers(text: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('[^', at);
    if (open === -1) break;
    const close = text.indexOf(']', open + 2);
    if (close === -1 || close - open > MAX_MARKER || text.slice(open + 2, close).includes('\n')) {
      out += text.slice(at, open + 2);
      at = open + 2;
      continue;
    }
    out += text.slice(at, open);
    at = close + 1;
  }
  return out + text.slice(at);
}

/** `[text](url)` becomes `text url`, so a link cannot hide its target or its text from the checks. */
function flattenLinks(text: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const mid = text.indexOf('](', at);
    if (mid === -1) break;
    const open = text.lastIndexOf('[', mid);
    const close = text.indexOf(')', mid + 2);
    const textOk = open >= at && mid - open - 1 <= MAX_LINK_TEXT && !text.slice(open + 1, mid).includes('\n');
    const targetOk = close !== -1 && close - mid - 2 <= MAX_LINK_TARGET && !text.slice(mid + 2, close).includes('\n');
    if (!textOk || !targetOk) {
      out += text.slice(at, mid + 2);
      at = mid + 2;
      continue;
    }
    out += `${text.slice(at, open)}${text.slice(open + 1, mid)} ${text.slice(mid + 2, close)}`;
    at = close + 1;
  }
  return out + text.slice(at);
}

function stripPrefix(line: string): string {
  let i = 0;
  while (i < line.length && i < 3 && line[i] === ' ') i++;
  const c = line[i];
  if (c === '-' && line[i + 1] === ' ') return line.slice(i + 1).trimStart();
  if (c === '>') return line.slice(i + 1).trimStart();
  return line;
}

interface Pass {
  readonly body: string;
  readonly tail: string[];
  readonly comments: string[];
}

function onePass(text: string): Pass {
  const comments: string[] = [];
  const cleaned = removeComments(text.replace(/[*_`]/g, ''), comments);
  const lines = cleaned.split('\n');
  const cut = lines.findIndex((line) => CUT_LINE.test(line));
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  const tail = cut === -1 ? [] : lines.slice(cut);
  const body = removeFootnoteMarkers(flattenLinks(kept.map(stripPrefix).join('\n'))).trim();
  return { body, tail, comments };
}

/** Splits a proposal file into the proposal itself and what was left out. Idempotent on `body`. */
export function proposalParts(markdown: string): ProposalParts {
  let text = markdown.replace(/\r\n?/g, '\n');
  const tail: string[] = [];
  const comments: string[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const result = onePass(text);
    tail.push(...result.tail);
    comments.push(...result.comments);
    if (result.body === text) return { body: result.body, tail, comments, stable: true };
    text = result.body;
  }
  return { body: text, tail, comments, stable: onePass(text).body === text };
}

/** The proposal text of a file: what is verified, approved and exported. */
export function proposalBody(markdown: string): string {
  return proposalParts(markdown).body;
}
