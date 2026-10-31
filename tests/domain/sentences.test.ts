import { describe, expect, it } from 'vitest';
import { modeOfHeading, toSentences } from '../../src/domain/job/sentences.js';

const modes = (text: string) => toSentences(text).map((s) => `${s.mode}:${s.text}`);

describe('section modes', () => {
  it('maps heading words to modes', () => {
    expect(modeOfHeading('Must have')).toBe('must');
    expect(modeOfHeading('Nice-to-have skills')).toBe('nice');
    expect(modeOfHeading('About the company')).toBe('ignore');
    expect(modeOfHeading('The project')).toBe('neutral');
  });

  it('recognises colon, markdown, bold, capitalised and well-known headings', () => {
    expect(modes('Requirements:\n- A thing')).toEqual(['must:A thing']);
    expect(modes('## Nice to have\n- B thing')).toEqual(['nice:B thing']);
    expect(modes('**Benefits**\nFree snacks')).toEqual(['ignore:Free snacks']);
    expect(modes('WHAT WE OFFER\nGood pay')).toEqual(['ignore:Good pay']);
    expect(modes('About us\nWe are nice')).toEqual(['ignore:We are nice']);
    expect(modes('Bonus points\n- C thing')).toEqual(['nice:C thing']);
  });

  it('reads inline labels such as "Nice to have: Docker" and keeps their mode for the bullets below', () => {
    expect(modes('Nice to have: Docker. Kubernetes.\n- GraphQL')).toEqual(['nice:Docker.', 'nice:Kubernetes.', 'nice:GraphQL']);
    expect(modes('Required skills - TypeScript')).toEqual(['must:TypeScript']);
  });

  it('ends a section at a blank line unless bullets follow, and numbered bullets count as bullets', () => {
    const text = 'Requirements:\nFirst line\n\nA plain paragraph after the blank line.\n\nNice to have:\n\n- late bullet\n\n1. numbered one\n2) numbered two';
    expect(modes(text)).toEqual([
      'must:First line',
      'neutral:A plain paragraph after the blank line.',
      'nice:late bullet',
      'nice:numbered one',
      'nice:numbered two',
    ]);
    expect(modes('Requirements:\nFirst\n\n- bullet after blank')).toEqual(['must:First', 'must:bullet after blank']);
  });

  it('keeps reading order numbers', () => {
    expect(toSentences('One. Two.\nThree.').map((s) => s.order)).toEqual([0, 1, 2]);
  });
});
