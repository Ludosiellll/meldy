import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../sha256';
import { GROUP_LINKS_PREFIX, forgetGroupLink, joinUrl, matchGroupLink, rememberGroupLink, storedGroupLinks } from './groupLinks';

const EXAM = 'e1d2c3b4-a596-4877-8899-aabbccddeeff';
const SHARE = '5a000000-0000-4000-8000-000000000001';
const CODE = 'k7m2pq9rst4v';

describe('the link’s code on this device', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('keeps the codes of an exam, newest first, and forgets a closed link', () => {
    expect(storedGroupLinks(EXAM)).toEqual([]);
    expect(rememberGroupLink(EXAM, CODE, SHARE)).toBe(true);
    expect(rememberGroupLink(EXAM, 'a2b3c4d5e6f7')).toBe(true);
    expect(storedGroupLinks(EXAM)).toEqual([
      { code: 'a2b3c4d5e6f7', share: null },
      { code: CODE, share: SHARE },
    ]);
    // The same code again moves up instead of doubling.
    rememberGroupLink(EXAM, CODE, SHARE);
    expect(storedGroupLinks(EXAM).map((link) => link.code)).toEqual([CODE, 'a2b3c4d5e6f7']);
    forgetGroupLink(EXAM, SHARE);
    expect(storedGroupLinks(EXAM)).toEqual([{ code: 'a2b3c4d5e6f7', share: null }]);
    expect(storedGroupLinks('another-exam')).toEqual([]);
  });

  it('keeps nothing that is not a code, and reads nothing broken', () => {
    expect(rememberGroupLink(EXAM, 'not a code')).toBe(false);
    expect(rememberGroupLink(EXAM, 'K7M2PQ9RST4V')).toBe(false);
    window.localStorage.setItem(GROUP_LINKS_PREFIX + EXAM, '{broken');
    expect(storedGroupLinks(EXAM)).toEqual([]);
    window.localStorage.setItem(GROUP_LINKS_PREFIX + EXAM, JSON.stringify([{ code: 'bad' }, { code: CODE, share: 5 }]));
    expect(storedGroupLinks(EXAM)).toEqual([{ code: CODE, share: null }]);
  });

  it('works with blocked storage: nothing kept, nothing thrown', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(rememberGroupLink(EXAM, CODE, SHARE)).toBe(false);
    expect(storedGroupLinks(EXAM)).toEqual([]);
    expect(() => forgetGroupLink(EXAM, SHARE)).not.toThrow();
  });

  it('gives the code only of an open link: by its id, or by the hash the database keeps', () => {
    const open = { id: SHARE, codeHash: sha256Hex(CODE), state: 'active' as const };
    expect(matchGroupLink([open], [{ code: CODE, share: SHARE }])).toEqual({ active: true, code: CODE });
    // A code from the invitation page has no id: its hash finds the link.
    expect(matchGroupLink([open], [{ code: CODE, share: null }])).toEqual({ active: true, code: CODE });
    // An open link made on another device: there is a link, but not its code.
    expect(matchGroupLink([open], [{ code: 'a2b3c4d5e6f7', share: null }])).toEqual({ active: true, code: null });
    expect(matchGroupLink([open], [])).toEqual({ active: true, code: null });
    // The kept code belongs to a closed link: no link to copy.
    expect(matchGroupLink([{ ...open, state: 'revoked' }], [{ code: CODE, share: SHARE }])).toEqual({ active: false, code: null });
    expect(matchGroupLink([{ ...open, state: 'expired' }], [{ code: CODE, share: SHARE }])).toEqual({ active: false, code: null });
    expect(matchGroupLink([], [{ code: CODE, share: SHARE }])).toEqual({ active: false, code: null });
  });

  it('builds the invitation address on this site', () => {
    expect(joinUrl(CODE, 'https://ludosiel-studyforge.hf.space')).toBe(`https://ludosiel-studyforge.hf.space/join/${CODE}`);
  });
});
