import { verifyChain, type ChainReport, type LogEntry } from '../../domain/log/chain.js';
import { AppError } from '../errors.js';
import type { Deps } from '../ports/index.js';

export interface HistoryItem {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly summary: string;
}

function summarize(entry: LogEntry): string {
  const p = entry.payload;
  const s = (key: string): string => String(p[key] ?? '');
  switch (entry.type) {
    case 'fact.added':
      return `${s('factId')} (${s('evidenceKind')})`;
    case 'fact.verified':
      return `${s('factId')} re-checked on ${s('day')}`;
    case 'fact.marked-stale':
      return `${s('factId')}: ${s('reason')}`;
    case 'job.analyzed':
      return `job ${s('jobDigest').slice(0, 12)}: fit ${s('fit')}, ${s('recommendation')}`;
    case 'draft.generated':
      return `${s('draftId')} (${s('tone')}) for job ${s('jobDigest').slice(0, 12)}`;
    case 'proposal.checked':
      return `text ${s('textDigest').slice(0, 12)}: ${p.ok === true ? 'passed' : `${s('errors')} errors`}${p.draftId === undefined ? '' : ` (draft ${s('draftId')})`}`;
    case 'draft.approved':
      return `${s('draftId')} approved, binding ${s('bindingDigest').slice(0, 12)}`;
    case 'draft.exported':
      return `${s('draftId')} exported, ${s('bytes')} bytes`;
    case 'outcome.recorded':
      return `${s('draftId')}: ${s('outcome')}${p.note === undefined ? '' : ` - ${s('note')}`}`;
    case 'config.proposed':
      return `proposal ${s('proposalDigest').slice(0, 12)}: version ${s('fromVersion')} -> ${s('toVersion')}`;
    case 'config.applied':
      return `proposal ${s('proposalDigest').slice(0, 12)} applied as version ${s('version')}`;
  }
}

/** The most recent log entries, oldest first. */
export async function history(deps: Deps, input: { readonly limit: number; readonly type?: string }): Promise<readonly HistoryItem[]> {
  const all = await deps.log.readAll();
  const entries = input.type === undefined ? all : all.filter((e) => e.type === input.type);
  return entries.slice(-input.limit).map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, summary: summarize(e) }));
}

export interface LogVerification {
  readonly chain: ChainReport;
  /** Objects referenced by the log that are missing or no longer match their digest. */
  readonly problems: readonly string[];
  readonly objectsChecked: number;
}

const OBJECT_KEYS = ['jobDigest', 'recordDigest', 'objectDigest'] as const;

/** Recomputes the hash chain and checks that every stored object the log points to is present and intact. */
export async function verifyLog(deps: Deps): Promise<LogVerification> {
  const entries = await deps.log.readAll();
  const chain = verifyChain(entries);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const key of OBJECT_KEYS) {
      const digest = entry.payload[key];
      if (typeof digest !== 'string' || seen.has(digest)) continue;
      seen.add(digest);
      try {
        if ((await deps.objects.get(digest)) === undefined) problems.push(`entry ${entry.seq}: object ${digest.slice(0, 12)} (${key}) is missing`);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        problems.push(`entry ${entry.seq}: object ${digest.slice(0, 12)} (${key}) is corrupt`);
      }
    }
  }
  return { chain, problems, objectsChecked: seen.size };
}
