/**
 * The reel's pointer (owner, 21.10: «большинство нажатий на кнопки кривые… перетаскивания в конструкторе тоже очень
 * кривые»). Its keys aim at the scene's own elements by `data-aim`, so a press lands on what it presses at every size:
 * the places are read from the page's layout (the offsets of the element up to the scene's UI box), once when the scene
 * is put on the stage and again when its layout changes, never in the frame loop. The keys also drive the target's
 * hover and pressed state, and a block that is dragged follows the pointer exactly (carry).
 *
 * Motion like a hand: a move takes the time Fitts's law gives for its distance and target, on a slight arc, easing out
 * onto the target; a press comes a beat after the pointer arrives (settle), then the dip. The pointer comes in, and
 * goes away again, by fading where it is, never by jumping.
 */
import { useLayoutEffect, useRef } from 'react';
import { flag, opacity, useClock, useFrame, useStageScale } from '../reel/engine';
import { bezier, clamp, ease, mix, seg } from '../reel/timeline';
import { move } from './kit3';

declare global {
  interface Window {
    /** In the frame exporter's mode: each scene's pointer on the stage, by scene. */
    __meldyPointers?: Record<string, Pointer>;
  }
}

export interface CursorKey {
  /** The moment (scene ms): the press for `press`, `down` and `up` keys, the arrival for the others. */
  t: number;
  /** The target: the element with this `data-aim` in the scene's UI box. */
  aim?: string;
  /** Where on the target, as fractions of its box (0.5, 0.5 = the centre, the default). */
  fx?: number;
  fy?: number;
  /** Then this many UI px further (a place beside the target, or the target after its content has scrolled). */
  dx?: number;
  dy?: number;
  /** A place in the UI box (UI px) when there is no target. */
  x?: number;
  y?: number;
  /** A click: settle, dip, the target pressed. */
  press?: boolean;
  /** The button goes down here and stays down: a drag starts (the target is its handle). */
  down?: boolean;
  /** With `down`: the button was down already, the pointer coming in from off the frame with a file from outside the
   * page; the key's place is where it comes from, and there is no handle to light. */
  outside?: boolean;
  /** The button comes up here: the drag ends. */
  up?: boolean;
  /** With `up`: the element that takes the drop, lit (is-over) while the held pointer is over it. */
  over?: string;
  /** The pointer fades out by `t` (moving to the key's place on the way if it has one). */
  hide?: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pointer's timing (ms). */
export const POINTER = {
  /** At a target this long before its press. */
  settle: 150,
  /** A click: the dip, and the target's pressed state. */
  press: 200,
  /** From a click to the pointer moving on (the hand goes on as the button comes up). */
  after: 140,
  /** On a handle this long before the button goes down. */
  grab: 150,
  /** From the button going down to the pull. */
  lift: 130,
  /** Over the drop place this long before the button comes up. */
  hold: 140,
  /** From the button coming up to the pointer moving on. */
  release: 120,
  /** Showing and hiding. */
  fade: 220,
} as const;

/** The pointer's arrow: `M5 3…` in a 24 box, drawn 22 px; its tip is where it points (reel3.css .r3-cursor). */
export const TIP = { x: (5 / 24) * 22, y: (3 / 24) * 22 };

/** How long a hand takes to move `distance` onto a target `width` across (Fitts's law, UI px); a held drag is slower. */
export function moveTime(distance: number, width: number, held = false): number {
  const natural = 100 + 95 * Math.log2(1 + distance / Math.max(width, 12));
  return Math.round(clamp(natural, 150, 850) * (held ? 1.25 : 1));
}

/** How wide a place to rest counts for a move's time (UI px). */
const REST_SIZE = 40;

/** An aimed movement's speed: a bell (its top twice the mean speed) a little before the middle, then a long soft
 * landing on the target. */
const aimed = bezier(0.4, 0.05, 0.4, 1);

export interface Stop {
  key: CursorKey;
  x: number;
  y: number;
  /** The pointer is here from `arrive` (a beat before a press) and may go on from `leave`. */
  arrive: number;
  leave: number;
  /** The target's smaller side (UI px), for the move's time. */
  size: number;
}

export interface Move {
  from: Stop;
  to: Stop;
  start: number;
  end: number;
  /** The arc's control point. */
  cx: number;
  cy: number;
  /** The time Fitts's law gives this move; `end - start` is less only when the keys leave less. */
  natural: number;
  held: boolean;
}

export interface Drag {
  down: Stop;
  up: Stop;
}

export interface PointerPlan {
  stops: Stop[];
  moves: Move[];
  drags: Drag[];
  /** Shows (to 1) and hides (to 0), each reached at `t` after POINTER.fade. */
  fades: Array<{ t: number; to: 0 | 1 }>;
}

export interface PointerState {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  /** The button is down (between a `down` key and its `up`). */
  held: boolean;
}

export type Resolve = (aim: string) => Box | null | undefined;

/** The point a key aims at: its target's box at (fx, fy), moved by (dx, dy); or its own place (UI px). */
export function keyPoint(key: CursorKey, box: Box | null | undefined): { x: number; y: number } | null {
  if (key.aim && box) return { x: box.x + box.w * (key.fx ?? 0.5) + (key.dx ?? 0), y: box.y + box.h * (key.fy ?? 0.5) + (key.dy ?? 0) };
  if (key.x !== undefined && key.y !== undefined) return { x: key.x + (key.dx ?? 0), y: key.y + (key.dy ?? 0) };
  return null;
}

/** The plan of a pointer: where it is when, from its keys (in time order) and its targets' boxes. */
export function planPointer(keys: readonly CursorKey[], resolve: Resolve): PointerPlan {
  const stops: Stop[] = [];
  let last = { x: 0, y: 0 };
  for (const key of keys) {
    const box = key.aim ? resolve(key.aim) : null;
    const point = keyPoint(key, box) ?? last;
    const arrive = key.press ? key.t - POINTER.settle : key.down ? key.t - POINTER.grab : key.up ? key.t - POINTER.hold : key.t;
    const leave = key.press ? key.t + POINTER.after : key.down ? key.t + POINTER.lift : key.up ? key.t + POINTER.release : key.t;
    // A place to rest beside something is a loose target; a press or a drag aims at its element.
    const size = box && (key.press || key.down || key.up) ? Math.min(box.w, box.h) : REST_SIZE;
    stops.push({ key, x: point.x, y: point.y, arrive, leave, size });
    last = point;
  }

  const drags: Drag[] = [];
  let down: Stop | null = null;
  for (const stop of stops) {
    if (stop.key.down) down = stop;
    if (stop.key.up && down) {
      drags.push({ down, up: stop });
      down = null;
    }
  }
  const heldAt = (t: number) => drags.some((drag) => t >= drag.down.key.t && t < drag.up.key.t);

  const moves: Move[] = [];
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1];
    const b = stops[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) continue;
    const held = heldAt(a.leave);
    const natural = moveTime(distance, b.size, held);
    // A hide key fades while it goes: it leaves as soon as it may and takes its natural time.
    const end = b.key.hide ? Math.min(b.arrive, a.leave + natural) : b.arrive;
    const start = Math.min(Math.max(a.leave, end - natural), end - 1);
    // The arc: the control point off the middle by a tenth of the way, bowed up (a wrist turning), or to the right on a
    // move straight up or down.
    let nx = -dy / distance;
    let ny = dx / distance;
    if (Math.abs(ny) < 0.35 ? nx < 0 : ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const bow = Math.min(distance * 0.1, 22);
    moves.push({ from: a, to: b, start, end, cx: (a.x + b.x) / 2 + nx * bow, cy: (a.y + b.y) / 2 + ny * bow, natural, held });
  }

