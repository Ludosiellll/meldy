/**
 * Pictures of the characters for the phone's picker, so a phone never runs a 3D scene. No three.js here.
 *
 * One WebP per body × hat (5 × 13), rendered from the kit by scripts/game-thumbs.mjs: the left half is the character
 * with white clothes, the right half a mask that is opaque where the clothes are. The phone paints the player's colour
 * through the mask with «multiply», in CSS or with paintThumb():
 *
 *   .thumb { background: url(…) 0 0 / 200% 100%; position: relative; }
 *   .thumb::after { content: ''; position: absolute; inset: 0; background: var(--clothes); mix-blend-mode: multiply;
 *     -webkit-mask: url(…) 100% 0 / 200% 100%; mask: url(…) 100% 0 / 200% 100%; }
 */
import type { BodyId, ColourId } from '../types';
import { BODY_OPTIONS, clothesHex, type KitHatId, type ModelId } from './look';
import { THUMBS_DIR, THUMB_PX } from './thumbs.gen';
import { BOSS_PICTURES } from './bosses.gen';
import type { BossKind } from './types';

/** Side of one half of a thumbnail, px (the file is twice as wide). */
export const THUMB_SIZE = THUMB_PX;

/** The thumbnail file's name for a model and a hat (the generator writes these). */
export function thumbFile(model: ModelId, hat: KitHatId): string {
  return `${model}-${hat}.webp`;
}

/** Address of the thumbnail for a body and a hat. The folder's name carries a hash: cache it for good. */
export function thumbUrl(body: BodyId, hat: KitHatId): string {
  const model = (BODY_OPTIONS.find((b) => b.id === body) ?? BODY_OPTIONS[0]).model;
  return `${import.meta.env.BASE_URL ?? '/'}game/thumbs/${THUMBS_DIR}/${thumbFile(model, hat)}`;
}

/** A boss's picture (200 × 200, transparent; scripts/game-kit.mjs bosses): the teacher's choice at the game's setup. */
export function bossPictureUrl(kind: BossKind): string {
  return `${import.meta.env.BASE_URL ?? '/'}game/boss/${BOSS_PICTURES[kind] ?? BOSS_PICTURES.clock}`;
}

/** Draws a loaded thumbnail onto a canvas with the clothes in the player's colour. */
export function paintThumb(canvas: HTMLCanvasElement, image: HTMLImageElement, colour: ColourId): void {
  const w = Math.floor(image.naturalWidth / 2);
  const h = image.naturalHeight;
  if (!w || !h) return;
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, w, h);
  g.drawImage(image, 0, 0, w, h, 0, 0, w, h);
  const tint = document.createElement('canvas');
  tint.width = w;
  tint.height = h;
  const t = tint.getContext('2d');
  if (!t) return;
  t.drawImage(image, w, 0, w, h, 0, 0, w, h);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = clothesHex(colour);
  t.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(tint, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(image, 0, 0, w, h, 0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}
