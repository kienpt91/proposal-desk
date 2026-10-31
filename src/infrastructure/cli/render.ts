import type { JobAnalysis } from '../../domain/analysis/analyze.js';
import type { FactAssessment } from '../../domain/facts/claim-policy.js';
import type { Insights } from '../../domain/learning/insights.js';
import type { Draft } from '../../domain/proposal/draft.js';
import type { CheckReport } from '../../domain/proposal/verify.js';
import type { ChainReport } from '../../domain/log/chain.js';
import type { Config } from '../../domain/config/config.js';
import type { HistoryItem, LogVerification } from '../../application/usecases/state.js';
import type { StaleEntry, VerifyFactResult } from '../../application/usecases/facts.js';

const pad = (text: string, width: number): string => text.padEnd(width);
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const pct = (rate: number | undefined): string => (rate === undefined ? 'n/a' : `${Math.round(rate * 100)}%`);

const RECOMMENDATION: Readonly<Record<string, string>> = { apply: 'APPLY', 'apply-with-caveats': 'APPLY WITH CAVEATS', skip: 'SKIP' };

export function renderAnalysis(analysis: JobAnalysis, factsLocation: string): string {
  const lines: string[] = [];
  lines.push(`Job: ${analysis.title}`);
  lines.push(`Facts: ${factsLocation}   configuration version ${analysis.configVersion}   job digest ${analysis.jobDigest.slice(0, 12)}`);
  lines.push('');
  lines.push(`Recommendation: ${RECOMMENDATION[analysis.verdict.recommendation]}   (fit ${analysis.score.value} / 100)`);
  for (const reason of analysis.verdict.reasons) lines.push(`  - ${reason}`);
  lines.push('');
  lines.push('Fit score (formula, no hidden weights)');
  for (const line of analysis.score.formula) lines.push(`  ${line}`);
  lines.push('');
  lines.push('Requirements and evidence');
  if (analysis.coverage.length === 0) lines.push('  none recognised');
  const rows = [...analysis.coverage].sort((a, b) => Number(b.priority === 'must') - Number(a.priority === 'must'));
  const labelWidth = Math.min(40, Math.max(...rows.map((r) => r.label.length), 5));
  for (const row of rows) {
    const facts = row.factIds.length > 0 ? row.factIds.join(', ') : '-';
    const gate = row.weight === 0 ? ' (gate: weighs nothing, see risk flags)' : '';
    lines.push(`  ${pad(row.status.toUpperCase(), 9)} ${pad(row.priority === 'must' ? 'must' : 'nice', 4)}  ${pad(row.label, labelWidth)}  facts: ${facts}${gate}`);
    lines.push(`  ${' '.repeat(9)} ${' '.repeat(4)}  ${row.note}`);
  }
  lines.push('');
  lines.push('Risk flags');
  if (analysis.flags.length === 0) lines.push('  none');
  for (const flag of analysis.flags) {
    const tag = flag.severity === 'hard' ? 'HARD WARNING' : flag.severity === 'warn' ? 'warning' : 'info';
    lines.push(`  [${tag}] ${flag.ruleId}: ${flag.title}`);
    lines.push(`      ${flag.detail}`);
    if (flag.excerpt !== undefined) lines.push(`      > ${flag.excerpt}`);
  }
  lines.push('');
  lines.push('Rate guidance');
  if (analysis.rate.suggestion !== undefined) {
    const s = analysis.rate.suggestion;
    lines.push(`  Suggested bid: ${money(s.amount)} ${s.currency} per ${s.unit}`);
  } else lines.push('  No bid suggested.');
  for (const line of analysis.rate.reasoning) lines.push(`  - ${line}`);
  lines.push('');
  lines.push('Extracted from the post');
  const spec = analysis.spec;
  const b = spec.budget;
  lines.push(`  Budget: ${b === undefined ? 'not found' : `${b.min === b.max ? money(b.min) : `${money(b.min)}-${money(b.max)}`} ${b.currency} (${b.type})`}`);
  lines.push(`  Duration: ${spec.duration === undefined ? 'not found' : `${spec.duration.minDays === spec.duration.maxDays ? spec.duration.minDays : `${spec.duration.minDays}-${spec.duration.maxDays}`} days`}`);
  lines.push(`  Location restriction: ${spec.locationRestriction === undefined ? 'none found' : `${spec.locationRestriction.mode} ${spec.locationRestriction.places.join(', ')}`}`);
  lines.push(`  Timezone requirement: ${spec.timezone === undefined ? 'none found' : `${spec.timezone.label} (UTC${spec.timezone.offset >= 0 ? '+' : ''}${spec.timezone.offset})`}`);
  lines.push(`  Requested attachments: ${spec.attachments.length === 0 ? 'none' : spec.attachments.map((a) => a.kind).join(', ')}`);
  lines.push(`  Client asks: ${spec.asks.length === 0 ? 'none' : ''}`);
  for (const ask of spec.asks) lines.push(`    - (${ask.kind}) ${ask.text}`);
  const m = analysis.metadata;
  const meta = Object.entries(m).map(([k, v]) => `${k}=${String(v)}`);
  lines.push(`  Listing metadata: ${meta.length === 0 ? 'none given' : meta.join(', ')}`);
  return lines.join('\n');
}

