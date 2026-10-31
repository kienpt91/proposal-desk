import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_SLOTS,
  TONES,
  configDigest,
  defaultConfig,
  diffConfig,
  parseConfig,
  setConfigValue,
  templateProblem,
  type Config,
} from '../../src/domain/config/config.js';

function issues(mutate: (config: Record<string, any>) => void): string[] {
  const clone = JSON.parse(JSON.stringify(defaultConfig())) as Record<string, any>;
  mutate(clone);
  const parsed = parseConfig(clone);
  return parsed.ok ? [] : parsed.error;
}

describe('configuration', () => {
  it('ships defaults that pass their own validation', () => {
    const parsed = parseConfig(JSON.parse(JSON.stringify(defaultConfig())));
    expect(parsed).toEqual({ ok: true, value: defaultConfig() });
    for (const tone of TONES) for (const slot of TEMPLATE_SLOTS) expect(templateProblem(slot, DEFAULT_TEMPLATES[tone][slot]), `${tone}.${slot}`).toBeUndefined();
  });

  it('rejects unknown fields, missing sections and out-of-range numbers', () => {
    expect(parseConfig([])).toEqual({ ok: false, error: ['config: must be an object'] });
    expect(issues((c) => (c.extra = 1))).toContain('config.extra: unknown field');
    expect(issues((c) => (c.scoring.surprise = 1))).toContain('config.scoring.surprise: unknown field');
    expect(issues((c) => delete c.risk)).toContain('config.risk: required');
    expect(issues((c) => (c.scoring.applyThreshold = 101)).join()).toContain('config.scoring.applyThreshold');
    expect(issues((c) => (c.drafting.wordCap = 20.5)).join()).toContain('config.drafting.wordCap: must be an integer');
    expect(issues((c) => delete c.facts.staleAfterDays)).toContain('config.facts.staleAfterDays: required');
    expect(issues((c) => (c.schema = 2))).toContain('config.schema: must be 1');
    expect(issues((c) => (c.version = 0))).toContain('config.version: must be a positive integer');
  });

  it('enforces relations between settings', () => {
    expect(issues((c) => (c.scoring.caveatThreshold = 80))).toContain('config.scoring.caveatThreshold: must be below applyThreshold');
    expect(issues((c) => (c.scoring.partialCredit = 1, c.scoring.coveredCredit = 0.5))).toContain('config.scoring.partialCredit: must not exceed coveredCredit');
    expect(issues((c) => (c.scoring.penaltyInfo = 30, c.scoring.penaltyWarn = 10)).join()).toContain('penalties must satisfy');
  });

  it('validates templates', () => {
    expect(templateProblem('opening', 'Hi, about {focus}.')).toBeUndefined();
    expect(templateProblem('opening', '')).toContain('1-160');
    expect(templateProblem('opening', 'Hi \u202e {focus}')).toContain('control characters');
    expect(templateProblem('opening', 'Hi {topic}')).toContain('unknown placeholder {topic}');
    expect(templateProblem('opening', 'Hi there.')).toContain('must use {focus}');
    expect(templateProblem('opening', 'Hi {focus} }')).toContain('unmatched brace');
    expect(templateProblem('closing', 'Thanks, 100% sure.')).toContain('numbers');
    expect(templateProblem('closing', 'Mail me at a@b.io')).toContain('contact');
    expect(templateProblem('closing', 'See https://example.com')).toContain('contact');
    expect(templateProblem('closing', 'I am the best.')).toContain('superlatives');
    expect(templateProblem('closing', 'Dear sir, thanks.')).toContain('boilerplate');
    expect(templateProblem('closing', 'Thanks?')).toContain('must not contain a question mark');
    expect(templateProblem('question', 'Which {label} first?')).toBeUndefined();
    expect(templateProblem('question', 'Which {label} first.')).toContain('exactly one question mark');
    expect(templateProblem('rate', 'Rate {amount} {currency}')).toContain('must use {unit}');
    expect(issues((c) => (c.drafting.templates.plain.closing = 5)).join()).toContain('must be text');
    expect(issues((c) => (c.drafting.templates.plain.closing = 'Ten times better')).join()).toContain('numbers');
  });

  it('digests are stable and change with any setting', () => {
    expect(configDigest(defaultConfig())).toBe(configDigest(defaultConfig()));
    const changed = setConfigValue(defaultConfig(), 'scoring.applyThreshold', '65');
    expect(changed.ok && configDigest(changed.value)).not.toBe(configDigest(defaultConfig()));
  });

  it('diffs leaf by leaf', () => {
    const base = defaultConfig();
    const first = setConfigValue(base, 'scoring.applyThreshold', '65');
    expect(first.ok).toBe(true);
    const next = setConfigValue((first as { value: Config }).value, 'drafting.templates.plain.closing', 'Thanks for your time.');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(diffConfig(base, { ...next.value, version: 2 })).toEqual([
      { path: 'drafting.templates.plain.closing', before: 'Thank you for reading.', after: 'Thanks for your time.' },
      { path: 'scoring.applyThreshold', before: 70, after: 65 },
      { path: 'version', before: 1, after: 2 },
    ]);
    expect(diffConfig(base, base)).toEqual([]);
  });

  it('sets values by path and refuses invalid edits', () => {
    const base = defaultConfig();
    expect(setConfigValue(base, 'scoring.applyThreshold', '80')).toMatchObject({ ok: true });
    expect(setConfigValue(base, 'scoring.applyThreshold', 'high')).toEqual({ ok: false, error: ['scoring.applyThreshold: expected a number'] });
    expect(setConfigValue(base, 'scoring.applyThreshold', '500')).toMatchObject({ ok: false });
    expect(setConfigValue(base, 'scoring.caveatThreshold', '90')).toMatchObject({ ok: false });
    expect(setConfigValue(base, 'scoring.nope', '1')).toEqual({ ok: false, error: ['scoring.nope: unknown or read-only setting'] });
    expect(setConfigValue(base, 'nope.deeper', '1')).toEqual({ ok: false, error: ['nope.deeper: unknown setting'] });
    expect(setConfigValue(base, 'version', '9')).toMatchObject({ ok: false });
    expect(setConfigValue(base, 'drafting.templates.plain.closing', 'Ten years of care')).toMatchObject({ ok: false });
    expect(setConfigValue(base, 'drafting.templates', 'x')).toMatchObject({ ok: false });
  });
});
