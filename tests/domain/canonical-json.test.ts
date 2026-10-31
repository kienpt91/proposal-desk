import { describe, expect, it } from 'vitest';
import { canonicalJson, digestOf, type Json } from '../../src/domain/shared/canonical-json.js';
import { forSeeds, type Random } from '../support/random.js';

function randomJson(random: Random, depth = 0): Json {
  const kind = random.int(depth > 2 ? 4 : 6);
  switch (kind) {
    case 0:
      return random.int(1000) - 500;
    case 1:
      return random.pick(['', 'a', 'line\nbreak', 'quote"', 'ünï', '\u202e']);
    case 2:
      return random.next() > 0.5;
    case 3:
      return null;
    case 4:
      return Array.from({ length: random.int(4) }, () => randomJson(random, depth + 1));
    default: {
      const out: Record<string, Json> = {};
      for (let i = 0; i < random.int(5); i++) out[`k${random.int(20)}`] = randomJson(random, depth + 1);
      return out;
    }
  }
}

function shuffleKeys(value: Json, random: Random): Json {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v as Json, random));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, Json>;
    const keys = Object.keys(record);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = random.int(i + 1);
      [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
    }
    const out: Record<string, Json> = {};
    for (const key of keys) out[key] = shuffleKeys(record[key] as Json, random);
    return out;
  }
  return value;
}

describe('canonicalJson', () => {
  it('sorts keys and omits undefined properties', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null }, z: undefined })).toBe('{"a":{"c":null,"d":[1,2]},"b":1}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(RangeError);
    expect(() => canonicalJson({ x: Infinity })).toThrow(RangeError);
  });

  it('is independent of key insertion order and round-trips through JSON.parse', () => {
    forSeeds(100, (random) => {
      const value = randomJson(random);
      const shuffled = shuffleKeys(value, random);
      expect(canonicalJson(shuffled)).toBe(canonicalJson(value));
      expect(canonicalJson(JSON.parse(canonicalJson(value)) as Json)).toBe(canonicalJson(value));
    });
  });

  it('digests differ when any value differs', () => {
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf(true)).toHaveLength(64);
    expect(canonicalJson(false)).toBe('false');
  });
});
