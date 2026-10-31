import type { Config } from '../../domain/config/config.js';
import type { FactBase } from '../../domain/facts/fact-base.js';
import type { LogEntry } from '../../domain/log/chain.js';

/** Source of the current time as an ISO timestamp ("2026-10-31T10:00:00.000Z"). The domain never reads a clock. */
export interface Clock {
  now(): string;
}

/** Where one facts.json lives. The file is the user's property: it may be anywhere, it is never uploaded. */
export interface FactStore {
  /** Human-readable location, for messages. */
  readonly location: string;
  /** The facts, or undefined when the file does not exist yet. Throws AppError when it exists but cannot be read or parsed. */
  load(): Promise<FactBase | undefined>;
  save(base: FactBase): Promise<void>;
}

export type EvidenceDigest = { readonly ok: true; readonly digest: string } | { readonly ok: false; readonly reason: string };

/** Hashes the local file a fact points at (relative paths are resolved against the facts file). Never touches the network. */
export interface EvidenceChecker {
  digestOf(reference: string): Promise<EvidenceDigest>;
}

/** Append-only log of everything that happened. Appends are atomic with respect to other processes. */
export interface LogStore {
  readAll(): Promise<LogEntry[]>;
  /** Reads the last entry and appends the entry `build` produces from it, under one lock. */
  append(build: (previous: LogEntry | undefined) => LogEntry): Promise<LogEntry>;
}

/** Write-once, content-addressed text storage (job posts, drafts, configuration proposals). */
export interface ObjectStore {
  /** Stores `content` and returns its SHA-256 hex digest (also its key). */
  put(content: string): Promise<string>;
  /** The content, or undefined when absent. Throws AppError when the stored bytes no longer match the key. */
  get(digest: string): Promise<string | undefined>;
}

/** The active configuration; absent means the built-in defaults. */
export interface ConfigStore {
  load(): Promise<Config | undefined>;
  save(config: Config): Promise<void>;
}

/** The per-state-directory secret that authenticates approvals and applied configurations. It is never printed or logged. */
export interface SecretStore {
  /** The key, or undefined when none exists yet. Throws AppError when a key file exists but is unusable. */
  load(): Promise<Uint8Array | undefined>;
  /** The key, created from secure randomness (private file) when absent. */
  loadOrCreate(): Promise<Uint8Array>;
}

export interface ConfirmRequest {
  readonly title: string;
  /** Lines shown to the human before the question. Untrusted text is escaped by the adapter. */
  readonly lines: readonly string[];
  /** The exact text the human must type to confirm, for example `approve 1a2b3c4d`. */
  readonly token: string;
}

/** Interactive human confirmation. The real adapter refuses to run without a terminal. */
export interface Prompt {
  confirm(request: ConfirmRequest): Promise<boolean>;
}

/** Writes a final file the user asked for; refuses to overwrite unless told to. */
export interface FileSink {
  write(path: string, content: string, options: { readonly overwrite: boolean }): Promise<void>;
}

export interface FactsHandle {
  readonly store: FactStore;
  readonly evidence: EvidenceChecker;
}

export interface Deps {
  readonly clock: Clock;
  readonly log: LogStore;
  readonly objects: ObjectStore;
  readonly config: ConfigStore;
  readonly secrets: SecretStore;
  readonly prompt: Prompt;
  readonly sink: FileSink;
  /** Opens the facts file at `path`, or the default location (in the state directory) when undefined. */
  facts(path: string | undefined): FactsHandle;
}
