import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/application/errors.js';
import { UsageError, flagBool, flagInt, flagList, flagString, parseArgs, type FlagSpec } from '../../src/infrastructure/cli/args.js';
import { Output } from '../../src/infrastructure/cli/output.js';
import { createProcessIo } from '../../src/infrastructure/cli/process-io.js';
import { TtyPrompt } from '../../src/infrastructure/prompt/tty-prompt.js';

const FLAGS: FlagSpec[] = [
  { name: 'out', kind: 'string', help: '' },
  { name: 'tag', kind: 'list', help: '' },
  { name: 'force', kind: 'boolean', help: '' },
  { name: 'days', kind: 'string', help: '' },
];

describe('argument parser', () => {
  it('parses flags, lists, booleans, = syntax, -- and positionals', () => {
    const args = parseArgs(['a', '--out', 'x', '--tag=1', '--tag', '2', '--force', '--', '--not-a-flag', '-'], FLAGS, [{ name: 'first' }, { name: 'rest', optional: true, variadic: true }]);
    expect(args.positionals).toEqual(['a', '--not-a-flag', '-']);
    expect(flagString(args, 'out')).toBe('x');
    expect(flagList(args, 'tag')).toEqual(['1', '2']);
    expect(flagBool(args, 'force')).toBe(true);
    expect(flagBool(args, 'help')).toBe(false);
    expect(flagString(args, 'missing')).toBeUndefined();
    expect(flagList(args, 'missing')).toEqual([]);
  });

  it('rejects unknown flags, missing values, repeats and bad arity', () => {
    const spec = [{ name: 'file' }];
    expect(() => parseArgs(['--nope'], FLAGS, [])).toThrow('unknown option --nope');
    expect(() => parseArgs(['--out'], FLAGS, [])).toThrow('--out needs a value');
    expect(() => parseArgs(['--out', '--force'], FLAGS, [])).toThrow('--out needs a value');
    expect(() => parseArgs(['--force=1'], FLAGS, [])).toThrow('does not take a value');
    expect(() => parseArgs(['--out', 'a', '--out', 'b'], FLAGS, [])).toThrow('given twice');
    expect(() => parseArgs([], FLAGS, spec)).toThrow('missing <file>');
    expect(() => parseArgs(['a', 'b'], FLAGS, spec)).toThrow('unexpected argument "b"');
    expect(() => parseArgs(['--state'], FLAGS, [])).toThrow(UsageError);
  });

  it('parses bounded integers', () => {
    const args = (v: string) => parseArgs(['--days', v], FLAGS, []);
    expect(flagInt(args('30'), 'days', 1, 365)).toBe(30);
    expect(flagInt(parseArgs([], FLAGS, []), 'days', 1, 365)).toBeUndefined();
    for (const bad of ['0', '400', '-1', '1.5', 'x']) expect(() => flagInt(args(bad), 'days', 1, 365)).toThrow('whole number from 1 to 365');
  });
});

describe('Output', () => {
  it('escapes unsafe characters in text and JSON', () => {
    let out = '';
    let err = '';
    const output = new Output({ stdout: (t) => void (out += t), stderr: (t) => void (err += t), env: {}, readStdin: async () => '' });
    output.out('a\u001b[31mb');
    output.err('c\u202ed');
    output.json({ k: 'v\u009b' });
    expect(out).toBe('a\\u{1b}[31mb\n{\n  "k": "v\\u009b"\n}\n');
    expect(err).toBe('c\\u{202e}d\n');
  });
});

describe('process IO', () => {
  const proc = (input: Readable) => ({ stdin: input, stdout: { write: () => true }, stderr: { write: () => true }, env: { A: 'b' } });

  it('reads standard input within the limit', async () => {
    const io = createProcessIo(proc(Readable.from(['hello ', Buffer.from('wörld')])));
    expect(io.env).toEqual({ A: 'b' });
    expect(await io.readStdin(100)).toBe('hello wörld');
  });

  it('refuses oversized or non-UTF-8 input', async () => {
    await expect(createProcessIo(proc(Readable.from(['x'.repeat(50)]))).readStdin(10)).rejects.toThrow(AppError);
    await expect(createProcessIo(proc(Readable.from([Buffer.from([0xff, 0xfe])]))).readStdin(10)).rejects.toThrow('not valid UTF-8');
  });

  it('writes to the streams', () => {
    let out = '';
    let err = '';
    const io = createProcessIo({ stdin: Readable.from([]), stdout: { write: (t) => (out += t) }, stderr: { write: (t) => (err += t) }, env: {} });
    io.stdout('o');
    io.stderr('e');
    expect([out, err]).toEqual(['o', 'e']);
  });
});

describe('TtyPrompt', () => {
  const terminal = (tty: boolean) => {
    const input = Object.assign(new PassThrough(), { isTTY: tty });
    const output = Object.assign(new PassThrough(), { isTTY: tty });
    let shown = '';
    output.on('data', (chunk: Buffer) => (shown += chunk.toString()));
    return { input, output, shown: () => shown };
  };
  const request = { title: 'Approve draft d-1?', lines: ['line one \u001b[31mred', 'line two'], token: 'approve abcd1234' };

  it('shows the escaped request and accepts only the exact token', async () => {
    const t = terminal(true);
    const answer = new TtyPrompt(t).confirm(request);
    t.input.write('approve abcd1234\n');
    expect(await answer).toBe(true);
    expect(t.shown()).toContain('Approve draft d-1?');
    expect(t.shown()).toContain('line one \\u{1b}[31mred');
    expect(t.shown()).toContain('Type "approve abcd1234" to confirm');
    expect(t.shown()).not.toContain('\u001b');
  });

  it('cancels on anything else, including end of input', async () => {
    const wrong = terminal(true);
    const a = new TtyPrompt(wrong).confirm(request);
    wrong.input.write('yes\n');
    expect(await a).toBe(false);
    const eof = terminal(true);
    const b = new TtyPrompt(eof).confirm(request);
    eof.input.end();
    expect(await b).toBe(false);
  });

  it('refuses to run without a terminal', async () => {
    for (const t of [terminal(false), { ...terminal(true), input: Object.assign(new PassThrough(), { isTTY: false }) }]) {
      await expect(new TtyPrompt(t).confirm(request)).rejects.toMatchObject({ kind: 'refused', message: 'this step needs a person at an interactive terminal' });
    }
  });
});
