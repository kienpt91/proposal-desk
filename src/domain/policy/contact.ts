// Contact-detail detection, shared by fact validation, drafting and the proposal verifier.
// Rationale: contact details in a proposal are an invitation to leave the platform before the
// client has hired anyone, and they leak the freelancer's personal data. See docs/risk-flags.md.

export type ContactKind = 'email' | 'phone' | 'messenger' | 'handle' | 'link';

export interface ContactFinding {
  readonly kind: ContactKind;
  readonly excerpt: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{7,}\d/g;
const MESSENGER =
  /\b(?:whatsapp|whats app|telegram|skype|wechat|viber|zalo|kakaotalk|line id|discord|signal app|on signal|t\.me|wa\.me|discord\.gg)\b/gi;
const HANDLE = /(?<![A-Za-z0-9_.])@[A-Za-z][A-Za-z0-9_]{2,}/g;
const LINK = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi;

function digitsIn(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/** Finds contact details. Links are reported with kind "link" so callers can treat them as a warning. */
export function findContactDetails(text: string): ContactFinding[] {
  const out: ContactFinding[] = [];
  for (const m of text.matchAll(EMAIL)) out.push({ kind: 'email', excerpt: m[0] });
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    const candidate = m[0].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) continue; // ISO date
    if (/^\d{1,3}(?:,\d{3})+$/.test(candidate)) continue; // 1,000,000
    const digits = digitsIn(candidate);
    if (digits < 9 || digits > 15) continue;
    if (!/[\s().+-]/.test(candidate)) continue; // a bare run of digits is a number, not a phone
    out.push({ kind: 'phone', excerpt: candidate });
  }
  for (const m of text.matchAll(MESSENGER)) out.push({ kind: 'messenger', excerpt: m[0] });
  for (const m of text.matchAll(HANDLE)) out.push({ kind: 'handle', excerpt: m[0] });
  for (const m of text.matchAll(LINK)) out.push({ kind: 'link', excerpt: m[0] });
  return out;
}

/** True for anything that is not just a link. */
export function hasPersonalContact(text: string): boolean {
  return findContactDetails(text).some((f) => f.kind !== 'link');
}
