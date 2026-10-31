import { defaultConfig, type Config } from '../domain/config/config.js';
import type { FactBase } from '../domain/facts/fact-base.js';
import { nextEntry, type LogEntry, type LogEventType, type Payload } from '../domain/log/chain.js';
import { dayOf } from '../domain/shared/date.js';
import { sha256 } from '../domain/shared/sha256.js';
import { AppError } from './errors.js';
import type { Deps, FactsHandle } from './ports/index.js';

export async function loadConfig(deps: Deps): Promise<Config> {
  return (await deps.config.load()) ?? defaultConfig();
}

export async function requireFacts(handle: FactsHandle): Promise<FactBase> {
  const base = await handle.store.load();
  if (base === undefined) {
    throw new AppError('missing', `no facts file at ${handle.store.location}`, ['Add facts with `facts add`, or pass --facts <path> to use another file (see examples/facts.json).']);
  }
  return base;
}

export function today(deps: Deps): string {
  return dayOf(deps.clock.now());
}

/** Appends one event to the log with the current time. */
export async function record(deps: Deps, type: LogEventType, payload: Payload): Promise<LogEntry> {
  const ts = deps.clock.now();
  return deps.log.append((previous) => nextEntry(previous, ts, type, payload));
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
