import { approveDraft, exportDraft } from '../../application/usecases/approval.js';
import { analyzeJobText, checkProposalText, draftFromJob } from '../../application/usecases/analysis.js';
import { applyConfigProposal, proposeConfigChange, showConfig } from '../../application/usecases/config.js';
import { addFact, listFacts, staleFacts, verifyFacts } from '../../application/usecases/facts.js';
import { insightsReport, recordOutcome } from '../../application/usecases/learning.js';
import { history, verifyLog } from '../../application/usecases/state.js';
import type { Deps } from '../../application/ports/index.js';
import { TONES, type Tone } from '../../domain/config/config.js';
import { EVIDENCE_KINDS, FACT_CATEGORIES, type AttrValue, type EvidenceKind, type FactCategory } from '../../domain/facts/fact.js';
import { LOG_EVENT_TYPES } from '../../domain/log/chain.js';
import { reviewNotes } from '../../domain/proposal/draft.js';
import { SIZE_LIMITS, readText, USER_FILE } from '../fs/safe-fs.js';
import { flagBool, flagInt, flagList, flagString, UsageError, type FlagSpec, type ParsedArgs, type PositionalSpec } from './args.js';
import type { CliIo, Output } from './output.js';
import {
  renderAnalysis,
  renderCheck,
  renderConfig,
  renderDraftFooter,
  renderFacts,
  renderHistory,
  renderInsights,
  renderLogVerification,
  renderStale,
  renderVerify,
} from './render.js';

export interface CommandContext {
  readonly args: ParsedArgs;
  readonly out: Output;
  readonly io: CliIo;
  readonly deps: Deps;
}

export interface Command {
  readonly path: readonly string[];
  readonly summary: string;
  readonly positionals: readonly PositionalSpec[];
  readonly flags: readonly FlagSpec[];
  readonly description?: string;
  /** Returns the exit status. */
  readonly run: (ctx: CommandContext) => Promise<number>;
}

const FACTS: FlagSpec = { name: 'facts', kind: 'string', value: '<file>', help: 'facts file (default: <state>/facts.json)' };
const JSON_FLAG: FlagSpec = { name: 'json', kind: 'boolean', help: 'print machine-readable JSON' };

async function readInput(io: CliIo, path: string, limit: number): Promise<string> {
  return path === '-' ? io.readStdin(limit) : readText(path, limit, USER_FILE);
}

