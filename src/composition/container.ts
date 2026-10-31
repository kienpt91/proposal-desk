import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Clock, Deps, FactsHandle, Prompt } from '../application/ports/index.js';
import { ensurePrivateDir, STATE_FILE, USER_FILE } from '../infrastructure/fs/safe-fs.js';
import { FileConfigStore, FileFactStore, FileLogStore, FileObjectStore, FsEvidenceChecker, FsFileSink } from '../infrastructure/fs/stores.js';
import { TtyPrompt, type TerminalStreams } from '../infrastructure/prompt/tty-prompt.js';

export interface ContainerOptions {
  /** `--state` from the command line, if given. */
  readonly state: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Terminal used for human confirmation. */
  readonly terminal: TerminalStreams;
  /** Replaceable in tests; defaults to the system clock and the real terminal prompt. */
  readonly clock?: Clock;
  readonly prompt?: Prompt;
}

/**
 * Where state lives: --state, else PROPOSAL_DESK_STATE, else $XDG_STATE_HOME/proposal-desk (absolute paths only),
 * else ~/.local/state/proposal-desk.
 */
export function resolveStateDir(state: string | undefined, env: Readonly<Record<string, string | undefined>>, home: string = homedir()): string {
  if (state !== undefined) return resolve(state);
  const fromEnv = env.PROPOSAL_DESK_STATE;
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv);
  const xdg = env.XDG_STATE_HOME;
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, '.local', 'state');
  return join(base, 'proposal-desk');
}

/** Builds the real adapters. Creates the state directory (0700) and refuses an unsafe one. */
export async function createDeps(options: ContainerOptions): Promise<Deps> {
  const stateDir = resolveStateDir(options.state, options.env);
  await ensurePrivateDir(stateDir);
  const systemClock: Clock = { now: () => new Date().toISOString() };
  return {
    clock: options.clock ?? systemClock,
    log: new FileLogStore(stateDir),
    objects: new FileObjectStore(join(stateDir, 'objects')),
    config: new FileConfigStore(join(stateDir, 'config.json')),
    prompt: options.prompt ?? new TtyPrompt(options.terminal),
    sink: new FsFileSink(),
    facts(path: string | undefined): FactsHandle {
      if (path === undefined) {
        return { store: new FileFactStore(join(stateDir, 'facts.json'), STATE_FILE), evidence: new FsEvidenceChecker(stateDir) };
      }
      const file = resolve(path);
      return { store: new FileFactStore(file, USER_FILE), evidence: new FsEvidenceChecker(dirname(file)) };
    },
  };
}
