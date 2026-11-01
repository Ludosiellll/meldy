/**
 * The device's secret for one duel (docs/live/DUEL.md §6): 32 bytes of crypto.getRandomValues as base64url (43
 * characters), made here and kept in localStorage `meldy.duel.<code>`, so a reload, a phone back from the pocket or the
 * next round finds the seat. The server keeps only its sha256 and never sends either back; the token goes in POST bodies
 * only, never in an address. Storage that throws (a private window) keeps it for this page only.
 */
import { newLiveToken } from '../live/api';

const PREFIX = 'meldy.duel.';
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The token this device holds for the duel, or null. */
export function duelToken(code: string): string | null {
  const key = PREFIX + code;
  let value: string | null = null;
  try {
    value = storage()?.getItem(key) ?? null;
  } catch {
    value = null;
  }
  if (value && TOKEN_RE.test(value)) return value;
  const kept = memory.get(key);
  return kept && TOKEN_RE.test(kept) ? kept : null;
}

/** Keep a token for the duel (a new seat, or the same seat in the next round). */
export function keepDuelToken(code: string, token: string): void {
  const key = PREFIX + code;
  memory.set(key, token);
  try {
    storage()?.setItem(key, token);
  } catch {
    // kept in memory for this page
  }
}

/** A new token: 256 bits from the device's own random source. */
export function newDuelToken(): string {
  return newLiveToken();
}

/** Forget the token (the server no longer knows it). */
export function dropDuelToken(code: string): void {
  const key = PREFIX + code;
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // nothing kept
  }
}