  const fades: PointerPlan['fades'] = [];
  if (stops.length) fades.push({ t: stops[0].arrive, to: 1 });
  let hidden = false;
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    if (hidden) {
      const into = moves.find((m) => m.to === stop);
      fades.push({ t: into ? into.start : stop.arrive, to: 1 });
      hidden = false;
    }
    if (stop.key.hide) {
      fades.push({ t: stop.key.t, to: 0 });
      hidden = true;
    }
  }
  return { stops, moves, drags, fades };
}

/** Where the pointer is at `l`, how pressed and how seen. */
export function pointerAt(plan: PointerPlan, l: number): PointerState {
  const { stops, moves, drags, fades } = plan;
  if (!stops.length) return { x: 0, y: 0, scale: 1, opacity: 0, held: false };
  let x = stops[0].x;
  let y = stops[0].y;
  for (const m of moves) {
    if (l >= m.end) {
      x = m.to.x;
      y = m.to.y;
      continue;
    }
    if (l >= m.start) {
      const p = aimed((l - m.start) / (m.end - m.start));
      const u = 1 - p;
      x = u * u * m.from.x + 2 * u * p * m.cx + p * p * m.to.x;
      y = u * u * m.from.y + 2 * u * p * m.cy + p * p * m.to.y;
    }
    break;
  }

  let scale = 1;
  for (const stop of stops) {
    if (stop.key.press) scale = Math.min(scale, 1 - 0.16 * Math.sin(Math.PI * seg(l, stop.key.t, POINTER.press)));
  }
  let held = false;
  for (const drag of drags) {
    const from = drag.down.key.t;
    const to = drag.up.key.t;
    if (l >= from && l < to) held = true;
    if (l >= from && l < to + POINTER.release) scale = Math.min(scale, 1 - 0.12 * ease.out(seg(l, from, 90)) * (1 - ease.inOut(seg(l, to, POINTER.release))));
  }

  let shown = 0;
  let before = 0;
  for (const fade of fades) {
    if (l >= fade.t) shown = fade.to;
    else if (l >= fade.t - POINTER.fade) shown = mix(before, fade.to, ease.inOut(seg(l, fade.t - POINTER.fade, POINTER.fade)));
    else break;
    before = fade.to;
  }
  return { x, y, scale, opacity: shown, held };
}

