import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GENESIS, nextEntry } from '../../src/domain/log/chain.js';
import { AUTHENTICATED_TYPES, isAuthenticatedType, signPayload, verifyEntryMac } from '../../src/domain/log/auth.js';
import { bytesToHex, constantTimeEqual, hexToBytes, hmacSha256 } from '../../src/domain/shared/hmac.js';
import { forSeeds } from '../support/random.js';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('HMAC-SHA256', () => {
  it('matches the RFC 4231 test vectors', () => {
    expect(hmacSha256(hexToBytes('0b'.repeat(20)), 'Hi There')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    expect(hmacSha256(ascii('Jefe'), 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    expect(hmacSha256(hexToBytes('aa'.repeat(131)), 'Test Using Larger Than Block-Size Key - Hash Key First')).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('agrees with node:crypto for random keys and messages (property)', () => {
    forSeeds(120, (random) => {
      const key = random.bytes(random.int(200));
      const message = Array.from({ length: random.int(150) }, () => random.pick(['a', 'é', '✓', '\n', ' ', '𝄞'])).join('');
      expect(hmacSha256(key, message)).toBe(createHmac('sha256', key).update(message, 'utf8').digest('hex'));
    });
  });

  it('converts hex and compares in constant time', () => {
    expect(bytesToHex(hexToBytes('00ff10'))).toBe('00ff10');
    expect(() => hexToBytes('abc')).toThrow(RangeError);
    expect(() => hexToBytes('zz')).toThrow(RangeError);
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('authenticated log entries', () => {
  const key = hexToBytes('11'.repeat(32));
  const payload = { draftId: 'd-1', bindingDigest: 'a'.repeat(64) };
  const entry = () => nextEntry(undefined, '2026-10-31T10:00:01.000Z', 'draft.approved', signPayload(key, 'draft.approved', payload, GENESIS));

  it('verifies a genuine entry and rejects other keys, edited payloads, moved positions and other types', () => {
    const genuine = entry();
    expect(verifyEntryMac(key, genuine)).toBe(true);
    expect(verifyEntryMac(hexToBytes('22'.repeat(32)), genuine)).toBe(false);
    expect(verifyEntryMac(key, { ...genuine, payload: { ...genuine.payload, draftId: 'd-2' } })).toBe(false);
    expect(verifyEntryMac(key, { ...genuine, prev: 'b'.repeat(64) })).toBe(false);
    expect(verifyEntryMac(key, { ...genuine, type: 'config.applied' })).toBe(false);
  });

  it('rejects missing or malformed MACs', () => {
    const genuine = entry();
    const { mac: _mac, ...bare } = genuine.payload;
    void _mac;
    expect(verifyEntryMac(key, { ...genuine, payload: bare })).toBe(false);
    expect(verifyEntryMac(key, { ...genuine, payload: { ...bare, mac: 'short' } })).toBe(false);
    expect(verifyEntryMac(key, { ...genuine, payload: { ...bare, mac: 7 } })).toBe(false);
  });

  it('ignores a mac field in the input payload and covers exactly the approval and configuration events', () => {
    expect(signPayload(key, 'draft.approved', { ...payload, mac: 'f'.repeat(64) })).toEqual(signPayload(key, 'draft.approved', payload));
    expect(AUTHENTICATED_TYPES).toEqual(['draft.approved', 'config.applied']);
    expect(isAuthenticatedType('draft.approved')).toBe(true);
    expect(isAuthenticatedType('job.analyzed')).toBe(false);
  });
});
