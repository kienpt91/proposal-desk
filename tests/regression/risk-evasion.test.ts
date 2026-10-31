import { describe, expect, it } from 'vitest';
import { analyze, flagIds } from '../support/analysis.js';

// Security review finding "risk-negation-suppression": a negation word anywhere near a request must not switch a
// hard warning off. Only a narrow set of benign constructions is exempt, and only when the negator governs the request.

const has = (text: string, id: string) => flagIds(text).includes(id);

describe('hard warnings cannot be talked away', () => {
  it('still flags a credentials request with a negation word, a "paid" or an "avoid" nearby', () => {
    for (const text of [
      'We are paid on time so please send your password and OTP for the account review.',
      'Do not worry, please send your password.',
      'No problem, just share your private key with us.',
      'I will not ask twice: send your password.',
      'We never ask for your password; send your seed phrase now.',
      'Nor should you hesitate to give us your login details.',
      'Avoid delays and send your passcode today.',
      'It is not a scam, please provide your credentials.',
    ]) {
      expect(analyze(text).analysis.flags.find((f) => f.ruleId === 'credentials-request')?.severity, text).toBe('hard');
    }
  });

  it('still lets honest assurances through', () => {
    for (const text of [
      'We will never ask you to share your password.',
      'Never share your password with anyone, including us.',
      'Please do not send your password by email.',
      'We do not ask for your seed phrase.',
    ]) {
      expect(has(text, 'credentials-request'), text).toBe(false);
    }
  });

  it('applies the same rule to free work, off-platform requests and urgency', () => {
    expect(has('We pay on time. Start with a free test project.', 'free-work')).toBe(true);
    expect(has('Not a problem if it is a bit long: build a free sample first.', 'free-work')).toBe(true);
    expect(has('No free test work is expected.', 'free-work')).toBe(false);
    expect(has('We do not ask for free work.', 'free-work')).toBe(false);
    expect(has('Do not worry, contact me on WhatsApp.', 'off-platform')).toBe(true);
    expect(has('Do not worry, send me your email address.', 'off-platform')).toBe(true);
    expect(has('Please do not email me directly.', 'off-platform')).toBe(false);
    expect(has('Not to worry but we need this ASAP.', 'urgency-pressure')).toBe(true);
    expect(has('There is no rush on this.', 'urgency-pressure')).toBe(false);
  });
});
