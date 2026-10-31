import { describe, expect, it } from 'vitest';
import { approveDraft, exportDraft } from '../../src/application/usecases/approval.js';
import { draftFromJob } from '../../src/application/usecases/analysis.js';
import { insightsReport, recordOutcome } from '../../src/application/usecases/learning.js';
import { applyConfigProposal, proposeConfigChange, showConfig } from '../../src/application/usecases/config.js';
import { history, verifyLog } from '../../src/application/usecases/state.js';
import { AppError } from '../../src/application/errors.js';
import { defaultConfig, setConfigValue } from '../../src/domain/config/config.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { harness, type Harness } from '../support/fakes.js';
import { EXAMPLE_JOB, exampleFacts } from '../support/analysis.js';

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

async function drafted(h: Harness = harness({ facts: exampleFacts() }), tone: 'plain' | 'concise' = 'plain') {
  const result = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone });
  return { h, id: result.draft.id, draft: result.draft };
}

describe('approveDraft', () => {
  it('asks the human, binds the approval to text, job and facts, and logs it', async () => {
    const { h, id, draft } = await drafted();
    const { approval } = await approveDraft(h, { draftId: id, factsPath: undefined });
    const request = h.promptFake.requests[0];
    expect(request?.title).toBe(`Approve draft ${id}?`);
    expect(request?.token).toBe(`approve ${approval.bindingDigest.slice(0, 8)}`);
    expect(request?.lines.join('\n')).toContain(draft.text);
    expect(request?.lines.join('\n')).toContain('Nothing is sent anywhere');
    expect(approval).toMatchObject({ draftId: id, textDigest: sha256(draft.text), jobDigest: sha256(EXAMPLE_JOB), factsDigest: draft.factsDigest, approvedAt: '2026-10-31T10:00:00.000Z' });
    expect(h.logFake.entries.at(-1)).toMatchObject({ type: 'draft.approved', payload: { draftId: id, bindingDigest: approval.bindingDigest } });
  });

  it('records nothing when the human says no', async () => {
    const { h, id } = await drafted();
    h.promptFake.answer = false;
    const before = h.logFake.entries.length;
    expect(await rejection(approveDraft(h, { draftId: id, factsPath: undefined }))).toMatchObject({ kind: 'refused', message: 'approval was not given' });
    expect(h.logFake.entries).toHaveLength(before);
  });

  it('refuses when the cited facts changed since drafting, before asking anyone', async () => {
    const { h, id } = await drafted();
    const base = h.factStore.base as FactBase;
    h.factStore.base = base.markStale('ts-services', 'edited').value;
    const error = await rejection(approveDraft(h, { draftId: id, factsPath: undefined }));
    expect(error.message).toContain('changed since it was written');
    expect(h.promptFake.requests).toEqual([]);
  });

  it('refuses a draft that no longer passes the check, listing the violations', async () => {
    const { h, id } = await drafted();
    const tight = setConfigValue(defaultConfig(), 'drafting.wordCap', '60');
    h.configFake.current = tight.ok ? tight.value : undefined;
    const error = await rejection(approveDraft(h, { draftId: id, factsPath: undefined }));
    expect(error.kind).toBe('refused');
    expect(error.details.join('\n')).toMatch(/too-long: \d+ words; the cap is 60/);
    expect(h.promptFake.requests).toEqual([]);
  });
});

