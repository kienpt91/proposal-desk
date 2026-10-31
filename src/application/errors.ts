/**
 * An expected failure the user can act on. The CLI prints the message and maps `kind` to an exit status:
 *   refused  – a policy said no (violations, unapproved export, hard checks)     -> 1
 *   invalid  – the input was malformed (bad facts file, empty job text, ...)     -> 1
 *   missing  – something that was named does not exist                           -> 1
 *   io       – the file system or the state directory could not be used safely   -> 3
 */
export type ErrorKind = 'refused' | 'invalid' | 'missing' | 'io';

export class AppError extends Error {
  readonly kind: ErrorKind;
  /** Extra lines (one per violation or issue) printed under the message. */
  readonly details: readonly string[];

  constructor(kind: ErrorKind, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.details = details;
  }
}
