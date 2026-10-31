// Everything the tool prints or stores is escaped here. Job posts and proposals are untrusted input:
// they may carry ANSI/OSC escape sequences, bidi overrides, zero-width or other invisible characters
// meant to confuse a terminal, a reviewer or a keyword matcher, and look-alike letters (Cyrillic,
// Greek, fullwidth forms) meant to slip a banned word past a filter.

/** Code points that are never printed raw: controls, every default-ignorable and format character, private use,
 *  line/paragraph separators, the blank braille pattern, specials. Newline and tab are kept unless asked otherwise. */
const UNSAFE_NON_ASCII = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\u2800\ufff9-\ufffc]/u;

export function isUnsafeCodePoint(cp: number, keepNewlines = true): boolean {
  if (cp === 0x0a || cp === 0x09) return !keepNewlines && cp === 0x0a;
  if (cp < 0x20 || cp === 0x7f) return true;
  if (cp < 0xa0) return cp >= 0x80; // C1 controls, includes the 8-bit CSI (0x9b) and OSC (0x9d)
  return UNSAFE_NON_ASCII.test(String.fromCodePoint(cp));
}

/** True when `text` contains at least one code point that `escapeUnsafe` would rewrite. */
export function hasUnsafeCharacters(text: string): boolean {
  for (const ch of text) if (isUnsafeCodePoint(ch.codePointAt(0) as number)) return true;
  return false;
}

/** Number of unsafe code points in `text`. */
export function countUnsafeCharacters(text: string): number {
  let count = 0;
  for (const ch of text) if (isUnsafeCodePoint(ch.codePointAt(0) as number)) count++;
  return count;
}

/** Replaces every unsafe code point by a visible `\u{XXXX}` escape. Safe to print to a terminal. */
export function escapeUnsafe(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    out += isUnsafeCodePoint(cp) ? `\\u{${cp.toString(16)}}` : ch;
  }
  return out;
}

/** Removes unsafe code points, keeping layout. Used before analysis so hidden characters cannot split a phrase;
 *  the count is reported separately as a risk flag. */
export function stripUnsafe(text: string): string {
  let out = '';
  for (const ch of text) if (!isUnsafeCodePoint(ch.codePointAt(0) as number)) out += ch;
  return out;
}

/** Same as `escapeUnsafe` but produces JSON-valid `\uXXXX` escapes, for use inside JSON string literals. */
export function escapeUnsafeForJson(serialized: string): string {
  let out = '';
  for (const ch of serialized) {
    const cp = ch.codePointAt(0) as number;
    if (!isUnsafeCodePoint(cp)) {
      out += ch;
    } else if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += `\\u${(0xd800 + (v >> 10)).toString(16)}\\u${(0xdc00 + (v & 0x3ff)).toString(16)}`;
    } else {
      out += `\\u${cp.toString(16).padStart(4, '0')}`;
    }
  }
  return out;
}

/** CRLF/CR to LF; nothing else is changed. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

// ------------------------------------------------------------------ folding for matching

/** Cyrillic and Greek letters that are, in common fonts, indistinguishable from Latin ones. */
const CONFUSABLES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    // Cyrillic, lower case
    а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l', к: 'k', м: 'm', н: 'h', т: 't', в: 'b', г: 'r',
    // Cyrillic, upper case
    А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', Ј: 'J', К: 'K', М: 'M', О: 'O', Р: 'P', Ѕ: 'S', Т: 'T', Х: 'X', У: 'Y',
    // Greek, lower case
    α: 'a', ε: 'e', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', τ: 't', υ: 'u', ν: 'v', χ: 'x', ω: 'w',
    // Greek, upper case
    Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  }),
);

const DECIMAL = /\p{Nd}/u;
const MARK = /\p{M}/u;

/** The value 0-9 of a decimal digit from any script. */
function decimalValue(cp: number): number {
  let start = cp;
  while (start > 0 && DECIMAL.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

/**
 * The text as a keyword, contact or number matcher should see it: invisible characters removed, compatibility forms
 * (fullwidth, ligatures, circled and mathematical letters) decomposed, combining marks removed, decimal digits of
 * any script turned into ASCII digits, and Cyrillic/Greek look-alikes mapped to the Latin letters they imitate.
 * Case and newlines are kept. It is for matching only; never show it as the author's text.
 */
export function foldForMatch(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKD')) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) {
      if (!isUnsafeCodePoint(cp)) out += ch;
      continue;
    }
    if (isUnsafeCodePoint(cp) || MARK.test(ch)) continue;
    if (DECIMAL.test(ch)) out += String(decimalValue(cp));
    else out += CONFUSABLES.get(ch) ?? ch;
  }
  return out;
}

/** Number of words that mix Latin letters with Cyrillic or Greek look-alikes: the signature of a filter-evasion attempt. */
export function countLookalikes(text: string): number {
  let count = 0;
  for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
    if (token === '' || !/[A-Za-z]/.test(token)) continue;
    for (const ch of token) {
      if (CONFUSABLES.has(ch)) {
        count++;
        break;
      }
    }
  }
  return count;
}
