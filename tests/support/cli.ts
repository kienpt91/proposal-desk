import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createDeps } from '../../src/composition/container.js';
import { VERSION } from '../../src/composition/version.js';
import type { Clock, Prompt } from '../../src/application/ports/index.js';
import { runCli } from '../../src/infrastructure/cli/run.js';
import type { CliIo } from '../../src/infrastructure/cli/output.js';
import { ScriptedPrompt } from './fakes.js';
import { ROOT } from './analysis.js';

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Session {
  readonly dir: string;
  readonly state: string;
  readonly facts: string;
  readonly job: string;
  readonly prompt: ScriptedPrompt;
  /** `prompt: 'terminal'` uses the real terminal prompt on non-terminal streams, as in a script or a pipe. */
  run(argv: readonly string[], options?: { stdin?: string; env?: Record<string, string>; prompt?: Prompt | 'terminal'; clock?: Clock }): Promise<RunResult>;
}

/** A temporary working directory with the shipped example facts, evidence and job post, and a fresh state directory. */
export function session(): Session {
  const dir = mkdtempSync(join(tmpdir(), 'proposal-desk-e2e-'));
  cpSync(join(ROOT, 'examples'), join(dir, 'examples'), { recursive: true });
  const state = join(dir, 'state');
  const prompt = new ScriptedPrompt(true);
  let now = Date.parse('2026-10-31T10:00:00.000Z');
  const clock: Clock = {
    now: () => {
      now += 1000;
      return new Date(now).toISOString();
    },
  };
  return {
    dir,
    state,
    facts: join(dir, 'examples', 'facts.json'),
    job: join(dir, 'examples', 'job-post.txt'),
    prompt,
    async run(argv, options = {}) {
      let stdout = '';
      let stderr = '';
      const io: CliIo = {
        stdout: (text) => void (stdout += text),
        stderr: (text) => void (stderr += text),
        env: { ...options.env },
        readStdin: async (max) => {
          const text = options.stdin ?? '';
          if (text.length > max) throw new Error('too large');
          return text;
        },
      };
      const terminal = { input: Object.assign(new PassThrough(), { isTTY: false }), output: Object.assign(new PassThrough(), { isTTY: false }) };
      const code = await runCli(argv, {
        io,
        version: VERSION,
        makeDeps: ({ state: flag }) =>
          createDeps({ state: flag ?? state, env: { ...options.env }, terminal, clock: options.clock ?? clock, ...(options.prompt === 'terminal' ? {} : { prompt: options.prompt ?? prompt }) }),
      });
      return { code, stdout, stderr };
    },
  };
}

export function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** The draft id printed in the footer of `draft`. */
export function draftIdOf(stderr: string): string {
  const m = /Draft (d-[0-9a-f]{12}):/.exec(stderr);
  if (m === null) throw new Error(`no draft id in: ${stderr}`);
  return m[1] as string;
}
