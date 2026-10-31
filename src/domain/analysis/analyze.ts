import type { Config } from '../config/config.js';
import type { FactBase } from '../facts/fact-base.js';
import type { JobMetadata, JobPosting } from '../job/posting.js';
import { extractSpec, type JobSpec } from '../job/spec.js';
import { buildCoverage, type CoverageRow } from './coverage.js';
import { guideRate, type RateGuidance } from './rate.js';
import { detectRisks, type RiskFlag } from './risk.js';
import { computeScore, recommend, type FitScore, type Verdict } from './score.js';

/** The complete, deterministic result of analysing one post against one fact base and one configuration. */
export interface JobAnalysis {
  readonly jobDigest: string;
  readonly configVersion: number;
  readonly title: string;
  readonly metadata: JobMetadata;
  readonly spec: Omit<JobSpec, 'sentences'>;
  readonly coverage: readonly CoverageRow[];
  readonly rate: RateGuidance;
  readonly flags: readonly RiskFlag[];
  readonly score: FitScore;
  readonly verdict: Verdict;
}

export interface AnalysisWorkingSet {
  readonly analysis: JobAnalysis;
  /** The full spec including sentences, for steps that need to look at the text again (drafting). */
  readonly spec: JobSpec;
}

export function analyzeJob(job: JobPosting, facts: FactBase, config: Config): AnalysisWorkingSet {
  const spec = extractSpec(job);
  const coverage = buildCoverage(spec, facts, config);
  const rate = guideRate(job, spec, facts, config);
  const flags = detectRisks({ job, spec, coverage, facts, rate, config });
  const score = computeScore(coverage, flags, config);
  const verdict = recommend(score, coverage, flags, config);
  const { sentences: _sentences, ...publicSpec } = spec;
  void _sentences;
  return {
    spec,
    analysis: { jobDigest: job.digest, configVersion: config.version, title: job.title, metadata: job.metadata, spec: publicSpec, coverage, rate, flags, score, verdict },
  };
}
