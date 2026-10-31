import type { JobAnalysis, AnalysisWorkingSet } from '../analysis/analyze.js';
import type { CoverageRow } from '../analysis/coverage.js';
import type { Config, Tone } from '../config/config.js';
import type { Trust } from '../facts/claim-policy.js';
import type { FactBase } from '../facts/fact-base.js';
import type { JobPosting } from '../job/posting.js';
import { digestOf, type Json } from '../shared/canonical-json.js';
import { fail, ok, type Result } from '../shared/result.js';
import { codeSpan, joinList, wordCount } from '../shared/text.js';
import { verifyProposal } from './verify.js';

export type SentenceRole = 'opening' | 'evidence' | 'gap' | 'question' | 'availability' | 'rate' | 'closing';

/** One sentence of the draft with its hidden provenance: the fact ids every claim in it rests on. */
export interface DraftSentence {
  readonly text: string;
  readonly role: SentenceRole;
  readonly factIds: readonly string[];
  readonly paragraph: number;
  /** The job requirement the sentence answers, when it answers one. */
  readonly requirementId?: string;
}

export interface Citation {
  readonly n: number;
  readonly factId: string;
  readonly claim: string;
  readonly category: string;
  readonly trust: Trust;
  readonly evidenceKind: string;
  readonly reference: string;
}

export interface Draft {
  /** `d-` plus 12 hex characters of the digest of the draft's content; the same inputs give the same id. */
  readonly id: string;
  readonly tone: Tone;
  readonly jobDigest: string;
  readonly configVersion: number;
  /** Digest of the cited facts as they were when the draft was written (see FactBase.snapshotDigest). */
  readonly factsDigest: string;
  readonly wordCap: number;
  readonly wordCount: number;
  readonly sentences: readonly DraftSentence[];
  readonly citations: readonly Citation[];
  /** The proposal text: paragraphs separated by a blank line, no footnotes. This is what gets approved and exported. */
  readonly text: string;
  /** Decisions the author should know about (dropped sections, omitted rate line). Never part of the text. */
  readonly notes: readonly string[];
}

export interface DraftInput {
  readonly job: JobPosting;
  readonly working: AnalysisWorkingSet;
  readonly facts: FactBase;
  readonly config: Config;
  readonly tone: Tone;
}

const claimText = (claim: string): string => claim.trim().replace(/[.!\s]+$/, '');
const fill = (template: string, vars: Readonly<Record<string, string>>): string => template.replace(/\{([A-Za-z]+)\}/g, (_m, key: string) => vars[key] ?? '');

interface Section {
  readonly key: string;
  readonly sentences: DraftSentence[];
  /** Lower numbers are dropped first when the draft is over the word cap; undefined means never dropped. */
  readonly dropOrder: number | undefined;
}

function rank(rows: readonly CoverageRow[]): CoverageRow[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort(
    (a, b) =>
      Number(b.row.priority === 'must') - Number(a.row.priority === 'must') ||
      b.row.weight - a.row.weight ||
      Number(b.row.status === 'covered') - Number(a.row.status === 'covered') ||
      a.index - b.index,
  );
  return indexed.map((x) => x.row);
}

/**
 * Assembles a proposal from templates and fact claims only. Every claim sentence embeds a fact's claim
 * verbatim and carries the fact id. The result is deterministic and is run through the independent
 * verifier before it is returned, so a draft that would fail `check` is never produced.
 */
