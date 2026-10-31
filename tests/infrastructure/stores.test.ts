import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/application/errors.js';
import { nextEntry } from '../../src/domain/log/chain.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { FileConfigStore, FileFactStore, FileLogStore, FileObjectStore, FsEvidenceChecker, FsFileSink } from '../../src/infrastructure/fs/stores.js';
import { ensurePrivateDir, readText, readTextIfExists, SIZE_LIMITS, STATE_FILE, writeTextAtomic } from '../../src/infrastructure/fs/safe-fs.js';
import { configStoreContract, factStoreContract, logStoreContract, objectStoreContract } from '../contracts/ports.js';
import { InMemoryConfigStore, InMemoryFactStore, InMemoryLogStore, InMemoryObjectStore } from '../support/fakes.js';
import { fact } from '../support/builders.js';

const roots: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'proposal-desk-test-'));
  roots.push(dir);
  return dir;
}
async function stateDir(): Promise<string> {
  const dir = join(tmp(), 'state');
  await ensurePrivateDir(dir);
  return dir;
}
afterAll(() => {
  // temporary directories live under the OS temp directory and are removed with it
});

logStoreContract('in memory', () => new InMemoryLogStore());
logStoreContract('files', async () => new FileLogStore(await stateDir()));
objectStoreContract('in memory', () => new InMemoryObjectStore());
objectStoreContract('files', async () => new FileObjectStore(join(await stateDir(), 'objects')));
factStoreContract('in memory', () => new InMemoryFactStore());
factStoreContract('file', async () => new FileFactStore(join(await stateDir(), 'facts.json'), STATE_FILE));
configStoreContract('in memory', () => new InMemoryConfigStore());
configStoreContract('file', async () => new FileConfigStore(join(await stateDir(), 'config.json')));

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('state directory and files', () => {
  it('creates a private directory and private files', async () => {
    const dir = await stateDir();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    await new FileLogStore(dir).append((previous) => nextEntry(previous, '2026-10-31T10:00:00.000Z', 'job.analyzed', {}));
    await new FileObjectStore(join(dir, 'objects')).put('x');
    expect(statSync(join(dir, 'log.jsonl')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'objects', sha256('x'))).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, 'log.lock'))).toBe(false);
    expect(readdirSync(join(dir, 'objects')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a state directory that is a symbolic link, open to others or owned by someone else', async () => {
    const root = tmp();
    mkdirSync(join(root, 'real'), { mode: 0o700 });
    symlinkSync(join(root, 'real'), join(root, 'link'));
    expect((await rejection(ensurePrivateDir(join(root, 'link')))).message).toContain('symbolic link');
    mkdirSync(join(root, 'open'));
    chmodSync(join(root, 'open'), 0o755);
    expect((await rejection(ensurePrivateDir(join(root, 'open')))).message).toContain('accessible by other users (mode 0755)');
    expect((await rejection(ensurePrivateDir(join(root, 'real'), { ...STATE_FILE, uid: (process.getuid?.() ?? 0) + 1 }))).message).toContain('owned by another user');
    writeFileSync(join(root, 'file'), 'x');
    expect((await rejection(ensurePrivateDir(join(root, 'file')))).kind).toBe('io');
  });

  it('refuses state files that are symbolic links or readable by others', async () => {
    const dir = await stateDir();
    writeFileSync(join(dir, 'target'), 'secret', { mode: 0o600 });
    symlinkSync(join(dir, 'target'), join(dir, 'config.json'));
    expect((await rejection(new FileConfigStore(join(dir, 'config.json')).load())).message).toContain('symbolic link');
    writeFileSync(join(dir, 'log.jsonl'), '', { mode: 0o644 });
    chmodSync(join(dir, 'log.jsonl'), 0o644);
    expect((await rejection(new FileLogStore(dir).readAll())).message).toContain('accessible by other users');
  });

  it('refuses to follow a symbolic link when writing', async () => {
    const dir = await stateDir();
    writeFileSync(join(dir, 'real.json'), '{}', { mode: 0o600 });
    symlinkSync(join(dir, 'real.json'), join(dir, 'linked.json'));
    const error = await rejection(writeTextAtomic(join(dir, 'linked.json'), 'x', { mode: 0o600, overwrite: true, trust: STATE_FILE }));
    expect(error.message).toContain('symbolic link');
    expect(readFileSync(join(dir, 'real.json'), 'utf8')).toBe('{}');
  });

  it('bounds every read', async () => {
    const dir = await stateDir();
    writeFileSync(join(dir, 'big'), 'x'.repeat(100), { mode: 0o600 });
    expect((await rejection(readText(join(dir, 'big'), 50, STATE_FILE))).message).toContain('larger than the 50-byte limit');
    writeFileSync(join(dir, 'bad'), Buffer.from([0xff, 0xfe, 0xfd]), { mode: 0o600 });
    expect((await rejection(readText(join(dir, 'bad'), 50, STATE_FILE))).message).toContain('not valid UTF-8');
    expect((await rejection(readText(join(dir, 'absent'), 50))).kind).toBe('missing');
    expect(await readTextIfExists(join(dir, 'absent'), 50, STATE_FILE)).toBeUndefined();
    expect((await rejection(new FileObjectStore(join(dir, 'o')).put('x'.repeat(SIZE_LIMITS.object + 1)))).kind).toBe('invalid');
    expect((await rejection(readText(dir, 50))).message).toContain('not a regular file');
  });
});

