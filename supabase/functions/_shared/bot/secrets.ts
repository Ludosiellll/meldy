/**
 * Secrets derived from the one owner secret, TELEGRAM_BOT_TOKEN (spec decision 5, §6.4): the webhook's
 * `secret_token` and the tick's `x-meldy-tick` are HMAC-SHA256 of the token over `meldy:webhook:v1` and
 * `meldy:tick:v1`, base64url without padding (43 characters, inside Telegram's `[A-Za-z0-9_-]{1,256}`).
 * A new token (after /revoke in @BotFather) changes both; `/setup` then stores the new tick token.
 */

export type SecretPurpose = 'webhook' | 'tick';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cache: { token: string; webhook?: string; tick?: string } | null = null;

/** HMAC-SHA256(key = token, message = `meldy:<purpose>:v1`) as base64url. */
export async function derivedSecret(token: string, purpose: SecretPurpose): Promise<string> {
  if (!token) throw new Error('no bot token');
  if (cache && cache.token === token && cache[purpose]) return cache[purpose] as string;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`meldy:${purpose}:v1`)));
  const secret = base64url(mac);
  if (!cache || cache.token !== token) cache = { token };
  cache[purpose] = secret;
  return secret;
}

/**
 * Compares a header with the expected secret in constant time for the expected length: every byte of the expected
 * value is compared whatever the header holds, so the time does not tell how much of it matched.
 */
export function sameSecret(given: string | null | undefined, expected: string): boolean {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i += 1) diff |= (i < a.length ? a[i] : 0) ^ b[i];
  return diff === 0;
}
