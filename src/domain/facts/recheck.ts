import { FactBase } from './fact-base.js';
import { isCheckable, type Fact } from './fact.js';

/** What re-hashing the evidence file of a fact gave (the port's result, kept free of IO types). */
export type EvidenceCheck = { readonly ok: true; readonly digest: string } | { readonly ok: false; readonly reason: string };

export interface RecheckedFacts {
  /** The facts as they are *now*: checkable evidence decides the status, not the status field of the file. */
  readonly base: FactBase;
  /** One line per fact whose evidence no longer verifies; shown to the user, never silent. */
  readonly notices: readonly string[];
}

/** The references of facts that need their evidence re-hashed: checkable kinds that are not already stale. */
export function referencesToCheck(base: FactBase): string[] {
  return [...new Set(base.facts.filter((f) => isCheckable(f.evidence.kind) && f.status !== 'stale').map((f) => f.evidence.reference))];
}

/**
 * Recomputes verification status from evidence. A fact with checkable evidence is `verified` exactly when its file hashes to
 * the recorded digest today; a mismatch or a missing file makes it `stale` for this run. Nothing a facts file says about a
 * fact's status is believed: a hand-edited "verified" without matching evidence is stale, and a "declared" fact whose
 * evidence matches is verified. Facts already marked stale stay stale until `facts verify` re-checks them.
 */
export function recheckFacts(base: FactBase, checks: ReadonlyMap<string, EvidenceCheck>, today: string): RecheckedFacts {
  const notices: string[] = [];
  const facts: Fact[] = base.facts.map((fact) => {
    if (!isCheckable(fact.evidence.kind) || fact.status === 'stale') return fact;
    const check = checks.get(fact.evidence.reference);
    if (check?.ok === true && check.digest === fact.evidence.digest) {
      return fact.status === 'verified' && fact.checkedAt === today ? fact : { ...fact, status: 'verified', checkedAt: today };
    }
    const why = check === undefined ? 'was not checked' : check.ok ? 'no longer matches the recorded digest' : check.reason;
    notices.push(`${fact.id}: ${fact.evidence.reference}${check?.ok === false ? ': ' : ' '}${why} (treated as stale; run \`facts verify\` after fixing the evidence)`);
    return { ...fact, status: 'stale' };
  });
  const rebuilt = FactBase.fromFacts(facts);
  // Only statuses changed, and only towards stale or towards verified with a check date, so the invariants still hold.
  if (!rebuilt.ok) throw new Error(`internal error: rechecked facts are invalid: ${rebuilt.error.join('; ')}`);
  return { base: rebuilt.value, notices };
}
