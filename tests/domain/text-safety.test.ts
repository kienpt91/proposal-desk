import { describe, expect, it } from 'vitest';
import {
  countUnsafeCharacters,
  escapeUnsafe,
  escapeUnsafeForJson,
  hasUnsafeCharacters,
  isUnsafeCodePoint,
  normalizeNewlines,
  stripUnsafe,
} from '../../src/domain/shared/text-safety.js';
import { forSeeds } from '../support/random.js';

const HOSTILE = [
  '\u001b[31mred\u001b[0m',
  '\u001b]0;pwned\u0007title',
  '\u009b31m',
  '\u202eevil\u202c',
  '\u2066isolate\u2069',
  'zero\u200bwidth\u200djoin',
  '\ufeffbom',
  '\u0000nul',
  '\u007fdel',
  '\u2028line',
  '\u{e0041}tag',
  '𝄞 fine astral',
];

describe('text safety', () => {
  it('flags control, bidi and invisible code points but not ordinary text', () => {
    for (const sample of HOSTILE.slice(0, -1)) expect(hasUnsafeCharacters(sample), sample).toBe(true);
    expect(hasUnsafeCharacters('plain text\nwith\ttabs and ünïcode ✓ 𝄞')).toBe(false);
    expect(isUnsafeCodePoint(0x0a, false)).toBe(true);
    expect(isUnsafeCodePoint(0x09, false)).toBe(false);
  });

  it('escapes unsafe characters as visible \\u{...} sequences', () => {
    expect(escapeUnsafe('\u001b[31mred')).toBe('\\u{1b}[31mred');
    expect(escapeUnsafe('a\u202eb')).toBe('a\\u{202e}b');
    expect(escapeUnsafe('keeps\nnewlines')).toBe('keeps\nnewlines');
  });

  it('never leaves an unsafe character behind and is idempotent (property)', () => {
    const alphabet = [...HOSTILE.join(''), ...'abc xyz\n\t[]]{}\\'];
    forSeeds(200, (random) => {
      const text = Array.from({ length: random.int(60) }, () => random.pick(alphabet)).join('');
      const escaped = escapeUnsafe(text);
      expect(hasUnsafeCharacters(escaped)).toBe(false);
      expect(escapeUnsafe(escaped)).toBe(escaped);
      const stripped = stripUnsafe(text);
      expect(hasUnsafeCharacters(stripped)).toBe(false);
      expect(countUnsafeCharacters(text)).toBeGreaterThanOrEqual(0);
    });
  });

  it('produces JSON-valid escapes for serialized text', () => {
    const value = { text: 'a\u202eb\u{e0041}\u007f\u0085' };
    const serialized = escapeUnsafeForJson(JSON.stringify(value));
    expect(hasUnsafeCharacters(serialized)).toBe(false);
    const parsed = JSON.parse(serialized) as typeof value;
    expect(parsed).toEqual(value);
  });

  it('normalizes newlines', () => {
    expect(normalizeNewlines('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });
});
