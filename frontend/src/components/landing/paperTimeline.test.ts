import { describe, expect, it } from 'vitest';
import {
  APPEAR,
  FLIP_SETTLE,
  IDLE,
  LEAN,
  SKIP_RATE,
  SPRING,
  START_AT,
  buildGeometry,
  buildTimeline,
  cardFace,
  minJerk,
  rotatePoint,
  sceneAt,
  skipFrom,
  slipHome,
  spring,
  stepStills,
  underlineProgress,
  type MeasuredText,
  type PaperGeometry,
  type SceneState,
  type Timeline,
} from './paperTimeline';

/** Key sentence as measured at 1440 px (two lines, the comma on the first). */
const DESKTOP_TEXT: MeasuredText = {
  lines: [
    { x0: 82, x1: 435, baseline: 263, top: 243, text: 'Спрос эластичен, если объём покупок' },
    { x0: 58, x1: 274, baseline: 290, top: 270, text: 'меняется сильнее, чем цена.' },
  ],
  commaLine: 0,
  commaRight: 222,
  fs: 17,
  paraLeft: 58,
};

const PHONE_TEXT: MeasuredText = {
  lines: [
    { x0: 40, x1: 300, baseline: 149, top: 132, text: 'Спрос эластичен, если объём' },
    { x0: 20, x1: 250, baseline: 172, top: 155, text: 'покупок меняется сильнее, чем цена.' },
  ],
  commaLine: 0,
  commaRight: 160,
  fs: 14.5,
  paraLeft: 20,
};

const desktop = buildGeometry(DESKTOP_TEXT, { variant: 'desktop', pageH: 539, dpr: 2 });
const compact = buildGeometry(DESKTOP_TEXT, { variant: 'compact', pageH: 539, dpr: 2 });
const phone = buildGeometry(PHONE_TEXT, { variant: 'phone', pageH: 250, dpr: 3 });
const W = buildTimeline(desktop);
const WC = buildTimeline(compact);
const WP = buildTimeline(phone);
const ALL: Array<[string, PaperGeometry, Timeline]> = [['desktop', desktop, W], ['compact', compact, WC], ['phone', phone, WP]];

function times(from: number, to: number, step = 0.001) {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
}

/** The slip's centre in canvas coordinates: its card-space position through the card's transform. */
function slipOnCanvas(g: PaperGeometry, s: SceneState) {
  const p = rotatePoint((s.strip.x - g.card.w / 2) * s.card.scale, (s.strip.y - g.card.h / 2) * s.card.scale, s.card.rot);
  return { x: g.card.cx + p.x, y: g.card.cy + p.y };
}

const pasteSpot = (g: PaperGeometry) => ({ x: g.card.w / 2 + g.paste.dx, y: g.card.h / 2 + g.paste.dy });

describe('paper hero geometry', () => {
  it('cuts the slip around the key sentence and its underline', () => {
    expect(desktop.rect).toEqual({ x: 49, y: 241, w: 397, h: 59 });
    expect(phone.rect.x).toBe(13);
    expect(phone.rect.w).toBe(296);
  });

  it('places the top card off the page corner and sizes the canvas to it', () => {
    expect(desktop.card).toMatchObject({ cx: 528, cy: 479, w: 456, h: 274, rot: 2.4 });
    expect(desktop.canvas.w).toBe(760);
    expect(desktop.canvas.h).toBe(Math.ceil(479 + 137 + Math.sin((2.4 * Math.PI) / 180) * 228 + 10));
    expect(phone.card).toMatchObject({ cx: 197, w: 312, h: 187, rot: 2 });
  });

  it('has a compact canvas for 1024–1279 px that keeps the page text near 14 px', () => {
    expect(compact.canvas.w).toBe(640);
    expect(compact.card).toMatchObject({ cx: 430, w: 400, h: 240 });
    expect(compact.card.cx + compact.card.w / 2).toBeLessThanOrEqual(compact.canvas.w);
    // the hero column is ≈533 px wide at 1024: the 17 px body renders at ≈14 px
    expect(17 * (533 / compact.canvas.w)).toBeGreaterThan(13.9);
  });

  it('gives every card the same perspective in card widths', () => {
    expect(desktop.perspective).toBe(1596);
    expect(compact.perspective).toBe(1400);
    expect(phone.perspective).toBe(1092);
  });

  it('halves rotations below 1.5 dppx', () => {
    const lowDpi = buildGeometry(DESKTOP_TEXT, { variant: 'desktop', pageH: 539, dpr: 1 });
    expect(lowDpi.page.rot).toBe(-0.5);
    expect(lowDpi.card.rot).toBe(1.2);
    expect(desktop.page.rot).toBe(-1.2);
  });
});

