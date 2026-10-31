import { canonicalJson, digestOf, type Json } from '../shared/canonical-json.js';
import { isIsoTimestamp } from '../shared/date.js';
import { DomainError, fail, ok, type Result } from '../shared/result.js';

export const LOG_EVENT_TYPES = [
  'fact.added',
  'fact.verified',
  'fact.marked-stale',
  'job.analyzed',
  'draft.generated',
  'proposal.checked',
  'draft.approved',
  'draft.exported',
  'outcome.recorded',
  'config.proposed',
  'config.applied',
] as const;
export type LogEventType = (typeof LOG_EVENT_TYPES)[number];

export const LOG_LIMITS = { maxEntries: 100_000, maxPayloadBytes: 16_384 } as const;

/** The previous-hash value of the first entry. */
export const GENESIS = '0'.repeat(64);

export type Payload = { readonly [key: string]: Json | undefined };

/**
 * One line of the append-only log. `hash` covers every other field, and `prev` is the hash of the entry before,
 * so editing, removing or reordering any earlier line breaks every later hash.
 */
export interface LogEntry {
  readonly seq: number;
  readonly ts: string;
  readonly type: LogEventType;
  readonly payload: Payload;
  readonly prev: string;
  readonly hash: string;
}

function hashOf(entry: Omit<LogEntry, 'hash'>): string {
  return digestOf({ seq: entry.seq, ts: entry.ts, type: entry.type, payload: entry.payload, prev: entry.prev });
}

/** Builds the entry that follows `previous` (or the first entry when there is none). */
export function nextEntry(previous: LogEntry | undefined, ts: string, type: LogEventType, payload: Payload): LogEntry {
  if (!isIsoTimestamp(ts)) throw new DomainError('bad-timestamp', `not an ISO timestamp: ${ts}`);
  if (canonicalJson(payload).length > LOG_LIMITS.maxPayloadBytes) throw new DomainError('payload-too-large', `log payloads are limited to ${LOG_LIMITS.maxPayloadBytes} bytes`);
  const seq = previous === undefined ? 1 : previous.seq + 1;
  if (seq > LOG_LIMITS.maxEntries) throw new DomainError('log-full', `the log is limited to ${LOG_LIMITS.maxEntries} entries`);
  const body = { seq, ts, type, payload, prev: previous === undefined ? GENESIS : previous.hash };
  return { ...body, hash: hashOf(body) };
}

/** Strict parser for one decoded log line. */
export function parseLogEntry(raw: unknown): Result<LogEntry> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(['log entry must be an object']);
  const r = raw as Record<string, unknown>;
  const issues: string[] = [];
  for (const key of Object.keys(r)) if (!['seq', 'ts', 'type', 'payload', 'prev', 'hash'].includes(key)) issues.push(`unknown field ${key}`);
  if (typeof r.seq !== 'number' || !Number.isInteger(r.seq) || r.seq < 1) issues.push('seq must be a positive integer');
  if (typeof r.ts !== 'string' || !isIsoTimestamp(r.ts)) issues.push('ts must be an ISO timestamp');
  if (typeof r.type !== 'string' || !(LOG_EVENT_TYPES as readonly string[]).includes(r.type)) issues.push('unknown event type');
  if (typeof r.payload !== 'object' || r.payload === null || Array.isArray(r.payload)) issues.push('payload must be an object');
  for (const key of ['prev', 'hash'] as const) if (typeof r[key] !== 'string' || !/^[0-9a-f]{64}$/.test(r[key] as string)) issues.push(`${key} must be 64 hex characters`);
  if (issues.length > 0) return fail(issues);
  return ok(r as unknown as LogEntry);
}

export interface ChainReport {
  readonly ok: boolean;
  readonly length: number;
  /** Hash of the last entry (GENESIS for an empty log). */
  readonly head: string;
  /** 1-based sequence number of the first bad entry, and why. */
  readonly brokenAt?: number;
  readonly reason?: string;
}

/** Recomputes every hash and link. */
export function verifyChain(entries: readonly LogEntry[]): ChainReport {
  let prev = GENESIS;
  for (const [i, entry] of entries.entries()) {
    const bad = (reason: string): ChainReport => ({ ok: false, length: entries.length, head: prev, brokenAt: entry.seq, reason });
    if (entry.seq !== i + 1) return bad(`expected sequence number ${i + 1}, found ${entry.seq}`);
    if (entry.prev !== prev) return bad('previous-hash link does not match the entry before it');
    if (hashOf(entry) !== entry.hash) return bad('hash does not match the entry content');
    prev = entry.hash;
  }
  return { ok: true, length: entries.length, head: prev };
}
