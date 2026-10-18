import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropGuestToken, ensureGuestToken, guestToken, TOKEN_RE } from './guestToken';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('guestToken', () => {
  it('makes a 43-character base64url token once and keeps it by the code', () => {
    expect(guestToken('abcdefghjkmn')).toBeNull();
    const token = ensureGuestToken('abcdefghjkmn');
    expect(token).toMatch(TOKEN_RE);
    expect(ensureGuestToken('abcdefghjkmn')).toBe(token);
    expect(guestToken('abcdefghjkmn')).toBe(token);
    expect(guestToken('zzzzzzzzzzzz')).toBeNull();
    dropGuestToken('abcdefghjkmn');
    expect(guestToken('abcdefghjkmn')).toBeNull();
  });

  it('uses url-safe letters only', () => {
    const token = ensureGuestToken('k7m2p9q4r8st', (bytes) => bytes.fill(0xff));
    expect(token).toBe('_'.repeat(42) + '8');
  });

  it('works for the page when storage throws (a private window)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const token = ensureGuestToken('abcd2fghjkmn');
    expect(token).toMatch(TOKEN_RE);
    expect(guestToken('abcd2fghjkmn')).toBe(token);
  });
});
