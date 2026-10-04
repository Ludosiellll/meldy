/**
 * The guide's clips in the film style (components/film): a statement over the section's screen out
 * of focus, then the screen comes sharp and does the one thing the section is for. 4:3 stage,
 * 1440 × 1080, 6.4 s loops that start and end on empty paper. Example data, the screens' own words.
 */
import { useRef, type ComponentType, type ReactNode } from 'react';
import { opacity, place, put, useEls, useFrame } from '../../reel/engine';
import { Counter } from '../../reel/parts';
import { clamp, ease, mix, seg } from '../../reel/timeline';
import { Arrow, MicIcon, Statement, UploadIcon, Wordmark, focusIn, pressDepth, slideIn, slideOut } from '../../film/kit';
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

/** A slice of the top line with the section's pill on. */
function Strip({ items, on, cta }: { items: readonly string[]; on?: string; cta?: boolean }) {
  return (
    <div className="gs-strip">
      <Wordmark className="gs-strip-mark" />
      {items.map((item) => (
        <span key={item} className={item === on ? 'is-on' : undefined}>
          {item}
        </span>
      ))}
      {cta ? <span className="gs-strip-cta">Добавить лекцию</span> : null}
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
        <Strip items={['Сегодня', 'Экзамены', 'Библиотека', 'Повторение']} on="Сегодня" />
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
        <Strip items={['Сегодня', 'Экзамены', 'Библиотека']} cta />
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
// «Библиотека»

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
        <Strip items={['Сегодня', 'Экзамены', 'Библиотека', 'Повторение']} on="Библиотека" />
        <p className="fm-h1 gs-h1">Библиотека</p>
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
        <Strip items={['Сегодня', 'Экзамены', 'Библиотека', 'Повторение']} on="Повторение" />
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
        <Strip items={['Сегодня', 'Экзамены', 'Библиотека', 'Повторение']} on="Экзамены" />
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
// «Дневник ошибок»

function Mistakes() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    put(one('entry'), 'transform', `scale(${(1 - 0.02 * pressDepth(l, 2700)).toFixed(3)})`);
    const open = ease.inOut(seg(l, 2800, 600));
    put(one('entry'), 'height', `${mix(156, 470, open).toFixed(1)}px`);
    put(one('entry2'), 'top', `${mix(570, 884, open).toFixed(1)}px`);
    focusIn(one('answers'), l, 3200, 500, 8);
    focusIn(one('fix'), l, 3450, 500, 8);
    put(one('fix'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 4400)).toFixed(3)})`);
    const fixed = seg(l, 4550, 260);
    opacity(one('fixed'), fixed);
    all('cnt').forEach((count) => {
      const [before, after] = count.children;
      opacity(before, 1 - fixed);
      opacity(after, fixed);
      place(after, 0, mix(20, 0, ease.brand(fixed)));
    });
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Ошибки', 'не теряются.']}>
        <Strip items={['Повторение', 'Дневник ошибок', 'Прогресс']} on="Дневник ошибок" />
        <p className="fm-h1 gs-h1">Дневник ошибок</p>
        <div className="gs-counts">
          <span className="gs-count">
            Открыто{' '}
            <span data-a="cnt" className="gs-roll">
              <span>2</span>
              <span style={{ opacity: 0 }}>1</span>
            </span>
          </span>
          <span className="gs-count">
            Исправлено{' '}
            <span data-a="cnt" className="gs-roll">
              <span>0</span>
              <span style={{ opacity: 0 }}>1</span>
            </span>
          </span>
        </div>
        <div data-a="entry" className="fm-card gs-entry" style={{ top: 396, height: 156 }}>
          <p className="gs-entry-q">Что такое эластичность спроса?</p>
          <p className="gs-entry-m fm-muted">
            Тест · Микроэкономика · 3 окт.
            <span data-a="fixed" style={{ opacity: 0 }}>
              {' '}
              · исправлена
            </span>
          </p>
          <div data-a="answers" className="gs-answers" style={{ opacity: 0 }}>
            <span className="gs-answer">
              <small className="fm-muted">Ваш ответ</small>
              Когда цена не меняется
            </span>
            <span className="gs-answer gs-answer--right">
              <small className="fm-muted">Правильный ответ</small>
              Когда объём меняется сильнее цены
            </span>
          </div>
          <span data-a="fix" className="fm-btn fm-btn--ink gs-fix" style={{ opacity: 0 }}>
            Отметить как исправленную
          </span>
        </div>
        <div data-a="entry2" className="fm-card gs-entry" style={{ top: 570, height: 156 }}>
          <p className="gs-entry-q">Виды монополий</p>
          <p className="gs-entry-m fm-muted">Ответ на билет · Микроэкономика · 2 окт.</p>
        </div>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Карта знаний»

const MAP_LECTURES = [
  ['Лекция 1', 'Рынок и равновесие'],
  ['Лекция 2', 'Эластичность спроса'],
  ['Лекция 3', 'Издержки фирмы'],
];
/** Concepts and the lectures they appear in. */
const CONCEPTS: Array<{ word: string; x: number; to: number[] }> = [
  { word: 'Цена', x: 290, to: [0, 1, 2] },
  { word: 'Спрос', x: 720, to: [0, 1] },
  { word: 'Издержки', x: 1150, to: [0, 2] },
];
const CARD_X = [280, 720, 1160];

function MapClip() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    all('line').forEach((line, index) => {
      put(line, 'stroke-dashoffset', (1 - ease.inOut(seg(l, 2300 + index * 110, 560))).toFixed(4));
    });
    const picked = l >= 3900;
    put(one('pick'), 'transform', `scale(${(1 - 0.08 * pressDepth(l, 3900)).toFixed(3)})`);
    all('concept').forEach((pill, index) => {
      put(pill, 'background', picked && index === 1 ? '#0b121c' : '#ffffff');
      put(pill, 'color', picked && index === 1 ? '#ffffff' : '#0b121c');
      opacity(pill, picked && index !== 1 ? 0.4 : 1);
    });
    all('line').forEach((line) => {
      const mine = line.getAttribute('data-c') === '1';
      put(line, 'stroke', picked && mine ? '#0b121c' : '#c9cac3');
      put(line, 'stroke-width', picked && mine ? '6' : '3');
      opacity(line, picked && !mine ? 0.35 : 1);
    });
    all('lec').forEach((card, index) => {
      const hit = picked && index < 2;
      put(card, 'box-shadow', hit ? '0 0 0 4px #0b121c' : '0 0 0 1px #e4e4de');
      opacity(card, picked && !hit ? 0.45 : 1);
    });
    slideIn(one('where'), l, 4150, { dy: 24, dur: 480, smear: 6 });
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Лекции', 'связаны.']}>
        <Strip items={['Библиотека', 'Карта знаний', 'Повторение']} on="Карта знаний" />
        <p className="fm-h1 gs-h1">Карта знаний</p>
        <p className="gs-lede fm-muted">Микроэкономика · 3 лекции · 3 общих понятия</p>
        <svg className="gs-lines" viewBox="0 0 1440 1080" aria-hidden="true">
          {CONCEPTS.flatMap((concept, c) =>
            concept.to.map((lecture) => (
              <path
                key={`${c}-${lecture}`}
                data-a="line"
                data-c={c}
                pathLength={1}
                d={`M${concept.x} 504 C ${concept.x} 600, ${CARD_X[lecture]} 620, ${CARD_X[lecture]} 716`}
              />
            )),
          )}
        </svg>
        {CONCEPTS.map((concept, index) => (
          <span key={concept.word} data-a="concept" className="gs-concept" style={{ left: concept.x }}>
            <span data-a={index === 1 ? 'pick' : undefined} className="gs-concept-in">
              {concept.word}
            </span>
          </span>
        ))}
        <p data-a="where" className="gs-where" style={{ opacity: 0 }}>
          Где встречается: лекции 1 и 2
        </p>
        {MAP_LECTURES.map(([number, title], index) => (
          <div key={number} data-a="lec" className="fm-card gs-lec" style={{ left: CARD_X[index] - 200 }}>
            <p className="gs-lec-n fm-muted">{number}</p>
            <p className="gs-lec-t">{title}</p>
          </div>
        ))}
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
        <Strip items={['Повторение', 'Дневник ошибок', 'Прогресс']} on="Прогресс" />
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

const clip = (Scene: ComponentType) => ({ total: CLIP, poster: 5200, Scene });

export const GUIDE_SCENES: Record<GuideChapterId, { total: number; poster: number; Scene: ComponentType }> = {
  today: clip(Today),
  add: clip(Add),
  library: clip(Library),
  review: clip(Review),
  exams: clip(Exams),
  mistakes: clip(Mistakes),
  map: clip(MapClip),
  progress: clip(Progress),
};
