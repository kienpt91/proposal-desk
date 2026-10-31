import { describe, expect, it } from 'vitest';
import { GENESIS, LOG_LIMITS, nextEntry, parseLogEntry, verifyChain, type LogEntry } from '../../src/domain/log/chain.js';
import { bindingDigest, checkApproval, newApproval, type ApprovalBinding } from '../../src/domain/log/approval.js';
import { DomainError } from '../../src/domain/shared/result.js';
import { forSeeds } from '../support/random.js';

function chain(length: number): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let i = 0; i < length; i++) {
    entries.push(nextEntry(entries.at(-1), `2026-10-31T10:00:${String(i).padStart(2, '0')}.000Z`, 'job.analyzed', { n: i, text: `entry ${i}` }));
  }
  return entries;
}

describe('hash-chained log', () => {
  it('links each entry to the one before', () => {
    const [a, b] = chain(2) as [LogEntry, LogEntry];
    expect(a).toMatchObject({ seq: 1, prev: GENESIS });
    expect(b).toMatchObject({ seq: 2, prev: a.hash });
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain([])).toEqual({ ok: true, length: 0, head: GENESIS });
    expect(verifyChain([a, b])).toEqual({ ok: true, length: 2, head: b.hash });
  });

  it('detects any edit, removal, insertion or reordering (property)', () => {
    forSeeds(60, (random) => {
      const entries = chain(3 + random.int(6));
      expect(verifyChain(entries).ok).toBe(true);
      const i = random.int(entries.length);
      const edited = entries.map((e, k) => (k === i ? { ...e, payload: { ...e.payload, n: 999 } } : e));
      expect(verifyChain(edited)).toMatchObject({ ok: false, brokenAt: i + 1, reason: 'hash does not match the entry content' });
      if (i < entries.length - 1) {
        // Removing the last entry leaves a valid shorter chain: tail truncation is only detectable against a remembered head hash.
        const removed = entries.filter((_, k) => k !== i);
        expect(verifyChain(removed).ok).toBe(false);
        const swapped = [...entries];
        [swapped[0], swapped[1]] = [swapped[1] as LogEntry, swapped[0] as LogEntry];
        expect(verifyChain(swapped).ok).toBe(false);
      }
      const reTimed = entries.map((e, k) => (k === i ? { ...e, ts: '2030-01-01T00:00:00.000Z' } : e));
      expect(verifyChain(reTimed).ok).toBe(false);
    });
  });

  it('detects a rewritten entry even when its own hash is recomputed', () => {
    const entries = chain(3);
    const forged = nextEntry(entries[0], '2026-10-31T10:00:01.000Z', 'job.analyzed', { n: 1, text: 'forged' });
    expect(verifyChain([entries[0] as LogEntry, forged, entries[2] as LogEntry])).toMatchObject({ ok: false, brokenAt: 3, reason: 'previous-hash link does not match the entry before it' });
    expect(verifyChain([entries[1] as LogEntry])).toMatchObject({ ok: false, brokenAt: 2, reason: 'expected sequence number 1, found 2' });
  });

  it('refuses oversized payloads and bad timestamps', () => {
    expect(() => nextEntry(undefined, '2026-10-31T10:00:00.000Z', 'job.analyzed', { big: 'x'.repeat(LOG_LIMITS.maxPayloadBytes) })).toThrow(DomainError);
    expect(() => nextEntry(undefined, 'yesterday', 'job.analyzed', {})).toThrow(/ISO timestamp/);
    const last = { ...chain(1)[0], seq: LOG_LIMITS.maxEntries } as LogEntry;
    expect(() => nextEntry(last, '2026-10-31T10:00:00.000Z', 'job.analyzed', {})).toThrow(/limited to/);
  });

  it('parses stored lines strictly', () => {
    const entry = chain(1)[0] as LogEntry;
    expect(parseLogEntry(JSON.parse(JSON.stringify(entry)))).toEqual({ ok: true, value: entry });
    expect(parseLogEntry(null)).toMatchObject({ ok: false });
    expect(parseLogEntry({ ...entry, extra: 1 })).toEqual({ ok: false, error: ['unknown field extra'] });
    expect(parseLogEntry({ ...entry, seq: 0, ts: 'x', type: 'nope', payload: [], prev: 'x', hash: 'y' })).toMatchObject({ ok: false });
  });
});

describe('approval binding', () => {
  const binding: ApprovalBinding = { textDigest: 'a'.repeat(64), jobDigest: 'b'.repeat(64), factsDigest: 'c'.repeat(64) };
  const approval = newApproval('d-123', binding, '2026-10-31T10:00:00.000Z');

  it('stands while text, job and facts are unchanged', () => {
    expect(checkApproval(approval, binding)).toEqual({ ok: true, value: approval });
    expect(approval.bindingDigest).toBe(bindingDigest(binding));
  });

  it('is void when any of the three changes', () => {
    expect(checkApproval(approval, { ...binding, textDigest: 'd'.repeat(64) })).toEqual({ ok: false, error: ['the draft text changed after approval'] });
    expect(checkApproval(approval, { ...binding, jobDigest: 'd'.repeat(64) })).toEqual({ ok: false, error: ['the job text differs from the one that was approved'] });
    const facts = checkApproval(approval, { ...binding, factsDigest: 'd'.repeat(64) });
    expect(!facts.ok && facts.error[0]).toContain('facts behind the draft changed');
  });

  it('requires an approval at all and notices a tampered record', () => {
    expect(checkApproval(undefined, binding)).toEqual({ ok: false, error: ['this draft has not been approved'] });
    expect(checkApproval({ ...approval, bindingDigest: 'e'.repeat(64) }, binding)).toEqual({ ok: false, error: ['the approval record is inconsistent'] });
  });
});