/**
 * An element's box in the UI box (UI px) from the layout: offsets up to the UI box, so neither the stage's scale nor a
 * transform that moves the element for a moment (rising in, a press) changes it. Elements outside the offset chain
 * (an SVG) are read from their rects, the scale divided out.
 */
export function boxIn(el: HTMLElement, ui: HTMLElement): Box {
  let x = 0;
  let y = 0;
  let node: Element | null = el;
  while (node instanceof HTMLElement && node !== ui) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
    if (node instanceof HTMLElement && node !== ui) {
      x += node.clientLeft;
      y += node.clientTop;
    }
  }
  if (node === ui) return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  const outer = ui.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const scale = ui.offsetWidth > 0 ? outer.width / ui.offsetWidth : 1;
  return { x: (rect.left - outer.left) / scale, y: (rect.top - outer.top) / scale, w: rect.width / scale, h: rect.height / scale };
}

/** A box's point at (fx, fy). */
export const at = (box: Box, fx = 0.5, fy = 0.5) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });

/** The moment of the key that aims at `aim` with a press (or a down or up), the `nth` such: scenes time the UI by it. */
export function pressAt(keys: readonly CursorKey[], aim: string, nth = 0): number {
  const found = keys.filter((key) => key.aim === aim && (key.press || key.down || key.up))[nth];
  if (!found) throw new Error(`No press on ${aim}`);
  return found.t;
}

/** One pointer of a scene: its keys, its targets measured in the scene's UI box, and the plan made from them. */
export class Pointer {
  plan: PointerPlan;
  readonly boxes = new Map<string, Box>();
  readonly targets = new Map<string, HTMLElement>();