export function draftProposal(input: DraftInput): Result<Draft> {
  const { job, working, facts, config, tone } = input;
  const { analysis } = working;
  const templates = config.drafting.templates[tone];
  const assessments = new Map(facts.assessments().map((a) => [a.fact.id, a]));
  const notes: string[] = [];

  const scored = analysis.coverage.filter((r) => (r.kind === 'tech' || r.kind === 'experience') && r.weight > 0);
  const ranked = rank(scored);
  const focus = ranked.slice(0, 3).map((r) => r.label);

  const sections: Section[] = [];
  let paragraph = 0;
  const section = (key: string, dropOrder: number | undefined, sentences: Omit<DraftSentence, 'paragraph'>[]): void => {
    sections.push({ key, dropOrder, sentences: sentences.map((s) => ({ ...s, paragraph })) });
    paragraph += 1;
  };

  section('opening', undefined, [{ text: fill(templates.opening, { focus: joinList(focus.length > 0 ? focus : ['this project']) }), role: 'opening', factIds: [] }]);

  const used = new Set<string>();
  let evidenceCount = 0;
  for (const row of ranked) {
    if (evidenceCount >= config.drafting.maxEvidence) break;
    if (row.status === 'uncovered') continue;
    const factId = row.factIds.find((id) => !used.has(id) && assessments.get(id)?.usable === true);
    if (factId === undefined) continue;
    used.add(factId);
    evidenceCount += 1;
    const fact = (assessments.get(factId) as NonNullable<ReturnType<typeof assessments.get>>).fact;
    const template = row.status === 'covered' ? templates.evidence : templates.evidencePartial;
    section(`evidence-${evidenceCount}`, evidenceCount === 1 ? undefined : evidenceCount === 2 ? 4 : 2, [
      { text: fill(template, { label: row.label, claim: claimText(fact.claim) }), role: 'evidence', factIds: [factId], requirementId: row.requirementId },
    ]);
  }
  if (evidenceCount === 0) {
    return fail(['No requirement of the post is covered, even partially, by a usable fact: there is nothing honest to say. Add facts, or skip this post.']);
  }

  const gaps = ranked.filter((r) => r.priority === 'must' && r.status === 'uncovered').slice(0, config.drafting.maxGaps);
  if (gaps.length > 0) {
    section('gap', 5, [{ text: fill(templates.gap, { labels: joinList(gaps.map((g) => g.label)) }), role: 'gap', factIds: [] }]);
  }

  const questionLabel = (ranked.find((r) => r.priority === 'must') ?? ranked[0])?.label ?? 'project';
  section('question', undefined, [{ text: fill(templates.question, { label: questionLabel }), role: 'question', factIds: [] }]);

  const closingSentences: Omit<DraftSentence, 'paragraph'>[] = [];
  const availability = facts.usable().find((a) => a.fact.category === 'availability' && a.fact.status !== 'stale');
  if (availability !== undefined) closingSentences.push({ text: fill(templates.availability, { claim: claimText(availability.fact.claim) }), role: 'availability', factIds: [availability.fact.id] });
  const rate = analysis.rate;
  if (rate.suggestion !== undefined && rate.floor !== undefined && !rate.belowFloor && !rate.lowBudget) {
    closingSentences.push({
      text: fill(templates.rate, { amount: String(rate.suggestion.amount), currency: rate.suggestion.currency, unit: rate.suggestion.unit }),
      role: 'rate',
      factIds: [rate.floor.factId],
    });
  } else if (rate.belowFloor || rate.lowBudget) {
    notes.push('The rate line was left out because the budget does not meet your floor; decide by hand what to quote.');
  } else if (rate.suggestion === undefined) {
    notes.push(`The rate line was left out: ${rate.reasoning.at(-1) ?? 'no rate guidance available'}`);
  }
  if (closingSentences.length > 0) section('terms', undefined, closingSentences);
  section('closing', 1, [{ text: templates.closing, role: 'closing', factIds: [] }]);

  // Enforce the word cap by dropping the least valuable sections first.
  const render = (list: readonly Section[]): string => paragraphsOf(list.flatMap((s) => s.sentences));
  let kept = [...sections];
  while (wordCount(render(kept)) > config.drafting.wordCap) {
    const candidate = kept.filter((s) => s.dropOrder !== undefined).sort((a, b) => (a.dropOrder as number) - (b.dropOrder as number))[0];
    if (candidate === undefined) {
      return fail([`Even the essential sentences exceed the ${config.drafting.wordCap}-word cap; shorten the fact claims or raise drafting.wordCap.`]);
    }
    kept = kept.filter((s) => s !== candidate);
    notes.push(`Left out the ${candidate.key.replace(/-\d+$/, '')} section to stay within ${config.drafting.wordCap} words.`);
  }

  const sentences = renumber(kept.flatMap((s) => s.sentences));
  const text = paragraphsOf(sentences);
  const citedIds = [...new Set(sentences.flatMap((s) => s.factIds))];
  const citations: Citation[] = citedIds.map((factId, i) => {
    const a = assessments.get(factId) as NonNullable<ReturnType<typeof assessments.get>>;
    return { n: i + 1, factId, claim: a.fact.claim, category: a.fact.category, trust: a.trust, evidenceKind: a.fact.evidence.kind, reference: a.fact.evidence.reference };
  });
  const factsDigest = facts.snapshotDigest(citedIds);
  const content: Json = {
    tone,
    jobDigest: job.digest,
    configVersion: config.version,
    factsDigest,
    sentences: sentences.map((s) => ({ text: s.text, role: s.role, factIds: [...s.factIds], paragraph: s.paragraph })),
  };
  const draft: Draft = {
    id: `d-${digestOf(content).slice(0, 12)}`,
    tone,
    jobDigest: job.digest,
    configVersion: config.version,
    factsDigest,
    wordCap: config.drafting.wordCap,
    wordCount: wordCount(text),
    sentences,
    citations,
    text,
    notes,
  };

  // The text must pass the independent check. A job-level mismatch is not a defect of the text: it is
  // reported in the notes (and by `check`, which then refuses approval) instead of blocking the draft.
  const errors = verifyProposal({ markdown: text, job, facts, config }).violations.filter((v) => v.severity === 'error');
  const textErrors = errors.filter((v) => v.rule !== 'job-location-mismatch');
  if (textErrors.length > 0) {
    return fail(['The draft failed the independent check, so it was not produced:', ...textErrors.map((v) => `${v.rule}: ${v.detail}`)]);
  }
  const mismatch = errors.find((v) => v.rule === 'job-location-mismatch');
  return ok(mismatch === undefined ? draft : { ...draft, notes: [...draft.notes, `${mismatch.detail} \`check\` will fail on this draft until that is resolved.`] });
}

