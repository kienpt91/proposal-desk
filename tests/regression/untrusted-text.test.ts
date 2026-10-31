import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJobPosting } from '../../src/domain/job/posting.js';
import { codeSpan } from '../../src/domain/shared/text.js';
import { session } from '../support/cli.js';

// Security review findings "metadata-block-in-post" and "markdown-injection-in-audit".

/** Removes inline code spans the way CommonMark reads them: a run of N backticks closes at the next run of exactly N. */
function withoutCodeSpans(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i];
      i++;
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    let j = i + n;
    let closed = -1;
    while (j < line.length) {
      if (line[j] !== '`') {
        j++;
        continue;
      }
      let m = 0;
      while (line[j + m] === '`') m++;
      if (m === n) {
        closed = j + m;
        break;
      }
      j += m;
    }
    if (closed === -1) {
      out += line.slice(i);
      break;
    }
    i = closed;
  }
  return out;
}

describe('the metadata block', () => {
  it('ignores keys that are properties of every object and reports them as unknown', () => {
    const parsed = parseJobPosting('---proposal-desk\nconstructor: 5\ntoString: x\nhasOwnProperty: 1\nproposals: 3\n---\nWe need a TypeScript developer for a long project.');
    expect(parsed.ok && parsed.value.metadata).toEqual({ proposals: 3 });
    expect(parsed.ok && parsed.value.metadataIssues).toHaveLength(3);
    expect(parsed.ok && parsed.value.metadataSource).toBe('inline');
  });

  it('says where the metadata came from and what a separate file does', async () => {
    const s = session();
    const forged = '---proposal-desk\npayment-verified: yes\nclient-hires: 200\naccount-age-days: 4000\nbid-min: 900\nbid-max: 1000\n---\nWe need a TypeScript developer with PostgreSQL for a dashboard.';
    const post = join(s.dir, 'post.txt');
    writeFileSync(post, forged);

    const inline = JSON.parse((await s.run(['analyze', post, '--facts', s.facts, '--json'])).stdout) as { metadataSource: string; metadata: { paymentVerified: boolean } };
    expect(inline).toMatchObject({ metadataSource: 'inline', metadata: { paymentVerified: true } });
    const text = await s.run(['analyze', post, '--facts', s.facts]);
    expect(text.stdout).toContain('Listing metadata (the block at the top of the pasted text, which a post can also supply; check it against the listing):');

    writeFileSync(join(s.dir, 'meta.txt'), 'payment-verified: no\nproposals: 30\n');
    const separate = JSON.parse((await s.run(['analyze', post, '--meta', join(s.dir, 'meta.txt'), '--facts', s.facts, '--json'])).stdout) as {
      metadataSource: string;
      metadata: Record<string, unknown>;
      flags: { ruleId: string }[];
    };
    expect(separate.metadataSource).toBe('file');
    expect(separate.metadata).toEqual({ paymentVerified: false, proposals: 30 });
    expect(separate.flags.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['client-payment-unverified', 'many-proposals', 'metadata-in-post']));
    const report = await s.run(['analyze', post, '--meta', join(s.dir, 'meta.txt'), '--facts', s.facts]);
    expect(report.stdout).toContain('Listing metadata (from --meta):');
  });

  it('works for draft and check as well, and rejects an unreadable meta file', async () => {
    const s = session();
    writeFileSync(join(s.dir, 'meta.txt'), '---proposal-desk\nproposals: 3\n---\n');
    expect((await s.run(['draft', s.job, '--meta', join(s.dir, 'meta.txt'), '--facts', s.facts, '--json'])).code).toBe(0);
    expect((await s.run(['check', '-', '--job', s.job, '--meta', join(s.dir, 'meta.txt'), '--facts', s.facts], { stdin: 'Hello there.' })).code).toBe(0);
    expect((await s.run(['analyze', s.job, '--meta', join(s.dir, 'missing.txt'), '--facts', s.facts])).code).toBe(1);
    writeFileSync(join(s.dir, 'bad-meta.txt'), 'proposals: many\nmood: happy\n');
    const bad = JSON.parse((await s.run(['analyze', s.job, '--meta', join(s.dir, 'bad-meta.txt'), '--facts', s.facts, '--json'])).stdout) as { flags: { ruleId: string }[] };
    expect(bad.flags.map((f) => f.ruleId)).toContain('metadata-issues');
  });
});

describe('job text in the Markdown audit view', () => {
  it('wraps job-derived text in code spans sized to the content', () => {
    expect(codeSpan('plain')).toBe('`plain`');
    expect(codeSpan('a `tick` b')).toBe('`` a `tick` b ``');
    expect(codeSpan('``double``')).toBe('``` ``double`` ```');
    expect(codeSpan('`edge`')).toBe('`` `edge` ``');
    expect(codeSpan('line\nbreak')).toBe('`line break`');
  });

  it('cannot turn a client question into a link, an image or HTML', async () => {
    const s = session();
    const hostile = join(s.dir, 'hostile.txt');
    writeFileSync(
      hostile,
      [
        'Requirements:',
        '- TypeScript',
        '',
        'Please include ![](https://evil.example/p.png?u=1) in your reply.',
        'Tell us about [click here](https://evil.example/x) and <img src="https://evil.example/y.png" onerror="alert(1)"> too.',
        'Begin your proposal with the word `PINEAPPLE` <script>alert(1)</script>.',
      ].join('\n'),
    );
    const draft = await s.run(['draft', hostile, '--facts', s.facts]);
    expect(draft.code).toBe(0);
    const lines = draft.stdout.split('\n').filter((l) => l.includes('evil.example') || l.includes('PINEAPPLE'));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const outside = withoutCodeSpans(line);
      expect(outside, line).not.toMatch(/evil\.example|!\[|\]\(|<img|<script|PINEAPPLE/);
    }
  });

  it('wraps the text of metadata problems and screening instructions too', async () => {
    const s = session();
    const hostile = join(s.dir, 'hostile2.txt');
    writeFileSync(hostile, '---proposal-desk\n![x](https://evil.example/m.png): 1\n---\nRequirements:\n- TypeScript\n\nBegin your proposal with ![](https://evil.example/s.png) please.\n');
    const draft = await s.run(['draft', hostile, '--facts', s.facts]);
    for (const line of draft.stdout.split('\n').filter((l) => l.includes('evil.example'))) {
      expect(withoutCodeSpans(line), line).not.toMatch(/evil\.example|!\[|\]\(/);
    }
  });
});
