import { configDigest, diffConfig, parseConfig, type Config, type ConfigChange } from '../../domain/config/config.js';
import { checkProposalApplies, proposalDigest, proposeConfig, type ConfigProposal, type Setting } from '../../domain/config/proposal.js';
import { canonicalJson, type Json } from '../../domain/shared/canonical-json.js';
import { stripUnsafe } from '../../domain/shared/text-safety.js';
import { AppError } from '../errors.js';
import { inspectConfig, loadConfig, record, recordAuthenticated, resolveId, storeObject } from '../context.js';
import type { Deps } from '../ports/index.js';

export async function showConfig(deps: Deps): Promise<{ readonly config: Config; readonly digest: string; readonly isDefault: boolean; readonly problem: string | undefined }> {
  const stored = await deps.config.load();
  const status = await inspectConfig(deps);
  return { config: status.config, digest: configDigest(status.config), isDefault: stored === undefined, problem: status.problem };
}

/** Writes a proposal down (in the log and the object store) without changing anything. A human applies it later. */
export async function proposeConfigChange(deps: Deps, input: { readonly settings: readonly Setting[]; readonly note?: string }): Promise<ConfigProposal> {
  const current = await loadConfig(deps);
  const note = input.note === undefined ? undefined : stripUnsafe(input.note).trim();
  if (note !== undefined && note.length > 200) throw new AppError('invalid', 'the note is longer than 200 characters');
  const proposal = proposeConfig(current, input.settings, note === '' ? undefined : note);
  if (!proposal.ok) throw new AppError('invalid', 'the proposal was rejected', proposal.error);
  const p = proposal.value;
  const objectDigest = await storeObject(
    deps,
    canonicalJson({ schema: 1, digest: p.digest, fromDigest: p.fromDigest, fromVersion: p.fromVersion, proposed: p.proposed, note: p.note } as unknown as Json),
  );
  await record(deps, 'config.proposed', {
    proposalDigest: p.digest,
    objectDigest,
    fromVersion: p.fromVersion,
    toVersion: p.proposed.version,
    changes: p.changes.map((c) => ({ path: c.path, before: c.before, after: c.after })),
    ...(p.note === undefined ? {} : { note: p.note }),
  });
  return p;
}

async function loadProposal(deps: Deps, wanted: string): Promise<ConfigProposal> {
  const entries = (await deps.log.readAll()).filter((e) => e.type === 'config.proposed');
  const digest = resolveId(entries.map((e) => e.payload.proposalDigest as string), wanted, 'configuration proposal');
  const entry = entries.filter((e) => e.payload.proposalDigest === digest).at(-1);
  const text = await deps.objects.get(entry?.payload.objectDigest as string);
  if (text === undefined) throw new AppError('io', 'the stored proposal is missing from the state directory');
  let raw: { digest?: string; fromDigest?: string; fromVersion?: number; proposed?: unknown; note?: string };
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('io', 'the stored proposal is not valid JSON');
  }
  const proposed = parseConfig(raw.proposed);
  if (!proposed.ok || typeof raw.fromDigest !== 'string' || typeof raw.fromVersion !== 'number' || typeof raw.digest !== 'string') {
    throw new AppError('io', 'the stored proposal is malformed', proposed.ok ? [] : proposed.error);
  }
  if (proposalDigest(raw.fromDigest, proposed.value) !== raw.digest) throw new AppError('io', 'the stored proposal does not match its digest');
  // The changes are recomputed against the active configuration when the proposal is applied.
  return { digest: raw.digest, fromDigest: raw.fromDigest, fromVersion: raw.fromVersion, proposed: proposed.value, changes: [], note: raw.note };
}

export interface ApplyResult {
  readonly proposal: ConfigProposal;
  readonly changes: readonly ConfigChange[];
}

/** Shows the diff, asks a human on a terminal, then makes the proposed configuration the active one. */
export async function applyConfigProposal(deps: Deps, input: { readonly digest: string }): Promise<ApplyResult> {
  const current = await loadConfig(deps);
  const proposal = await loadProposal(deps, input.digest);
  const applicable = checkProposalApplies(current, proposal);
  if (!applicable.ok) throw new AppError('refused', 'this proposal cannot be applied', applicable.error);
  const changes = diffConfig(current, applicable.value).filter((c) => c.path !== 'version');
  const confirmed = await deps.prompt.confirm({
    title: `Apply configuration proposal ${proposal.digest.slice(0, 12)}?`,
    lines: [
      `version ${current.version} -> ${applicable.value.version}`,
      ...changes.map((c) => `${c.path}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`),
      ...(proposal.note === undefined ? [] : [`note: ${proposal.note}`]),
      `digest ${proposal.digest}`,
    ],
    token: `apply ${proposal.digest.slice(0, 8)}`,
  });
  if (!confirmed) throw new AppError('refused', 'the proposal was not applied');
  await deps.config.save(applicable.value);
  await recordAuthenticated(deps, 'config.applied', { proposalDigest: proposal.digest, version: applicable.value.version, configDigest: configDigest(applicable.value) });
  return { proposal, changes };
}
