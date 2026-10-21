import { describe, expect, it } from 'vitest';
import {
  COLLAPSE,
  dropHeight,
  dropStart,
  impactOf,
  layoutTiles,
  planCollapse,
  riseHeight,
  shakeAmount,
  floorRect,
  stageOf,
  tileIndexAt,
  zoneAt,
  type ArenaShape,
  type MoveMap,
} from './arenaPlan';
import { STAND_ARENA } from '../move/protocol';
import arenaJson from '../../../../../contracts/live/stand_arena.json';

const MAP: MoveMap = {
  w: 1600,
  h: 900,
  zones: [
    { id: 'A', rect: [100, 100, 600, 300] },
    { id: 'B', rect: [900, 100, 600, 300] },
    { id: 'C', rect: [100, 500, 600, 300] },
    { id: 'D', rect: [900, 500, 600, 300] },
  ],
};

describe('the floor laid on the map', () => {
  it('cuts the 1600 × 900 map into 16 × 9 tiles of 100 units', () => {
    const l = layoutTiles(MAP);
    expect([l.cols, l.rows, l.sx, l.sy, l.tiles.length]).toEqual([16, 9, 100, 100, 144]);
    expect(l.tiles[0]).toMatchObject({ col: 0, row: 0, x: 50, y: 50, zone: -1 });
  });

  it('colours a tile by the zone holding its centre (the first one, as the server counts)', () => {
    const l = layoutTiles(MAP);
    const count = (z: number) => l.tiles.filter((t) => t.zone === z).length;
    expect([count(0), count(1), count(2), count(3)]).toEqual([18, 18, 18, 18]);
    expect(zoneAt(MAP, 150, 150)).toBe(0);
    expect(zoneAt(MAP, 800, 450)).toBe(-1);
    const overlap: MoveMap = { w: 400, h: 400, zones: [{ id: 'X', rect: [0, 0, 300, 300] }, { id: 'Y', rect: [100, 100, 300, 300] }] };
    expect(zoneAt(overlap, 200, 200)).toBe(0);
  });

  it('finds the tile under a point, and none off the floor', () => {
    const l = layoutTiles(MAP);
    expect(tileIndexAt(l, 0, 0)).toBe(0);
    expect(tileIndexAt(l, 1599, 899)).toBe(143);
    expect(tileIndexAt(l, 250, 120)).toBe(1 * 16 + 2);
    expect(tileIndexAt(l, -1, 10)).toBe(-1);
    expect(tileIndexAt(l, 10, 900)).toBe(-1);
  });

  it('keeps any map size whole: odd sizes give tiles near 100 units', () => {
    const l = layoutTiles({ w: 1250, h: 610 });
    expect(l.cols * l.sx).toBeCloseTo(1250);
    expect(l.rows * l.sy).toBeCloseTo(610);
    expect(l.sx).toBeGreaterThan(80);
    expect(l.sx).toBeLessThan(125);
  });

  it('puts the stage and the impact above the far edge, in the middle', () => {
    expect(stageOf(MAP)).toEqual({ x: 800, y: -160 });
    expect(impactOf(MAP)).toEqual({ x: 800, y: -25 });
  });
});

