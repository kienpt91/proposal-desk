import { AppError } from '../../application/errors.js';
import type { Deps } from '../../application/ports/index.js';
import { escapeUnsafe } from '../../domain/shared/text-safety.js';
import { GLOBAL_FLAGS, UsageError, flagString, parseArgs } from './args.js';
import { COMMANDS, type Command } from './commands.js';
import { Output, type CliIo } from './output.js';

export interface CliEnvironment {
  readonly io: CliIo;
  readonly version: string;
  /** Builds the adapters. Called once per run, after the arguments were understood and only for commands that need state. */
  makeDeps(options: { readonly state: string | undefined }): Promise<Deps>;
}

const EXIT = { ok: 0, failed: 1, usage: 2, internal: 3 } as const;

function findCommand(tokens: readonly string[]): { command: Command; rest: readonly string[] } | undefined {
  for (const command of COMMANDS) {
    if (command.path.every((word, i) => tokens[i] === word)) return { command, rest: tokens.slice(command.path.length) };
  }
  return undefined;
}

function usageOf(command: Command): string {
  const positional = command.positionals.map((p) => (p.optional === true ? `[${p.name}${p.variadic === true ? '...' : ''}]` : `<${p.name}>`)).join(' ');
  return `proposal-desk ${command.path.join(' ')}${positional === '' ? '' : ` ${positional}`}${command.flags.length > 0 ? ' [options]' : ''}`;
}

export function commandHelp(command: Command): string {
  const lines = [usageOf(command), '', command.summary];
  if (command.description !== undefined) lines.push('', command.description);
  const flags = [...command.flags, ...GLOBAL_FLAGS];
  lines.push('', 'Options:');
  const width = Math.max(...flags.map((f) => `--${f.name}${f.value === undefined ? '' : ` ${f.value}`}`.length));
  for (const f of flags) lines.push(`  ${`--${f.name}${f.value === undefined ? '' : ` ${f.value}`}`.padEnd(width)}  ${f.help}`);
  return lines.join('\n');
}

export function topHelp(version: string): string {
  const width = Math.max(...COMMANDS.map((c) => c.path.join(' ').length));
  return [
    `proposal-desk ${version}`,
    'Decide whether a job post is worth applying to, and draft a proposal in which every claim is backed by a verified fact.',
    'It never fetches, logs in, or submits anything: you paste the job, review the output and send it yourself.',
    '',
    'Usage: proposal-desk <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${c.path.join(' ').padEnd(width)}  ${c.summary}`),
    '',
    'Run `proposal-desk <command> --help` for the options of one command.',
    'Exit status: 0 success, 1 a check or policy said no, 2 wrong usage, 3 the state directory or a file could not be used safely.',
  ].join('\n');
}

/** Runs one command line and returns the exit status. Never throws. */
export async function runCli(argv: readonly string[], env: CliEnvironment): Promise<number> {
  const out = new Output(env.io);
  try {
    const [first] = argv;
    if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
      const target = first === 'help' ? findCommand(argv.slice(1)) : undefined;
      out.out(target === undefined ? topHelp(env.version) : commandHelp(target.command));
      return first === undefined ? EXIT.usage : EXIT.ok;
    }
    if (first === '--version' || first === '-v' || first === 'version') {
      out.out(`proposal-desk ${env.version}`);
      return EXIT.ok;
    }
    const found = findCommand(argv);
    if (found === undefined) throw new UsageError(`unknown command ${JSON.stringify(escapeUnsafe(argv.slice(0, 2).join(' ')))}`);
    const { command } = found;
    if (found.rest.includes('--help') || found.rest.includes('-h')) {
      out.out(commandHelp(command));
      return EXIT.ok;
    }
    const args = parseArgs(found.rest, command.flags, command.positionals);
    const deps = await env.makeDeps({ state: flagString(args, 'state') });
    return await command.run({ args, out, io: env.io, deps });
  } catch (error) {
    return report(error, out, env.io.env.PROPOSAL_DESK_DEBUG === '1');
  }
}

function report(error: unknown, out: Output, debug: boolean): number {
  if (error instanceof UsageError) {
    out.err(`proposal-desk: ${error.message}`);
    out.err('Run `proposal-desk --help` for usage.');
    return EXIT.usage;
  }
  if (error instanceof AppError) {
    out.err(`proposal-desk: ${error.message}`);
    for (const detail of error.details) out.err(`  ${detail}`);
    return error.kind === 'io' ? EXIT.internal : EXIT.failed;
  }
  const message = error instanceof Error ? error.message : String(error);
  out.err(`proposal-desk: internal error: ${message}`);
  if (debug && error instanceof Error && error.stack !== undefined) out.err(error.stack);
  return EXIT.internal;
}
