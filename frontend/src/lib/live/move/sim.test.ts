import { describe, expect, it } from 'vitest';
import cases from '../../../../../contracts/live/move_cases.json';
import { applyCommand, axisVector, mapFromJson, moveCircle, toAxes, zoneAt, type MapJson } from './sim';

const rules = { tickHz: cases.tick_hz, speed: cases.speed, r: cases.r };
const maps = Object.fromEntries(Object.entries(cases.maps).map(([k, v]) => [k, mapFromJson(v as MapJson)]));

describe('the shared cases (contracts/live/move_cases.json: the server computes the same doubles)', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      let x = c.start[0];
      let y = c.start[1];
      c.cmds.forEach(([jx, jy], i) => {
        [x, y] = applyCommand(maps[c.map], x, y, jx, jy, rules);
        expect([x, y]).toEqual(c.path[i]);
        expect([Math.floor(x * cases.q + 0.5), Math.floor(y * cases.q + 0.5)]).toEqual(c.wire[i]);
      });
    });
  }
});

describe('movement', () => {
  const open = mapFromJson({ w: 1600, h: 900, solids: [], zones: [], spawns: [[800, 450]], npc_spawns: [] });

  it('keeps the joystick no longer than 1', () => {
    const [vx, vy] = axisVector(127, 127);
    expect(Math.hypot(vx, vy)).toBeCloseTo(1, 12);
    expect(axisVector(-128, 0)).toEqual([-1, 0]);
  });

  it('a still stick does not move or push', () => {
    const boxed = mapFromJson({ w: 1600, h: 900, solids: [{ rect: [790, 440, 20, 20] }], zones: [], spawns: [], npc_spawns: [] });
    expect(applyCommand(boxed, 800, 450, 0, 0)).toEqual([800, 450]);
    expect(moveCircle(open, 5, 5, 0, 0, 18)).toEqual([18, 18]);
  });

  it('turns a stick into signed bytes with a dead zone', () => {
    expect(toAxes(0.05, -0.05)).toEqual([0, 0]);
    expect(toAxes(1, -1)).toEqual([127, -127]);
    expect(toAxes(2, Number.NaN)).toEqual([127, 0]);
    expect(toAxes(0.5, 0)).toEqual([64, 0]);
  });

  it('finds the zone a point is in', () => {
    const ref = maps.ref;
    expect(zoneAt(ref, 50, 50)).toBe('A');
    expect(zoneAt(ref, 1550, 850)).toBe('D');
    expect(zoneAt(ref, 800, 300)).toBeNull();
  });
});
