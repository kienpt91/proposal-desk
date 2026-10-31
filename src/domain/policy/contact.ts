// Contact-detail detection, shared by fact validation, drafting and the proposal verifier.
// Rationale: contact details in a proposal are an invitation to leave the platform before the
// client has hired anyone, and they leak the freelancer's personal data. See docs/risk-flags.md.
// Matching runs on the folded text (invisible characters removed, fullwidth and look-alike forms mapped),
// so "john@gmail\u00ad.com" and "ｊｏｈｎ＠ｇｍａｉｌ．ｃｏｍ" are found like the plain forms.

import { foldForMatch } from '../shared/text-safety.js';

export type ContactKind = 'email' | 'phone' | 'messenger' | 'handle' | 'link';

export interface ContactFinding {
  readonly kind: ContactKind;
  readonly excerpt: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const TLD = 'com|net|org|io|dev|me|co|app|ai|info|biz|edu|gov|us|uk|vn|de|fr|es|it|nl|ca|au|in|ru|cn|jp|xyz|online|site|tech|pro';
const AT = '(?:\\(at\\)|\\[at\\]|\\{at\\}|\\bat\\b)';
const DOT_BRACKETED = '(?:\\(dot\\)|\\[dot\\]|\\{dot\\})';
const DOT_WORD = '\\bdot\\b';
/** "john at gmail dot com", "john [at] gmail [dot] com", "john(at)gmail(dot)com" */
const SPELLED_EMAIL = new RegExp(
  `\\b[A-Za-z0-9._%+-]{2,}\\s{0,3}${AT}\\s{0,3}[A-Za-z0-9-]{2,}(?:\\s{0,3}(?:${DOT_BRACKETED}|${DOT_WORD})\\s{0,3}[A-Za-z0-9-]{2,}){0,3}\\s{0,3}(?:${DOT_BRACKETED}\\s{0,3}[A-Za-z]{2,}\\b|${DOT_WORD}\\s{0,3}(?:${TLD})\\b)`,
  'gi',
);
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{7,}\d/g;
const MESSENGER =
  /\b(?:whatsapp|whats app|telegram|skype|wechat|viber|zalo|kakaotalk|line id|discord|signal app|on signal|t\.me|wa\.me|discord\.gg)\b/gi;
const HANDLE = /(?<![A-Za-z0-9_.])@[A-Za-z][A-Za-z0-9_]{2,}/g;
const SOCIAL_HOSTS = /^(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|t\.me|wa\.me|discord\.gg|calendly\.com|tiktok\.com|youtube\.com\/@)/i;
const LINK = new RegExp(
  `\\b(?:(?:https?:\\/\\/|www\\.)[^\\s)>\\]]+|(?:[a-z0-9-]+\\.)+(?:${TLD})\\/[^\\s)>\\]]*)`,
  'gi',
);

function digitsIn(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/** Finds contact details. Plain links are reported with kind "link" so callers can treat them as a warning;
 *  profile links of social networks and calendars are personal contact ("handle"). */
export function findContactDetails(text: string): ContactFinding[] {
  const folded = foldForMatch(text);
  const out: ContactFinding[] = [];
  for (const m of folded.matchAll(EMAIL)) out.push({ kind: 'email', excerpt: m[0] });
  for (const m of folded.matchAll(SPELLED_EMAIL)) out.push({ kind: 'email', excerpt: m[0] });
  for (const m of folded.matchAll(PHONE_CANDIDATE)) {
    const candidate = m[0].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) continue; // ISO date
    if (/^\d{1,3}(?:,\d{3})+$/.test(candidate)) continue; // 1,000,000
    const digits = digitsIn(candidate);
    if (digits < 9 || digits > 15) continue;
    if (!/[\s().+-]/.test(candidate)) continue; // a bare run of digits is a number, not a phone
    out.push({ kind: 'phone', excerpt: candidate });
  }
  for (const m of folded.matchAll(MESSENGER)) out.push({ kind: 'messenger', excerpt: m[0] });
  for (const m of folded.matchAll(HANDLE)) out.push({ kind: 'handle', excerpt: m[0] });
  for (const m of folded.matchAll(LINK)) out.push({ kind: SOCIAL_HOSTS.test(m[0]) ? 'handle' : 'link', excerpt: m[0] });
  return out;
}

/** True for anything that is not just a link. */
export function hasPersonalContact(text: string): boolean {
  return findContactDetails(text).some((f) => f.kind !== 'link');
}
