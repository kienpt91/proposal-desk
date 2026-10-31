import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { AppError } from '../../application/errors.js';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export interface LockTiming {
  /** A lock file with unreadable contents, older than this, is taken over. */
  readonly staleMs: number;
  /** How long to wait for a lock held by a running process before giving up. */
  readonly waitMs: number;
  /** A lock held for longer than this is taken over even if its process id is alive (a recycled id, a hung process). */
  readonly maxHoldMs: number;
}

export const DEFAULT_LOCK: LockTiming = { staleMs: 30_000, waitMs: 5_000, maxHoldMs: 600_000 };

interface Holder {
  readonly raw: string;
  readonly pid: number | undefined;
  readonly ageMs: number;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'; // exists, owned by someone else
  }
}

async function readHolder(path: string): Promise<Holder | undefined> {
  try {
    const [stat, raw] = await Promise.all([fs.lstat(path), fs.readFile(path, { encoding: 'utf8' }).then((t) => t.slice(0, 128))]);
    const m = /^(\d{1,10}):[0-9a-f]{6,32}\s*$/.exec(raw);
    return { raw, pid: m === null ? undefined : Number(m[1]), ageMs: Date.now() - stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new AppError('io', `cannot read the lock file ${path} (${(error as NodeJS.ErrnoException).code ?? 'error'})`);
  }
}

function isStale(holder: Holder, timing: LockTiming): boolean {
  if (holder.pid === undefined) return holder.ageMs > timing.staleMs;
  return !isAlive(holder.pid) || holder.ageMs > timing.maxHoldMs;
}

/**
 * An exclusive lock in a file. The file holds `<pid>:<random token>`. A lock whose process is gone is taken over at once; one
 * whose process is alive is waited for. A holder checks, before it writes, that the file still carries its own token, so a lock
 * that was taken away is noticed instead of silently shared.
 */
export class FileLock {
  constructor(
    private readonly path: string,
    private readonly timing: LockTiming = DEFAULT_LOCK,
    private readonly what: string = 'file',
  ) {}

  async acquire(): Promise<HeldLock> {
    const token = `${process.pid}:${randomBytes(6).toString('hex')}`;
    const deadline = Date.now() + this.timing.waitMs;
    for (;;) {
      try {
        const handle = await fs.open(this.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
        try {
          await handle.writeFile(`${token}\n`);
        } finally {
          await handle.close();
        }
        return new HeldLock(this.path, token, this.what);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new AppError('io', `cannot lock the ${this.what}: ${(error as Error).message}`);
      }
      const holder = await readHolder(this.path);
      if (holder === undefined) continue;
      if (isStale(holder, this.timing)) {
        await this.takeOver(holder, token);
        continue;
      }
      if (Date.now() > deadline) throw new AppError('io', `another proposal-desk process holds ${this.path}; remove it if no process is running`);
      await sleep(25);
    }
  }

  /** Moves a stale lock out of the way (a rename, so only one contender succeeds) and puts it back if it turns out not to be the stale one. */
  private async takeOver(holder: Holder, token: string): Promise<void> {
    const graveyard = `${this.path}.stale.${token.replace(':', '-')}`;
    try {
      await fs.rename(this.path, graveyard);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new AppError('io', `cannot take over the lock ${this.path} (${(error as NodeJS.ErrnoException).code ?? 'error'})`);
    }
    const moved = await fs.readFile(graveyard, { encoding: 'utf8' }).catch(() => '');
    if (moved !== holder.raw) await fs.link(graveyard, this.path).catch(() => undefined); // we moved a fresh lock: restore it
    await fs.unlink(graveyard).catch(() => undefined);
  }
}

export class HeldLock {
  constructor(
    private readonly path: string,
    private readonly token: string,
    private readonly what: string,
  ) {}

  /** Throws when another process has taken the lock over; call it right before writing. */
  async assertHeld(): Promise<void> {
    const current = await fs.readFile(this.path, { encoding: 'utf8' }).catch(() => '');
    if (current.trim() !== this.token) {
      throw new AppError('io', `the lock on the ${this.what} was lost: another process took it over, so nothing was written (run verify-log if you suspect damage)`);
    }
  }

  async release(): Promise<void> {
    const current = await fs.readFile(this.path, { encoding: 'utf8' }).catch(() => '');
    if (current.trim() === this.token) await fs.unlink(this.path).catch(() => undefined);
  }
}
