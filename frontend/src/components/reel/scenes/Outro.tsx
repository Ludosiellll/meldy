import { useMemo, useRef } from 'react';
import { blur, opacity, put, useEls, useFrame } from '../engine';
import { drawBurst, drawDust, drawGather, drawRing, makeBurst, makeDust } from '../particles';
import { Kinetic, Marker, ParticleCanvas, Pill } from '../parts';
import { clamp, ease, mix, pulse, seg } from '../timeline';

const MARK_TOP = 205;
const MARK_SIZE = 210;

/** The stage rectangle of the closing call (for the clickable area over the frame). */
export const OUTRO_CTA = { x: 960, y: 874, w: 400, h: 72 };
export const OUTRO_CTA_AT = 2550;

const FEATURES = [
  {
    title: 'Билеты',
    sub: 'по твоим лекциям',
    tone: { background: '#E8EFFC', color: '#1C4DB1' },
    icon: <path d="M5 6h10M5 10h10M5 14h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  },
  {
    title: 'Ответ вслух',
    sub: 'с вопросом экзаменатора',
    tone: { background: '#FCEFC9', color: '#7A5A12' },
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="7.5" y="2.5" width="5" height="9.5" rx="2.5" fill="currentColor" stroke="none" />
        <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
      </g>
    ),
  },
  {
    title: 'Повторение',
    sub: 'в нужный день',
    tone: { background: '#E2F2E5', color: '#2C6B3A' },
    icon: <path d="M15.5 8.5A6 6 0 1 0 16 12M16 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

/**
 * 9 · The end. Out of the line's bright head the paper opens again: the wordmark gathers, the
 * method in one line, what Meldy does in three cards, and the call to start.
 */
export default function Outro() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const gather = useMemo(
    () =>
      makeBurst(91, {
        count: 110,
        colors: ['#0B121C', '#2869DD', '#F4C45B', '#A9C8F7'],
        near: 420,
        far: 1000,
        dashes: 0.45,
        size: [2, 4.5],
      }),
    [],
  );
  const pop = useMemo(
    () =>
      makeBurst(92, {
        count: 22,
        colors: ['#F4C45B', '#2869DD', '#0B121C'],
        near: 60,
        far: 190,
        dashes: 0.6,
        size: [2, 4],
      }),
    [],
  );
  const dust = useMemo(() => makeDust(93, 60, 1920, 1080), []);
  const dotAt = { x: 960, y: 380 };

  useFrame((l) => {
    const iris = ease.inOut(seg(l, 0, 680));
    put(root.current, 'clip-path', iris >= 1 ? 'none' : `circle(${(iris * 2300).toFixed(1)}px at 1770px 300px)`);

    const dot = one('dot');
    put(dot, 'transform', `scale(${ease.back(seg(l, 1080, 520)).toFixed(3)})`);
    if (dot) {
      dotAt.x = dot.offsetLeft + dot.offsetWidth / 2;
      dotAt.y = MARK_TOP + dot.offsetTop + dot.offsetHeight / 2;
    }

    all('feat').forEach((feat, index) => {
      const p = seg(l, 2000 + index * 130, 700);
      put(feat, 'transform', `translate3d(0,${mix(50, 0, ease.brand(p)).toFixed(1)}px,0) scale(${mix(0.94, 1, ease.back(p)).toFixed(3)})`);
      opacity(feat, clamp(p * 2.4));
      blur(feat, (1 - ease.brand(p)) * 10);
    });

    const cta = one('cta');
    const p = seg(l, OUTRO_CTA_AT, 620);
    put(cta, 'transform', `scale(${(p <= 0 ? 0.7 : mix(0.7, 1, ease.back(p))).toFixed(3)})`);
    opacity(cta, clamp(p * 3));
    const nudge = l > 3300 ? pulse((l - 3300) % 1700, 0, 760) : 0;
    put(one('cta-dot'), 'transform', `translate3d(${(6 * nudge).toFixed(2)}px,0,0)`);

    // Slow push in while the end holds, then black for the loop's first frame.
    put(one('cam'), 'transform', `scale(${mix(1, 1.035, ease.sine(seg(l, 1400, 3800))).toFixed(4)})`);
    opacity(one('black'), ease.inOut(seg(l, 4880, 320)));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l + 2000, 1920, 1080, '#2869DD', 0.35 * seg(l, 1200, 800));
    drawGather(ctx, gather, 960, 310, seg(l, 220, 1150), 1.6);
    drawRing(ctx, 960, 310, 40, 700, seg(l, 300, 1300), '#0B121C', 1.6, 0.14);
    drawRing(ctx, 960, 310, 40, 520, seg(l, 480, 1200), '#F4C45B', 2.4, 0.7);
    drawBurst(ctx, pop, dotAt.x, dotAt.y, l - 1120, 820);
    drawRing(ctx, dotAt.x, dotAt.y, 18, 160, seg(l, 1120, 700), '#F4C45B', 2.5, 0.8);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <ParticleCanvas draw={draw} />
      <div data-a="cam" className="mr-layer">
        <div
          className="mr-layer"
          style={{
            top: MARK_TOP,
            bottom: 'auto',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <span className="mr-wordmark" style={{ fontSize: MARK_SIZE }}>
            <Kinetic text="Meldy" at={500} unit="letter" variant="zoom" stagger={70} dur={760} />
            <span data-a="dot" className="mr-wordmark-dot" />
          </span>
        </div>
        <div className="mr-outro-tag">
          <span className="mr-mark">
            <Kinetic text="Вспоминать" at={1250} />
            <Marker at={1760} dur={650} variant={1} />
          </span>{' '}
          <span className="mr-muted">
            <Kinetic text="полезнее, чем перечитывать." at={1340} stagger={85} />
          </span>
        </div>
        <div className="mr-feats">
          {FEATURES.map((feature) => (
            <div key={feature.title} data-a="feat" className="mr-feat">
              <i style={feature.tone}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  {feature.icon}
                </svg>
              </i>
              <div>
                <b>{feature.title}</b>
                <span>{feature.sub}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mr-outro-cta">
          <Pill name="cta">Начать подготовку</Pill>
        </div>
      </div>
      <div data-a="black" className="mr-black" style={{ opacity: 0 }} />
    </div>
  );
}
