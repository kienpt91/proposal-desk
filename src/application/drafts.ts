import type { LogEntry } from '../domain/log/chain.js';
import { AppError } from './errors.js';
import { resolveId } from './context.js';
import type { Deps } from './ports/index.js';
import { parseStoredDraft, type StoredDraft } from './records.js';

export interface FoundDraft {
  readonly entry: LogEntry;
  readonly stored: StoredDraft;
  readonly jobText: string;
}

/** Looks a draft up by id (or a unique prefix of at least 4 characters) through the log and the object store. */
export async function findDraft(deps: Deps, wanted: string): Promise<FoundDraft> {
  const entries = (await deps.log.readAll()).filter((e) => e.type === 'draft.generated');
  const id = resolveId(entries.map((e) => e.payload.draftId as string), wanted, 'draft');
  const entry = entries.filter((e) => e.payload.draftId === id).at(-1) as LogEntry;
  const text = await deps.objects.get(entry.payload.recordDigest as string);
  if (text === undefined) throw new AppError('io', `the stored record of draft ${id} is missing from the state directory`);
  const jobText = await deps.objects.get(entry.payload.jobDigest as string);
  if (jobText === undefined) throw new AppError('io', `the job text of draft ${id} is missing from the state directory`);
  return { entry, stored: parseStoredDraft(text), jobText };
}
