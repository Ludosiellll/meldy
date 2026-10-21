/**
 * Whether the test's home shows «Провести игру». The game goes out in two halves: the teacher's screen first, the
 * students' side (/play and the bot) after it; until the second half is on the site the entry stays hidden, so no
 * teacher starts a game nobody can join. `?live=1` once (kept in this browser) or `localStorage['meldy.live.on'] = '1'`
 * shows it for checks; `?live=0` hides it again. A file of its own: the test's home must not carry the live API.
 */
export const LIVE_OPEN_FOR_ALL = false;

const KEY = 'meldy.live.on';

export function liveGameOpen(): boolean {
  if (LIVE_OPEN_FOR_ALL) return true;
  try {
    const asked = new URLSearchParams(window.location.search).get('live');
    if (asked === '1') window.localStorage.setItem(KEY, '1');
    if (asked === '0') window.localStorage.removeItem(KEY);
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
