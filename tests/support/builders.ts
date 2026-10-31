import { parseFact, type Evidence, type Fact } from '../../src/domain/facts/fact.js';

type Overrides = Partial<Omit<Fact, 'evidence'>> & { evidence?: Partial<Evidence> };

const DIGEST = 'a'.repeat(64);

function build(base: Record<string, unknown>, overrides: Overrides): Fact {
  const { evidence: evidenceOverrides, ...rest } = overrides;
  const evidence = { ...(base.evidence as Record<string, unknown>), ...(evidenceOverrides ?? {}) };
  const parsed = parseFact({ ...base, ...rest, evidence });
  if (!parsed.ok) throw new Error(`invalid test fact: ${parsed.error.join('; ')}`);
  return parsed.value;
}

/** A valid verified fact backed by a file hash; `overrides` replace fields (evidence is merged). */
export function fact(overrides: Overrides = {}): Fact {
  return build(
    {
      id: 'ts-services',
      claim: 'Built and maintained TypeScript services on Node.js',
      category: 'skill',
      evidence: { kind: 'file-hash', reference: 'evidence/ts.md', digest: DIGEST, date: '2026-05-01' },
      status: 'verified',
      tags: ['typescript'],
      attrs: {},
      checkedAt: '2026-10-01',
    },
    overrides,
  );
}

/** A declared fact whose only evidence is the freelancer's own word. */
export function selfDeclared(overrides: Overrides = {}): Fact {
  return build(
    {
      id: 'self-fact',
      claim: 'Worked with TypeScript on several products',
      category: 'skill',
      evidence: { kind: 'self-declared', reference: 'my own statement', date: '2026-05-01' },
      status: 'declared',
      tags: ['typescript'],
      attrs: {},
    },
    overrides,
  );
}

export function rateFact(floor = 40, currency = 'USD', unit: 'hour' | 'project' = 'hour'): Fact {
  return selfDeclared({
    id: 'rate-floor',
    claim: `My minimum rate is ${floor} ${currency} per ${unit}`,
    category: 'rate',
    tags: [],
    attrs: { floor, currency, unit },
  });
}

export function locationFact(value = 'Vietnam'): Fact {
  return selfDeclared({ id: 'location', claim: `Based in ${value}`, category: 'constraint', tags: [], attrs: { kind: 'location', value } });
}

export function timezoneFact(value = 'UTC+7'): Fact {
  return selfDeclared({ id: 'timezone', claim: `Working hours follow ${value}`, category: 'constraint', tags: [], attrs: { kind: 'timezone', value } });
}

export function availabilityFact(hoursPerWeek = 20): Fact {
  return selfDeclared({ id: 'availability', claim: `Available ${hoursPerWeek} hours per week`, category: 'availability', tags: [], attrs: { hoursPerWeek } });
}
