/**
 * The PRO reel's four beats in the film style (components/film): real Meldy screens in monochrome,
 * heavy statements, a camera that drifts and tilts, motion blur on every fast move, the wordmark's
 * yellow dot opening and closing the loop. The limit meter of the top line is the hero: chips with
 * the price of each action («Лекция −20», «Ответ −4») fly into it. Example lectures and questions;
 * the prices, the day's units and the meter's numbers come from reelScript.ts (lib/plans.ts).
 */
import { useRef, type ComponentType, type ReactNode } from 'react';
import { blur, flag, opacity, place, put, text as setText, useEls, useFrame } from '../reel/engine';
import { STAGE_H, STAGE_W, clamp, ease, mix, pulse, seg } from '../reel/timeline';
import { Arrow, Statement, Wordmark, keyed, pressDepth, slideIn, slideOut } from '../film/kit';
import { FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../../lib/plans';
import {
  FILE_AT,
  FLIGHT,
  FREE_ANSWERS,
  FREE_EMPTY_AT,
  FREE_LECTURES,
  FREE_LEFT,
  FREE_SPENDS,
  FREE_TIMES,
  PAN,
  PRESS_AT,
  PRO_SPENDS,
  PRO_TICKETS,
  PRO_TIMES,
  SESSION_QUESTIONS,
  STAMP_AT,
  chipText,
  freeMeterAt,
  proFill,
  proMeterAt,
  type ProSceneId,
  type Spend,
} from './reelScript';

/** The dot of the loop, in stage pixels: every loop starts and ends on it. */
export const HOME = { x: STAGE_W / 2, y: STAGE_H / 2, size: 34 };

interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------------------------
// The Meldy window both days share: the top line with the limit meter, and a page under it.

/** The window's width and its top line's height (stage px; the window stands at 150, 150). */
const WIN_W = 1620;
const BAR_H = 124;
/** Where a chip lands: the meter's number in the top line (window px, measured in the browser). */
const METER: Point = { x: 1222, y: 62 };

function Win({ start, children }: { start: number; children: ReactNode }) {
  return (
    <div data-a="win" className="fm-win pr-win" style={{ opacity: 0 }}>
      <div className="fm-bar pr-bar">
        <Wordmark />
        <span className="fm-bar-nav pr-nav">
          <span>Сегодня</span>
          <span className="is-on">Экзамены</span>
          <span>Лекции</span>
        </span>
        <span className="pr-meter">
          <span className="pr-meter-l">Лимит ИИ</span>
          <span data-a="num" className="pr-meter-n">
            {start}
          </span>
          <span className="pr-meter-track">
            <i data-a="fill" className="pr-meter-fill" />
          </span>
        </span>
        <span className="fm-bar-me pr-me">А</span>
      </div>
      {children}
    </div>
  );
}

/** The meter: its number, the bar easing to the share left, a small bump when a chip lands. */
function meter(num: Element | undefined, fill: Element | undefined, l: number, value: number, share: number, spends: readonly Spend[]) {
  setText(num, String(value));
  let bump = 0;
  for (const spend of spends) bump = Math.max(bump, pulse(l, spend.lands, 260));
  put(num, 'transform', `scale(${(1 + 0.16 * bump).toFixed(3)})`);
  put(fill, 'transform', `scaleX(${clamp(share).toFixed(4)})`);
}

/** Units spent by `l`, each landing chip easing in over 300 ms (for the meter's bar). */
function easedSpent(spends: readonly Spend[], l: number): number {
  return spends.reduce((sum, spend) => sum + spend.cost * ease.out(seg(l, spend.lands, 300)), 0);
}

/** A chip with the price leaves its action and arcs into the meter, blurred by its speed. */
function fly(el: Element | undefined, l: number, spend: Spend, from: Point) {
  const p = seg(l, spend.at, FLIGHT);
  if (p <= 0 || p >= 1) {
    // Every property, every frame: the same moment looks the same whatever was played before.
    put(el, 'transform', 'none');
    opacity(el, 0);
    blur(el, 0);
    return;
  }
  // Across first, up late: the chip travels over the page and rises into the top line at the end.
  const x = mix(from.x, METER.x, ease.inOut(p));
  const y = mix(from.y, METER.y, ease.in(p));
  const scale = mix(1, 0.5, ease.in(p)) * (p < 0.14 ? mix(0.72, 1, ease.out(p / 0.14)) : 1);
  put(el, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${scale.toFixed(3)})`);
  opacity(el, Math.min(clamp(p / 0.08), 1 - clamp((p - 0.84) / 0.16)));
  blur(el, 7 * Math.sin(Math.PI * p));
}

/**
 * A statement that leaves at `out` (to the left, blurred). Its exit is written on every frame, before
 * it too: a scene put on the stage ahead of the loop's wrap (or a seek back) must find the words in
 * place, not still gone from the last pass (the kit's `out` writes only once the exit has begun).
 */
function Say({ lines, at, out, dot, className }: { lines: readonly string[]; at: number; out: number; dot?: boolean; className: string }) {
  const root = useRef<HTMLDivElement>(null);
  useFrame((l) => {
    const p = seg(l, out, 420);
    const e = ease.in(p);
    put(root.current, 'transform', p > 0 ? `translate3d(${(-180 * e).toFixed(1)}px,0,0)` : 'none');
    opacity(root.current, 1 - clamp((p - 0.55) / 0.45));
    blur(root.current, 24 * e);
  });
  return (
    <div ref={root} className="pr-say-box">
      <Statement lines={lines} at={at} dot={dot} className={className} />
    </div>
  );
}

/** The student's answer on a ticket, as the grey lines of text it is at this distance. */
function Lines() {
  return (
    <span className="pr-lines" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Chips({ spends }: { spends: readonly Spend[] }) {
  return (
    <div className="pr-chips" aria-hidden="true">
      {spends.map((spend, index) => (
        <span key={index} data-a="chip" className="pr-chip" style={{ opacity: 0 }}>
          {chipText(spend)}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 1 · «Сессия. Сто вопросов к экзамену.» — the dot of the last loop gives way to the words; a long
// list of questions drifts up behind them, out of focus.

const TOPICS = [
  'Спрос и предложение',
  'Эластичность спроса',
  'Рынок и равновесие',
  'Издержки фирмы',
  'Совершенная конкуренция',
  'Монополия',
  'Олигополия',
  'Рынок труда',
  'Инфляция',
  'Денежный рынок',
  'Безработица',
  'Экономический рост',
  'Налоги и бюджет',
  'Внешняя торговля',
];

function Intro() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    place(one('home'), HOME.x - HOME.size / 2, HOME.y - HOME.size / 2, 1 - ease.in(seg(l, 250, 380)));
    opacity(one('home'), 1 - seg(l, 520, 120));
    put(one('list'), 'transform', `translate3d(0,${(-320 * seg(l, 0, 2400)).toFixed(1)}px,0)`);
    opacity(one('list'), clamp(seg(l, 150, 600)) * 0.62 * (1 - seg(l, 1950, 400)));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="list" className="fm-card pr-ilist" style={{ opacity: 0 }}>
        {TOPICS.map((topic, index) => (
          <p key={topic} className="pr-irow">
            <b>{index + 1}</b>
            {topic}
          </p>
        ))}
      </div>
      <i data-a="home" className="fm-brand-dot pr-home" style={{ transform: `translate3d(${HOME.x - HOME.size / 2}px,${HOME.y - HOME.size / 2}px,0)` }} />
      <Say lines={['Сессия.', 'Сто вопросов к экзамену.']} at={400} out={1800} className="pr-say pr-say--intro" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2 · The free day: lecture files drop in, then ticket after ticket is checked; every action sends
// its price into the meter, which runs down to zero — the button greys, «Дневной лимит исчерпан».

const FILES: Array<[string, string]> = [
  ['Лекция 1.pdf', 'PDF · 18 страниц'],
  ['Лекция 2.pdf', 'PDF · 22 страницы'],
  ['Лекция 3.pdf', 'PDF · 15 страниц'],
  ['Лекция 4.pdf', 'PDF · 20 страниц'],
];
const FILE_TOP = (index: number) => 56 + index * 146;

/** The ticket on screen before answer i (one more than the answers: the last one stays unchecked). */
const FREE_TICKETS = Array.from({ length: FREE_ANSWERS + 1 }, (_, index) => ({
  number: 7 + index,
  question: TOPICS[(index + 1) % TOPICS.length],
}));
/** Answer i's ticket gives way to the next one this long after its press. */
const SWAP = 150;

const freeSource = (spend: Spend, index: number): Point => {
  // From the file that landed, or from «Проверить ответ» (its middle: 905, 622 in the window).
  if (spend.kind === 'lecture') return { x: 70 + 400, y: BAR_H + FILE_TOP(index) + 40 };
  return { x: 905, y: 612 };
};

/** The window comes in from the right out of focus and turned, pushes in slowly, leaves left. */
function freeCamera(el: Element | undefined, l: number) {
  const enter = ease.brand(seg(l, 0, 900));
  const out = ease.in(seg(l, FREE_TIMES.leave, 460));
  const turn = mix(-12, 0, ease.inOut(seg(l, 0, 1100)));
  // A slow push towards the meter, closer as the day runs out.
  const push = mix(0.97, 1.12, ease.inOut(clamp(l / FREE_TIMES.leave)));
  put(el, 'transform', `perspective(2800px) translate3d(${(mix(380, 0, enter) - 1300 * out).toFixed(1)}px,0,0) rotateY(${turn.toFixed(2)}deg) scale(${push.toFixed(4)})`);
  blur(el, 16 * (1 - ease.out(seg(l, 0, 700))) + 22 * out);
  opacity(el, clamp(seg(l, 0, 260) * 4) * (1 - clamp((out - 0.5) / 0.5)));
}

function Free() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    freeCamera(one('win'), l);
    all('file').forEach((file, index) => slideIn(file, l, FILE_AT(index), { dx: -760, dur: 520, smear: 22 }));
    slideIn(one('ticket'), l, FREE_TIMES.ticket, { dy: 420, dur: 640, smear: 16 });

    let press = 0;
    for (let index = 0; index < FREE_ANSWERS; index += 1) press = Math.max(press, pressDepth(l, PRESS_AT(index)));
    put(one('btn'), 'transform', `scale(${(1 - 0.06 * press).toFixed(3)})`);
    flag(one('btn'), 'is-off', l >= FREE_EMPTY_AT);
    all('tv').forEach((ticket, index) => {
      const start = index === 0 ? -Infinity : PRESS_AT(index - 1) + SWAP;
      const end = index < FREE_ANSWERS ? PRESS_AT(index) + SWAP : Infinity;
      const shown = l < start ? 0 : (index === 0 ? 1 : clamp((l - start) / 110)) * (l < end ? 1 : 1 - clamp((l - end) / 80));
      opacity(ticket, shown);
      put(ticket, 'transform', `translate3d(0,${(index === 0 ? 0 : 22 * (1 - ease.out(clamp((l - start) / 160)))).toFixed(1)}px,0)`);
    });

    // Out of units: the page goes soft behind the message.
    const soft = ease.inOut(seg(l, FREE_TIMES.limit, 520));
    blur(one('page'), 8 * soft);
    opacity(one('page'), 1 - 0.3 * soft);
    slideIn(one('limit'), l, FREE_TIMES.limit, { dy: 70, dur: 640, smear: 12 });

    let lecture = 0;
    all('chip').forEach((chip, index) => {
      const spend = FREE_SPENDS[index];
      fly(chip, l, spend, freeSource(spend, spend.kind === 'lecture' ? lecture++ : index));
    });
    meter(one('num'), one('fill'), l, freeMeterAt(l), (FREE_DAILY_UNITS - easedSpent(FREE_SPENDS, l)) / FREE_DAILY_UNITS, FREE_SPENDS);
  });
  return (
    <div ref={root} className="mr-scene">
      <Win start={FREE_DAILY_UNITS}>
        <div data-a="page" className="pr-page">
          {FILES.slice(0, FREE_LECTURES).map(([name, meta], index) => (
            <div key={name} data-a="file" className="fm-file pr-file" style={{ top: FILE_TOP(index), opacity: 0 }}>
              <span className="fm-sheet-ico" />
              <span>
                {name}
                <small>{meta}</small>
              </span>
            </div>
          ))}
          <div data-a="ticket" className="fm-card pr-ticket" style={{ opacity: 0 }}>
            {FREE_TICKETS.map((ticket, index) => (
              <div key={ticket.number} data-a="tv" className="pr-tv" style={{ opacity: index === 0 ? 1 : 0 }}>
                <span className="fm-st fm-st--ink">Билет {ticket.number} · вопрос 1 из 2</span>
                <p className="fm-h1 pr-tq">{ticket.question}</p>
                <Lines />
              </div>
            ))}
            <span data-a="btn" className="fm-btn fm-btn--blue pr-btn">
              Проверить ответ
              <i>
                <Arrow />
              </i>
            </span>
          </div>
        </div>
        <div data-a="limit" className="fm-card pr-limit" style={{ opacity: 0 }}>
          <p className="fm-h1 pr-limit-h">Дневной лимит исчерпан</p>
          <p className="pr-limit-p">
            Осталось {FREE_LEFT} из {FREE_DAILY_UNITS} единиц
          </p>
        </div>
        <Chips spends={FREE_SPENDS} />
      </Win>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3 · «С PRO —»: the meter fills to the PRO day; the camera whips from ticket after ticket checked,
// to a long list of questions getting its marks, to a conversation that plays. It barely moves.

const LIST_ROWS = 30;
const ROW_H = 88;
const MARKS: Array<['ok' | 'half' | 'no', string]> = [
  ['ok', 'есть'],
  ['ok', 'есть'],
  ['half', 'частично'],
  ['ok', 'есть'],
  ['no', 'нет'],
  ['ok', 'есть'],
  ['ok', 'есть'],
  ['half', 'частично'],
  ['ok', 'есть'],
  ['ok', 'есть'],
];
/** Row r gets its mark at listMarks + r × MARK_EVERY; the list scrolls with the marks. */
const MARK_EVERY = 24;
const TALK_WORDS = 'Спрос эластичен, если покупки меняются сильнее цены'.split(' ');
const TALK_WORD_EVERY = 90;
const SEGMENTS = 12;
const BARS = Array.from({ length: 22 }, (_, index) => index);

const stripAt = (l: number) =>
  keyed(
    l,
    [
      [0, 0],
      [PRO_TIMES.toList, 0],
      [PRO_TIMES.toList + PAN, -WIN_W],
      [PRO_TIMES.toTalk, -WIN_W],
      [PRO_TIMES.toTalk + PAN, -2 * WIN_W],
    ],
    ease.inOut,
  );

const listScroll = (l: number) => {
  const front = (l - PRO_TIMES.listMarks) / MARK_EVERY;
  return clamp((front - 5) * ROW_H, 0, (LIST_ROWS - 7) * ROW_H);
};

const proSource = (spend: Spend): Point => {
  // From the free corner of the front ticket (the stamp stays in view), the end of the list's head,
  // the end of the conversation's head (window px; the stamp is at 884–1214 × 554–686, the list's
  // head at 170–1450 × 164–294, the conversation's head line at 280–1340 × 246–282).
  if (spend.kind === 'answer') return { x: 1130, y: 300 };
  if (spend.kind === 'examMapping') return { x: 1250, y: 229 };
  return { x: 1180, y: 264 };
};

/** Behind the words out of focus, then sharp; a slow push while the day plays; out to the left. */
function proCamera(el: Element | undefined, l: number) {
  const enter = ease.brand(seg(l, 0, 900));
  const pull = ease.inOut(seg(l, PRO_TIMES.focus - 150, 650));
  const out = ease.in(seg(l, PRO_TIMES.leave, 460));
  const push = mix(1.05, 1, pull) * mix(1, 1.04, clamp((l - PRO_TIMES.focus) / (PRO_TIMES.leave - PRO_TIMES.focus)));
  put(el, 'transform', `translate3d(${(mix(140, 0, enter) - 1300 * out).toFixed(1)}px,0,0) scale(${push.toFixed(4)})`);
  blur(el, mix(16, 0, pull) + 22 * out);
  opacity(el, clamp(seg(l, 0, 300) * 3) * mix(0.5, 1, pull) * (1 - clamp((out - 0.5) / 0.5)));
}

function Pro() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    proCamera(one('win'), l);

    // The whip pans between the three things, blurred by their speed.
    const x = stripAt(l);
    put(one('strip'), 'transform', `translate3d(${x.toFixed(1)}px,0,0)`);
    blur(one('strip'), Math.min(18, Math.abs(x - stripAt(l - 16)) * 0.45));

    // Ticket after ticket: stamped «Проверено», then off to the left; the next one comes forward.
    let gone = 0;
    for (let index = 0; index < PRO_TICKETS - 1; index += 1) gone += ease.inOut(seg(l, STAMP_AT(index) + 200, 320));
    all('pcard').forEach((card, index) => {
      if (index < PRO_TICKETS - 1 && l > STAMP_AT(index) + 200) {
        slideOut(card, l, STAMP_AT(index) + 200, { dx: -1100, dur: 360, smear: 22 });
        return;
      }
      const depth = Math.max(0, index - gone);
      put(card, 'transform', `translate3d(0,${(-34 * depth).toFixed(1)}px,0) scale(${(1 - 0.05 * depth).toFixed(4)})`);
      blur(card, 3 * depth);
      opacity(card, depth > 2.4 ? 0 : 1 - 0.18 * depth);
    });
    all('stamp').forEach((stamp, index) => {
      const p = seg(l, STAMP_AT(index), 420);
      place(stamp, 0, 0, mix(1.5, 1, ease.back(p)), -7);
      opacity(stamp, clamp(p * 3));
    });
    all('oval').forEach((oval, index) => put(oval, 'stroke-dashoffset', (1 - ease.out(seg(l, STAMP_AT(index) + 40, 520))).toFixed(4)));

    // The long list: marks run down it, the list scrolls with them.
    const scroll = listScroll(l);
    put(one('rows'), 'transform', `translate3d(0,${(-scroll).toFixed(1)}px,0)`);
    blur(one('rows'), Math.min(8, Math.abs(scroll - listScroll(l - 16)) * 0.16));
    all('mark').forEach((mark, index) => slideIn(mark, l, PRO_TIMES.listMarks + index * MARK_EVERY, { dx: 40, dur: 340, smear: 6 }));

    // The conversation plays: its words light up as they are said, the replies fill in.
    all('tw').forEach((word, index) => put(word, 'color', l >= PRO_TIMES.talkLine + index * TALK_WORD_EVERY ? '#0b121c' : '#c3c5be'));
    const played = clamp((l - PRO_TIMES.talkLine) / (TALK_WORDS.length * TALK_WORD_EVERY));
    all('seg').forEach((piece, index) => put(piece, 'background', index < 2 + Math.floor(played * 3) ? '#0b121c' : '#e4e4de'));
    const talk = seg(l, PRO_TIMES.talkLine - 100, 160);
    all('bar').forEach((bar, index) => {
      const wave = 0.5 + 0.5 * Math.sin(l / 85 + index * 0.8) * Math.sin(l / 240 + index * 0.33);
      put(bar, 'transform', `scaleY(${(0.12 + 0.88 * wave * talk).toFixed(3)})`);
    });

    all('chip').forEach((chip, index) => fly(chip, l, PRO_SPENDS[index], proSource(PRO_SPENDS[index])));
    meter(one('num'), one('fill'), l, proMeterAt(l), (PRO_DAILY_UNITS * proFill(l) - easedSpent(PRO_SPENDS, l)) / PRO_DAILY_UNITS, PRO_SPENDS);
  });
  return (
    <div ref={root} className="mr-scene">
      <Win start={0}>
        <div data-a="strip" className="pr-strip">
          <div className="pr-panel">
            <div className="pr-deck">
              {Array.from({ length: PRO_TICKETS }, (_, index) => (
                <div key={index} data-a="pcard" className="fm-card pr-pcard" style={{ zIndex: PRO_TICKETS - index }}>
                  <span className="fm-st fm-st--ink">Билет {12 + index} · вопрос 1 из 2</span>
                  <p className="fm-h1 pr-tq">{TOPICS[(index * 3 + 1) % TOPICS.length]}</p>
                  <Lines />
                  <span data-a="stamp" className="pr-stamp" style={{ opacity: 0 }}>
                    <svg viewBox="0 0 400 160" aria-hidden="true">
                      <path data-a="oval" pathLength={1} d="M200 12 C 320 10, 392 46, 386 84 C 380 128, 300 152, 196 148 C 84 146, 10 120, 14 78 C 18 36, 92 14, 214 16" />
                    </svg>
                    Проверено
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="pr-panel pr-panel--2">
            <div className="fm-card pr-sheet">
              <div className="pr-sheet-head">
                <p className="fm-h1 pr-sheet-h">Микроэкономика</p>
                <p className="pr-sheet-c">{SESSION_QUESTIONS} вопросов · сверка с лекциями</p>
              </div>
              <div className="pr-rows-view">
                <div data-a="rows" className="pr-rows">
                  {Array.from({ length: LIST_ROWS }, (_, index) => {
                    const [kind, word] = MARKS[(index * 7 + 3) % MARKS.length];
                    return (
                      <div key={index} className="pr-row">
                        <span className="pr-row-n">{index + 1}</span>
                        <span className="pr-row-t">{TOPICS[index % TOPICS.length]}</span>
                        <span data-a="mark" className={`fm-st fm-st--${kind}`} style={{ opacity: 0 }}>
                          <b />
                          {word}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="pr-panel pr-panel--3">
            <div className="fm-card pr-talk">
              <p className="pr-talk-c">Разговор · Эластичность спроса</p>
              <p className="pr-talk-who">Софья</p>
              <p className="pr-talk-line">
                {TALK_WORDS.map((word, index) => (
                  <span key={index} data-a="tw">
                    {word}{' '}
                  </span>
                ))}
              </p>
              <div className="pr-player">
                <span className="pr-pause">
                  <i />
                  <i />
                </span>
                <span className="pr-wave">
                  {BARS.map((index) => (
                    <i key={index} data-a="bar" />
                  ))}
                </span>
                <span className="pr-segs">
                  {Array.from({ length: SEGMENTS }, (_, index) => (
                    <i key={index} data-a="seg" />
                  ))}
                </span>
              </div>
            </div>
          </div>
        </div>
        <Chips spends={PRO_SPENDS} />
      </Win>
      <Say lines={['С PRO —']} at={180} out={PRO_TIMES.focus - 150} className="pr-say pr-say--pro" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4 · «Готовьтесь, сколько нужно.» with the yellow dot for a period; the wordmark; its dot glides
// home to the middle — the frame the loop starts from.

function End() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const from = useRef<Point & { size: number } | null>(null);
  useFrame((l) => {
    const mark = one('mark');
    slideIn(mark, l, 1550, { dx: 160, dur: 760, smear: 22 });
    if (l >= 2550) {
      const leave = seg(l, 2550, 380);
      blur(mark, 16 * ease.in(leave));
      opacity(mark, 1 - leave);
    }
    // The wordmark's own dot stays behind and glides home.
    if (l >= 2500 && !from.current) from.current = measureDot(one('wmdot'), root.current);
    if (l < 2500) from.current = null;
    const start = from.current ?? HOME;
    const home = ease.inOut(seg(l, 2600, 700));
    const size = mix(start.size, HOME.size, home);
    const dot = one('home');
    put(dot, 'width', `${size.toFixed(2)}px`);
    put(dot, 'height', `${size.toFixed(2)}px`);
    put(dot, 'transform', `translate3d(${(mix(start.x, HOME.x, home) - size / 2).toFixed(1)}px,${(mix(start.y, HOME.y, home) - size / 2).toFixed(1)}px,0)`);
    opacity(dot, l >= 2550 ? 1 : 0);
    opacity(one('wmdot'), l >= 2550 ? 0 : 1);
  });
  return (
    <div ref={root} className="mr-scene">
      <Say lines={['Готовьтесь,', 'сколько нужно.']} at={250} dot out={1400} className="pr-say pr-say--end" />
      <div data-a="mark" className="pr-mark" style={{ opacity: 0 }}>
        <Wordmark className="pr-mark-w" />
      </div>
      <i data-a="home" className="fm-brand-dot pr-home" style={{ opacity: 0 }} />
    </div>
  );
}

/** Where the wordmark's dot is on the stage (stage pixels), or null where nothing is laid out. */
function measureDot(dot: Element | undefined, scene: HTMLElement | null): (Point & { size: number }) | null {
  const stage = scene?.closest('.mr-stage');
  if (!dot || !stage) return null;
  const s = stage.getBoundingClientRect();
  const d = dot.getBoundingClientRect();
  if (!s.width || !d.width) return null;
  const scale = s.width / STAGE_W;
  return {
    x: clamp((d.left + d.width / 2 - s.left) / scale, 0, STAGE_W),
    y: clamp((d.top + d.height / 2 - s.top) / scale, 0, STAGE_H),
    size: d.width / scale,
  };
}

export const PRO_SCENES: Record<ProSceneId, ComponentType> = { intro: Intro, free: Free, pro: Pro, end: End };
