import { describe, expect, it } from 'vitest';
import { zoneGap } from '../../src/domain/analysis/coverage.js';
import { availabilityFact, fact, locationFact, rateFact, selfDeclared, timezoneFact } from '../support/builders.js';
import { EXAMPLE_JOB, analyze, exampleFacts, factBase, typicalFacts } from '../support/analysis.js';

const rows = (text: string, facts = typicalFacts()) =>
  Object.fromEntries(analyze(text, facts).analysis.coverage.map((r) => [r.requirementId, r]));

describe('coverage matrix', () => {
  it('covers technologies named in verified facts and cites them', () => {
    const r = rows('Requirements:\n- TypeScript\n- PostgreSQL\n- Docker');
    expect(r['tech:typescript']).toMatchObject({ status: 'covered', factIds: ['ts'], weight: 3, credit: 1 });
    expect(r['tech:postgresql']).toMatchObject({ status: 'covered', factIds: ['pg'] });
    expect(r['tech:docker']).toMatchObject({ status: 'covered', factIds: ['docker'] });
  });

  it('lets a technology imply another and a related technology cover partially', () => {
    const r = rows('Requirements:\n- JavaScript\n- Next.js\n- Kubernetes\n- MySQL\n- GraphQL');
    expect(r['tech:javascript']).toMatchObject({ status: 'covered', factIds: ['ts'] });
    expect(r['tech:nextjs']).toMatchObject({ status: 'partial', factIds: ['ts'] });
    expect(r['tech:kubernetes']).toMatchObject({ status: 'partial', factIds: ['docker'] });
    expect(r['tech:mysql']).toMatchObject({ status: 'partial', factIds: ['pg'] });
    expect(r['tech:graphql']).toMatchObject({ status: 'uncovered', factIds: [], credit: 0 });
  });

  it('checks years of experience against the evidenced years', () => {
    expect(rows('Requirements:\n- 4+ years of TypeScript')['tech:typescript']).toMatchObject({ status: 'covered', note: '5 years evidenced, 4 asked' });
    expect(rows('Requirements:\n- 8 years of TypeScript')['tech:typescript']).toMatchObject({ status: 'partial', note: '5 years evidenced, 8 asked' });
    expect(rows('Requirements:\n- 3 years of PostgreSQL')['tech:postgresql']).toMatchObject({ status: 'partial', note: 'technology covered, but no fact states years (3 asked)' });
    expect(rows('Requirements:\n- At least 3 years of professional experience')['exp:3']).toMatchObject({ status: 'covered', factIds: ['ts'] });
    expect(rows('Requirements:\n- At least 9 years of professional experience')['exp:9']).toMatchObject({ status: 'partial' });
    expect(rows('Requirements:\n- 5 years of professional experience', factBase(fact({ id: 'x', attrs: {} })))['exp:5']).toMatchObject({ status: 'uncovered' });
  });

  it('ignores facts the claim policy excludes', () => {
    const facts = factBase(
      fact({ id: 'old-ts', status: 'stale', tags: ['typescript'] }),
      selfDeclared({ id: 'boast', claim: 'Served ten thousand users with Redis', tags: ['redis'] }),
    );
    const r = rows('Requirements:\n- TypeScript\n- Redis', facts);
    expect(r['tech:typescript']?.status).toBe('uncovered');
    expect(r['tech:redis']?.status).toBe('uncovered');
  });

  it('matches languages and availability', () => {
    const facts = factBase(
      selfDeclared({ id: 'en', claim: 'Professional working proficiency in English', category: 'constraint', tags: [], attrs: { kind: 'language', value: 'English' } }),
      availabilityFact(20),
    );
    expect(rows('Fluent English required. 15 hours per week.', facts)['lang:english']).toMatchObject({ status: 'covered', factIds: ['en'] });
    expect(rows('Fluent German required.', facts)['lang:german']?.status).toBe('uncovered');
    expect(rows('Must work 15 hours per week.', facts)['avail']?.status).toBe('covered');
    expect(rows('Must work 30 hours per week.', facts)['avail']).toMatchObject({ status: 'partial', note: '20 hours per week declared, 30 asked' });
    expect(rows('Must work 50 hours per week.', facts)['avail']?.status).toBe('uncovered');
    expect(rows('Must work 15 hours per week.', factBase(rateFact()))['avail']).toMatchObject({ status: 'uncovered', note: 'no availability fact' });
  });

  it('treats location and timezone as zero-weight gates', () => {
    const us = rows('Applicants must be located in the US. Need overlap with EST.');
    expect(us['location']).toMatchObject({ status: 'uncovered', weight: 0, factIds: ['location'] });
    expect(us['timezone']).toMatchObject({ status: 'uncovered', weight: 0, note: '12 hours apart' });
    const vn = rows('Applicants must be located in Vietnam. Need overlap with ICT.');
    expect(vn['location']?.status).toBe('covered');
    expect(vn['timezone']?.status).toBe('covered');
    expect(rows('We cannot accept applicants from Vietnam.')['location']?.status).toBe('uncovered');
    expect(rows('We cannot accept applicants from India.')['location']?.status).toBe('covered');
    expect(rows('US only.', factBase(rateFact()))['location']).toMatchObject({ status: 'uncovered', note: 'no location fact' });
    expect(rows('US only.', factBase(locationFact('Atlantis')))['location']?.note).toContain('not a known country');
    expect(rows('Overlap with EST needed.', factBase(rateFact()))['timezone']?.note).toBe('no timezone fact');
    expect(rows('Overlap with EST needed.', factBase(timezoneFact('UTC+7')))['timezone']?.status).toBe('uncovered');
  });

  it('computes circular timezone gaps', () => {
    expect(zoneGap(7, -5)).toBe(12);
    expect(zoneGap(11, -11)).toBe(2);
    expect(zoneGap(1, 1)).toBe(0);
  });

  it('orders cited facts by trust then id', () => {
    const facts = factBase(
      selfDeclared({ id: 'a-self', claim: 'Worked with Redis caching', tags: ['redis'] }),
      fact({ id: 'z-verified', claim: 'Operated Redis clusters', tags: ['redis'] }),
      fact({ id: 'm-evidenced', claim: 'Tuned Redis eviction policies', tags: ['redis'], status: 'declared', checkedAt: undefined }),
    );
    expect(rows('Requirements:\n- Redis', facts)['tech:redis']?.factIds).toEqual(['z-verified', 'm-evidenced', 'a-self']);
  });

  it('covers the shipped example post as documented', () => {
    const { analysis } = analyze(EXAMPLE_JOB, exampleFacts());
    const status = Object.fromEntries(analysis.coverage.map((r) => [r.requirementId, r.status]));
    expect(status['tech:redis']).toBe('uncovered');
    expect(status['tech:typescript']).toBe('covered');
    expect(status['tech:kubernetes']).toBe('partial');
  });
});
