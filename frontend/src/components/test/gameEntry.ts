/**
 * «Провести игру» (the live game, docs/live/CONTRACT.md) from the author's pages: the test's own page (TestHome), its
 * card on «Тесты» (TestsView) and the quick test's link (QuickLinkPage). One rule for all of them, the test's page's own:
 * shown while the game is open (lib/live/open), shut while no question has its key, with the reason the test's page
 * gives for «Отправить по ссылке» (the same line explains both buttons there).
 */
import type { SubjectFacts } from '../../types/container';
import { TEST_HOME } from './copyTest';

export { liveGameOpen } from '../../lib/live/open';
export { ENTRY as LIVE_ENTRY } from '../live/host/copy';

/** The game's setup for a test. */
export function liveGamePath(containerId: string): string {
  return `/live/new?c=${containerId}`;
}

/** How many questions a test has, and how many of them have their key. */
export function keyCounts(subjects: readonly Pick<SubjectFacts, 'keyed' | 'no_key'>[]): { total: number; keyed: number } {
  let total = 0;
  let keyed = 0;
  for (const subject of subjects) {
    total += subject.keyed + subject.no_key;
    keyed += subject.keyed;
  }
  return { total, keyed };
}

/** Why the test can be neither sent nor played yet; null when it can. */
export function liveGameWhy({ total, keyed }: { total: number; keyed: number }): string | null {
  if (keyed > 0) return null;
  return total > 0 ? TEST_HOME.sendWhyKey : TEST_HOME.sendWhyEmpty;
}
