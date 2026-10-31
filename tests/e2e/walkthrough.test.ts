import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { draftIdOf, read, session } from '../support/cli.js';

describe('walkthrough with the shipped example', () => {
  it('goes from facts to an exported proposal and an outcome', async () => {
    const s = session();

    const listed = await s.run(['facts', 'list', '--facts', s.facts]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('ts-services');
    expect(listed.stdout).toContain('verified');
    expect(listed.stdout).toContain('usable');

    const verified = await s.run(['facts', 'verify', '--facts', s.facts]);
    expect(verified.code).toBe(0);
    expect(verified.stdout).toContain('VERIFIED ts-services');
    expect(verified.stdout).toContain('SKIPPED  english');

    const analysis = await s.run(['analyze', s.job, '--facts', s.facts]);
    expect(analysis.code).toBe(0);
    expect(analysis.stdout).toContain('Recommendation: APPLY WITH CAVEATS   (fit 80.9 / 100)');
    expect(analysis.stdout).toContain('coverage = 100 x sum(weight x credit) / sum(weight) = 100 x 23.5 / 28 = 83.9');
    expect(analysis.stdout).toContain('COVERED   must  TypeScript');
    expect(analysis.stdout).toContain('UNCOVERED must  Redis');
    expect(analysis.stdout).toContain('Suggested bid: 53 USD per hour');

    const draft = await s.run(['draft', s.job, '--facts', s.facts]);
    expect(draft.code).toBe(0);
    const id = draftIdOf(draft.stderr);
    expect(draft.stdout).toContain('On TypeScript: Built and maintained TypeScript services on Node.js for five years.[^1]');
    expect(draft.stdout).toContain('## Provenance');
    writeFileSync(join(s.dir, 'draft.md'), draft.stdout);

    const check = await s.run(['check', join(s.dir, 'draft.md'), '--job', s.job, '--facts', s.facts]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('Check: PASSED (0 errors, 0 warnings)');

    const blocked = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain('this draft has not been approved');
    expect(existsSync(join(s.dir, 'final.md'))).toBe(false);

    const approved = await s.run(['approve', id, '--facts', s.facts]);
    expect(approved.code).toBe(0);
    expect(approved.stdout).toContain(`Approved ${id}.`);

    const exported = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(exported.code).toBe(0);
    const final = read(join(s.dir, 'final.md'));
    expect(final).toBe(`${draft.stdout.split('\n\n## Provenance')[0]}\n`.replace(/\[\^\d+\]/g, ''));
    expect(final).not.toContain('[^');

    const again = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('already exists');
    expect((await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts, '--force'])).code).toBe(0);

    const outcome = await s.run(['outcome', 'record', id.slice(0, 6), 'replied', '--note', 'asked for a call', '--bid', '53']);
    expect(outcome.stdout).toContain(`Recorded replied for ${id}.`);

    const insights = await s.run(['insights']);
    expect(insights.code).toBe(0);
    expect(insights.stdout).toContain('Overall reply rate: 100% (1 of 1)  [small sample]');
    expect(insights.stdout).toContain('Only 1 outcome (minimum 20)');

    const past = await s.run(['history']);
    expect(past.stdout).toMatch(/draft\.generated\s+d-/);
    expect(past.stdout).toContain('outcome.recorded');

    const log = await s.run(['verify-log']);
    expect(log.code).toBe(0);
    expect(log.stdout).toMatch(/Hash chain: OK, \d+ entries, head [0-9a-f]{64}/);
    expect(log.stdout).toContain('all present and intact');
  });

  it('keeps all state private and bounded', async () => {
    const s = session();
    await s.run(['analyze', s.job, '--facts', s.facts]);
    await s.run(['draft', s.job, '--facts', s.facts]);
    expect(statSync(s.state).mode & 0o777).toBe(0o700);
    expect(statSync(join(s.state, 'log.jsonl')).mode & 0o777).toBe(0o600);
    for (const name of readdirSync(join(s.state, 'objects'))) expect(statSync(join(s.state, 'objects', name)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(s.state, 'log.lock'))).toBe(false);
  });

  it('detects a tampered log and tampered stored objects', async () => {
    const s = session();
    await s.run(['draft', s.job, '--facts', s.facts]);
    const logFile = join(s.state, 'log.jsonl');
    const original = readFileSync(logFile, 'utf8');
    writeFileSync(logFile, original.replace('"tone":"plain"', '"tone":"concise"'));
    chmodSync(logFile, 0o600);
    const broken = await s.run(['verify-log']);
    expect(broken.code).toBe(1);
    expect(broken.stdout).toContain('Hash chain: BROKEN at entry 1');
    writeFileSync(logFile, original);
    const jobObject = join(s.state, 'objects', sha256(read(s.job)));
    writeFileSync(jobObject, 'something else');
    const corrupt = await s.run(['verify-log']);
    expect(corrupt.code).toBe(1);
    expect(corrupt.stdout).toContain('is corrupt');
  });

  it('checks a hand-written proposal and fails with exit status 1', async () => {
    const s = session();
    const bad = 'Dear Hiring Manager, I am the best TypeScript expert with 15 years of Kubernetes experience. Mail me at jane@example.com?';
    const result = await s.run(['check', '-', '--job', s.job, '--facts', s.facts], { stdin: bad });
    expect(result.code).toBe(1);
    for (const rule of ['boilerplate', 'superlative-without-evidence', 'untraceable-number', 'unverified-capability', 'contact-details']) expect(result.stdout).toContain(rule);
    const json = await s.run(['check', '-', '--job', s.job, '--facts', s.facts, '--json'], { stdin: bad });
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false });
  });

  it('reads the job from standard input and emits JSON', async () => {
    const s = session();
    const result = await s.run(['analyze', '-', '--facts', s.facts, '--json'], { stdin: read(s.job) });
    const analysis = JSON.parse(result.stdout) as { score: { value: number }; verdict: { recommendation: string } };
    expect(analysis.score.value).toBe(80.9);
    expect(analysis.verdict.recommendation).toBe('apply-with-caveats');
    const draft = await s.run(['draft', '-', '--facts', s.facts, '--json', '--tone', 'concise'], { stdin: read(s.job) });
    const parsed = JSON.parse(draft.stdout) as { draft: { id: string; sentences: { factIds: string[] }[] } };
    expect(parsed.draft.id).toMatch(/^d-/);
    expect(parsed.draft.sentences.some((x) => x.factIds.length > 0)).toBe(true);
  });

  it('produces byte-identical drafts for identical inputs, across separate state directories', async () => {
    const first = session();
    const second = session();
    const a = await first.run(['draft', first.job, '--facts', first.facts]);
    const b = await second.run(['draft', second.job, '--facts', second.facts]);
    const c = await first.run(['draft', first.job, '--facts', first.facts]);
    expect(a.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout).toBe(c.stdout);
    expect(a.stderr).toBe(b.stderr);
  });

  it('refuses to approve without a person at a terminal', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    const result = await s.run(['approve', id, '--facts', s.facts], { prompt: 'terminal' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('needs a person at an interactive terminal');
    const blocked = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(blocked.code).toBe(1);
  });

  it('lets you edit the draft by hand, check it, approve exactly that text and export it', async () => {
    const s = session();
    const draft = await s.run(['draft', s.job, '--facts', s.facts]);
    const id = draftIdOf(draft.stderr);
    const edited = draft.stdout.replace('Thank you for reading.', 'Happy to start whenever suits you.');
    writeFileSync(join(s.dir, 'edited.md'), edited);
    expect((await s.run(['check', join(s.dir, 'edited.md'), '--job', s.job, '--facts', s.facts])).code).toBe(0);
    const approved = await s.run(['approve', id, '--text', join(s.dir, 'edited.md'), '--facts', s.facts]);
    expect(approved.code).toBe(0);
    expect(approved.stdout).toContain(`Approved your edited text of ${id}.`);
    expect(s.prompt.requests.at(-1)?.lines.join('\n')).toContain('Happy to start whenever suits you.');
    expect((await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts])).code).toBe(0);
    expect(read(join(s.dir, 'final.md'))).toContain('Happy to start whenever suits you.\n');
    expect(read(join(s.dir, 'final.md'))).not.toContain('Thank you for reading.');
    expect((await s.run(['verify-log'])).stdout).toContain('all present and intact');

    writeFileSync(join(s.dir, 'worse.md'), edited.replace('Happy to start whenever suits you.', 'I am the best.'));
    const refused = await s.run(['approve', id, '--text', join(s.dir, 'worse.md'), '--facts', s.facts]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('the edited text of draft');
    expect((await s.run(['approve', id, '--text', join(s.dir, 'nope.md'), '--facts', s.facts])).code).toBe(1);
  });

  it('does not export a draft whose approval was declined', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    s.prompt.answer = false;
    expect((await s.run(['approve', id, '--facts', s.facts])).code).toBe(1);
    expect((await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts])).code).toBe(1);
  });

  it('voids an approval when a cited fact changes afterwards', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    await s.run(['approve', id, '--facts', s.facts]);
    writeFileSync(join(s.dir, 'examples', 'evidence', 'ts-services.md'), 'the evidence file changed');
    const verify = await s.run(['facts', 'verify', '--facts', s.facts]);
    expect(verify.code).toBe(1);
    expect(verify.stdout).toContain('STALE    ts-services');
    const result = await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('facts behind the draft changed after approval');
    expect(existsSync(join(s.dir, 'final.md'))).toBe(false);
  });
});

