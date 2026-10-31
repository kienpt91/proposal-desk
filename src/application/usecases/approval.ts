import { analyzeJob } from '../../domain/analysis/analyze.js';
import type { Config } from '../../domain/config/config.js';
import type { FactBase } from '../../domain/facts/fact-base.js';
import type { JobPosting } from '../../domain/job/posting.js';
import { bindingDigest, checkApproval, newApproval, type Approval, type ApprovalBinding } from '../../domain/log/approval.js';
import { reviewNotes, type Draft } from '../../domain/proposal/draft.js';
import { proposalBody, verifyProposal, type CheckReport, type Violation } from '../../domain/proposal/verify.js';
import type { LogEntry } from '../../domain/log/chain.js';
import { sha256 } from '../../domain/shared/sha256.js';
import { AppError } from '../errors.js';
import { loadConfig, readVerifiedLog, record, recordAuthenticated, requireAuthentic, requireCheckedFacts, storeObject } from '../context.js';
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
  /** Digest of the cited facts as they are now. */
  readonly currentFactsDigest: string;
  /** Facts whose evidence no longer verifies. */
  readonly notices: readonly string[];
}

async function load(deps: Deps, draftId: string, factsPath: string | undefined): Promise<Context> {
  const found = await findDraft(deps, draftId);
  const draft = found.stored.draft;
  const job = parseJobOrThrow(found.jobText);
  if (job.digest !== draft.jobDigest) throw new AppError('io', `the stored job text of draft ${draft.id} does not match its digest`);
  const checked = await requireCheckedFacts(deps, deps.facts(factsPath));
  const facts = checked.base;
  const config = await loadConfig(deps);
  const citedIds = [...new Set(draft.sentences.flatMap((s) => s.factIds))];
  return { found, draft, job, facts, config, currentFactsDigest: facts.snapshotDigest(citedIds), notices: checked.notices };
}

function bindingFor(ctx: Context, text: string): ApprovalBinding {
  return { textDigest: sha256(text), jobDigest: ctx.job.digest, factsDigest: ctx.currentFactsDigest };
}

function verify(ctx: Context, text: string): CheckReport {
  return verifyProposal({ markdown: text, job: ctx.job, facts: ctx.facts, config: ctx.config });
}

function refuseOnViolations(draft: Draft, check: CheckReport, what: string): void {
  const errors = check.violations.filter((v) => v.severity === 'error');
  if (errors.length > 0) throw new AppError('refused', `${what} of draft ${draft.id} does not pass the check`, errors.map(describeViolation));
}

export interface ApproveInput {
  readonly draftId: string;
  readonly factsPath: string | undefined;
  /** A hand-edited version of the draft (Markdown; provenance and review sections are ignored). Approved in place of the generated text. */
  readonly editedMarkdown?: string;
}

export interface ApproveResult {
  readonly approval: Approval;
  readonly draft: Draft;
  /** True when the approved text is the hand-edited one. */
  readonly edited: boolean;
}

/**
 * Records a human approval bound to the digest of the text, the job text and the facts the draft cites.
 * The text is re-verified first; the human must type the confirmation token on a terminal.
 * With `editedMarkdown` the edited text is approved instead (it must pass the same check).
 */
