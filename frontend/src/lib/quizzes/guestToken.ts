/**
 * The device's secret for a quiz written without an account (release 47; spec meldy-notes
 * 10_Project/Test_Builder_Spec_2026-10-18.md §47.1). 32 random bytes as base64url (43 characters), kept in localStorage
 * by the quiz's code; the server keeps only its sha256. Whoever holds it continues and sees that device's attempts, so it
 * never leaves the browser except in the quiz_guest_* calls. Storage that throws (a private window) gives a token for
 * this page only: the attempt still works, a reload starts over.
 */
const PREFIX = 'meldy.quiz.guest.';
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function newToken(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(32));
  let text = '';
  bytes.forEach((byte) => {
    text += String.fromCharCode(byte);
  });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The token this device holds for the quiz, or null. */
export function guestToken(code: string): string | null {
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

/** The device's token for the quiz, made and kept the first time. */
export function ensureGuestToken(code: string, random?: (bytes: Uint8Array) => Uint8Array): string {
  const present = guestToken(code);
  if (present) return present;
  const token = newToken(random);
  const key = PREFIX + code;
  memory.set(key, token);
  try {
    storage()?.setItem(key, token);
  } catch {
    // Kept in memory for this page.
  }
  return token;
}

/** Forget the token (after its attempts moved to an account). */
export function dropGuestToken(code: string): void {
  const key = PREFIX + code;
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing kept.
  }
}