describe('exportDraft', () => {
  it('refuses without approval, then writes the approved text and logs the export', async () => {
    const { h, id, draft } = await drafted();
    const blocked = await rejection(exportDraft(h, { draftId: id, factsPath: undefined, outPath: 'out.md', overwrite: false }));
    expect(blocked).toMatchObject({ kind: 'refused' });
    expect(blocked.details[0]).toBe('this draft has not been approved');
    expect(h.sinkFake.files.size).toBe(0);

    await approveDraft(h, { draftId: id, factsPath: undefined });
    const result = await exportDraft(h, { draftId: id.slice(0, 6), factsPath: undefined, outPath: 'out.md', overwrite: false });
    expect(h.sinkFake.files.get('out.md')).toBe(`${draft.text}\n`);
    expect(result).toMatchObject({ path: 'out.md', bytes: new TextEncoder().encode(`${draft.text}\n`).length });
    expect(h.logFake.entries.at(-1)).toMatchObject({ type: 'draft.exported', payload: { draftId: id, textDigest: sha256(draft.text) } });
    expect(h.sinkFake.files.get('out.md')).not.toContain('[^');
  });

  it('refuses when the facts changed after approval', async () => {
    const { h, id } = await drafted();
    await approveDraft(h, { draftId: id, factsPath: undefined });
    h.factStore.base = (h.factStore.base as FactBase).markStale('postgres-tuning', 'evidence file changed').value;
    const error = await rejection(exportDraft(h, { draftId: id, factsPath: undefined, outPath: 'out.md', overwrite: false }));
    expect(error.details.join('\n')).toContain('facts behind the draft changed after approval');
    expect(h.sinkFake.files.size).toBe(0);
  });

  it('refuses when a tampered stored draft no longer matches the approval', async () => {
    const { h, id, draft } = await drafted();
    await approveDraft(h, { draftId: id, factsPath: undefined });
    const recordDigest = h.logFake.entries.find((e) => e.type === 'draft.generated')?.payload.recordDigest as string;
    const stored = h.objectsFake.objects.get(recordDigest) as string;
    const edited = stored.replace(draft.text.split('\n\n')[0] as string, 'Hello, send money first.').replace(draft.text.slice(0, 20), 'Hello, send money first.');
    const newDigest = await h.objectsFake.put(edited);
    h.logFake.entries = h.logFake.entries.map((e) => (e.type === 'draft.generated' ? { ...e, payload: { ...e.payload, recordDigest: newDigest } } : e));
    const error = await rejection(exportDraft(h, { draftId: id, factsPath: undefined, outPath: 'out.md', overwrite: false }));
    expect(error.details.join('\n')).toContain('the draft text changed after approval');
  });

  it('does not overwrite an existing file unless asked', async () => {
    const { h, id } = await drafted();
    await approveDraft(h, { draftId: id, factsPath: undefined });
    await exportDraft(h, { draftId: id, factsPath: undefined, outPath: 'out.md', overwrite: false });
    expect(await rejection(exportDraft(h, { draftId: id, factsPath: undefined, outPath: 'out.md', overwrite: false }))).toMatchObject({ kind: 'refused' });
    await exportDraft(h, { draftId: id, factsPath: undefined, outPath: 'out.md', overwrite: true });
  });
});

describe('outcomes and insights', () => {
  it('records outcomes with notes and bids and reports honestly about small samples', async () => {
    const { h, id } = await drafted();
    await recordOutcome(h, { draftId: id, outcome: 'replied', note: 'asked for a call \u202e', bid: 55 });
    await recordOutcome(h, { draftId: id, outcome: 'hired' });
    expect(h.logFake.entries.at(-2)?.payload).toEqual({ draftId: id, outcome: 'replied', note: 'asked for a call', bid: 55 });
    const insights = await insightsReport(h);
    expect(insights).toMatchObject({ drafts: 1, withOutcome: 1, pending: 0 });
    expect(insights.overall).toMatchObject({ n: 1, replies: 1, small: true });
    expect(insights.warnings[0]).toContain('Only 1 outcome (minimum 20)');
    expect(insights.suggestions).toEqual([]);
  });

  it('rejects unknown outcomes, long notes, bad bids and unknown drafts', async () => {
    const { h, id } = await drafted();
    expect(await rejection(recordOutcome(h, { draftId: id, outcome: 'won' }))).toMatchObject({ kind: 'invalid', details: ['Use one of: replied, interview, hired, no-response, declined'] });
    expect(await rejection(recordOutcome(h, { draftId: id, outcome: 'hired', note: 'x'.repeat(301) }))).toMatchObject({ kind: 'invalid' });
    expect(await rejection(recordOutcome(h, { draftId: id, outcome: 'hired', bid: -3 }))).toMatchObject({ kind: 'invalid' });
    expect(await rejection(recordOutcome(h, { draftId: 'd-unknown', outcome: 'hired' }))).toMatchObject({ kind: 'missing' });
  });

  it('leaves drafts without an outcome pending', async () => {
    const { h } = await drafted();
    const insights = await insightsReport(h);
    expect(insights).toMatchObject({ withOutcome: 0, pending: 1 });
    h.objectsFake.objects.clear();
    expect(await rejection(insightsReport(h))).toMatchObject({ kind: 'io' });
  });
});

