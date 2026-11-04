import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTAINER_LINKS_PREFIX, keepLink, keptCode, keptLinks } from './linkStore';

const C = 'c-1';
const YEAR = 365 * 86_400_000;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-04T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('linkStore: the codes of the author’s links on this device', () => {
  it('keeps a code, newest first, five at most; a closed link’s code stays (it may be opened again)', () => {
    for (let i = 1; i <= 6; i += 1) keepLink(C, `l-${i}`, `abcd2fghjk0${i}`);
    expect(keptLinks(C).map((entry) => entry.link)).toEqual(['l-6', 'l-5', 'l-4', 'l-3', 'l-2']);
    expect(keptCode(C, 'l-4')).toBe('abcd2fghjk04');
  });

  it('a code kept more than a year ago goes (review of 04.11): an old link of a closed exam is no use on the device', () => {
    keepLink(C, 'l-old', 'abcd2fghjk01');
    vi.setSystemTime(Date.now() + YEAR + 86_400_000);
    keepLink(C, 'l-new', 'abcd2fghjk02');
    expect(keptLinks(C).map((entry) => entry.link)).toEqual(['l-new']);
    expect(keptCode(C, 'l-old')).toBeNull();
    // Gone from the storage too, not only from the answer.
    expect(window.localStorage.getItem(CONTAINER_LINKS_PREFIX + C)).not.toContain('l-old');
  });

  it('a code kept before the date was stored stays until the list moves on', () => {
    window.localStorage.setItem(CONTAINER_LINKS_PREFIX + C, JSON.stringify([{ link: 'l-1', code: 'abcd2fghjk01' }]));
    expect(keptCode(C, 'l-1')).toBe('abcd2fghjk01');
  });
});
