import { describe, expect, it } from 'vitest';
import { analyzeJobText, checkProposalText, draftFromJob, parseJobOrThrow } from '../../src/application/usecases/analysis.js';
import { findDraft } from '../../src/application/drafts.js';
import { parseStoredDraft, serializeStoredDraft, toInsightRecord, toStoredDraft } from '../../src/application/records.js';
import { AppError } from '../../src/application/errors.js';
import { setConfigValue, type Config } from '../../src/domain/config/config.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { harness } from '../support/fakes.js';
import { EXAMPLE_JOB, exampleFacts } from '../support/analysis.js';

const setup = () => harness({ facts: exampleFacts() });

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('analyzeJobText', () => {
  it('analyses the post, stores the job text and logs a summary', async () => {
    const h = setup();
    const result = await analyzeJobText(h, { jobText: EXAMPLE_JOB, factsPath: undefined });
    expect(result.analysis.verdict.recommendation).toBe('apply-with-caveats');
    expect(result.factsLocation).toBe('/memory/facts.json');
    expect(h.objectsFake.objects.get(result.job.digest)).toBe(result.job.rawText);
    expect(h.logFake.entries).toHaveLength(1);
    expect(h.logFake.entries[0]).toMatchObject({
      type: 'job.analyzed',
      payload: { jobDigest: result.job.digest, fit: 80.9, recommendation: 'apply-with-caveats', flags: ['location-excluded'], covered: 9, partial: 1, uncovered: 2 },
    });
  });

  it('uses the stored configuration', async () => {
    const config = (setConfigValue((await import('../../src/domain/config/config.js')).defaultConfig(), 'scoring.applyThreshold', '95') as { value: Config }).value;
    const h = harness({ facts: exampleFacts(), config });
    const result = await analyzeJobText(h, { jobText: EXAMPLE_JOB, factsPath: undefined });
    expect(result.analysis.configVersion).toBe(1);
    expect(result.analysis.verdict.reasons[0]).toContain('below the apply threshold 95');
  });

  it('rejects empty text and a missing facts file with helpful messages', async () => {
    expect(await rejection(analyzeJobText(setup(), { jobText: '  ', factsPath: undefined }))).toMatchObject({ kind: 'invalid', details: ['the job text is empty'] });
    const missing = await rejection(analyzeJobText(harness(), { jobText: EXAMPLE_JOB, factsPath: undefined }));
    expect(missing).toMatchObject({ kind: 'missing' });
    expect(() => parseJobOrThrow('')).toThrow(AppError);
  });
});

describe('draftFromJob', () => {
  it('stores the draft record and job text and logs the draft', async () => {
    const h = setup();
    const result = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'plain' });
    expect(result.draft.id).toMatch(/^d-/);
    expect(result.audit).toContain('## Provenance');
    const [entry] = h.logFake.entries;
    expect(entry).toMatchObject({
      type: 'draft.generated',
      payload: { draftId: result.draft.id, jobDigest: sha256(EXAMPLE_JOB), textDigest: sha256(result.draft.text), tone: 'plain', configVersion: 1 },
    });
    const found = await findDraft(h, result.draft.id);
    expect(found.stored.draft).toEqual(result.draft);
    expect(found.jobText).toBe(EXAMPLE_JOB);
    expect((await findDraft(h, result.draft.id.slice(0, 6))).stored.draft.id).toBe(result.draft.id);
  });

  it('is repeatable: the same inputs give the same draft id', async () => {
    const h = setup();
    const a = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'concise' });
    const b = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'concise' });
    expect(a.draft.id).toBe(b.draft.id);
    expect(a.audit).toBe(b.audit);
  });

  it('refuses to bluff when nothing is covered', async () => {
    const error = await rejection(draftFromJob(setup(), { jobText: 'Requirements:\n- PHP\n- Laravel', factsPath: undefined, tone: 'plain' }));
    expect(error).toMatchObject({ kind: 'refused', message: 'no draft was produced' });
    expect(error.details[0]).toContain('nothing honest to say');
  });
});

