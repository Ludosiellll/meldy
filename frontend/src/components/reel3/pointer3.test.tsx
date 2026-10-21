import { describe, expect, it } from 'vitest';
import { POINTER, Pointer, boxIn, carry, keyPoint, moveTime, planPointer, pointerAt, pressAt, type Box, type CursorKey } from './pointer3';

const BOXES: Record<string, Box> = {
  a: { x: 20, y: 40, w: 100, h: 30 },
  b: { x: 260, y: 220, w: 80, h: 24 },
  handle: { x: 10, y: 100, w: 120, h: 26 },
  slot: { x: 160, y: 140, w: 200, h: 34 },
  page: { x: 150, y: 40, w: 230, h: 300 },
};
const resolve = (aim: string) => BOXES[aim];

describe('the pointer key resolver', () => {
  it('aims at a target’s centre, at a share of its box, and beside it', () => {
    expect(keyPoint({ t: 0, aim: 'a' }, BOXES.a)).toEqual({ x: 70, y: 55 });
    expect(keyPoint({ t: 0, aim: 'a', fx: 0.2, fy: 1 }, BOXES.a)).toEqual({ x: 40, y: 70 });
    expect(keyPoint({ t: 0, aim: 'a', fx: 1, dx: 30, dy: -190 }, BOXES.a)).toEqual({ x: 150, y: -135 });
    expect(keyPoint({ t: 0, x: 12, y: 34 }, null)).toEqual({ x: 12, y: 34 });
    expect(keyPoint({ t: 0, aim: 'gone' }, undefined)).toBeNull();
  });

  it('reads a box from the layout: offsets up to the UI box, its borders counted, transforms and scale left out', () => {
    const ui = document.createElement('div');
    const card = document.createElement('div');
    const button = document.createElement('span');
    ui.append(card);
    card.append(button);
    const layout = (el: HTMLElement, values: Record<string, unknown>) => {
      for (const [name, value] of Object.entries(values)) Object.defineProperty(el, name, { configurable: true, get: () => value });
    };
    layout(card, { offsetLeft: 40, offsetTop: 100, offsetParent: ui, clientLeft: 2, clientTop: 2 });
    layout(button, { offsetLeft: 16, offsetTop: 60, offsetParent: card, offsetWidth: 82, offsetHeight: 24 });
    // A transform on the way (a card rising in, a press) changes none of it.
    card.style.transform = 'translate(0px, 18px) scale(1.8)';
    expect(boxIn(button, ui)).toEqual({ x: 58, y: 162, w: 82, h: 24 });
  });

  it('falls back to the rects, the UI box’s scale divided out, for an element off the offset chain', () => {
    const ui = document.createElement('div');
    const svg = document.createElement('div');
    Object.defineProperty(ui, 'offsetWidth', { configurable: true, get: () => 380 });
    ui.getBoundingClientRect = () => ({ left: 100, top: 50, width: 380 * 0.9, height: 340 * 0.9 }) as DOMRect;
    svg.getBoundingClientRect = () => ({ left: 100 + 90, top: 50 + 45, width: 18, height: 9 }) as DOMRect;
    const box = boxIn(svg, ui);
    expect(box.x).toBeCloseTo(100);
    expect(box.y).toBeCloseTo(50);
    expect(box.w).toBeCloseTo(20);
    expect(box.h).toBeCloseTo(10);
  });

  it('gives the moment of a press, a grab or a drop by its target', () => {
    const keys: CursorKey[] = [
      { t: 100, aim: 'a' },
      { t: 900, aim: 'b', press: true },
      { t: 1500, aim: 'handle', down: true },
      { t: 2400, aim: 'handle', up: true },
    ];
    expect(pressAt(keys, 'b')).toBe(900);
    expect(pressAt(keys, 'handle', 1)).toBe(2400);
    expect(() => pressAt(keys, 'a')).toThrow();
  });
});

