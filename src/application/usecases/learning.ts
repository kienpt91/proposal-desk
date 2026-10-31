import { computeInsights, OUTCOMES, type Insights, type Outcome } from '../../domain/learning/insights.js';
import { stripUnsafe } from '../../domain/shared/text-safety.js';
import { AppError } from '../errors.js';
import { loadConfig, record } from '../context.js';
import { findDraft } from '../drafts.js';
import type { Deps } from '../ports/index.js';
import { parseStoredDraft, toInsightRecord } from '../records.js';

export interface OutcomeInput {
  readonly draftId: string;
  readonly outcome: string;
  readonly note?: string;
  /** The bid actually placed, when it differs from the suggestion. */
  readonly bid?: number;
}

/** Stores what happened to a proposal you sent. Several outcomes per draft are allowed; the latest one counts. */
export async function recordOutcome(deps: Deps, input: OutcomeInput): Promise<{ readonly draftId: string; readonly outcome: Outcome }> {
  if (!(OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new AppError('invalid', `unknown outcome "${stripUnsafe(input.outcome).slice(0, 40)}"`, [`Use one of: ${OUTCOMES.join(', ')}`]);
  }
  const note = input.note === undefined ? undefined : stripUnsafe(input.note).trim();
  if (note !== undefined && note.length > 300) throw new AppError('invalid', 'the note is longer than 300 characters');
  if (input.bid !== undefined && !(Number.isFinite(input.bid) && input.bid > 0 && input.bid <= 10_000_000)) throw new AppError('invalid', 'the bid must be a positive number');
  const found = await findDraft(deps, input.draftId);
  const draftId = found.stored.draft.id;
  await record(deps, 'outcome.recorded', {
    draftId,
    outcome: input.outcome,
    ...(note === undefined || note === '' ? {} : { note }),
    ...(input.bid === undefined ? {} : { bid: input.bid }),
  });
  return { draftId, outcome: input.outcome as Outcome };
}

/** Transparent statistics over the drafts that have an outcome. Suggestions are text only: nothing is changed. */
export async function insightsReport(deps: Deps): Promise<Insights> {
  const config = await loadConfig(deps);
  const entries = await deps.log.readAll();
  const latestDraft = new Map<string, string>();
  for (const e of entries) if (e.type === 'draft.generated') latestDraft.set(e.payload.draftId as string, e.payload.recordDigest as string);
  const outcomes = new Map<string, { outcome: Outcome; bid?: number }>();
  for (const e of entries) {
    if (e.type !== 'outcome.recorded') continue;
    const bid = e.payload.bid;
    outcomes.set(e.payload.draftId as string, { outcome: e.payload.outcome as Outcome, ...(typeof bid === 'number' ? { bid } : {}) });
  }
  const drafts = [];
  for (const [draftId, digest] of latestDraft) {
    const text = await deps.objects.get(digest);
    if (text === undefined) throw new AppError('io', `the stored record of draft ${draftId} is missing from the state directory`);
    drafts.push(toInsightRecord(parseStoredDraft(text)));
  }
  return computeInsights(drafts, outcomes, config);
}
