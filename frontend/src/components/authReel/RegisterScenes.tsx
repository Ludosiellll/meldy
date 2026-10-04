import { useMemo, useRef, type ComponentType } from 'react';
import { blur, opacity, place, put, useEls, useFrame } from '../reel/engine';
import { drawBurst, drawDust, drawGather, drawRing, makeBurst, makeDust } from '../reel/particles';
import { Kinetic, Marker, ParticleCanvas } from '../reel/parts';
import { clamp, ease, mix, pulse, seg } from '../reel/timeline';
import { CheckIcon, DocIcon, circleClip, riseClip } from './kit';

const BLUE = '#2869DD';
const YELLOW = '#F4C45B';
const GREEN = '#8ACB97';
const PINK = '#F3A9C4';
const SKY = '#A9C8F7';

/**
 * The sign-up reel, «Материал становится планом подготовки» (16 s, script.ts REGISTER_SCRIPT): the
 * materials of the course fall into a pile and are drawn into Meldy's yellow dot; the dot opens
 * into a plan whose parts tick one by one; on blue, the cards land on the days they come back; on
 * dark, the exam ticket fills its ring, then the paper opens again for the loop.
 */

// ---------------------------------------------------------------------------------------------
// 1 · The pile (0–4400)

const CENTER = { x: 960, y: 600 };

const MATERIALS = [
  { name: 'Лекция 4.pdf', meta: 'PDF · 18 страниц', tone: 'b' as const, x: 260, y: 440, turn: -4 },
  { name: 'Фото доски.jpg', meta: 'Фото с пары', tone: 'y' as const, x: 1010, y: 470, turn: 5 },
  { name: 'Запись пары', meta: 'Аудио · 52:10', tone: 'p' as const, x: 330, y: 650, turn: 3, wave: true },
  { name: 'Методичка.docx', meta: 'DOCX', tone: 'b' as const, x: 1060, y: 690, turn: -3 },
  { name: 'Мои заметки.txt', meta: 'Текст', tone: 'g' as const, x: 640, y: 845, turn: 2 },
];
const MAT_W = 640;
const MAT_H = 156;
const WAVE = [18, 34, 26, 40, 22, 30, 16, 36, 24];

