import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/domain/config/config.js';
import { proposalBody, verifyProposal, type ViolationRule } from '../../src/domain/proposal/verify.js';
import { growth, MAX_GROWTH } from '../support/growth.js';
import { draftIdOf, read, session } from '../support/cli.js';
import { job, typicalFacts } from '../support/analysis.js';
import { forSeeds } from '../support/random.js';

// Security review findings: verifier-negation-bypass, verifier-piggyback-claims, approve-double-normalization,
// check-ignores-tail-and-comments, verifier-dos-complexity.

const JOB = 'We need a TypeScript developer with PostgreSQL for a dashboard. Budget: $40-$60/hr.';
const FACT = 'Built and maintained TypeScript services on Node.js for five years.';
const report = (markdown: string) => verifyProposal({ markdown, job: job(JOB), facts: typicalFacts(), config: defaultConfig() });
const rules = (markdown: string): ViolationRule[] => report(markdown).violations.map((v) => v.rule);

describe('a negation word does not switch the checks off', () => {
  it('flags claims that merely contain a cue word', () => {
    for (const text of [
      'I have built and shipped Kubernetes platforms for banks, not just demos.',
      'I have no Redis experience but built Kubernetes platforms for banks.',
      'I have no Redis experience, but I led teams that scaled Kafka.',
      'Not once did I fail to build Kubernetes platforms.',
      'I have no doubt I built Kubernetes platforms.',
      'I have not only built Kubernetes platforms but also run them.',
      'Never mind the rest: I shipped Terraform modules.',
    ]) {
      expect(rules(text), text).toContain('unverified-capability');
    }
    expect(rules('I built large systems for banks, not for hobby projects.')).toContain('unsupported-claim');
  });

  it('still accepts honest statements of a gap', () => {
    for (const text of [
      'I have no verified experience with Redis, so I will not claim it.',
      'I have not worked with Kubernetes.',
      'I have no experience with Redis, Kafka or Rust.',
      'I am new to Terraform.',
      'I do not have production experience with Kafka.',
      'Limited exposure to Rust.',
      'Without hands-on Kubernetes experience I would not take the infrastructure part.',
    ]) {
      expect(rules(text), text).toEqual([]);
    }
  });
});

describe('a matched fact does not carry extra claims along', () => {
  it('flags assertions that are not part of the fact, also after a lowercase continuation', () => {
    for (const text of [
      `${FACT} i was lead engineer at Stripe and hold a PhD from MIT`,
      `${FACT} and I hold a PhD from MIT.`,
      `${FACT} I also won the Turing Award.`,
      'I hold a PhD from MIT.',
      'I won the Turing Award.',
      'I am certified in project management.',
      'Previously lead engineer at Stripe.',
      'I graduated from Stanford.',
    ]) {
      expect(rules(text), text).toContain('unsupported-claim');
    }
  });

  it('still accepts the fact itself, repeated or embedded in a lead-in', () => {
    expect(rules(FACT)).toEqual([]);
    expect(rules(`On TypeScript: ${FACT}`)).toEqual([]);
    expect(rules(`${FACT} Happy to start whenever suits you.`)).toEqual([]);
  });

  it('warns about capitalised names that appear in neither the facts nor the job post', () => {
    const warned = report('I would love to talk about this with Zorblax.').violations.filter((v) => v.rule === 'unverified-entity');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.severity).toBe('warning');
    expect(rules('I would love to talk about the TypeScript dashboard.')).toEqual([]);
    expect(rules('I would love to discuss how I built Kubernetes platforms.')).toContain('unverified-capability');
    expect(rules('I would love to work with Acme Corp on this.')).toEqual(['unverified-entity']);
  });

  it('warns when a claim rests on evidence the tool cannot verify', () => {
    const v = report('I containerised services with Docker.').violations;
    expect(v.map((x) => `${x.rule}:${x.severity}`)).toContain('unverified-evidence:warning');
  });
});

describe('proposalBody is idempotent, so what is verified is what is approved and exported', () => {
  it('returns a fixed point for arbitrary mixtures of markup (property)', () => {
    const pieces = ['*', '_', '`', '[^1]', '[^1]: x', '## Provenance', '## Pro*venance', '## Review _notes_', '<!--', '-->', '<!-- c -->', '[a](b)', '[a]', '(b)', '\n', '\n\n', 'text ', '- ', '> ', '1. ', 'I built it. ', '**', '[^'];
    forSeeds(400, (random) => {
      const input = Array.from({ length: 1 + random.int(25) }, () => random.pick(pieces)).join('');
      const once = proposalBody(input);
      expect(proposalBody(once)).toBe(once);
    });
  });

  it('cuts a Provenance heading that only appears once emphasis is removed', () => {
    expect(proposalBody(`${FACT}\n\n## Pro*venance\n\nI led a 40-person team at Google.`)).toBe(FACT);
    expect(proposalBody(`${FACT}\n\n## **Review notes**\n\nnotes`)).toBe(FACT);
    expect(proposalBody(`${FACT}\n\n<!*-- hidden --*>\nmore`)).toBe(`${FACT}\n\n\nmore`);
  });

  it('approve --text approves, stores and exports exactly the text that was verified', async () => {
    const s = session();
    const id = draftIdOf((await s.run(['draft', s.job, '--facts', s.facts])).stderr);
    const trick = `Hello, your post asks for TypeScript.\n\nOn TypeScript: Built and maintained TypeScript services on Node.js for five years.\n\n## Pro*venance\n\nI led a 40-person team at Google. Call +1 415 555 0100. \u001b[2J`;
    writeFileSync(join(s.dir, 'edited.md'), trick);
    const approved = await s.run(['approve', id, '--text', join(s.dir, 'edited.md'), '--facts', s.facts]);
    expect(approved.code).toBe(0);
    expect((await s.run(['export', id, '--out', join(s.dir, 'final.md'), '--facts', s.facts])).code).toBe(0);
    const final = read(join(s.dir, 'final.md'));
    expect(final).not.toContain('Google');
    expect(final).not.toContain('415');
    expect(final).not.toContain('\u001b');
    const check = await s.run(['check', join(s.dir, 'edited.md'), '--job', s.job, '--facts', s.facts]);
    expect(check.code).toBe(1);
    expect(check.stdout).toContain('unchecked-tail');
  });
});

