/**
 * The studio's small shared helpers (lib/studio/doc.ts re-exports them; pages.ts uses them without doc.ts): random block
 * ids, characters as the database counts them, one-line fields, equality as data.
 */

/** A source of random bytes shaped like crypto.getRandomValues (tests pass a fixed one). */
export type RandomFill = (bytes: Uint8Array) => Uint8Array;
export const cryptoFill: RandomFill = (bytes) => crypto.getRandomValues(bytes);

export const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Characters as the database counts them (code points, not UTF-16 units). */
export const chars = (text: string): number => Array.from(text).length;
export const cut = (text: string, max: number): string => (chars(text) <= max ? text : Array.from(text).slice(0, max).join(''));
/** A one-line field: line breaks (and the spaces around them) become one space. */
export const oneLine = (text: string): string => text.replace(/[ \t]*(?:\r\n?|\n)\s*/g, ' ');

/** Equal as data: the same values under the same keys, in any key order (an undefined field counts as absent). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((entry, at) => sameValue(entry, b[at]));
  if (!isObj(a) || !isObj(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => sameValue(a[key], b[key]));
}

// ─────────────────────────────────────────────── ids

export const BLOCK_ID_LENGTH = 12;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A block id: 12 characters of [a-z0-9] (BLOCK_ID_RE), from unbiased random bytes. */
export function newId(random: RandomFill = cryptoFill): string {
  let id = '';
  for (let round = 0; round < 64 && id.length < BLOCK_ID_LENGTH; round += 1) {
    for (const byte of random(new Uint8Array(BLOCK_ID_LENGTH * 2))) {
      // 252 = 7 × 36: bytes above it would make the first letters likelier.
      if (byte < 252 && id.length < BLOCK_ID_LENGTH) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    }
  }
  if (id.length < BLOCK_ID_LENGTH) throw new Error('studio: the random source gives no usable bytes');
  return id;
}

/** A new id that is not among `taken` (added to it). */
export function freshId(taken: Set<string>, random: RandomFill = cryptoFill): string {
  let id = newId(random);
  while (taken.has(id)) id = newId(random);
  taken.add(id);
  return id;
}
