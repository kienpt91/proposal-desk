import { canonicalJson, type Json } from '../shared/canonical-json.js';
import { constantTimeEqual, hmacSha256 } from '../shared/hmac.js';
import { GENESIS, type LogEntry, type LogEventType, type Payload } from './chain.js';

/**
 * Entries that change what the tool will do (a human approval, an applied configuration) carry a keyed MAC.
 * The hash chain alone cannot protect them: anyone who can write the log can recompute an unkeyed chain.
 * The MAC key lives in a separate private file in the state directory and never appears in any output.
 */
export const AUTHENTICATED_TYPES: readonly LogEventType[] = ['draft.approved', 'config.applied'];

export const KEY_BYTES = 32;

export function isAuthenticatedType(type: LogEventType): boolean {
  return AUTHENTICATED_TYPES.includes(type);
}

/** What is authenticated: the event type, the hash of the entry before it (so history cannot be rewritten) and the payload. */
function message(type: LogEventType, prev: string, payload: Payload): string {
  const { mac: _mac, ...rest } = payload;
  void _mac;
  return `proposal-desk/v1/${type}\n${prev}\n${canonicalJson(rest as Json)}`;
}

/** The payload with its `mac` field set, for an entry that will follow the entry with hash `prev`. */
export function signPayload(key: Uint8Array, type: LogEventType, payload: Payload, prev: string = GENESIS): Payload {
  const { mac: _mac, ...rest } = payload;
  void _mac;
  return { ...rest, mac: hmacSha256(key, message(type, prev, rest)) };
}

/** True when the entry's MAC is valid for its type, position in the chain and payload. */
export function verifyEntryMac(key: Uint8Array, entry: LogEntry): boolean {
  const mac = entry.payload.mac;
  if (typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac)) return false;
  return constantTimeEqual(mac, hmacSha256(key, message(entry.type, entry.prev, entry.payload)));
}
