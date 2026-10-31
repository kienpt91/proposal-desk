import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256, sha256Bytes } from '../../src/domain/shared/sha256.js';
import { forSeeds } from '../support/random.js';

describe('sha256', () => {
  it('matches the published test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes one million repetitions of a', () => {
    expect(sha256('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('agrees with node:crypto for random byte strings of every padding length', () => {
    forSeeds(150, (random) => {
      const bytes = random.bytes(random.int(300));
      expect(sha256Bytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    });
  });

  it('encodes text as UTF-8 before hashing', () => {
    const text = 'đồng ✓ 𝄞';
    expect(sha256(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });
});
