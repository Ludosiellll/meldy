/**
 * The sign-up reel, «Материал становится планом подготовки», in the film style: the course's files,
 * the exam questions checked against them, the days of repetition, the exam card — and the dot.
 * Example course and numbers; the screens' own words.
 */
import { useRef } from 'react';
import { opacity, place, put, useEls, useFrame } from '../reel/engine';
import { Counter } from '../reel/parts';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Arrow, Statement, Typed, focusIn, pressDepth, slideIn } from '../film/kit';
import { shot } from './camera';
import { HOME, Ready } from './Ready';

// ---------------------------------------------------------------------------------------------
// 1 · «Всё, что дали на парах.» — the files of a course, in and out of focus; then they rush on.

const FILES: Array<{ name: string; meta: string; x: number; y: number; blur: number; scale: number; ink?: boolean }> = [
  { name: 'Лекция 4.pdf', meta: 'PDF · 18 страниц', x: 110, y: 120, blur: 0, scale: 1 },
  { name: 'Фото доски.jpg', meta: 'фото с пары', x: 1300, y: 96, blur: 6, scale: 0.9 },
  { name: 'Запись пары.m4a', meta: '1 ч 20 мин', x: 70, y: 770, blur: 9, scale: 0.86, ink: true },
  { name: 'Методичка.docx', meta: 'DOCX', x: 1360, y: 790, blur: 2, scale: 1.04 },
  { name: 'Вопросы к экзамену.docx', meta: '40 вопросов', x: 640, y: 880, blur: 13, scale: 0.8 },
  { name: 'Мои заметки.txt', meta: 'текст', x: 760, y: 40, blur: 11, scale: 0.76 },
];
const PILE_LEAVE = 3360;

