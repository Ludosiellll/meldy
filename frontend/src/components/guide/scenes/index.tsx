/**
 * The guide's clips in the film style (components/film): a statement over the section's screen out
 * of focus, then the screen comes sharp and does the one thing the section is for. 4:3 stage,
 * 1440 × 1080, 6.4 s loops that start and end on empty paper (the exams' clip is longer: it goes
 * from a file to the first answer). Example data, the screens' own words.
 */
import { useRef, type ComponentType, type ReactNode } from 'react';
import { blur, flag, opacity, put, text as setText, useEls, useFrame } from '../../reel/engine';
import { Counter } from '../../reel/parts';
import { clamp, ease, mix, pulse, seg } from '../../reel/timeline';
import { Arrow, Statement, UploadIcon, Wordmark, focusIn, keyed, pressDepth, slideIn, slideOut } from '../../film/kit';
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../../../lib/plans';
import { SKIP_NOTE, dayRowText, dayText, lineText, startLabel } from '../../../lib/containers/words';
import * as copy from '../../containers/copy';
import { IMPORT, KEY_WORDS, nb } from '../../containers/copyImport';
import { plural } from '../../pro/planCopy';
import type { GuideChapterId } from '../chapters';
import './scenes.css';

export const CLIP = 6400;
/** The screen comes into focus here; the statement has left. */
const FOCUS = 1900;

