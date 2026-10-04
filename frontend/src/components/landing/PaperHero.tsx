import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { animate, cancelFrame, frame, useMotionValue, useMotionValueEvent } from 'framer-motion';
import {
  CANVAS,
  REPLAY,
  SKIP_RATE,
  SPRING,
  START_AT,
  UNDERLINE_DROP,
  buildTimeline,
  defaultGeometry,
  sceneAt,
  skipFrom,
  stepStills,
  type PaperGeometry,
  type Timeline,
  type Variant,
} from './paperTimeline';
import { handPoints, pointBounds, taperedOutline, type Pt } from './handStroke';
import { ZAVTRA } from './zavtraPath';
import { readVariant, usePaperGeometry, type PaperMeasure } from './usePaperGeometry';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { usePageVisible } from './usePageVisible';
import { CARD_QUESTION, HERO_PAGE, KEY_SENTENCE } from './lecture';
import { ty } from './typo';
import './PaperHero.css';

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

const KEY_WORDS = KEY_SENTENCE.split(' ');
const plain = (text: string) => text.replace(/ /g, ' ');
export const HERO_QUESTION = CARD_QUESTION;
export const FACE_TEXT = {
  question: `Вопрос: ${HERO_QUESTION}`,
  answer: `Ответ: ${plain(KEY_SENTENCE)}`,
};
const CAPTION = `Пример. На странице лекции «${HERO_PAGE.title}» Meldy подчёркивает главную фразу «${plain(KEY_SENTENCE).replace(/\.$/, '')}» и переносит её на карточку. На лицевой стороне карточки вопрос «${HERO_QUESTION}», на обороте эта фраза. Карточка вернётся на повторение завтра.`;
/** Under the card: the card is what the answer missed (Jury_Check section 4, step 1). */
export const INVITE_TEXT = ty('Что вы пропустили на ответе, Meldy спросит завтра.');
export const STEPS_TEXT = 'Показать по шагам';

export const SEEN_KEY = 'meldy:landing-hero-seen';
const FONT_SPECS = ['600 56px "Onest Variable"', '420 17px "Literata Variable"', '600 38px "Literata Variable"'];
const FONT_SAMPLE = 'Спрос эластичен, «завтра» — цена?';
const FONT_TIMEOUT = 1500;
const STEP_FADE = 200;
const STEP_HOLD = 1400;
/** First visit with fonts still loading: the scene fades in once they arrive. */
const ARRIVE_MS = 320;
/** will-change is dropped this long after the last visitor-driven motion stops. */
const LIVE_REST_MS = 400;

/**
 * The landing chunk's CSS (with the @font-face rules) is loaded before this module runs,
 * so the font downloads can start now instead of after the first render.
 */
function warmFonts() {
  try {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts || typeof fonts.load !== 'function') return;
    for (const spec of FONT_SPECS) fonts.load(spec, FONT_SAMPLE).catch(() => {});
  } catch {
    /* the gate in the component still waits for the fonts */
  }
}
warmFonts();

/* ------------------------------------------------------------------ */
/* Small environment helpers                                           */
/* ------------------------------------------------------------------ */

export type Phase = 'waiting' | 'playing' | 'settling' | 'done' | 'replaying' | 'steps' | 'frozen';
const CLOCK_PHASES: ReadonlySet<Phase> = new Set(['playing', 'settling']);
/** Phases that end at once (on the final frame) when the hero leaves the viewport. */
const LEAVE_PHASES: ReadonlySet<Phase> = new Set(['playing', 'settling', 'replaying']);

function readSeen() {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage can be blocked; the intro simply plays again */
  }
}

interface QaParams { t: number | 'end' | null; fresh: boolean; answer: boolean }

function readQa(): QaParams {
  try {
    const q = new URLSearchParams(window.location.search);
    const raw = q.get('hero-t');
    const t = raw === null ? null : raw === 'end' ? 'end' : Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : null;
    return { t, fresh: q.get('hero-fresh') === '1', answer: q.get('hero-answer') === '1' };
  } catch {
    return { t: null, fresh: false, answer: false };
  }
}

function fontsAlreadyLoaded() {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts || typeof fonts.check !== 'function') return true;
  try {
    return FONT_SPECS.every(spec => fonts.check(spec, FONT_SAMPLE));
  } catch {
    return true;
  }
}

const matches = (query: string) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/** Writes a style/attribute only when it changed, so idle frames touch nothing. */
function makeWriter() {
  const cache = new WeakMap<Element, Map<string, string>>();
  const seen = (el: Element, key: string, value: string) => {
    let entry = cache.get(el);
    if (!entry) {
      entry = new Map();
      cache.set(el, entry);
    }
    if (entry.get(key) === value) return true;
    entry.set(key, value);
    return false;
  };
  return {
    style(el: HTMLElement | SVGElement | null | undefined, prop: string, value: string) {
      if (!el || seen(el, prop, value)) return;
      el.style.setProperty(prop, value);
    },
    attr(el: Element | null | undefined, name: string, value: string) {
      if (!el || seen(el, `@${name}`, value)) return;
      el.setAttribute(name, value);
    },
  };
}

