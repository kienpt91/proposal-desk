import { digestOf } from '../shared/canonical-json.js';
import { fail, ok, type Result } from '../shared/result.js';

/** What a human approval is bound to. Change any of the three and the approval no longer applies. */
export interface ApprovalBinding {
  /** SHA-256 of the draft text. */
  readonly textDigest: string;
  /** SHA-256 of the job text. */
  readonly jobDigest: string;
  /** Digest of the cited facts as they were at drafting time. */
  readonly factsDigest: string;
}

export interface Approval extends ApprovalBinding {
  readonly draftId: string;
  /** Digest over the binding; the value the human confirmed. */
  readonly bindingDigest: string;
  readonly approvedAt: string;
}

export function bindingDigest(binding: ApprovalBinding): string {
  return digestOf({ textDigest: binding.textDigest, jobDigest: binding.jobDigest, factsDigest: binding.factsDigest });
}

export function newApproval(draftId: string, binding: ApprovalBinding, approvedAt: string): Approval {
  return { draftId, ...binding, bindingDigest: bindingDigest(binding), approvedAt };
}

/** The approval stands only when text, job and the cited facts are all exactly what was approved. */
export function checkApproval(approval: Approval | undefined, current: ApprovalBinding): Result<Approval> {
  if (approval === undefined) return fail(['this draft has not been approved']);
  const reasons: string[] = [];
  if (approval.textDigest !== current.textDigest) reasons.push('the draft text changed after approval');
  if (approval.jobDigest !== current.jobDigest) reasons.push('the job text differs from the one that was approved');
  if (approval.factsDigest !== current.factsDigest) reasons.push('the facts behind the draft changed after approval (edited, made stale, or removed)');
  if (approval.bindingDigest !== bindingDigest(approval)) reasons.push('the approval record is inconsistent');
  return reasons.length > 0 ? fail(reasons) : ok(approval);
}
