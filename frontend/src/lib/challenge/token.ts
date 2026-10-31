/**
 * The device's secret for one challenge (docs/live/CHALLENGE.md): 32 random bytes as base64url (43 characters), made
 * here and kept in localStorage by the link's code, so the run, its result and the table are there when the person
 * comes back days later. The server keeps only its sha256 and never sends it back. Storage that throws (a private
 * window) keeps it for this page only: the run still works, a reload starts over.
 */
import { newLiveToken } from '../live/api';

const PREFIX = 'meldy.challenge.';
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The token this device holds for the challenge, or null. */
export function challengeToken(code: string): string | null {
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

/** The device's token for the challenge, made and kept the first time. */
export function ensureChallengeToken(code: string, make: () => string = newLiveToken): string {
  const present = challengeToken(code);
  if (present) return present;
  const token = make();
  const key = PREFIX + code;
  memory.set(key, token);
  try {
    storage()?.setItem(key, token);
  } catch {
    // Kept in memory for this page.
  }
  return token;
}

/** Forget the token (the server no longer knows it). */
export function dropChallengeToken(code: string): void {
  const key = PREFIX + code;
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // nothing kept
  }
}
