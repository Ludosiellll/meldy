/**
 * The mandatory first run of the guide waits when the app is entered through a group link (/join/<код>): the
 * classmate came for the copy of the exam and lands on its cheat sheet, not under a blocking dialog that also
 * takes the app to «Сегодня». The wait lasts this tab's session; the next visit shows the first run as usual, and
 * «?» (on a phone «Как пользоваться Meldy» in the account menu) opens the guide any time.
 */
export const GUIDE_LATER_KEY = 'meldy_guide_later';

export function deferGuideOnce(): void {
  try {
    window.sessionStorage.setItem(GUIDE_LATER_KEY, '1');
  } catch {
    // Private mode: the guide shows as usual.
  }
}

export function guideDeferred(): boolean {
  try {
    return window.sessionStorage.getItem(GUIDE_LATER_KEY) === '1';
  } catch {
    return false;
  }
}
