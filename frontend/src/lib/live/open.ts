/**
 * Whether the test's home shows «Провести игру». The game went out in two halves (the teacher's screen, then the
 * students' side: /play and the bot); since release 47.12 both are on the site and the entry is open to every author.
 * To shut it again (an outage, a broken release), set LIVE_OPEN_FOR_ALL to false: then only a browser that asked for it
 * sees it — `?live=1` once (kept in this browser) or `localStorage['meldy.live.on'] = '1'`; `?live=0` hides it again.
 * A file of its own: the test's home must not carry the live API.
 */
export const LIVE_OPEN_FOR_ALL = true;

const KEY = 'meldy.live.on';

export function liveGameOpen(): boolean {
  return LIVE_OPEN_FOR_ALL || askedInThisBrowser();
}

/** The check switch for a shut game: `?live=1` / `?live=0`, kept in this browser. */
export function askedInThisBrowser(): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get('live');
    if (asked === '1') window.localStorage.setItem(KEY, '1');
    if (asked === '0') window.localStorage.removeItem(KEY);
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
