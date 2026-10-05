/**
 * The guide's clips in the film style (components/film): a statement over the section's screen out
 * of focus, then the screen comes sharp and does the one thing the section is for. 4:3 stage,
 * 1440 × 1080, 6.4 s loops that start and end on empty paper. Example data, the screens' own words.
 */
import { useRef, type ComponentType, type ReactNode } from 'react';
import { blur, opacity, place, put, text as setText, useEls, useFrame } from '../../reel/engine';
import { Counter } from '../../reel/parts';
import { clamp, ease, mix, pulse, seg } from '../../reel/timeline';
import { Arrow, MicIcon, Statement, UploadIcon, Wordmark, focusIn, keyed, pressDepth, slideIn, slideOut } from '../../film/kit';
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../../../lib/plans';
import { plural } from '../../pro/planCopy';
import type { GuideChapterId } from '../chapters';
import './scenes.css';

export const CLIP = 6400;
/** The screen comes into focus here; the statement has left. */
const FOCUS = 1900;

/** The common choreography: the screen out of focus behind the words, then sharp, then gone. */
function Beat({ lines, children }: { lines: readonly string[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    const pull = ease.inOut(seg(l, FOCUS, 650));
    const out = ease.in(seg(l, CLIP - 760, 600));
    const ui = one('ui');
    put(ui, 'filter', `blur(${(mix(18, 0, pull) + 20 * out).toFixed(2)}px)`);
    put(ui, 'transform', `scale(${(mix(1.06, 1, pull) * mix(1, 0.97, out)).toFixed(4)})`);
    opacity(ui, clamp(seg(l, 100, 450) * 2) * mix(0.55, 1, pull) * (1 - out));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="ui" className="gs-ui" style={{ opacity: 0 }}>
        {children}
      </div>
      <Statement lines={lines} at={300} out={FOCUS - 120} className="gs-say" />
    </div>
  );
}

/** A slice of the top line with the section's pill on (and, at its end, whatever the clip is about). */
function Strip({ items, on, cta, children }: { items: readonly string[]; on?: string; cta?: boolean; children?: ReactNode }) {
  return (
    <div className="gs-strip">
      <Wordmark className="gs-strip-mark" />
      {items.map((item) => (
        <span key={item} className={item === on ? 'is-on' : undefined}>
          {item}
        </span>
      ))}
      {cta ? <span className="gs-strip-cta">Добавить лекцию</span> : null}
      {children}
    </div>
  );
}

const DOTS: Array<'ok' | 'half' | 'no'> = ['ok', 'ok', 'ok', 'half', 'ok', 'ok', 'no', 'ok', 'half', 'ok', 'ok', 'ok', 'no', 'ok', 'half', 'ok'];

// ---------------------------------------------------------------------------------------------
// «Сегодня»

function Today() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    all('dot').forEach((dot, index) => focusIn(dot, l, 2600 + index * 45, 300, 6));
    put(one('draw'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 4300)).toFixed(3)})`);
    slideIn(one('ticket'), l, 4450, { dx: -120, dur: 640, smear: 12 });
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Главное', 'на сегодня.']}>
        <Strip items={['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']} on="Сегодня" />
        <p className="fm-h1 gs-h1">Аня, что повторим?</p>
        <div className="fm-card gs-today-exam">
          <span className="fm-flag">Экзамен через 12 дней</span>
          <p className="fm-h1 gs-today-subj">Микроэкономика</p>
          <p className="gs-today-share">
            <Counter from={12} to={35} at={2300} dur={1300} />
            <span> %</span>
          </p>
          <p className="gs-today-cap fm-muted">билетов, где оба вопроса есть в ваших лекциях</p>
          <div className="gs-dots">
            {DOTS.map((kind, index) => (
              <i key={index} data-a="dot" className={`gs-dot gs-dot--${kind}`} style={{ opacity: 0 }} />
            ))}
          </div>
          <span data-a="draw" className="fm-btn fm-btn--blue gs-today-draw">
            Тянуть билет
            <i>
              <Arrow />
            </i>
          </span>
          <span data-a="ticket" className="fm-st fm-st--ink gs-today-ticket" style={{ opacity: 0 }}>
            Билет 12 · вопросы 2 и 31
          </span>
        </div>
        <div className="fm-card gs-today-due">
          <span className="fm-flag fm-flag--line">Повторение</span>
          <p className="gs-today-n">11 карточек на сегодня</p>
          <p className="gs-today-min fm-muted">Около 6 минут.</p>
          <span className="fm-btn fm-btn--ink gs-today-go">Начать повторение</span>
        </div>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Добавить лекцию»

const MODULES = ['Конспект', 'Карточки', 'Тест', 'Шпаргалка', 'Разговор'];

function Add() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    slideIn(one('file'), l, 2300, { dx: -900, dur: 760, smear: 24 });
    opacity(one('hint'), 1 - seg(l, 2700, 200));
    put(one('zone'), 'border-color', l >= 3000 ? '#0b121c' : '#cfd0c8');
    all('mod').forEach((chip, index) => {
      if (index > 2) return;
      const on = l >= 3150 + index * 150;
      put(chip, 'background', on ? '#0b121c' : '#ffffff');
      put(chip, 'color', on ? '#ffffff' : '#0b121c');
      put(chip, 'border-color', on ? '#0b121c' : '#e4e4de');
    });
    put(one('run'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 3900)).toFixed(3)})`);
    opacity(one('runa'), 1 - seg(l, 3950, 150));
    opacity(one('runb'), seg(l, 3950, 150));
    all('done').forEach((tick, index) => slideIn(tick, l, 4400 + index * 320, { dx: 30, dur: 420, smear: 8 }));
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Загрузите', 'лекцию.']}>
        <Strip items={['Сегодня', 'Экзамены', 'Лекции']} cta />
        <p className="fm-h1 gs-h1 gs-h1--two">Один материал — полный цикл подготовки</p>
        <div data-a="zone" className="gs-zone">
          <span data-a="hint" className="gs-zone-hint">
            <span className="gs-zone-ico">
              <UploadIcon />
            </span>
            Перетащите файл сюда
          </span>
          <div data-a="file" className="fm-file gs-zone-file" style={{ opacity: 0 }}>
            <span className="fm-sheet-ico" />
            <span>
              Лекция 4.pdf
              <small>PDF · 18 страниц</small>
            </span>
          </div>
        </div>
        <div className="fm-card gs-mods">
          <p className="gs-mods-h">Что подготовить</p>
          <div className="gs-mods-list">
            {MODULES.map((name, index) => (
              <span key={name} data-a="mod" className="gs-mod">
                {name}
                {index < 3 ? (
                  <b data-a="done" className="gs-mod-done" style={{ opacity: 0 }}>
                    Готово
                  </b>
                ) : null}
              </span>
            ))}
          </div>
        </div>
        <span data-a="run" className="fm-btn fm-btn--blue gs-run">
          <span className="gs-run-t">
            <span data-a="runa">Запустить анализ</span>
            <span data-a="runb" style={{ opacity: 0 }}>
              Запускаем…
            </span>
          </span>
          <i>
            <Arrow />
          </i>
        </span>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Лекции»

