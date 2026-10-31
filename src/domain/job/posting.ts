import { sha256 } from '../shared/sha256.js';
import { fail, ok, type Result } from '../shared/result.js';
import { countLookalikes, countUnsafeCharacters, foldForMatch, normalizeNewlines, stripUnsafe } from '../shared/text-safety.js';
import { truncate } from '../shared/text.js';

export const JOB_LIMITS = { maxChars: 60000, titleChars: 100 } as const;

/**
 * Facts about the client or the listing that are not part of the post text. The user copies them
 * from the listing page into an optional block at the very top of the file:
 *
 *   ---proposal-desk
 *   proposals: 12
 *   client-hires: 0
 *   payment-verified: no
 *   account-age-days: 5
 *   bid-min: 25
 *   bid-max: 60
 *   currency: USD
 *   ---
 *
 * The block is honoured only as the first thing in the input and is always echoed in the report.
 */
export interface JobMetadata {
  readonly proposals?: number;
  readonly clientHires?: number;
  readonly paymentVerified?: boolean;
  readonly accountAgeDays?: number;
  readonly bidMin?: number;
  readonly bidMax?: number;
  readonly currency?: string;
}

export interface JobPosting {
  /** SHA-256 of the input with newlines normalised (metadata block included). Identifies the job in approvals. */
  readonly digest: string;
  /** The input with newlines normalised; exactly what is stored. */
  readonly rawText: string;
  /** The post body: metadata block removed, hidden and control characters removed. All analysis runs on this. */
  readonly body: string;
  /** The body as keyword matchers must see it: look-alike letters mapped to Latin, marks and digits folded. Never shown as the post's text. */
  readonly matchBody: string;
  readonly title: string;
  readonly metadata: JobMetadata;
  /** Problems with the metadata block (unknown keys, bad values). The offending lines are ignored. */
  readonly metadataIssues: readonly string[];
  /** Number of control, bidi or zero-width characters that were removed from the body. */
  readonly hiddenCharacters: number;
  /** Words that mix Latin letters with Cyrillic or Greek look-alikes. */
  readonly lookalikes: number;
}

const OPEN = /^---\s*proposal-desk\s*$/;
const KEYS: Readonly<Record<string, { key: keyof JobMetadata; kind: 'count' | 'bool' | 'amount' | 'currency' }>> = {
  proposals: { key: 'proposals', kind: 'count' },
  'client-hires': { key: 'clientHires', kind: 'count' },
  'payment-verified': { key: 'paymentVerified', kind: 'bool' },
  'account-age-days': { key: 'accountAgeDays', kind: 'count' },
  'bid-min': { key: 'bidMin', kind: 'amount' },
  'bid-max': { key: 'bidMax', kind: 'amount' },
  currency: { key: 'currency', kind: 'currency' },
};

function parseMetadata(lines: readonly string[], issues: string[]): JobMetadata {
  const meta: { -readonly [K in keyof JobMetadata]: JobMetadata[K] } = {};
  for (const line of lines) {
    if (line.trim() === '') continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/.exec(line.trim());
    const spec = m === null ? undefined : KEYS[m[1] as string];
    if (m === null || spec === undefined) {
      issues.push(`metadata line ignored (unknown key): ${truncate(stripUnsafe(line.trim()), 40)}`);
      continue;
    }
    const value = (m[2] as string).trim();
    if (spec.kind === 'bool') {
      if (/^(?:yes|true)$/i.test(value)) meta.paymentVerified = true;
      else if (/^(?:no|false)$/i.test(value)) meta.paymentVerified = false;
      else issues.push(`metadata ${m[1]}: expected yes or no`);
    } else if (spec.kind === 'currency') {
      if (/^[A-Z]{3}$/.test(value)) meta.currency = value;
      else issues.push('metadata currency: expected a 3-letter upper-case code');
    } else {
      const n = Number(value);
      const valid = /^\d+(?:\.\d+)?$/.test(value) && n >= 0 && n <= (spec.kind === 'count' ? 1_000_000 : 10_000_000);
      if (valid) (meta as Record<string, number>)[spec.key] = n;
      else issues.push(`metadata ${m[1]}: expected a non-negative number`);
    }
  }
  if (meta.bidMin !== undefined && meta.bidMax !== undefined && meta.bidMin > meta.bidMax) {
    issues.push('metadata bid-min is above bid-max; both ignored');
    delete meta.bidMin;
    delete meta.bidMax;
  }
  return meta;
}

/** Parses pasted job text. Never throws; returns an error only for empty or oversized input. */
export function parseJobPosting(input: string): Result<JobPosting> {
  const rawText = normalizeNewlines(input);
  if (rawText.trim() === '') return fail(['the job text is empty']);
  if (rawText.length > JOB_LIMITS.maxChars) return fail([`the job text is longer than ${JOB_LIMITS.maxChars} characters`]);

  const lines = rawText.split('\n');
  let first = 0;
  while (first < lines.length && (lines[first] as string).trim() === '') first++;
  let metadata: JobMetadata = {};
  const issues: string[] = [];
  let bodyLines = lines;
  if (first < lines.length && OPEN.test((lines[first] as string).trim())) {
    const close = lines.findIndex((line, i) => i > first && line.trim() === '---');
    if (close === -1) {
      issues.push('metadata block is not closed with ---; treated as part of the post');
    } else {
      metadata = parseMetadata(lines.slice(first + 1, close), issues);
      bodyLines = lines.slice(close + 1);
    }
  }
  const bodyRaw = bodyLines.join('\n');
  const hiddenCharacters = countUnsafeCharacters(bodyRaw);
  const body = stripUnsafe(bodyRaw).normalize('NFKC').trim();
  if (body === '') return fail(['the job text has no content after the metadata block']);
  const title = truncate(
    (body.split('\n').find((line) => line.trim() !== '') as string).trim().replace(/^#{1,6}\s*/, ''),
    JOB_LIMITS.titleChars,
  );
  return ok({ digest: sha256(rawText), rawText, body, matchBody: foldForMatch(body), title, metadata, metadataIssues: issues, hiddenCharacters, lookalikes: countLookalikes(body) });
}
