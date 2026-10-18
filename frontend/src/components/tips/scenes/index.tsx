/**
 * The tips' clips in the film style of the guide (components/film): a statement over the feature's
 * screen out of focus, then the screen comes sharp and does the one thing the feature is for. Loops
 * that start and end on empty paper; example data, the screens' own words. The lecture's clip is a
 * 16:10 stage (1280 × 800, 6.4 s); the Telegram clip is the chat as Telegram draws it, on a square
 * stage of its own (TG_STAGE).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { opacity, put, useClock, useEls, useFrame } from '../../reel/engine';
import { bezier, clamp, ease, mix, seg } from '../../reel/timeline';
import { Arrow, Statement, Wordmark, pressDepth, slideIn, slideOut } from '../../film/kit';
import { dayText, figureLines, glue, lineText, startLabel } from '../../../lib/containers/words';
import type { TipClipDef } from '../TipClip';
import type { CardTipId } from '../tips';
import './scenes.css';

export const CLIP = 6400;
/** The screen comes into focus here; the statement has left. */
const FOCUS = 1900;

/** The common choreography: the screen out of focus behind the words, then sharp, then gone. */
function Beat({ lines, total = CLIP, sayClass = 'ts-say', children }: { lines: readonly string[]; total?: number; sayClass?: string; children: ReactNode }) {
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
      <div data-a="ui" className="ts-ui" style={{ opacity: 0 }}>
        {children}
      </div>
      <Statement lines={lines} at={300} out={FOCUS - 120} className={sayClass} />
    </div>
  );
}

/** «‹ К лекции» of the room's top line. */
function BackArrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16 10H5M9 5.5 4.5 10 9 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// «Поговорить о лекции»: Meldy asks a card, the answer comes in «Ваш ответ», «Готово», and the
// reply of the quote step — «Вот как сказано в лекции» with the lecture's own words on a slip.

const QUESTION = 'Чем исчерпаемые ресурсы отличаются от возобновляемых?';
const ANSWER = ['Исчерпаемые', 'когда-нибудь', 'заканчиваются.'];
/** The server's own line of the quote step (lib/tutor/tutorMachine SERVER_LINES). */
const REPLY = 'Вот как сказано в лекции. Скажите своими словами.';
const QUOTE = '«Исчерпаемые ресурсы со временем заканчиваются, а возобновляемые восстанавливаются».';

/** The answer is heard word by word, as the live transcript shows it. */
const WORD_AT = [2500, 2850, 3200];
const PRESS = 3950;
const REPLY_AT = 4300;
const SLIP_AT = 4600;

