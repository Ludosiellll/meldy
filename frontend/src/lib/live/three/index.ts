/**
 * The 3D character and boss kit of the movement games (docs/live/KIT_3D.md).
 *
 *   const kit = await loadKit({ boss: 'skeleton' });     // three.js and the models: a separate chunk, loaded here
 *   const view = kit.mount(canvas);                       // projector: pixel ratio ≤ 1.5, adaptive quality
 *   const arena = kit.createArena(map);                   // the server's map (docs/live/MOVE.md)
 *   const boss = kit.createBoss('skeleton');
 *   const p = kit.createPlayer(look, 'Дима');             // the wardrobe's look as is
 *   await view.warmUp();
 *   view.start((dt, now) => { p.setPosition(x, y); p.setPose('run'); });
 *   …
 *   kit.dispose();                                        // on unmount: frees the GPU and stops the loop
 *
 * Nothing here imports three.js: this file, look.ts, pose.ts, arenaPlan.ts, quality.ts and thumbs.ts stay in the
 * screens' own chunks; only loadKit() fetches the 3D chunk.
 */
import type { Kit, LoadOptions } from './types';

export type { Arena, Boss, BossKind, BossPhase, CameraSpec, FrameStats, Kit, LoadOptions, Player, View, ViewOptions } from './types';
export type { PlayerLook, KitHatId, ExtraHatId, BodyOption, ColourOption, HatOption, ModelId } from './look';
export {
  ACCESSORIES,
  BODY_OPTIONS,
  COLOUR_OPTIONS,
  HAT_OPTIONS,
  MODELS,
  PALETTE,
  accessoryIndex,
  clothesHex,
  isWardrobeLook,
  modelIndex,
  toPlayerLook,
} from './look';
export { POSES, type Pose } from './pose';
export { BOSS_KINDS, BOSS_PHASES } from './constants';
export type { MoveMap } from './arenaPlan';
export { thumbUrl, paintThumb } from './thumbs';

let chunk: Promise<unknown> | null = null;

/**
 * Loads three.js, the five bodies and the shared clips (and the skeleton boss if asked), and builds a kit.
 * Each call makes a new kit; the files come from the browser's cache after the first.
 */
export function loadKit(options?: LoadOptions): Promise<Kit> {
  return import('./internal/game3d').then((m) => m.loadKitImpl(options));
}

/** Starts fetching the 3D chunk early (e.g. when the teacher opens the game's setup), without building anything. */
export function prefetchKit(): void {
  if (!chunk) chunk = import('./internal/game3d').catch(() => (chunk = null));
}
