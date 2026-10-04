import { useMemo, useRef, type ComponentType } from 'react';
import { blur, opacity, place, put, text, useEls, useFrame } from '../reel/engine';
import { drawBurst, drawDust, drawRing, makeBurst, makeDust } from '../reel/particles';
import { Cursor, Kinetic, ParticleCanvas, TypeLabel } from '../reel/parts';
import { clamp, ease, mix, pulse, seg } from '../reel/timeline';
import { CheckIcon, DocIcon, UploadIcon, circleClip, riseClip } from './kit';

const BLUE = '#2869DD';
const YELLOW = '#F4C45B';
const GREEN = '#8ACB97';
const SKY = '#A9C8F7';

/**
 * The sign-in reel, «Как работает Meldy» (16 s, script.ts LOGIN_SCRIPT): a lecture drops into the
 * upload zone and loads; the marker finds the main line and a note with its fragment slides out;
 * on blue, a card turns over, «Помню» is pressed and the next reviews line up; on dark, the line
 * «Вспоминайте, а не перечитывайте.» and the mark, then the paper opens again for the loop.
 */

// ---------------------------------------------------------------------------------------------
// 1 · Upload (0–4400)

const ZONE = { x: 1370, y: 650 };

function Upload() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const dust = useMemo(() => makeDust(31, 46, 1920, 1080), []);
  const done = useMemo(() => makeBurst(32, { count: 22, colors: [GREEN, BLUE, YELLOW], near: 70, far: 230, dashes: 0.5, size: [3, 6] }), []);

  useFrame((l) => {
    const zone = one('zone');
    const zoneIn = ease.brand(seg(l, 350, 700));
    const hit = ease.out(seg(l, 1620, 320));
    place(zone, 0, mix(40, 0, zoneIn), mix(0.95, 1, zoneIn) * (1 + 0.025 * pulse(l, 1620, 420)));
    opacity(zone, zoneIn * (1 - seg(l, 3350, 450)));
    put(zone, 'border-color', hit > 0 ? `rgba(40,105,221,${mix(0.25, 1, hit).toFixed(3)})` : '#c6c8c0');
    put(zone, 'border-style', hit > 0.4 ? 'solid' : 'dashed');
    put(zone, 'background-color', `rgba(232,239,252,${(0.45 + 0.4 * hit).toFixed(3)})`);
    opacity(one('zonet'), 1 - seg(l, 1450, 260));
    put(one('arrow'), 'transform', `translate3d(0,${(-14 * Math.sin((l / 1000) * Math.PI * 2)).toFixed(2)}px,0)`);

    // The file arrives on an arc from the top right and settles with a little bounce.
    const file = one('file');
    const fly = seg(l, 900, 760);
    const e = ease.brand(fly);
    const settle = ease.back(seg(l, 1450, 380));
    const lift = ease.inOut(seg(l, 3320, 520));
    place(
      file,
      mix(820, 0, e),
      mix(-700, 0, e) - Math.sin(Math.PI * fly) * 90 - 40 * lift,
      mix(0.86, 1, e) * mix(1, 1.04, lift) * (1 - 0.02 * (1 - settle) * (fly >= 1 ? 1 : 0)),
      mix(18, -2, e),
    );
    opacity(file, clamp(fly * 5) * (1 - lift));
    blur(file, (1 - e) * 6 + lift * 12);

    // It loads: the bar fills and the percent counts up; then the check.
    const load = ease.inOut(seg(l, 1800, 1150));
    put(one('bar'), 'transform', `scaleX(${Math.max(0.02, load).toFixed(4)})`);
    text(one('pct'), `${Math.round(load * 100)} %`);
    const ok = one('ok');
    const pop = seg(l, 2980, 420);
    put(ok, 'transform', `scale(${ease.back(pop).toFixed(3)})`);
    opacity(ok, clamp(pop * 4));

    opacity(one('sub'), seg(l, 900, 200) * (1 - seg(l, 3650, 400)));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l, 1920, 1080, '#0B121C', 0.55);
    drawRing(ctx, ZONE.x, ZONE.y, 140, 620, seg(l, 1620, 1100), BLUE, 3, 0.7);
    drawBurst(ctx, done, 1690, 585, l - 2990, 900);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <ParticleCanvas draw={draw} />
      <h3 className="mr-display ar-h">
        <Kinetic text="Загрузите лекцию" at={250} unit="letter" variant="drop" stagger={22} dur={620} accentFrom={1} out={{ at: 3650, dur: 450 }} />
      </h3>
      <div data-a="sub" className="ar-sub" style={{ opacity: 0 }}>
        <TypeLabel text="PDF · DOCX · фото · запись" at={950} cps={30} />
      </div>
      <div data-a="zone" className="ar-drop" style={{ opacity: 0 }}>
        <div data-a="zonet" className="ar-drop-t">
          <span data-a="arrow">
            <UploadIcon />
          </span>
          Перетащите файл
        </div>
      </div>
      <div data-a="file" className="ar-card ar-file" style={{ opacity: 0 }}>
        <DocIcon />
        <div className="ar-file-body">
          <span className="ar-file-name">Лекция 4. Эластичность.pdf</span>
          <span className="ar-file-meta">
            <span>2,4 МБ</span>
            <b data-a="pct">0 %</b>
          </span>
          <span className="ar-file-bar">
            <i data-a="bar" style={{ transform: 'scaleX(0.02)' }} />
          </span>
        </div>
        <span data-a="ok" className="ar-ok" style={{ opacity: 0 }}>
          <CheckIcon />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2 · The main line (4000–8400)

function Mark() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);

  useFrame((l) => {
    const sheet = one('sheet');
    const enter = ease.brand(seg(l, 0, 650));
    const push = ease.inOut(seg(l, 500, 1300));
    const leave = ease.in(seg(l, 3800, 550));
    put(
      sheet,
      'transform',
      `translate3d(${mix(0, -60, push).toFixed(1)}px,${mix(50, 0, enter).toFixed(1)}px,0) rotate(${mix(-2.4, -1.2, push).toFixed(2)}deg) scale(${(mix(0.96, 1, enter) * mix(1, 1.07, push) * mix(1, 1.06, leave)).toFixed(4)})`,
    );
    opacity(sheet, clamp(enter * 2) * (1 - leave));
    blur(sheet, leave * 16);

    // The marker runs along the main line.
    const mark = ease.inOut(seg(l, 1050, 800));
    put(one('key'), 'background-size', `${(mark * 100).toFixed(2)}% 100%`);

    // The note with its fragment slides out; the fragment chip and the line answer each other.
    const note = one('note');
    const slide = ease.brand(seg(l, 1950, 700));
    place(note, mix(140, 0, slide), mix(30, 0, slide) + 30 * leave, 1, mix(9, 2.5, slide));
    opacity(note, clamp(slide * 3) * (1 - leave));
    const echo = pulse(l, 2750, 700);
    put(one('chip'), 'box-shadow', `0 0 0 ${(16 * echo).toFixed(1)}px rgba(40,105,221,${(0.22 * echo).toFixed(3)})`);
    put(one('key'), 'box-shadow', echo > 0.01 ? `0 0 0 ${(10 * echo).toFixed(1)}px rgba(244,196,91,${(0.35 * echo).toFixed(3)})` : 'none');
  });

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <h3 className="mr-display ar-h">
        <Kinetic text="Найдите главное" at={200} unit="letter" variant="drop" stagger={22} dur={620} accentFrom={1} out={{ at: 3750, dur: 450 }} />
      </h3>
      <div data-a="sheet" className="ar-sheet" style={{ opacity: 0 }}>
        <p className="ar-sheet-h">Эластичность спроса</p>
        <p>Эластичность показывает, насколько сильно покупатели реагируют на изменение цены.</p>
        <p>
          <span data-a="key" className="ar-key">
            Спрос эластичен, если объём меняется сильнее цены.
          </span>
        </p>
        <p>Так ведут себя товары, которым легко найти замену.</p>
      </div>
      <div data-a="note" className="ar-card ar-note" style={{ opacity: 0 }}>
        <span className="ar-note-k">Конспект</span>
        <span className="ar-note-t">Эластичный спрос: объём меняется сильнее цены</span>
        <span data-a="chip" className="ar-chip">
          фрагмент 3
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3 · Recall (8000–12600), on blue

