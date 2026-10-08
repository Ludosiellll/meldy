/**
 * The camera over the sheet: it looks at a point of the paper that travels from station to station
 * (eased pans, holds in between) and pushes in a little, slowly, about the frame's centre. A pure
 * function of the reel time: a sought or exported frame shows the same camera as the playing one.
 */
import { keyed } from '../../film/kit';
import { CUT, STAGE_H, STAGE_W, clamp } from '../timeline';
import { CAMERA_KEYS, PUSH_IN } from './layout';

export interface Camera {
  /** Translation of the sheet (px). */
  x: number;
  y: number;
  /** Scale of the sheet about the sheet's own origin. */
  scale: number;
}

export function cameraAt(t: number): Camera {
  const centre = keyed(t, CAMERA_KEYS);
  const scale = 1 + PUSH_IN * clamp(t / CUT);
  return { x: STAGE_W / 2 - scale * centre, y: (STAGE_H / 2) * (1 - scale), scale };
}