describe('paper hero timeline', () => {
  it('keeps the beats overlapped: ≈3.2 s on desktop, ≈3.0 s on a phone', () => {
    expect(Math.abs(W.end - 3.19)).toBeLessThan(0.03);
    expect(Math.abs(WP.end - 2.97)).toBeLessThan(0.03);
    expect(W.lift - W.ulEnd).toBeCloseTo(0.08, 6);
    expect(W.flip - W.land).toBeCloseTo(0.04, 6);
  });

  it('keeps every window in order', () => {
    for (const [, , T] of ALL) {
      const marks = [T.ul[0].a, T.ul[0].b, T.ul[1].a, T.ul[1].b, T.lift, T.land, T.flip, ...T.zav.flat(), T.zavEnd, T.invite, T.end];
      for (let i = 1; i < marks.length; i++) expect(marks[i]).toBeGreaterThanOrEqual(marks[i - 1]);
      expect(T.ulEnd).toBe(T.ul[1].b);
    }
  });

  it('makes the question readable about 2.2 s after the gate opens', () => {
    for (const [, g, T] of ALL) {
      const readable = times(START_AT, T.end).find(t => sceneAt(t, g, T).card.intro >= 150);
      expect(readable).toBeDefined();
      expect(readable! - START_AT).toBeLessThanOrEqual(2.3);
    }
  });

  it('rests the pencil on the comma for 70 ms', () => {
    const split = W.ul[0].split!;
    expect(split).not.toBeNull();
    const atComma = W.ul[0].a + split.da;
    expect(underlineProgress(atComma + 0.005, W.ul[0])).toBeCloseTo(split.cf, 6);
    expect(underlineProgress(atComma + 0.065, W.ul[0])).toBeCloseTo(split.cf, 6);
    expect(underlineProgress(W.ul[0].b, W.ul[0])).toBe(1);
  });

  it('finishes the underline by ulEnd', () => {
    expect(sceneAt(W.ulEnd, desktop, W).ul).toEqual([1, 1]);
    expect(sceneAt(0, desktop, W).ul[1]).toBe(0);
  });
});

