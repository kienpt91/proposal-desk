import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeJob, type AnalysisWorkingSet } from '../../src/domain/analysis/analyze.js';
import { defaultConfig, type Config } from '../../src/domain/config/config.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import type { Fact } from '../../src/domain/facts/fact.js';
import { parseJobPosting, type JobPosting } from '../../src/domain/job/posting.js';
import { availabilityFact, fact, locationFact, rateFact, selfDeclared, timezoneFact } from './builders.js';

export const ROOT = resolve(import.meta.dirname, '../..');
export const EXAMPLE_JOB = readFileSync(resolve(ROOT, 'examples/job-post.txt'), 'utf8');
export const EXAMPLE_FACTS_JSON = JSON.parse(readFileSync(resolve(ROOT, 'examples/facts.json'), 'utf8')) as unknown;

export function exampleFacts(): FactBase {
  const parsed = FactBase.parse(EXAMPLE_FACTS_JSON);
  if (!parsed.ok) throw new Error(parsed.error.join('; '));
  return parsed.value;
}

export function factBase(...facts: Fact[]): FactBase {
  const parsed = FactBase.fromFacts(facts);
  if (!parsed.ok) throw new Error(parsed.error.join('; '));
  return parsed.value;
}

export function job(text: string): JobPosting {
  const parsed = parseJobPosting(text);
  if (!parsed.ok) throw new Error(parsed.error.join('; '));
  return parsed.value;
}

/** A typical freelancer: TypeScript and Postgres with evidence, Docker self-declared, plus the terms facts. */
export function typicalFacts(): FactBase {
  return factBase(
    fact({ id: 'ts', claim: 'Built and maintained TypeScript services on Node.js for five years', tags: ['typescript', 'node.js'], attrs: { years: 5 } }),
    fact({ id: 'pg', claim: 'Designed PostgreSQL schemas for a billing service', category: 'project', tags: ['postgresql'] }),
    selfDeclared({ id: 'docker', claim: 'Containerised services with Docker', tags: ['docker'] }),
    locationFact('Vietnam'),
    timezoneFact('UTC+7'),
    availabilityFact(20),
    rateFact(40),
  );
}

export function analyze(text: string, facts: FactBase = typicalFacts(), config: Config = defaultConfig()): AnalysisWorkingSet {
  return analyzeJob(job(text), facts, config);
}

export function flagIds(text: string, facts?: FactBase, config?: Config): string[] {
  return analyze(text, facts, config).analysis.flags.map((f) => f.ruleId);
}