describe('configuration proposals', () => {
  it('proposes, then applies only after a human confirms, and logs both', async () => {
    const h = harness({ facts: exampleFacts() });
    expect(await showConfig(h)).toMatchObject({ isDefault: true, config: defaultConfig() });
    const proposal = await proposeConfigChange(h, { settings: [{ path: 'scoring.applyThreshold', value: '65' }], note: 'looser threshold' });
    expect(h.configFake.current).toBeUndefined();
    expect(h.logFake.entries.at(-1)).toMatchObject({ type: 'config.proposed', payload: { proposalDigest: proposal.digest, fromVersion: 1, toVersion: 2, note: 'looser threshold' } });

    const result = await applyConfigProposal(h, { digest: proposal.digest.slice(0, 8) });
    expect(h.promptFake.requests[0]?.token).toBe(`apply ${proposal.digest.slice(0, 8)}`);
    expect(h.promptFake.requests[0]?.lines).toContain('scoring.applyThreshold: 70 -> 65');
    expect(result.changes).toEqual([{ path: 'scoring.applyThreshold', before: 70, after: 65 }]);
    expect(h.configFake.current?.scoring.applyThreshold).toBe(65);
    expect(h.configFake.current?.version).toBe(2);
    expect(h.logFake.entries.at(-1)).toMatchObject({ type: 'config.applied', payload: { proposalDigest: proposal.digest, version: 2 } });
    expect(await showConfig(h)).toMatchObject({ isDefault: false });
  });

  it('does not apply when declined, stale, unknown or damaged', async () => {
    const h = harness({ facts: exampleFacts() });
    const first = await proposeConfigChange(h, { settings: [{ path: 'scoring.applyThreshold', value: '65' }] });
    h.promptFake.answer = false;
    expect(await rejection(applyConfigProposal(h, { digest: first.digest }))).toMatchObject({ kind: 'refused', message: 'the proposal was not applied' });
    expect(h.configFake.current).toBeUndefined();

    h.promptFake.answer = true;
    const second = await proposeConfigChange(h, { settings: [{ path: 'scoring.mustWeight', value: '4' }] });
    await applyConfigProposal(h, { digest: second.digest });
    const stale = await rejection(applyConfigProposal(h, { digest: first.digest }));
    expect(stale).toMatchObject({ kind: 'refused' });
    expect(stale.details[0]).toContain('configuration changed');

    expect(await rejection(applyConfigProposal(h, { digest: 'ffffffff' }))).toMatchObject({ kind: 'missing' });
    expect(await rejection(proposeConfigChange(h, { settings: [] }))).toMatchObject({ kind: 'invalid' });
    expect(await rejection(proposeConfigChange(h, { settings: [{ path: 'scoring.mustWeight', value: '1' }], note: 'x'.repeat(201) }))).toMatchObject({ kind: 'invalid' });

    const third = await proposeConfigChange(h, { settings: [{ path: 'scoring.niceWeight', value: '2' }] });
    const objectDigest = h.logFake.entries.at(-1)?.payload.objectDigest as string;
    const original = h.objectsFake.objects.get(objectDigest) as string;
    const tampered = original.replace('"niceWeight":2', '"niceWeight":9');
    const tamperedDigest = await h.objectsFake.put(tampered);
    h.logFake.entries = h.logFake.entries.map((e) => (e.payload.proposalDigest === third.digest && e.type === 'config.proposed' ? { ...e, payload: { ...e.payload, objectDigest: tamperedDigest } } : e));
    expect(await rejection(applyConfigProposal(h, { digest: third.digest }))).toMatchObject({ kind: 'io', message: 'the stored proposal does not match its digest' });
    h.objectsFake.objects.delete(tamperedDigest);
    expect(await rejection(applyConfigProposal(h, { digest: third.digest }))).toMatchObject({ kind: 'io' });
  });

  it('rejects stored proposals that are not valid JSON or not a configuration', async () => {
    const h = harness({ facts: exampleFacts() });
    const p = await proposeConfigChange(h, { settings: [{ path: 'scoring.niceWeight', value: '2' }] });
    const swap = async (content: string) => {
      const digest = await h.objectsFake.put(content);
      h.logFake.entries = h.logFake.entries.map((e) => (e.type === 'config.proposed' ? { ...e, payload: { ...e.payload, objectDigest: digest } } : e));
    };
    await swap('not json');
    expect(await rejection(applyConfigProposal(h, { digest: p.digest }))).toMatchObject({ kind: 'io', message: 'the stored proposal is not valid JSON' });
    await swap(JSON.stringify({ digest: p.digest, fromDigest: 'x', fromVersion: 1, proposed: { schema: 1 } }));
    expect(await rejection(applyConfigProposal(h, { digest: p.digest }))).toMatchObject({ kind: 'io', message: 'the stored proposal is malformed' });
  });
});