function Talk() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    all('word').forEach((word, index) => {
      const p = seg(l, WORD_AT[index], 260);
      opacity(word, p);
      put(word, 'filter', p > 0 && p < 1 ? `blur(${(4 * (1 - p)).toFixed(2)}px)` : 'none');
    });
    opacity(one('hint'), 1 - seg(l, WORD_AT[0] - 120, 160));
    // The microphone is open until «Готово»: the card's ring says so in Meldy's blue.
    put(one('answer'), 'box-shadow', l < PRESS + 80 ? '0 0 0 4px #2869dd' : '0 0 0 2px #e4e4de');
    put(one('done'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, PRESS)).toFixed(3)})`);
    slideOut(one('turn'), l, PRESS + 260, { dy: 160, dur: 460, smear: 12 });
    // The tutor's new line: the question leaves, the reply comes in.
    const leave = seg(l, REPLY_AT - 100, 260);
    opacity(one('ask'), 1 - leave);
    put(one('ask'), 'filter', leave > 0 && leave < 1 ? `blur(${(8 * leave).toFixed(2)}px)` : 'none');
    slideIn(one('reply'), l, REPLY_AT, { dx: 90, dur: 680, smear: 12 });
    slideIn(one('slip'), l, SLIP_AT, { dx: 520, dur: 760, smear: 18 });
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Спросит', 'и подскажет.']}>
        <div className="ts-bar">
          <Wordmark className="ts-bar-mark" />
          <span className="ts-bar-where">Поговорить о лекции</span>
          <span className="ts-bar-back">
            <BackArrow />К лекции
          </span>
        </div>
        <div className="ts-tutor">
          <p className="ts-tutor-who">Meldy</p>
          <p data-a="ask" className="ts-tutor-line">
            {QUESTION}
          </p>
          <p data-a="reply" className="ts-tutor-line" style={{ opacity: 0 }}>
            {REPLY}
          </p>
        </div>
        <div data-a="turn" className="ts-turn">
          <div data-a="answer" className="ts-answer">
            <p className="ts-answer-label">Ваш ответ</p>
            <p className="ts-answer-text">
              <span data-a="hint" className="ts-answer-hint">
                Говорите — я слушаю.
              </span>
              {ANSWER.map((word) => (
                <span key={word} data-a="word" className="ts-word" style={{ opacity: 0 }}>
                  {word}
                </span>
              ))}
            </p>
          </div>
          <div className="ts-acts">
            <span data-a="done" className="fm-btn fm-btn--blue ts-done">
              Готово
              <i>
                <Arrow />
              </i>
            </span>
            <span className="ts-quiet">Текстом</span>
            <span className="ts-quiet">Не знаю</span>
            <span className="ts-quiet">Спросить</span>
          </div>
        </div>
        <div data-a="slip" className="ts-slip" style={{ opacity: 0 }}>
          <p className="ts-slip-cap">Из лекции, фрагмент 3</p>
          <p className="ts-slip-text">{QUOTE}</p>
        </div>
      </Beat>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «План на день в Telegram»: the bot's chat as Telegram for Android draws it (12.4 and later, the default themes:
// «Blue» by day, «Dark Blue» by night, following the site's theme), cropped to the chat from its header to the input
// bar like a screen recording. Telegram's own metrics, one stage pixel a dp of a 400 dp wide phone (TMessagesProj:
// ChatMessageCell, BotButton, MessageDrawable, ChatAvatarContainer, ChatActivityEnterView, BotCommandsMenuView).
//
// What the bot does, step by step (supabase/functions/_shared/bot): yesterday's «Готово: план на день — в 20:00.» (M3,
// link.ts — the bot removes the «/start» it was linked with, so the chat starts there); at 20:00 the day's card comes
// as a new message (card.ts dayCard, a reminder: the plan, the exam with its date, the figure, the blue «Начать: 20
// вопросов» — style «primary»); «Начать» is answered without a line and the same message becomes the first question
// (session.ts start: a card becomes the session, render.ts questionOut: the subject · «1 из 20», an empty line, the
// question in bold, options on buttons, «Не знаю · Закончить»); a right answer is answered with «Верно.», which
// Telegram shows in a panel at the top of the chat with the bot's name, and the message moves on to the next question.
// The bot sends no «печатает…» in these steps (only voice.ts does), so the chat shows none. Example: the exam of the
// guide's clip, three days in; the plan's and the figure's words are lib/containers/words.ts — the bot's plan/words.ts
// is a copy of it (supabase/functions/_shared/plan/SOURCE_HASH).

/** The square the chat is drawn on (Telegram's dp). */
export const TG_STAGE = { width: 400, height: 400 } as const;
export const TG_TOTAL = 9200;

/** Telegram's own words on the screen (its Russian interface): the bot's subtitle, the input bar, the dates. */
export const TG_UI = {
  name: 'Meldy',
  subtitle: 'бот',
  /** The bot's menu button since the Mini App: a web_app button with its own text (words.ts PROFILE.menuButton). */
  menu: 'Открыть Meldy',
  field: 'Сообщение',
  yesterday: '12 октября',
  today: '13 октября',
} as const;

/** M3 of the day before (link.ts m3: the time was picked; the day's work was done, so no «Начать»). */
export const TG_HISTORY = {
  /** words.ts m3Title(timeText(20 × 60)). */
  title: 'Готово: план на день — в 20:00.',
  /** The plan's line of a finished day (planSentence → lib/containers/words.ts lineText «done»). */
  line: lineText({ key: 'done', n: [65, 31] }),
  time: '19:42',
} as const;

/** The bot's day card (card.ts dayCard, a reminder): the plan, the exam with its date, the figure, «Начать». */
export const TG_CARD = {
  /** planLine of a study day («Сегодня около … : planDetail»), ended with a period as card.ts `sentence` does. */
  plan: `Сегодня около ${glue(30, 'минуты', 'минут', 'минут')}: ${glue(20, 'новый', 'новых', 'новых')} и ${glue(45, 'знакомый', 'знакомых', 'знакомых')}.`,
  /** words.ts examLine + dateWhen: the exam's title · its date, the days to it. */
  exam: `Микроэкономика · ${dayText('2026-11-01')}, через ${glue(19, 'день', 'дня', 'дней')}`,
  figure: (() => {
    const words = figureLines({ inPlan: 400, twoDays: 12, seen: 90, errors: 7, selfKnow: 0 }, null);
    return `${words.big} ${words.of} — ${words.label}`;
  })(),
  start: startLabel(20, null, null),
  /** The reminder's time (link.remindAt), the message's time in the chat. */
  time: '20:00',
};

/** The «занятие» in the chat (render.ts questionOut, headerText): the subject · «1 из 20», the question, its options. */
export const TG_QUESTIONS = [
  {
    head: 'Микроэкономика · 1 из 20',
    stem: 'Как называется ситуация, когда спрос превышает предложение?',
    options: ['Излишек', 'Дефицит', 'Равновесие'],
    right: 1,
  },
  {
    head: 'Микроэкономика · 2 из 20',
    stem: 'Что происходит с величиной спроса, когда цена растёт?',
    options: ['Снижается', 'Растёт', 'Не меняется'],
    right: 0,
  },
] as const;
/** The bot's buttons under every question and its line for a right answer (render.ts S). */
export const TG_WORDS = { dontKnow: 'Не знаю', finish: 'Закончить', right: 'Верно.' } as const;

/**
 * The day's card comes in; «Начать» is pressed, released, answered (the button's loading stops) and the card becomes
 * the first question; «Дефицит» is pressed and released, the bot's «Верно.» comes, and the next question.
 */
export const TG_TIMES = {
  arrive: 2600,
  start: 4500,
  startUp: 4640,
  first: 5000,
  answer: 6700,
  answerUp: 6840,
  verdict: 7150,
  next: 7200,
} as const;

/** Telegram's curve for the chat's changes (ChatListItemAnimator) and the length of an edit there. */
const TG_CURVE = bezier(0.19919, 0.01064, 0.2792, 0.91025);
const TG_EDIT = 250;
/** A new message slides up on a short spring: a 1–2 % overshoot, settled in about half a second. */
function arrival(p: number): number {
  const x = clamp(p);
  if (x >= 1) return 1;
  return 1 - Math.exp(-8 * x) * (Math.cos(6 * x) + (8 / 6) * Math.sin(6 * x));
}
/** Android's OvershootInterpolator(2): the pressed button springs back past its size and settles. */
function overshoot(p: number): number {
  const t = clamp(p) - 1;
  return t * t * (3 * t + 2) + 1;
}

/** The bot's photo: the PWA mark (blue, the white «m», the yellow dot) as Telegram crops it round (avatar.ts). */
function BotPhoto({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r="256" fill="#2869dd" />
      <g transform="translate(39 53) scale(.795)">
        <path d="M121 342V222a52 52 0 0 1 104 0v120M225 222a52 52 0 0 1 104 0v120" fill="none" stroke="#fff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="385" cy="322" r="30" fill="#f4c45b" />
      </g>
    </svg>
  );
}

/** Material's icons as Telegram for Android draws them in the chat (24 dp). */
function Icon({ name }: { name: 'back' | 'smile' | 'clip' | 'mic' }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg className={`ts-tg-i ts-tg-i--${name}`} viewBox="0 0 24 24" aria-hidden="true">
      {name === 'back' ? <path d="M19.5 12H5M11 5.8 4.8 12l6.2 6.2" {...line} strokeWidth={2} /> : null}
      {name === 'smile' ? (
        <g>
          <circle cx="12" cy="12" r="9" {...line} />
          <path d="M8.3 14.2c.9 1.5 2.2 2.3 3.7 2.3s2.8-.8 3.7-2.3" {...line} />
          <circle cx="9" cy="9.8" r="1.25" fill="currentColor" />
          <circle cx="15" cy="9.8" r="1.25" fill="currentColor" />
        </g>
      ) : null}
      {name === 'clip' ? <path d="m17.6 11.1-6.4 6.4a3.9 3.9 0 0 1-5.5-5.5l7.1-7.1a2.6 2.6 0 0 1 3.7 3.7l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.3-6.3" {...line} /> : null}
      {name === 'mic' ? (
        <g>
          <rect x="9" y="3.2" width="6" height="11.2" rx="3" {...line} />
          <path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0M12 17.9v2.9" {...line} />
        </g>
      ) : null}
    </svg>
  );
}

/** Telegram's tail of an incoming bubble (MessageDrawable: the left edge curves out to a point at the bottom). */
function Tail() {
  return (
    <svg className="ts-tg-tail" viewBox="0 0 9 12" aria-hidden="true">
      <path d="M8 1A6.5 10 0 0 1 2.3 10.9L2.6 12H9V1Z" />
    </svg>
  );
}

/** The time in the bubble's corner, and room for it at the end of the last line (Telegram puts it there when it fits). */
function Time({ at }: { at: string }) {
  return <span className="ts-tg-time">{at}</span>;
}
const TimeRoom = () => <i className="ts-tg-room" aria-hidden="true" />;

/**
 * An inline button (BotButton): its place gives its corners — the last row's outer corners are the bubble's. A pressed
 * one has the ripple from the touch and the line that runs round it while the bot has not answered.
 */
function Key({ label, primary, name, place, touch }: { label: string; primary?: boolean; name?: string; place: 'row' | 'bottom' | 'bottom-left' | 'bottom-right'; touch?: readonly [number, number] }) {
  return (
    <span data-a={name} className={`ts-tg-key${primary ? ' ts-tg-key--primary' : ''}`} data-place={place}>
      {name ? <i data-a={`${name}-ripple`} className="ts-tg-ripple" style={{ opacity: 0, left: `${touch?.[0] ?? 50}%`, top: `${touch?.[1] ?? 50}%` }} /> : null}
      <span className="ts-tg-key-t">{label}</span>
      {name ? <i data-a={`${name}-load`} className="ts-tg-load" style={{ opacity: 0 }} /> : null}
    </span>
  );
}

function QuestionText({ index }: { index: 0 | 1 }) {
  const q = TG_QUESTIONS[index];
  return (
    <div data-a={`text-q${index + 1}`} className="ts-tg-text" style={{ opacity: 0 }}>
      <p>{q.head}</p>
      <p className="ts-tg-gap" aria-hidden="true" />
      <p>
        <b>{q.stem}</b>
        <TimeRoom />
      </p>
    </div>
  );
}

function QuestionKeys({ index }: { index: 0 | 1 }) {
  const q = TG_QUESTIONS[index];
  return (
    <div data-a={`kb-q${index + 1}`} className="ts-tg-kb" style={{ opacity: 0 }}>
      {q.options.map((option, place) => (
        <Key key={option} label={option} name={index === 0 && place === q.right ? 'pick' : undefined} place="row" touch={[46, 58]} />
      ))}
      <div className="ts-tg-kb-row">
        <Key label={TG_WORDS.dontKnow} place="bottom-left" />
        <Key label={TG_WORDS.finish} place="bottom-right" />
      </div>
    </div>
  );
}

interface Size {
  /** The bubble's width and height without its tail, the keyboard's height. */
  w: number;
  h: number;
  kb: number;
}

/** The widest line of a text block, as laid out (stage px): Telegram fits a bubble to it. */
function widestLine(block: HTMLElement, scale: number): number {
  const left = block.getBoundingClientRect().left;
  let widest = 0;
  block.querySelectorAll('p').forEach((p) => {
    const range = document.createRange();
    // A document that lays nothing out (tests) has no line boxes: the bubble keeps its CSS width.
    if (typeof range.getClientRects !== 'function') return;
    range.selectNodeContents(p);
    for (const rect of Array.from(range.getClientRects())) widest = Math.max(widest, (rect.right - left) / scale);
  });
  return widest;
}

function Telegram() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const clock = useClock();
  const sizes = useRef<{ card: Size; q1: Size; q2: Size; history: number; arrive: number } | null>(null);

  const measure = () => {
    const el = root.current;
    if (!el) return null;
    const stage = el.closest<HTMLElement>('.mr-stage');
    const scale = stage && stage.offsetWidth > 0 ? stage.getBoundingClientRect().width / stage.offsetWidth || 1 : 1;
    // Telegram: the text's own padding is 9 dp on the left of the bubble and 12 on the right (ChatMessageCell: +31 dp
    // with the tail's 8 and the drawable's 2).
    const size = (text: string, keys: string): Size => {
      const block = el.querySelector<HTMLElement>(`[data-a="${text}"]`);
      const kb = el.querySelector<HTMLElement>(`[data-a="${keys}"]`);
      const widest = block ? widestLine(block, scale) : 0;
      return { w: widest > 0 ? widest + 12 : 0, h: block?.offsetHeight ?? 0, kb: kb?.offsetHeight ?? 0 };
    };
    const history = el.querySelector<HTMLElement>('[data-a="history-text"]');
    const arrive = el.querySelector<HTMLElement>('[data-a="arrive"]');
    const live = el.querySelector<HTMLElement>('[data-a="live"]');
    const card = size('text-card', 'kb-card');
    return {
      card,
      q1: size('text-q1', 'kb-q1'),
      q2: size('text-q2', 'kb-q2'),
      history: history ? widestLine(history, scale) + 12 : 0,
      // The date over the card and the card as it comes (the live message's height is the frame's to set).
      arrive: (arrive?.offsetHeight ?? 0) - (live?.offsetHeight ?? 0) + card.h + 2.5 + card.kb,
    };
  };

  // Fonts that come late (a web font where the system has none) change the lines: measure again.
  useEffect(() => {
    let live = true;
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready
      ?.then(() => {
        if (!live) return;
        sizes.current = null;
        clock.seek(clock.time);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [clock]);

  useFrame((l) => {
    const s = sizes.current ?? (sizes.current = measure());
    if (!s) return;
    const { arrive: ARRIVE, start: START, startUp: START_UP, first: FIRST, answer: ANSWER, answerUp: ANSWER_UP, verdict: VERDICT, next: NEXT } = TG_TIMES;

    // A bubble is as wide as its widest line; a keyboard as wide as its bubble (BotButton: from 1 dp left of it to its
    // right edge).
    if (s.history > 0) put(one('history'), 'width', `${s.history.toFixed(1)}px`);
    (['card', 'q1', 'q2'] as const).forEach((name) => {
      if (s[name].w > 0) put(one(`kb-${name}`), 'width', `${(s[name].w + 1).toFixed(1)}px`);
    });

    // 20:00: the day's card comes up from under the input bar and the chat moves up with it.
    const come = arrival(seg(l, ARRIVE, 560));
    put(one('feed'), 'transform', `translate3d(0,${((1 - come) * s.arrive).toFixed(2)}px,0)`);
    opacity(one('arrive'), clamp(seg(l, ARRIVE, 160)));

    // The message changes in place: the card, then the first question, then the second (an edit: the text cross-fades,
    // the bubble and its keyboard change size; the chat keeps its bottom, so what is above moves up).
    const toFirst = TG_CURVE(seg(l, FIRST, TG_EDIT));
    const toNext = TG_CURVE(seg(l, NEXT, TG_EDIT));
    const weights = [1 - toFirst, toFirst * (1 - toNext), toNext];
    const states = [s.card, s.q1, s.q2];
    const at = (key: keyof Size) => states.reduce((sum, state, i) => sum + state[key] * weights[i], 0);
    const kb = at('kb');
    const h = at('h');
    put(one('live'), 'height', `${(h + 2.5 + kb).toFixed(2)}px`);
    const bubble = one('bubble');
    put(bubble, 'bottom', `${(kb + 2.5).toFixed(2)}px`);
    put(bubble, 'height', `${h.toFixed(2)}px`);
    if (at('w') > 0) put(bubble, 'width', `${at('w').toFixed(2)}px`);
    (['card', 'q1', 'q2'] as const).forEach((name, i) => {
      opacity(one(`text-${name}`), weights[i]);
      // Buttons hang under the bubble as it moves (BotButton: from the bubble's bottom), so a taller keyboard comes up
      // from under the input bar.
      const keys = one(`kb-${name}`);
      opacity(keys, weights[i]);
      put(keys, 'bottom', `${(kb - s[name].kb).toFixed(2)}px`);
    });

    // A press: the button dips (0.96) under the finger with the ripple from the touch, springs back on release; until
    // the bot answers, a line runs round it.
    const press = (name: string, down: number, up: number, answered: number) => {
      const pressed = l < up ? seg(l, down, 100) : seg(up, down, 100) * (1 - overshoot(seg(l, up, 350)));
      put(one(name), 'transform', `scale(${(0.96 + 0.04 * (1 - pressed)).toFixed(4)})`);
      const ripple = one(`${name}-ripple`);
      const grow = ease.out(seg(l, down, 420));
      put(ripple, 'transform', `translate(-50%,-50%) scale(${(0.08 + 0.92 * grow).toFixed(3)})`);
      opacity(ripple, l < down ? 0 : 1 - seg(l, up + 90, 240));
      const load = one(`${name}-load`);
      const waiting = seg(l, up + 40, 140) * (1 - seg(l, answered, 140));
      opacity(load, waiting);
      put(load, '--tg-run', `${waiting > 0 ? (((l - up) * 0.5) % 360).toFixed(1) : '0'}deg`);
    };
    press('start', START, START_UP, FIRST - 40);
    press('pick', ANSWER, ANSWER_UP, VERDICT);

    // The bot's «Верно.»: Telegram's panel under the header, the bot's name over the line, for three seconds.
    const panel = TG_CURVE(seg(l, VERDICT, 260));
    put(one('alert'), 'transform', `translate3d(0,${mix(-14, 0, panel).toFixed(2)}px,0)`);
    opacity(one('alert'), clamp(seg(l, VERDICT, 160)) * (1 - seg(l, VERDICT + 3000, 200)));
  });

  const startRow = (
    <div data-a="kb-card" className="ts-tg-kb">
      <Key label={TG_CARD.start} primary name="start" place="bottom" touch={[57, 55]} />
    </div>
  );

  return (
    <div ref={root} className="mr-scene ts-tg-scene">
      <Beat lines={['План на день', 'в Telegram.']} total={TG_TOTAL} sayClass="ts-say ts-tg-say">
        <div className="ts-tg">
          <div className="ts-tg-wall" />
          <div className="ts-tg-chat">
            <div data-a="feed" className="ts-tg-feed">
              <span className="ts-tg-day">{TG_UI.yesterday}</span>
              <div className="ts-tg-msg">
                <div data-a="history" className="ts-tg-bubble ts-tg-bubble--alone">
                  <div data-a="history-text" className="ts-tg-text">
                    <p>
                      <b>{TG_HISTORY.title}</b>
                    </p>
                    <p>
                      {TG_HISTORY.line}
                      <TimeRoom />
                    </p>
                  </div>
                  <Time at={TG_HISTORY.time} />
                  <Tail />
                </div>
              </div>
              <div data-a="arrive" className="ts-tg-arrive" style={{ opacity: 0 }}>
                <span className="ts-tg-day">{TG_UI.today}</span>
                <div data-a="live" className="ts-tg-msg ts-tg-live">
                  <div data-a="bubble" className="ts-tg-bubble ts-tg-bubble--keys">
                    <div data-a="text-card" className="ts-tg-text">
                      <p>
                        <b>{TG_CARD.plan}</b>
                      </p>
                      <p>{TG_CARD.exam}</p>
                      <p>
                        {TG_CARD.figure}
                        <TimeRoom />
                      </p>
                    </div>
                    <QuestionText index={0} />
                    <QuestionText index={1} />
                    <Time at={TG_CARD.time} />
                    <Tail />
                  </div>
                  {startRow}
                  <QuestionKeys index={0} />
                  <QuestionKeys index={1} />
                </div>
              </div>
            </div>
          </div>
          <div className="ts-tg-head">
            <Icon name="back" />
            <BotPhoto className="ts-tg-photo" />
            <span className="ts-tg-who">
              <span className="ts-tg-name">{TG_UI.name}</span>
              <span className="ts-tg-sub">{TG_UI.subtitle}</span>
            </span>
            {/* No «⋮» on the right: the tip's own play/pause button stands in that corner (tips.css, data-play-at). */}
          </div>
          <div data-a="alert" className="ts-tg-alert" style={{ opacity: 0 }}>
            <span className="ts-tg-alert-name">{TG_UI.name}</span>
            <span className="ts-tg-alert-text">{TG_WORDS.right}</span>
          </div>
          <div className="ts-tg-input">
            <div className="ts-tg-field">
              {/* A web_app menu button is its text alone (no «≡»: that one is the commands' «Меню»). */}
              <span className="ts-tg-menu">{TG_UI.menu}</span>
              <Icon name="smile" />
              <span className="ts-tg-hint">{TG_UI.field}</span>
              <Icon name="clip" />
            </div>
            <span className="ts-tg-mic">
              <Icon name="mic" />
            </span>
          </div>
        </div>
      </Beat>
    </div>
  );
}

/** Every tip's clip by the tip's id. Still frames (reduced motion): the talk clip's reply and the lecture's words; the
    bot's plan for the day with its «Начать: 20 вопросов». The move dialog's tip plays a step clip (components/clips). */
export const TIP_CLIPS: Record<CardTipId, TipClipDef> = {
  talk: { total: CLIP, poster: 5300, Scene: Talk },
  telegram: { total: TG_TOTAL, poster: 3900, Scene: Telegram, stage: TG_STAGE, playAt: 'top' },
};
