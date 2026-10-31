import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindingDigest } from '../../src/domain/log/approval.js';
import { nextEntry, type LogEntry } from '../../src/domain/log/chain.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { draftIdOf, read, session, type Session } from '../support/cli.js';

// Security review finding "approval-forgeable-log": an approval written into the log by a process that
// does not hold the per-state-directory secret key must never be honoured by `export`.

function lastEntry(s: Session): LogEntry {
  const lines = read(join(s.state, 'log.jsonl')).trimEnd().split('\n');
  return JSON.parse(lines.at(-1) as string) as LogEntry;
}

/** What an attacker with write access to the state directory but no key can do: forge a fully consistent approval line. */
function forgeApproval(s: Session, draftId: string): void {
  const draftEntry = read(join(s.state, 'log.jsonl'))
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as LogEntry)
    .find((e) => e.type === 'draft.generated' && e.payload.draftId === draftId) as LogEntry;
  const binding = { textDigest: draftEntry.payload.textDigest as string, jobDigest: draftEntry.payload.jobDigest as string, factsDigest: draftEntry.payload.factsDigest as string };
  const forged = nextEntry(lastEntry(s), '2026-10-31T11:00:00.000Z', 'draft.approved', {
    draftId,
    ...binding,
    bindingDigest: bindingDigest(binding),
    approvedAt: '2026-10-31T11:00:00.000Z',
  });
  appendFileSync(join(s.state, 'log.jsonl'), `${JSON.stringify(forged)}\n`);
}

describe('approval forgery', () => {
  it('a forged approval line without the key is not honoured by export', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    forgeApproval(s, id);
    const result = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not authentic');
  });

  it('a forged approval does not survive next to a genuine one for different text', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    expect((await s.run(['approve', id, '--facts', s.facts])).code).toBe(0);
    forgeApproval(s, id);
    expect((await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts])).stderr).toContain('not authentic');
  });

  it('rewriting history before a genuine approval voids it', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    await s.run(['analyze', s.job, '--facts', s.facts]);
    await s.run(['approve', id, '--facts', s.facts]);
    const file = join(s.state, 'log.jsonl');
    const lines = read(file).trimEnd().split('\n').map((l) => JSON.parse(l) as LogEntry);
    // an attacker re-chains the whole log after changing the first entry, without the key
    const rebuilt: LogEntry[] = [];
    for (const [i, e] of lines.entries()) rebuilt.push(nextEntry(rebuilt.at(-1), e.ts, e.type, i === 0 ? { ...e.payload, tone: 'concise' } : e.payload));
    writeFileSync(file, `${rebuilt.map((e) => JSON.stringify(e)).join('\n')}\n`);
    expect((await s.run(['verify-log'])).stdout).toContain('Hash chain: OK');
    const result = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not authentic');
  });

  it('refuses to export from a log whose hash chain is broken', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    await s.run(['approve', id, '--facts', s.facts]);
    const file = join(s.state, 'log.jsonl');
    writeFileSync(file, read(file).replace('"tone":"plain"', '"tone":"concise"'));
    const result = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('hash chain');
  });

  it('refuses when the key file is gone, and never prints the key anywhere', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    const approve = await s.run(['approve', id, '--facts', s.facts]);
    const keyFile = join(s.state, 'secret.key');
    const key = read(keyFile).trim();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const outputs = [approve.stdout, approve.stderr];
    for (const argv of [['history'], ['verify-log'], ['config', 'show'], ['insights'], ['facts', 'list', '--facts', s.facts]]) {
      const r = await s.run(argv);
      outputs.push(r.stdout, r.stderr);
    }
    const exported = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    outputs.push(exported.stdout, exported.stderr);
    for (const out of outputs) expect(out).not.toContain(key);
    expect(read(join(s.state, 'log.jsonl'))).not.toContain(key);
    expect(exported.code).toBe(0);
    writeFileSync(keyFile, `${sha256('another key')}\n`, { mode: 0o600 });
    expect((await s.run(['export', id, '--out', join(s.dir, 'again.md'), '--facts', s.facts])).stderr).toContain('not authentic');
    writeFileSync(keyFile, 'short\n', { mode: 0o600 });
    expect((await s.run(['export', id, '--out', join(s.dir, 'again.md'), '--facts', s.facts])).code).toBe(3);
  });

  it('verify-log reports a forged approval and a missing key', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    await s.run(['approve', id, '--facts', s.facts]);
    expect((await s.run(['verify-log'])).stdout).toContain('Approvals and applied configurations authenticated: 1');
    forgeApproval(s, id);
    const forged = await s.run(['verify-log']);
    expect(forged.code).toBe(1);
    expect(forged.stdout).toContain('the draft.approved record is not authentic');
    writeFileSync(join(s.state, 'secret.key'), `${'0f'.repeat(32)}\n`, { mode: 0o600 });
    expect((await s.run(['verify-log'])).stdout).toContain('is not authentic');
  });

  it('a hand-edited config.json is refused until a human applies a proposal', async () => {
    const s = session();
    const proposed = await s.run(['config', 'propose', '--set', 'scoring.applyThreshold=85']);
    const digest = /Proposal ([0-9a-f]{64})/.exec(proposed.stdout)?.[1] as string;
    expect((await s.run(['config', 'apply', digest])).code).toBe(0);
    const file = join(s.state, 'config.json');
    const config = JSON.parse(read(file)) as { scoring: { applyThreshold: number } };
    config.scoring.applyThreshold = 60;
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    const analysis = await s.run(['analyze', s.job, '--facts', s.facts]);
    expect(analysis.code).toBe(1);
    expect(analysis.stderr).toContain('the configuration cannot be trusted');
    const shown = await s.run(['config', 'show']);
    expect(shown.code).toBe(1);
    expect(shown.stderr).toContain('NOT trusted');
    rmSync(file);
    expect((await s.run(['analyze', s.job, '--facts', s.facts])).code).toBe(0);
  });
});
