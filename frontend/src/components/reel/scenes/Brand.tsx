import { useMemo, useRef } from 'react';
import { blur, opacity, put, useEls, useFrame } from '../engine';
import { drawBurst, drawGather, drawRing, makeBurst } from '../particles';
import { Kinetic, ParticleCanvas } from '../parts';
import { ease, mix, seg } from '../timeline';

/** Ink in three strengths, for the particles. */
const INK = ['#0B121C', 'rgba(11,18,28,0.55)', 'rgba(11,18,28,0.3)'];

/** Where the app's logo stands: the wordmark flies there and chapter 01 takes over in the app's top bar. */
export const NAV_LOGO = { left: 120, top: 96, size: 44 };
const MARK_TOP = 330;
const MARK_SIZE = 240;

/**
 * 3 · Meldy. The chaos is gone: on paper the particles gather into the wordmark, the yellow dot
 * lands last, and the line of the site is underlined by hand. Then the wordmark flies to its place
 * in the app's top bar (chapter 01's import page).
 */
export default function Brand() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  // Ink particles on paper: no colour but the yellow dot (the owner, 2026-10-10: nothing like confetti).
  const gather = useMemo(() => makeBurst(41, { count: 110, colors: INK, near: 420, far: 980, dashes: 0.45, size: [2, 4.5] }), []);
  const pop = useMemo(() => makeBurst(42, { count: 22, colors: INK, near: 70, far: 210, dashes: 0.6, size: [2, 4] }), []);
  const dotAt = { x: 960, y: 520 };

  useFrame((l) => {
    const iris = ease.inOut(seg(l, 0, 520));
    put(root.current, 'clip-path', iris >= 1 ? 'none' : `circle(${(iris * 1150).toFixed(1)}px at 960px 540px)`);

    const mark = one('mark');
    const dot = one('dot');
    const dotIn = ease.back(seg(l, 1080, 520));
    put(dot, 'transform', `scale(${dotIn.toFixed(3)})`);
    if (dot) {
      // The dot's offset parent is the full-width row, so its offsets are stage coordinates.
      dotAt.x = dot.offsetLeft + dot.offsetWidth / 2;
      dotAt.y = MARK_TOP + dot.offsetTop + dot.offsetHeight / 2;
    }

    // The flight to the top bar (2650–3050 ms): scale and move with the top-left corner as origin.
    const fly = ease.inOut(seg(l, 2650, 400));
    if (mark) {
      const scale = mix(1, NAV_LOGO.size / MARK_SIZE, fly);
      const dx = (NAV_LOGO.left - mark.offsetLeft) * fly;
      const dy = (NAV_LOGO.top - MARK_TOP) * fly;
      put(mark, 'transform', `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0) scale(${scale.toFixed(4)})`);
    }

    const tag = one('tag');
    const leave = ease.in(seg(l, 2420, 320));
    put(tag, 'transform', `translate3d(0,${(-26 * leave).toFixed(2)}px,0)`);
    blur(tag, leave * 14);
    opacity(tag, 1 - leave);
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawGather(ctx, gather, 960, 450, seg(l, 140, 1150), 1.5);
    drawRing(ctx, 960, 450, 40, 760, seg(l, 200, 1300), '#0B121C', 1.6, 0.16);
    drawRing(ctx, 960, 450, 40, 560, seg(l, 420, 1200), '#0B121C', 2, 0.22);
    drawBurst(ctx, pop, dotAt.x, dotAt.y, l - 1120, 820);
    drawRing(ctx, dotAt.x, dotAt.y, 20, 180, seg(l, 1120, 700), '#F4C45B', 2.5, 0.8);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <ParticleCanvas draw={draw} />
      <div className="mr-layer" style={{ top: MARK_TOP, bottom: 'auto', display: 'flex', justifyContent: 'center' }}>
        <span data-a="mark" className="mr-wordmark" style={{ fontSize: MARK_SIZE, transformOrigin: '0 0' }}>
          <Kinetic text="Meldy" at={500} unit="letter" variant="zoom" stagger={70} dur={760} />
          <span data-a="dot" className="mr-wordmark-dot" />
        </span>
      </div>
      <div data-a="tag" className="mr-brand-tag">
        <Kinetic text="Сессия начинается со" at={1300} stagger={85} />{' '}
        <span className="mr-mark">
          <Kinetic text="списка вопросов." at={1555} stagger={85} />
        </span>
      </div>
    </div>
  );
}
