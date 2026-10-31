import { assessFact, type FactAssessment } from '../../domain/facts/claim-policy.js';
import { FactBase, type FactEvent } from '../../domain/facts/fact-base.js';
import { factAgeDays, isCheckable, parseFact, type AttrValue, type EvidenceKind, type Fact, type FactCategory } from '../../domain/facts/fact.js';
import { AppError } from '../errors.js';
import { loadConfig, record, requireCheckedFacts, requireFacts, today } from '../context.js';
import type { Deps } from '../ports/index.js';

async function logEvents(deps: Deps, events: readonly FactEvent[]): Promise<void> {
  for (const { type, ...payload } of events) await record(deps, type, payload);
}

export interface AddFactInput {
  readonly factsPath: string | undefined;
  readonly id: string;
  readonly claim: string;
  readonly category: FactCategory;
  readonly evidenceKind: EvidenceKind;
  readonly reference: string;
  readonly note?: string;
  readonly date?: string;
  readonly tags: readonly string[];
  readonly attrs: { readonly [key: string]: AttrValue };
}

export interface AddFactResult {
  readonly fact: Fact;
  readonly assessment: FactAssessment;
  readonly location: string;
}

/**
 * Adds one fact. For evidence the tool can check (a local file), the file is hashed now and the fact is
 * stored as verified; for anything else it is stored as declared. Nothing is ever marked verified on the user's word.
 */
export async function addFact(deps: Deps, input: AddFactInput): Promise<AddFactResult> {
  const handle = deps.facts(input.factsPath);
  const checkable = isCheckable(input.evidenceKind);
  let digest: string | undefined;
  if (checkable) {
    const result = await handle.evidence.digestOf(input.reference);
    if (!result.ok) throw new AppError('invalid', `cannot verify the evidence file: ${result.reason}`, ['Evidence of kind file-hash, command-output and document must be a readable local file. Use repo-url or self-declared otherwise.']);
    digest = result.digest;
  }
  const parsed = parseFact(
    {
      id: input.id,
      claim: input.claim,
      category: input.category,
      evidence: {
        kind: input.evidenceKind,
        reference: input.reference,
        ...(digest === undefined ? {} : { digest }),
        ...(input.date === undefined ? {} : { date: input.date }),
        ...(input.note === undefined ? {} : { note: input.note }),
      },
      status: checkable ? 'verified' : 'declared',
      tags: [...input.tags],
      attrs: { ...input.attrs },
      ...(checkable ? { checkedAt: today(deps) } : {}),
    },
    'fact',
  );
  if (!parsed.ok) throw new AppError('invalid', 'the fact was rejected', parsed.error);
  let events: readonly FactEvent[] = [];
  await handle.store.update((current) => {
    try {
      const change = (current ?? FactBase.empty()).add(parsed.value);
      events = change.events;
      return change.value;
    } catch (error) {
      throw new AppError('invalid', 'the fact was rejected', [error instanceof Error ? error.message : String(error)]);
    }
  });
  await logEvents(deps, events);
  return { fact: parsed.value, assessment: assessFact(parsed.value), location: handle.store.location };
}

export interface ListFactsResult {
  readonly location: string;
  readonly assessments: readonly FactAssessment[];
  readonly notices: readonly string[];
}

export async function listFacts(deps: Deps, input: { readonly factsPath: string | undefined }): Promise<ListFactsResult> {
  const checked = await requireCheckedFacts(deps, deps.facts(input.factsPath));
  return { location: checked.location, assessments: checked.base.assessments(), notices: checked.notices };
}

export type VerifyOutcome = 'verified' | 'stale' | 'skipped';

export interface VerifyFactResult {
  readonly factId: string;
  readonly outcome: VerifyOutcome;
  readonly detail: string;
}

/** Re-hashes the evidence file of every checkable fact. A match verifies (or re-verifies) it; a mismatch or a missing file makes it stale. */
export async function verifyFacts(deps: Deps, input: { readonly factsPath: string | undefined; readonly ids?: readonly string[] }): Promise<readonly VerifyFactResult[]> {
  const handle = deps.facts(input.factsPath);
  await requireFacts(handle); // a clear "no facts file" error before anything is locked
  const wanted = input.ids === undefined || input.ids.length === 0 ? undefined : new Set(input.ids);
  const results: VerifyFactResult[] = [];
  const events: FactEvent[] = [];
  await handle.store.update(async (current) => {
    let base = current ?? FactBase.empty();
    if (wanted !== undefined) {
      for (const id of wanted) if (base.get(id) === undefined) throw new AppError('missing', `no fact with id ${id}`);
    }
    const day = today(deps);
    for (const fact of base.facts) {
      if (wanted !== undefined && !wanted.has(fact.id)) continue;
      if (!isCheckable(fact.evidence.kind)) {
        results.push({ factId: fact.id, outcome: 'skipped', detail: `evidence kind ${fact.evidence.kind} cannot be re-checked offline` });
        continue;
      }
      const digest = await handle.evidence.digestOf(fact.evidence.reference);
      if (digest.ok && digest.digest === fact.evidence.digest) {
        const change = base.markVerified(fact.id, day);
        base = change.value;
        events.push(...change.events);
        results.push({ factId: fact.id, outcome: 'verified', detail: `${fact.evidence.reference} matches the recorded digest` });
      } else {
        const reason = digest.ok ? `${fact.evidence.reference} no longer matches the recorded digest` : `${fact.evidence.reference}: ${digest.reason}`;
        const change = base.markStale(fact.id, reason);
        base = change.value;
        events.push(...change.events);
        results.push({ factId: fact.id, outcome: 'stale', detail: reason });
      }
    }
    return base;
  });
  await logEvents(deps, events);
  return results;
}

export interface StaleEntry {
  readonly factId: string;
  readonly claim: string;
  readonly reason: string;
  readonly marked: boolean;
}

/** Lists stale facts and facts not checked or dated within `days`; with `mark`, makes the overdue ones stale. */
export async function staleFacts(
  deps: Deps,
  input: { readonly factsPath: string | undefined; readonly days?: number; readonly mark: boolean },
): Promise<{ readonly days: number; readonly entries: readonly StaleEntry[] }> {
  const handle = deps.facts(input.factsPath);
  const days = input.days ?? (await loadConfig(deps)).facts.staleAfterDays;
  const day = today(deps);
  const entries: StaleEntry[] = [];
  const events: FactEvent[] = [];
  const scan = (start: FactBase, mark: boolean): FactBase => {
    let base = start;
    entries.length = 0;
    events.length = 0;
    entries.push(...base.facts.filter((f) => f.status === 'stale').map((f) => ({ factId: f.id, claim: f.claim, reason: 'already stale', marked: false })));
    for (const fact of base.overdue(day, days)) {
      const age = factAgeDays(fact, day);
      const reason = age === undefined ? 'no check date or evidence date' : `last checked or dated ${age} days ago (limit ${days})`;
      if (mark) {
        const change = base.markStale(fact.id, reason);
        base = change.value;
        events.push(...change.events);
      }
      entries.push({ factId: fact.id, claim: fact.claim, reason, marked: mark });
    }
    return base;
  };
  if (input.mark) await handle.store.update((current) => scan(current ?? FactBase.empty(), true));
  else scan(await requireFacts(handle), false);
  await logEvents(deps, events);
  return { days, entries };
}
