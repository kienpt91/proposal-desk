import { digestOf } from '../shared/canonical-json.js';
import { fail, ok, type Result } from '../shared/result.js';
import { configDigest, diffConfig, setConfigValue, type Config, type ConfigChange } from './config.js';

/** A change to the scoring or templates, waiting for a human to approve and apply it. Proposals are data, never code. */
export interface ConfigProposal {
  /** Digest of (the configuration it applies to, the configuration it produces). This is what `config apply` takes. */
  readonly digest: string;
  readonly fromDigest: string;
  readonly fromVersion: number;
  readonly proposed: Config;
  readonly changes: readonly ConfigChange[];
  readonly note: string | undefined;
}

export interface Setting {
  readonly path: string;
  readonly value: string;
}

export function proposalDigest(fromDigest: string, proposed: Config): string {
  return digestOf({ from: fromDigest, to: configDigest(proposed) });
}

/** Applies the settings one by one to `current`, bumps the version and describes the difference. */
export function proposeConfig(current: Config, settings: readonly Setting[], note?: string): Result<ConfigProposal> {
  if (settings.length === 0) return fail(['nothing to propose: pass at least one --set path=value']);
  let next = current;
  for (const { path, value } of settings) {
    const result = setConfigValue(next, path, value);
    if (!result.ok) return fail(result.error);
    next = result.value;
  }
  const proposed: Config = { ...next, version: current.version + 1 };
  const changes = diffConfig(current, proposed).filter((c) => c.path !== 'version');
  if (changes.length === 0) return fail(['the proposal changes nothing']);
  const fromDigest = configDigest(current);
  return ok({ digest: proposalDigest(fromDigest, proposed), fromDigest, fromVersion: current.version, proposed, changes, note });
}

/** A proposal applies only to the exact configuration it was written against, and only if its digest is intact. */
export function checkProposalApplies(current: Config, proposal: ConfigProposal): Result<Config> {
  if (proposal.fromDigest !== configDigest(current)) return fail(['the configuration changed since this proposal was made; propose again']);
  if (proposal.digest !== proposalDigest(proposal.fromDigest, proposal.proposed)) return fail(['the proposal digest does not match its content']);
  if (proposal.proposed.version !== current.version + 1) return fail(['the proposal does not follow the current configuration version']);
  return ok(proposal.proposed);
}