const LECTURES = [
  ['Эластичность спроса', 'конспект · 8 карточек · тест · разговор', '2 окт.'],
  ['Рынок и равновесие', 'конспект · 10 карточек · тест', '29 сент.'],
  ['Издержки фирмы', 'только текст, конспекта нет', '25 сент.'],
];

function Library() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    put(one('row0'), 'transform', `scale(${(1 - 0.025 * pressDepth(l, 3000)).toFixed(3)})`);
    all('row').forEach((row, index) => {
      if (index > 0) opacity(row, 1 - seg(l, 3050, 240));
    });
    const open = ease.inOut(seg(l, 3150, 650));
    const page = one('page');
    put(page, 'clip-path', `inset(0 0 ${mix(560, 0, open).toFixed(1)}px 0 round 36px)`);
    opacity(page, l >= 3150 ? 1 : 0);
    focusIn(one('pagein'), l, 3500, 500, 8);
    put(one('frag'), 'transform', `scale(${(1 - 0.08 * pressDepth(l, 4600)).toFixed(3)})`);
    put(one('frag'), 'box-shadow', l >= 4540 ? 'inset 0 0 0 3px #0b121c' : 'none');
    slideIn(one('slip'), l, 4800, { dx: 380, dur: 700, smear: 16 });
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Все лекции', 'в одном месте.']}>
        <Strip items={['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']} on="Лекции" />
        <p className="fm-h1 gs-h1">Лекции</p>
        <p className="gs-lede fm-muted">9 лекций · 42 карточки</p>
        {LECTURES.map(([title, meta, date], index) => (
          <div key={title} data-a="row" className="fm-card gs-lrow" style={{ top: 360 + index * 160 }}>
            <span data-a={index === 0 ? 'row0' : undefined} className="gs-lrow-in">
              <span className="gs-lrow-n">{index + 1}</span>
              <span className="gs-lrow-t">
                {title}
                <small>{meta}</small>
              </span>
              <span className="gs-lrow-d fm-muted">{date}</span>
            </span>
          </div>
        ))}
        <div data-a="page" className="fm-card gs-page" style={{ opacity: 0 }}>
          <div data-a="pagein">
            <p className="fm-h1 gs-page-h">Эластичность спроса</p>
            <div className="gs-tabs">
              <span className="is-on">Конспект</span>
              <span>Карточки 8</span>
              <span>Тест 5</span>
            </div>
            <p className="gs-sum-h">Когда спрос эластичен</p>
            <p className="gs-sum-p">
              Спрос эластичен, если объём покупок меняется сильнее цены.{' '}
              <span data-a="frag" className="fm-chip gs-frag">
                фрагмент 3
              </span>
            </p>
          </div>
          <div data-a="slip" className="fm-card gs-slip" style={{ opacity: 0 }}>
            <p className="gs-slip-c fm-muted">Фрагмент 3 лекции</p>
            <p className="gs-slip-q">«Цена выросла на 10 %, а покупки упали на 25 % — спрос эластичен».</p>
          </div>
        </div>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Повторение»