describe('the slip', () => {
  it('appears over its own sentence and moves only once it is fully there', () => {
    for (const [, g, T] of ALL) {
      expect(sceneAt(T.lift - APPEAR - 0.001, g, T).strip.visible).toBe(false);
      const home = slipHome(g);
      for (const t of times(T.lift - APPEAR, T.lift, 0.005)) {
        const s = sceneAt(t, g, T);
        expect(s.strip.visible).toBe(true);
        // while it is not fully opaque it sits exactly on the sentence, flat and at page size
        const c = slipOnCanvas(g, s);
        expect(Math.hypot(c.x - home.x, c.y - home.y)).toBeLessThan(1e-6);
        expect(s.strip.scale).toBeCloseTo(1, 9);
        expect(s.strip.edge).toBeCloseTo(0, 9);
        expect(s.strip.peelY).toBeCloseTo(0, 9);
        expect(s.strip.rot + s.card.rot).toBeCloseTo(g.page.rot, 6);
      }
      expect(sceneAt(T.lift, g, T).strip.opacity).toBe(1);
      expect(sceneAt(T.end, g, T).strip.opacity).toBe(1);
    }
  });

  it('peels from the far end and shows its cut edge only as it leaves the page', () => {
    const peak = Math.min(...times(W.lift, W.lift + 0.3, 0.002).map(t => sceneAt(t, desktop, W).strip.peelY));
    expect(peak).toBeCloseTo(-10, 1);
    expect(sceneAt(W.lift + 0.25, desktop, W).strip.peelY).toBe(0);
    expect(sceneAt(W.lift + 0.11, desktop, W).strip.edge).toBeGreaterThan(0.8);
    expect(sceneAt(W.end, desktop, W).strip.edge).toBe(1);
  });

  it('is carried in one arc: no stop between the rise and the carry, no jerk', () => {
    for (const [, g, T] of ALL) {
      const dt = 1 / 120;
      let prev = slipOnCanvas(g, sceneAt(T.lift, g, T));
      let prevV = 0;
      let slowest = Infinity;
      let maxAccel = 0;
      for (const t of times(T.lift + dt, T.land, dt)) {
        const c = slipOnCanvas(g, sceneAt(t, g, T));
        const v = Math.hypot(c.x - prev.x, c.y - prev.y) / dt;
        if (t > T.lift + 0.1 && t < T.land - 0.12) slowest = Math.min(slowest, v);
        maxAccel = Math.max(maxAccel, Math.abs(v - prevV) / dt);
        prev = c;
        prevV = v;
      }
      expect(slowest).toBeGreaterThan(40);
      // a spring released at full force would jump to over 80 000 px/s²
      expect(maxAccel).toBeLessThan(12000);
    }
  });

  it('is set down where it stops: no glide across the card after the touch', () => {
    for (const [, g, T] of ALL) {
      const spot = pasteSpot(g);
      const touch = times(T.lift + 0.2, T.land, 0.001).find(t => sceneAt(t, g, T).strip.height < 0.05)!;
      expect(T.land - touch).toBeLessThan(0.05);
      const s = sceneAt(touch, g, T);
      expect(Math.hypot(s.strip.x - spot.x, s.strip.y - spot.y)).toBeLessThan(1);
      // still lifted until the last stretch of the approach
      expect(sceneAt(T.land - 0.14, g, T).strip.height).toBeGreaterThan(0.95);
    }
  });

  it('lands exactly on the paste spot and stays there, so it turns with the card', () => {
    for (const [, g, T] of ALL) {
      const spot = pasteSpot(g);
      const before = sceneAt(T.land - 1e-4, g, T).strip;
      const at = sceneAt(T.land, g, T).strip;
      expect(Math.hypot(before.x - at.x, before.y - at.y)).toBeLessThan(0.02);
      expect(at).toMatchObject({ x: spot.x, y: spot.y, rot: g.paste.rot, scale: 1, height: 0 });
      for (const t of [T.flip + 0.2, T.end, T.end + 5]) expect(sceneAt(t, g, T).strip).toMatchObject({ x: spot.x, y: spot.y });
    }
  });

  it('grows at most to S while lifted and is page size on the page and on the card', () => {
    for (const [, g, T] of ALL) {
      for (const t of times(START_AT, T.end, 0.004)) {
        const { scale } = sceneAt(t, g, T).strip;
        expect(scale).toBeGreaterThanOrEqual(1);
        expect(scale).toBeLessThanOrEqual(g.S + 1e-9);
      }
    }
    expect(desktop.S).toBe(1.06);
    expect(phone.S).toBe(1.05);
  });

  it('casts a shadow only while it is in the air', () => {
    expect(sceneAt(W.lift - 0.01, desktop, W).shadow.opacity).toBe(0);
    expect(sceneAt(W.lift + 0.3, desktop, W).shadow.opacity).toBeGreaterThan(0.95);
    expect(sceneAt(W.land, desktop, W).shadow.opacity).toBe(0);
  });
});

