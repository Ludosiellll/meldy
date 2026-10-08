/**
 * The sheet's geometry in sheet pixels (the stage is 1920 × 1080; the sheet is 6400 wide). Every block
 * of the film has one place on the paper; the camera moves along it (camera.ts). Nothing here moves.
 */
import { STAGE_H, STAGE_W, CUT } from '../timeline';

export const SHEET_W = 6400;
export const SHEET_H = STAGE_H;

/** The department's list: the heading, then one row per question. */
export const LIST = { x: 150, titleY: 300, rowY0: 392, pitch: 54 };

/**
 * The focus column: the question of the ticket, its four points written under it, the lecture slip and
 * the ticket beside them, the answer typed below. The camera visits it from the lectures to the days.
 */
export const CLUSTER = {
  x: 2110,
  focusY: 330,
  dates: { x: 2880, y: 318 },
  points: { x: 2140, y0: 420, pitch: 92 },
  slip: { x: 3180, y: 300, w: 700 },
  lead: { x: 3180, y: 640 },
  ticket: { x: 3180, y: 712, w: 660 },
  count: { x: 3180, y: 892 },
  /** The answer: its head (the speaker, the voice wave) and its words, under the points. */
  talk: { x: 2110, y: 800, w: 1050 },
};

/** The copy: the sheet a classmate receives, the group's label and the day's question with the reminder. */
export const COPY = {
  x: 4300,
  y: 300,
  label: { x: 4300, y: 900 },
  day: { x: 5330, y: 300, w: 560 },
  remind: { x: 5330, y: 560 },
};

/**
 * The focus column (x 2110–3880) is centred here: even at the push-in's end the frame spans x 2086–3914, so
 * the points, the answer, the lecture slip and the ticket stay whole from the lectures to the days.
 */
const FOCUS_X = 3000;

/** The camera's stations along the sheet (the centre it looks at), by the reel's time. */
export const CAMERA_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, STAGE_W / 2],
  [6900, STAGE_W / 2],
  [8700, FOCUS_X],
  [12000, FOCUS_X],
  [13800, FOCUS_X],
  [18000, FOCUS_X],
  [19800, FOCUS_X],
  [34000, FOCUS_X],
  [35800, FOCUS_X],
  [40600, FOCUS_X],
  [42900, 5000],
  [CUT, 5000],
];

/** The push-in over the whole sheet: a few per cent, slow and steady. */
export const PUSH_IN = 0.05;
