import { useMemo, useRef, type ReactNode } from 'react';
import { CHAOS_CARDS } from '../content';
import { blur, opacity, place, put, useEls, useFrame } from '../engine';
import { drawBurst, drawDust, drawGather, makeBurst, makeDust } from '../particles';
import { Kinetic, ParticleCanvas } from '../parts';
import { clamp, ease, mix, seg } from '../timeline';

const CX = 960;
const CY = 540;
/**
 * The depth of field: far and near cards are soft, the middle ones sharp. The blur is fixed per
 * card and sits inside it, so the browser draws each card once and then only moves it: a blur that
 * changes every frame on each card (it used to follow the card's speed) redrew all eighteen cards
 * on every frame and made this scene stutter. The smear of the drain, when all the cards rush at
 * once, is one blur on the whole camera layer instead.
 */
const DEPTH_BLUR = [2.6, 0, 5.5];
const DRIFT = [0.012, 0.022, 0.04];

/**
 * The file mark is drawn, not typed: «≡» is outside the Onest subsets the page loads, so it fetched
 * one more font file the moment this scene mounted and laid the scene out again when it came.
 */
const FILE_MARK = (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 4h8M3 7h8M3 10h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const ICON: Record<string, ReactNode> = { question: '?', file: FILE_MARK, ticket: '7' };

/**
 * 2 · The session. The stack bursts into everything a student has before an exam — lecture files,
 * questions, tickets — floating in depth on blue, and the question «С чего начать?».
 */
export default function Chaos() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const dust = useMemo(() => makeDust(31, 50, 1920, 1080), []);
  const burst = useMemo(() => makeBurst(32, { count: 36, colors: ['#ffffff', '#F4C45B', '#A9C8F7'], near: 280, far: 760, dashes: 0.8, size: [2, 4.5] }), []);
  const gather = useMemo(() => makeBurst(33, { count: 70, colors: ['#ffffff', '#F4C45B', '#A9C8F7'], near: 500, far: 1000, dashes: 0.55, size: [2, 4] }), []);

  const position = (index: number, l: number) => {
    const card = CHAOS_CARDS[index];
    const start = 40 + index * 26;
    const fly = ease.out(seg(l, start, 1050));
    const angle = Math.atan2(card.y - CY, card.x - CX);
    const after = Math.max(0, l - start - 300);
    const drift = DRIFT[card.depth] * after;
    const swirl = ease.in(seg(l, 3330 + (index % 6) * 34, 620));
    const baseX = mix(CX + Math.cos(angle) * 30, card.x, fly) + Math.cos(angle) * drift;
    const baseY = mix(CY + Math.sin(angle) * 20, card.y, fly) + Math.sin(angle) * drift;
    // On the way out every card is pulled into the centre with a turn, as if into a drain.
    const turn = swirl * 1.1;
    const dx = (baseX - CX) * (1 - swirl);
    const dy = (baseY - CY) * (1 - swirl);
    const x = CX + dx * Math.cos(turn) - dy * Math.sin(turn);
    const y = CY + dx * Math.sin(turn) + dy * Math.cos(turn);
    const scale = mix(0.16, card.scale, fly) * (1 + after * 0.00004 * (card.depth + 1)) * (1 - 0.88 * swirl);
    const rotate = mix(card.rotate * 4, card.rotate, fly) + Math.sin((l + index * 300) / 900) * 1.4 + swirl * 140;
    return { x, y, scale, rotate, fly, swirl, start };
  };

  useFrame((l) => {
    opacity(root.current, seg(l, 0, 160));
    const flash = one('flash');
    const burstIn = seg(l, 0, 520);
    put(flash, 'transform', `scale(${mix(0.35, 1.7, ease.out(burstIn)).toFixed(3)})`);
    opacity(flash, (1 - ease.inOut(burstIn)) * 0.85);
    const cam = one('cam');
    put(cam, 'transform', `scale(${mix(1, 1.06, ease.sine(seg(l, 0, 3800))).toFixed(4)})`);
    // The drain's smear, until the last card is gone (3960): a blur left on the empty camera
    // would still cost a full-frame pass.
    blur(cam, l < 3960 ? 14 * ease.in(seg(l, 3330, 520)) : 0);

    all('card').forEach((el, index) => {
      const now = position(index, l);
      place(el, now.x, now.y, now.scale, now.rotate);
      opacity(el, clamp((l - now.start) / 140) * (1 - seg(l, 3700, 260)));
    });

    const head = one('head');
    const leave = ease.in(seg(l, 3260, 460));
    put(head, 'transform', `scale(${mix(1, 0.84, leave).toFixed(3)})`);
    blur(head, leave * 18);
    opacity(head, 1 - leave);
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l + 4000, 1920, 1080, '#ffffff', 0.7);
    drawBurst(ctx, burst, CX, CY, l - 20, 1100);
    drawGather(ctx, gather, CX, CY, seg(l, 3280, 760), 1.3);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-blue mr-chaos">
      <div className="mr-halftone" />
      <div className="mr-halftone mr-halftone--br" />
      <div data-a="flash" className="mr-flash" />
      <ParticleCanvas draw={draw} />
      <div data-a="cam" className="mr-layer mr-chaos-cam" style={{ transformOrigin: '50% 50%' }}>
        {CHAOS_CARDS.map((card, index) => (
          <div key={index} data-a="card" data-kind={card.kind} className="mr-chaos-card">
            <div className="mr-chaos-card-in" style={DEPTH_BLUR[card.depth] ? { filter: `blur(${DEPTH_BLUR[card.depth]}px)` } : undefined}>
              <div className="mr-chaos-card-h">
                <i>{ICON[card.kind]}</i>
                {card.meta}
              </div>
              <div className="mr-chaos-card-t">{card.title}</div>
              <span className="mr-chaos-card-l" />
            </div>
          </div>
        ))}
        <div data-a="head" className="mr-chaos-head">
          <p className="mr-display">
            <Kinetic text="40 вопросов. 12 дней." at={640} stagger={150} dur={820} />
          </p>
          <p className="mr-display mr-chaos-line2">
            <Kinetic text="С чего начать?" at={1430} stagger={120} dur={820} accentFrom={0} />
          </p>
        </div>
      </div>
    </div>
  );
}