describe('findDraft', () => {
  it('reports unknown, ambiguous and damaged drafts', async () => {
    const h = setup();
    expect(await rejection(findDraft(h, 'd-nothing'))).toMatchObject({ kind: 'missing' });
    const a = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'plain' });
    const b = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'concise' });
    const common = [...a.draft.id].findIndex((c, i) => c !== b.draft.id[i]);
    if (common >= 4) expect(await rejection(findDraft(h, a.draft.id.slice(0, common)))).toMatchObject({ kind: 'invalid' });
    expect(await rejection(findDraft(h, 'd'))).toMatchObject({ kind: 'missing' });
    h.objectsFake.objects.clear();
    expect(await rejection(findDraft(h, a.draft.id))).toMatchObject({ kind: 'io' });
  });

  it('notices a missing job text', async () => {
    const h = setup();
    const a = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'plain' });
    h.objectsFake.objects.delete(sha256(EXAMPLE_JOB));
    expect((await rejection(findDraft(h, a.draft.id))).message).toContain('job text');
  });
});

describe('stored draft records', () => {
  it('round-trips and summarises for insights', async () => {
    const h = setup();
    const { draft, analysis } = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'plain' });
    const stored = toStoredDraft(draft, analysis);
    expect(parseStoredDraft(serializeStoredDraft(stored))).toEqual(JSON.parse(JSON.stringify(stored)));
    expect(toInsightRecord(stored)).toEqual({
      draftId: draft.id, tone: 'plain', fit: 80.9, hasWarning: false,
      budget: { min: 40, max: 60, currency: 'USD', type: 'hourly' },
      bid: { amount: 53, currency: 'USD', unit: 'hour' },
    });
  });

  it('rejects damaged records', () => {
    for (const text of ['nope', '{}', JSON.stringify({ schema: 1, draft: { id: 'x' }, summary: {} }), JSON.stringify({ schema: 1, draft: { id: 'd-123', jobDigest: 'a', factsDigest: 'b', text: 't', tone: 'plain' }, summary: {} })]) {
      expect(() => parseStoredDraft(text), text).toThrow(AppError);
    }
    const good = JSON.parse(serializeStoredDraft(toStoredDraft({ id: 'd-0123456789ab', tone: 'plain', jobDigest: 'a', factsDigest: 'b', text: 't', sentences: [], citations: [], notes: [], wordCap: 200, wordCount: 1, configVersion: 1 }, { score: { value: 1 }, verdict: { recommendation: 'skip' }, flags: [], spec: {}, rate: {} } as never))) as object;
    expect(() => parseStoredDraft(JSON.stringify({ ...good, draft: { ...(good as { draft: object }).draft, id: 'd-XYZ' } }))).toThrow(/draft id/);
  });
});

describe('checkProposalText', () => {
  it('passes a draft and ties the check to it in the log', async () => {
    const h = setup();
    const { draft } = await draftFromJob(h, { jobText: EXAMPLE_JOB, factsPath: undefined, tone: 'plain' });
    const report = await checkProposalText(h, { markdown: draft.text, jobText: EXAMPLE_JOB, factsPath: undefined });
    expect(report.ok).toBe(true);
    expect(h.logFake.entries.at(-1)).toMatchObject({ type: 'proposal.checked', payload: { ok: true, errors: 0, draftId: draft.id, textDigest: sha256(draft.text) } });
  });

  it('reports violations for a hand-written proposal and logs them', async () => {
    const h = setup();
    const report = await checkProposalText(h, { markdown: 'Dear Hiring Manager, I have 12 years of Kubernetes experience. Email me at a@b.io', jobText: EXAMPLE_JOB, factsPath: undefined });
    expect(report.ok).toBe(false);
    const payload = h.logFake.entries.at(-1)?.payload;
    expect(payload).toMatchObject({ ok: false });
    expect(payload?.rules).toEqual(expect.arrayContaining(['boilerplate', 'contact-details', 'untraceable-number']));
    expect(payload).not.toHaveProperty('draftId');
  });

  it('needs facts like every other command', async () => {
    expect(await rejection(checkProposalText(harness(), { markdown: 'x', jobText: EXAMPLE_JOB, factsPath: undefined }))).toMatchObject({ kind: 'missing' });
    expect(FactBase.empty().facts).toHaveLength(0);
  });
});
