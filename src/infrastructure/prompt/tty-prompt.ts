import { createInterface } from 'node:readline';
import { AppError } from '../../application/errors.js';
import type { ConfirmRequest, Prompt } from '../../application/ports/index.js';
import { escapeUnsafe } from '../../domain/shared/text-safety.js';

export interface TerminalStreams {
  readonly input: NodeJS.ReadableStream & { readonly isTTY?: boolean };
  readonly output: NodeJS.WritableStream & { readonly isTTY?: boolean };
}

/**
 * Human confirmation on a real terminal. It refuses to run when standard input or the error stream is not a
 * terminal, so a script, a pipe or another program cannot approve anything. The human must type an exact token
 * that depends on what is being approved.
 */
export class TtyPrompt implements Prompt {
  constructor(private readonly streams: TerminalStreams) {}

  async confirm(request: ConfirmRequest): Promise<boolean> {
    const { input, output } = this.streams;
    if (input.isTTY !== true || output.isTTY !== true) {
      throw new AppError('refused', 'this step needs a person at an interactive terminal', ['Run the command directly in a terminal; it cannot be scripted or piped.']);
    }
    output.write(`${escapeUnsafe([request.title, '', ...request.lines].join('\n'))}\n\n`);
    output.write(escapeUnsafe(`Type "${request.token}" to confirm, anything else cancels: `));
    const answer = await readLine(input);
    output.write('\n');
    return answer.trim() === request.token;
  }
}

function readLine(input: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, terminal: false });
    let done = false;
    const finish = (value: string): void => {
      if (done) return;
      done = true;
      rl.close();
      resolve(value);
    };
    rl.once('line', finish);
    rl.once('close', () => finish(''));
  });
}
