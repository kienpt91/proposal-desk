import { randomBytes } from 'node:crypto';
import { constants, promises as fs, type Stats } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { AppError } from '../../application/errors.js';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/** Size limits, in bytes. Every read in the tool is bounded. */
export const SIZE_LIMITS = {
  factsFile: 1_048_576,
  configFile: 65_536,
  object: 524_288,
  jobFile: 262_144,
  metaFile: 16_384,
  proposalFile: 262_144,
  logFile: 134_217_728,
  evidenceFile: 268_435_456,
} as const;

export interface TrustOptions {
  /** Refuse symbolic links at the final path component. */
  readonly noFollow: boolean;
  /** Refuse files and directories that other users own or can read (state directory contents). */
  readonly private: boolean;
  /** The uid the owner must have; defaults to the current user. */
  readonly uid?: number;
}

export const STATE_FILE: TrustOptions = { noFollow: true, private: true };
export const USER_FILE: TrustOptions = { noFollow: false, private: false };

function currentUid(options: TrustOptions): number | undefined {
  return options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);
}

function ioError(message: string, cause?: unknown): AppError {
  const detail = cause instanceof Error && 'code' in cause ? ` (${String((cause as NodeJS.ErrnoException).code)})` : '';
  return new AppError('io', `${message}${detail}`);
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function checkStat(path: string, stat: Stats, options: TrustOptions, kind: 'file' | 'directory'): void {
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) throw ioError(`${path} is not a regular ${kind}`);
  const uid = currentUid(options);
  if (options.private && uid !== undefined && stat.uid !== uid) throw ioError(`${path} is owned by another user`);
  if (options.private && (stat.mode & 0o077) !== 0) {
    const mode = (stat.mode & 0o777).toString(8).padStart(4, '0');
    throw ioError(`${path} is accessible by other users (mode ${mode}); run: chmod ${kind === 'file' ? '600' : '700'} ${path}`);
  }
}

/** Creates the directory (mode 0700) if needed and checks it is a private directory of ours, not a symbolic link. */
export async function ensurePrivateDir(path: string, options: TrustOptions = STATE_FILE): Promise<void> {
  try {
    await fs.mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink()) throw ioError(`${path} is a symbolic link; refusing to use it as a state directory`);
    checkStat(path, stat, options, 'directory');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw ioError(`cannot prepare directory ${path}`, error);
  }
}

async function readCapped(handle: fs.FileHandle, max: number, path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const buffer = Buffer.allocUnsafe(Math.min(65_536, max + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > max) throw new AppError('invalid', `${path} is larger than the ${max}-byte limit`);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks);
}

/** Reads a UTF-8 text file, bounded, without following symbolic links when asked. Returns undefined when it does not exist. */
export async function readTextIfExists(path: string, maxBytes: number, options: TrustOptions): Promise<string | undefined> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | (options.noFollow ? NOFOLLOW : 0));
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ELOOP') throw ioError(`${path} is a symbolic link; refusing to read it`);
    throw ioError(`cannot open ${path}`, error);
  }
  try {
    const stat = await handle.stat();
    checkStat(path, stat, options, 'file');
    if (stat.size > maxBytes) throw new AppError('invalid', `${path} is larger than the ${maxBytes}-byte limit`);
    const bytes = await readCapped(handle, maxBytes, path);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AppError('invalid', `${path} is not valid UTF-8 text`);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw ioError(`cannot read ${path}`, error);
  } finally {
    await handle.close();
  }
}

export async function readText(path: string, maxBytes: number, options: TrustOptions = USER_FILE): Promise<string> {
  const text = await readTextIfExists(path, maxBytes, options);
  if (text === undefined) throw new AppError('missing', `no such file: ${path}`);
  return text;
}

export interface WriteOptions {
  /** Permission bits for a newly created file. */
  readonly mode: number;
  /** Replace an existing file; when false an existing file is an error. */
  readonly overwrite: boolean;
  /** Refuse to replace a symbolic link or write into a directory we do not own. */
  readonly trust: TrustOptions;
}

/**
 * Writes `content` to a temporary file in the same directory (exclusive create, 0600, no symlink following),
 * flushes it, then renames it into place. Readers see the old file or the new one, never a partial write.
 */
export async function writeTextAtomic(path: string, content: string, options: WriteOptions): Promise<void> {
  const dir = dirname(path);
  const temporary = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let existingMode: number | undefined;
  try {
    const existing = await fs.lstat(path).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)));
    if (existing !== undefined) {
      if (existing.isSymbolicLink()) throw ioError(`${path} is a symbolic link; refusing to replace it`);
      if (!existing.isFile()) throw ioError(`${path} is not a regular file`);
      if (!options.overwrite) throw new AppError('refused', `${path} already exists (use --force to replace it)`);
      existingMode = existing.mode & 0o777;
    }
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, existingMode ?? options.mode);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (options.overwrite) {
      await fs.rename(temporary, path);
    } else {
      await fs.link(temporary, path); // fails with EEXIST if another process created it meanwhile
      await fs.unlink(temporary);
    }
    await syncDirectory(dir);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    if (error instanceof AppError) throw error;
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('refused', `${path} already exists (use --force to replace it)`);
    throw ioError(`cannot write ${path}`, error);
  }
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await fs.open(dir, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Not every platform lets a directory be synced; the rename itself is already atomic.
  }
}
