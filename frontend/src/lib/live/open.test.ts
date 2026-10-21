import { afterEach, describe, expect, it } from 'vitest';
import { liveGameOpen } from './open';

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('liveGameOpen', () => {
  it('is shut by default', () => {
    expect(liveGameOpen()).toBe(false);
  });

  it('opens with ?live=1, stays open in this browser, and shuts with ?live=0', () => {
    window.history.replaceState(null, '', '/exams/c/x?live=1');
    expect(liveGameOpen()).toBe(true);
    window.history.replaceState(null, '', '/exams/c/x');
    expect(liveGameOpen()).toBe(true);
    window.history.replaceState(null, '', '/exams/c/x?live=0');
    expect(liveGameOpen()).toBe(false);
  });
});