/** The common choreography: the screen out of focus behind the words, then sharp, then gone. */
function Beat({ lines, total = CLIP, children }: { lines: readonly string[]; total?: number; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    const pull = ease.inOut(seg(l, FOCUS, 650));
    const out = ease.in(seg(l, total - 760, 600));
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
      {cta ? <span className="gs-strip-cta">Разобрать лекцию</span> : null}
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
// «Разобрать лекцию»

const MODULES = ['Конспект', 'Карточки', 'Самопроверка', 'Выжимка', 'Подкаст'];

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
        <p className="fm-h1 gs-h1">Разобрать лекцию</p>
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
  ['Эластичность спроса', 'конспект · 8 карточек · тест · подкаст', '2 окт.'],
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
              <span>Самопроверка 5</span>
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
// «Экзамены»: the exam as a new student meets it, on three screens. «Новый экзамен»: a file of
// questions goes in, Meldy finds them and the key (the file's bold), the date and the minutes; the
// exam's page: today's plan and «План по дням» up to the date; «Начать», and the first question
// answered. Every word is the screens' own (copyImport.ts, containers/copy.ts, the plan's words.ts);
// the plan's numbers are the study engine's for the example file (Guide.test plans it and compares).

/** The exam's clip goes from a file to the first answer: longer than the others. */
export const EXAMS_CLIP = 10800;

/** The example: a file of 400 questions with the answers in bold, the exam on 1 November, 30 minutes a day. */
export const EXAMS_EXAMPLE = {
  subject: 'Микроэкономика',
  file: 'Микроэкономика.docx',
  questions: 400,
  /** Planned on this day (the dates of the rows below). */
  today: '2026-10-10',
  date: '2026-11-01',
  /** As the date field shows it. */
  dateField: '01.11.2026',
  minutes: 30,
} as const;

const NB = '\u00a0';
/** The plan the engine makes for the example (lib/containers/plan.ts planDay and daysAhead on 10 October). */
export const EXAMS_PLAN = {
  /** planTitle: «Сегодня 38 вопросов, около 30 минут». */
  title: [`Сегодня `, `38${NB}вопросов`, `, около 30${NB}минут`] as const,
  start: startLabel(20, 15, null),
  days: [
    dayRowText({ from: '2026-10-10', to: '2026-10-27', kind: 'study', minutes: 30 }),
    dayRowText({ from: '2026-10-28', to: '2026-10-31', kind: 'window', minutes: null }),
    dayRowText({ from: '2026-11-01', to: '2026-11-01', kind: 'exam', minutes: null }),
  ],
  /** The import's line under «Время в день» (minutesLines `need`). */
  need: lineText({ key: 'need', n: [400, 30, 400], day: '2026-11-01' }),
  /** The exam's meta line: the date, the days to it and the size. */
  meta: copy.metaLine(copy.examDay(dayText('2026-11-01'), 22), 400, null),
};

/** The first question of the first «занятие»: its options in the order shown, the right one, its number and topic. */
export const EXAMS_QUESTION = {
  stem: 'Как называется ситуация, когда спрос превышает предложение?',
  options: ['Излишек', 'Дефицит', 'Равновесие', 'Инфляция'],
  right: 1,
  no: '57',
  topic: '2',
} as const;

/** Scene times (ms) of the exams' clip. */
export const EX = {
  /** The file comes in from the right and is over the card here: «Отпустите файлы — Meldy разберёт их». */
  fileIn: 2150,
  drag: 2620,
  /** Dropped: «Читаем 1 файл». */
  drop: 3050,
  /** «Нашли 400 вопросов», the date and the minutes. */
  found: 3500,
  save: 4350,
  /** The exam's page comes in. */
  page: 4550,
  days: 5450,
  daysOut: 7450,
  start: 7850,
  /** The first question comes in. */
  room: 8050,
  answer: 8850,
} as const;

/** A row of the reading list or of the preview: in focus from `at`. */
function focusRow(el: HTMLElement | undefined, l: number, at: number) {
  const p = ease.out(seg(l, at, 380));
  opacity(el, clamp(seg(l, at, 380) * 2.5));
  put(el, 'filter', p >= 1 ? 'none' : `blur(${(8 * (1 - p)).toFixed(2)}px)`);
}

/** Shown from `from` to `to`, faded in and out over `fade` ms at its edges. */
const between = (l: number, from: number, to: number, fade = 160) => seg(l, from, fade) * (1 - seg(l, to, fade));

/**
 * A screen that gives way to the next one: it slides aside, out of focus, and is gone within a third of a second, so
 * the next screen never lands on its words. It owns the element's transform, opacity and filter (as slideOut).
 */
function leave(el: HTMLElement | undefined, l: number, at: number) {
  const p = seg(l, at, 420);
  if (p <= 0) {
    put(el, 'transform', 'none');
    opacity(el, 1);
    blur(el, 0);
    return;
  }
  put(el, 'transform', `translate3d(${(-240 * ease.in(p)).toFixed(1)}px,0,0)`);
  opacity(el, 1 - ease.out(seg(l, at, 300)));
  blur(el, 18 * ease.out(p));
}

/** The next screen comes in from the right as the previous one leaves. */
const arrive = (el: HTMLElement | undefined, l: number, at: number) => slideIn(el, l, at + 160, { dx: 220, dur: 640, smear: 14 });

function Exams() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    // 1 · «Новый экзамен»: the file comes in from the right, over the card, and drops.
    const file = one('file');
    if (l < EX.drop) slideIn(file, l, EX.fileIn, { dx: 760, dy: 40, dur: 640, smear: 22 });
    else {
      const drop = ease.in(seg(l, EX.drop, 260));
      put(file, 'transform', `translate3d(0,${(26 * drop).toFixed(1)}px,0) scale(${mix(1, 0.86, drop).toFixed(4)})`);
      put(file, 'filter', 'none');
      opacity(file, 1 - drop);
    }
    // Over the card the page says what a drop does (the import's own drag state).
    opacity(one('dropping'), between(l, EX.drag, EX.drop, 120));
    opacity(one('pick'), 1 - seg(l, EX.drag, 120));
    // «Читаем 1 файл», its row «читаем…», then what was found in it.
    opacity(one('reading'), between(l, EX.drop + 120, EX.found - 40));
    focusRow(one('readrow'), l, EX.drop + 160);
    opacity(one('readwait'), 1 - seg(l, EX.found - 180, 100));
    opacity(one('readdone'), seg(l, EX.found - 160, 100));
    opacity(one('found'), seg(l, EX.found, 200));
    focusRow(one('subject'), l, EX.found + 120);
    all('field').forEach((field, index) => slideIn(field, l, EX.found + 200 + index * 140, { dx: 60, dur: 520, smear: 8 }));
    put(one('save'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, EX.save)).toFixed(3)})`);
    opacity(one('savea'), 1 - seg(l, EX.save + 40, 120));
    opacity(one('saveb'), seg(l, EX.save + 40, 120));
    leave(one('import'), l, EX.page);

    // 2 · The exam's page: today's plan, «План по дням» up to the date, «Начать».
    arrive(one('pagein'), l, EX.page);
    put(one('dayslink'), 'transform', `scale(${(1 - 0.08 * pressDepth(l, EX.days)).toFixed(3)})`);
    opacity(one('dim'), 0.22 * ease.inOut(seg(l, EX.days + 100, 380)) * (1 - ease.inOut(seg(l, EX.daysOut, 380))));
    if (l < EX.daysOut) slideIn(one('sheet'), l, EX.days + 100, { dy: 420, dur: 640, smear: 14 });
    else slideOut(one('sheet'), l, EX.daysOut, { dy: 520, dur: 440, smear: 14 });
    all('dayrow').forEach((row, index) => focusRow(row, l, EX.days + 330 + index * 100));
    put(one('start'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, EX.start)).toFixed(3)})`);
    leave(one('page'), l, EX.room);

    // 3 · The «занятие»: its own top line, the question, «Дефицит» — and the verdict.
    opacity(one('strip'), 1 - seg(l, EX.room, 240));
    opacity(one('roombar'), seg(l, EX.room + 260, 300));
    arrive(one('room'), l, EX.room);
    const answered = l >= EX.answer;
    all('opt').forEach((opt, index) => {
      const right = index === EXAMS_QUESTION.right;
      put(opt, 'transform', `scale(${(1 - (right ? 0.025 * pressDepth(l, EX.answer) : 0)).toFixed(3)})`);
      flag(opt, 'is-right', right && answered);
    });
    opacity(one('tag'), seg(l, EX.answer + 40, 160));
    opacity(one('ctxa'), 1 - seg(l, EX.answer, 120));
    opacity(one('ctxb'), seg(l, EX.answer, 160));
    opacity(one('dontknow'), 1 - seg(l, EX.answer, 120));
    slideIn(one('bar'), l, EX.answer + 120, { dy: 60, dur: 520, smear: 8 });
  });
  const pill = (label: string) => (
    <>
      {label}
      <i>
        <Arrow />
      </i>
    </>
  );
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Загрузите', 'вопросы.']} total={EXAMS_CLIP}>
        <div data-a="strip">
          <Strip items={['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс']} on="Экзамены" />
        </div>
        <div data-a="roombar" className="gs-ex-roombar" style={{ opacity: 0 }}>
          <Wordmark className="gs-ex-roombar-mark" />
          <span className="gs-ex-roombar-where">{copy.glue(`${EXAMS_EXAMPLE.subject} · ${copy.counter(1, 20)}`)}</span>
          <span className="gs-ex-roombar-exit">{copy.FINISH}</span>
        </div>

        {/* 1 · «Новый экзамен» */}
        <div data-a="import" className="gs-ex-screen">
          <p className="fm-h1 gs-h1">{IMPORT.title}</p>
          <div className="fm-card gs-ex-pick">
            <div data-a="pick" className="gs-ex-pickin">
              <p className="gs-ex-pick-h">{IMPORT.dropTitle}</p>
              <p className="gs-ex-pick-sub fm-muted">{nb(IMPORT.dropLede)}</p>
              <span className="fm-btn fm-btn--blue gs-ex-pick-go">{pill(IMPORT.pick)}</span>
            </div>
            <p data-a="dropping" className="gs-ex-dropping" style={{ opacity: 0 }}>
              {IMPORT.dropping}
            </p>
            <div data-a="reading" className="gs-ex-pickin" style={{ opacity: 0 }}>
              <p className="gs-ex-pick-h">{nb(IMPORT.reading(1))}</p>
              <div data-a="readrow" className="gs-ex-rows gs-ex-file" style={{ opacity: 0 }}>
                <span className="gs-ex-file-name">{EXAMS_EXAMPLE.file}</span>
                <span className="gs-ex-file-status fm-muted">
                  <span data-a="readwait">{IMPORT.readingWait}</span>
                  <span data-a="readdone" style={{ opacity: 0 }}>
                    {nb(IMPORT.fileFound(EXAMS_EXAMPLE.questions))}
                  </span>
                </span>
              </div>
            </div>
            <div data-a="found" className="gs-ex-pickin" style={{ opacity: 0 }}>
              <p className="gs-ex-pick-h">{nb(IMPORT.found(1, EXAMS_EXAMPLE.questions))}</p>
              <div data-a="subject" className="gs-ex-rows gs-ex-subject" style={{ opacity: 0 }}>
                <span className="gs-ex-subject-t">
                  {EXAMS_EXAMPLE.subject}
                  <small>{nb(`${IMPORT.rowTest(EXAMS_EXAMPLE.questions)} · ${KEY_WORDS.bold}`)}</small>
                </span>
                <svg className="gs-ex-chev" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M8 5l5 5-5 5" />
                </svg>
              </div>
            </div>
          </div>
          <div className="gs-ex-form">
            <div data-a="field" className="gs-ex-field" style={{ opacity: 0 }}>
              <span className="gs-ex-label fm-muted">{IMPORT.date}</span>
              <span className="gs-ex-input">{EXAMS_EXAMPLE.dateField}</span>
            </div>
            <div data-a="field" className="gs-ex-field" style={{ opacity: 0 }}>
              <span className="gs-ex-label fm-muted">{IMPORT.minutes}</span>
              <span className="gs-ex-input gs-ex-select">
                {IMPORT.minuteOption(EXAMS_EXAMPLE.minutes)}
                <svg className="gs-ex-chev" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </span>
              <span className="gs-ex-hint">{EXAMS_PLAN.need}</span>
            </div>
          </div>
          <span data-a="save" className="fm-btn fm-btn--blue gs-ex-save">
            <span className="gs-run-t">
              <span data-a="savea">{IMPORT.save}</span>
              <span data-a="saveb" style={{ opacity: 0 }}>
                {IMPORT.saving}
              </span>
            </span>
            <i>
              <Arrow />
            </i>
          </span>
          <div data-a="file" className="fm-file gs-ex-dropfile" style={{ opacity: 0 }}>
            <span className="fm-sheet-ico" />
            <span>
              {EXAMS_EXAMPLE.file}
              <small>DOCX</small>
            </span>
          </div>
        </div>

        {/* 2 · The exam's page */}
        <div data-a="page" className="gs-ex-screen">
          <div data-a="pagein" className="gs-ex-screen" style={{ opacity: 0 }}>
            <p className="fm-h1 gs-h1">{EXAMS_EXAMPLE.subject}</p>
            <p className="gs-lede fm-muted">{EXAMS_PLAN.meta}</p>
            <div className="fm-card gs-ex-plan">
              <p className="gs-ex-plan-t">
                {EXAMS_PLAN.title[0]}
                {EXAMS_PLAN.title[1]}
                {EXAMS_PLAN.title[2]}
              </p>
              <div className="gs-ex-plan-row">
                <p className="gs-ex-plan-links">
                  <span data-a="dayslink">{copy.PLAN_BY_DAYS}</span>
                </p>
                <span data-a="start" className="fm-btn fm-btn--blue gs-ex-start">
                  {pill(EXAMS_PLAN.start)}
                </span>
              </div>
            </div>
            <i data-a="dim" className="gs-ex-dim" style={{ opacity: 0 }} />
            <div data-a="sheet" className="fm-card gs-ex-sheet" style={{ opacity: 0 }}>
              <div className="gs-ex-sheet-head">
                <p className="gs-ex-sheet-t">{copy.PLAN_BY_DAYS}</p>
                <span className="gs-ex-sheet-x fm-muted">{copy.CLOSE}</span>
              </div>
              <ul className="gs-ex-days">
                <li data-a="dayrow" style={{ opacity: 0 }}>
                  {copy.daysMinutesRow(EXAMS_EXAMPLE.minutes)}
                  {copy.SEP}
                  <span className="gs-ex-link">{copy.CHANGE}</span>
                </li>
                {EXAMS_PLAN.days.map((row) => (
                  <li key={row} data-a="dayrow" style={{ opacity: 0 }}>
                    {row}
                  </li>
                ))}
              </ul>
              <p data-a="dayrow" className="gs-ex-skip fm-muted" style={{ opacity: 0 }}>
                {SKIP_NOTE}
              </p>
            </div>
          </div>
        </div>

        {/* 3 · The first question */}
        <div data-a="room" className="gs-ex-screen" style={{ opacity: 0 }}>
          <p className="gs-ex-ctx fm-muted">
            <span data-a="ctxa">{EXAMS_EXAMPLE.subject}</span>
            <span data-a="ctxb" style={{ opacity: 0 }}>
              {[EXAMS_EXAMPLE.subject, copy.fileNo(EXAMS_QUESTION.no), copy.topicNo(EXAMS_QUESTION.topic)].join(' · ')}
            </span>
          </p>
          <p className="gs-ex-stem">{EXAMS_QUESTION.stem}</p>
          <div className="fm-card gs-ex-opts">
            {EXAMS_QUESTION.options.map((option, index) => (
              <div key={option} data-a="opt" className="gs-ex-opt">
                <span className="gs-ex-opt-l">{copy.OPTION_LETTERS[index]}</span>
                <span className="gs-ex-opt-t">
                  {option}
                  {index === EXAMS_QUESTION.right ? (
                    <b data-a="tag" style={{ opacity: 0 }}>
                      {copy.TAG_RIGHT}
                    </b>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <p data-a="dontknow" className="gs-ex-dontknow">
            <span className="gs-ex-link">{copy.DONT_KNOW}</span>
          </p>
          <div data-a="bar" className="gs-ex-bar" style={{ opacity: 0 }}>
            <p className="gs-ex-verdict">{copy.VERDICT_RIGHT}</p>
            <span className="fm-btn fm-btn--blue gs-ex-next">{pill(copy.NEXT)}</span>
          </div>
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
            <span>Самопроверка не пройдена в лекции «Эластичность спроса»</span>
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

const clip = (Scene: ComponentType, poster = 5200, total = CLIP) => ({ total, poster, Scene });

export const GUIDE_SCENES: Record<Exclude<GuideChapterId, 'tests'>, { total: number; poster: number; Scene: ComponentType }> = {
  today: clip(Today),
  add: clip(Add),
  library: clip(Library),
  review: clip(Review),
  // The still frame: «План по дням» open, every row in — the exam's days up to its date.
  exams: clip(Exams, 6700, EXAMS_CLIP),
  progress: clip(Progress),
  // The still frame: both prices spent, both lines in, nothing in flight.
  limit: clip(Limit, 5450),
};