/** Where «Помню» sits in the row of grades (stage px, measured on the laid-out row). */
const YES = { x: 1300, y: 872 };
const CURSOR_KEYS = [
  { at: 2250, x: 1760, y: 1180 },
  { at: 2950, x: YES.x + 20, y: YES.y + 10 },
  { at: 3600, x: YES.x + 60, y: YES.y + 60 },
];

function Recall() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const yes = useMemo(() => makeBurst(41, { count: 30, colors: [GREEN, '#ffffff', YELLOW, SKY], near: 90, far: 320, dashes: 0.6, size: [3, 6] }), []);
  const dust = useMemo(() => makeDust(42, 50, 1920, 1080), []);

  useFrame((l) => {
    put(one('wipe'), 'clip-path', circleClip(ease.inOut(seg(l, 0, 720)), 960, 540));

    // The card comes up, then turns over.
    const card = one('card');
    const rise = seg(l, 450, 650);
    const leave = ease.in(seg(l, 4250, 350));
    place(card, 0, mix(70, 0, ease.brand(rise)) - 40 * ease.inOut(seg(l, 3250, 600)) - 30 * leave, mix(0.9, 1, ease.back(rise)) * mix(1, 0.92, ease.inOut(seg(l, 3250, 600))));
    opacity(card, clamp(rise * 3) * (1 - leave));
    const turn = ease.inOut(seg(l, 1450, 760));
    put(one('flip'), 'transform', `rotateY(${(180 * turn).toFixed(2)}deg)`);

    // The three grades pop in; «Помню» is pressed; then they make way for the schedule.
    const gone = ease.inOut(seg(l, 3250, 380));
    all('grade').forEach((grade, index) => {
      const pop = seg(l, 2250 + index * 90, 520);
      const press = index === 2 ? pulse(l, 2990, 260) : 0;
      put(grade, 'transform', `translate3d(0,${(mix(40, 0, ease.brand(pop)) + 30 * gone).toFixed(1)}px,0) scale(${(mix(0.6, 1, ease.back(pop)) * (1 - 0.08 * press)).toFixed(3)})`);
      opacity(grade, clamp(pop * 3) * (1 - gone) * (index === 2 ? 1 : 1 - 0.55 * seg(l, 3020, 200)));
    });

    // The next reviews line up: tomorrow, in three days, in a week.
    const line = ease.inOut(seg(l, 3400, 700));
    put(one('wline'), 'transform', `scaleX(${line.toFixed(4)})`);
    opacity(one('when'), 1 - leave);
    all('chip').forEach((chip, index) => {
      const pop = seg(l, 3420 + index * 180, 420);
      put(chip, 'transform', `translate3d(0,${mix(30, 0, ease.brand(pop)).toFixed(1)}px,0) scale(${mix(0.7, 1, ease.back(pop)).toFixed(3)})`);
      opacity(chip, clamp(pop * 3));
    });

    opacity(one('head'), 1 - leave);
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l, 1920, 1080, '#ffffff', 0.7);
    drawBurst(ctx, yes, YES.x, YES.y, l - 3010, 1000);
    drawRing(ctx, YES.x, YES.y, 60, 360, seg(l, 3010, 900), '#ffffff', 3, 0.7);
  };

  return (
    <div ref={root} className="mr-scene">
      <div data-a="wipe" className="ar-wipe mr-bg-blue" style={{ clipPath: 'circle(0 at 50% 50%)' }}>
        <div className="mr-halftone" />
        <ParticleCanvas draw={draw} />
        <h3 data-a="head" className="mr-display ar-h ar-h--light">
          <Kinetic text="Проверьте себя" at={420} unit="letter" variant="drop" stagger={22} dur={620} accentFrom={1} />
        </h3>
        <div data-a="card" className="ar-flip" style={{ opacity: 0 }}>
          <div data-a="flip" className="ar-flip-in">
            <div className="ar-face">
              <small>Карточка</small>
              Когда спрос эластичен?
            </div>
            <div className="ar-face ar-face--back">Когда объём меняется сильнее цены</div>
          </div>
        </div>
        <div className="ar-grades">
          <span data-a="grade" className="ar-grade ar-grade--no" style={{ opacity: 0 }}>
            Не помню
          </span>
          <span data-a="grade" className="ar-grade ar-grade--mid" style={{ opacity: 0 }}>
            С трудом
          </span>
          <span data-a="grade" className="ar-grade ar-grade--yes" style={{ opacity: 0 }}>
            Помню
          </span>
        </div>
        <div data-a="when" className="ar-when">
          <span data-a="wline" className="ar-when-line" style={{ transform: 'scaleX(0)' }} />
          {['завтра', 'через 3 дня', 'через неделю'].map((label, index) => (
            <span key={label} data-a="chip" className="ar-when-chip" style={{ left: 520 + index * 440, opacity: 0 }}>
              <i />
              {label}
            </span>
          ))}
        </div>
        <Cursor keys={CURSOR_KEYS} clicks={[2990]} from={2250} to={3550} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4 · The line and the mark (12200–16000), on dark; then the paper opens for the loop

const DOT = { x: 1132, y: 797 };

function Ready() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const dust = useMemo(() => makeDust(51, 70, 1920, 1080), []);
  const sparks = useMemo(() => makeBurst(52, { count: 26, colors: [YELLOW, '#ffffff', SKY], near: 60, far: 260, dashes: 0.55, size: [2, 5] }), []);

  useFrame((l) => {
    put(one('rise'), 'clip-path', riseClip(ease.inOut(seg(l, 0, 620))));
    const mark = one('mark');
    const pop = seg(l, 1500, 600);
    put(mark, 'transform', `translate3d(0,${mix(40, 0, ease.brand(pop)).toFixed(1)}px,0) scale(${mix(0.7, 1, ease.back(pop)).toFixed(3)})`);
    opacity(mark, clamp(pop * 3));
    put(one('paper'), 'clip-path', circleClip(ease.inOut(seg(l, 2950, 800)), DOT.x, DOT.y));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l, 1920, 1080, '#ffffff', 0.9);
    drawRing(ctx, DOT.x, DOT.y, 20, 300, seg(l, 1650, 1100), YELLOW, 3, 0.9);
    drawRing(ctx, DOT.x, DOT.y, 20, 520, seg(l, 1850, 1300), SKY, 2, 0.5);
    drawBurst(ctx, sparks, DOT.x, DOT.y, l - 1680, 950);
  };

  return (
    <div ref={root} className="mr-scene">
      <div data-a="rise" className="mr-layer mr-bg-dark" style={{ clipPath: 'inset(100% 0 0 0)' }}>
        <ParticleCanvas draw={draw} />
        <div className="mr-display ar-end">
          <Kinetic text="Вспоминайте," at={350} unit="letter" variant="drop" stagger={20} dur={620} accentFrom={0} />
          <br />
          <Kinetic text="а не перечитывайте." at={750} unit="letter" variant="drop" stagger={18} dur={620} />
        </div>
        <div data-a="mark" className="ar-end-mark" style={{ opacity: 0 }}>
          <span className="mr-wordmark">
            Meldy
            <span className="mr-wordmark-dot" />
          </span>
        </div>
      </div>
      <div data-a="paper" className="ar-wipe mr-bg-light" style={{ clipPath: 'circle(0 at 50% 50%)' }} />
    </div>
  );
}

export const LOGIN_SCENES: Record<string, ComponentType> = { upload: Upload, mark: Mark, recall: Recall, ready: Ready };
