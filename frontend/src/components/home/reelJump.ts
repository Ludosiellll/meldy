/**
 * «Смотреть в ролике» on the landing: scrolls to the reel and asks it to play a chapter. The reel is
 * a lazy chunk, so a request made before it loads waits here and is taken when it mounts.
 */
export type ReelChapter = 'tickets' | 'oral' | 'sheet' | 'days';

export const REEL_EVENT = 'meldy-reel';

let pending: ReelChapter | null = null;

export function jumpToReel(chapter: ReelChapter, smooth = true): void {
  pending = chapter;
  document.getElementById('reel')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  window.dispatchEvent(new CustomEvent<{ chapter: ReelChapter }>(REEL_EVENT, { detail: { chapter } }));
}

/** The chapter asked for before the reel was there (taken once). */
export function takePendingChapter(): ReelChapter | null {
  const chapter = pending;
  pending = null;
  return chapter;
}
