/**
 * «Встань на ответ» as the class saw it: frames of the real recorded game on the projector (the stand game's 1920 × 1080
 * recording, at the moments of its 10.8 s cut: 12.6–19.2 s and 30.4–34.6 s), 800 × 450 WebP, each under 96 KB (the
 * Space refuses larger files). The reel's chapter «Игра в классе» and the page's section «Игра в классе» show them; a
 * file is fetched only when one of them is about to be seen.
 */
import run from './game/run.webp';
import last from './game/last.webp';
import stomp from './game/stomp.webp';
import drop from './game/drop.webp';

export const GAME_FRAMES = {
  /** The class runs to the answers; 14 seconds left. */
  run,
  /** The last second: most of the class on «А». */
  last,
  /** Zero: the boss stomps, «Верный ответ», «Устояли 18 из 30». */
  stomp,
  /** The rest of the floor has dropped; the fallen are ghosts. */
  drop,
} as const;

export type GameFrame = keyof typeof GAME_FRAMES;

/** The frames' own size (px). */
export const GAME_FRAME = { w: 800, h: 450 } as const;

let asked = false;

/** Fetches the frames ahead, once (the reel asks a scene before the game, so they are there when it starts). */
export function preloadGameFrames(): void {
  if (asked || typeof Image === 'undefined') return;
  asked = true;
  for (const src of Object.values(GAME_FRAMES)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }
}
