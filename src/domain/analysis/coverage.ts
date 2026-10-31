import { parseUtcOffset, placeIncludes, resolvePlace } from '../dictionary/geo.js';
import { techById } from '../dictionary/tech.js';
import type { Config } from '../config/config.js';
import type { FactAssessment } from '../facts/claim-policy.js';
import type { FactBase } from '../facts/fact-base.js';
import type { JobSpec } from '../job/spec.js';
import type { Requirement } from '../job/requirements.js';

export type CoverageStatus = 'covered' | 'partial' | 'uncovered';

/** One row of the requirement-to-evidence matrix. */
export interface CoverageRow {
  readonly requirementId: string;
  readonly kind: Requirement['kind'];
  readonly label: string;
  readonly priority: Requirement['priority'];
  readonly status: CoverageStatus;
  /** Facts the status rests on, verified ones first. Empty when uncovered. */
  readonly factIds: readonly string[];
  /** Weight in the fit score; location and timezone rows are gates handled by risk flags and weigh nothing. */
  readonly weight: number;
  readonly credit: number;
  readonly note: string;
}

const trustRank = { verified: 0, evidenced: 1, 'self-declared': 2 } as const;

function ordered(assessments: readonly FactAssessment[]): string[] {
  return [...assessments]
    .sort((a, b) => trustRank[a.trust] - trustRank[b.trust] || a.fact.id.localeCompare(b.fact.id))
    .map((a) => a.fact.id);
}

function yearsOf(a: FactAssessment): number | undefined {
  const years = a.fact.attrs.years;
  return typeof years === 'number' ? years : undefined;
}

function attr(base: FactBase, category: string, kind?: string): FactAssessment | undefined {
  return base.usable().find((a) => a.fact.category === category && (kind === undefined || a.fact.attrs.kind === kind) && a.fact.status !== 'stale');
}

/** The country id of the freelancer's declared location, when the location fact names a known country. */
export function declaredCountry(base: FactBase): { readonly place: string | undefined; readonly factId: string; readonly text: string } | undefined {
  const fact = attr(base, 'constraint', 'location');
  if (fact === undefined) return undefined;
  const text = String(fact.fact.attrs.value);
  return { place: resolvePlace(text), factId: fact.fact.id, text };
}

export function declaredTimezone(base: FactBase): { readonly offset: number; readonly factId: string } | undefined {
  const fact = attr(base, 'constraint', 'timezone');
  if (fact === undefined) return undefined;
  const offset = parseUtcOffset(String(fact.fact.attrs.value));
  return offset === undefined ? undefined : { offset, factId: fact.fact.id };
}

/** Smallest distance in hours between two UTC offsets, going either way round the clock. */
export function zoneGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

function techRow(req: Requirement, usable: readonly FactAssessment[]): Pick<CoverageRow, 'status' | 'factIds' | 'note'> {
  const id = req.techId as string;
  const entry = techById(id);
  const implying = new Set(
    usable.flatMap((a) => a.techs).filter((t) => t === id || (techById(t)?.implies.includes(id) ?? false)),
  );
  const direct = usable.filter((a) => a.techs.some((t) => implying.has(t)));
  const relatedIds = new Set(entry?.related ?? []);
  const related = usable.filter((a) => a.techs.some((t) => relatedIds.has(t)));

  if (direct.length > 0) {
    if (req.years === undefined) return { status: 'covered', factIds: ordered(direct), note: 'verified or evidenced fact names this technology' };
    const best = Math.max(0, ...direct.map((a) => yearsOf(a) ?? 0));
    if (best >= req.years) {
      return { status: 'covered', factIds: ordered(direct.filter((a) => (yearsOf(a) ?? 0) >= req.years!)), note: `${best} years evidenced, ${req.years} asked` };
    }
    return {
      status: 'partial',
      factIds: ordered(direct),
      note: best === 0 ? `technology covered, but no fact states years (${req.years} asked)` : `${best} years evidenced, ${req.years} asked`,
    };
  }
  if (related.length > 0) return { status: 'partial', factIds: ordered(related), note: 'only related technologies are evidenced' };
  return { status: 'uncovered', factIds: [], note: 'no usable fact mentions this technology' };
}

