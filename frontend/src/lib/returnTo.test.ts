import { afterEach, describe, expect, it } from 'vitest';
import {
  afterSignIn,
  emailRedirectTo,
  forgetPendingJoin,
  JOIN_PENDING_KEY,
  joinPath,
  loginFor,
  normalizeJoinCode,
  oauthRedirectTo,
  pendingJoin,
  rememberPendingJoin,
  returnToFromSearch,
  safeReturnTo,
  withReturn,
} from './returnTo';

const ORIGIN = 'https://ludosiel-studyforge.hf.space';

afterEach(() => window.localStorage.clear());

describe('the way back after signing in', () => {
  it('keeps a page of this site: path, query and hash', () => {
    expect(safeReturnTo('/join/abcd2fghjkmn')).toBe('/join/abcd2fghjkmn');
    expect(safeReturnTo('/exams/e-1?view=sheet')).toBe('/exams/e-1?view=sheet');
    expect(safeReturnTo('/library/x#quiz')).toBe('/library/x#quiz');
    expect(safeReturnTo('  /dashboard  ')).toBe('/dashboard');
  });

  it.each([
    ['another site', 'https://evil.example/join/abc'],
    ['a protocol-relative address', '//evil.example/x'],
    ['a backslash that browsers read as a slash', '/\\evil.example'],
    ['a backslash later in the path', '/join/\\\\evil.example'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,hi'],
    ['a relative path', 'join/abc'],
    ['a tab inside', '/\tjoin'],
    ['a newline inside', '/join\n//evil.example'],
    ['the sign-in page (a circle)', '/login?next=/join/x'],
    ['the sign-up page', '/register'],
    ['the OAuth callback', '/auth/callback?code=1'],
    ['an empty value', ''],
    ['not a string', 42],
    ['too long', `/${'a'.repeat(600)}`],
  ])('refuses %s', (_name, value) => {
    expect(safeReturnTo(value)).toBeNull();
    expect(afterSignIn(value as string)).toBe('/dashboard');
  });

  it('reads ?next= from the address, checked', () => {
    expect(returnToFromSearch('?next=%2Fjoin%2Fabcd2fghjkmn')).toBe('/join/abcd2fghjkmn');
    expect(returnToFromSearch('?next=https%3A%2F%2Fevil.example')).toBeNull();
    expect(returnToFromSearch('?code=1')).toBeNull();
    expect(returnToFromSearch('')).toBeNull();
  });

  it('carries the way back to the sign-in pages, Google and the confirmation letter', () => {
    expect(withReturn('/login', '/join/abcd2fghjkmn')).toBe('/login?next=%2Fjoin%2Fabcd2fghjkmn');
    expect(withReturn('/login', '//evil.example')).toBe('/login');
    expect(withReturn('/register', null)).toBe('/register');
    // The callback's address stays /auth/callback: the way back is only a parameter.
    expect(oauthRedirectTo(ORIGIN, '/join/abcd2fghjkmn')).toBe(`${ORIGIN}/auth/callback?next=%2Fjoin%2Fabcd2fghjkmn`);
    expect(oauthRedirectTo(ORIGIN, null)).toBe(`${ORIGIN}/auth/callback`);
    // The letter goes straight to the page (often opened in another browser), else «Сегодня» as before.
    expect(emailRedirectTo(ORIGIN, '/join/abcd2fghjkmn')).toBe(`${ORIGIN}/join/abcd2fghjkmn`);
    expect(emailRedirectTo(ORIGIN, '//evil.example')).toBe(`${ORIGIN}/dashboard`);
  });

  it('sends a signed-out visitor of a private page to sign in with that page as the way back', () => {
    expect(loginFor('/exams/e-1', '?view=sheet')).toBe('/login?next=%2Fexams%2Fe-1%3Fview%3Dsheet');
    expect(loginFor('/dashboard')).toBe('/login');
    expect(loginFor('/')).toBe('/login');
  });
});

describe('a group link waiting on this device', () => {
  it('normalises a code and refuses anything else', () => {
    expect(normalizeJoinCode(' ABCD-2FGH-JKMN ')).toBe('abcd2fghjkmn');
    expect(normalizeJoinCode('abcd2fghjkmi')).toBeNull();
    expect(normalizeJoinCode('abc')).toBeNull();
    expect(joinPath('abcd2fghjkmn')).toBe('/join/abcd2fghjkmn');
  });

  it('waits a day, then is forgotten', () => {
    const now = Date.UTC(2026, 9, 7, 10);
    rememberPendingJoin('abcd2fghjkmn', now);
    expect(pendingJoin(now + 60_000)).toBe('abcd2fghjkmn');
    expect(pendingJoin(now + 25 * 60 * 60 * 1000)).toBeNull();
    expect(window.localStorage.getItem(JOIN_PENDING_KEY)).toBeNull();
    rememberPendingJoin('abcd2fghjkmn', now);
    forgetPendingJoin();
    expect(pendingJoin(now)).toBeNull();
    window.localStorage.setItem(JOIN_PENDING_KEY, '{oops');
    expect(pendingJoin(now)).toBeNull();
  });
});
