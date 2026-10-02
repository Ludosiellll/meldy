/**
 * «Строчка → карточка»: the hero scene as pure functions of time.
 *
 * Every visual of the hero is computed by `sceneAt(t, geometry, timeline, interaction)`.
 * The component only writes the returned numbers to the DOM, so frames are reproducible
 * (QA can freeze any `t`) and the timeline can be unit-tested without a browser.
 *
 * The take: the pencil underlines the key sentence; the pen lifts and the sentence peels
 * off the page as a slip, is carried to the card in one arc (a hand's minimum-jerk
 * profile: it speeds up, slows down and is set down as it stops, with no glide after the
 * touch), the card leans in to take it, and the turn starts at the touch. «завтра» is
 * written while the card is still settling.
 *
 * The slip lives inside the card's answer face for the whole flight: its position is the
 * canvas path mapped into the card's frame, so it lands exactly on its paste spot and turns
 * with the card without any copy being swapped in.
 */
import { ZAVTRA } from './zavtraPath';

/* ------------------------------------------------------------------ */
/* Maths                                                               */
/* ------------------------------------------------------------------ */

export type Ease = (x: number) => number;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** CSS `cubic-bezier()` solved for y(x) with Newton iterations. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      const slope = slopeX(t);
      if (Math.abs(error) < 1e-6 || !slope) break;
      t -= error / slope;
    }
    return sampleY(clamp(t));
  };
}

/** Eased progress of `t` through the window [a, b]. */
export const seg = (t: number, a: number, b: number, ease: Ease = x => x) => ease(clamp((t - a) / (b - a)));

/** Minimum-jerk profile (Flash & Hogan): how a hand moves from rest to rest. */
export const minJerk: Ease = x => {
  const s = clamp(x);
  return s * s * s * (10 - 15 * s + 6 * s * s);
};

/**
 * Closed-form damped spring from 0 to 1 starting at rest at `t0`
 * (same physics as framer-motion's spring: stiffness k, damping c, mass m).
 */
export function spring(t: number, t0: number, k: number, c: number, m = 1) {
  const tau = t - t0;
  if (tau <= 0) return 0;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * tau) * (Math.cos(wd * tau) + (zeta * w0 / wd) * Math.sin(wd * tau));
  }
  return 1 - Math.exp(-w0 * tau) * (1 + w0 * tau);
}

export function rotatePoint(x: number, y: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}

interface Pt2 { x: number; y: number }