function Pile() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    place(one('home'), HOME.x - HOME.size / 2, HOME.y - HOME.size / 2, 1 - ease.in(seg(l, 250, 380)));
    opacity(one('home'), 1 - seg(l, 520, 120));
    all('file').forEach((file, index) => {
      const spec = FILES[index];
      const p = ease.inOut(seg(l, 120 + index * 90, 760));
      const drift = (l / 1000) * (index % 2 === 0 ? 14 : -12);
      const rush = ease.in(seg(l, 2900 + index * 50, 520));
      put(file, 'transform', `translate3d(${(drift + 1500 * rush).toFixed(1)}px,${mix(40, 0, p).toFixed(1)}px,0) scale(${spec.scale})`);
      put(file, 'filter', `blur(${(spec.blur + 16 * (1 - p) + 20 * rush).toFixed(2)}px)`);
      opacity(file, clamp(p * 2) * (1 - clamp((rush - 0.6) / 0.4)));
    });
  });
  return (
    <div ref={root} className="mr-scene">
      {FILES.map((file) => (
        <div key={file.name} data-a="file" className="fm-file rg-file" style={{ left: file.x, top: file.y, opacity: 0 }}>
          <span className={`fm-sheet-ico${file.ink ? ' fm-sheet-ico--ink' : ''}`} />
          <span>
            {file.name}
            <small>{file.meta}</small>
          </span>
        </div>
      ))}
      <i data-a="home" className="fm-brand-dot ar-home" style={{ transform: `translate3d(${HOME.x - HOME.size / 2}px,${HOME.y - HOME.size / 2}px,0)` }} />
      <Statement lines={['Всё, что', 'дали на парах']} at={560} dot out={PILE_LEAVE} className="ar-say ar-say--center" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2 · «Вопросы — по лекциям.» — the list is typed in, «Сверить с лекциями», each line is marked.

const SHEET_LEAVE = 4160;
const QUESTIONS: Array<{ text: string; kind: 'ok' | 'half' | 'no'; word: string }> = [
  { text: '1. Спрос и предложение', kind: 'ok', word: 'есть в лекциях' },
  { text: '2. Эластичность спроса', kind: 'ok', word: 'есть в лекциях' },
  { text: '3. Монополия', kind: 'half', word: 'частично' },
  { text: '4. Инфляция', kind: 'no', word: 'нет ни в одной' },
];
const TYPED = QUESTIONS.map((question) => question.text).join('\n');

function Sheet() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('editor'), l, SHEET_LEAVE);
    put(one('mapbtn'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 2500)).toFixed(3)})`);
    all('st').forEach((chip, index) => slideIn(chip, l, 2700 + index * 200, { dx: 60, dur: 520, smear: 10 }));
    opacity(one('mapped'), seg(l, 3500, 300));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="editor" className="fm-win rg-editor" style={{ opacity: 0 }}>
        <div className="rg-editor-in">
          <p className="fm-h1 rg-editor-h">Новый экзамен</p>
          <p className="rg-label">Вопросы к экзамену</p>
          <div className="rg-field">
            <Typed text={TYPED} at={500} cps={40} className="rg-typed" />
            <div className="rg-marks">
              {QUESTIONS.map((question) => (
                <span key={question.text} data-a="st" className={`fm-st fm-st--${question.kind}`} style={{ opacity: 0 }}>
                  <b />
                  {question.word}
                </span>
              ))}
            </div>
          </div>
          <div className="rg-actions">
            <span data-a="mapbtn" className="fm-btn fm-btn--blue">
              Сверить с лекциями
              <i>
                <Arrow />
              </i>
            </span>
            <span data-a="mapped" className="rg-mapped fm-muted" style={{ opacity: 0 }}>
              24 из 40 вопросов есть в лекциях
            </span>
          </div>
        </div>
      </div>
      <Statement lines={['Вопросы —', 'по лекциям.']} at={350} out={SHEET_LEAVE} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3 · «Повторение по дням.» — the week, tilted like a desk: the cards of each day settle in.

const WEEK_LEAVE = 3700;
const DAYS = [
  ['Пн', '14'],
  ['Вт', '15'],
  ['Ср', '16'],
  ['Чт', '17'],
  ['Пт', '18'],
  ['Сб', '19'],
  ['Вс', '20'],
];
/**
 * The cards due per day: [day, top, height, topic, cards, ink]. A block is 152 px wide: a topic is
 * one short word (Эластичность does not fit), the count goes on its own line.
 */
const BLOCKS: Array<[number, number, number, string, string, boolean]> = [
  [0, 120, 230, '11 карточек', '', true],
  [0, 370, 120, 'Билет 12', '', false],
  [1, 120, 150, 'Спрос', '4 карточки', false],
  [1, 290, 120, 'Рынок', '3 карточки', false],
  [2, 180, 120, 'Издержки', '2 карточки', false],
  [3, 120, 200, 'Спрос', '6 карточек', false],
  [4, 240, 120, 'Монополия', '3 карточки', false],
  [6, 140, 170, 'Рынок', '5 карточек', false],
];

function Week() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('board'), l, WEEK_LEAVE, 'rotateX(16deg) rotateZ(-5deg)');
    all('block').forEach((block, index) => slideIn(block, l, 650 + index * 150, { dy: -120, dur: 640, smear: 14, scale: 1.04 }));
    const sweep = ease.inOut(seg(l, 500, 900));
    put(one('now'), 'transform', `scaleY(${sweep.toFixed(4)})`);
    opacity(one('nowtag'), seg(l, 1200, 300));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="board" className="fm-win rg-board" style={{ opacity: 0 }}>
        <div className="rg-days">
          {DAYS.map(([day, date], index) => (
            <span key={date} className={`rg-day${index === 0 ? ' rg-day--today' : ''}`}>
              {day} <b>{date}</b>
            </span>
          ))}
        </div>
        <div className="rg-cols">
          {DAYS.map(([, date], index) => (
            <i key={date} className="rg-col" style={{ left: 16 + index * 168 }} />
          ))}
          {BLOCKS.map(([day, top, height, topic, cards, ink], index) => (
            <span
              key={index}
              data-a="block"
              className={`rg-block${ink ? ' rg-block--ink' : ''}`}
              style={{ left: 24 + day * 168, top, height, opacity: 0 }}
            >
              {topic}
              {cards ? <small>{cards}</small> : null}
            </span>
          ))}
          <i data-a="now" className="rg-now" style={{ transform: 'scaleY(0)' }} />
          <span data-a="nowtag" className="fm-now-tag rg-now-tag" style={{ opacity: 0 }}>
            сегодня
          </span>
        </div>
      </div>
      <Statement lines={['Повторение', 'по дням.']} at={350} out={WEEK_LEAVE} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4 · «К экзамену — с планом.» — the exam card of «Сегодня»: days left, the share, «Тянуть билет».

const EXAM_LEAVE = 3200;
const DOTS: Array<'ok' | 'half' | 'no'> = ['ok', 'ok', 'ok', 'half', 'ok', 'ok', 'no', 'ok', 'half', 'ok', 'ok', 'ok', 'no', 'ok', 'half', 'ok', 'ok', 'no', 'ok', 'ok'];

function Exam() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('card'), l, EXAM_LEAVE);
    all('dot').forEach((dot, index) => focusIn(dot, l, 1100 + index * 40, 300, 6));
    put(one('draw'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 2500)).toFixed(3)})`);
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="card" className="rg-exam" style={{ opacity: 0 }}>
        <div className="fm-card rg-exam-card">
          <span className="fm-flag">Экзамен через 12 дней</span>
          <p className="fm-h1 rg-exam-h">Микроэкономика</p>
          <p className="rg-share">
            <Counter from={12} to={35} at={500} dur={1300} />
            <span> %</span>
          </p>
          <p className="rg-share-c fm-muted">билетов, где оба вопроса есть в ваших лекциях</p>
          <div className="rg-dots">
            {DOTS.map((kind, index) => (
              <i key={index} data-a="dot" className={`rg-dot rg-dot--${kind}`} style={{ opacity: 0 }} />
            ))}
          </div>
          <div className="rg-exam-actions">
            <span data-a="draw" className="fm-btn fm-btn--blue">
              Тянуть билет
              <i>
                <Arrow />
              </i>
            </span>
            <span className="fm-btn fm-btn--line">Лист экзамена</span>
          </div>
        </div>
      </div>
      <Statement lines={['К экзамену —', 'с планом.']} at={350} out={EXAM_LEAVE} className="ar-say ar-say--tight" />
    </div>
  );
}

function RegisterReady() {
  return <Ready lines={['План готов']} />;
}

export const REGISTER_SCENES = { pile: Pile, sheet: Sheet, week: Week, exam: Exam, ready: RegisterReady };
