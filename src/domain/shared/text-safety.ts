// Everything the tool prints or stores is escaped here. Job posts are untrusted input:
// they may carry ANSI/OSC escape sequences, bidi overrides or zero-width characters meant
// to confuse a terminal, a reviewer or a keyword matcher.

/** Code points that are never printed raw: C0/C1 controls (except \n and \t), DEL, bidi controls,
 *  zero-width and invisible formatting characters, line/paragraph separators, BOM, specials. */
export function isUnsafeCodePoint(cp: number, keepNewlines = true): boolean {
  if (cp === 0x0a || cp === 0x09) return !keepNewlines && cp === 0x0a;
  if (cp < 0x20 || cp === 0x7f) return true;
  if (cp >= 0x80 && cp <= 0x9f) return true; // C1 controls, includes the 8-bit CSI (0x9b) and OSC (0x9d)
  if (cp === 0x061c || cp === 0x180e) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true; // zero-width space/joiners, LRM, RLM
  if (cp >= 0x2028 && cp <= 0x202e) return true; // line/paragraph separators, bidi embeddings and overrides
  if (cp >= 0x2060 && cp <= 0x206f) return true; // word joiner, invisible operators, bidi isolates, deprecated formatting
  if (cp === 0xfeff) return true; // BOM / zero width no-break space
  if (cp >= 0xfff9 && cp <= 0xfffc) return true; // interlinear annotation, object replacement
  if (cp >= 0xe0000 && cp <= 0xe007f) return true; // tag characters
  if (cp >= 0xd800 && cp <= 0xdfff) return true; // lone surrogates (never reached for well-formed text)
  return false;
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

/** Removes unsafe code points, keeping layout. Used before keyword matching so hidden characters
 *  cannot split a phrase; the count is reported separately as a risk flag. */
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