describe('the card', () => {
  it('leans in to take the slip, dips on the touch and settles back after the turn', () => {
    const before = sceneAt(W.land - LEAN.lead - 0.001, desktop, W).card;
    expect(before.scale).toBe(1);
    const leaning = sceneAt(W.land - 0.001, desktop, W).card;
    expect(leaning.scale).toBeGreaterThan(1.005);
    expect(leaning.rot).toBeCloseTo(desktop.card.rot + LEAN.rot, 2);
    expect(leaning.lift).toBeGreaterThan(0.29);
    const end = sceneAt(W.end, desktop, W).card;
    expect(end.rot).toBeCloseTo(desktop.card.rot, 6);
    expect(end.scale).toBeCloseTo(1, 6);
  });

  it('squares the under-cards once, without a wobble', () => {
    let past2 = 0;
    let past3 = 0;
    for (const t of times(W.land, W.land + 2, 0.002)) {
      const s = sceneAt(t, desktop, W);
      past2 = Math.max(past2, s.deck.c2 - desktop.card.rot - desktop.deck.c2.r1);
      past3 = Math.max(past3, desktop.deck.c3.r1 - (s.deck.c3 - desktop.card.rot));
    }
    expect(past2).toBeLessThan(0.05);
    expect(past3).toBeLessThan(0.05);
  });

  it('turns to the question and stops at 180°', () => {
    const end = sceneAt(W.end, desktop, W);
    expect(end.card.theta).toBe(180);
    expect(end.card.back).toBe(true);
    expect(end.card.atRest).toBe(true);
    expect(sceneAt(W.flip - 0.01, desktop, W).card.back).toBe(false);
    expect(W.end - W.flip).toBeGreaterThan(FLIP_SETTLE);
  });

  it('keeps the card in 3D until the intro flip has stopped ringing', () => {
    const ringing = times(W.flip, W.flip + FLIP_SETTLE - 0.01, 0.01).filter(t => sceneAt(t, desktop, W).card.atRest);
    expect(ringing).toEqual([]);
    expect(sceneAt(W.flip + FLIP_SETTLE + 0.001, desktop, W).card.atRest).toBe(true);
    expect(Math.abs(180 * (1 - spring(FLIP_SETTLE, 0, ...SPRING.flip)))).toBeLessThan(0.03);
  });

  it('rises off its shadow while it turns', () => {
    const mid = times(W.flip, W.flip + 0.4, 0.002).map(t => sceneAt(t, desktop, W).card).reduce((a, b) => (b.s > a.s ? b : a));
    expect(mid.rise).toBeGreaterThan(5.9);
    expect(mid.scale).toBeGreaterThan(1.04);
    expect(mid.lift).toBeGreaterThan(0.99);
  });

  it('lights the turn from one side: shade on the face that leaves, light on the one that arrives', () => {
    const leaving = cardFace(60, true);
    expect(leaving.back).toBe(false);
    expect(leaving.shade).toBeGreaterThan(0.03);
    expect(leaving.light).toBe(0);
    const arriving = cardFace(120, true);
    expect(arriving.back).toBe(true);
    expect(arriving.light).toBeGreaterThan(0.06);
    expect(arriving.shade).toBe(0);
    // the visitor keeps turning the same way: 180 → 360 shades the question, lights the answer
    expect(cardFace(240, true).shade).toBeGreaterThan(0.03);
    expect(cardFace(300, true).light).toBeGreaterThan(0.06);
    expect(cardFace(90, true).shade).toBeLessThanOrEqual(0.05);
    expect(cardFace(180, false)).toMatchObject({ shade: 0, light: 0, atRest: true });
  });

  it('drops the flipper transform only when flat and still', () => {
    expect(cardFace(180, false).atRest).toBe(true);
    expect(cardFace(180, true).atRest).toBe(false);
    expect(cardFace(170, false).atRest).toBe(false);
    expect(cardFace(100, false).mirror).toBe(true);
    expect(cardFace(360, false)).toMatchObject({ back: false, atRest: true, mirror: false });
    expect(cardFace(540, false)).toMatchObject({ back: true, atRest: true });
    expect(cardFace(90, false).base).toBeCloseTo(0.2, 6);
  });

  it('lifts under a hovering pointer and gives under a press', () => {
    const rest = sceneAt(W.end, desktop, W);
    const lifted = sceneAt(W.end, desktop, W, { ...IDLE, hover: 1 });
    expect(lifted.card.scale / rest.card.scale).toBeCloseTo(1.012, 6);
    expect(lifted.card.lift).toBeCloseTo(0.3, 6);
    expect(lifted.card.base).toBeCloseTo(1 - 0.8 * 0.3, 6);
    const pressed = sceneAt(W.end, desktop, W, { ...IDLE, hover: 1, press: 1 });
    expect(pressed.card.scale).toBeCloseTo(0.988, 6);
    expect(pressed.card.lift).toBe(0);
    expect(rest.card.base).toBeCloseTo(1, 3);
  });

  it('writes «завтра» stroke by stroke without overlaps, starting while the card settles', () => {
    expect(W.zav).toHaveLength(8);
    for (let i = 1; i < W.zav.length; i++) expect(W.zav[i][0]).toBeGreaterThan(W.zav[i - 1][1]);
    const inked = W.zav.reduce((sum, [a, b]) => sum + (b - a), 0);
    expect(inked).toBeCloseTo(0.55, 6);
    expect(W.zav[0][0] - W.flip).toBeCloseTo(0.18, 6);
    expect(W.zav[0][0]).toBeLessThan(W.flip + FLIP_SETTLE);
    expect(sceneAt(W.zav[0][0] - 0.01, desktop, W).zav.every(p => p === 0)).toBe(true);
    expect(sceneAt(W.zavEnd, desktop, W).zav.every(p => p === 1)).toBe(true);
  });

  it('fades the caption in last and out after the first visitor turn', () => {
    expect(sceneAt(W.invite, desktop, W).invite).toBe(0);
    expect(sceneAt(W.end, desktop, W).invite).toBe(1);
    expect(sceneAt(W.end, desktop, W, { ...IDLE, userFlip: 180, inviteOut: 1 }).invite).toBe(0);
  });
});

