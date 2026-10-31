import { sha256 } from './sha256.js';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json | undefined };

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit, no whitespace, `undefined`
 * properties omitted. Digests, hash chains and snapshots are all computed over this form.
 */
export function canonicalJson(value: Json): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new RangeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${(value as readonly Json[]).map(canonicalJson).join(',')}]`;
  const record = value as { readonly [key: string]: Json | undefined };
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(',')}}`;
}

/** SHA-256 hex digest of the canonical JSON form. */
export function digestOf(value: Json): string {
  return sha256(canonicalJson(value));
}
