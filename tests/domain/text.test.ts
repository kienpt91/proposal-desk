import { describe, expect, it } from 'vitest';
import {
  contentTokens,
  escapeRegExp,
  foldText,
  joinList,
  splitSentences,
  tokenize,
  truncate,
  wordCount,
} from '../../src/domain/shared/text.js';

describe('text helpers', () => {
  it('folds case and diacritics', () => {
    expect(foldText('Café  RÉSUMÉ')).toBe('cafe resume');
  });

  it('tokenizes technology names intact', () => {
    expect(tokenize('C++ and C#, Node.js, Vue3!')).toEqual(['c++', 'and', 'c#', 'node.js', 'vue3']);
    expect(contentTokens('I built the API for you')).toEqual(['built', 'api']);
  });

  it('counts words', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  one  two\nthree ')).toBe(3);
  });

  it('splits sentences and keeps abbreviations together', () => {
    expect(splitSentences('Hello there. I use e.g. Node. Is it ok? Yes!\n\nNext line')).toEqual([
      'Hello there.',
      'I use e.g. Node.',
      'Is it ok?',
      'Yes!',
      'Next line',
    ]);
  });

  it('joins lists and truncates', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a and b');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });

  it('escapes regexp metacharacters', () => {
    expect(new RegExp(escapeRegExp('c++ (x)')).test('c++ (x)')).toBe(true);
  });
});