describe('facts and configuration commands', () => {
  it('adds facts with evidence, hashes the file and stores private files', async () => {
    const s = session();
    const facts = join(s.dir, 'mine.json');
    writeFileSync(join(s.dir, 'proof.txt'), 'evidence');
    const added = await s.run(['facts', 'add', '--facts', facts, '--id', 'rust-cli', '--claim', 'Wrote Rust command line tools', '--category', 'skill', '--evidence', 'file-hash', '--ref', 'absent.txt', '--tag', 'rust', '--attr', 'years=3']);
    expect(added.stderr).toContain('cannot verify the evidence file');
    expect(added.code).toBe(1);
    const ok = await s.run(['facts', 'add', '--facts', facts, '--id', 'rust-cli', '--claim', 'Wrote Rust command line tools', '--category', 'skill', '--evidence', 'file-hash', '--ref', join(s.dir, 'proof.txt'), '--tag', 'rust', '--attr', 'years=3']);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('verified, verified, usable in proposals');
    expect(JSON.parse(read(facts))).toMatchObject({ facts: [{ id: 'rust-cli', status: 'verified', attrs: { years: 3 }, evidence: { digest: sha256('evidence') } }] });
    expect(statSync(facts).mode & 0o777).toBe(0o600);
  });

  it('stores self-declared facts as declared and warns when numbers make them unusable', async () => {
    const s = session();
    const facts = join(s.dir, 'mine.json');
    const result = await s.run(['facts', 'add', '--facts', facts, '--id', 'boast', '--claim', 'Served ten million users', '--category', 'metric', '--evidence', 'self-declared']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('declared, self-declared, NOT usable in proposals');
    expect(result.stdout).toContain('numbers and outcomes need evidence beyond a self-declaration');
    const listed = await s.run(['facts', 'list', '--facts', facts, '--json']);
    expect(JSON.parse(listed.stdout)).toMatchObject([{ id: 'boast', usable: false, trust: 'self-declared' }]);
  });

  it('rejects invalid facts, duplicates and unreadable facts files', async () => {
    const s = session();
    const facts = join(s.dir, 'mine.json');
    const add = (extra: string[]) => s.run(['facts', 'add', '--facts', facts, '--id', 'x-fact', '--claim', 'Worked with Docker daily', '--category', 'skill', ...extra]);
    expect((await add(['--evidence', 'self-declared'])).code).toBe(0);
    const duplicate = await add(['--evidence', 'self-declared']);
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('duplicate id x-fact');
    expect((await s.run(['facts', 'add', '--facts', facts, '--id', 'BAD', '--claim', 'short', '--category', 'skill', '--evidence', 'self-declared'])).stderr).toContain('fact.id');
    writeFileSync(facts, '{ not json');
    const broken = await s.run(['facts', 'list', '--facts', facts]);
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain('is not valid JSON');
    const missing = await s.run(['facts', 'list', '--facts', join(s.dir, 'nothing.json')]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('no facts file at');
  });

  it('lists stale facts and marks overdue ones', async () => {
    const s = session();
    const none = await s.run(['facts', 'stale', '--facts', s.facts]);
    expect(none.stdout).toContain('Stale or overdue facts');
    expect(none.stdout).toContain('react-dashboard');
    const marked = await s.run(['facts', 'stale', '--facts', s.facts, '--days', '1', '--mark']);
    expect(marked.stdout).toContain('-> marked stale');
    const statuses = Object.fromEntries((JSON.parse(read(s.facts)) as { facts: { id: string; status: string }[] }).facts.map((f) => [f.id, f.status]));
    expect(statuses).toMatchObject({ 'react-dashboard': 'stale', english: 'stale', 'ts-services': 'verified' });
  });

  it('proposes and applies configuration changes only with confirmation', async () => {
    const s = session();
    const shown = await s.run(['config', 'show']);
    expect(shown.stdout).toContain('configuration version 1 (built-in defaults)');
    const proposed = await s.run(['config', 'propose', '--set', 'scoring.applyThreshold=85', '--note', 'stricter']);
    expect(proposed.code).toBe(0);
    expect(proposed.stdout).toContain('scoring.applyThreshold: 70 -> 85');
    expect(proposed.stdout).toContain('Nothing changed');
    const digest = /Proposal ([0-9a-f]{64})/.exec(proposed.stdout)?.[1] as string;
    expect(existsSync(join(s.state, 'config.json'))).toBe(false);

    s.prompt.answer = false;
    expect((await s.run(['config', 'apply', digest.slice(0, 12)])).code).toBe(1);
    expect(existsSync(join(s.state, 'config.json'))).toBe(false);
    s.prompt.answer = true;
    expect((await s.run(['config', 'apply', digest.slice(0, 12)])).stdout).toContain('Applied configuration version 2.');
    expect(JSON.parse(read(join(s.state, 'config.json'))).scoring.applyThreshold).toBe(85);
    expect((await s.run(['config', 'show', '--json'])).stdout).toContain('"isDefault": false');
    const analysis = await s.run(['analyze', s.job, '--facts', s.facts]);
    expect(analysis.stdout).toContain('configuration version 2');
    expect((await s.run(['config', 'propose', '--set', 'scoring.applyThreshold=500'])).code).toBe(1);
    expect((await s.run(['config', 'propose', '--set', 'noequals'])).code).toBe(2);
    expect((await s.run(['config', 'propose'])).code).toBe(1);
  });

  it('filters and bounds the history', async () => {
    const s = session();
    await s.run(['analyze', s.job, '--facts', s.facts]);
    await s.run(['draft', s.job, '--facts', s.facts]);
    const only = await s.run(['history', '--type', 'job.analyzed', '--json']);
    expect(JSON.parse(only.stdout)).toHaveLength(1);
    expect((await s.run(['history', '--limit', '1', '--json'])).stdout).toContain('draft.generated');
    expect((await s.run(['history', '--limit', '0'])).code).toBe(2);
    expect((await s.run(['history', '--type', 'nonsense'])).code).toBe(2);
    expect((await session().run(['history'])).stdout).toContain('The log is empty.');
  });
});

describe('command line handling', () => {
  it('prints help and version', async () => {
    const s = session();
    const top = await s.run(['--help']);
    expect(top.code).toBe(0);
    expect(top.stdout).toContain('facts add');
    expect(top.stdout).toContain('It never fetches, logs in, or submits anything');
    expect((await s.run([])).code).toBe(2);
    expect((await s.run(['help', 'analyze'])).stdout).toContain('proposal-desk analyze <job> [options]');
    expect((await s.run(['draft', '--help'])).stdout).toContain('--tone <plain|concise>');
    expect((await s.run(['--version'])).stdout).toBe('proposal-desk 0.1.0\n');
  });

  it('rejects wrong usage with status 2 and a pointer to help', async () => {
    const s = session();
    for (const argv of [['nope'], ['analyze'], ['analyze', 'a', 'b'], ['analyze', 'x', '--bogus'], ['draft', 'x', '--tone', 'loud'], ['check', 'x'], ['facts', 'add', '--id', 'x'], ['outcome', 'record', 'only-one'], ['history', '--json=1'], ['draft', 'x', '--tone']]) {
      const result = await s.run(argv);
      expect(result.code, argv.join(' ')).toBe(2);
      expect(result.stderr).toContain('proposal-desk:');
    }
    expect((await s.run(['check', '-', '--job', '-'], { stdin: 'x' })).code).toBe(2);
    expect((await s.run(['facts', 'add', '--id', 'x', '--claim', 'some claim here', '--category', 'skill', '--evidence', 'file-hash'])).stderr).toContain('--ref is required');
  });

  it('reports missing files as failures, not crashes', async () => {
    const s = session();
    const result = await s.run(['analyze', join(s.dir, 'missing.txt'), '--facts', s.facts]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no such file');
    expect((await s.run(['export', 'd-zzzzzzzzzzzz', '--out', 'x.md'])).stderr).toContain('no draft');
  });
});
