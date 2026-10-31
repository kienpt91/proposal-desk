import { sha256Bytes } from './sha256.js';

// HMAC-SHA256 (RFC 2104 / FIPS 198-1) on top of the pure SHA-256, so the domain can authenticate
// records without importing node:crypto. Tests compare it with node:crypto and the RFC 4231 vectors.

const BLOCK = 64;

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new RangeError('not a hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** HMAC-SHA256 of the UTF-8 encoding of `message`, lowercase hex. */
export function hmacSha256(key: Uint8Array, message: string): string {
  const k = new Uint8Array(BLOCK);
  k.set(key.length > BLOCK ? hexToBytes(sha256Bytes(key)) : key);
  const text = new TextEncoder().encode(message);
  const inner = new Uint8Array(BLOCK + text.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let i = 0; i < BLOCK; i++) {
    inner[i] = (k[i] as number) ^ 0x36;
    outer[i] = (k[i] as number) ^ 0x5c;
  }
  inner.set(text, BLOCK);
  outer.set(hexToBytes(sha256Bytes(inner)), BLOCK);
  return sha256Bytes(outer);
}

/** Compares two strings in time that depends only on their length, not on where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