/** Matches every requirement against the facts the claim policy lets a proposal use. */
export function buildCoverage(spec: JobSpec, base: FactBase, config: Config): CoverageRow[] {
  const usable = base.usable();
  return spec.requirements.map((req): CoverageRow => {
    const weight = req.kind === 'location' || req.kind === 'timezone' ? 0 : req.priority === 'must' ? config.scoring.mustWeight : config.scoring.niceWeight;
    const result = rowFor(req, usable, base, spec, config);
    const credit = result.status === 'covered' ? config.scoring.coveredCredit : result.status === 'partial' ? config.scoring.partialCredit : 0;
    return { requirementId: req.id, kind: req.kind, label: req.label, priority: req.priority, weight, credit, ...result };
  });
}

function rowFor(
  req: Requirement,
  usable: readonly FactAssessment[],
  base: FactBase,
  spec: JobSpec,
  config: Config,
): Pick<CoverageRow, 'status' | 'factIds' | 'note'> {
  switch (req.kind) {
    case 'tech':
      return techRow(req, usable);
    case 'experience': {
      const withYears = usable.filter((a) => yearsOf(a) !== undefined);
      const best = Math.max(0, ...withYears.map((a) => yearsOf(a) as number));
      const needed = req.years as number;
      if (best >= needed) return { status: 'covered', factIds: ordered(withYears.filter((a) => (yearsOf(a) as number) >= needed)), note: `${best} years evidenced, ${needed} asked` };
      if (best > 0) return { status: 'partial', factIds: ordered(withYears), note: `${best} years evidenced, ${needed} asked` };
      return { status: 'uncovered', factIds: [], note: 'no fact states years of experience' };
    }
    case 'language': {
      const hit = usable.find((a) => a.fact.category === 'constraint' && a.fact.attrs.kind === 'language' && String(a.fact.attrs.value).toLowerCase() === req.language);
      return hit === undefined
        ? { status: 'uncovered', factIds: [], note: 'no language fact for this language' }
        : { status: 'covered', factIds: [hit.fact.id], note: 'declared language' };
    }
    case 'availability': {
      const fact = attr(base, 'availability');
      if (fact === undefined) return { status: 'uncovered', factIds: [], note: 'no availability fact' };
      const have = fact.fact.attrs.hoursPerWeek as number;
      const need = req.hoursPerWeek as number;
      const status = have >= need ? 'covered' : have >= need / 2 ? 'partial' : 'uncovered';
      return { status, factIds: [fact.fact.id], note: `${have} hours per week declared, ${need} asked` };
    }
    case 'location': {
      const restriction = spec.locationRestriction;
      const mine = declaredCountry(base);
      if (restriction === undefined || mine === undefined || mine.place === undefined) {
        return { status: 'uncovered', factIds: mine === undefined ? [] : [mine.factId], note: mine === undefined ? 'no location fact' : 'declared location is not a known country' };
      }
      const inside = restriction.places.some((p) => placeIncludes(p, mine.place as string));
      const ok = restriction.mode === 'excluding' ? !inside : inside;
      return { status: ok ? 'covered' : 'uncovered', factIds: [mine.factId], note: `declared location: ${mine.text}` };
    }
    case 'timezone': {
      const tz = declaredTimezone(base);
      if (tz === undefined || spec.timezone === undefined) return { status: 'uncovered', factIds: [], note: 'no timezone fact' };
      const gap = zoneGap(tz.offset, spec.timezone.offset);
      return { status: gap <= config.risk.maxTimezoneGapHours ? 'covered' : 'uncovered', factIds: [tz.factId], note: `${gap} hours apart` };
    }
  }
}
