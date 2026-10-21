import { describe, expect, it } from 'vitest';
import { backLinkFor, NAV_ITEMS, sectionOf } from '../Layout';
import { safeReturnTo, withReturn } from '../../lib/returnTo';
import { signedInPageOf } from '../../lib/prefetch';
import { chapterIndexFor, GUIDE_CHAPTERS } from '../guide/chapters';
import { QUICK_PATH, TESTS_PATH, quickLinkPath } from './paths';

/* The ways to «Быстрая контрольная» (UX audit of 21.10): the menu, the phone's back link, sign-up's way back, the guide. */

describe('the quick test in the app’s frame', () => {
  it('lives in «Экзамены»: the tab stays lit, no sixth tab', () => {
    expect(NAV_ITEMS).toHaveLength(5);
    expect(sectionOf(QUICK_PATH)?.label).toBe('Экзамены');
    expect(sectionOf(quickLinkPath('c-1', 'q-1'))?.label).toBe('Экзамены');
    expect(sectionOf('/tests/new')?.label).toBe('Экзамены');
  });

  it('a phone’s top line leads back to the tests', () => {
    expect(backLinkFor(QUICK_PATH)).toEqual({ to: TESTS_PATH, label: 'Тесты' });
    expect(backLinkFor(quickLinkPath('c-1', 'q-1'))).toEqual({ to: TESTS_PATH, label: 'Тесты' });
  });

  it('sign-up comes back to it: /register?next=/tests/quick', () => {
    expect(safeReturnTo(QUICK_PATH)).toBe('/tests/quick');
    expect(withReturn('/register', QUICK_PATH)).toBe('/register?next=%2Ftests%2Fquick');
  });

  it('its page loads with the shell when it is the first screen', () => {
    expect(signedInPageOf(QUICK_PATH)).toBe('QuickTestPage');
  });

  it('«?» there opens the «Тесты» chapter', () => {
    expect(GUIDE_CHAPTERS[chapterIndexFor(QUICK_PATH)].id).toBe('tests');
    expect(GUIDE_CHAPTERS[chapterIndexFor(quickLinkPath('c-1', 'q-1'))].id).toBe('tests');
  });
});