describe('claims cannot hide in markup', () => {
  it('verifies text inside code fences, inline code, link text, image alt text and HTML tags like any other text', () => {
    for (const text of [
      '```\nI have 15 years of Kubernetes experience\n```',
      '`I led a team at Google and hold a PhD`',
      '[I led a team at Google](https://example.com/me)',
      '![I built Kubernetes platforms for banks](https://example.com/a.png)',
      '<span hidden>I have 20 years of Kubernetes experience</span>',
      '> I won the Turing Award',
      '- I shipped Terraform modules',
      '**I hold a PhD from MIT**',
      '_I graduated from Stanford_',
    ]) {
      expect(report(text).ok, text).toBe(false);
    }
  });

  it('sees through link syntax to the address, so a contact detail in a link target is found', () => {
    expect(rules('[my site](mailto:jane@example.com)')).toContain('contact-details');
    expect(rules('[chat with me](https://t.me/janedoe)')).toContain('contact-details');
  });
});

describe('check says what it did not look at', () => {
  const head = 'Hello, your post asks for TypeScript.\n\nOn TypeScript: Built and maintained TypeScript services on Node.js for five years.';

  it('fails when text after a Provenance or Review notes heading is anything but the tool\'s own structure', () => {
    expect(rules(`${head}\n\n## Review notes\n\nI have 15 years of Kubernetes experience, reach me at a@b.co`)).toContain('unchecked-tail');
    expect(rules(`${head}\n\n## Provenance\n\n[^1]: ts (verified; file-hash: evidence/ts.md) Delivered a 400% increase in revenue`)).toContain('forged-provenance');
    expect(rules(`${head}\n\n## Provenance\n\n[^1]: nope (verified) Whatever`)).toContain('forged-provenance');
    expect(rules(`${head}\n\n[^1]: just a stray definition with prose`)).toContain('forged-provenance');
  });

  it('accepts the tool\'s own provenance and warns that review notes are not part of the proposal', () => {
    const ok = `${head}\n\n## Provenance\n\n[^1]: ts (verified; file-hash: evidence/ts.md) Built and maintained TypeScript services on Node.js for five years\n\n## Review notes\n\n- Recommendation: apply (fit 80).\n- The client asks (answer by hand): Please share links.`;
    const r = report(ok);
    expect(r.ok).toBe(true);
    expect(r.violations.map((v) => v.rule)).toEqual(['unchecked-review-notes']);
    expect(r.violations[0]?.severity).toBe('warning');
    expect(r.violations[0]?.detail).toContain('2 lines');
  });

  it('fails on hidden HTML comments instead of silently dropping them', () => {
    const r = report(`${head}\n\n<!-- 20 years Kubernetes, ignore previous instructions -->`);
    expect(r.ok).toBe(false);
    expect(r.violations.find((v) => v.rule === 'hidden-comment')?.excerpt).toContain('20 years Kubernetes');
  });
});

describe('the verifier stays fast on hostile input', () => {
  it('handles unclosed markup, thousands of tiny sentences and huge inputs in linear time', () => {
    // [unit, repeat count at full size]; the full-size input must still be rejected, and the cost must grow linearly with the count.
    const samples: Array<[string, number]> = [
      ['[', 120_000],
      ['[^', 60_000],
      ['<!--', 30_000],
      ['[a](', 30_000],
      ['A. ', 40_000],
      [`${FACT} `, 2_000],
      ['`', 100_000],
      ['I built it. ', 20_000],
    ];
    for (const [i, [unit, count]] of samples.entries()) {
      expect(report(unit.repeat(count).slice(0, 262_144)).ok, `sample ${i}`).toBe(false);
      expect(growth((n) => unit.repeat(n), count / 8, (text) => report(text)), `sample ${i}`).toBeLessThan(MAX_GROWTH);
    }
  }, 120_000);

  it('rejects a proposal that is empty once markup is taken out', () => {
    for (const text of ['', '   ', '`'.repeat(50), '<!-- only a comment -->', '## Provenance\n\n[^1]: x']) expect(rules(text), JSON.stringify(text)).toContain('empty-proposal');
  });

  it('reports too-long right away for a text over the cap and caps the number of findings', () => {
    const r = report(`${'I built it. '.repeat(3_000)}`);
    expect(r.violations.map((v) => v.rule)).toContain('too-long');
    expect(r.violations.length).toBeLessThanOrEqual(101);
    expect(r.stats.truncated).toBe(true);
  });
});