function renumber(sentences: readonly DraftSentence[]): DraftSentence[] {
  const map = new Map<number, number>();
  return sentences.map((s) => {
    if (!map.has(s.paragraph)) map.set(s.paragraph, map.size);
    return { ...s, paragraph: map.get(s.paragraph) as number };
  });
}

function paragraphsOf(sentences: readonly DraftSentence[]): string {
  const groups: string[][] = [];
  let current = -1;
  for (const s of sentences) {
    if (s.paragraph !== current) {
      groups.push([]);
      current = s.paragraph;
    }
    (groups.at(-1) as string[]).push(s.text);
  }
  return groups.map((g) => g.join(' ')).join('\n\n');
}

/** Lines for the human reviewer: what the post asks that the tool cannot answer, and what to double-check. */
export function reviewNotes(analysis: JobAnalysis, draft: Draft): string[] {
  const lines: string[] = [];
  lines.push(`Recommendation: ${analysis.verdict.recommendation} (fit ${analysis.score.value}).`);
  for (const flag of analysis.flags.filter((f) => f.severity !== 'info')) {
    lines.push(`${flag.severity === 'hard' ? 'HARD WARNING' : 'Warning'}: ${flag.title}. ${flag.ruleId === 'metadata-issues' ? codeSpan(flag.detail) : flag.detail}`);
  }
  for (const ask of analysis.spec.asks) lines.push(`The client asks (answer by hand): ${codeSpan(ask.text)}`);
  for (const attachment of analysis.spec.attachments) lines.push(`The client asks for: ${attachment.kind}. Add it yourself if you choose to.`);
  for (const flag of analysis.flags.filter((f) => f.ruleId === 'screening-instruction')) lines.push(`Screening instruction in the post (not followed): ${codeSpan(flag.excerpt ?? '')}`);
  const weak = draft.citations.filter((c) => c.trust !== 'verified' && !['availability', 'rate', 'constraint'].includes(c.category));
  if (weak.length > 0) lines.push(`Claims resting on evidence the tool could not verify: ${weak.map((c) => `${c.factId} (${c.trust})`).join(', ')}.`);
  lines.push(...draft.notes);
  return lines;
}

/** Markdown for the author: the proposal with a footnote on every claim, then provenance and review notes. */
export function renderAudit(draft: Draft, analysis: JobAnalysis): string {
  const numberOf = new Map(draft.citations.map((c) => [c.factId, c.n]));
  const body: string[] = [];
  let current = -1;
  let group: string[] = [];
  const flush = (): void => {
    if (group.length > 0) body.push(group.join(' '));
    group = [];
  };
  for (const s of draft.sentences) {
    if (s.paragraph !== current) {
      flush();
      current = s.paragraph;
    }
    group.push(`${s.text}${s.factIds.map((id) => `[^${numberOf.get(id)}]`).join('')}`);
  }
  flush();
  const provenance = draft.citations.map((c) => `[^${c.n}]: ${c.factId} (${c.evidenceKind === 'self-declared' ? 'self-declared' : `${c.trust}; ${c.evidenceKind}`}: ${c.reference}) ${c.claim}`);
  const notes = reviewNotes(analysis, draft).map((l) => `- ${l}`);
  return `${body.join('\n\n')}\n\n## Provenance\n\n${provenance.join('\n')}\n\n## Review notes\n\n${notes.join('\n')}\n`;
}
