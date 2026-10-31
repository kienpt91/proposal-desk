import { describe, expect, it } from 'vitest';
import {
  TECH_ENTRIES,
  canonicalTechId,
  findTechs,
  techById,
  techIdsIn,
} from '../../src/domain/dictionary/tech.js';
import {
  findPlaces,
  isCountry,
  parseUtcOffset,
  placeIncludes,
  resolvePlace,
  zoneOffset,
  ZONE_ABBREVIATIONS,
} from '../../src/domain/dictionary/geo.js';

describe('technology dictionary', () => {
  it('has unique ids and no synonym claimed by two entries', () => {
    const ids = TECH_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const owner = new Map<string, string>();
    for (const entry of TECH_ENTRIES) {
      for (const synonym of entry.synonyms) {
        expect(synonym, synonym).toBe(synonym.toLowerCase());
        const previous = owner.get(synonym);
        expect(previous === undefined || previous === entry.id, `${synonym} in ${previous} and ${entry.id}`).toBe(true);
        owner.set(synonym, entry.id);
      }
    }
  });

  it('only references known technologies in implies/related and never itself', () => {
    for (const entry of TECH_ENTRIES) {
      for (const other of [...entry.implies, ...entry.related]) {
        expect(techById(other), `${entry.id} -> ${other}`).toBeDefined();
        expect(other).not.toBe(entry.id);
      }
    }
  });

  it('finds technologies regardless of spelling', () => {
    expect(techIdsIn('We use K8s, Node.js and PostgreSQL; TypeScript preferred.')).toEqual([
      'kubernetes',
      'nodejs',
      'postgresql',
      'typescript',
    ]);
    expect(techIdsIn('C++ or C# experience, plus Vue 3')).toEqual(['cpp', 'csharp', 'vue']);
  });

  it('respects word boundaries and prefers the longest match', () => {
    expect(techIdsIn('JavaScript only')).toEqual(['javascript']);
    expect(techIdsIn('react native app')).toEqual(['reactnative']);
    expect(techIdsIn('java.util imports')).toEqual([]);
    expect(techIdsIn('We want Go developers; lets go to market. Go ahead.')).toEqual(['go']);
    expect(techIdsIn('please go ahead')).toEqual([]);
    expect(techIdsIn('Strong knowledge of Go and PostgreSQL')).toEqual(['go', 'postgresql']);
    expect(techIdsIn('Backend Engineer (Go / Kubernetes)')).toEqual(['go', 'kubernetes']);
    expect(techIdsIn('Time to Go to market; let us Go for lunch')).toEqual([]);
    expect(techIdsIn('Rust developer wanted; rust on cars')).toEqual(['rust']);
    expect(findTechs('Express.js and node.js.')[1]).toMatchObject({ id: 'nodejs', text: 'node.js' });
  });

  it('maps tags to canonical ids', () => {
    expect(canonicalTechId('Node.js')).toBe('nodejs');
    expect(canonicalTechId('  K8S ')).toBe('kubernetes');
    expect(canonicalTechId('typescript')).toBe('typescript');
    expect(canonicalTechId('PostgreSQL')).toBe('postgresql');
    expect(canonicalTechId('cobol')).toBeUndefined();
  });
});

describe('geography dictionary', () => {
  it('resolves names and regions', () => {
    expect(resolvePlace('Viet Nam')).toBe('vn');
    expect(resolvePlace('European Union')).toBe('eu');
    expect(resolvePlace('atlantis')).toBeUndefined();
    expect(isCountry('vn')).toBe(true);
    expect(isCountry('eu')).toBe(false);
  });

  it('knows which countries a region contains', () => {
    expect(placeIncludes('eu', 'de')).toBe(true);
    expect(placeIncludes('europe', 'gb')).toBe(true);
    expect(placeIncludes('eu', 'gb')).toBe(false);
    expect(placeIncludes('vn', 'vn')).toBe(true);
    expect(placeIncludes('sea', 'vn')).toBe(true);
    expect(placeIncludes('us', 'vn')).toBe(false);
  });

  it('finds place mentions and ignores the pronoun "us"', () => {
    expect(findPlaces('Open to US, Canada or the European Union. Join us!').map((p) => p.id)).toEqual(['us', 'ca', 'eu']);
    expect(findPlaces('Looking for someone in Southeast Asia').map((p) => p.id)).toEqual(['sea']);
  });

  it('parses timezone abbreviations and UTC offsets', () => {
    expect(zoneOffset('EST')).toBe(-5);
    expect(zoneOffset('xyz')).toBeUndefined();
    expect(ZONE_ABBREVIATIONS).toContain('cet');
    expect(parseUtcOffset('UTC+7')).toBe(7);
    expect(parseUtcOffset('utc-5:30')).toBe(-5.5);
    expect(parseUtcOffset('GMT+1')).toBe(1);
    expect(parseUtcOffset('UTC+20')).toBeUndefined();
    expect(parseUtcOffset('seven')).toBeUndefined();
  });
});
