import { digestOf, type Json } from '../shared/canonical-json.js';
import { DomainError, fail, ok, type Result } from '../shared/result.js';
import { assessFact, type FactAssessment } from './claim-policy.js';
import { LIMITS, parseFact, factAgeDays, type Fact } from './fact.js';

export type FactEvent =
  | { readonly type: 'fact.added'; readonly factId: string; readonly evidenceKind: string }
  | { readonly type: 'fact.verified'; readonly factId: string; readonly day: string }
  | { readonly type: 'fact.marked-stale'; readonly factId: string; readonly reason: string };

export interface Change<T> {
  readonly value: T;
  readonly events: readonly FactEvent[];
}

export const FACTS_SCHEMA_VERSION = 1;

/**
 * Aggregate root for everything verified about the freelancer.
 * Invariants: unique ids, at most `LIMITS.maxFacts` facts, and at most one live (non-stale) fact each for
 * rate, availability, location and timezone, so "the floor" and "the location" are never ambiguous.
 */
export class FactBase {
  private constructor(readonly facts: readonly Fact[]) {}

  static empty(): FactBase {
    return new FactBase([]);
  }

  static fromFacts(facts: readonly Fact[]): Result<FactBase> {
    const issues: string[] = [];
    if (facts.length > LIMITS.maxFacts) issues.push(`facts: at most ${LIMITS.maxFacts} facts are allowed`);
    const seen = new Set<string>();
    for (const fact of facts) {
      if (seen.has(fact.id)) issues.push(`facts: duplicate id ${fact.id}`);
      seen.add(fact.id);
    }
    for (const slot of ['rate', 'availability', 'location', 'timezone'] as const) {
      const live = facts.filter((f) => f.status !== 'stale' && slotOf(f) === slot);
      if (live.length > 1) issues.push(`facts: more than one live ${slot} fact (${live.map((f) => f.id).join(', ')}); mark the old one stale`);
    }
    if (issues.length > 0) return fail(issues);
    return ok(new FactBase([...facts]));
  }

  /** Parses the contents of a facts.json document (already JSON-decoded). */
  static parse(raw: unknown): Result<FactBase> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(['facts.json: must be an object']);
    const doc = raw as Record<string, unknown>;
    const issues: string[] = [];
    for (const key of Object.keys(doc)) if (key !== 'schema' && key !== 'facts') issues.push(`facts.json.${key}: unknown field`);
    if (doc.schema !== FACTS_SCHEMA_VERSION) issues.push(`facts.json.schema: must be ${FACTS_SCHEMA_VERSION}`);
    if (!Array.isArray(doc.facts)) issues.push('facts.json.facts: must be a list');
    if (issues.length > 0 || !Array.isArray(doc.facts)) return fail(issues);
    if (doc.facts.length > LIMITS.maxFacts) return fail([`facts: at most ${LIMITS.maxFacts} facts are allowed`]);
    const facts: Fact[] = [];
    doc.facts.forEach((entry: unknown, index: number) => {
      const parsed = parseFact(entry, `facts[${index}]`);
      if (parsed.ok) facts.push(parsed.value);
      else issues.push(...parsed.error);
    });
    if (issues.length > 0) return fail(issues);
    return FactBase.fromFacts(facts);
  }

  /** The JSON document form, stable key order, suitable for writing facts.json. */
  toDocument(): Json {
    return { schema: FACTS_SCHEMA_VERSION, facts: this.facts.map(factToJson) };
  }

  get(id: string): Fact | undefined {
    return this.facts.find((f) => f.id === id);
  }

  add(fact: Fact): Change<FactBase> {
    const next = FactBase.fromFacts([...this.facts, fact]);
    if (!next.ok) throw new DomainError('fact-rejected', next.error.join('; '));
    return { value: next.value, events: [{ type: 'fact.added', factId: fact.id, evidenceKind: fact.evidence.kind }] };
  }

  /** Records a successful re-check on `day`. A stale fact becomes verified again when its evidence matches. */
  markVerified(id: string, day: string): Change<FactBase> {
    return this.replace(id, (f) => ({ ...f, status: 'verified', checkedAt: day }), { type: 'fact.verified', factId: id, day });
  }

  markStale(id: string, reason: string): Change<FactBase> {
    const fact = this.mustGet(id);
    if (fact.status === 'stale') return { value: this, events: [] };
    return this.replace(id, (f) => ({ ...f, status: 'stale' }), { type: 'fact.marked-stale', factId: id, reason });
  }

  /** Live facts whose evidence was last checked (or dated) more than `olderThanDays` days before `today`; undated facts count as overdue. */
  overdue(today: string, olderThanDays: number): readonly Fact[] {
    return this.facts.filter((f) => {
      if (f.status === 'stale') return false;
      const age = factAgeDays(f, today);
      return age === undefined || age > olderThanDays;
    });
  }

  assessments(): readonly FactAssessment[] {
    return this.facts.map(assessFact);
  }

  usable(): readonly FactAssessment[] {
    return this.assessments().filter((a) => a.usable);
  }

  /** Digest of the given facts as the proposal sees them (checkedAt is excluded so a routine re-check keeps approvals valid). */
  snapshotDigest(ids: readonly string[]): string {
    const sorted = [...new Set(ids)].sort();
    return digestOf(sorted.map((id) => snapshotOf(this.get(id), id)));
  }

  private mustGet(id: string): Fact {
    const fact = this.get(id);
    if (fact === undefined) throw new DomainError('unknown-fact', `no fact with id ${id}`);
    return fact;
  }

  private replace(id: string, update: (fact: Fact) => Fact, event: FactEvent): Change<FactBase> {
    this.mustGet(id);
    const facts = this.facts.map((f) => (f.id === id ? update(f) : f));
    const next = FactBase.fromFacts(facts);
    if (!next.ok) throw new DomainError('fact-rejected', next.error.join('; '));
    return { value: next.value, events: [event] };
  }
}

function slotOf(fact: Fact): 'rate' | 'availability' | 'location' | 'timezone' | undefined {
  if (fact.category === 'rate') return 'rate';
  if (fact.category === 'availability') return 'availability';
  if (fact.category === 'constraint' && fact.attrs.kind === 'location') return 'location';
  if (fact.category === 'constraint' && fact.attrs.kind === 'timezone') return 'timezone';
  return undefined;
}

export function factToJson(fact: Fact): Json {
  return {
    id: fact.id,
    claim: fact.claim,
    category: fact.category,
    evidence: {
      kind: fact.evidence.kind,
      reference: fact.evidence.reference,
      digest: fact.evidence.digest,
      date: fact.evidence.date,
      note: fact.evidence.note,
    },
    status: fact.status,
    tags: [...fact.tags],
    attrs: { ...fact.attrs },
    checkedAt: fact.checkedAt,
  };
}

function snapshotOf(fact: Fact | undefined, id: string): Json {
  if (fact === undefined) return { id, missing: true };
  const json = factToJson(fact) as { [key: string]: Json | undefined };
  return { ...json, checkedAt: undefined };
}