  /** `extra`: more elements (by data-aim) whose boxes the scene needs, e.g. a carried element's own place. */
  constructor(
    readonly keys: readonly CursorKey[],
    readonly extra: readonly string[] = [],
  ) {
    for (let i = 1; i < keys.length; i += 1) if (keys[i].t < keys[i - 1].t) throw new Error(`Pointer keys out of order at ${keys[i].t}`);
    this.plan = planPointer(keys, () => null);
  }

  /** Every aim the keys name, drop targets included, and the extra ones. */
  aims(): string[] {
    const names = new Set<string>(this.extra);
    for (const key of this.keys) {
      if (key.aim) names.add(key.aim);
      if (key.over) names.add(key.over);
    }
    return Array.from(names);
  }

  /** Reads the targets' boxes from the layout and plans again. */
  measure(ui: HTMLElement): void {
    for (const aim of this.aims()) {
      const el = ui.querySelector<HTMLElement>(`[data-aim="${aim}"]`);
      if (!el) continue;
      this.targets.set(aim, el);
      this.boxes.set(aim, boxIn(el, ui));
    }
    this.plan = planPointer(this.keys, (aim) => this.boxes.get(aim));
  }

  at(l: number): PointerState {
    return pointerAt(this.plan, l);
  }

  box(aim: string): Box | undefined {
    return this.boxes.get(aim);
  }

  /** The drag going on at `l` (its index), or -1. */
  dragAt(l: number): number {
    return this.plan.drags.findIndex((drag) => l >= drag.down.key.t && l < drag.up.key.t);
  }

  /** The button is down and the pointer is over `aim`. */
  over(aim: string, l: number, state: PointerState = this.at(l)): boolean {
    const box = this.boxes.get(aim);
    return !!box && state.held && state.x >= box.x && state.x <= box.x + box.w && state.y >= box.y && state.y <= box.y + box.h;
  }

  /** The targets' states at `l`: hover from the arrival to the press, pressed for the dip, a handle dimmed while its
   * block is carried, a drop target lit while the held pointer is over it. */
  flags(l: number, state: PointerState = this.at(l)): void {
    for (const [aim, el] of this.targets) {
      let hover = false;
      let pressed = false;
      let grabbed = false;
      for (const stop of this.plan.stops) {
        const { key } = stop;
        if (key.aim !== aim || key.outside) continue;
        if ((key.press || key.down) && l >= stop.arrive && l < key.t) hover = true;
        if (key.press && l >= key.t && l < key.t + POINTER.press) pressed = true;
      }
      for (const drag of this.plan.drags) {
        const { key } = drag.down;
        if (key.aim === aim && !key.outside && l >= key.t && l < drag.up.key.t) grabbed = true;
      }
      const lit = this.plan.drags.some((drag) => drag.up.key.over === aim) && this.over(aim, l, state);
      flag(el, 'is-hover', hover);
      flag(el, 'is-pressed', pressed);
      flag(el, 'is-grabbed', grabbed);
      flag(el, 'is-over', lit);
    }
  }
}

/** A scene's pointer, one per mounted scene (its boxes are this scene's own). */
export function usePointer(keys: readonly CursorKey[], extra?: readonly string[]): Pointer {
  const ref = useRef<Pointer | null>(null);
  if (!ref.current || ref.current.keys !== keys) ref.current = new Pointer(keys, extra);
  return ref.current;
}

/**
 * The pointer on the stage: a child of the scene's UI box (.r3-ui), drawn in its px. It measures its targets when it
 * is put on the stage, when their sizes change (a font coming in) and when the stage is resized, and draws the
 * pointer and its targets' states on every frame from the plan alone.
 */
