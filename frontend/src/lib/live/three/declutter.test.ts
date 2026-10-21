import { describe, expect, it } from 'vitest';
import { declutter, type DeclutterBuffers } from './declutter';

type Box = [number, number, number, number, number];

function buffers(boxes: Box[], hidden: number[] = []): DeclutterBuffers {
  const n = boxes.length;
  const b: DeclutterBuffers = {
    x0: new Float32Array(n),
    x1: new Float32Array(n),
    y0: new Float32Array(n),
    y1: new Float32Array(n),
    rank: new Float32Array(n),
    order: new Int32Array(n),
    placed: new Int32Array(n),
    hidden: new Uint8Array(n),
  };
  boxes.forEach(([x0, x1, y0, y1, rank], i) => {
    b.x0[i] = x0;
    b.x1[i] = x1;
    b.y0[i] = y0;
    b.y1[i] = y1;
    b.rank[i] = rank;
    b.hidden[i] = hidden.includes(i) ? 1 : 0;
  });
  return b;
}

describe('name tags in a crowd', () => {
  it('leaves out a tag that would cover one placed before it; the earlier rank wins', () => {
    const b = buffers([
      [0, 100, 0, 30, 2],
      [50, 150, 10, 40, 1],
      [300, 400, 0, 30, 3],
    ]);
    expect(declutter(3, b)).toBe(2);
    expect([...b.hidden]).toEqual([1, 0, 0]);
  });

  it('tags that only touch both stay', () => {
    const b = buffers([
      [0, 100, 0, 30, 0],
      [100, 200, 0, 30, 1],
      [0, 100, 30, 60, 2],
    ]);
    expect(declutter(3, b)).toBe(3);
  });

  it('a tag that cannot be shown blocks nothing', () => {
    const b = buffers(
      [
        [0, 100, 0, 30, 0],
        [10, 90, 5, 25, 1],
      ],
      [0],
    );
    expect(declutter(2, b)).toBe(1);
    expect([...b.hidden]).toEqual([1, 0]);
  });

  it('never leaves two shown tags overlapping, whatever the crowd', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const boxes: Box[] = Array.from({ length: 40 }, () => {
      const x = rnd() * 600;
      const y = rnd() * 300;
      return [x, x + 80 + rnd() * 60, y, y + 24, rnd()];
    });
    const b = buffers(boxes);
    declutter(40, b);
    const shown = boxes.filter((_, i) => !b.hidden[i]);
    for (const a of shown) for (const c of shown) if (a !== c) expect(a[0] < c[1] && a[1] > c[0] && a[2] < c[3] && a[3] > c[2]).toBe(false);
    expect(shown.length).toBeGreaterThan(5);
  });
});
