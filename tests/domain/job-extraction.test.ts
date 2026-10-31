import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJobPosting, type JobPosting } from '../../src/domain/job/posting.js';
import { extractRequirements } from '../../src/domain/job/requirements.js';
import { toSentences } from '../../src/domain/job/sentences.js';
import { extractSpec } from '../../src/domain/job/spec.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { hasUnsafeCharacters } from '../../src/domain/shared/text-safety.js';

const EXAMPLE = readFileSync(resolve(import.meta.dirname, '../../examples/job-post.txt'), 'utf8');

function job(text: string): JobPosting {
  const parsed = parseJobPosting(text);
  if (!parsed.ok) throw new Error(parsed.error.join('; '));
  return parsed.value;
}

const reqs = (text: string) => extractRequirements(toSentences(text)).map((r) => `${r.id}:${r.priority}${r.years === undefined ? '' : `:${r.years}y`}`);

describe('job posting', () => {
  it('reads the optional metadata block and keeps it out of the body', () => {
    const posting = job(EXAMPLE);
    expect(posting.metadata).toEqual({ proposals: 14, clientHires: 3, paymentVerified: true, accountAgeDays: 420, bidMin: 35, bidMax: 70, currency: 'USD' });
    expect(posting.metadataIssues).toEqual([]);
    expect(posting.body.startsWith('Senior TypeScript engineer')).toBe(true);
    expect(posting.title).toBe('Senior TypeScript engineer for an internal logistics dashboard');
    expect(posting.digest).toBe(sha256(EXAMPLE));
  });

  it('honours the metadata block only when it is the first thing in the input', () => {
    const posting = job('We need help.\n---proposal-desk\nproposals: 0\npayment-verified: yes\n---\nMore text');
    expect(posting.metadata).toEqual({});
    expect(posting.body).toContain('payment-verified: yes');
    const unclosed = job('---proposal-desk\nproposals: 3\nWe need a developer');
    expect(unclosed.metadata).toEqual({});
    expect(unclosed.metadataIssues[0]).toContain('not closed');
  });

  it('reports unusable metadata lines and ignores them', () => {
    const posting = job('---proposal-desk\nproposals: many\nclient-hires: -2\npayment-verified: maybe\ncurrency: usd\nmood: happy\nbid-min: 50\nbid-max: 20\n---\nBody text here');
    expect(posting.metadata).toEqual({});
    expect(posting.metadataIssues).toHaveLength(6);
    expect(posting.metadataIssues.join('\n')).toContain('unknown key');
    expect(posting.metadataIssues.join('\n')).toContain('bid-min is above bid-max');
  });

  it('normalises newlines, strips hidden characters and counts them', () => {
    const posting = job('Hello\r\nWor\u200bld \u202eevil\u202c\r\n');
    expect(posting.rawText).toBe('Hello\nWor\u200bld \u202eevil\u202c\n');
    expect(posting.body).toBe('Hello\nWorld evil');
    expect(posting.hiddenCharacters).toBe(3);
    expect(hasUnsafeCharacters(posting.body)).toBe(false);
    expect(posting.digest).toBe(sha256(posting.rawText));
  });

  it('rejects empty, oversized and content-free input', () => {
    expect(parseJobPosting('  \n ')).toEqual({ ok: false, error: ['the job text is empty'] });
    expect(parseJobPosting('x'.repeat(60001)).ok).toBe(false);
    expect(parseJobPosting('---proposal-desk\nproposals: 1\n---\n \u200b ').ok).toBe(false);
  });
});

describe('requirement extraction', () => {
  it('splits must-have and nice-to-have by section headings', () => {
    const list = reqs('Requirements:\n- TypeScript\n- Node.js\n\nNice to have:\n- Docker\n- GraphQL\n');
    expect(list).toEqual(['tech:typescript:must', 'tech:nodejs:must', 'tech:docker:nice', 'tech:graphql:nice']);
  });

  it('lets the nearest cue in the sentence override the section', () => {
    expect(reqs('TypeScript is required, Docker is a plus, and Python would be nice.')).toEqual(['tech:typescript:must', 'tech:docker:nice', 'tech:python:nice']);
    expect(reqs('Nice to have:\n- You must know SQL')).toEqual(['tech:sql:must']);
  });

  it('treats unmarked technologies as must-haves and ignores company boilerplate sections', () => {
    expect(reqs('We build a React app on AWS.')).toEqual(['tech:react:must', 'tech:aws:must']);
    expect(reqs('About us\nWe love Kubernetes and Rust developers\n\nThe role\nWrite Go services')).toEqual(['tech:go:must']);
  });

  it('skips negated technologies', () => {
    expect(reqs('No PHP required. We do not use Java. Python is needed.')).toEqual(['tech:python:must']);
  });

  it('attaches years of experience to the technology they describe', () => {
    expect(reqs('5+ years of Python and 3 years experience with React.')).toEqual(['tech:python:must:5y', 'tech:react:must:3y']);
    expect(reqs('TypeScript (4+ years) required')).toEqual(['tech:typescript:must:4y']);
    expect(reqs('At least five years of professional experience.')).toEqual(['exp:5:must:5y']);
    expect(reqs('He is 5 years old.')).toEqual([]);
  });

  it('keeps the highest priority and the largest years when a technology repeats', () => {
    expect(reqs('React is a plus.\n\nWe need React with 3 years experience.')).toEqual(['tech:react:must:3y']);
  });

  it('extracts language and availability requirements', () => {
    expect(reqs('Fluent English is required. Must be available 20 hours per week.')).toEqual(['lang:english:must', 'avail:must']);
    const avail = extractRequirements(toSentences('Full-time role.'));
    expect(avail[0]).toMatchObject({ kind: 'availability', hoursPerWeek: 40 });
    expect(extractRequirements(toSentences('Part-time, nice to have.'))[0]).toMatchObject({ hoursPerWeek: 20, priority: 'nice' });
    expect(reqs('Spanish speaking clients')).toEqual(['lang:spanish:must']);
  });
});

