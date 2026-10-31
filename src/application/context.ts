import { configDigest, defaultConfig, type Config } from '../domain/config/config.js';
import type { FactBase } from '../domain/facts/fact-base.js';
import { recheckFacts, referencesToCheck, type EvidenceCheck } from '../domain/facts/recheck.js';
import { GENESIS, nextEntry, verifyChain, type LogEntry, type LogEventType, type Payload } from '../domain/log/chain.js';
import { signPayload, verifyEntryMac } from '../domain/log/auth.js';
import { dayOf } from '../domain/shared/date.js';
import { sha256 } from '../domain/shared/sha256.js';
import { AppError } from './errors.js';
import type { Deps, FactsHandle } from './ports/index.js';

export interface ConfigStatus {
  readonly config: Config;
  /** True when config.json exists and matches the last configuration a human applied (or the defaults). */
  readonly trusted: boolean;
  readonly problem: string | undefined;
}

/**
 * The active configuration and whether it can be trusted. config.json is only honoured when its digest equals the
 * digest in the last authenticated `config.applied` entry (the defaults when none exists), so editing the file
 * by hand changes nothing until a human applies a proposal.
 */
export async function inspectConfig(deps: Deps): Promise<ConfigStatus> {
  const stored = await deps.config.load();
  if (stored === undefined) return { config: defaultConfig(), trusted: true, problem: undefined };
  const entries = await deps.log.readAll();
  const applied = entries.filter((e) => e.type === 'config.applied').at(-1);
  if (applied === undefined) {
    return configDigest(stored) === configDigest(defaultConfig())
      ? { config: stored, trusted: true, problem: undefined }
      : { config: stored, trusted: false, problem: 'config.json differs from the defaults but no configuration was ever applied' };
  }
  try {
    await requireAuthentic(deps, applied, 'the record of the last applied configuration');
  } catch (error) {
    if (error instanceof AppError) return { config: stored, trusted: false, problem: error.message };
    throw error;
  }
  if (applied.payload.configDigest !== configDigest(stored)) {
    return { config: stored, trusted: false, problem: `config.json does not match configuration version ${String(applied.payload.version)}, the last one a human applied` };
  }
  return { config: stored, trusted: true, problem: undefined };
}

export async function loadConfig(deps: Deps): Promise<Config> {
  const status = await inspectConfig(deps);
  if (!status.trusted) {
    throw new AppError('refused', `the configuration cannot be trusted: ${status.problem ?? 'unknown problem'}`, [
      'Configuration changes go through `config propose` and `config apply`.',
      'Restore config.json, or delete it to return to the built-in defaults.',
    ]);
  }
  return status.config;
}

export async function requireFacts(handle: FactsHandle): Promise<FactBase> {
  const base = await handle.store.load();
  if (base === undefined) {
    throw new AppError('missing', `no facts file at ${handle.store.location}`, ['Add facts with `facts add`, or pass --facts <path> to use another file (see examples/facts.json).']);
  }
  return base;
}

export interface CheckedFacts {
  readonly base: FactBase;
  readonly notices: readonly string[];
  readonly location: string;
}

/**
 * The facts as they are now. Every checkable evidence file is re-hashed (once per file, size-bounded by the adapter), so a fact is
 * `verified` only if its evidence matches today; the status stored in the facts file is never trusted on its own.
 */
export async function requireCheckedFacts(deps: Deps, handle: FactsHandle): Promise<CheckedFacts> {
  const base = await requireFacts(handle);
  const checks = new Map<string, EvidenceCheck>();
  for (const reference of referencesToCheck(base)) checks.set(reference, await handle.evidence.digestOf(reference));
  const rechecked = recheckFacts(base, checks, today(deps));
  return { base: rechecked.base, notices: rechecked.notices, location: handle.store.location };
}

export function today(deps: Deps): string {
  return dayOf(deps.clock.now());
}

/** Appends one event to the log with the current time. */
export async function record(deps: Deps, type: LogEventType, payload: Payload): Promise<LogEntry> {
  const ts = deps.clock.now();
  return deps.log.append((previous) => nextEntry(previous, ts, type, payload));
}

/** Appends an entry whose payload carries a keyed MAC over its type, payload and position in the chain. */
export async function recordAuthenticated(deps: Deps, type: LogEventType, payload: Payload): Promise<LogEntry> {
  const key = await deps.secrets.loadOrCreate();
  const ts = deps.clock.now();
  return deps.log.append((previous) => nextEntry(previous, ts, type, signPayload(key, type, payload, previous?.hash ?? GENESIS)));
}

/**
 * The log entries, after checking that the hash chain is intact. Used wherever an entry is relied upon
 * (export, configuration loading) so a doctored log is refused instead of believed.
 */
export async function readVerifiedLog(deps: Deps): Promise<LogEntry[]> {
  const entries = await deps.log.readAll();
  const chain = verifyChain(entries);
  if (!chain.ok) {
    throw new AppError('refused', `the log failed verification (hash chain broken at entry ${chain.brokenAt}: ${chain.reason})`, ['Run `verify-log`. Nothing that depends on the log is trusted until it passes.']);
  }
  return entries;
}

/** Refuses an authenticated entry whose MAC is missing or wrong, or when the key is gone. */
export async function requireAuthentic(deps: Deps, entry: LogEntry, what: string): Promise<void> {
  const key = await deps.secrets.load();
  if (key === undefined) {
    throw new AppError('refused', `${what} is not authentic: there is no secret.key in the state directory to check it with`, ['An approval or applied configuration made before the key was lost has to be made again.']);
  }
  if (!verifyEntryMac(key, entry)) {
    throw new AppError('refused', `${what} is not authentic (entry ${entry.seq} was not written by this tool with this state directory's key)`, ['The log may have been edited or copied from another state directory. Approve again at a terminal.']);
  }
}

/** Stores job text (already newline-normalised) and checks that its key is the digest the domain computed. */
export async function storeObject(deps: Deps, content: string, expectedDigest?: string): Promise<string> {
  const digest = await deps.objects.put(content);
  if (digest !== (expectedDigest ?? sha256(content))) throw new AppError('io', 'the object store returned an unexpected digest');
  return digest;
}

/** Finds an entry id by exact value or a unique prefix of at least 4 characters. */
export function resolveId(candidates: readonly string[], wanted: string, what: string): string {
  const unique = [...new Set(candidates)];
  if (unique.includes(wanted)) return wanted;
  const matches = wanted.length >= 4 ? unique.filter((id) => id.startsWith(wanted)) : [];
  if (matches.length === 1) return matches[0] as string;
  if (matches.length > 1) throw new AppError('invalid', `${what} "${wanted}" is ambiguous: ${matches.join(', ')}`);
  throw new AppError('missing', `no ${what} "${wanted}" in the log`);
}
