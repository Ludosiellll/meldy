import { useMemo, useRef } from 'react';
import { blur, opacity, put, useEls, useFrame } from '../engine';
import { drawBurst, drawDust, drawGather, drawRing, makeBurst, makeDust } from '../particles';
import { Kinetic, Marker, ParticleCanvas, Pill } from '../parts';
import { clamp, ease, mix, pulse, sceneWindow, seg } from '../timeline';

const MARK_TOP = 205;
const MARK_SIZE = 210;

/** The stage rectangle of the closing call (for the clickable area over the frame). */
export const OUTRO_CTA = { x: 960, y: 880, w: 440, h: 80 };
export const OUTRO_CTA_AT = 2550;
/** How long the end is on the stage: it goes black over its last 320 ms, for the loop's first frame. */
const LENGTH = sceneWindow('outro').to - sceneWindow('outro').from;

const FEATURES = [
  {
    title: 'Вопросы',
    sub: 'из файлов кафедры, без\u00a0ИИ',
    tone: { background: '#E8EFFC', color: '#1C4DB1' },
    icon: <path d="M5 6h10M5 10h10M5 14h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  },
  {
    title: 'План',
    sub: 'занятие на каждый день',
    tone: { background: '#FCEFC9', color: '#7A5A12' },
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3.5" y="4.5" width="13" height="12" rx="3" />
        <path d="M3.8 8.6h12.4M7.2 2.6v3.2M12.8 2.6v3.2" />
      </g>
    ),
  },
  {
    title: 'Шпаргалка',
    sub: 'уходит с\u00a0ответами',
    tone: { background: '#E2F2E5', color: '#2C6B3A' },
    // Three lines of the sheet.
    icon: <path d="M4.5 5.5h11M4.5 10h11M4.5 14.5h7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  },
  {
    // The group link and the bot: one link, and every classmate gets their own copy of the exam.
    title: 'Группа',
    sub: 'одна ссылка и\u00a0Telegram',
    tone: { background: '#FBE6EE', color: '#9B2C5B' },
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="7.5" cy="7" r="2.6" />
        <circle cx="13.6" cy="8.2" r="2.1" />
        <path d="M3 16.2c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M12.6 12.3c1.9-.1 3.6 1.1 4.2 3.6" />
      </g>
    ),
  },
];

/** Ink in three strengths, for the particles: no colour but the yellow dot (the owner, 2026-10-10). */
const INK = ['#0B121C', 'rgba(11,18,28,0.55)', 'rgba(11,18,28,0.3)'];

/** The closing call: the landing's first action, the example exam that needs no account (pages/Landing.tsx TRY_LABEL). */
export const OUTRO_CTA_LABEL = 'Попробовать на примере';

/**
 * 10 · The end. The paper opens again: the wordmark gathers, the method in one line, what Meldy does in four cards
 * (the chapters: the questions, the plan, the cheat sheet, the group), and the call to try the example.
 */
export default function Outro() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const gather = useMemo(
    () =>
      makeBurst(91, {
        count: 110,
        colors: INK,
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
        colors: INK,
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
    put(one('cam'), 'transform', `scale(${mix(1, 1.035, ease.sine(seg(l, 1400, LENGTH - 1400))).toFixed(4)})`);
    opacity(one('black'), ease.inOut(seg(l, LENGTH - 320, 320)));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l + 2000, 1920, 1080, '#0B121C', 0.22 * seg(l, 1200, 800));
    drawGather(ctx, gather, 960, 310, seg(l, 220, 1150), 1.6);
    drawRing(ctx, 960, 310, 40, 700, seg(l, 300, 1300), '#0B121C', 1.6, 0.14);
    drawRing(ctx, 960, 310, 40, 520, seg(l, 480, 1200), '#0B121C', 2, 0.22);
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
          <Pill name="cta">{OUTRO_CTA_LABEL}</Pill>
        </div>
      </div>
      <div data-a="black" className="mr-black" style={{ opacity: 0 }} />
    </div>
  );
}
