import { dayNumber, isIsoDay } from '../shared/date.js';
import { fail, ok, type Result } from '../shared/result.js';
import { hasUnsafeCharacters } from '../shared/text-safety.js';
import { canonicalTechId } from '../dictionary/tech.js';
import { parseUtcOffset } from '../dictionary/geo.js';
import { hasPersonalContact } from '../policy/contact.js';

export const FACT_CATEGORIES = ['skill', 'project', 'role', 'metric', 'availability', 'rate', 'constraint'] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const EVIDENCE_KINDS = ['repo-url', 'file-hash', 'command-output', 'document', 'self-declared'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const FACT_STATUSES = ['verified', 'declared', 'stale'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

/** Evidence kinds the tool can re-check offline: a local file whose SHA-256 is recorded. */
export const CHECKABLE_KINDS: readonly EvidenceKind[] = ['file-hash', 'command-output', 'document'];

export const LIMITS = {
  maxFacts: 500,
  claimMin: 8,
  claimMax: 200,
  idMax: 48,
  referenceMax: 300,
  noteMax: 200,
  tagsMax: 12,
  tagMax: 32,
  attrValueMax: 64,
} as const;

export interface Evidence {
  readonly kind: EvidenceKind;
  readonly reference: string;
  readonly digest?: string;
  readonly date?: string;
  readonly note?: string;
}

export type AttrValue = string | number;

export interface Fact {
  readonly id: string;
  readonly claim: string;
  readonly category: FactCategory;
  readonly evidence: Evidence;
  readonly status: FactStatus;
  readonly tags: readonly string[];
  readonly attrs: { readonly [key: string]: AttrValue };
  /** Day on which the evidence was last re-checked successfully (checkable kinds only). */
  readonly checkedAt?: string;
}

export function isCheckable(kind: EvidenceKind): boolean {
  return CHECKABLE_KINDS.includes(kind);
}

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TAG = /^[a-z0-9][a-z0-9 +#.-]{0,31}$/;
const DIGEST = /^[0-9a-f]{64}$/;

type Spec = { readonly [key: string]: (value: unknown) => string | undefined };

const isNumberIn = (min: number, max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? undefined : `must be a number between ${min} and ${max}`;
const isOneOf = (...allowed: string[]) => (v: unknown) =>
  typeof v === 'string' && allowed.includes(v) ? undefined : `must be one of ${allowed.join(', ')}`;
const isShortText = (v: unknown) =>
  typeof v === 'string' && v.trim() !== '' && v.length <= LIMITS.attrValueMax && !hasUnsafeCharacters(v)
    ? undefined
    : `must be non-empty text of at most ${LIMITS.attrValueMax} characters`;

const ATTR_SPECS: Readonly<Record<FactCategory, Spec>> = {
  skill: { years: isNumberIn(0, 60) },
  project: { years: isNumberIn(0, 60) },
  role: { years: isNumberIn(0, 60) },
  metric: {},
  availability: { hoursPerWeek: isNumberIn(1, 80), startWithinDays: isNumberIn(0, 365) },
  rate: {
    floor: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100000 ? undefined : 'must be a positive number'),
    currency: (v) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? undefined : 'must be a 3-letter upper-case currency code'),
    unit: isOneOf('hour', 'project'),
  },
  constraint: { kind: isOneOf('location', 'timezone', 'language'), value: isShortText },
};

const REQUIRED_ATTRS: Readonly<Record<FactCategory, readonly string[]>> = {
  skill: [],
  project: [],
  role: [],
  metric: [],
  availability: ['hoursPerWeek'],
  rate: ['floor', 'currency', 'unit'],
  constraint: ['kind', 'value'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(`${path}.${key}: unknown field`);
}

function parseEvidence(raw: unknown, path: string, issues: string[]): Evidence | undefined {
  if (!isRecord(raw)) {
    issues.push(`${path}: must be an object`);
    return undefined;
  }
  unknownKeys(raw, ['kind', 'reference', 'digest', 'date', 'note'], path, issues);
  const before = issues.length;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    issues.push(`${path}.kind: must be one of ${EVIDENCE_KINDS.join(', ')}`);
  }
  const reference = raw.reference;
  if (typeof reference !== 'string' || reference.trim() === '' || reference.length > LIMITS.referenceMax || hasUnsafeCharacters(reference)) {
    issues.push(`${path}.reference: must be non-empty text of at most ${LIMITS.referenceMax} characters without control characters`);
  }
  const digest = raw.digest;
  if (digest !== undefined && (typeof digest !== 'string' || !DIGEST.test(digest))) {
    issues.push(`${path}.digest: must be 64 lowercase hex characters`);
  }
  const date = raw.date;
  if (date !== undefined && (typeof date !== 'string' || !isIsoDay(date))) issues.push(`${path}.date: must be a YYYY-MM-DD date`);
  const note = raw.note;
  if (note !== undefined && (typeof note !== 'string' || note.length > LIMITS.noteMax || hasUnsafeCharacters(note))) {
    issues.push(`${path}.note: must be text of at most ${LIMITS.noteMax} characters without control characters`);
  }
  if (issues.length > before) return undefined;

  const k = kind as EvidenceKind;
  if (isCheckable(k) && digest === undefined) issues.push(`${path}.digest: required for evidence kind ${k}`);
  if (!isCheckable(k) && digest !== undefined) issues.push(`${path}.digest: only allowed for ${CHECKABLE_KINDS.join(', ')}`);
  if (k === 'repo-url' && !/^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(reference as string)) {
    issues.push(`${path}.reference: a repo-url must be an https URL`);
  }
  if (issues.length > before) return undefined;
  return {
    kind: k,
    reference: reference as string,
    ...(digest === undefined ? {} : { digest: digest as string }),
    ...(date === undefined ? {} : { date: date as string }),
    ...(note === undefined ? {} : { note: note as string }),
  };
}

function parseAttrs(raw: unknown, category: FactCategory, path: string, issues: string[]): { [key: string]: AttrValue } {
  const out: { [key: string]: AttrValue } = {};
  if (raw === undefined) raw = {};
  if (!isRecord(raw)) {
    issues.push(`${path}: must be an object`);
    return out;
  }
  const spec = ATTR_SPECS[category];
  for (const [key, value] of Object.entries(raw)) {
    const check = Object.hasOwn(spec, key) ? spec[key] : undefined;
    if (check === undefined) {
      issues.push(`${path}.${key}: not allowed for category ${category}`);
      continue;
    }
    const problem = check(value);
    if (problem !== undefined) issues.push(`${path}.${key}: ${problem}`);
    else out[key] = value as AttrValue;
  }
  for (const key of REQUIRED_ATTRS[category]) if (!(key in raw)) issues.push(`${path}.${key}: required for category ${category}`);
  if (category === 'constraint' && out.kind === 'timezone' && typeof out.value === 'string' && parseUtcOffset(out.value) === undefined) {
    issues.push(`${path}.value: a timezone must look like UTC+7 or UTC-5:30`);
  }
  return out;
}

/** Strict parser for one fact. Every problem is reported, with a path such as `facts[2].evidence.kind`. */
export function parseFact(raw: unknown, path = 'fact'): Result<Fact> {
  const issues: string[] = [];
  if (!isRecord(raw)) return fail([`${path}: must be an object`]);
  unknownKeys(raw, ['id', 'claim', 'category', 'evidence', 'status', 'tags', 'attrs', 'checkedAt'], path, issues);

  const id = raw.id;
  if (typeof id !== 'string' || !ID.test(id)) issues.push(`${path}.id: must match ${ID.source}`);

  const claim = raw.claim;
  if (typeof claim !== 'string' || claim.trim().length < LIMITS.claimMin || claim.length > LIMITS.claimMax) {
    issues.push(`${path}.claim: must be ${LIMITS.claimMin}-${LIMITS.claimMax} characters`);
  } else if (hasUnsafeCharacters(claim) || claim.includes('\n')) {
    issues.push(`${path}.claim: must be a single line without control characters`);
  } else if (hasPersonalContact(claim)) {
    issues.push(`${path}.claim: must not contain contact details`);
  } else if (/\bhttps?:\/\//i.test(claim)) {
    issues.push(`${path}.claim: put links in the evidence reference, not in the claim`);
  }

  const category = raw.category;
  const categoryOk = typeof category === 'string' && (FACT_CATEGORIES as readonly string[]).includes(category);
  if (!categoryOk) issues.push(`${path}.category: must be one of ${FACT_CATEGORIES.join(', ')}`);

  const evidence = parseEvidence(raw.evidence, `${path}.evidence`, issues);

  const status = raw.status;
  if (typeof status !== 'string' || !(FACT_STATUSES as readonly string[]).includes(status)) {
    issues.push(`${path}.status: must be one of ${FACT_STATUSES.join(', ')}`);
  }

  const tags: string[] = [];
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > LIMITS.tagsMax) issues.push(`${path}.tags: must be a list of at most ${LIMITS.tagsMax} tags`);
    else {
      raw.tags.forEach((tag: unknown, i: number) => {
        if (typeof tag !== 'string' || !TAG.test(tag)) issues.push(`${path}.tags[${i}]: must match ${TAG.source}`);
        else if (tags.includes(tag)) issues.push(`${path}.tags[${i}]: duplicate tag`);
        else tags.push(tag);
      });
    }
  }

  const checkedAt = raw.checkedAt;
  if (checkedAt !== undefined && (typeof checkedAt !== 'string' || !isIsoDay(checkedAt))) {
    issues.push(`${path}.checkedAt: must be a YYYY-MM-DD date`);
  }

  const attrs = categoryOk ? parseAttrs(raw.attrs, category as FactCategory, `${path}.attrs`, issues) : {};

  if (evidence !== undefined && typeof status === 'string') {
    if (status === 'verified' && !isCheckable(evidence.kind)) {
      issues.push(`${path}.status: "verified" needs mechanically checkable evidence (${CHECKABLE_KINDS.join(', ')}), not ${evidence.kind}`);
    }
    if (status === 'verified' && checkedAt === undefined) issues.push(`${path}.checkedAt: required when status is verified`);
  }

  if (issues.length > 0) return fail(issues);
  return ok({
    id: id as string,
    claim: (claim as string).trim(),
    category: category as FactCategory,
    evidence: evidence as Evidence,
    status: status as FactStatus,
    tags,
    attrs,
    ...(checkedAt === undefined ? {} : { checkedAt: checkedAt as string }),
  });
}

/** Canonical technology ids a fact is about: dictionary hits in its tags (claim text is scanned by callers). */
export function tagTechIds(fact: Fact): string[] {
  const ids = new Set<string>();
  for (const tag of fact.tags) {
    const id = canonicalTechId(tag);
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

/** Whole days between the evidence date (or last check) and `today`; undefined when neither is known. */
export function factAgeDays(fact: Fact, today: string): number | undefined {
  const reference = fact.checkedAt ?? fact.evidence.date;
  if (reference === undefined) return undefined;
  return dayNumber(today) - dayNumber(reference);
}