function Review() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    put(one('flipbtn'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 2700)).toFixed(3)})`);
    put(one('flip'), 'transform', `rotateY(${(180 * ease.inOut(seg(l, 2800, 600))).toFixed(2)}deg)`);
    opacity(one('before'), 1 - seg(l, 2850, 200));
    all('grade').forEach((grade, index) => {
      const pressed = index === 2 && l >= 4200;
      opacity(grade, clamp(seg(l, 3350 + index * 70, 260) * 3) * (1 - seg(l, 4750, 250)));
      put(grade, 'background', pressed ? '#0b121c' : '#ffffff');
      put(grade, 'color', pressed ? '#ffffff' : '#0b121c');
      put(grade, 'transform', `scale(${(1 - (index === 2 ? 0.06 * pressDepth(l, 4200) : 0)).toFixed(3)})`);
    });
    slideIn(one('when'), l, 4400, { dy: 24, dur: 480, smear: 6 });
    slideOut(one('front'), l, 4700, { dx: 1300, dur: 520, smear: 24 });
    const next = ease.inOut(seg(l, 4800, 600));
    put(one('next'), 'transform', `translate3d(${mix(40, 0, next).toFixed(1)}px,${mix(-40, 0, next).toFixed(1)}px,0) scale(${mix(0.95, 1, next).toFixed(4)})`);
    put(one('next'), 'filter', `blur(${mix(5, 0, next).toFixed(2)}px)`);
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Сначала', 'вспомните.']}>
        <Strip items={['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']} on="Повторение" />
        <p className="gs-review-top fm-muted">1 из 11 · Эластичность спроса</p>
        <div className="fm-card gs-card gs-card--far" />
        <div data-a="next" className="fm-card gs-card">
          <p className="gs-card-l fm-muted">Рынок и равновесие</p>
          <p className="gs-card-q">Что такое равновесная цена?</p>
        </div>
        <div data-a="front" className="gs-front">
          <div data-a="flip" className="gs-flip-in">
            <div className="fm-card gs-card gs-face">
              <p className="gs-card-l fm-muted">Эластичность спроса</p>
              <p className="gs-card-q">Когда спрос эластичен?</p>
            </div>
            <div className="fm-card gs-card gs-face gs-face--back">
              <p className="gs-card-l fm-muted">Ответ</p>
              <p className="gs-card-q">Когда объём меняется сильнее цены</p>
            </div>
          </div>
        </div>
        <div data-a="before" className="gs-before">
          <span data-a="flipbtn" className="fm-btn fm-btn--line">
            Перевернуть
          </span>
          <p className="fm-muted">Сначала вспомните ответ, потом переверните карточку.</p>
        </div>
        <div className="gs-grades">
          <span data-a="grade" className="gs-grade" style={{ opacity: 0 }}>
            Не помню
          </span>
          <span data-a="grade" className="gs-grade" style={{ opacity: 0 }}>
            С трудом
          </span>
          <span data-a="grade" className="gs-grade" style={{ opacity: 0 }}>
            Помню
          </span>
        </div>
        <p data-a="when" className="gs-when" style={{ opacity: 0 }}>
          Помню — вернётся через 6 дней.
        </p>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Экзамены»

const QUESTIONS: Array<[string, 'ok' | 'half' | 'no', string]> = [
  ['Спрос и предложение', 'ok', 'есть в лекциях'],
  ['Эластичность спроса', 'ok', 'есть в лекциях'],
  ['Монополия', 'half', 'частично'],
  ['Инфляция', 'no', 'нет ни в одной'],
];
const BARS = Array.from({ length: 22 }, (_, index) => index);

function Exams() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    all('st').forEach((chip, index) => slideIn(chip, l, 2500 + index * 220, { dx: 50, dur: 460, smear: 8 }));
    put(one('draw'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 3600)).toFixed(3)})`);
    opacity(one('draw'), 1 - seg(l, 3800, 240));
    slideIn(one('ticket'), l, 3750, { dy: 420, dur: 680, smear: 16 });
    put(one('voice'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 4450)).toFixed(3)})`);
    const talk = seg(l, 4550, 150) * (1 - seg(l, 5250, 200));
    all('bar').forEach((bar, index) => {
      const wave = 0.5 + 0.5 * Math.sin(l / 85 + index * 0.8) * Math.sin(l / 240 + index * 0.33);
      put(bar, 'transform', `scaleY(${(0.1 + 0.9 * wave * talk).toFixed(3)})`);
    });
    opacity(one('wave'), seg(l, 4500, 200));
    const stamp = seg(l, 5250, 420);
    place(one('stamp'), 0, 0, mix(1.5, 1, ease.back(stamp)), -7);
    opacity(one('stamp'), clamp(stamp * 3));
    put(one('oval'), 'stroke-dashoffset', (1 - ease.out(seg(l, 5300, 520))).toFixed(4));
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Билет —', 'как на экзамене.']}>
        <Strip items={['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']} on="Экзамены" />
        <p className="fm-h1 gs-h1">Микроэкономика</p>
        <p className="gs-lede fm-muted">Экзамен 15 октября, через 12 дней · 40 вопросов</p>
        <div className="fm-card gs-sheet">
          {QUESTIONS.map(([text, kind, word], index) => (
            <div key={text} className="gs-q">
              <span className="gs-q-n fm-muted">{index + 1}</span>
              <span className="gs-q-t">{text}</span>
              <span data-a="st" className={`fm-st fm-st--${kind}`} style={{ opacity: 0 }}>
                <b />
                {word}
              </span>
            </div>
          ))}
        </div>
        <span data-a="draw" className="fm-btn fm-btn--blue gs-sheet-draw">
          Тянуть билет
          <i>
            <Arrow />
          </i>
        </span>
        <div data-a="ticket" className="fm-card gs-ticket" style={{ opacity: 0 }}>
          <span className="fm-st fm-st--ink">Билет 12 · вопрос 1 из 2</span>
          <p className="fm-h1 gs-ticket-q">Эластичность спроса</p>
          <div className="gs-voice-row">
            <span data-a="voice" className="fm-btn fm-btn--blue">
              <MicIcon />
              Отвечать голосом
            </span>
            <span data-a="wave" className="gs-wave" style={{ opacity: 0 }}>
              {BARS.map((index) => (
                <i key={index} data-a="bar" />
              ))}
            </span>
          </div>
          <span data-a="stamp" className="gs-stamp" style={{ opacity: 0 }}>
            <svg viewBox="0 0 400 160" aria-hidden="true">
              <path data-a="oval" pathLength={1} d="M200 12 C 320 10, 392 46, 386 84 C 380 128, 300 152, 196 148 C 84 146, 10 120, 14 78 C 18 36, 92 14, 214 16" />
            </svg>
            Засчитано
          </span>
        </div>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Прогресс»

function Progress() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    all('bar').forEach((bar, index) => put(bar, 'transform', `scaleX(${ease.inOut(seg(l, 2400 + index * 120, 800)).toFixed(4)})`));
    put(one('again'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 4400)).toFixed(3)})`);
    focusIn(one('todo'), l, 3300, 500, 8);
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Видно,', 'что дальше.']}>
        <Strip items={['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']} on="Прогресс" />
        <p className="fm-h1 gs-h1">Прогресс</p>
        <div className="fm-card gs-tile" style={{ left: 80 }}>
          <p className="gs-tile-h">Карточки</p>
          <div className="gs-bar">
            <i data-a="bar" className="gs-bar-ok" style={{ width: '56%' }} />
            <i data-a="bar" className="gs-bar-mid" style={{ width: '28%' }} />
            <i data-a="bar" className="gs-bar-new" style={{ width: '16%' }} />
          </div>
          <p className="gs-tile-l">закреплены 18</p>
          <p className="gs-tile-l">учатся 9</p>
          <p className="gs-tile-l">новые 5</p>
        </div>
        <div className="fm-card gs-tile" style={{ left: 520 }}>
          <p className="gs-tile-h">Вспомнили с 3 октября</p>
          <div className="gs-bar">
            <i data-a="bar" className="gs-bar-ink" style={{ width: '82%' }} />
            <i data-a="bar" className="gs-bar-new" style={{ width: '18%' }} />
          </div>
          <p className="gs-tile-l">вспомнили 42</p>
          <p className="gs-tile-l">не вспомнили 9</p>
        </div>
        <div className="fm-card gs-tile" style={{ left: 960 }}>
          <p className="gs-tile-h">Повторения на неделю</p>
          <p className="gs-tile-big">
            <Counter from={6} to={23} at={2500} dur={1100} />
          </p>
          <p className="gs-tile-l fm-muted">Завтра — 6.</p>
          <span data-a="again" className="fm-btn fm-btn--blue gs-tile-btn">
            Повторить
          </span>
        </div>
        <div data-a="todo" className="fm-card gs-todo" style={{ opacity: 0 }}>
          <p className="gs-tile-h">Что подтянуть</p>
          <div className="gs-todo-row">
            <span>Тест не пройден в лекции «Эластичность спроса»</span>
            <span className="fm-btn fm-btn--line">Пройти тест</span>
          </div>
        </div>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Лимит ИИ»: the meter at the end of the top line; a lecture is analysed and an answer checked, and
