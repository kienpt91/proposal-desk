import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { AppError } from '../../application/errors.js';
import type { ConfigStore, EvidenceChecker, EvidenceDigest, FactStore, FileSink, LogStore, ObjectStore } from '../../application/ports/index.js';
import { parseConfig, type Config } from '../../domain/config/config.js';
import { FactBase } from '../../domain/facts/fact-base.js';
import { parseLogEntry, type LogEntry } from '../../domain/log/chain.js';
import { escapeUnsafe } from '../../domain/shared/text-safety.js';
import { DEFAULT_LOCK, FileLock, type LockTiming } from './lock.js';
import { ensurePrivateDir, isMissing, readTextIfExists, SIZE_LIMITS, STATE_FILE, USER_FILE, writeTextAtomic, type TrustOptions } from './safe-fs.js';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError('invalid', `${what} is not valid JSON`, [error instanceof Error ? escapeUnsafe(error.message) : 'parse error']);
  }
}

/** facts.json at any path the user chooses. New files are created private (0600); changes are made under a lock so concurrent runs cannot lose each other's updates. */
export class FileFactStore implements FactStore {
  constructor(
    readonly location: string,
    private readonly trust: TrustOptions = USER_FILE,
    private readonly timing: LockTiming = DEFAULT_LOCK,
  ) {}

  async load(): Promise<FactBase | undefined> {
    const text = await readTextIfExists(this.location, SIZE_LIMITS.factsFile, this.trust);
    if (text === undefined) return undefined;
    const parsed = FactBase.parse(parseJson(text, this.location));
    if (!parsed.ok) throw new AppError('invalid', `${this.location} is not a valid facts file`, parsed.error);
    return parsed.value;
  }

  async update(change: (current: FactBase | undefined) => Promise<FactBase> | FactBase): Promise<void> {
    const lock = await new FileLock(`${this.location}.lock`, this.timing, 'facts file').acquire();
    try {
      const next = await change(await this.load());
      await lock.assertHeld();
      await writeTextAtomic(this.location, `${JSON.stringify(next.toDocument(), null, 2)}\n`, { mode: 0o600, overwrite: true, trust: this.trust });
    } finally {
      await lock.release();
    }
  }
}

/** Hashes local evidence files, resolving relative references against a base directory. A symbolic link, a FIFO or any other
 *  non-regular file is refused without being opened for reading. */
export class FsEvidenceChecker implements EvidenceChecker {
  constructor(private readonly baseDir: string) {}

  async digestOf(reference: string): Promise<EvidenceDigest> {
    const path = isAbsolute(reference) ? reference : resolve(this.baseDir, reference);
    let before;
    try {
      before = await fs.lstat(path);
    } catch (error) {
      return { ok: false, reason: isMissing(error) ? 'no such file' : `cannot open (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
    }
    if (before.isSymbolicLink()) return { ok: false, reason: 'a symbolic link (point at the file itself)' };
    if (!before.isFile()) return { ok: false, reason: 'not a regular file' };
    let handle;
    try {
      handle = await fs.open(path, constants.O_RDONLY | NOFOLLOW | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
      return { ok: false, reason: `cannot open (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return { ok: false, reason: 'not a regular file' };
      if (stat.size > SIZE_LIMITS.evidenceFile) return { ok: false, reason: `larger than ${SIZE_LIMITS.evidenceFile} bytes` };
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
      return { ok: true, digest: hash.digest('hex') };
    } catch (error) {
      return { ok: false, reason: `cannot read (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
    } finally {
      await handle.close();
    }
  }
}

/** Active configuration in `<state>/config.json`. */
export class FileConfigStore implements ConfigStore {
  constructor(private readonly path: string) {}

  async load(): Promise<Config | undefined> {
    const text = await readTextIfExists(this.path, SIZE_LIMITS.configFile, STATE_FILE);
    if (text === undefined) return undefined;
    const parsed = parseConfig(parseJson(text, this.path));
    if (!parsed.ok) throw new AppError('invalid', `${this.path} is not a valid configuration`, parsed.error);
    return parsed.value;
  }

  async save(config: Config): Promise<void> {
    await writeTextAtomic(this.path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, overwrite: true, trust: STATE_FILE });
  }
}

/** Write-once, content-addressed objects in `<state>/objects/<sha256>`. */
export class FileObjectStore implements ObjectStore {
  constructor(private readonly dir: string) {}

  private pathOf(digest: string): string {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new AppError('invalid', 'an object key must be a SHA-256 digest');
    return join(this.dir, digest);
  }

  async put(content: string): Promise<string> {
    if (Buffer.byteLength(content, 'utf8') > SIZE_LIMITS.object) throw new AppError('invalid', `objects are limited to ${SIZE_LIMITS.object} bytes`);
    const digest = createHash('sha256').update(content, 'utf8').digest('hex');
    await ensurePrivateDir(this.dir);
    const path = this.pathOf(digest);
    try {
      await writeTextAtomic(path, content, { mode: 0o600, overwrite: false, trust: STATE_FILE });
    } catch (error) {
      if (!(error instanceof AppError && error.kind === 'refused')) throw error; // already stored: content-addressed, so identical
    }
    return digest;
  }

  async get(digest: string): Promise<string | undefined> {
    const text = await readTextIfExists(this.pathOf(digest), SIZE_LIMITS.object, STATE_FILE);
    if (text === undefined) return undefined;
    if (createHash('sha256').update(text, 'utf8').digest('hex') !== digest) throw new AppError('io', `object ${digest.slice(0, 12)} no longer matches its digest; the state directory was modified`);
    return text;
  }
}

/** `<state>/log.jsonl`: one JSON entry per line, appended under a lock file so concurrent runs cannot fork the chain. */
export class FileLogStore implements LogStore {
  private readonly file: string;
  private readonly lockFile: string;

  constructor(
    private readonly dir: string,
    private readonly timing: LockTiming = DEFAULT_LOCK,
  ) {
    this.file = join(dir, 'log.jsonl');
    this.lockFile = join(dir, 'log.lock');
  }

  async readAll(): Promise<LogEntry[]> {
    const text = await readTextIfExists(this.file, SIZE_LIMITS.logFile, STATE_FILE);
    if (text === undefined || text === '') return [];
    if (!text.endsWith('\n')) throw new AppError('io', `${this.file} does not end with a newline; the last entry is incomplete`);
    return text
      .slice(0, -1)
      .split('\n')
      .map((line, index) => {
        const parsed = parseLogEntry(parseJson(line, `${this.file} line ${index + 1}`));
        if (!parsed.ok) throw new AppError('io', `${this.file} line ${index + 1} is malformed`, parsed.error);
        return parsed.value;
      });
  }

  async append(build: (previous: LogEntry | undefined) => LogEntry): Promise<LogEntry> {
    await ensurePrivateDir(this.dir);
    const lock = await new FileLock(this.lockFile, this.timing, 'log').acquire();
    try {
      const previous = (await this.readAll()).at(-1);
      const entry = build(previous);
      await lock.assertHeld();
      const handle = await fs.open(this.file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW, 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(entry)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await lock.assertHeld();
      return entry;
    } finally {
      await lock.release();
    }
  }
}

/** Final files requested by the user (the exported proposal). */
export class FsFileSink implements FileSink {
  async write(path: string, content: string, options: { readonly overwrite: boolean }): Promise<void> {
    await writeTextAtomic(path, content, { mode: 0o600, overwrite: options.overwrite, trust: USER_FILE });
  }
}

