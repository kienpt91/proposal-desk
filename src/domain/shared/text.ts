// Small deterministic text helpers shared by extraction, drafting and verification.

const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could do does for from had has have he her his i if in into is it its ' +
    'me more my no not of on one or our out she so than that the their them then there these they this to up us ' +
    'very was we were what when which who will with would you your about also any all just only over per via'
  ).split(' '),
);

/** Lowercase, NFKD-fold diacritics, collapse whitespace. */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ \t]+/g, ' ');
}

/** Lowercase alphanumeric word tokens (keeps c++, c#, node.js style tokens intact). */
export function tokenize(text: string): string[] {
  return foldText(text).match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? [];
}

/** Tokens that carry meaning: no stopwords, no single characters. */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

/** Splits prose into sentences. Newlines also end a sentence; abbreviations like "e.g." are kept together. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const protectedLine = trimmed
      .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, '\u0000')) // U.S., e.g., i.e., a.m.
      .replace(/\b(etc|vs|approx|dr|mr|ms|mrs|inc|ltd)\.(?=\s)/gi, (m) => m.replace(/\./g, '\u0000'));
    const parts = protectedLine.split(/(?<=[.!?])\s+/);
    for (const part of parts) {
      const sentence = part.replace(/\u0000/g, '.').trim();
      if (sentence !== '') out.push(sentence);
    }
  }
  return out;
}

/** Escapes a string for literal use inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Joins items as "a, b and c". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Wraps text in an inline Markdown code span that cannot be closed from the inside: the fence is one backtick longer than the
 * longest run of backticks in the text. Newlines become spaces. Job-derived text goes into Markdown only through this.
 */
export function codeSpan(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  let longest = 0;
  for (const run of flat.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  return longest > 0 ? `${fence} ${flat} ${fence}` : `${fence}${flat}${fence}`;
}

/** Truncates to `max` characters (code points) with an ellipsis. */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}
