import { analyzeJob } from '../../domain/analysis/analyze.js';
import { reviewNotes, type Draft } from '../../domain/proposal/draft.js';
import { bindingDigest, checkApproval, newApproval, type Approval, type ApprovalBinding } from '../../domain/log/approval.js';
import { verifyProposal, type CheckReport, type Violation } from '../../domain/proposal/verify.js';
import { sha256 } from '../../domain/shared/sha256.js';
import type { FactBase } from '../../domain/facts/fact-base.js';
import type { Config } from '../../domain/config/config.js';
import type { JobPosting } from '../../domain/job/posting.js';
import { AppError } from '../errors.js';
import { loadConfig, record, requireFacts } from '../context.js';
import { findDraft, type FoundDraft } from '../drafts.js';
import type { Deps } from '../ports/index.js';
import { parseJobOrThrow } from './analysis.js';

const describeViolation = (v: Violation): string => `${v.rule}${v.sentence === undefined ? '' : ` (sentence ${v.sentence})`}: ${v.detail}`;

interface Context {
  readonly found: FoundDraft;
  readonly draft: Draft;
  readonly job: JobPosting;
  readonly facts: FactBase;
  readonly config: Config;
  readonly binding: ApprovalBinding;
  readonly check: CheckReport;
}

async function load(deps: Deps, draftId: string, factsPath: string | undefined): Promise<Context> {
  const found = await findDraft(deps, draftId);
  const draft = found.stored.draft;
  const job = parseJobOrThrow(found.jobText);
  if (job.digest !== draft.jobDigest) throw new AppError('io', `the stored job text of draft ${draft.id} does not match its digest`);
  const facts = await requireFacts(deps.facts(factsPath));
  const config = await loadConfig(deps);
  const citedIds = [...new Set(draft.sentences.flatMap((s) => s.factIds))];
  const binding: ApprovalBinding = { textDigest: sha256(draft.text), jobDigest: job.digest, factsDigest: facts.snapshotDigest(citedIds) };
  const check = verifyProposal({ markdown: draft.text, job, facts, config });
  return { found, draft, job, facts, config, binding, check };
}

function refuseOnViolations(draft: Draft, check: CheckReport): void {
  const errors = check.violations.filter((v) => v.severity === 'error');
  if (errors.length > 0) throw new AppError('refused', `draft ${draft.id} does not pass the check`, errors.map(describeViolation));
}

export interface ApproveResult {
  readonly approval: Approval;
  readonly draft: Draft;
}

/**
 * Records a human approval bound to the digest of the draft text, the job text and the facts it cites.
 * The draft is re-verified first; the human must type the confirmation token on a terminal.
 */
export async function approveDraft(deps: Deps, input: { readonly draftId: string; readonly factsPath: string | undefined }): Promise<ApproveResult> {
  const ctx = await load(deps, input.draftId, input.factsPath);
  const { draft, binding } = ctx;
  if (binding.factsDigest !== draft.factsDigest) {
    throw new AppError('refused', `the facts cited by draft ${draft.id} changed since it was written`, ['Run `draft` again so the proposal reflects the current facts.']);
  }
  refuseOnViolations(draft, ctx.check);
  const analysis = analyzeJob(ctx.job, ctx.facts, ctx.config).analysis;
  const digest = bindingDigest(binding);
  const token = `approve ${digest.slice(0, 8)}`;
  const confirmed = await deps.prompt.confirm({
    title: `Approve draft ${draft.id}?`,
    lines: [
      'Nothing is sent anywhere. Approval only allows `export` to write the final text to a file.',
      '',
      draft.text,
      '',
      ...reviewNotes(analysis, draft).map((line) => `- ${line}`),
      '',
      `text ${binding.textDigest.slice(0, 12)}  job ${binding.jobDigest.slice(0, 12)}  facts ${binding.factsDigest.slice(0, 12)}`,
    ],
    token,
  });
  if (!confirmed) throw new AppError('refused', 'approval was not given');
  const approval = newApproval(draft.id, binding, deps.clock.now());
  await record(deps, 'draft.approved', {
    draftId: draft.id,
    textDigest: approval.textDigest,
    jobDigest: approval.jobDigest,
    factsDigest: approval.factsDigest,
    bindingDigest: approval.bindingDigest,
    approvedAt: approval.approvedAt,
  });
  return { approval, draft };
}

async function latestApproval(deps: Deps, draftId: string): Promise<Approval | undefined> {
  const entry = (await deps.log.readAll()).filter((e) => e.type === 'draft.approved' && e.payload.draftId === draftId).at(-1);
  if (entry === undefined) return undefined;
  const p = entry.payload;
  return {
    draftId,
    textDigest: p.textDigest as string,
    jobDigest: p.jobDigest as string,
    factsDigest: p.factsDigest as string,
    bindingDigest: p.bindingDigest as string,
    approvedAt: p.approvedAt as string,
  };
}

export interface ExportResult {
  readonly path: string;
  readonly bytes: number;
  readonly approval: Approval;
}

/** Writes the approved text to a file. Refuses unless an approval exists for exactly this text, job and facts, and the check still passes. */
export async function exportDraft(
  deps: Deps,
  input: { readonly draftId: string; readonly factsPath: string | undefined; readonly outPath: string; readonly overwrite: boolean },
): Promise<ExportResult> {
  const ctx = await load(deps, input.draftId, input.factsPath);
  const approval = await latestApproval(deps, ctx.draft.id);
  const verdict = checkApproval(approval, ctx.binding);
  if (!verdict.ok) throw new AppError('refused', `draft ${ctx.draft.id} cannot be exported`, [...verdict.error, 'Run `approve` again after reviewing the draft.']);
  refuseOnViolations(ctx.draft, ctx.check);
  const content = `${ctx.draft.text}\n`;
  await deps.sink.write(input.outPath, content, { overwrite: input.overwrite });
  const bytes = new TextEncoder().encode(content).length;
  await record(deps, 'draft.exported', { draftId: ctx.draft.id, textDigest: ctx.binding.textDigest, bindingDigest: verdict.value.bindingDigest, bytes });
  return { path: input.outPath, bytes, approval: verdict.value };
}
