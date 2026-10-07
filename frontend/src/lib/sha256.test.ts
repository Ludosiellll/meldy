import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

async function subtleHex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with the browser on UTF-8 text and on every padding length around a block', async () => {
    const texts = ['k7m2pq9rst4v', 'Шпаргалка: 8 строк', 'meldy-daily-reminder:user-1:e-1', '😀 и ё'];
    for (let length = 50; length <= 130; length += 1) texts.push('я'.repeat(Math.floor(length / 2)) + 'x'.repeat(length % 2));
    for (const text of texts) expect(sha256Hex(text)).toBe(await subtleHex(text));
  });
});
