/**
 * The sign-in reel, «Как работает Meldy», in the film style (components/film): a statement on the
 * left and a real screen of Meldy on the right, beat after beat; the yellow dot opens the loop and
 * closes it. Example lecture and numbers; the screens' own words.
 */
import { useRef } from 'react';
import { opacity, place, put, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Arrow, MicIcon, Statement, UploadIcon, Wordmark, pressDepth, slideIn, slideOut } from '../film/kit';
import { LEAVE, shot } from './camera';
import { HOME, Ready } from './Ready';

// ---------------------------------------------------------------------------------------------
// 1 · «Загрузите лекцию.» — the dot becomes the drop zone, a lecture lands, modules are ticked.

const MODULES: Array<[string, boolean]> = [
  ['Конспект', true],
  ['Карточки', true],
  ['Тест', true],
  ['Выжимка', false],
  ['Разговор', false],
];

function Source() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    // The dot of the last loop rises into the middle of the drop zone and waits for the file.
    // The dot of the last loop dissolves as the page comes into focus around it.
    place(one('home'), HOME.x - HOME.size / 2, HOME.y - HOME.size / 2, 1 - ease.in(seg(l, 300, 380)));
    opacity(one('home'), 1 - seg(l, 600, 120));

    // The page focuses in around the dot, then moves aside for the words, turning away.
    const aside = ease.inOut(seg(l, 1650, 800));
    const out = ease.in(seg(l, LEAVE, 520));
    put(
      one('win'),
      'transform',
      `perspective(2600px) translate3d(${(mix(0, 420, aside) - 1100 * out).toFixed(1)}px,${mix(0, 24, aside).toFixed(1)}px,0) rotateY(${mix(0, -18, aside).toFixed(2)}deg) scale(${mix(1, 0.84, aside).toFixed(4)})`,
    );
    put(one('win'), 'filter', `blur(${(16 * (1 - ease.out(seg(l, 250, 800))) + 18 * out).toFixed(2)}px)`);
    opacity(one('win'), clamp(seg(l, 250, 300) * 3) * (1 - clamp((out - 0.5) / 0.5)));

    slideIn(one('file'), l, 800, { dx: -1100, dur: 820, smear: 26 });
    put(one('zone'), 'border-color', l >= 1500 ? '#0b121c' : '#cfd0c8');
    opacity(one('hint'), 1 - seg(l, 1300, 200));

    all('mod').forEach((chip, index) => {
      if (index > 2) return;
      const on = l >= 2500 + index * 150;
      put(chip, 'background', on ? '#0b121c' : '#ffffff');
      put(chip, 'color', on ? '#ffffff' : '#0b121c');
      put(chip, 'border-color', on ? '#0b121c' : '#e4e4de');
    });
    put(one('run'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 3120)).toFixed(3)})`);
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="win" className="fm-win ln-up" style={{ opacity: 0 }}>
        <div className="fm-bar">
          <Wordmark />
          <span className="fm-bar-nav">
            <span>Сегодня</span>
            <span>Экзамены</span>
            <span>Лекции</span>
            <span>Повторение</span>
          </span>
          <span className="fm-bar-cta">Добавить лекцию</span>
          <span className="fm-bar-me">А</span>
        </div>
        <div data-a="zone" className="ln-zone">
          <span data-a="hint" className="ln-zone-hint">
            <span className="ln-zone-ico">
              <UploadIcon />
            </span>
            Перетащите файл сюда
          </span>
          <div data-a="file" className="fm-file ln-file" style={{ opacity: 0 }}>
            <span className="fm-sheet-ico" />
            <span>
              Лекция 4.pdf
              <small>PDF · 18 страниц</small>
            </span>
          </div>
        </div>
        <div className="ln-mods">
          {MODULES.map(([name]) => (
            <span key={name} data-a="mod" className="ln-mod">
              {name}
            </span>
          ))}
        </div>
        <span data-a="run" className="fm-btn fm-btn--blue ln-run">
          Запустить анализ
          <i>
            <Arrow />
          </i>
        </span>
      </div>
      <i data-a="home" className="fm-brand-dot ar-home" style={{ transform: `translate3d(${HOME.x - HOME.size / 2}px,${HOME.y - HOME.size / 2}px,0)` }} />
      <Statement lines={['Загрузите', 'лекцию.']} at={1900} out={LEAVE} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2 · «Конспект — со ссылками.» — the lecture page; «фрагмент 3» opens the place in the lecture.

function Summary() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    shot(one('page'), l);
    put(one('frag'), 'transform', `scale(${(1 - 0.08 * pressDepth(l, 1500)).toFixed(3)})`);
    put(one('frag'), 'box-shadow', l >= 1440 ? 'inset 0 0 0 3px #0b121c' : 'none');
    slideIn(one('slip'), l, 1700, { dx: 420, dur: 760, smear: 18 });
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="page" className="fm-win ln-page" style={{ opacity: 0 }}>
        <div className="ln-page-in">
          <p className="ln-crumb fm-muted">Лекции</p>
          <p className="fm-h1 ln-page-h">Эластичность спроса</p>
          <div className="ln-tabs">
            <span className="is-on">Конспект</span>
            <span>Карточки 8</span>
            <span>Тест 5</span>
          </div>
          <div className="fm-card ln-sum">
            <p className="ln-sum-h">Когда спрос эластичен</p>
            <p className="ln-sum-p">
              Спрос эластичен, если объём покупок меняется сильнее цены.{' '}
              <span data-a="frag" className="fm-chip ln-frag">
                фрагмент 3
              </span>
            </p>
            <p className="ln-sum-h ln-sum-h--2">Виды эластичности</p>
            <i className="ln-line" />
            <i className="ln-line ln-line--short" />
          </div>
        </div>
        <div data-a="slip" className="fm-card ln-slip" style={{ opacity: 0 }}>
          <p className="ln-slip-c fm-muted">Фрагмент 3 лекции</p>
          <p className="ln-slip-q">«Цена выросла на 10 %, а покупки упали на 25 % — спрос эластичен».</p>
        </div>
      </div>
      <Statement lines={['Конспект —', 'со ссылками.']} at={350} out={LEAVE} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3 · «Карточки вовремя.» — the card turns, «Помню», it leaves for six days, the next one comes.

function Recall() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('desk'), l);
    put(one('flip'), 'transform', `rotateY(${(180 * ease.inOut(seg(l, 1000, 620))).toFixed(2)}deg)`);
    all('grade').forEach((grade, index) => {
      const pressed = index === 2 && l >= 2050;
      put(grade, 'background', pressed ? '#0b121c' : '#ffffff');
      put(grade, 'color', pressed ? '#ffffff' : '#0b121c');
      put(grade, 'transform', `scale(${(1 - (index === 2 ? 0.06 * pressDepth(l, 2050) : 0)).toFixed(3)})`);
      opacity(grade, clamp(seg(l, 1550 + index * 70, 260) * 3));
    });
    // The answered card leaves to the right with motion blur; the next one comes forward.
    slideOut(one('front'), l, 2620, { dx: 1300, dur: 520, smear: 26 });
    const next = ease.inOut(seg(l, 2700, 560));
    put(one('next'), 'transform', `translate3d(${mix(48, 0, next).toFixed(1)}px,${mix(-48, 0, next).toFixed(1)}px,0) scale(${mix(0.94, 1, next).toFixed(4)})`);
    put(one('next'), 'filter', `blur(${mix(5, 0, next).toFixed(2)}px)`);
    slideIn(one('when'), l, 2150, { dy: 30, dur: 480, smear: 8 });
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="desk" className="ln-desk" style={{ opacity: 0 }}>
        <div className="fm-card ln-review ln-review--far" />
        <div data-a="next" className="fm-card ln-review ln-review--next">
          <p className="ln-review-l fm-muted">Рынок и равновесие</p>
          <p className="ln-review-q">Что такое равновесная цена?</p>
        </div>
        <div data-a="front" className="ln-front">
          <div data-a="flip" className="ln-flip-in">
            <div className="fm-card ln-review ln-face">
              <p className="ln-review-l fm-muted">Эластичность спроса</p>
              <p className="ln-review-q">Когда спрос эластичен?</p>
            </div>
            <div className="fm-card ln-review ln-face ln-face--back">
              <p className="ln-review-l fm-muted">Ответ</p>
              <p className="ln-review-q">Когда объём меняется сильнее цены</p>
            </div>
          </div>
        </div>
        <div className="ln-grades">
          <span data-a="grade" className="ln-grade" style={{ opacity: 0 }}>
            Не помню
          </span>
          <span data-a="grade" className="ln-grade" style={{ opacity: 0 }}>
            С трудом
          </span>
          <span data-a="grade" className="ln-grade" style={{ opacity: 0 }}>
            Помню
          </span>
        </div>
        <p data-a="when" className="ln-when" style={{ opacity: 0 }}>
          Помню — вернётся через 6 дней.
        </p>
      </div>
      <Statement lines={['Карточки', 'вовремя.']} at={350} out={LEAVE} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4 · «Отвечайте вслух.» — the ticket, the voice, the examiner's question, «Проверено» (no «Засчитано» since Ф1).

const BARS = Array.from({ length: 30 }, (_, index) => index);

function Ticket() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('room'), l);
    put(one('voice'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 900)).toFixed(3)})`);
    const talk = seg(l, 1050, 160) * (1 - seg(l, 2150, 200));
    all('bar').forEach((bar, index) => {
      const wave = 0.5 + 0.5 * Math.sin(l / 85 + index * 0.8) * Math.sin(l / 260 + index * 0.31);
      put(bar, 'transform', `scaleY(${(0.1 + 0.9 * wave * talk).toFixed(3)})`);
    });
    opacity(one('wave'), clamp(seg(l, 1000, 200) * 3));
    slideIn(one('ask'), l, 1950, { dy: 50, dur: 640, smear: 10 });
    const stamp = seg(l, 2650, 460);
    place(one('stamp'), 0, 0, mix(1.5, 1, ease.back(stamp)), -7);
    opacity(one('stamp'), clamp(stamp * 3));
    put(one('oval'), 'stroke-dashoffset', (1 - ease.out(seg(l, 2700, 620))).toFixed(4));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="room" className="ln-room" style={{ opacity: 0 }}>
        <div className="fm-card ln-ticket">
          <span className="fm-st fm-st--ink">Билет 12 · вопрос 1 из 2</span>
          <p className="fm-h1 ln-ticket-q">Эластичность спроса</p>
          <div className="ln-voice-row">
            <span data-a="voice" className="fm-btn fm-btn--blue">
              <MicIcon />
              Отвечать голосом
            </span>
            <span data-a="wave" className="ln-wave" style={{ opacity: 0 }}>
              {BARS.map((index) => (
                <i key={index} data-a="bar" />
              ))}
            </span>
          </div>
          <span data-a="stamp" className="ln-stamp" style={{ opacity: 0 }}>
            <svg viewBox="0 0 400 160" aria-hidden="true">
              <path data-a="oval" pathLength={1} d="M200 12 C 320 10, 392 46, 386 84 C 380 128, 300 152, 196 148 C 84 146, 10 120, 14 78 C 18 36, 92 14, 214 16" />
            </svg>
            Проверено
          </span>
        </div>
        <div data-a="ask" className="fm-card ln-ask" style={{ opacity: 0 }}>
          <p className="ln-ask-l fm-muted">Экзаменатор</p>
          <p className="ln-ask-q">«А если цена растёт, а спрос почти не меняется?»</p>
        </div>
      </div>
      <Statement lines={['Отвечайте', 'вслух.']} at={350} out={LEAVE} className="ar-say" />
    </div>
  );
}

function LoginReady() {
  return <Ready lines={['Всё по вашим', 'лекциям']} />;
}

export const LOGIN_SCENES = { source: Source, summary: Summary, recall: Recall, ticket: Ticket, ready: LoginReady };
