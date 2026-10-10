import { useMemo, useRef } from 'react';
import { opacity, place, put, useEls, useFrame } from '../engine';
import { drawBurst, drawDust, drawRing, makeBurst, makeDust } from '../particles';
import { Marker, ParticleCanvas } from '../parts';
import { clamp, ease, mix, seg } from '../timeline';

/** The first question of the session the reel tells (chapter 03 asks it), its key word underlined. */
const INTRO_CARD = { subject: 'Экономика', before: 'Что показывает', marked: 'эластичность', after: 'спроса?', meta: 'Вопрос 14 из 240' };

const YELLOW = '#F4C45B';
/** The particles and the outer rings are white: the only colour is the yellow dot and its own ring. */
const WHITE = ['#ffffff', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.45)'];

/**
 * 1 · The dot. Meldy's yellow dot appears in the dark, stretches into the hand-drawn line, and the
 * line unfolds into a question card with two more behind it; then the stack rushes at the camera.
 */
export default function Intro() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const dust = useMemo(() => makeDust(11, 80, 1920, 1080), []);
  const sparks = useMemo(() => makeBurst(21, { count: 18, colors: WHITE, near: 60, far: 210, dashes: 0.55, size: [2, 4] }), []);
  const unfold = useMemo(() => makeBurst(22, { count: 30, colors: WHITE, near: 330, far: 640, dashes: 0.75, size: [2, 4.5] }), []);

  useFrame((l) => {
    // The glow breathes.
    const glow = one('glow');
    put(glow, 'transform', `scale(${(0.82 + 0.16 * ease.sine(seg(l, 0, 2600))).toFixed(3)})`);
    opacity(glow, 0.4 + 0.6 * seg(l, 0, 900));

    // The dot pops, then stretches into a line (850–1300 ms).
    const dot = one('dot');
    const popped = ease.back(seg(l, 60, 520));
    const stretch = ease.brand(seg(l, 850, 520));
    const width = mix(46, 580, stretch);
    const height = mix(46, 15, ease.out(seg(l, 850, 300)));
    put(dot, 'width', `${width.toFixed(1)}px`);
    put(dot, 'height', `${height.toFixed(1)}px`);
    put(dot, 'margin', `${(-height / 2).toFixed(1)}px 0 0 ${(-width / 2).toFixed(1)}px`);
    put(dot, 'transform', `scale(${popped.toFixed(3)})`);
    // The straight line becomes the hand-drawn one, which then folds up into the card.
    const toStroke = seg(l, 1260, 160);
    opacity(dot, 1 - toStroke);
    const line = one('line');
    const fold = seg(l, 1420, 260);
    opacity(line, toStroke * (1 - fold));
    put(line, 'transform', `scale(${mix(1, 0.82, ease.in(fold)).toFixed(3)},1)`);

    // The card unfolds from the line (1420–2050 ms); two more fan out behind it (2050–2650 ms).
    const stack = one('stack');
    const card = one('card');
    const open = seg(l, 1420, 640);
    put(card, 'transform', `scale(${mix(0.9, 1, ease.brand(open)).toFixed(3)},${Math.max(0.03, ease.back(open)).toFixed(3)})`);
    opacity(card, clamp(open * 6));
    const fanB = ease.back(seg(l, 2020, 620));
    const fanC = ease.back(seg(l, 2110, 620));
    const b = one('b');
    const c = one('c');
    place(b, mix(0, -64, fanB), mix(0, 18, fanB), 1, mix(0, -8, fanB));
    place(c, mix(0, 62, fanC), mix(0, 14, fanC), 1, mix(0, 7, fanC));
    opacity(b, fanB > 0.01 ? 1 : 0);
    opacity(c, fanC > 0.01 ? 1 : 0);

    // Slow push in, then the stack rushes at the camera as the session's chaos bursts in (3000+).
    // Scale and opacity only, on its own layer (reel.css): a growing blur redrew the whole
    // enlarged stack every frame of the rush, right where the next scene starts. Without the blur
    // it is gone sooner, before the burst covers it.
    const push = ease.sine(seg(l, 1800, 1300));
    const rush = ease.in(seg(l, 2900, 320));
    put(stack, 'transform', `scale(${(mix(1, 1.07, push) * mix(1, 2.6, rush)).toFixed(3)})`);
    opacity(stack, 1 - ease.in(seg(l, 2930, 190)));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l, 1920, 1080, '#ffffff', 0.9 * (1 - seg(l, 2950, 400)));
    drawRing(ctx, 960, 540, 26, 270, seg(l, 120, 1100), YELLOW, 2, 0.85);
    drawRing(ctx, 960, 540, 26, 480, seg(l, 320, 1500), '#ffffff', 1.6, 0.3);
    drawBurst(ctx, sparks, 960, 540, l - 240, 950);
    drawBurst(ctx, unfold, 960, 540, l - 1440, 1150);
    drawRing(ctx, 960, 540, 220, 980, seg(l, 1440, 1500), '#ffffff', 2, 0.32);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-dark">
      <div data-a="glow" className="mr-intro-glow" />
      <ParticleCanvas draw={draw} />
      <div data-a="stack" className="mr-intro-stack">
        <div data-a="b" className="mr-intro-card mr-intro-card--b">
          <span className="mr-bar" style={{ width: '38%' }} />
          <span className="mr-bar" style={{ width: '82%', marginTop: 70 }} />
          <span className="mr-bar" style={{ width: '64%' }} />
        </div>
        <div data-a="c" className="mr-intro-card mr-intro-card--c">
          <span className="mr-bar" style={{ width: '30%' }} />
          <span className="mr-bar" style={{ width: '76%', marginTop: 70 }} />
          <span className="mr-bar" style={{ width: '58%' }} />
        </div>
        <div data-a="card" className="mr-intro-card">
          <div className="mr-intro-card-top">
            <span className="mr-ticket-tag">{INTRO_CARD.subject}</span>
          </div>
          <div className="mr-intro-q">
            {INTRO_CARD.before}{' '}
            <span className="mr-mark">
              {INTRO_CARD.marked}
              <Marker at={1950} dur={650} />
            </span>{' '}
            {INTRO_CARD.after}
          </div>
          <div className="mr-intro-meta">{INTRO_CARD.meta}</div>
        </div>
      </div>
      <div data-a="dot" className="mr-intro-dot" />
      <div data-a="line" className="mr-intro-line">
        <svg viewBox="0 0 580 36" aria-hidden="true">
          <path d="M8 21 C 120 11, 240 9, 330 14 S 500 25, 572 13" />
        </svg>
      </div>
    </div>
  );
}