export async function approveDraft(deps: Deps, input: ApproveInput): Promise<ApproveResult> {
  const ctx = await load(deps, input.draftId, input.factsPath);
  const { draft } = ctx;
  if (ctx.currentFactsDigest !== draft.factsDigest) {
    throw new AppError('refused', `the facts cited by draft ${draft.id} changed since it was written`, [...ctx.notices, 'Run `draft` again so the proposal reflects the current facts.']);
  }
  const editedText = input.editedMarkdown === undefined ? undefined : proposalBody(input.editedMarkdown);
  if (editedText === '') throw new AppError('invalid', 'the edited text is empty');
  const edited = editedText !== undefined && editedText !== draft.text;
  const text = edited ? editedText : draft.text;
  refuseOnViolations(draft, verify(ctx, text), edited ? 'the edited text' : 'the text');

  const binding = bindingFor(ctx, text);
  const digest = bindingDigest(binding);
  const analysis = analyzeJob(ctx.job, ctx.facts, ctx.config).analysis;
  const confirmed = await deps.prompt.confirm({
    title: edited ? `Approve your edited text of draft ${draft.id}?` : `Approve draft ${draft.id}?`,
    lines: [
      'Nothing is sent anywhere. Approval only allows `export` to write the final text to a file.',
      '',
      text,
      '',
      ...reviewNotes(analysis, draft).map((line) => `- ${line}`),
      '',
      `text ${binding.textDigest.slice(0, 12)}  job ${binding.jobDigest.slice(0, 12)}  facts ${binding.factsDigest.slice(0, 12)}`,
    ],
    token: `approve ${digest.slice(0, 8)}`,
  });
  if (!confirmed) throw new AppError('refused', 'approval was not given');
  if (edited) await storeObject(deps, text);
  const approval = newApproval(draft.id, binding, deps.clock.now());
  await recordAuthenticated(deps, 'draft.approved', {
    draftId: draft.id,
    textDigest: approval.textDigest,
    jobDigest: approval.jobDigest,
    factsDigest: approval.factsDigest,
    bindingDigest: approval.bindingDigest,
    approvedAt: approval.approvedAt,
    ...(edited ? { editedTextDigest: approval.textDigest } : {}),
  });
  return { approval, draft, edited };
}

interface StoredApproval {
  readonly entry: LogEntry;
  readonly approval: Approval;
  /** Present when the approved text is a hand-edited version kept in the object store. */
  readonly editedTextDigest: string | undefined;
}

function latestApproval(entries: readonly LogEntry[], draftId: string): StoredApproval | undefined {
  const entry = entries.filter((e) => e.type === 'draft.approved' && e.payload.draftId === draftId).at(-1);
  if (entry === undefined) return undefined;
  const p = entry.payload;
  return {
    entry,
    approval: {
      draftId,
      textDigest: p.textDigest as string,
      jobDigest: p.jobDigest as string,
      factsDigest: p.factsDigest as string,
      bindingDigest: p.bindingDigest as string,
      approvedAt: p.approvedAt as string,
    },
    editedTextDigest: typeof p.editedTextDigest === 'string' ? p.editedTextDigest : undefined,
  };
}

export interface ExportResult {
  readonly path: string;
  readonly bytes: number;
  readonly approval: Approval;
  readonly edited: boolean;
}

/** Writes the approved text to a file. Refuses unless an approval exists for exactly this text, job and facts, and the check still passes. */
export async function exportDraft(
  deps: Deps,
  input: { readonly draftId: string; readonly factsPath: string | undefined; readonly outPath: string; readonly overwrite: boolean },
): Promise<ExportResult> {
  const ctx = await load(deps, input.draftId, input.factsPath);
  const entries = await readVerifiedLog(deps);
  const stored = latestApproval(entries, ctx.draft.id);
  if (stored !== undefined) await requireAuthentic(deps, stored.entry, `the approval of draft ${ctx.draft.id}`);
  let text = ctx.draft.text;
  if (stored?.editedTextDigest !== undefined) {
    const editedText = await deps.objects.get(stored.editedTextDigest);
    if (editedText === undefined) throw new AppError('io', `the approved edited text of draft ${ctx.draft.id} is missing from the state directory`);
    text = editedText;
  }
  const verdict = checkApproval(stored?.approval, bindingFor(ctx, text));
  if (!verdict.ok) throw new AppError('refused', `draft ${ctx.draft.id} cannot be exported`, [...verdict.error, ...ctx.notices, 'Run `approve` again after reviewing the draft.']);
  refuseOnViolations(ctx.draft, verify(ctx, text), 'the approved text');
  const content = `${text}\n`;
  await deps.sink.write(input.outPath, content, { overwrite: input.overwrite });
  const bytes = new TextEncoder().encode(content).length;
  await record(deps, 'draft.exported', { draftId: ctx.draft.id, textDigest: sha256(text), bindingDigest: verdict.value.bindingDigest, bytes });
  return { path: input.outPath, bytes, approval: verdict.value, edited: stored?.editedTextDigest !== undefined };
}