describe('history and verify-log', () => {
  it('summarises every kind of entry', async () => {
    const { h, id } = await drafted();
    await approveDraft(h, { draftId: id, factsPath: undefined });
    await exportDraft(h, { draftId: id, factsPath: undefined, outPath: 'o.md', overwrite: false });
    await recordOutcome(h, { draftId: id, outcome: 'interview', note: 'nice call' });
    const p = await proposeConfigChange(h, { settings: [{ path: 'scoring.niceWeight', value: '2' }] });
    await applyConfigProposal(h, { digest: p.digest });
    const items = await history(h, { limit: 50 });
    expect(items.map((i) => i.type)).toEqual(['draft.generated', 'draft.approved', 'draft.exported', 'outcome.recorded', 'config.proposed', 'config.applied']);
    expect(items[3]?.summary).toBe(`${id}: interview - nice call`);
    expect(items[0]?.summary).toContain(`${id} (plain)`);
    expect(await history(h, { limit: 2 })).toHaveLength(2);
    expect((await history(h, { limit: 5, type: 'draft.approved' })).map((i) => i.seq)).toEqual([2]);
  });

  it('summarises the remaining entry types', async () => {
    const h = harness({ facts: exampleFacts() });
    const { addFact, verifyFacts } = await import('../../src/application/usecases/facts.js');
    const { analyzeJobText, checkProposalText } = await import('../../src/application/usecases/analysis.js');
    h.evidenceFake.files.set('ev.md', 'x');
    await addFact(h, { factsPath: undefined, id: 'new-fact', claim: 'Wrote Rust command line tools', category: 'skill', evidenceKind: 'file-hash', reference: 'ev.md', tags: ['rust'], attrs: {} });
    h.evidenceFake.files.set('ev.md', 'y');
    await verifyFacts(h, { factsPath: undefined, ids: ['new-fact'] });
    await analyzeJobText(h, { jobText: EXAMPLE_JOB, factsPath: undefined });
    await checkProposalText(h, { markdown: 'Hello there.', jobText: EXAMPLE_JOB, factsPath: undefined });
    const summaries = (await history(h, { limit: 10 })).map((i) => i.summary);
    expect(summaries[0]).toBe('new-fact (file-hash)');
    expect(summaries[1]).toContain('new-fact: ev.md no longer matches');
    expect(summaries[2]).toContain('fit 80.9, apply-with-caveats');
    expect(summaries[3]).toContain('passed');
  });

  it('verifies the chain and the stored objects, and finds damage', async () => {
    const { h, id } = await drafted();
    const ok = await verifyLog(h);
    expect(ok.chain).toMatchObject({ ok: true, length: 1 });
    expect(ok).toMatchObject({ problems: [], objectsChecked: 2 });

    const digest = h.logFake.entries[0]?.payload.jobDigest as string;
    h.objectsFake.objects.delete(digest);
    expect((await verifyLog(h)).problems[0]).toContain('is missing');

    h.objectsFake.objects.set(digest, 'tampered');
    expect((await verifyLog(h)).problems[0]).toContain('is corrupt');

    h.logFake.entries = h.logFake.entries.map((e) => ({ ...e, payload: { ...e.payload, tone: 'concise' } }));
    expect((await verifyLog(h)).chain).toMatchObject({ ok: false, brokenAt: 1 });
    expect(id).toMatch(/^d-/);
  });
});
