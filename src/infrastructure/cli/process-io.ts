import { AppError } from '../../application/errors.js';
import type { CliIo } from './output.js';

export interface ProcessLike {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Standard streams as a CliIo. Standard input is read only when a command asks for "-". */
export function createProcessIo(proc: ProcessLike): CliIo {
  return {
    stdout: (text) => void proc.stdout.write(text),
    stderr: (text) => void proc.stderr.write(text),
    env: proc.env,
    async readStdin(maxBytes: number): Promise<string> {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of proc.stdin) {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
        total += buffer.length;
        if (total > maxBytes) throw new AppError('invalid', `standard input is larger than the ${maxBytes}-byte limit`);
        chunks.push(buffer);
      }
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        throw new AppError('invalid', 'standard input is not valid UTF-8 text');
      }
    },
  };
}