describe('clock helpers and springs', () => {
  it('cuts a skip to the touch and leaves later times alone', () => {
    expect(skipFrom(0.4, W)).toBe(W.land);
    expect(skipFrom(W.flip, W)).toBe(W.flip);
    expect((W.end - W.land) / SKIP_RATE).toBeLessThan(0.7);
    expect((1000 / 60) * SKIP_RATE).toBeLessThan(42);
  });

  it('offers four stills for reduced motion: underlined, in the air, pasted, turned', () => {
    const stills = stepStills(W);
    expect(stills).toHaveLength(4);
    expect(stills[0]).toBe(W.ulEnd);
    expect(sceneAt(stills[1], desktop, W).strip.height).toBe(1);
    const pasted = sceneAt(stills[2], desktop, W);
    expect(pasted.strip.height).toBe(0);
    expect(pasted.card.back).toBe(false);
    expect(stills[3]).toBe(W.end);
  });

  it('moves the slip like a hand: minimum-jerk from rest to rest', () => {
    expect(minJerk(0)).toBe(0);
    expect(minJerk(1)).toBe(1);
    expect(minJerk(0.5)).toBeCloseTo(0.5, 9);
    const slope = (x: number) => (minJerk(x + 1e-4) - minJerk(x - 1e-4)) / 2e-4;
    expect(Math.abs(slope(0.0001))).toBeLessThan(1e-3);
    expect(Math.abs(slope(0.9999))).toBeLessThan(1e-3);
  });

  it('keeps every visitor spring close to critical: paper does not wobble', () => {
    const overshoot = (k: number, c: number) => Math.max(...times(0, 2, 0.002).map(t => spring(t, 0, k, c))) - 1;
    expect(180 * overshoot(...SPRING.userFlip)).toBeLessThan(0.6);
    expect(180 * overshoot(...SPRING.flip)).toBeLessThan(1.2);
    expect(overshoot(...SPRING.press)).toBeLessThan(0.01);
    expect(overshoot(...SPRING.method)).toBeLessThan(0.01);
    expect(overshoot(...SPRING.hover)).toBeLessThan(0.01);
  });
});