describe('the collapse', () => {
  it('drops every tile but the right zone’s, from 0.12 s after the impact', () => {
    const l = layoutTiles(MAP);
    const t0 = planCollapse(MAP, l, 'A', 10);
    l.tiles.forEach((t, i) => {
      if (t.zone === 0) expect(t0[i]).toBe(Infinity);
      else {
        expect(t0[i]).toBeGreaterThanOrEqual(10 + COLLAPSE.lead);
        expect(t0[i]).toBeLessThan(10 + COLLAPSE.lead + 2000 * COLLAPSE.perUnit + COLLAPSE.jitter);
      }
    });
  });

  it('drops the whole floor for a zone id the map does not have', () => {
    const l = layoutTiles(MAP);
    const t0 = planCollapse(MAP, l, 'Z', 0);
    expect([...t0].every((t) => Number.isFinite(t))).toBe(true);
  });

  it('runs as a ripple: farther from the stage, later (without the jitter)', () => {
    const imp = impactOf(MAP);
    const near = dropStart(800, 50, imp, 0, 0);
    const mid = dropStart(800, 450, imp, 0, 0);
    const far = dropStart(50, 850, imp, 0, 0);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    expect(mid - near).toBeCloseTo(400 * COLLAPSE.perUnit);
    // the whole 1600 × 900 floor is gone in about a second and a half
    expect(far).toBeLessThan(1.5);
  });

  it('is the same on every screen for the same seed, and differs for another', () => {
    const l = layoutTiles(MAP);
    expect([...planCollapse(MAP, l, 'B', 3, 7)]).toEqual([...planCollapse(MAP, l, 'B', 3, 7)]);
    expect([...planCollapse(MAP, l, 'B', 3, 7)]).not.toEqual([...planCollapse(MAP, l, 'B', 3, 8)]);
  });

  it('shakes a tile for 0.3 s, then drops it with gravity until out of sight', () => {
    expect(shakeAmount(9.6, 10)).toBe(0);
    expect(shakeAmount(9.85, 10)).toBeCloseTo(0.5);
    expect(shakeAmount(10.1, 10)).toBe(0);
    expect(dropHeight(9.9, 10)).toBe(0);
    expect(dropHeight(10, 10)).toBe(0);
    expect(dropHeight(10.5, 10)).toBeCloseTo(-0.5 * COLLAPSE.gravity * 0.25);
    expect(dropHeight(20, 10)).toBe(COLLAPSE.gone);
    expect(dropHeight(5, Infinity)).toBe(0);
  });

  it('brings a tile back up with a small bump at the end', () => {
    expect(riseHeight(1, 2, -650)).toBe(-650);
    expect(riseHeight(2 + COLLAPSE.rise, 2, -650)).toBeCloseTo(0);
    let over = false;
    for (let t = 2; t <= 2 + COLLAPSE.rise; t += 0.01) if (riseHeight(t, 2, -650) > 0) over = true;
    expect(over).toBe(true);
  });
});

describe('mode A on the map the server sends (contracts/live/stand_arena.json)', () => {
  const map = STAND_ARENA as MoveMap;
  const shape: ArenaShape = { floor: arenaJson.floor, stage: arenaJson.stage };

  it('lays the grid of the server: 26 × 12 tiles of 60 from (20, 160), each zone exactly 10 × 4 tiles', () => {
    const l = layoutTiles(map, 100, shape);
    expect([l.cols, l.rows, l.sx, l.sy, l.x0, l.y0, l.tiles.length]).toEqual([26, 12, 60, 60, 20, 160, 312]);
    const count = (z: number) => l.tiles.filter((t) => t.zone === z).length;
    expect([count(0), count(1), count(2), count(3)]).toEqual([40, 40, 40, 40]);
    expect(floorRect(map, shape)).toEqual({ x: 20, y: 160, w: 1560, h: 720 });
    // the floor is exactly the space between the map's walls
    expect(tileIndexAt(l, 19, 500)).toBe(-1);
    expect(tileIndexAt(l, 20, 160)).toBe(0);
    expect(tileIndexAt(l, 1579, 879)).toBe(311);
  });

  it('puts the boss on the stage in the middle; the tiles under it are never drawn and never drop', () => {
    expect(stageOf(map, shape)).toEqual({ x: 800, y: 520 });
    expect(impactOf(map, shape)).toEqual({ x: 800, y: 520 });
    const l = layoutTiles(map, 100, shape);
    const under = l.tiles.filter((t) => t.under);
    expect(under.map((t) => [t.col, t.row])).toEqual([[12, 5], [13, 5], [12, 6], [13, 6]]);
    const t0 = planCollapse(map, l, 'Б', 5, 3, undefined, impactOf(map, shape));
    l.tiles.forEach((t, i) => {
      if (t.under || t.zone === 1) expect(t0[i]).toBe(Infinity);
      else expect(t0[i]).toBeGreaterThan(5);
    });
  });

  it('ripples out from the stage: the tiles next to it go first', () => {
    const l = layoutTiles(map, 100, shape);
    const t0 = planCollapse(map, l, 'А', 0, 1, undefined, impactOf(map, shape));
    const near = t0[tileIndexAt(l, 900, 520)];
    const far = t0[tileIndexAt(l, 1550, 860)];
    expect(near).toBeLessThan(far);
  });
});
