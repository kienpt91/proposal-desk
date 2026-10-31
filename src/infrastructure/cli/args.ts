/** A mistake in how the tool was called. Exit status 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export type FlagKind = 'string' | 'boolean' | 'list';

export interface FlagSpec {
  readonly name: string;
  readonly kind: FlagKind;
  readonly help: string;
  /** Placeholder shown in usage, for example `<path>`. */
  readonly value?: string;
}

export interface PositionalSpec {
  readonly name: string;
  readonly optional?: boolean;
  readonly variadic?: boolean;
}

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean | string[]>;
}

/** Flags every command accepts. */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: 'state', kind: 'string', value: '<dir>', help: 'state directory (default: $XDG_STATE_HOME/proposal-desk or ~/.local/state/proposal-desk)' },
  { name: 'help', kind: 'boolean', help: 'show help for this command' },
];

/** Strict argument parser: unknown flags, missing values and wrong arity are errors, never silently ignored. */
export function parseArgs(tokens: readonly string[], flags: readonly FlagSpec[], positionals: readonly PositionalSpec[]): ParsedArgs {
  const specs = new Map([...flags, ...GLOBAL_FLAGS].map((f) => [f.name, f] as const));
  const values = new Map<string, string | boolean | string[]>();
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (token === '--') {
      rest.push(...tokens.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      rest.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = token.slice(2, eq === -1 ? undefined : eq);
    const spec = specs.get(name);
    if (spec === undefined) throw new UsageError(`unknown option --${name}`);
    if (spec.kind === 'boolean') {
      if (eq !== -1) throw new UsageError(`--${name} does not take a value`);
      values.set(name, true);
      continue;
    }
    let value: string;
    if (eq !== -1) value = token.slice(eq + 1);
    else {
      const next = tokens[i + 1];
      if (next === undefined || (next.startsWith('--') && next !== '--')) throw new UsageError(`--${name} needs a value`);
      value = next;
      i++;
    }
    if (spec.kind === 'list') {
      const existing = values.get(name);
      values.set(name, [...(Array.isArray(existing) ? existing : []), value]);
    } else {
      if (values.has(name)) throw new UsageError(`--${name} was given twice`);
      values.set(name, value);
    }
  }
  const required = positionals.filter((p) => p.optional !== true).length;
  const variadic = positionals.some((p) => p.variadic === true);
  if (rest.length < required) throw new UsageError(`missing <${(positionals[rest.length] as PositionalSpec).name}>`);
  if (!variadic && rest.length > positionals.length) throw new UsageError(`unexpected argument ${JSON.stringify(rest[positionals.length])}`);
  return { positionals: rest, flags: values };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function flagList(args: ParsedArgs, name: string): string[] {
  const value = args.flags.get(name);
  return Array.isArray(value) ? value : [];
}

/** Parses a non-negative integer flag; undefined when the flag is absent. */
export function flagInt(args: ParsedArgs, name: string, min: number, max: number): number | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
  return Number(raw);
}
