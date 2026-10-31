import { analyzeJob, type AnalysisWorkingSet, type JobAnalysis } from '../../domain/analysis/analyze.js';
import type { Tone } from '../../domain/config/config.js';
import type { FactBase } from '../../domain/facts/fact-base.js';
import { composeJobText, parseJobPosting, type JobPosting } from '../../domain/job/posting.js';
import { draftProposal, renderAudit, type Draft } from '../../domain/proposal/draft.js';
import { proposalBody, verifyProposal, type CheckReport } from '../../domain/proposal/verify.js';
import { sha256 } from '../../domain/shared/sha256.js';
import { AppError } from '../errors.js';
import { loadConfig, record, requireCheckedFacts, storeObject } from '../context.js';
import type { Deps } from '../ports/index.js';
import { serializeStoredDraft, toStoredDraft } from '../records.js';

/** Parses the post; with `metaText` the listing metadata comes from that separate text and never from the post itself. */
export function parseJobOrThrow(jobText: string, metaText?: string): JobPosting {
  const parsed = metaText === undefined ? parseJobPosting(jobText) : parseJobPosting(composeJobText(jobText, metaText), { metadataSource: 'file' });
  if (!parsed.ok) throw new AppError('invalid', 'cannot read the job text', parsed.error);
  return parsed.value;
}

export interface AnalyzeResult {
  readonly job: JobPosting;
  readonly analysis: JobAnalysis;
  readonly factsLocation: string;
  /** Facts whose evidence no longer verifies; they were treated as stale in this run. */
  readonly notices: readonly string[];
}

async function prepare(deps: Deps, jobText: string, factsPath: string | undefined, metaText: string | undefined): Promise<{ job: JobPosting; facts: FactBase; location: string; notices: readonly string[]; working: AnalysisWorkingSet; config: Awaited<ReturnType<typeof loadConfig>> }> {
  const job = parseJobOrThrow(jobText, metaText);
  const checked = await requireCheckedFacts(deps, deps.facts(factsPath));
  const config = await loadConfig(deps);
  return { job, facts: checked.base, location: checked.location, notices: checked.notices, working: analyzeJob(job, checked.base, config), config };
}

/** `analyze`: coverage matrix, risk flags, rate guidance, fit score and a recommendation for one pasted post. */
export async function analyzeJobText(deps: Deps, input: { readonly jobText: string; readonly factsPath: string | undefined; readonly metaText?: string }): Promise<AnalyzeResult> {
  const { job, location, notices, working } = await prepare(deps, input.jobText, input.factsPath, input.metaText);
  const { analysis } = working;
  await storeObject(deps, job.rawText, job.digest);
  const count = (status: string): number => analysis.coverage.filter((r) => r.status === status).length;
  await record(deps, 'job.analyzed', {
    jobDigest: job.digest,
    configVersion: analysis.configVersion,
    fit: analysis.score.value,
    recommendation: analysis.verdict.recommendation,
    flags: analysis.flags.map((f) => f.ruleId),
    covered: count('covered'),
    partial: count('partial'),
    uncovered: count('uncovered'),
  });
  return { job, analysis, factsLocation: location, notices };
}

export interface DraftResult {
  readonly draft: Draft;
  readonly analysis: JobAnalysis;
  /** Markdown with footnotes, provenance and review notes. */
  readonly audit: string;
  readonly factsLocation: string;
  readonly notices: readonly string[];
}

/** `draft`: assembles a proposal from templates and fact claims, stores it and logs it. Nothing is sent anywhere. */
export async function draftFromJob(deps: Deps, input: { readonly jobText: string; readonly factsPath: string | undefined; readonly tone: Tone; readonly metaText?: string }): Promise<DraftResult> {
  const { job, facts, location, notices, working, config } = await prepare(deps, input.jobText, input.factsPath, input.metaText);
  const result = draftProposal({ job, working, facts, config, tone: input.tone });
  if (!result.ok) throw new AppError('refused', 'no draft was produced', [...result.error, ...notices]);
  const draft = result.value;
  await storeObject(deps, job.rawText, job.digest);
  const recordDigest = await storeObject(deps, serializeStoredDraft(toStoredDraft(draft, working.analysis)));
  await record(deps, 'draft.generated', {
    draftId: draft.id,
    recordDigest,
    jobDigest: job.digest,
    factsDigest: draft.factsDigest,
    textDigest: sha256(draft.text),
    tone: draft.tone,
    configVersion: draft.configVersion,
  });
  return { draft, analysis: working.analysis, audit: renderAudit(draft, working.analysis), factsLocation: location, notices };
}

export interface CheckInput {
  readonly markdown: string;
  readonly jobText: string;
  readonly factsPath: string | undefined;
  readonly metaText?: string;
}

/** `check`: the independent gate. Works on any proposal text, whoever or whatever wrote it. */
export interface CheckResult {
  readonly report: CheckReport;
  readonly notices: readonly string[];
}

export async function checkProposalText(deps: Deps, input: CheckInput): Promise<CheckResult> {
  const { job, facts, config, notices } = await prepare(deps, input.jobText, input.factsPath, input.metaText);
  const report = verifyProposal({ markdown: input.markdown, job, facts, config });
  await storeObject(deps, job.rawText, job.digest);
  const draftEntry = await findDraftByText(deps, input.markdown);
  await record(deps, 'proposal.checked', {
    textDigest: sha256(proposalBody(input.markdown)),
    jobDigest: job.digest,
    ok: report.ok,
    errors: report.violations.filter((v) => v.severity === 'error').length,
    warnings: report.violations.filter((v) => v.severity === 'warning').length,
    rules: [...new Set(report.violations.map((v) => v.rule))],
    ...(draftEntry === undefined ? {} : { draftId: draftEntry }),
  });
  return { report, notices };
}

/** The id of a stored draft whose text is exactly this proposal body, so a check can be tied to its draft. */
async function findDraftByText(deps: Deps, markdown: string): Promise<string | undefined> {
  const digest = sha256(proposalBody(markdown));
  const entries = await deps.log.readAll();
  return entries.filter((e) => e.type === 'draft.generated' && e.payload.textDigest === digest).map((e) => e.payload.draftId as string).at(-1);
}
