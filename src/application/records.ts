import type { JobAnalysis } from '../domain/analysis/analyze.js';
import { TONES } from '../domain/config/config.js';
import type { DraftRecord } from '../domain/learning/insights.js';
import type { Draft } from '../domain/proposal/draft.js';
import { canonicalJson, type Json } from '../domain/shared/canonical-json.js';
import { AppError } from './errors.js';

/** What is stored about a draft: the draft itself plus the few analysis facts the insights report needs later. */
export interface StoredDraft {
  readonly schema: 1;
  readonly draft: Draft;
  readonly summary: {
    readonly fit: number;
    readonly recommendation: string;
    readonly flags: readonly { readonly ruleId: string; readonly severity: 'info' | 'warn' | 'hard' }[];
    readonly budget: DraftRecord['budget'];
    readonly bid: DraftRecord['bid'];
  };
}

export function toStoredDraft(draft: Draft, analysis: JobAnalysis): StoredDraft {
  const budget = analysis.spec.budget;
  const suggestion = analysis.rate.suggestion;
  const hasRateLine = draft.sentences.some((s) => s.role === 'rate');
  return {
    schema: 1,
    draft,
    summary: {
      fit: analysis.score.value,
      recommendation: analysis.verdict.recommendation,
      flags: analysis.flags.map((f) => ({ ruleId: f.ruleId, severity: f.severity })),
      budget: budget === undefined ? undefined : { min: budget.min, max: budget.max, currency: budget.currency, type: budget.type },
      bid: hasRateLine && suggestion !== undefined ? { amount: suggestion.amount, currency: suggestion.currency, unit: suggestion.unit } : undefined,
    },
  };
}

export function serializeStoredDraft(stored: StoredDraft): string {
  return canonicalJson(stored as unknown as Json);
}

function corrupt(what: string): never {
  throw new AppError('io', `a stored draft record is malformed (${what}); the state directory may have been edited`);
}

/** Reads a stored draft. The object store has already checked the digest; this checks the shape. */
export function parseStoredDraft(text: string): StoredDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return corrupt('not JSON');
  }
  const r = raw as { schema?: unknown; draft?: Record<string, unknown>; summary?: Record<string, unknown> } | null;
  if (r === null || typeof r !== 'object' || r.schema !== 1 || typeof r.draft !== 'object' || r.draft === null || typeof r.summary !== 'object' || r.summary === null) return corrupt('schema');
  const d = r.draft;
  const stringFields = ['id', 'jobDigest', 'factsDigest', 'text', 'tone'];
  if (stringFields.some((k) => typeof d[k] !== 'string') || !(TONES as readonly string[]).includes(d.tone as string)) return corrupt('draft fields');
  if (!/^d-[0-9a-f]{12}$/.test(d.id as string)) return corrupt('draft id');
  if (!Array.isArray(d.sentences) || !Array.isArray(d.citations) || !Array.isArray(d.notes)) return corrupt('draft lists');
  if (typeof r.summary.fit !== 'number' || !Array.isArray(r.summary.flags)) return corrupt('summary');
  return r as unknown as StoredDraft;
}

export function toInsightRecord(stored: StoredDraft): DraftRecord {
  return {
    draftId: stored.draft.id,
    tone: stored.draft.tone,
    fit: stored.summary.fit,
    hasWarning: stored.summary.flags.some((f) => f.severity !== 'info'),
    budget: stored.summary.budget,
    bid: stored.summary.bid,
  };
}
