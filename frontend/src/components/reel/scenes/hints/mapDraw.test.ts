import { describe, expect, it } from 'vitest';
import { cellBox, cellLook, drawCell, squaresToDraw } from './HintsSheet';
import { MOVE_MS, SECOND_AT, SHEET_AT, TOTAL_LINES, mapAt, type LineFrame } from './model';
import { seg } from '../../timeline';

/** The ring of question 12's squares at `l`, as MapCanvas has it. */
const ringAt = (l: number) => seg(l, SHEET_AT + 200, 300) * (1 - seg(l, SECOND_AT + MOVE_MS + 400, 400));
const looksAt = (l: number) => Float64Array.from(mapAt(l), cellLook);
/** The chapter's frames from the first drawing of the map (SHEET_AT − 200) to the scene's end, 60 a second. */
const FRAMES = Array.from({ length: Math.ceil((8000 - (SHEET_AT - 200)) / 16.7) }, (_, k) => SHEET_AT - 200 + k * 16.7);

/** Where a square's drawing reaches: the corners of its paths, and half a line's width around a stroke. */
function reachOf(i: number, frame: LineFrame, ring: number) {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let points: Array<[number, number]> = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    beginPath: () => {
      points = [];
    },
    moveTo: (x: number, y: number) => points.push([x, y]),
    arcTo: (x1: number, y1: number, x2: number, y2: number) => points.push([x1, y1], [x2, y2]),
    closePath: () => undefined,
    fill: () => grow(0),
    stroke: () => grow(ctx.lineWidth / 2),
  };
  function grow(pad: number) {
    for (const [x, y] of points) {
      r.x0 = Math.min(r.x0, x - pad);
      r.y0 = Math.min(r.y0, y - pad);
      r.x1 = Math.max(r.x1, x + pad);
      r.y1 = Math.max(r.y1, y + pad);
    }
  }
  drawCell(ctx as unknown as CanvasRenderingContext2D, i, frame, ring);
  return r;
}

describe('the cheat sheet’s map draws only what changed', () => {
  it('a square never paints outside its area, in any state of the chapter (with antialiasing: whole pixels)', () => {
    for (const l of FRAMES.filter((_, k) => k % 3 === 0)) {
      const frames = mapAt(l);
      const ring = ringAt(l);
      frames.forEach((frame, i) => {
        const reach = reachOf(i, frame, ring);
        const box = cellBox(i);
        expect(Math.floor(reach.x0), `square ${i} at ${l}`).toBeGreaterThanOrEqual(box.x);
        expect(Math.floor(reach.y0)).toBeGreaterThanOrEqual(box.y);
        expect(Math.ceil(reach.x1)).toBeLessThanOrEqual(box.x + box.w);
        expect(Math.ceil(reach.y1)).toBeLessThanOrEqual(box.y + box.h);
      });
    }
  });

  it('draws again every changed square and every square reaching into one, so the canvas ends as a whole redraw', () => {
    let before: Float64Array | null = null;
    let ringBefore = 0;
    let partial = 0;
    let drawn = 0;
    for (const l of FRAMES) {
      const looks = looksAt(l);
      const ring = ringAt(l);
      const plan = squaresToDraw(looks, before, ring, ringBefore);
      if (plan) {
        partial += 1;
        drawn += plan.draw.length;
        const changed = new Set(plan.changed);
        const draw = new Set(plan.draw);
        for (let i = 0; i < looks.length; i += 1) {
          const moved = looks[i] !== before![i] || (ring !== ringBefore && cellBox(i).w > 10);
          expect(changed.has(i), `square ${i} at ${l}`).toBe(moved);
        }
        for (const i of changed) {
          const box = cellBox(i);
          for (let j = 0; j < looks.length; j += 1) {
            const other = cellBox(j);
            const meets = other.x < box.x + box.w && box.x < other.x + other.w && other.y < box.y + box.h && box.y < other.y + other.h;
            if (meets) expect(draw.has(j), `square ${j} reaches into ${i} at ${l}`).toBe(true);
          }
        }
        expect(plan.draw).toEqual([...plan.draw].sort((a, b) => a - b));
      }
      before = looks;
      ringBefore = ring;
    }
    // Most frames draw a few squares of the 898, not all of them.
    expect(partial).toBeGreaterThan(FRAMES.length * 0.8);
    expect(drawn / partial).toBeLessThan(TOTAL_LINES / 20);
  });

  it('a frame where nothing moves draws nothing', () => {
    const l = SHEET_AT + 1100;
    const plan = squaresToDraw(looksAt(l), looksAt(l), ringAt(l), ringAt(l));
    expect(plan).toEqual({ changed: [], draw: [] });
  });

  it('the first frame draws the whole map', () => {
    expect(squaresToDraw(looksAt(SHEET_AT), null, 0, 0)).toBeNull();
  });
});
