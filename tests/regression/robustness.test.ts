import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/application/errors.js';
import { defaultConfig, setConfigValue } from '../../src/domain/config/config.js';
import { parseFact } from '../../src/domain/facts/fact.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { nextEntry } from '../../src/domain/log/chain.js';
import { ensurePrivateDir } from '../../src/infrastructure/fs/safe-fs.js';
import { FileFactStore, FileLogStore, FsEvidenceChecker } from '../../src/infrastructure/fs/stores.js';
import { fact } from '../support/builders.js';

// Security review finding "minor-robustness" (evidence FIFO and symlinks, stale-lock race, __proto__ attributes, unlocked facts file).

const tmp = (): string => mkdtempSync(join(tmpdir(), 'proposal-desk-robust-'));
async function stateDir(): Promise<string> {
  const dir = join(tmp(), 'state');
  await ensurePrivateDir(dir);
  return dir;
}
async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}
const add = (log: FileLogStore, n = 0) => log.append((previous) => nextEntry(previous, '2026-10-31T10:00:00.000Z', 'job.analyzed', { n }));

describe('evidence files', () => {
  it('does not hang on a FIFO and does not follow a symbolic link', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'real.md'), 'proof');
    execFileSync('mkfifo', [join(dir, 'pipe')]);
    symlinkSync(join(dir, 'real.md'), join(dir, 'link.md'));
    const checker = new FsEvidenceChecker(dir);
    const started = Date.now();
    expect(await checker.digestOf('pipe')).toEqual({ ok: false, reason: 'not a regular file' });
    expect(await checker.digestOf('link.md')).toEqual({ ok: false, reason: 'a symbolic link (point at the file itself)' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await checker.digestOf('real.md')).toMatchObject({ ok: true });
  });
});

describe('attribute names that are properties of every object', () => {
  it('are rejected as unknown attributes, not as an internal error', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const raw = JSON.parse(`{"id":"x-fact","claim":"Worked with Docker daily","category":"skill","evidence":{"kind":"self-declared","reference":"me"},"status":"declared","attrs":{"${key}":1}}`) as unknown;
      const parsed = parseFact(raw);
      expect(parsed.ok, key).toBe(false);
      expect(!parsed.ok && parsed.error.join(), key).toContain(`${key}: not allowed for category skill`);
    }
    expect(FactBase.parse({ schema: 1, facts: [JSON.parse('{"id":"x-fact","claim":"Worked with Docker daily","category":"skill","evidence":{"kind":"self-declared","reference":"me"},"status":"declared","attrs":{"__proto__":{"years":99}}}')] }).ok).toBe(false);
  });

  it('cannot reach or pollute prototypes through configuration paths', () => {
    for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'scoring.__proto__.polluted', 'scoring.constructor']) {
      expect(setConfigValue(defaultConfig(), path, 'x').ok, path).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('the log lock', () => {
  it('does not steal the lock of a process that is still running, however old the lock is', async () => {
    const dir = await stateDir();
    const lock = join(dir, 'log.lock');
    writeFileSync(lock, `${process.pid}:abcdef\n`, { mode: 0o600 });
    const old = new Date(Date.now() - 300_000);
    utimesSync(lock, old, old);
    const log = new FileLogStore(dir, { staleMs: 30_000, waitMs: 150, maxHoldMs: 3_600_000 });
    expect((await rejection(add(log))).message).toContain('holds');
    expect(readFileSync(lock, 'utf8')).toBe(`${process.pid}:abcdef\n`);
  });

  it('takes over the lock of a process that is gone, at once', async () => {
    const dir = await stateDir();
    writeFileSync(join(dir, 'log.lock'), '2147483646:abcdef\n', { mode: 0o600 });
    const log = new FileLogStore(dir, { staleMs: 3_600_000, waitMs: 500, maxHoldMs: 3_600_000 });
    expect((await add(log)).seq).toBe(1);
    expect(existsSync(join(dir, 'log.lock'))).toBe(false);
  });

  it('takes over a lock held by a live process only after the maximum hold time', async () => {
    const dir = await stateDir();
    const lock = join(dir, 'log.lock');
    writeFileSync(lock, `${process.pid}:abcdef\n`, { mode: 0o600 });
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    const log = new FileLogStore(dir, { staleMs: 30_000, waitMs: 500, maxHoldMs: 60_000 });
    expect((await add(log)).seq).toBe(1);
  });

  it('notices when its lock was taken away and writes nothing', async () => {
    const dir = await stateDir();
    const log = new FileLogStore(dir);
    const error = await rejection(
      log.append((previous) => {
        writeFileSync(join(dir, 'log.lock'), `${process.pid}:someone-else\n`, { mode: 0o600 });
        return nextEntry(previous, '2026-10-31T10:00:00.000Z', 'job.analyzed', {});
      }),
    );
    expect(error.kind).toBe('io');
    expect(error.message).toContain('lock on the log was lost');
    expect(existsSync(join(dir, 'log.jsonl'))).toBe(false);
    expect(readFileSync(join(dir, 'log.lock'), 'utf8')).toBe(`${process.pid}:someone-else\n`);
  });
});

describe('the facts file', () => {
  it('does not lose updates when several processes change it at once', async () => {
    const path = join(tmp(), 'facts.json');
    const stores = Array.from({ length: 8 }, () => new FileFactStore(path));
    await Promise.all(
      stores.map((store, i) =>
        store.update((current) => (current ?? FactBase.empty()).add(fact({ id: `fact-${i}`, claim: `Worked on service number ${i} daily`, status: 'declared', checkedAt: undefined, evidence: { kind: 'self-declared', reference: 'me', digest: undefined } })).value),
      ),
    );
    const loaded = await new FileFactStore(path).load();
    expect(loaded?.facts.map((f) => f.id).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `fact-${i}`).sort());
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('writes nothing when the update throws, and releases the lock', async () => {
    const path = join(tmp(), 'facts.json');
    const store = new FileFactStore(path);
    await expect(store.update(() => { throw new Error('rejected'); })).rejects.toThrow('rejected');
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });
});
