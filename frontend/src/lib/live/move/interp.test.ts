import { describe, expect, it } from 'vitest';
import { ServerClock, SnapshotBuffer } from './interp';
import type { Snapshot } from './protocol';

const snap = (tick: number, ents: Array<[number, number, number]>, flags = 0): Snapshot => ({
  tick,
  t: tick * 50,
  ack: 0,
  ents: ents.map(([id, x, y]) => ({ id, x, y, flags })),
});

describe('SnapshotBuffer', () => {
  it('interpolates between the two snapshots around the moment', () => {
    const b = new SnapshotBuffer();
    b.push(snap(2, [[1, 100, 100]]));
    b.push(snap(4, [[1, 120, 140]]));
    expect(b.sample(150).get(1)).toEqual({ x: 110, y: 120, flags: 0 });
    expect(b.sample(100).get(1)).toEqual({ x: 100, y: 100, flags: 0 });
    expect(b.sample(50).get(1)).toEqual({ x: 100, y: 100, flags: 0 }); // before the first: held
  });

  it('carries on past the newest for at most 100 ms, then holds', () => {
    const b = new SnapshotBuffer();
    b.push(snap(2, [[1, 100, 100]]));
    b.push(snap(4, [[1, 120, 100]]));
    expect(b.sample(250).get(1)!.x).toBeCloseTo(130);
    expect(b.sample(900).get(1)!.x).toBeCloseTo(140);
  });

  it('ignores old ticks, drops the departed, shows the new at once', () => {
    const b = new SnapshotBuffer();
    b.push(snap(2, [[1, 100, 100], [2, 500, 500]]));
    b.push(snap(4, [[1, 120, 100], [3, 700, 700]]));
    b.push(snap(3, [[1, 999, 999]]));
    const at = b.sample(150);
    expect([...at.keys()].sort()).toEqual([1, 3]);
    expect(at.get(3)).toEqual({ x: 700, y: 700, flags: 0 });
    expect(at.get(1)!.x).toBe(110);
  });

  it('does not slide a teleport across the map', () => {
    const b = new SnapshotBuffer();
    b.push(snap(2, [[1, 100, 100]]));
    b.push(snap(4, [[1, 1500, 800]]));
    expect(b.sample(120).get(1)).toEqual({ x: 100, y: 100, flags: 0 });
    expect(b.sample(180).get(1)).toEqual({ x: 1500, y: 800, flags: 0 });
  });

  it('finds the right pair in a long buffer and keeps at most `size`', () => {
    const b = new SnapshotBuffer({ size: 5 });
    for (let k = 1; k <= 10; k++) b.push(snap(2 * k, [[1, 10 * k, 0]]));
    expect(b.sample(750).get(1)!.x).toBeCloseTo(75);
    expect(b.sample(350).get(1)!.x).toBe(60); // the oldest kept is tick 12 (t = 600)
  });
});

describe('ServerClock', () => {
  it('takes the least delayed snapshot and moves slowly towards it', () => {
    const c = new ServerClock(20, 4, 500);
    expect(c.now(0)).toBeNull();
    c.sample(1000, 900); // offset 100 (its delay is in it)
    expect(c.now(0)).toBe(100);
    c.sample(1100, 980); // a faster one: offset 120 — approached by 4 ms a snapshot
    expect(c.now(0)).toBe(104);
    c.sample(1200, 1100); // slower: the best of the window stays 120
    expect(c.now(0)).toBe(108);
  });

  it('jumps when far off (a tab woken from sleep)', () => {
    const c = new ServerClock(3, 4, 500);
    c.sample(1000, 900);
    c.sample(1050, 950);
    c.sample(1100, 1000);
    c.sample(5000, 2000); // the window now holds 3000 as its best
    expect(c.now(0)).toBe(3000);
  });
});