// their prices fly into it; then when it comes back and what PRO gives. Numbers: lib/plans.ts.

interface Spend {
  cost: number;
  /** Scene time the chip leaves its button; it lands (and the meter changes) FLY later. */
  at: number;
}

/** How long a price flies from its button to the meter (ms). */
export const LIMIT_FLY = 600;
const FLY = LIMIT_FLY;
export const LIMIT_SPENDS: readonly Spend[] = [
  { cost: AI_COSTS.lecture, at: 2560 },
  { cost: AI_COSTS.answer, at: 3410 },
];
const LIMIT_PRESS = [2500, 3350];
/** «Обновится ночью» and «С PRO — 1000 в день» come in here. */
const LIMIT_NIGHT = 4250;
const LIMIT_PRO = 4650;

/** The meter's number at scene time `l`: the free day, less each price that has landed. */
export function limitMeterAt(l: number): number {
  return LIMIT_SPENDS.reduce((left, spend) => (l >= spend.at + FLY ? left - spend.cost : left), FREE_DAILY_UNITS);
}

/** Where the prices start (the middle of each button) and land (the meter's number): stage px, measured in the browser. */
const LIMIT_FROM = [
  { x: 344, y: 668 },
  { x: 1017, y: 668 },
];
const LIMIT_TO = { x: 1290, y: 102 };
/** The free strip between the top line and the cards: the prices cross the screen there. */
const LIMIT_LANE = 236;

