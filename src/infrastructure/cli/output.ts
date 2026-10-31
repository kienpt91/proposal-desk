import { escapeUnsafe, escapeUnsafeForJson } from '../../domain/shared/text-safety.js';

/** Where text goes. Real streams in production, buffers in tests. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** All of standard input, at most `maxBytes`. */
  readStdin(maxBytes: number): Promise<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Every character the tool prints passes through here. Control characters, ANSI/OSC sequences, bidirectional
 * overrides and zero-width characters from job posts, facts or files are shown as visible \u{...} escapes,
 * so untrusted text can never drive the terminal. The tool itself prints plain text only.
 */
export class Output {
  constructor(private readonly io: CliIo) {}

  out(text: string): void {
    this.io.stdout(`${escapeUnsafe(text)}\n`);
  }

  err(text: string): void {
    this.io.stderr(`${escapeUnsafe(text)}\n`);
  }

  /** Pretty JSON on stdout; unsafe characters inside strings become valid \uXXXX escapes. */
  json(value: unknown): void {
    this.io.stdout(`${escapeUnsafeForJson(JSON.stringify(value, null, 2))}\n`);
  }
}