export function renderDraftFooter(draft: Draft): string {
  return [
    `Draft ${draft.id}: ${draft.wordCount} of ${draft.wordCap} words, tone ${draft.tone}, ${draft.citations.length} cited facts.`,
    'Nothing was sent. Review it, then:',
    `  proposal-desk check <file> --job <job>   verify any edited version`,
    `  proposal-desk approve ${draft.id}          record your approval (needs a terminal)`,
    `  proposal-desk export ${draft.id} --out final.md`,
  ].join('\n');
}

export function renderCheck(report: CheckReport): string {
  const errors = report.violations.filter((v) => v.severity === 'error');
  const warnings = report.violations.filter((v) => v.severity === 'warning');
  const lines = [
    `Check: ${report.ok ? 'PASSED' : 'FAILED'} (${errors.length} errors, ${warnings.length} warnings)   ${report.stats.words}/${report.stats.wordCap} words, ${report.stats.sentences} sentences, ${report.stats.questions} questions`,
  ];
  for (const v of report.violations) {
    lines.push(`  ${pad(v.severity, 7)} ${v.sentence === undefined ? '' : `sentence ${v.sentence}  `}${v.rule}`);
    lines.push(`          ${v.detail}`);
    if (v.excerpt !== '') lines.push(`          > ${v.excerpt}`);
  }
  lines.push('Trace (sentence -> facts matched by content)');
  for (const t of report.trace) lines.push(`  ${pad(String(t.index), 3)} ${t.factIds.length > 0 ? t.factIds.join(', ') : '-'}`);
  return lines.join('\n');
}

export function renderFacts(assessments: readonly FactAssessment[], location: string): string {
  const lines = [`Facts in ${location}: ${assessments.length}`];
  const idWidth = Math.max(2, ...assessments.map((a) => a.fact.id.length));
  for (const a of assessments) {
    const f = a.fact;
    lines.push(`  ${pad(f.id, idWidth)}  ${pad(f.status, 8)} ${pad(a.trust, 13)} ${pad(f.category, 12)} ${a.usable ? 'usable' : 'NOT USABLE'}  ${f.claim}`);
    lines.push(`  ${' '.repeat(idWidth)}  evidence: ${f.evidence.kind}: ${f.evidence.reference}${f.checkedAt === undefined ? '' : ` (checked ${f.checkedAt})`}`);
    for (const reason of a.exclusions) lines.push(`  ${' '.repeat(idWidth)}  excluded: ${reason}`);
  }
  return lines.join('\n');
}

export function renderVerify(results: readonly VerifyFactResult[]): string {
  const width = Math.max(2, ...results.map((r) => r.factId.length));
  return results.map((r) => `${pad(r.outcome.toUpperCase(), 8)} ${pad(r.factId, width)}  ${r.detail}`).join('\n');
}

export function renderStale(days: number, entries: readonly StaleEntry[], mark: boolean): string {
  if (entries.length === 0) return `No stale facts (limit ${days} days).`;
  const lines = [`Stale or overdue facts (limit ${days} days)${mark ? ', overdue ones marked stale' : ''}:`];
  for (const e of entries) lines.push(`  ${e.factId}: ${e.reason}${e.marked ? ' -> marked stale' : ''}`, `    ${e.claim}`);
  if (!mark && entries.some((e) => e.reason !== 'already stale')) lines.push('Run with --mark to make the overdue ones stale, or `facts verify` to re-check their evidence.');
  return lines.join('\n');
}

export function renderInsights(insights: Insights): string {
  const lines = [
    `Drafts: ${insights.drafts}   with an outcome: ${insights.withOutcome}   pending: ${insights.pending}`,
    `Overall reply rate: ${pct(insights.overall.rate)} (${insights.overall.replies} of ${insights.overall.n})${insights.overall.small ? '  [small sample]' : ''}`,
  ];
  for (const group of insights.groups) {
    lines.push('', group.name);
    for (const b of group.buckets) lines.push(`  ${pad(b.label, 38)} ${pad(pct(b.rate), 5)} (${b.replies} of ${b.n})${b.small && b.n > 0 ? '  [small sample]' : ''}`);
  }
  lines.push('', 'Read this first');
  for (const w of insights.warnings) lines.push(`  - ${w}`);
  lines.push('', 'Suggestions (nothing is changed automatically)');
  if (insights.suggestions.length === 0) lines.push('  none');
  for (const s of insights.suggestions) lines.push(`  - ${s}`);
  return lines.join('\n');
}

export function renderConfig(config: Config, digest: string, isDefault: boolean): string {
  return `# configuration version ${config.version} (${isDefault ? 'built-in defaults' : 'applied from config.json'}), digest ${digest}\n${JSON.stringify(config, null, 2)}`;
}

export function renderHistory(items: readonly HistoryItem[]): string {
  if (items.length === 0) return 'The log is empty.';
  return items.map((i) => `${pad(String(i.seq), 5)} ${i.ts}  ${pad(i.type, 17)} ${i.summary}`).join('\n');
}

export function renderChain(chain: ChainReport): string {
  return chain.ok
    ? `Hash chain: OK, ${chain.length} entries, head ${chain.head}`
    : `Hash chain: BROKEN at entry ${chain.brokenAt}: ${chain.reason}`;
}

export function renderLogVerification(v: LogVerification): string {
  const lines = [renderChain(v.chain), `Stored objects checked: ${v.objectsChecked}${v.problems.length === 0 ? ', all present and intact' : ''}`];
  for (const p of v.problems) lines.push(`  ${p}`);
  if (v.chain.ok) lines.push('Note: truncating the end of the log is only detectable if you remember an earlier head hash.');
  return lines.join('\n');
}
