import { describe, expect, it } from 'vitest';
import cases from '../../../../../contracts/live/move_cases.json';
import { CommandClock, Predictor } from './predict';
import { mapFromJson, type MapJson } from './sim';

const ref = mapFromJson(cases.maps.ref as MapJson);
const wall = cases.cases.find((c) => c.name === 'slide along a wall')!;

function commands(jxy: number[][]) {
  return jxy.map(([jx, jy], i) => ({ seq: i + 1, jx, jy, buttons: 0 }));
}

describe('Predictor', () => {
  it('moves at once along the path the server computes', () => {
    const p = new Predictor(ref);
    p.reset(wall.start[0], wall.start[1]);
    commands(wall.cmds).forEach((c, i) => {
      p.apply(c, false);
      expect([p.x, p.y]).toEqual(wall.path[i]);
    });
  });

  it('replays the unacked commands from the server position and lands on the same spot', () => {
    const p = new Predictor(ref);
    p.reset(wall.start[0], wall.start[1]);
    const cmds = commands(wall.cmds);
    cmds.forEach((c) => p.apply(c, false));
    const end = [p.x, p.y];
    const k = 5; // the server has applied 5 of 12
    p.reconcile(k, wall.path[k - 1][0], wall.path[k - 1][1], false);
    expect([p.x, p.y]).toEqual(end);
    expect(p.unacked).toBe(cmds.length - k);
    expect(p.render(0)).toEqual({ x: end[0], y: end[1] });
    // From the wire's rounded position (0.1 unit) the replay ends within a rounding step.
    p.reconcile(k, Math.floor(wall.path[k - 1][0] * 10 + 0.5) / 10, Math.floor(wall.path[k - 1][1] * 10 + 0.5) / 10, false);
    expect(Math.hypot(p.x - end[0], p.y - end[1])).toBeLessThan(0.1);
  });

  it('fades a correction out instead of snapping, and snaps a teleport', () => {
    const p = new Predictor(ref);
    p.reset(800, 330);
    p.apply({ seq: 1, jx: 127, jy: 0, buttons: 0 }, false); // predicted 813
    p.render(0);
    p.reconcile(1, 800, 330, false); // the server did not move us (frozen there, say)
    expect(p.x).toBe(800);
    expect(p.render(0).x).toBeCloseTo(813);
    expect(p.render(100).x).toBeCloseTo(800 + 13 / Math.E);
    expect(p.render(1000).x).toBeCloseTo(800, 2);
    p.reconcile(1, 100, 100, false);
    expect(p.render(1010)).toEqual({ x: 100, y: 100 });
  });

  it('draws a command’s step over its tick: from where the command before left the character to where this one put it', () => {
    const p = new Predictor(ref);
    p.reset(800, 330);
    const go = (seq: number) => p.apply({ seq, jx: 127, jy: 0, buttons: 0 }, false);
    go(1); // 813
    expect(p.render(0, 0).x).toBeCloseTo(800);
    expect(p.render(25, 0.5).x).toBeCloseTo(806.5);
    expect(p.render(50, 1).x).toBeCloseTo(813);
    go(2); // 826: the next tick starts where the last one ended, no jump
    expect(p.render(50, 0).x).toBeCloseTo(813);
    expect(p.render(60, 0.2).x).toBeCloseTo(815.6);
    // a late frame owed two commands at once: the last one's step is drawn, the one before it is over
    go(3);
    go(4); // 852
    expect(p.render(160, 0).x).toBeCloseTo(839);
    expect(p.render(185, 0.5).x).toBeCloseTo(845.5);
    // without a share of the tick the character is where the prediction is (the stick rests, a test, the host)
    expect(p.render(200).x).toBeCloseTo(852);
  });

  it('keeps the drawn step whole through a correction, and shows a teleport at once', () => {
    const p = new Predictor(ref);
    p.reset(800, 330);
    p.apply({ seq: 1, jx: 127, jy: 0, buttons: 0 }, false);
    p.apply({ seq: 2, jx: 127, jy: 0, buttons: 0 }, false); // 826; the step drawn is 813 → 826
    expect(p.render(0, 0.5).x).toBeCloseTo(819.5);
    p.reconcile(1, 810, 330, false); // the server put command 1 three units short: replayed 823, the rest fades
    expect(p.render(0, 0.5).x).toBeCloseTo(819.5);
    p.reconcile(2, 100, 100, false); // a respawn
    expect(p.render(1, 0.5)).toEqual({ x: 100, y: 100 });
  });

  it('does not move while frozen, and replays nothing frozen', () => {
    const p = new Predictor(ref);
    p.reset(800, 330);
    p.apply({ seq: 1, jx: 127, jy: 0, buttons: 0 }, true);
    expect(p.x).toBe(800);
    p.apply({ seq: 2, jx: 127, jy: 0, buttons: 0 }, false);
    p.reconcile(0, 800, 330, true);
    expect(p.x).toBe(800);
  });
});

describe('CommandClock', () => {
  it('owes one command a tick and keeps the remainder', () => {
    const c = new CommandClock(50, 4);
    c.start(0);
    expect(c.due(49)).toBe(0);
    expect(c.due(66)).toBe(1);
    expect(c.due(133)).toBe(1); // 100 → 133: the 16 ms left over plus 33
    expect(c.due(150)).toBe(1);
    const sent = [200, 266, 333, 400, 466, 533, 600, 666, 733, 800, 866, 933, 1000].map((t) => c.due(t)).reduce((a, b) => a + b, 0);
    expect(sent).toBe(17); // 20 a second whatever the sending rhythm
  });

  it('says how far into the tick the time is', () => {
    const clock = new CommandClock(50);
    expect(clock.phase(10)).toBe(1); // not started: nothing to glide over
    clock.start(1000);
    expect(clock.phase(1000)).toBe(0);
    expect(clock.phase(1025)).toBeCloseTo(0.5);
    expect(clock.phase(1049)).toBeCloseTo(0.98);
    expect(clock.phase(1080)).toBe(1); // the tick is owed and not yet made: the step is over
    expect(clock.due(1080)).toBe(1);
    expect(clock.phase(1080)).toBeCloseTo(0.6);
  });

  it('drops the time of a long stall instead of a burst', () => {
    const c = new CommandClock(50, 4);
    c.start(0);
    expect(c.due(5000)).toBe(4);
    expect(c.due(5049)).toBe(0);
    expect(c.due(5050)).toBe(1);
  });
});