function bezier(p0: Pt2, p1: Pt2, p2: Pt2, p3: Pt2, u: number): Pt2 {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const START_AT = -0.3;
/** Pencil speed: line i takes base + L_i·perPx, L_i = x1 − x0 + 7. */
export const PEN = { perPx: 1 / 1500, base: 0.14, baseHalf: 0.08, commaRest: 0.07, lift: 0.09 } as const;
/** The pen lifts and the sentence starts to peel almost at once. */
export const HOLD_AFTER_UL = 0.08;
/** Peel to touchdown. Longer for the longer reach of the desktop canvas. */
export const FLIGHT = { desktop: 0.72, compact: 0.68, phone: 0.6 } as const;
/**
 * The slip fades in over its own sentence while both are still identical (the last APPEAR
 * of the pen's hold), so no doubled text is ever visible; it moves only when fully opaque.
 */
export const APPEAR = 0.06;
/** Height: up over LIFT after the peel starts, down over SET_DOWN before the touch. */
export const LIFT = 0.22;
export const SET_DOWN = 0.13;
/** Path parameter starts this late, so the slip comes up before it travels. */
export const TRAVEL_DELAY = 0.03;
/** End-peel: the far end comes up first (hinge near the left end), flat again by `down`. */
export const PEEL = { up: 0.06, down: 0.2, rotY: -10, rotX: 6 } as const;
/** The card leans in to take the slip over this long, and turns toward it. */
export const LEAN = { lead: 0.12, scale: 0.006, rot: -0.4 } as const;
/** The turn starts as the slip touches and rides the deck's dip. */
export const FLIP_DELAY = 0.04;
export const ZAV = { delay: 0.18, ink: { desktop: 0.55, compact: 0.55, phone: 0.5 }, lift: 0.045 } as const;
export const INVITE = { gap: 0.1, fade: 0.36 } as const;
/** [stiffness, damping], mass 1. Everything that settles is at ζ ≥ 0.85, so paper never wobbles. */
export const SPRING = {
  sq2: [260, 28],
  sq3: [220, 26],
  flip: [150, 21],
  userFlip: [200, 25],
  hover: [400, 34],
  press: [700, 45],
  method: [220, 26],
} as const;
/**
 * The intro flip spring is within 0.03° of 180° after this long; until then the card keeps
 * its 3D transform (a ringing spring dips under the rest threshold as it crosses 180°).
 */
export const FLIP_SETTLE = (() => {
  const [k, c] = SPRING.flip;
  let last = 0;
  for (let t = 0; t < 3; t += 0.005) if (Math.abs(180 * (1 - spring(t, 0, k, c))) >= 0.03) last = t;
  return Math.ceil((last + 0.005) * 100) / 100;
})();
/** Skip: cut to the touch, then the rest of the story at this speed. */
export const SKIP_RATE = 2.5;
/** Replay (a click on the underlined sentence): fade out, reset while invisible, fade in as the clock starts. */
export const REPLAY = { out: 0.16, in: 0.24 } as const;
export const EASE = {
  pencil: [0.42, 0, 0.22, 1],
  out: [0.22, 0.61, 0.36, 1],
  inout: [0.45, 0, 0.55, 1],
  write: [0.3, 0.1, 0.3, 1],
} as const;
/**
 * Lifted, the slip is S× its page size. It is set at page size (scale 1 on the page and on the
 * card), so at rest it renders exactly like the sentence it was cut from; it is never cached as
 * a layer while it flies, so the brief 6% enlargement stays sharp.
 */
export const S = { desktop: 1.06, compact: 1.06, phone: 1.05 } as const;
/** Flip lighting, light from the left: shade on a face turning away, a highlight on one turning in. */
export const LIGHT = { shade: 0.05, shadeExp: 1.6, highlight: 0.08, rise: 6, lift: 0.05 } as const;

export const EASES = {
  pencil: cubicBezier(...EASE.pencil),
  out: cubicBezier(...EASE.out),
  inout: cubicBezier(...EASE.inout),
  write: cubicBezier(...EASE.write),
};

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export type Variant = 'desktop' | 'compact' | 'phone';

export interface Rect { x: number; y: number; w: number; h: number }

export interface PaperLine {
  /** Left edge of the first word and right edge of the last word, page coordinates. */
  x0: number;
  x1: number;
  baseline: number;
  /** Top of the line's content area (word boxes). */
  top: number;
  text: string;
}

export interface PaperGeometry {
  variant: Variant;
  lines: PaperLine[];
  /** Line that holds the word ending in a comma (the pencil rests there), −1 when none. */
  commaLine: number;
  /** Right edge of that word, page coordinates. */
  commaRight: number;
  /** Body font size of the key paragraph. */
  fs: number;
  /** The slip that lifts off: key sentence plus its underline, page coordinates. */
  rect: Rect;
  page: { left: number; top: number; w: number; h: number; rot: number };
  /** Top card: centre in canvas coordinates, size, rotation. */
  card: { cx: number; cy: number; w: number; h: number; rot: number };
  /** Scale of the slip at full height (1 = page size). */
  S: number;
  /** First control point of the carry arc, relative to the slip's home. */
  hover: { dx: number; dy: number };
  /** Paste spot: offset of the slip's centre from the card centre, card coordinates. */
  paste: { dx: number; dy: number; rot: number };
  deck: { c2: DeckCard; c3: DeckCard };
  canvas: { w: number; h: number };
  /** CSS perspective for the flip: 3.5 card widths, the same edge-on swell on every card. */
  perspective: number;
  flight: number;
}

export interface DeckCard { dx: number; dy: number; r0: number; r1: number }

/** Design constants per canvas. Rotations: [≥1.5 dppx, below]. */
export const CANVAS = {
  desktop: {
    w: 760,
    page: { left: 10, top: 10, w: 520 },
    pageRot: [-1.2, -0.5],
    card: { w: 456, h: 274 },
    cardRot: [2.4, 1.2],
    hover: { dx: 12, dy: -20 },
    paste: { dx: 0, dy: 4, rot: -1.2 },
    stripPad: { x: 9, top: 2 },
    zavtra: { px: 22, stroke: 1.7 },
  },
  /** 640–767 and 1024–1279 px: a narrower canvas so the page text stays near 14 px. */
  compact: {
    w: 640,
    page: { left: 10, top: 10, w: 520 },
    pageRot: [-1.2, -0.5],
    card: { w: 400, h: 240 },
    cardRot: [2.4, 1.2],
    hover: { dx: 10, dy: -18 },
    paste: { dx: 0, dy: 4, rot: -1.2 },
    stripPad: { x: 9, top: 2 },
    zavtra: { px: 21, stroke: 1.65 },
  },
  phone: {
    w: 358,
    page: { left: 6, top: 6, w: 346 },
    pageRot: [-1.0, -0.5],
    card: { w: 312, h: 187 },
    cardRot: [2.0, 1.0],
    hover: { dx: 3, dy: -12 },
    paste: { dx: 0, dy: 2, rot: -1.2 },
    stripPad: { x: 7, top: 2 },
    zavtra: { px: 19, stroke: 1.55 },
  },
} as const;

export const DECK = {
  c2: { dx: 7, dy: -5, r0: -4.5, r1: -1.6 },
  c3: { dx: -9, dy: 7, r0: 5.5, r1: 3.4 },
} as const;

/**
 * Page heights with Literata loaded (measured): the stage is sized from these until the paper
 * is measured, so nothing on the first screen moves when the measurement lands.
 */
export const DEFAULT_PAGE_H = { desktop: 567, compact: 567, phone: 250 } as const;

/** Underline offset under the baseline, in em of the body font. */
export const UNDERLINE_DROP = 0.2;

export interface MeasuredText {
  lines: PaperLine[];
  commaLine: number;
  commaRight: number;
  fs: number;
  /** Left edge of the key paragraph (its first-line indent is in the line x0). */
  paraLeft: number;
}

/**
 * Builds the whole scene geometry from the measured key paragraph and the page height.
 * Pure: every DOM read happens in `usePaperGeometry`.
 */
export function buildGeometry(text: MeasuredText, opts: { variant: Variant; pageH: number; dpr: number }): PaperGeometry {
  const c = CANVAS[opts.variant];
  const hiDpi = opts.dpr >= 1.5;
  const lines = text.lines.length ? text.lines : [{ x0: 0, x1: 0, baseline: 0, top: 0, text: '' }];
  const last = lines[lines.length - 1];
  const x = text.paraLeft - c.stripPad.x;
  const y = Math.min(...lines.map(l => l.top)) - c.stripPad.top;
  const right = Math.max(...lines.map(l => l.x1)) + c.stripPad.x + 2;
  const bottom = last.baseline + UNDERLINE_DROP * text.fs + 7;
  const rect = { x: Math.round(x), y: Math.round(y), w: Math.round(right - x), h: Math.round(bottom - y) };
  const page = { left: c.page.left, top: c.page.top, w: c.page.w, h: opts.pageH, rot: hiDpi ? c.pageRot[0] : c.pageRot[1] };
  const cardRot = hiDpi ? c.cardRot[0] : c.cardRot[1];
  const cardX = opts.variant === 'desktop'
    ? page.left + page.w - 2
    : opts.variant === 'compact'
      ? page.left + page.w - 100
      : c.w - c.card.w / 2 - 5;
  const cardY = opts.variant === 'phone' ? page.top + page.h - 56 + c.card.h / 2 : page.top + page.h - 70;
  const card = { cx: cardX, cy: cardY, w: c.card.w, h: c.card.h, rot: cardRot };
  const cardBottom = card.cy + card.h / 2 + Math.sin((Math.abs(card.rot) * Math.PI) / 180) * card.w / 2;
  return {
    variant: opts.variant,
    lines,
    commaLine: text.commaLine,
    commaRight: text.commaRight,
    fs: text.fs,
    rect,
    page,
    card,
    S: S[opts.variant],
    hover: { ...c.hover },
    paste: { ...c.paste },
    deck: { c2: { ...DECK.c2 }, c3: { ...DECK.c3 } },
    canvas: { w: c.w, h: Math.ceil(cardBottom + 10) },
    perspective: Math.round(3.5 * c.card.w),
    flight: FLIGHT[opts.variant],
  };
}

/** Layout-only geometry for the stage before measuring (no text lines). */
export function defaultGeometry(variant: Variant, dpr = 2): PaperGeometry {
  const empty: MeasuredText = { lines: [], commaLine: -1, commaRight: 0, fs: 17, paraLeft: 0 };
  return buildGeometry(empty, { variant, pageH: DEFAULT_PAGE_H[variant], dpr });
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export interface UnderlineWindow {
  a: number;
  b: number;
  /** Two hand motions with the pen resting on the comma. */
  split: null | { cf: number; da: number; rest: number };
}

export interface Timeline {
  ul: UnderlineWindow[];
  ulEnd: number;
  /** The slip appears over its sentence and starts to peel. */
  lift: number;
  /** Touchdown on the paste spot. */
  land: number;
  flip: number;
  zav: Array<[number, number]>;
  zavEnd: number;
  invite: number;
  end: number;
}

export const lineLength = (line: PaperLine) => line.x1 - line.x0 + 7;

export function buildTimeline(
  geo: Pick<PaperGeometry, 'lines' | 'commaLine' | 'commaRight' | 'variant'> & { flight?: number },
  zavLens: readonly number[] = ZAVTRA.lens,
): Timeline {
  let t = 0;
  const ul: UnderlineWindow[] = geo.lines.map((line, i) => {
    const L = lineLength(line);
    let w: UnderlineWindow;
    if (i === geo.commaLine) {
      const cf = clamp((geo.commaRight - line.x0 + 3) / L);
      const da = PEN.baseHalf + cf * L * PEN.perPx;
      const db = PEN.baseHalf + (1 - cf) * L * PEN.perPx;
      w = { a: t, b: t + da + PEN.commaRest + db, split: { cf, da, rest: PEN.commaRest } };
    } else {
      w = { a: t, b: t + PEN.base + L * PEN.perPx, split: null };
    }
    t = w.b + PEN.lift;
    return w;
  });
  const ulEnd = ul.length ? ul[ul.length - 1].b : 0;
  const lift = ulEnd + HOLD_AFTER_UL;
  const land = lift + (geo.flight ?? FLIGHT[geo.variant]);
  const flip = land + FLIP_DELAY;
  const zav0 = flip + ZAV.delay;
  const ink = ZAV.ink[geo.variant];
  const total = zavLens.reduce((a, b) => a + b, 0) || 1;
  let zt = zav0;
  const zav = zavLens.map(len => {
    const d = (ink * len) / total;
    const w: [number, number] = [zt, zt + d];
    zt += d + ZAV.lift;
    return w;
  });
  const zavEnd = zav.length ? zav[zav.length - 1][1] : zav0;
  const invite = zavEnd + INVITE.gap;
  const end = invite + INVITE.fade;
  return { ul, ulEnd, lift, land, flip, zav, zavEnd, invite, end };
}

export function underlineProgress(t: number, w: UnderlineWindow) {
  if (!w.split) return seg(t, w.a, w.b, EASES.pencil);
  const { cf, da, rest } = w.split;
  return t < w.a + da
    ? cf * seg(t, w.a, w.a + da, EASES.pencil)
    : cf + (1 - cf) * seg(t, w.a + da + rest, w.b, EASES.pencil);
}

/* ------------------------------------------------------------------ */
/* Card faces                                                          */
/* ------------------------------------------------------------------ */

/** Values driven by the visitor after the intro (degrees, 0..1). */
export interface Interaction {
  /** Visitor turns, added to the intro's 180°; always in the same direction (360, 540…). */
  userFlip: number;
  /** 0..1: the card rises a little under a mouse pointer. */
  hover: number;
  /** 0..1: the card gives under a finger or a pressed mouse button. */
  press: number;
  /** 0 = caption shown, 1 = faded out after the first visitor turn. */
  inviteOut: number;
  /** A rotation spring is still running. */
  moving: boolean;
}

export const IDLE: Interaction = { userFlip: 0, hover: 0, press: 0, inviteOut: 0, moving: false };

export interface CardFace {
  /** Total Y rotation of the single flipping plane, degrees. */
  theta: number;
  /** Flat and still: the flipper can drop its transform so text renders crisp. */
  atRest: boolean;
  /** The plane shows its back side (the hero's question face). */
  back: boolean;
  /** Back-side content is mirrored back while the plane is turned. */
  mirror: boolean;
  /** Opacity of the lift shadow under the turning card. */
  lift: number;
  /** Opacity of the contact shadow: it thins as the card leaves the deck. */
  base: number;
  /** Darkening of the visible face while it turns away from the light. */
  shade: number;
  /** Brightening of the visible face while it turns toward the light. */
  light: number;
  /** |sin θ|: the card's lift-scale and rise follow it. */
  s: number;
}

/**
 * One light, from the left. The visible face's normal leans right while it turns away
 * (it darkens a little) and left while it turns in (it catches the light). Turns always
 * go the same way, so the face that leaves is the one in shade.
 */
export function cardFace(theta: number, moving: boolean): CardFace {
  const rad = (theta * Math.PI) / 180;
  const raw = Math.sin(rad);
  // sin(180°) is 1e-16 in floating point: a flat card is exactly flat
  const sin = Math.abs(raw) < 1e-9 ? 0 : raw;
  const s = Math.abs(sin);
  const back = Math.cos(rad) < 0;
  const atRest = s < 5e-4 && !moving;
  const nx = back ? -sin : sin;
  return {
    theta,
    atRest,
    back,
    mirror: back && !atRest,
    lift: s,
    base: 1 - 0.8 * s,
    shade: nx > 0 ? LIGHT.shade * Math.pow(nx, LIGHT.shadeExp) : 0,
    light: nx < 0 ? LIGHT.highlight * -nx : 0,
    s,
  };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export interface SceneState {
  ul: number[];
  /** The slip, in the card's own coordinates (its centre), so it turns with the card. */
  strip: {
    visible: boolean;
    opacity: number;
    /** Cut edge and contact hairline: there only once the slip has left the page. */
    edge: number;
    x: number;
    y: number;
    rot: number;
    scale: number;
    /** End-peel, degrees. */
    peelX: number;
    peelY: number;
    /** 0 on the page or the card, 1 at full height. */
    height: number;
  };
  /** The slip's cast shadow, card coordinates (centre). */
  shadow: { opacity: number; x: number; y: number; rot: number; scale: number };
  deck: { c2: number; c3: number };
  card: CardFace & { scale: number; rot: number; rise: number; intro: number };
  zav: number[];
  invite: number;
}

/** The slip's resting centre in the page sheet, in canvas coordinates. */
export function slipHome(g: PaperGeometry) {
  const pageCx = g.page.left + g.page.w / 2;
  const pageCy = g.page.top + g.page.h / 2;
  const fromCentre = rotatePoint(g.rect.x + g.rect.w / 2 - g.page.w / 2, g.rect.y + g.rect.h / 2 - g.page.h / 2, g.page.rot);
  return { x: pageCx + fromCentre.x, y: pageCy + fromCentre.y };
}

export function sceneAt(t: number, g: PaperGeometry, W: Timeline, ui: Interaction = IDLE): SceneState {
  // 1. underline on the page (the page keeps its ink: the slip is a copy)
  const ul = W.ul.map(w => underlineProgress(t, w));

  // 2. the card: it leans in to take the slip, dips on the touch, rises while it turns
  const pre = seg(t, W.land - LEAN.lead, W.land, EASES.out) * (1 - seg(t, W.flip + 0.42, W.flip + 0.72, EASES.inout));
  const tau = t - W.land;
  const dip = tau > 0 ? Math.exp(-9 * tau) * Math.sin(26 * tau) : 0;
  const introRinging = t >= W.flip && t - W.flip < FLIP_SETTLE;
  const intro = t - W.flip >= FLIP_SETTLE ? 180 : 180 * spring(t, W.flip, ...SPRING.flip);
  const face = cardFace(intro + ui.userFlip, ui.moving || introRinging);
  const up = clamp(ui.hover) * (1 - clamp(ui.press));
  const cardScale = (1 + LEAN.scale * pre) * (1 - 0.012 * dip) * (1 + LIGHT.lift * face.s) * (1 + 0.012 * up) * (1 - 0.012 * clamp(ui.press));
  const cardRot = g.card.rot + LEAN.rot * pre;
  const raised = Math.max(face.s, 0.3 * up, 0.3 * pre);

  // 3. the slip: one arc from its sentence to the paste spot, mapped into the card's frame
  const home = slipHome(g);
  const pasteLocal = { x: g.card.w / 2 + g.paste.dx, y: g.card.h / 2 + g.paste.dy };
  const toCanvas = (lx: number, ly: number) => {
    const p = rotatePoint((lx - g.card.w / 2) * cardScale, (ly - g.card.h / 2) * cardScale, cardRot);
    return { x: g.card.cx + p.x, y: g.card.cy + p.y };
  };
  const toLocal = (x: number, y: number) => {
    const p = rotatePoint((x - g.card.cx) / cardScale, (y - g.card.cy) / cardScale, -cardRot);
    return { x: g.card.w / 2 + p.x, y: g.card.h / 2 + p.y };
  };
  const dest = toCanvas(pasteLocal.x, pasteLocal.y);
  const reach = { x: dest.x - home.x, y: dest.y - home.y };
  const c1 = { x: home.x + 2.4 * g.hover.dx, y: home.y + 2.4 * g.hover.dy };
  const c2 = { x: dest.x - 0.18 * reach.x, y: dest.y - 0.32 * Math.abs(reach.y) - 18 };
  const flight = W.land - W.lift;
  const u = minJerk((t - W.lift - TRAVEL_DELAY) / (flight - TRAVEL_DELAY));
  const landed = t >= W.land;
  const lifted = seg(t, W.lift, W.lift + LIFT, EASES.out);
  const settle = seg(t, W.land - SET_DOWN, W.land, EASES.inout);
  const height = landed ? 0 : lifted * (1 - settle);
  const peel = seg(t, W.lift, W.lift + PEEL.up, EASES.out) * (1 - seg(t, W.lift + PEEL.up, W.lift + PEEL.down, EASES.inout));
  let local: Pt2;
  let localRot: number;
  if (landed) {
    local = pasteLocal;
    localRot = g.paste.rot;
  } else {
    const p = bezier(home, c1, c2, dest, u);
    local = toLocal(p.x, p.y);
    const canvasRot = lerp(g.page.rot, cardRot + g.paste.rot, minJerk((t - W.lift) / flight));
    localRot = canvasRot - cardRot;
  }
  const scale = 1 + (g.S - 1) * height;
  const visible = t >= W.lift - APPEAR;
  const offset = 2 + 16 * height;
  // The light is fixed on the desk: the shadow falls down-right in canvas space.
  const shadowOffset = rotatePoint((offset * 0.3) / cardScale, (offset * 0.6) / cardScale, -cardRot);

  // 4. deck: the two under-cards square up once
  const c2Rot = g.card.rot + lerp(g.deck.c2.r0, g.deck.c2.r1, spring(t, W.land + 0.03, ...SPRING.sq2));
  const c3Rot = g.card.rot + lerp(g.deck.c3.r0, g.deck.c3.r1, spring(t, W.land + 0.07, ...SPRING.sq3));

  // 5. «завтра», stroke by stroke
  const zav = W.zav.map(([a, b]) => seg(t, a, b, EASES.write));

  // 6. the caption under the card
  const invite = seg(t, W.invite, W.invite + INVITE.fade, EASES.out);

  return {
    ul,
    strip: {
      visible,
      opacity: visible ? seg(t, W.lift - APPEAR, W.lift) : 0,
      edge: visible ? lifted : 0,
      x: local.x,
      y: local.y,
      rot: localRot,
      scale,
      peelX: PEEL.rotX * peel || 0,
      peelY: PEEL.rotY * peel || 0,
      height,
    },
    shadow: {
      opacity: visible ? height : 0,
      x: local.x + shadowOffset.x,
      y: local.y + shadowOffset.y,
      rot: localRot,
      scale: scale * (1 - 0.02 * height),
    },
    deck: { c2: c2Rot, c3: c3Rot },
    card: { ...face, lift: raised, base: 1 - 0.8 * raised, scale: cardScale, rot: cardRot, rise: LIGHT.rise * face.s, intro },
    zav,
    invite: invite * (1 - clamp(ui.inviteOut)),
  };
}

/* ------------------------------------------------------------------ */
/* Clock helpers                                                       */
/* ------------------------------------------------------------------ */

/** Skip: anything before the touch is cut; the clock then runs at SKIP_RATE from here. */
export function skipFrom(t: number, W: Pick<Timeline, 'land'>) {
  return Math.max(t, W.land);
}

/** Still frames for «Показать по шагам» (reduced motion): underlined, in the air, pasted, turned. */
export function stepStills(W: Timeline) {
  return [W.ulEnd, W.lift + 0.45 * (W.land - W.lift), W.land + 0.02, W.end];
}
