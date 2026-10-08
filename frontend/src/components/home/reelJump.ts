/**
 * «Смотреть в ролике» on the landing: scrolls to the reel and asks it to play a chapter. The reel is
 * a lazy chunk, so a request made before it loads waits here and is taken when it mounts.
 *
 * The ids of the film's seven chapters (components/reel/timeline CHAPTERS): tickets is the list of the
 * department (01), lectures the lecture check (02), sheet the cheat sheet's points (03), oral the answer
 * aloud (04), days the days of the answer (05), group the copies for the group (06), end the ending (07).
 */
export type ReelChapter = 'tickets' | 'lectures' | 'sheet' | 'oral' | 'days' | 'group' | 'end';

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
