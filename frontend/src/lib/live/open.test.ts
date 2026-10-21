import { afterEach, describe, expect, it } from 'vitest';
import { askedInThisBrowser, liveGameOpen } from './open';

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('liveGameOpen', () => {
  it('is open to every author, whatever this browser asked', () => {
    expect(liveGameOpen()).toBe(true);
    window.history.replaceState(null, '', '/exams/c/x?live=0');
    expect(liveGameOpen()).toBe(true);
  });
});

describe('askedInThisBrowser (the switch while the game is shut)', () => {
  it('is off by default', () => {
    expect(askedInThisBrowser()).toBe(false);
  });

  it('turns on with ?live=1, stays on in this browser, and turns off with ?live=0', () => {
    window.history.replaceState(null, '', '/exams/c/x?live=1');
    expect(askedInThisBrowser()).toBe(true);
    window.history.replaceState(null, '', '/exams/c/x');
    expect(askedInThisBrowser()).toBe(true);
    window.history.replaceState(null, '', '/exams/c/x?live=0');
    expect(askedInThisBrowser()).toBe(false);
  });
});