const px = (v: number) => `${v.toFixed(2)}px`;
const deg = (v: number) => `${v.toFixed(3)}deg`;
const num = (v: number, digits = 3) => v.toFixed(digits);

/* ------------------------------------------------------------------ */
/* Pencil shapes                                                       */
/* ------------------------------------------------------------------ */

interface UnderlineShape {
  pts: Pt[];
  outline: string;
  /** Box of this stroke in page coordinates (+3 px). */
  box: { x: number; y: number; w: number; h: number };
  /** Where the pencil starts and stops along x, inside the box. */
  from: number;
  to: number;
}

function underlineShapes(g: PaperGeometry): UnderlineShape[] {
  return g.lines.map((line, i) => {
    const last = i === g.lines.length - 1;
    const pts = handPoints(line.x0 - 3, line.x1 + (last ? 2 : 4), line.baseline + UNDERLINE_DROP * g.fs, 100 + 31 * i, { rise: 1.1 + 0.3 * i, flick: last });
    const box = pointBounds([pts], 3);
    const xs = pts.map(p => p[0]);
    return { pts, outline: taperedOutline(pts, 2.7, 0.7), box, from: Math.min(...xs) - box.x - 1.5, to: Math.max(...xs) - box.x + 1.5 };
  });
}

/** The key sentence plus its drawn underline, laid out line by line at page size. */
function SentenceCopy({ geo, baseline, shapes }: { geo: PaperGeometry; baseline: number; shapes: UnderlineShape[] }) {
  return (
    <>
      {geo.lines.map((line, i) => (
        <span
          key={i}
          className="ph-ln"
          style={{
            fontSize: `${geo.fs}px`,
            left: `${line.x0 - geo.rect.x}px`,
            top: `${line.baseline - geo.rect.y - baseline}px`,
          }}
        >
          {line.text}
        </span>
      ))}
      <svg className="ph-marks" width={geo.rect.w} height={geo.rect.h} aria-hidden="true" focusable="false">
        <g transform={`translate(${-geo.rect.x} ${-geo.rect.y})`}>
          {shapes.map((shape, i) => <path key={i} className="ph-ink" d={shape.outline} />)}
        </g>
      </svg>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/**
 * Hero visual «Строчка → карточка»: Meldy's pencil underlines the key sentence of a lecture
 * page, the sentence peels off as a slip and is carried onto an index card, and the card
 * turns to the question it answers, with «завтра» written in the corner. ≈3.5 s once, then
 * still. A click on the underlined sentence plays the take again.
 */
export default function PaperHero() {
  const reduced = usePrefersReducedMotion();
  const pageVisible = usePageVisible();
  const qa = useMemo(readQa, []);

  /* ---------- refs ---------- */
  const fitRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const pageTextRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLParagraphElement>(null);
  const c2Ref = useRef<HTMLDivElement>(null);
  const c3Ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLButtonElement>(null);
  const baseRef = useRef<HTMLSpanElement>(null);
  const liftRef = useRef<HTMLSpanElement>(null);
  const flipperRef = useRef<HTMLSpanElement>(null);
  const faceARef = useRef<HTMLSpanElement>(null);
  const faceBRef = useRef<HTMLSpanElement>(null);
  const shadeARef = useRef<HTMLSpanElement>(null);
  const shadeBRef = useRef<HTMLSpanElement>(null);
  const lightARef = useRef<HTMLSpanElement>(null);
  const lightBRef = useRef<HTMLSpanElement>(null);
  const qInRef = useRef<HTMLSpanElement>(null);
  const stripPosRef = useRef<HTMLSpanElement>(null);
  const stripRef = useRef<HTMLSpanElement>(null);
  const stripEdgeRef = useRef<HTMLSpanElement>(null);
  const stripShadowRef = useRef<HTMLSpanElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  const inviteRef = useRef<HTMLParagraphElement>(null);
  const ulLineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const zavRefs = useRef<Array<SVGPathElement | null>>([]);
  const geoRefs = useMemo(() => ({ fit: fitRef, scene: sceneRef, page: pageRef, pageText: pageTextRef, key: keyRef }), []);

  /* ---------- clock and interaction values ---------- */
  const time = useMotionValue(START_AT);
  const userFlip = useMotionValue(qa.answer ? 180 : 0);
  const hover = useMotionValue(0);
  const press = useMotionValue(0);
  const inviteOut = useMotionValue(0);
  /** Where the visitor's turns are heading: +180° per turn, always the same way round. */
  const flipTargetRef = useRef(qa.answer ? 180 : 0);

  const initialPhase = useMemo<Phase>(() => {
    if (qa.answer) return 'done';
    if (qa.t !== null) return qa.t === 'end' ? 'done' : 'frozen';
    if (reduced) return 'done';
    if (readSeen() && !qa.fresh) return 'done';
    return 'waiting';
    // first render only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [phase, setPhaseState] = useState<Phase>(initialPhase);
  const phaseRef = useRef<Phase>(initialPhase);

  const [answerShown, setAnswerShown] = useState(qa.answer);
  const answerRef = useRef(qa.answer);
  const [live, setLive] = useState('');
  const [fontState, setFontState] = useState<'pending' | 'arrived' | 'ready'>(() => (fontsAlreadyLoaded() ? 'ready' : 'pending'));
  const fontsReady = fontState !== 'pending';
  const [seenInView, setSeenInView] = useState({ key: false, card: false });
  const [variant, setVariant] = useState<Variant>(readVariant);

  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const loopRef = useRef({ running: false, last: -1 });
  const vhRef = useRef(typeof window === 'undefined' ? 900 : window.innerHeight);
  const timersRef = useRef<number[]>([]);
  const liveTimerRef = useRef(0);
  const writer = useMemo(makeWriter, []);

  /* ---------- geometry ---------- */
  const geoRef = useRef<PaperGeometry | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const fitRef2 = useRef<() => void>(() => {});
  const measure: PaperMeasure | null = usePaperGeometry(geoRefs, fontsReady, () => fitRef2.current());
  const geo = measure?.geo ?? null;
  const timeline = useMemo(() => (geo ? buildTimeline(geo) : null), [geo]);
  const shapes = useMemo(() => (geo ? underlineShapes(geo) : []), [geo]);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  geoRef.current = geo;
  timelineRef.current = timeline;

  /* ---------- rendering: one pure scene per frame, written straight to the DOM ---------- */
  const rotating = () => userFlip.isAnimating();
  const anyMoving = () => rotating() || hover.isAnimating() || press.isAnimating();

  /**
   * will-change only while the visitor is at the card: a turn, the hover lift or a press
   * would otherwise re-raster the whole card every frame. It is dropped at rest, so text stays crisp.
   */
  const restLive = () => {
    const scene = sceneRef.current;
    if (!scene || scene.dataset.live !== 'true' || liveTimerRef.current || anyMoving()) return;
    liveTimerRef.current = window.setTimeout(() => {
      liveTimerRef.current = 0;
      if (anyMoving()) return; // that motion's own completion re-arms the timer
      delete scene.dataset.live;
    }, LIVE_REST_MS);
  };

  const renderNow = useCallback(() => {
    const g = geoRef.current;
    const W = timelineRef.current;
    if (!g || !W) return;
    const w = writer;
    const s = sceneAt(time.get(), g, W, {
      userFlip: userFlip.get(),
      hover: hover.get(),
      press: reducedRef.current ? 0 : press.get(),
      inviteOut: inviteOut.get(),
      moving: rotating(),
    });

    w.style(pageRef.current, 'transform', `rotate(${deg(g.page.rot)})`);
    // The pencil line is revealed by a clip that follows the pen along x. (Animating dash
    // offsets inside an SVG mask would invalidate the mask and force SVG layout every frame.)
    ulLineRefs.current.forEach((el, i) => {
      const shape = shapesRef.current[i];
      if (!el || !shape) return;
      const p = s.ul[i] ?? 0;
      const reveal = shape.from + (shape.to - shape.from) * p;
      w.style(el, 'clip-path', `inset(0px ${Math.max(0, shape.box.w - reveal).toFixed(2)}px 0px 0px)`);
      w.style(el, 'visibility', p > 0.001 ? 'inherit' : 'hidden');
    });

    // The slip and its shadow live in the card's answer face (card coordinates). Written even
    // while hidden, so nothing is created or laid out mid-flight; idle frames write nothing.
    const sw = g.rect.w / 2;
    const sh = g.rect.h / 2;
    const stripShown = s.strip.visible ? 'inherit' : 'hidden';
    w.style(stripPosRef.current, 'visibility', stripShown);
    w.style(stripPosRef.current, 'opacity', num(s.strip.opacity));
    w.style(stripPosRef.current, 'transform', `translate(${px(s.strip.x - sw)}, ${px(s.strip.y - sh)}) rotate(${deg(s.strip.rot)}) scale(${num(s.strip.scale, 4)})`);
    const peeling = Math.abs(s.strip.peelX) > 1e-3 || Math.abs(s.strip.peelY) > 1e-3;
    w.style(stripRef.current, 'transform', peeling ? `perspective(800px) rotateY(${num(s.strip.peelY, 2)}deg) rotateX(${num(s.strip.peelX, 2)}deg)` : 'none');
    w.style(stripEdgeRef.current, 'opacity', num(s.strip.edge));
    const shadowShown = s.shadow.opacity > 0.002 ? 'inherit' : 'hidden';
    w.style(stripShadowRef.current, 'visibility', shadowShown);
    w.style(stripShadowRef.current, 'opacity', num(s.shadow.opacity));
    w.style(stripShadowRef.current, 'transform', `translate(${px(s.shadow.x - sw + 18)}, ${px(s.shadow.y - sh + 18)}) rotate(${deg(s.shadow.rot)}) scale(${num(s.shadow.scale, 4)})`);

    const left = g.card.cx - g.card.w / 2;
    const top = g.card.cy - g.card.h / 2;
    w.style(c2Ref.current, 'transform', `translate(${px(left + g.deck.c2.dx)}, ${px(top + g.deck.c2.dy)}) rotate(${deg(s.deck.c2)})`);
    w.style(c3Ref.current, 'transform', `translate(${px(left + g.deck.c3.dx)}, ${px(top + g.deck.c3.dy)}) rotate(${deg(s.deck.c3)})`);
    w.style(cardRef.current, 'transform', `translate(${px(left)}, ${px(top)}) rotate(${deg(s.card.rot)}) scale(${num(s.card.scale, 4)})`);

    const face = s.card;
    // The card rises off its shadows while it turns: the flipper moves, the shadow spans stay.
    w.style(flipperRef.current, 'transform', face.atRest ? 'none' : `translateY(${px(-face.rise)}) perspective(${g.perspective}px) rotateY(${num(face.theta, 2)}deg)`);
    w.attr(flipperRef.current, 'data-face', face.back ? 'question' : 'answer');
    if (reducedRef.current) {
      // Reduced motion: the faces cross-fade (CSS, 150 ms); nothing turns.
      w.style(faceARef.current, 'visibility', 'inherit');
      w.style(faceBRef.current, 'visibility', 'inherit');
      w.style(faceARef.current, 'opacity', face.back ? '0' : '1');
      w.style(faceBRef.current, 'opacity', face.back ? '1' : '0');
    } else {
      w.style(faceARef.current, 'opacity', '1');
      w.style(faceBRef.current, 'opacity', '1');
      w.style(faceARef.current, 'visibility', face.back ? 'hidden' : 'inherit');
      w.style(faceBRef.current, 'visibility', face.back ? 'inherit' : 'hidden');
    }
    w.style(qInRef.current, 'transform', face.mirror ? 'scaleX(-1)' : 'scaleX(1)');
    w.style(baseRef.current, 'opacity', num(face.base));
    w.style(liftRef.current, 'opacity', num(face.lift));
    for (const el of [shadeARef.current, shadeBRef.current]) w.style(el, 'opacity', num(face.shade));
    for (const el of [lightARef.current, lightBRef.current]) w.style(el, 'opacity', num(face.light));

    zavRefs.current.forEach((path, i) => {
      const p = s.zav[i] ?? 0;
      w.attr(path, 'stroke-dashoffset', num(1 - p, 4));
      w.style(path, 'visibility', p > 0.001 ? 'inherit' : 'hidden');
    });
    w.style(inviteRef.current, 'opacity', num(s.invite));
    restLive();
    // userFlip, hover, press and inviteOut are stable motion values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, writer]);

  const scheduleRender = useCallback(() => {
    frame.render(renderNow);
  }, [renderNow]);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
    scheduleRender();
  }, [scheduleRender]);

  useMotionValueEvent(time, 'change', scheduleRender);
  useMotionValueEvent(userFlip, 'change', scheduleRender);
  useMotionValueEvent(userFlip, 'animationComplete', scheduleRender);
  useMotionValueEvent(hover, 'change', scheduleRender);
  useMotionValueEvent(hover, 'animationComplete', scheduleRender);
  useMotionValueEvent(press, 'change', scheduleRender);
  useMotionValueEvent(press, 'animationComplete', scheduleRender);
  useMotionValueEvent(inviteOut, 'change', scheduleRender);

  const goLive = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (liveTimerRef.current) {
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = 0;
    }
    if (scene.dataset.live !== 'true') scene.dataset.live = 'true';
    scheduleRender();
  }, [scheduleRender]);

  /* ---------- fit: the design canvas scales down to the column (width changes only) ---------- */
  const fit = useCallback(() => {
    const fitEl = fitRef.current;
    const stage = stageRef.current;
    const scene = sceneRef.current;
    const below = belowRef.current;
    if (!fitEl || !stage || !scene) return;
    const v = geoRef.current?.variant ?? readVariant();
    // Before the paper is measured the stage keeps its design size, so nothing moves when fonts land.
    const g = geoRef.current ?? defaultGeometry(v, window.devicePixelRatio || 1);
    const cw = g.canvas.w;
    const ch = g.canvas.h;
    const colW = fitEl.clientWidth;
    let k = colW > 0 ? Math.min(1, colW / cw) : 1;
    if (matches('(min-width: 1024px)') && vhRef.current > 0) k = Math.min(k, (vhRef.current - 192) / ch);
    k = Math.max(0.25, k);
    scene.style.transform = k < 1 ? `scale(${k.toFixed(4)})` : '';
    scene.style.height = `${ch}px`;
    stage.style.height = `${(ch * k).toFixed(2)}px`;
    if (below) {
      // The caption sits under the card: its left edge and its width.
      const cardLeft = (g.card.cx - g.card.w / 2) * k;
      below.style.marginLeft = `${Math.max(0, cardLeft).toFixed(2)}px`;
      below.style.maxWidth = `${Math.max(220, g.card.w * k).toFixed(0)}px`;
    }
    setVariant(prev => (prev === v ? prev : v));
  }, []);
  fitRef2.current = fit;

  /* ---------- the clock ---------- */
  const finish = useCallback(() => {
    const W = timelineRef.current;
    if (W) time.set(W.end);
    writeSeen();
    setPhase('done');
  }, [setPhase, time]);

  const tick = useCallback((data: { timestamp: number }) => {
    const W = timelineRef.current;
    const loop = loopRef.current;
    if (!W) return;
    const dt = loop.last < 0 ? 0 : Math.min(64, Math.max(0, data.timestamp - loop.last)) / 1000;
    loop.last = data.timestamp;
    const current = phaseRef.current;
    if (current !== 'playing' && current !== 'settling') {
      stopLoopRef.current();
      return;
    }
    const t = time.get() + dt * (current === 'settling' ? SKIP_RATE : 1);
    if (t >= W.end) {
      stopLoopRef.current();
      finish();
    } else {
      time.set(t);
    }
  }, [finish, time]);

  const startLoop = useCallback(() => {
    const loop = loopRef.current;
    if (loop.running) return;
    loop.running = true;
    loop.last = -1;
    frame.update(tick, true);
  }, [tick]);
  const stopLoop = useCallback(() => {
    const loop = loopRef.current;
    if (!loop.running) return;
    loop.running = false;
    cancelFrame(tick);
  }, [tick]);
  const stopLoopRef = useRef(stopLoop);
  stopLoopRef.current = stopLoop;

  useEffect(() => {
    if (CLOCK_PHASES.has(phase) && pageVisible) startLoop();
    else stopLoop();
  }, [phase, pageVisible, startLoop, stopLoop]);

  useEffect(() => () => {
    stopLoop();
    timersRef.current.forEach(id => window.clearTimeout(id));
    window.clearTimeout(liveTimerRef.current);
  }, [stopLoop]);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter(x => x !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  /** Fades the whole visual (scene and caption) for a replay. */
  const fadeFit = useCallback((to: number, ms: number, ease: string) => {
    const el = fitRef.current;
    if (!el) return;
    el.style.transition = ms > 0 ? `opacity ${ms}ms ${ease}` : '';
    el.style.opacity = to === 1 ? '' : String(to);
  }, []);

  /**
   * Skip: whatever is before the touch is cut (the deck's dip makes the cut read as the
   * landing), then the rest plays at 2.5×; no frame jumps more than ~42 ms of the story.
   */
  const settle = useCallback(() => {
    const W = timelineRef.current;
    if (phaseRef.current !== 'playing' || !W) return;
    const from = time.get();
    const to = skipFrom(from, W);
    if (to !== from) time.jump(to);
    setPhase('settling');
  }, [setPhase, time]);

  /** The hero left the viewport mid-play: no catching up later, show the end. */
  const settleNow = useCallback(() => {
    if (!LEAVE_PHASES.has(phaseRef.current)) return;
    stopLoop();
    fadeFit(1, 0, '');
    inviteOut.jump(0);
    finish();
  }, [fadeFit, finish, inviteOut, stopLoop]);

  /* ---------- geometry changes: pin the clock, fit, draw ---------- */
  useLayoutEffect(() => {
    if (!timeline) return;
    const current = phaseRef.current;
    if (current === 'done') time.jump(timeline.end);
    else if (current === 'frozen' && typeof qa.t === 'number') time.jump(qa.t);
    else if (current === 'waiting') time.jump(START_AT);
    else if (time.get() > timeline.end) time.jump(timeline.end);
    fit();
    renderNow();
  }, [timeline, measure, fit, renderNow, time, qa.t]);

  /* ---------- the gate ---------- */
  useEffect(() => {
    if (fontsReady) return;
    const fonts = document.fonts;
    let alive = true;
    const ready = () => { if (alive) setFontState(prev => (prev === 'pending' ? 'arrived' : prev)); };
    const timer = window.setTimeout(ready, FONT_TIMEOUT);
    Promise.all(FONT_SPECS.map(spec => fonts.load(spec, FONT_SAMPLE))).then(ready, ready);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The scene that waited for its fonts fades in (CSS) instead of popping in. */
  useEffect(() => {
    if (fontState !== 'arrived') return;
    const id = window.setTimeout(() => setFontState('ready'), ARRIVE_MS);
    return () => window.clearTimeout(id);
  }, [fontState]);

  useEffect(() => {
    const key = keyRef.current;
    const card = cardRef.current;
    const scene = sceneRef.current;
    if (!key || !card || !scene) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeenInView({ key: true, card: true });
      return;
    }
    const ratios = new Map<Element, number>([[key, 0], [card, 0], [scene, 0]]);
    let sceneSeen = false;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        if (entry.target === scene) sceneSeen = true;
      }
      const next = { key: (ratios.get(key) ?? 0) >= 0.99, card: (ratios.get(card) ?? 0) >= 0.6 };
      setSeenInView(prev => (prev.key === next.key && prev.card === next.card ? prev : next));
      if (sceneSeen && (ratios.get(scene) ?? 0) < 0.2) settleNow();
    }, { threshold: [0, 0.2, 0.6, 0.99, 1], rootMargin: '-72px 0px 0px 0px' });
    observer.observe(key);
    observer.observe(card);
    observer.observe(scene);
    return () => observer.disconnect();
  }, [settleNow]);

  useEffect(() => {
    if (phase !== 'waiting' || !timeline) return;
    if (!fontsReady || !seenInView.key || !seenInView.card || !pageVisible || reduced) return;
    if (readSeen() && !qa.fresh) {
      finish();
      return;
    }
    time.jump(START_AT);
    setPhase('playing');
  }, [phase, timeline, fontsReady, seenInView, pageVisible, reduced, qa.fresh, finish, setPhase, time]);

  /* A live switch to reduced motion ends any intro at once. */
  useEffect(() => {
    if (!reduced) return;
    if (phaseRef.current === 'waiting' || LEAVE_PHASES.has(phaseRef.current)) {
      stopLoop();
      fadeFit(1, 0, '');
      inviteOut.jump(0);
      finish();
    } else {
      renderNow();
    }
  }, [reduced, fadeFit, finish, inviteOut, renderNow, stopLoop]);

  /* Esc skips while playing and finishes the fast-forward (not while typing somewhere). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = phaseRef.current;
      if (current !== 'playing' && current !== 'settling') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (current === 'playing') settle();
      else finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, settle]);

  /* Hover is only animated at rest; a pointer that waited on the card through the intro gets its lift now. */
  const hoverEnabled = useMemo(() => matches('(hover: hover) and (pointer: fine)'), []);
  useEffect(() => {
    if (phase !== 'done' || reduced || !hoverEnabled) return;
    const card = cardRef.current;
    let hovered = false;
    try {
      hovered = !!card?.matches(':hover');
    } catch {
      hovered = false;
    }
    if (!hovered || hover.get() > 0.99 || hover.isAnimating()) return;
    goLive();
    animate(hover, 1, { type: 'spring', stiffness: SPRING.hover[0], damping: SPRING.hover[1] });
  }, [phase, reduced, hoverEnabled, hover, goLive]);

  /* ---------- visitor actions ---------- */
  const flipCard = useCallback(() => {
    const toAnswer = !answerRef.current;
    answerRef.current = toAnswer;
    setAnswerShown(toAnswer);
    flipTargetRef.current += 180;
    const target = flipTargetRef.current;
    if (reducedRef.current) userFlip.jump(target);
    else {
      goLive();
      animate(userFlip, target, { type: 'spring', stiffness: SPRING.userFlip[0], damping: SPRING.userFlip[1] });
    }
    if (inviteOut.get() < 1) animate(inviteOut, 1, { duration: 0.2, ease: 'easeOut' });
    setLive(toAnswer ? FACE_TEXT.answer : FACE_TEXT.question);
  }, [goLive, inviteOut, userFlip]);

  const onCardClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const current = phaseRef.current;
    if (current === 'playing') settle();
    else if (current === 'settling') {
      // A second click during the fast-forward: finish now and turn the card.
      finish();
      flipCard();
    } else if (current === 'done') flipCard();
  };

  const onFigureClick = () => {
    const current = phaseRef.current;
    if (current === 'playing') settle();
    else if (current === 'settling') finish();
  };

  const runSteps = useCallback(() => {
    const W = timelineRef.current;
    const scene = sceneRef.current;
    if (!W || !scene || phaseRef.current === 'steps') return;
    const stills = stepStills(W);
    answerRef.current = false;
    setAnswerShown(false);
    flipTargetRef.current = 0;
    userFlip.jump(0);
    inviteOut.jump(0);
    setPhase('steps');
    let i = 0;
    const show = () => {
      scene.style.transition = `opacity ${STEP_FADE}ms ease`;
      scene.style.opacity = '0';
      later(() => {
        time.jump(stills[i]);
        renderNow();
        scene.style.opacity = '1';
        i += 1;
        if (i < stills.length) later(show, STEP_HOLD);
        else later(() => {
          scene.style.transition = '';
          setPhase('done');
        }, STEP_FADE * 2);
      }, STEP_FADE);
    };
    show();
  }, [inviteOut, later, renderNow, setPhase, time, userFlip]);

  /**
   * A click on the underlined sentence plays the take again: the visual fades out, everything
   * is reset while it is invisible, and it fades back in as the clock starts (START_AT's
   * lead-in overlaps the fade). Under reduced motion it steps through the stills instead.
   */
  const replay = useCallback(() => {
    if (reducedRef.current) {
      runSteps();
      return;
    }
    if (phaseRef.current !== 'done') return;
    answerRef.current = false;
    setAnswerShown(false);
    flipTargetRef.current = 0;
    setLive('');
    setPhase('replaying');
    fadeFit(0, REPLAY.out * 1000, 'cubic-bezier(.4, 0, 1, 1)');
    later(() => {
      if (phaseRef.current !== 'replaying') return;
      time.jump(START_AT);
      userFlip.jump(0);
      hover.jump(0);
      press.jump(0);
      inviteOut.jump(0);
      renderNow();
      fadeFit(1, REPLAY.in * 1000, 'cubic-bezier(.22, .61, .36, 1)');
      setPhase('playing');
      later(() => {
        if (fitRef.current && phaseRef.current !== 'replaying') fitRef.current.style.transition = '';
      }, REPLAY.in * 1000);
    }, REPLAY.out * 1000);
  }, [fadeFit, hover, inviteOut, later, press, renderNow, runSteps, setPhase, time, userFlip]);

  const onSentenceClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    const current = phaseRef.current;
    if (current === 'playing') settle();
    else if (current === 'settling') finish();
    else if (current === 'done') replay();
  };
  const setSentenceHot = (hot: boolean) => {
    const page = pageRef.current;
    if (!page) return;
    if (hot) page.dataset.hot = 'true';
    else delete page.dataset.hot;
  };

  /* Hover and press: under a mouse at rest the card rises a little; it gives under a press. */
  const pressTo = (value: number) => {
    if (reducedRef.current) return;
    if (value === 0 && press.get() === 0 && !press.isAnimating()) return;
    goLive();
    animate(press, value, { type: 'spring', stiffness: SPRING.press[0], damping: SPRING.press[1] });
  };
  const onPointerEnter = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse') return;
    goLive();
    if (!hoverEnabled || reducedRef.current || phaseRef.current !== 'done') return;
    animate(hover, 1, { type: 'spring', stiffness: SPRING.hover[0], damping: SPRING.hover[1] });
  };
  const onPointerLeave = () => {
    pressTo(0);
    if (hover.get() === 0 && !hover.isAnimating()) return;
    goLive();
    animate(hover, 0, { type: 'spring', stiffness: SPRING.hover[0], damping: SPRING.hover[1] });
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    goLive();
    if (event.button === 0) pressTo(1);
  };
  const onPointerUp = () => pressTo(0);

  /* ---------- markup ---------- */
  const animating = phase === 'playing' || phase === 'settling' || phase === 'replaying';
  const zav = CANVAS[geo?.variant ?? variant].zavtra;
  const zs = zav.px / 100;
  const zPad = 3;
  // Under-sheets have no content of their own: they take the page's measured height.
  const sheetHeight = geo ? { height: `${geo.page.h}px` } : undefined;
  const sentence: ReactNode = KEY_WORDS.map((word, i) => (
    <Fragment key={i}>
      <span data-kw="">{word}</span>
      {i < KEY_WORDS.length - 1 ? ' ' : ''}
    </Fragment>
  ));

  return (
    <div className="ph-fit" ref={fitRef} data-fonts={fontState}>
      <div className="ph-stage" ref={stageRef}>
        <figure
          className="ph-scene"
          ref={sceneRef}
          aria-labelledby="ph-caption"
          data-phase={phase}
          data-animating={animating ? 'true' : undefined}
          data-reduced={reduced ? 'true' : undefined}
          onClick={onFigureClick}
        >
          <figcaption id="ph-caption" className="sr-only">{CAPTION}</figcaption>
          <div className="ph-sheet ph-s3" aria-hidden="true" style={sheetHeight} />
          <div className="ph-sheet ph-s2" aria-hidden="true" style={sheetHeight} />
          <div className="ph-sheet ph-page" ref={pageRef} aria-hidden="true">
            <div className="ph-page-text" ref={pageTextRef}>
              <p className="ph-title">{HERO_PAGE.title}</p>
              <p className="ph-p">
                {HERO_PAGE.p1}
                <span className="ph-p1-more">{HERO_PAGE.p1more}</span>
              </p>
              <p className="ph-p ph-key" ref={keyRef}>{sentence}</p>
              <p className="ph-p ph-more">{HERO_PAGE.more}</p>
            </div>
            {shapes.map((shape, i) => (
              <div
                key={i}
                className="ph-ul"
                ref={el => { ulLineRefs.current[i] = el; }}
                style={{ left: `${shape.box.x}px`, top: `${shape.box.y}px`, width: `${shape.box.w}px`, height: `${shape.box.h}px` }}
              >
                <svg width={shape.box.w} height={shape.box.h} aria-hidden="true" focusable="false">
                  <path className="ph-ink" d={shape.outline} transform={`translate(${-shape.box.x} ${-shape.box.y})`} />
                </svg>
              </div>
            ))}
            {geo && (
              // Pointer-only: a click on the underlined sentence plays the take again.
              <span
                className="ph-key-hit"
                style={{ left: `${geo.rect.x}px`, top: `${geo.rect.y}px`, width: `${geo.rect.w}px`, height: `${geo.rect.h}px` }}
                onClick={onSentenceClick}
                onPointerEnter={() => setSentenceHot(true)}
                onPointerLeave={() => setSentenceHot(false)}
              />
            )}
          </div>
          <div className="ph-card ph-c3" ref={c3Ref} aria-hidden="true" />
          <div className="ph-card ph-c2" ref={c2Ref} aria-hidden="true" />
          <button
            type="button"
            className="ph-card-top"
            ref={cardRef}
            aria-label="Перевернуть карточку"
            aria-pressed={answerShown}
            aria-describedby="ph-face-text"
            onClick={onCardClick}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onFocus={goLive}
          >
            <span className="ph-card-base" ref={baseRef} aria-hidden="true" />
            <span className="ph-card-lift" ref={liftRef} aria-hidden="true" />
            <span className="ph-flipper" ref={flipperRef}>
              <span className="ph-face ph-face-answer" ref={faceARef}>
                {geo && measure && (
                  <>
                    <span
                      className="ph-strip-shadow"
                      ref={stripShadowRef}
                      aria-hidden="true"
                      style={{ width: `${geo.rect.w - 36}px`, height: `${Math.max(8, geo.rect.h - 36)}px` }}
                    />
                    <span className="ph-strip-pos" ref={stripPosRef} aria-hidden="true" style={{ width: `${geo.rect.w}px`, height: `${geo.rect.h}px` }}>
                      <span className="ph-strip" ref={stripRef}>
                        <span className="ph-strip-edge" ref={stripEdgeRef} />
                        <span className="ph-strip-paper">
                          <SentenceCopy geo={geo} baseline={measure.baseline} shapes={shapes} />
                        </span>
                      </span>
                    </span>
                  </>
                )}
                <span className="ph-light" ref={lightARef} aria-hidden="true" />
                <span className="ph-shade" ref={shadeARef} aria-hidden="true" />
              </span>
              <span className="ph-face ph-face-question" ref={faceBRef}>
                <span className="ph-q-in" ref={qInRef}>
                  <span className="ph-q">{HERO_QUESTION}</span>
                  <svg
                    className="ph-zav"
                    width={(ZAVTRA.bbox.x2 - ZAVTRA.bbox.x) * zs + zPad * 2}
                    height={(ZAVTRA.bbox.y2 - ZAVTRA.bbox.y) * zs + zPad * 2}
                    aria-hidden="true"
                    focusable="false"
                  >
                    <g transform={`translate(${zPad - ZAVTRA.bbox.x * zs} ${zPad - ZAVTRA.bbox.y * zs}) scale(${zs})`}>
                      {ZAVTRA.paths.map((d, i) => (
                        <path
                          key={i}
                          ref={el => { zavRefs.current[i] = el; }}
                          d={d}
                          fill="none"
                          strokeWidth={zav.stroke / zs}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={0.95}
                          pathLength={1}
                          strokeDasharray="1 1"
                          strokeDashoffset={1}
                        />
                      ))}
                    </g>
                  </svg>
                </span>
                <span className="ph-light" ref={lightBRef} aria-hidden="true" />
                <span className="ph-shade" ref={shadeBRef} aria-hidden="true" />
              </span>
            </span>
          </button>
        </figure>
      </div>
      <div className="ph-below" ref={belowRef}>
        <p className="ph-invite" ref={inviteRef}>{INVITE_TEXT}</p>
        {reduced && (
          <button type="button" className="ph-control" onClick={runSteps}>{STEPS_TEXT}</button>
        )}
      </div>
      <span id="ph-face-text" className="sr-only">{answerShown ? FACE_TEXT.answer : FACE_TEXT.question}</span>
      <p className="sr-only" aria-live="polite">{live}</p>
    </div>
  );
}