export function Cursor({ pointer }: { pointer: Pointer }) {
  const root = useRef<HTMLSpanElement>(null);
  const clock = useClock();
  const stageScale = useStageScale();
  useLayoutEffect(() => {
    const ui = root.current?.closest<HTMLElement>('.r3-ui');
    if (!ui) return undefined;
    pointer.measure(ui);
    // The frame exporter's checks read the plans (scripts/reel3-pointer-check.mjs).
    const scene = ui.closest<HTMLElement>('[data-scene]')?.dataset.scene;
    if (scene && window.__MELDY_REEL_EXPORT__ === true) (window.__meldyPointers ??= {})[scene] = pointer;
    let queued = 0;
    const again = () => {
      queued = 0;
      pointer.measure(ui);
      // A still reel (paused, the poster, the frame exporter) draws the new plan at once.
      if (!clock.isPlaying) clock.seek(clock.time);
    };
    const later = () => {
      if (!queued) queued = requestAnimationFrame(again);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    observer?.observe(ui);
    pointer.targets.forEach((el) => observer?.observe(el));
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', later);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      observer?.disconnect();
      fonts?.removeEventListener?.('loadingdone', later);
    };
  }, [pointer, clock, stageScale]);
  useFrame((l) => {
    const state = pointer.at(l);
    opacity(root.current, state.opacity);
    if (state.opacity > 0) move(root.current, state.x, state.y, state.scale);
    pointer.flags(l, state);
  });
  return (
    <span ref={root} className="r3-cursor" aria-hidden="true" style={{ opacity: 0 }}>
      <svg viewBox="0 0 24 24">
        <path d="M5 3l14 8-6 1.6L10 19z" fill="#0b121c" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export interface CarryOptions {
  /** The element's own place (UI px): its transform is relative to it. Without it, the UI box's corner. */
  rest?: { x: number; y: number };
  /** Where on the element the pointer holds it (element px). */
  grab: { x: number; y: number };
  /** On release it settles here (its corner, UI px), growing to `settleScale`, and fades; without it, it stays. */
  settle?: { x: number; y: number };
  settleScale?: number;
  /** Shown from this moment (default: the button going down); without `fade`, only moved (the scene shows it). */
  from?: number;
  fade?: boolean;
  /** How much it lifts while carried. */
  lift?: number;
}

const SETTLE = 200;

/**
 * A block carried by the pointer in its `index`-th drag: lifted where it was grabbed, then held exactly under the
 * pointer (the same point of it under the tip all the way), and on release settled into its place. Transform and
 * opacity only (transform-origin 0 0 in reel3.css).
 */
export function carry(el: HTMLElement | null | undefined, pointer: Pointer, l: number, index: number, options: CarryOptions): void {
  const drag = pointer.plan.drags[index];
  if (!el || !drag) return;
  const down = drag.down.key.t;
  const up = drag.up.key.t;
  const { grab, settle } = options;
  const rest = options.rest ?? { x: 0, y: 0 };
  const lift = options.lift ?? 1.04;
  const fade = options.fade ?? true;
  const from = options.from ?? down;
  if (fade) opacity(el, l < from ? 0 : settle ? 1 - ease.in(seg(l, up + 40, SETTLE - 40)) : 1);
  if (l < from) return;
  if (l < up) {
    const state = pointer.at(l);
    const s = mix(1, lift, ease.out(seg(l, down, 120)));
    move(el, state.x - grab.x * s - rest.x, state.y - grab.y * s - rest.y, s);
    return;
  }
  const end = pointer.at(up);
  const x0 = end.x - grab.x * lift;
  const y0 = end.y - grab.y * lift;
  if (settle) {
    const q = ease.out(seg(l, up, SETTLE));
    move(el, mix(x0, settle.x, q) - rest.x, mix(y0, settle.y, q) - rest.y, mix(lift, options.settleScale ?? 1, q));
    return;
  }
  // Let go where it is: it lands (its lift goes) with its held point staying under the tip.
  const s = mix(lift, 1, ease.out(seg(l, up, 160)));
  move(el, end.x - grab.x * s - rest.x, end.y - grab.y * s - rest.y, s);
}
