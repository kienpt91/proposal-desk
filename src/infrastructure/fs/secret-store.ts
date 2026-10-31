import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { AppError } from '../../application/errors.js';
import type { SecretStore } from '../../application/ports/index.js';
import { bytesToHex, hexToBytes } from '../../domain/shared/hmac.js';
import { KEY_BYTES } from '../../domain/log/auth.js';
import { ensurePrivateDir, readTextIfExists, STATE_FILE, writeTextAtomic } from './safe-fs.js';

/** `<state>/secret.key`: 32 random bytes as 64 hex characters, mode 0600, created once and never rewritten. */
export class FileSecretStore implements SecretStore {
  private readonly path: string;

  constructor(private readonly dir: string) {
    this.path = join(dir, 'secret.key');
  }

  async load(): Promise<Uint8Array | undefined> {
    const text = await readTextIfExists(this.path, 256, STATE_FILE);
    if (text === undefined) return undefined;
    if (!/^[0-9a-f]{64}\n?$/.test(text)) throw new AppError('io', `${this.path} is malformed (expected ${KEY_BYTES} bytes as hex); the state directory was modified`);
    return hexToBytes(text.trim());
  }

  async loadOrCreate(): Promise<Uint8Array> {
    const existing = await this.load();
    if (existing !== undefined) return existing;
    await ensurePrivateDir(this.dir);
    try {
      await writeTextAtomic(this.path, `${bytesToHex(randomBytes(KEY_BYTES))}\n`, { mode: 0o600, overwrite: false, trust: STATE_FILE });
    } catch (error) {
      if (!(error instanceof AppError && error.kind === 'refused')) throw error; // another process created it first: use theirs
    }
    const created = await this.load();
    if (created === undefined) throw new AppError('io', `cannot create ${this.path}`);
    return created;
  }
}