describe('the pointer’s plan', () => {
  const keys: CursorKey[] = [
    { t: 200, aim: 'a', fx: 0.9, fy: 2 },
    { t: 1200, aim: 'b', press: true },
    { t: 2000, aim: 'a', press: true },
    { t: 2800, hide: true },
    { t: 4200, aim: 'b', press: true },
  ];
  const plan = planPointer(keys, resolve);

  it('is on the target from a beat before the press until the hand goes on, the dip at the press', () => {
    for (const l of [1200 - POINTER.settle, 1100, 1200, 1200 + POINTER.after - 1]) {
      const state = pointerAt(plan, l);
      expect(state.x, String(l)).toBeCloseTo(300);
      expect(state.y, String(l)).toBeCloseTo(232);
    }
    expect(pointerAt(plan, 1199).scale).toBe(1);
    expect(pointerAt(plan, 1200 + POINTER.press / 2).scale).toBeCloseTo(0.84);
    expect(pointerAt(plan, 1200 + POINTER.press).scale).toBeCloseTo(1);
  });

  it('takes the time Fitts’s law gives: longer for a longer way and a smaller target', () => {
    expect(moveTime(300, 24)).toBeGreaterThan(moveTime(100, 24));
    expect(moveTime(100, 12)).toBeGreaterThan(moveTime(100, 60));
    expect(moveTime(100, 24, true)).toBeGreaterThan(moveTime(100, 24));
    const first = plan.moves[0];
    expect(first.end).toBe(1200 - POINTER.settle);
    expect(first.end - first.start).toBe(first.natural);
  });

  it('never jumps: it moves on a slight arc, a little at a time', () => {
    let last = pointerAt(plan, 0);
    let worst = 0;
    for (let l = 1; l < 5000; l += 1) {
      const state = pointerAt(plan, l);
      worst = Math.max(worst, Math.hypot(state.x - last.x, state.y - last.y));
      last = state;
    }
    // 280 px in about half a second: no step of a millisecond near a tenth of the way.
    expect(worst).toBeLessThan(2.5);
    const move = plan.moves[1];
    const middle = pointerAt(plan, (move.start + move.end) / 2);
    const straight = { x: (move.from.x + move.to.x) / 2, y: (move.from.y + move.to.y) / 2 };
    expect(Math.hypot(middle.x - straight.x, middle.y - straight.y)).toBeGreaterThan(2);
  });

  it('fades out where it is and comes back there before it moves on', () => {
    expect(pointerAt(plan, 150).opacity).toBeGreaterThan(0);
    expect(pointerAt(plan, 1000).opacity).toBe(1);
    expect(pointerAt(plan, 2800).opacity).toBe(0);
    const back = plan.moves[plan.moves.length - 1];
    expect(pointerAt(plan, back.start - POINTER.fade - 1).opacity).toBe(0);
    expect(pointerAt(plan, back.start).opacity).toBe(1);
    const hidden = pointerAt(plan, 3000);
    const shown = pointerAt(plan, back.start);
    expect(shown.x).toBeCloseTo(hidden.x);
    expect(shown.y).toBeCloseTo(hidden.y);
    expect(pointerAt(plan, 4200).opacity).toBe(1);
  });

  it('refuses keys out of time order', () => {
    expect(() => new Pointer([{ t: 500, x: 0, y: 0 }, { t: 100, x: 1, y: 1 }])).toThrow();
  });
});

describe('a drag', () => {
  const keys: CursorKey[] = [
    { t: 100, x: 60, y: 300 },
    { t: 900, aim: 'handle', fx: 0.75, down: true },
    { t: 1700, aim: 'slot', fx: 0.66, up: true, over: 'page' },
    { t: 2600, hide: true },
  ];

  function mounted() {
    const ui = document.createElement('div');
    for (const [aim, box] of Object.entries(BOXES)) {
      const el = document.createElement('span');
      el.dataset.aim = aim;
      for (const [name, value] of Object.entries({ offsetLeft: box.x, offsetTop: box.y, offsetWidth: box.w, offsetHeight: box.h, offsetParent: ui }))
        Object.defineProperty(el, name, { configurable: true, get: () => value });
      ui.append(el);
    }
    const pointer = new Pointer(keys);
    pointer.measure(ui);
    return { ui, pointer, el: (aim: string) => ui.querySelector<HTMLElement>(`[data-aim="${aim}"]`)! };
  }

  it('holds the button from the grab to the drop, the drop target lit only while the held pointer is over it', () => {
    const { pointer, el } = mounted();
    expect(pointer.plan.drags).toHaveLength(1);
    expect(pointer.at(899).held).toBe(false);
    expect(pointer.at(1300).held).toBe(true);
    expect(pointer.dragAt(1300)).toBe(0);
    pointer.flags(900 - 60);
    expect(el('handle').classList.contains('is-hover')).toBe(true);
    pointer.flags(1000);
    expect(el('handle').classList.contains('is-grabbed')).toBe(true);
    expect(el('handle').classList.contains('is-hover')).toBe(false);
    pointer.flags(1600);
    expect(el('page').classList.contains('is-over')).toBe(true);
    pointer.flags(1700);
    expect(el('page').classList.contains('is-over')).toBe(false);
    expect(el('handle').classList.contains('is-grabbed')).toBe(false);
  });

  it('carries the block with the same point of it under the tip all the way, then settles it in its place', () => {
    const { pointer } = mounted();
    const ghost = document.createElement('span');
    const handle = BOXES.handle;
    const grab = { x: handle.w * 0.75, y: handle.h * 0.5 };
    const settle = { x: BOXES.slot.x, y: BOXES.slot.y };
    const corner = (l: number) => {
      carry(ghost, pointer, l, 0, { grab, settle });
      const m = /translate\(([-\d.]+)px,([-\d.]+)px\)(?: scale\(([\d.]+)\))?/.exec(ghost.style.transform)!;
      return { x: Number(m[1]), y: Number(m[2]), s: Number(m[3] ?? 1) };
    };
    // Lifted off the handle exactly where it lay.
    expect(corner(900)).toEqual({ x: handle.x, y: handle.y, s: 1 });
    for (const l of [1100, 1300, 1500, 1690]) {
      const at = pointer.at(l);
      const c = corner(l);
      expect(c.x + grab.x * c.s, String(l)).toBeCloseTo(at.x, 1);
      expect(c.y + grab.y * c.s, String(l)).toBeCloseTo(at.y, 1);
      expect(ghost.style.opacity).toBe('1');
    }
    const done = corner(1700 + 400);
    expect(done.x).toBeCloseTo(settle.x);
    expect(done.y).toBeCloseTo(settle.y);
    expect(ghost.style.opacity).toBe('0');
  });
});