describe('job spec', () => {
  const spec = extractSpec(job(EXAMPLE));

  it('extracts the example post requirements with priorities', () => {
    expect(spec.requirements.filter((r) => r.kind === 'tech' || r.kind === 'language').map((r) => `${r.id}:${r.priority}`)).toEqual([
      'tech:typescript:must',
      'tech:nodejs:must',
      'tech:postgresql:must',
      'tech:rest:must',
      'tech:react:must',
      'tech:redis:must',
      'lang:english:must',
      'tech:docker:nice',
      'tech:cicd:nice',
      'tech:graphql:nice',
      'tech:kubernetes:nice',
    ]);
    expect(spec.requirements.find((r) => r.id === 'tech:typescript')?.years).toBe(4);
    expect(spec.requirements.find((r) => r.kind === 'availability')?.hoursPerWeek).toBe(15);
  });

  it('extracts budget, duration, attachments, asks and location', () => {
    expect(spec.budget).toMatchObject({ type: 'hourly', min: 40, max: 60, currency: 'USD' });
    expect(spec.duration).toMatchObject({ minDays: 60, maxDays: 90 });
    expect(spec.attachments.map((a) => a.kind)).toEqual(['portfolio', 'code-samples']);
    expect(spec.asks.map((a) => a.kind)).toEqual(['request', 'question']);
    expect(spec.asks.some((a) => a.kind === 'question' && a.text.includes('first two weeks'))).toBe(true);
    expect(spec.locationRestriction).toMatchObject({ mode: 'preferred', strong: false, places: ['north-america', 'europe'] });
    expect(spec.wordCount).toBeGreaterThan(80);
  });
});

describe('budget, duration and restrictions', () => {
  const of = (text: string) => extractSpec(job(text));

  it('parses money in several notations', () => {
    expect(of('Budget: $500 fixed price').budget).toMatchObject({ type: 'fixed', min: 500, max: 500, currency: 'USD' });
    expect(of('We pay 30-50 EUR/hr for this').budget).toMatchObject({ type: 'hourly', min: 30, max: 50, currency: 'EUR' });
    expect(of('Total budget is £2.5k').budget).toMatchObject({ type: 'fixed', min: 2500, currency: 'GBP' });
    expect(of('Paying $1,200 per month for the retainer').budget).toMatchObject({ type: 'unknown', min: 1200 });
    expect(of('Our team grew to 25 people in 2024').budget).toBeUndefined();
    expect(of('Rate: $25 an hour').budget).toMatchObject({ type: 'hourly', min: 25 });
  });

  it('parses durations', () => {
    expect(of('Estimated duration: six weeks').duration).toMatchObject({ minDays: 42, maxDays: 42 });
    expect(of('Needs to be completed within 10 days').duration).toMatchObject({ maxDays: 10 });
    expect(of('Must be done in 5 days.').duration).toMatchObject({ maxDays: 5 });
    expect(of('We have 3 weeks of coffee').duration).toBeUndefined();
  });

  it('finds restrictions that exclude or require places', () => {
    expect(of('Applicants must be located in the US.').locationRestriction).toMatchObject({ mode: 'only', strong: true, places: ['us'] });
    expect(of('US only, please.').locationRestriction).toMatchObject({ mode: 'only', strong: true });
    expect(of('We cannot accept applicants from India or Pakistan. No applicants from Nigeria.').locationRestriction).toMatchObject({ mode: 'excluding', places: ['in', 'pk'] });
    expect(of('Open to EU residents.').locationRestriction).toMatchObject({ mode: 'only', strong: true, places: ['eu'] });
    expect(of('Freelancers from Europe are preferred.').locationRestriction).toMatchObject({ mode: 'preferred', strong: false });
    expect(of('Join us in building the next thing.').locationRestriction).toBeUndefined();
    expect(of('Our offices are in Berlin, Germany.').locationRestriction).toBeUndefined();
  });

  it('finds timezone requirements', () => {
    expect(of('We need 4 hours overlap with EST.').timezone).toMatchObject({ offset: -5, label: 'EST' });
    expect(of('Working hours: UTC+1 to UTC+2, daily standup.').timezone).toMatchObject({ offset: 1 });
    expect(of('Must be available during US business hours for meetings.').timezone).toMatchObject({ offset: -6 });
    expect(of('Overlap with Pacific time is important.').timezone).toMatchObject({ offset: -8 });
    expect(of('We work eastern hours for standup.').timezone).toMatchObject({ offset: -5 });
    expect(of('Available during mountain time meetings.').timezone).toMatchObject({ offset: -7 });
    expect(of('Core hours in central time (US) for calls.').timezone).toMatchObject({ offset: -6 });
    expect(of('A pleasant remote team.').timezone).toBeUndefined();
  });

  it('adds location and timezone rows to the requirements without weighting them', () => {
    const spec = of('Applicants must be located in the US. We need overlap with PST for calls.');
    expect(spec.requirements.map((r) => r.kind)).toEqual(['location', 'timezone']);
  });

  it('collects attachments and asks', () => {
    const spec = of('Send a short video intro and your CV. Do you have test coverage habits? Please describe your testing approach.');
    expect(spec.attachments.map((a) => a.kind)).toEqual(['video', 'resume']);
    expect(spec.asks).toEqual([
      { kind: 'request', text: 'Send a short video intro and your CV.' },
      { kind: 'question', text: 'Do you have test coverage habits?' },
      { kind: 'request', text: 'Please describe your testing approach.' },
    ]);
  });
});