function Limit() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    all('press').forEach((button, index) => put(button, 'transform', `scale(${(1 - 0.06 * pressDepth(l, LIMIT_PRESS[index])).toFixed(3)})`));
    all('chip').forEach((chip, index) => {
      const spend = LIMIT_SPENDS[index];
      const p = seg(l, spend.at, FLY);
      if (p <= 0 || p >= 1) {
        put(chip, 'transform', 'none');
        opacity(chip, 0);
        blur(chip, 0);
        return;
      }
      // Up out of its card, across the free strip above the cards, then into the meter.
      const from = LIMIT_FROM[index];
      const x = keyed(p, [[0, from.x], [0.22, from.x], [0.82, LIMIT_TO.x], [1, LIMIT_TO.x]]);
      const y = keyed(p, [[0, from.y], [0.36, LIMIT_LANE], [0.72, LIMIT_LANE], [1, LIMIT_TO.y]]);
      const scale = mix(1, 0.55, ease.in(p)) * (p < 0.14 ? mix(0.72, 1, ease.out(p / 0.14)) : 1);
      put(chip, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${scale.toFixed(3)})`);
      opacity(chip, Math.min(clamp(p / 0.08), 1 - clamp((p - 0.84) / 0.16)));
      blur(chip, 6 * Math.sin(Math.PI * p));
    });
    // The meter: the number on landing (with a small bump), the ring easing to what is left.
    const left = limitMeterAt(l);
    setText(one('num'), String(left));
    let bump = 0;
    for (const spend of LIMIT_SPENDS) bump = Math.max(bump, pulse(l, spend.at + FLY, 260));
    put(one('num'), 'transform', `scale(${(1 + 0.18 * bump).toFixed(3)})`);
    const eased = LIMIT_SPENDS.reduce((sum, spend) => sum + spend.cost * ease.out(seg(l, spend.at + FLY, 320)), 0);
    put(one('arc'), 'stroke-dasharray', `${((100 * (FREE_DAILY_UNITS - eased)) / FREE_DAILY_UNITS).toFixed(2)} 100`);
    slideIn(one('night'), l, LIMIT_NIGHT, { dx: -60, dur: 640, smear: 12 });
    slideIn(one('pro'), l, LIMIT_PRO, { dx: -60, dur: 640, smear: 12 });
  });
  const units = `${FREE_DAILY_UNITS} ${plural(FREE_DAILY_UNITS, ['единица', 'единицы', 'единиц'])}`;
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={[units, 'в день.']}>
        <Strip items={['Сегодня', 'Экзамены', 'Лекции']}>
          <div className="gs-meter">
            <svg className="gs-meter-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle className="gs-meter-track" cx="20" cy="20" r="16.5" />
              <circle data-a="arc" className="gs-meter-arc" cx="20" cy="20" r="16.5" pathLength={100} strokeDasharray="100 100" transform="rotate(-90 20 20)" />
            </svg>
            <em className="gs-meter-t">Лимит ИИ</em>
            <b data-a="num" className="gs-meter-n">
              {FREE_DAILY_UNITS}
            </b>
          </div>
        </Strip>
        <div className="fm-card gs-lim-card" style={{ left: 80 }}>
          <div className="gs-lim-file">
            <span className="fm-sheet-ico" />
            <span>
              Лекция 4.pdf
              <small>PDF · 18 страниц</small>
            </span>
          </div>
          <span data-a="press" className="fm-btn fm-btn--blue gs-lim-btn">
            Запустить анализ
            <i>
              <Arrow />
            </i>
          </span>
        </div>
        <div className="fm-card gs-lim-card" style={{ left: 760 }}>
          <span className="fm-st fm-st--ink">Билет 12 · вопрос 1 из 2</span>
          <p className="fm-h1 gs-lim-q">Эластичность спроса</p>
          <span className="gs-lim-lines" aria-hidden="true">
            <i />
            <i />
          </span>
          <span data-a="press" className="fm-btn fm-btn--blue gs-lim-btn">
            Проверить ответ
            <i>
              <Arrow />
            </i>
          </span>
        </div>
        <div className="gs-lim-notes">
          <span data-a="night" className="fm-flag gs-lim-flag" style={{ opacity: 0 }}>
            Обновится ночью
          </span>
          <span data-a="pro" className="fm-flag fm-flag--yellow gs-lim-flag" style={{ opacity: 0 }}>
            С PRO — {PRO_DAILY_UNITS} в день
          </span>
        </div>
        <div className="gs-lim-chips" aria-hidden="true">
          {LIMIT_SPENDS.map((spend, index) => (
            <span key={index} data-a="chip" className="gs-lim-chip" style={{ opacity: 0 }}>
              −{spend.cost}
            </span>
          ))}
        </div>
      </Beat>
    </div>
  );
}

const clip = (Scene: ComponentType, poster = 5200) => ({ total: CLIP, poster, Scene });

export const GUIDE_SCENES: Record<GuideChapterId, { total: number; poster: number; Scene: ComponentType }> = {
  today: clip(Today),
  add: clip(Add),
  library: clip(Library),
  review: clip(Review),
  exams: clip(Exams),
  progress: clip(Progress),
  // The still frame: both prices spent, both lines in, nothing in flight.
  limit: clip(Limit, 5450),
};