function Pile() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const dust = useMemo(() => makeDust(61, 46, 1920, 1080), []);
  const pull = useMemo(() => makeBurst(62, { count: 40, colors: [BLUE, YELLOW, PINK, GREEN], near: 260, far: 760, dashes: 0.7, size: [3, 6] }), []);

  useFrame((l) => {
    all('mat').forEach((mat, index) => {
      const m = MATERIALS[index];
      const fall = seg(l, 650 + index * 210, 760);
      const gather = ease.in(seg(l, 3000 + index * 90, 650));
      const dx = CENTER.x - (m.x + MAT_W / 2);
      const dy = CENTER.y - (m.y + MAT_H / 2);
      const turnIn = (index % 2 === 0 ? -1 : 1) * 22;
      place(
        mat,
        dx * gather,
        mix(-760, 0, ease.back(fall)) + dy * gather,
        mix(1, 0.14, gather),
        mix(turnIn, m.turn, ease.brand(fall)) + 40 * gather * (index % 2 === 0 ? -1 : 1),
      );
      opacity(mat, clamp(fall * 4) * (1 - seg(l, 3450 + index * 90, 220)));
      blur(mat, gather * 10);
    });
    all('bar').forEach((bar, index) => {
      put(bar, 'transform', `scaleY(${(0.45 + 0.55 * Math.abs(Math.sin(l / 180 + index * 0.9))).toFixed(3)})`);
    });
    const dot = one('dot');
    const pop = seg(l, 3800, 420);
    put(dot, 'transform', `scale(${ease.back(pop).toFixed(3)})`);
    opacity(dot, clamp(pop * 4));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l, 1920, 1080, '#0B121C', 0.5);
    drawGather(ctx, pull, CENTER.x, CENTER.y, seg(l, 3050, 1000), 1.5);
    drawRing(ctx, CENTER.x, CENTER.y, 30, 260, seg(l, 3850, 700), YELLOW, 3, 0.9);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <ParticleCanvas draw={draw} />
      <h3 className="mr-display ar-h" style={{ fontSize: 116 }}>
        <Kinetic text="Всё, что дали на парах" at={250} unit="letter" variant="drop" stagger={18} dur={620} accentFrom={3} out={{ at: 3000, dur: 450 }} />
      </h3>
      {MATERIALS.map((m) => (
        <div key={m.name} data-a="mat" className="ar-card ar-mat" style={{ left: m.x, top: m.y, opacity: 0 }}>
          <DocIcon tone={m.tone} />
          <span className="ar-mat-t">
            <span className="ar-mat-n">{m.name}</span>
            {m.wave ? (
              <span className="ar-wave">
                {WAVE.map((h, i) => (
                  <i key={i} data-a="bar" style={{ height: h }} />
                ))}
              </span>
            ) : (
              <span className="ar-mat-m">{m.meta}</span>
            )}
          </span>
        </div>
      ))}
      <span data-a="dot" className="ar-dot" style={{ opacity: 0 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2 · The plan (4000–8400)

const PLAN = ['Конспект со ссылками на лекцию', 'Карточки для повторения', 'Тест по теме', 'Разговор по лекции'];
const TICKS = [1400, 1700, 2000, 2300];

function Plan() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const pops = useMemo(() => TICKS.map((_, i) => makeBurst(70 + i, { count: 12, colors: [GREEN, YELLOW, '#ffffff'], near: 40, far: 140, dashes: 0.5, size: [2, 4] })), []);

  useFrame((l) => {
    // The dot breathes, stretches into a line, and the line opens into the plan.
    const dot = one('dot');
    const stretch = ease.brand(seg(l, 380, 420));
    const w = mix(60, 1000, stretch);
    const h = mix(60, 16, ease.out(seg(l, 380, 260)));
    put(dot, 'width', `${w.toFixed(1)}px`);
    put(dot, 'height', `${h.toFixed(1)}px`);
    put(dot, 'border-radius', `${(h / 2).toFixed(1)}px`);
    put(dot, 'transform', `translate3d(${(-w / 2 + 30).toFixed(1)}px,${(-h / 2 + 30).toFixed(1)}px,0) scale(${(1 + 0.12 * pulse(l, 0, 380)).toFixed(3)})`);
    opacity(dot, 1 - seg(l, 760, 160));

    const card = one('card');
    const open = seg(l, 720, 620);
    const leave = ease.in(seg(l, 3850, 500));
    put(card, 'transform', `translate3d(0,${(-30 * leave).toFixed(1)}px,0) scale(${mix(0.94, 1, ease.brand(open)).toFixed(3)},${Math.max(0.03, ease.back(open)).toFixed(3)})`);
    opacity(card, clamp(open * 6) * (1 - leave));
    blur(card, leave * 12);

    // The parts tick one by one; the bar fills with them.
    let done = 0;
    all('tick').forEach((tick, index) => {
      const p = seg(l, TICKS[index], 420);
      if (p > 0) done = index + ease.brand(p);
      put(tick, 'transform', `scale(${ease.back(p).toFixed(3)})`);
      opacity(tick, clamp(p * 4));
    });
    all('rowt').forEach((row, index) => opacity(row, mix(0.42, 1, ease.brand(seg(l, TICKS[index], 380)))));
    put(one('bar'), 'transform', `scaleX(${Math.max(0.02, done / PLAN.length).toFixed(4)})`);

    // «План подготовки» leaves upwards, then «План готов» comes up and gets the marker.
    const out = ease.in(seg(l, 2650, 240));
    const into = ease.brand(seg(l, 2880, 420));
    opacity(one('t1'), 1 - out);
    put(one('t1'), 'transform', `translate3d(0,${(-22 * out).toFixed(1)}px,0)`);
    opacity(one('t2'), into);
    put(one('t2'), 'transform', `translate3d(0,${mix(24, 0, into).toFixed(1)}px,0)`);
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawRing(ctx, 960, 600, 30, 240, seg(l, 0, 700), YELLOW, 3, 0.9);
    TICKS.forEach((at, index) => drawBurst(ctx, pops[index], 562, 526 + index * 110, l - at, 700));
  };

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <ParticleCanvas draw={draw} />
      <h3 className="mr-display ar-h" style={{ fontSize: 112 }}>
        <Kinetic text="Meldy собирает план" at={900} unit="letter" variant="drop" stagger={18} dur={620} accentFrom={2} out={{ at: 3800, dur: 450 }} />
      </h3>
      <span data-a="dot" className="ar-dot" style={{ left: 930, top: 570 }} />
      <div data-a="card" className="ar-card ar-plan" style={{ opacity: 0 }}>
        <div className="ar-plan-head">
          <span className="ar-plan-title">
            <span data-a="t1">План подготовки</span>
            <span data-a="t2" className="mr-mark" style={{ opacity: 0 }}>
              План готов
              <Marker at={3150} dur={650} />
            </span>
          </span>
        </div>
        <span className="ar-plan-bar">
          <i data-a="bar" style={{ transform: 'scaleX(0.02)' }} />
        </span>
        {PLAN.map((item) => (
          <div key={item} className="ar-row">
            <span className="ar-tick" style={{ position: 'relative' }}>
              <span data-a="tick" className="ar-tick-fill" style={{ opacity: 0, display: 'grid', placeItems: 'center' }}>
                <CheckIcon />
              </span>
            </span>
            <span data-a="rowt" className="ar-row-t" style={{ opacity: 0.42 }}>
              {item}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3 · The week (8000–12600), on blue

/** Today and the next seven days, up to the same weekday a week later. */
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс', 'Пн'];
/** Cards due per day (the repeats of different cards). */
const LOAD: Record<number, string[]> = { 0: [BLUE, YELLOW, GREEN], 1: [PINK, BLUE], 3: [GREEN, YELLOW], 5: [PINK], 7: [BLUE, GREEN] };
const DROP_AT: Record<number, number> = { 0: 1050, 1: 1400, 3: 1700, 5: 1950, 7: 2200 };
const COL = { left: 150, gap: 22, width: (1620 - 7 * 22) / 8 };
const colX = (i: number) => COL.left + i * (COL.width + COL.gap) + COL.width / 2;
/**
 * One card remembered today, as the review schedules it (SM-2 in `review_flashcard`): «Помню» on a
 * new card brings it back in 1 day, the next «Помню» in 6 more — a week from today.
 */
const HOPS = [
  { from: 0, to: 1, label: 'завтра', at: 2600 },
  { from: 1, to: 7, label: 'через неделю', at: 2950 },
];
/** A hop leaves the column bottoms (y 800) and dips, deeper the farther it goes; its label sits under its lowest point. */
const HOP_Y = 826;
const hopDip = (hop: { from: number; to: number }) => HOP_Y + 90 + Math.min(40, (hop.to - hop.from - 1) * 8);
const hopLabelTop = (hop: { from: number; to: number }) => HOP_Y + 0.75 * (hopDip(hop) - HOP_Y) + 22;

function Week() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const dust = useMemo(() => makeDust(81, 50, 1920, 1080), []);

  useFrame((l) => {
    put(one('wipe'), 'clip-path', circleClip(ease.inOut(seg(l, 0, 720)), 960, 540));
    const leave = ease.in(seg(l, 4150, 450));
    all('day').forEach((day, index) => {
      const rise = seg(l, 450 + index * 60, 620);
      put(day, 'transform', `translate3d(0,${(mix(70, 0, ease.brand(rise)) - 20 * leave).toFixed(1)}px,0)`);
      opacity(day, clamp(rise * 2.5) * (1 - leave));
    });
    let card = 0;
    all('mini').forEach((mini) => {
      const dayIndex = Number(mini.dataset.day);
      const within = Number(mini.dataset.i);
      const p = seg(l, DROP_AT[dayIndex] + within * 80, 560);
      put(mini, 'transform', `translate3d(0,${mix(-180, 0, ease.back(p)).toFixed(1)}px,0) rotate(${mix(card % 2 === 0 ? -8 : 7, 0, ease.brand(p)).toFixed(2)}deg)`);
      opacity(mini, clamp(p * 3));
      card += 1;
    });
    all('hop').forEach((path, index) => {
      const p = ease.inOut(seg(l, HOPS[index].at, 520));
      put(path, 'stroke-dashoffset', (1 - p).toFixed(4));
      opacity(path, (p > 0 ? 1 : 0) * (1 - leave));
    });
    all('hopt').forEach((label, index) => {
      const p = seg(l, HOPS[index].at + 250, 420);
      put(label, 'transform', `translate3d(0,${mix(18, 0, ease.brand(p)).toFixed(1)}px,0)`);
      opacity(label, clamp(p * 2) * (1 - leave));
    });
    opacity(one('head'), 1 - leave);
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => drawDust(ctx, dust, l, 1920, 1080, '#ffffff', 0.7);

  return (
    <div ref={root} className="mr-scene">
      <div data-a="wipe" className="ar-wipe mr-bg-blue" style={{ clipPath: 'circle(0 at 50% 50%)' }}>
        <div className="mr-halftone" />
        <ParticleCanvas draw={draw} />
        <h3 data-a="head" className="mr-display ar-h ar-h--light">
          <Kinetic text="Повторение по дням" at={420} unit="letter" variant="drop" stagger={20} dur={620} accentFrom={1} />
        </h3>
        <div className="ar-week">
          {DAYS.map((day, index) => (
            <div key={`${day}-${index}`} data-a="day" className={`ar-day${index === 0 ? ' ar-day--today' : ''}`} style={{ opacity: 0 }}>
              <div className="ar-day-n">{day}</div>
              <div className="ar-day-s">{index === 0 ? 'сегодня' : ' '}</div>
              <div className="ar-day-cards">
                {(LOAD[index] ?? []).map((stripe, i) => (
                  <span key={i} data-a="mini" data-day={index} data-i={i} className="ar-mini" style={{ ['--stripe' as string]: stripe, opacity: 0 }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <svg className="ar-hop" viewBox="0 0 1920 1080" aria-hidden="true">
          {HOPS.map((hop) => {
            const a = colX(hop.from);
            const b = colX(hop.to);
            const dip = hopDip(hop);
            return <path key={hop.label} data-a="hop" pathLength={1} d={`M${a} ${HOP_Y} C ${a} ${dip}, ${b} ${dip}, ${b} ${HOP_Y}`} style={{ opacity: 0 }} />;
          })}
        </svg>
        {HOPS.map((hop) => (
          <span key={hop.label} data-a="hopt" className="ar-hop-t" style={{ left: (colX(hop.from) + colX(hop.to)) / 2, top: hopLabelTop(hop), opacity: 0 }}>
            {hop.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4 · The exam (12200–16000), on dark; then the paper opens for the loop

const RING = { x: 610, y: 500 };

function Exam() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const dust = useMemo(() => makeDust(91, 70, 1920, 1080), []);
  const sparks = useMemo(() => makeBurst(92, { count: 28, colors: [GREEN, YELLOW, '#ffffff'], near: 90, far: 300, dashes: 0.6, size: [3, 6] }), []);

  useFrame((l) => {
    put(one('rise'), 'clip-path', riseClip(ease.inOut(seg(l, 0, 620))));
    const card = one('card');
    const enter = seg(l, 300, 650);
    place(card, 0, mix(70, 0, ease.brand(enter)), mix(0.94, 1, ease.back(enter)));
    opacity(card, clamp(enter * 3));
    const fill = ease.inOut(seg(l, 900, 1150));
    put(one('ring'), 'stroke-dashoffset', (1 - fill).toFixed(4));
    const ok = seg(l, 2080, 420);
    put(one('ok'), 'transform', `scale(${ease.back(ok).toFixed(3)})`);
    opacity(one('ok'), clamp(ok * 4));
    put(one('paper'), 'clip-path', circleClip(ease.inOut(seg(l, 2950, 800)), RING.x, RING.y));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l, 1920, 1080, '#ffffff', 0.9);
    drawBurst(ctx, sparks, RING.x, RING.y, l - 2100, 950);
    drawRing(ctx, RING.x, RING.y, 140, 460, seg(l, 2100, 1100), GREEN, 3, 0.8);
    drawRing(ctx, RING.x, RING.y, 140, 640, seg(l, 2300, 1300), SKY, 2, 0.5);
  };

  return (
    <div ref={root} className="mr-scene">
      <div data-a="rise" className="mr-layer mr-bg-dark" style={{ clipPath: 'inset(100% 0 0 0)' }}>
        <ParticleCanvas draw={draw} />
        <div data-a="card" className="ar-card ar-ticket" style={{ opacity: 0 }}>
          <span className="ar-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="ar-ring-bg" cx="60" cy="60" r="48" />
              <circle data-a="ring" className="ar-ring-fg" cx="60" cy="60" r="48" pathLength={1} />
            </svg>
            <span data-a="ok" className="ar-ring-ok" style={{ opacity: 0 }}>
              <CheckIcon />
            </span>
          </span>
          <span>
            <span className="ar-ticket-tag">Билет 12</span>
            <div className="ar-ticket-q">Эластичность спроса и её виды</div>
            <div className="ar-ticket-s">Ответ есть в ваших лекциях</div>
          </span>
        </div>
        <div className="mr-display ar-end" style={{ top: 790, fontSize: 112 }}>
          <Kinetic text="К экзамену — с планом." at={1300} unit="letter" variant="drop" stagger={18} dur={600} accentFrom={3} />
        </div>
      </div>
      <div data-a="paper" className="ar-wipe mr-bg-light" style={{ clipPath: 'circle(0 at 50% 50%)' }} />
    </div>
  );
}

export const REGISTER_SCENES: Record<string, ComponentType> = { pile: Pile, plan: Plan, week: Week, exam: Exam };