function attrValue(raw: string): AttrValue {
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T {
  if (value === undefined) throw new UsageError(`--${flag} is required (${allowed.join(', ')})`);
  if (!(allowed as readonly string[]).includes(value)) throw new UsageError(`--${flag} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function need(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (value === undefined) throw new UsageError(`--${name} is required`);
  return value;
}

export const COMMANDS: readonly Command[] = [
  {
    path: ['facts', 'add'],
    summary: 'add a fact about yourself, with its evidence',
    description:
      'Claims are short statements without pronouns ("Built and maintained TypeScript services for five years").\nEvidence of kind file-hash, command-output or document must be a local file: it is hashed now and the fact is stored as verified.\nrepo-url and self-declared facts are stored as declared. Numbers and outcomes need evidence beyond self-declared to be usable.',
    positionals: [],
    flags: [
      { name: 'id', kind: 'string', value: '<id>', help: 'lower-case id, for example ts-services' },
      { name: 'claim', kind: 'string', value: '<text>', help: 'the claim, 8-200 characters' },
      { name: 'category', kind: 'string', value: `<${FACT_CATEGORIES.join('|')}>`, help: 'what kind of fact this is' },
      { name: 'evidence', kind: 'string', value: `<${EVIDENCE_KINDS.join('|')}>`, help: 'evidence kind' },
      { name: 'ref', kind: 'string', value: '<path|url>', help: 'evidence file (resolved next to the facts file) or URL' },
      { name: 'note', kind: 'string', value: '<text>', help: 'for command-output: the command that produced the file' },
      { name: 'date', kind: 'string', value: '<YYYY-MM-DD>', help: 'date of the evidence' },
      { name: 'tag', kind: 'list', value: '<tech>', help: 'technology tag, repeatable' },
      { name: 'attr', kind: 'list', value: '<key=value>', help: 'attribute such as years=5, floor=40, kind=location, repeatable' },
      FACTS,
    ],
    run: async ({ args, out, deps }) => {
      const kind = oneOf<EvidenceKind>(flagString(args, 'evidence'), EVIDENCE_KINDS, 'evidence');
      const ref = flagString(args, 'ref') ?? (kind === 'self-declared' ? 'own statement' : undefined);
      if (ref === undefined) throw new UsageError('--ref is required');
      const attrs: Record<string, AttrValue> = {};
      for (const pair of flagList(args, 'attr')) {
        const at = pair.indexOf('=');
        if (at < 1) throw new UsageError(`--attr expects key=value, got ${JSON.stringify(pair)}`);
        attrs[pair.slice(0, at)] = attrValue(pair.slice(at + 1));
      }
      const note = flagString(args, 'note');
      const date = flagString(args, 'date');
      const result = await addFact(deps, {
        factsPath: flagString(args, 'facts'),
        id: need(args, 'id'),
        claim: need(args, 'claim'),
        category: oneOf<FactCategory>(flagString(args, 'category'), FACT_CATEGORIES, 'category'),
        evidenceKind: kind,
        reference: ref,
        ...(note === undefined ? {} : { note }),
        ...(date === undefined ? {} : { date }),
        tags: flagList(args, 'tag'),
        attrs,
      });
      out.out(`Added ${result.fact.id} to ${result.location}: ${result.fact.status}, ${result.assessment.trust}, ${result.assessment.usable ? 'usable in proposals' : 'NOT usable in proposals'}.`);
      for (const reason of result.assessment.exclusions) out.out(`  ${reason}`);
      return 0;
    },
  },
  {
    path: ['facts', 'list'],
    summary: 'list facts with their trust level and whether proposals may use them',
    positionals: [],
    flags: [FACTS, JSON_FLAG],
    run: async ({ args, out, deps }) => {
      const result = await listFacts(deps, { factsPath: flagString(args, 'facts') });
      if (flagBool(args, 'json')) out.json(result.assessments.map((a) => ({ ...a.fact, trust: a.trust, usable: a.usable, exclusions: a.exclusions })));
      else out.out(renderFacts(result.assessments, result.location));
      return 0;
    },
  },
  {
    path: ['facts', 'verify'],
    summary: 're-hash the evidence files of facts; changed or missing evidence makes a fact stale',
    positionals: [{ name: 'id', optional: true, variadic: true }],
    flags: [FACTS],
    run: async ({ args, out, deps }) => {
      const results = await verifyFacts(deps, { factsPath: flagString(args, 'facts'), ids: args.positionals });
      out.out(renderVerify(results));
      return results.some((r) => r.outcome === 'stale') ? 1 : 0;
    },
  },
  {
    path: ['facts', 'stale'],
    summary: 'list stale facts and facts not re-checked recently',
    positionals: [],
    flags: [
      { name: 'days', kind: 'string', value: '<n>', help: 'age limit in days (default from the configuration, 180)' },
      { name: 'mark', kind: 'boolean', help: 'mark the overdue facts stale' },
      FACTS,
    ],
    run: async ({ args, out, deps }) => {
      const mark = flagBool(args, 'mark');
      const days = flagInt(args, 'days', 1, 3650);
      const result = await staleFacts(deps, { factsPath: flagString(args, 'facts'), mark, ...(days === undefined ? {} : { days }) });
      out.out(renderStale(result.days, result.entries, mark));
      return 0;
    },
  },
  {
    path: ['analyze'],
    summary: 'score a pasted job post against your facts',
    description: 'Reads the post from a file, or from standard input with "-". Prints the coverage matrix, risk flags, rate guidance, the fit score with its formula and a recommendation. Nothing is fetched or sent.',
    positionals: [{ name: 'job' }],
    flags: [FACTS, JSON_FLAG],
    run: async ({ args, out, io, deps }) => {
      const jobText = await readInput(io, args.positionals[0] as string, SIZE_LIMITS.jobFile);
      const result = await analyzeJobText(deps, { jobText, factsPath: flagString(args, 'facts') });
      if (flagBool(args, 'json')) out.json(result.analysis);
      else out.out(renderAnalysis(result.analysis, result.factsLocation));
      return 0;
    },
  },
  {
    path: ['draft'],
    summary: 'draft a proposal in which every claim is a verified fact',
    description: 'Prints Markdown with a footnote on every claim, then provenance and review notes. The draft is stored; use its id with check, approve and export. Deterministic: the same inputs give the same bytes.',
    positionals: [{ name: 'job' }],
    flags: [{ name: 'tone', kind: 'string', value: `<${TONES.join('|')}>`, help: 'template set (default plain)' }, FACTS, JSON_FLAG],
    run: async ({ args, out, io, deps }) => {
      const tone: Tone = flagString(args, 'tone') === undefined ? 'plain' : oneOf<Tone>(flagString(args, 'tone'), TONES, 'tone');
      const jobText = await readInput(io, args.positionals[0] as string, SIZE_LIMITS.jobFile);
      const result = await draftFromJob(deps, { jobText, factsPath: flagString(args, 'facts'), tone });
      if (flagBool(args, 'json')) out.json({ draft: result.draft, reviewNotes: reviewNotes(result.analysis, result.draft) });
      else {
        out.out(result.audit.trimEnd());
        out.err('');
        out.err(renderDraftFooter(result.draft));
      }
      return 0;
    },
  },
  {
    path: ['check'],
    summary: 'independently verify a proposal, however it was written',
    description: 'Parses the proposal, matches each sentence to your facts by content and reports numbers or capabilities that no verified fact supports, boilerplate, exaggeration, contact details, length and job-constraint mismatches. Exit status 1 when there are errors.',
    positionals: [{ name: 'proposal' }],
    flags: [{ name: 'job', kind: 'string', value: '<file|->', help: 'the job post the proposal answers' }, FACTS, JSON_FLAG],
    run: async ({ args, out, io, deps }) => {
      const proposalPath = args.positionals[0] as string;
      const jobPath = need(args, 'job');
      if (proposalPath === '-' && jobPath === '-') throw new UsageError('only one of the proposal and --job can be read from standard input');
      const markdown = await readInput(io, proposalPath, SIZE_LIMITS.proposalFile);
      const jobText = await readInput(io, jobPath, SIZE_LIMITS.jobFile);
      const report = await checkProposalText(deps, { markdown, jobText, factsPath: flagString(args, 'facts') });
      if (flagBool(args, 'json')) out.json(report);
      else out.out(renderCheck(report));
      return report.ok ? 0 : 1;
    },
  },
  {
    path: ['approve'],
    summary: 'record your approval of a draft (needs a terminal)',
    description:
      'Shows the draft and what it rests on, then asks you to type a confirmation token. The approval is bound to the digests of the text, the job text and the cited facts.\nIf you edited the draft by hand, pass the file with --text: the edited text must pass the same check and is approved instead.',
    positionals: [{ name: 'draft-id' }],
    flags: [{ name: 'text', kind: 'string', value: '<file|->', help: 'your edited version of the draft (Markdown); provenance and review sections are ignored' }, FACTS],
    run: async ({ args, out, io, deps }) => {
      const textPath = flagString(args, 'text');
      const editedMarkdown = textPath === undefined ? undefined : await readInput(io, textPath, SIZE_LIMITS.proposalFile);
      const result = await approveDraft(deps, { draftId: args.positionals[0] as string, factsPath: flagString(args, 'facts'), ...(editedMarkdown === undefined ? {} : { editedMarkdown }) });
      out.out(`Approved ${result.edited ? 'your edited text of ' : ''}${result.draft.id}. Binding ${result.approval.bindingDigest}.`);
      out.out(`Next: proposal-desk export ${result.draft.id} --out final.md`);
      return 0;
    },
  },
  {
    path: ['export'],
    summary: 'write an approved draft to a Markdown file',
    description: 'Works only for a draft that was approved and is unchanged: same text, same job, same facts, and the check still passes. Writes the plain proposal text; it never sends anything.',
    positionals: [{ name: 'draft-id' }],
    flags: [
      { name: 'out', kind: 'string', value: '<file>', help: 'where to write the final proposal' },
      { name: 'force', kind: 'boolean', help: 'overwrite an existing file' },
      FACTS,
    ],
    run: async ({ args, out, deps }) => {
      const result = await exportDraft(deps, { draftId: args.positionals[0] as string, factsPath: flagString(args, 'facts'), outPath: need(args, 'out'), overwrite: flagBool(args, 'force') });
      out.out(`Wrote ${result.bytes} bytes to ${result.path}. Review it once more and send it yourself.`);
      return 0;
    },
  },
  {
    path: ['outcome', 'record'],
    summary: 'record what happened to a proposal you sent',
    positionals: [{ name: 'draft-id' }, { name: 'outcome' }],
    flags: [
      { name: 'note', kind: 'string', value: '<text>', help: 'free text, up to 300 characters' },
      { name: 'bid', kind: 'string', value: '<amount>', help: 'the bid you actually placed' },
    ],
    run: async ({ args, out, deps }) => {
      const bidRaw = flagString(args, 'bid');
      const bid = bidRaw === undefined ? undefined : Number(bidRaw);
      if (bid !== undefined && !Number.isFinite(bid)) throw new UsageError('--bid must be a number');
      const note = flagString(args, 'note');
      const result = await recordOutcome(deps, { draftId: args.positionals[0] as string, outcome: args.positionals[1] as string, ...(note === undefined ? {} : { note }), ...(bid === undefined ? {} : { bid }) });
      out.out(`Recorded ${result.outcome} for ${result.draftId}.`);
      return 0;
    },
  },
  {
    path: ['insights'],
    summary: 'reply rates by risk flags, fit score and bid, with sample sizes',
    description: 'Simple statistics over the outcomes you recorded. Small samples are marked. Suggestions are text only: change the configuration with `config propose`.',
    positionals: [],
    flags: [JSON_FLAG],
    run: async ({ args, out, deps }) => {
      const insights = await insightsReport(deps);
      if (flagBool(args, 'json')) out.json(insights);
      else out.out(renderInsights(insights));
      return 0;
    },
  },
  {
    path: ['config', 'show'],
    summary: 'show the active scoring and template configuration',
    positionals: [],
    flags: [JSON_FLAG],
    run: async ({ args, out, deps }) => {
      const result = await showConfig(deps);
      if (flagBool(args, 'json')) out.json({ ...result.config, digest: result.digest, isDefault: result.isDefault });
      else out.out(renderConfig(result.config, result.digest, result.isDefault));
      return 0;
    },
  },
  {
    path: ['config', 'propose'],
    summary: 'write down a configuration change for review (changes nothing)',
    description: 'Example: config propose --set scoring.applyThreshold=65 --note "looser threshold". Prints the diff and a digest; apply it with `config apply <digest>`.',
    positionals: [],
    flags: [
      { name: 'set', kind: 'list', value: '<path=value>', help: 'a setting to change, repeatable' },
      { name: 'note', kind: 'string', value: '<text>', help: 'why, up to 200 characters' },
    ],
    run: async ({ args, out, deps }) => {
      const settings = flagList(args, 'set').map((pair) => {
        const at = pair.indexOf('=');
        if (at < 1) throw new UsageError(`--set expects path=value, got ${JSON.stringify(pair)}`);
        return { path: pair.slice(0, at), value: pair.slice(at + 1) };
      });
      const note = flagString(args, 'note');
      const proposal = await proposeConfigChange(deps, { settings, ...(note === undefined ? {} : { note }) });
      out.out(`Proposal ${proposal.digest}`);
      out.out(`version ${proposal.fromVersion} -> ${proposal.proposed.version}`);
      for (const c of proposal.changes) out.out(`  ${c.path}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
      out.out(`Nothing changed. To adopt it: proposal-desk config apply ${proposal.digest.slice(0, 12)}`);
      return 0;
    },
  },
  {
    path: ['config', 'apply'],
    summary: 'apply a proposed configuration after confirming on a terminal',
    positionals: [{ name: 'digest' }],
    flags: [],
    run: async ({ args, out, deps }) => {
      const result = await applyConfigProposal(deps, { digest: args.positionals[0] as string });
      out.out(`Applied configuration version ${result.proposal.proposed.version}.`);
      return 0;
    },
  },
  {
    path: ['history'],
    summary: 'show the most recent log entries',
    positionals: [],
    flags: [
      { name: 'limit', kind: 'string', value: '<n>', help: 'how many entries (default 20)' },
      { name: 'type', kind: 'string', value: `<${LOG_EVENT_TYPES.join('|')}>`, help: 'only entries of this type' },
      JSON_FLAG,
    ],
    run: async ({ args, out, deps }) => {
      const type = flagString(args, 'type');
      if (type !== undefined && !(LOG_EVENT_TYPES as readonly string[]).includes(type)) throw new UsageError(`--type must be one of: ${LOG_EVENT_TYPES.join(', ')}`);
      const items = await history(deps, { limit: flagInt(args, 'limit', 1, 10_000) ?? 20, ...(type === undefined ? {} : { type }) });
      if (flagBool(args, 'json')) out.json(items);
      else out.out(renderHistory(items));
      return 0;
    },
  },
  {
    path: ['verify-log'],
    summary: 'recompute the hash chain and check the stored objects',
    positionals: [],
    flags: [JSON_FLAG],
    run: async ({ args, out, deps }) => {
      const result = await verifyLog(deps);
      if (flagBool(args, 'json')) out.json(result);
      else out.out(renderLogVerification(result));
      return result.chain.ok && result.problems.length === 0 ? 0 : 1;
    },
  },
];