describe('FileObjectStore', () => {
  it('detects modified objects and rejects keys that are not digests', async () => {
    const dir = join(await stateDir(), 'objects');
    const store = new FileObjectStore(dir);
    const digest = await store.put('original');
    writeFileSync(join(dir, digest), 'tampered', { mode: 0o600 });
    const error = await rejection(store.get(digest));
    expect(error).toMatchObject({ kind: 'io' });
    expect(error.message).toContain('no longer matches its digest');
    expect((await rejection(store.get('../../etc/passwd'))).kind).toBe('invalid');
  });
});

describe('FileLogStore', () => {
  const entryLine = (n: number) => JSON.stringify(nextEntry(undefined, '2026-10-31T10:00:00.000Z', 'job.analyzed', { n }));

  it('reads back what was written and reports damaged files precisely', async () => {
    const dir = await stateDir();
    const log = new FileLogStore(dir);
    writeFileSync(join(dir, 'log.jsonl'), `${entryLine(1)}\nnot json\n`, { mode: 0o600 });
    expect((await rejection(log.readAll())).message).toContain('line 2 is not valid JSON');
    writeFileSync(join(dir, 'log.jsonl'), `${entryLine(1)}\n{"seq":1}\n`, { mode: 0o600 });
    expect((await rejection(log.readAll())).message).toContain('line 2 is malformed');
    writeFileSync(join(dir, 'log.jsonl'), entryLine(1), { mode: 0o600 });
    expect((await rejection(log.readAll())).message).toContain('incomplete');
    writeFileSync(join(dir, 'log.jsonl'), '', { mode: 0o600 });
    expect(await log.readAll()).toEqual([]);
  });

  it('removes a stale lock left by a crashed process', async () => {
    const dir = await stateDir();
    const log = new FileLogStore(dir);
    const lock = join(dir, 'log.lock');
    writeFileSync(lock, '1\n', { mode: 0o600 });
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    await log.append((previous) => nextEntry(previous, '2026-10-31T10:00:00.000Z', 'job.analyzed', {}));
    expect(existsSync(lock)).toBe(false);
    expect(await log.readAll()).toHaveLength(1);
  });

  it('gives up with a clear message when a live process holds the lock', async () => {
    const dir = await stateDir();
    const log = new FileLogStore(dir, { staleMs: 60_000, waitMs: 120 });
    writeFileSync(join(dir, 'log.lock'), '1\n', { mode: 0o600 });
    const error = await rejection(log.append((previous) => nextEntry(previous, '2026-10-31T10:00:00.000Z', 'job.analyzed', {})));
    expect(error.message).toContain('holds');
    expect(existsSync(join(dir, 'log.lock'))).toBe(true);
    expect(existsSync(join(dir, 'log.jsonl'))).toBe(false);
  });

  it('does not leave a lock behind when the builder throws', async () => {
    const dir = await stateDir();
    const log = new FileLogStore(dir);
    await expect(log.append(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(existsSync(join(dir, 'log.lock'))).toBe(false);
  });
});

describe('FileFactStore', () => {
  it('explains invalid files and keeps the mode of an existing file', async () => {
    const dir = tmp();
    const path = join(dir, 'facts.json');
    const store = new FileFactStore(path);
    writeFileSync(path, '{ nope', { mode: 0o640 });
    const broken = await rejection(store.load());
    expect(broken).toMatchObject({ kind: 'invalid' });
    expect(broken.message).toContain('is not valid JSON');
    writeFileSync(path, JSON.stringify({ schema: 1, facts: [{ id: 'x' }] }));
    const invalid = await rejection(store.load());
    expect(invalid.message).toContain('not a valid facts file');
    expect(invalid.details.join('\n')).toContain('facts[0].claim');
    await store.save(FactBase.empty().add(fact()).value);
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(readFileSync(path, 'utf8').endsWith('}\n')).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ schema: 1, facts: [{ id: 'ts-services', evidence: { kind: 'file-hash' } }] });
  });

  it('creates new facts files private', async () => {
    const path = join(tmp(), 'new-facts.json');
    await new FileFactStore(path).save(FactBase.empty());
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('FileConfigStore', () => {
  it('rejects invalid configuration files', async () => {
    const dir = await stateDir();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ schema: 1 }), { mode: 0o600 });
    expect((await rejection(new FileConfigStore(join(dir, 'config.json')).load())).message).toContain('not a valid configuration');
  });
});

describe('FsEvidenceChecker', () => {
  it('hashes files relative to the facts file and explains failures', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'proof.md'), 'evidence text');
    mkdirSync(join(dir, 'sub'));
    const checker = new FsEvidenceChecker(dir);
    expect(await checker.digestOf('proof.md')).toEqual({ ok: true, digest: sha256('evidence text') });
    expect(await checker.digestOf(join(dir, 'proof.md'))).toEqual({ ok: true, digest: sha256('evidence text') });
    expect(await checker.digestOf('absent.md')).toEqual({ ok: false, reason: 'no such file' });
    expect(await checker.digestOf('sub')).toEqual({ ok: false, reason: 'not a regular file' });
    expect(await checker.digestOf('sub/../proof.md')).toMatchObject({ ok: true });
  });
});

describe('FsFileSink', () => {
  it('writes new files, refuses to overwrite and replaces on request', async () => {
    const path = join(tmp(), 'final.md');
    const sink = new FsFileSink();
    await sink.write(path, 'one\n', { overwrite: false });
    expect((await rejection(sink.write(path, 'two\n', { overwrite: false }))).kind).toBe('refused');
    expect(readFileSync(path, 'utf8')).toBe('one\n');
    await sink.write(path, 'two\n', { overwrite: true });
    expect(readFileSync(path, 'utf8')).toBe('two\n');
    expect((await rejection(sink.write(join(tmp(), 'missing-dir', 'f.md'), 'x', { overwrite: false }))).kind).toBe('io');
  });
});
