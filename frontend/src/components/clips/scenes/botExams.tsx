/**
 * «Экзамены в Telegram» (release 47; supabase/functions/_shared/bot/exams.ts): the bot's chat as Telegram for Android
 * draws it (the tip clip's Telegram, components/tips/scenes): «/settings» — «Настройки» with «Экзамены»; the same
 * message becomes «Какие экзамены присылать», «— Зимняя сессия» pressed turns into «✓ Зимняя сессия»; at 20:00 the
 * day's card with both exams («Ещё сегодня: «Зимняя сессия» — около 45 минут.»); after the exam K3 with «Перенести на
 * неделю», pressed, and «Экзамен «Осенняя сессия» перенесён на 11 ноября. План пересчитан.». The bot's own words, from
 * its snapshots (fixtures/snapshots: settings.json s1, exams.json, card.json k1_two_exams and k3_move); StepClips.test
 * compares them. Drawn at Telegram's dp on a 626 × 391 chat (a phone on its side, or a small tablet), 2.3 stage px a dp.
 */
import { useEffect, useRef } from 'react';
import { opacity, put, useClock, useEls, useFrame } from '../../reel/engine';
import { bezier, clamp, ease, seg } from '../../reel/timeline';
import type { ClipStep } from '../types';
import '../../tips/scenes/scenes.css';

export const BOT_TOTAL = 14000;

/** The bot's words: every line as the bot sends it (a line of the message, unbroken), the buttons by rows. */
export const BOT_WORDS = {
  command: '/settings',
  settings: {
    title: 'Настройки',
    lines: ['План на день — в 20:00 по Минску.', 'Экзамен «Осенняя сессия», 3 ноября.'],
    keys: [['Время', 'Пауза'], ['Экзамены'], ['Отключить Telegram']],
  },
  exams: {
    title: 'Какие экзамены присылать',
    lines: ['Отметьте экзамены, по которым приходит план на день. Можно несколько.'],
    keysBefore: [['✓ Осенняя сессия'], ['— Зимняя сессия'], ['‹ Назад']],
    keysAfter: [['✓ Осенняя сессия'], ['✓ Зимняя сессия'], ['‹ Назад']],
  },
  card: {
    title: 'Сегодня 108 знакомых, около 45 минут.',
    lines: ['Осенняя сессия · 3 ноября, через 18 дней', 'Выучено 143 из 960', 'Ещё сегодня «Зимняя сессия», около 45 минут.'],
    keys: [['Начать: 20 вопросов'], ['Открыть занятие'], ['Другой экзамен'], ['Экзамены']],
  },
  k3: {
    title: 'Экзамен прошёл 3 ноября.',
    lines: ['За 26 дней вы занимались 21 день и дали 6 480 ответов.', 'Выучено 902 вопроса из 960.', '', 'Экзамен перенесли? Нажмите «Перенести экзамен», и план обновится.'],
    keys: [['Перенести на неделю'], ['На 2 недели', 'Другая дата']],
  },
  /** K3 came on 4 November; «Перенести на неделю» is 7 days from the link's day (exams.ts examsTap «w1»). */
  moved: {
    lines: ['Экзамен «Осенняя сессия» перенесён на 11 ноября. План обновлён.'],
    keys: [['План на сегодня']],
  },
  /** The dates over the messages and their times. */
  days: ['16 октября', '4 ноября'],
  times: { command: '19:12', settings: '19:12', card: '20:00', k3: '20:00' },
} as const;

/** Where a line wraps on the phone (a sentence too long for the bubble): «line» → its two halves. */
const WRAPS: Record<string, readonly [string, string]> = {
  'Отметьте экзамены, по которым приходит план на день. Можно несколько.': ['Отметьте экзамены, по которым приходит план', 'на день. Можно несколько.'],
  'Экзамен перенесли? Нажмите «Перенести экзамен», и план обновится.': ['Экзамен перенесли? Нажмите «Перенести', 'экзамен», и план обновится.'],
  'Экзамен «Осенняя сессия» перенесён на 11 ноября. План обновлён.': ['Экзамен «Осенняя сессия» перенесён на 11 ноября.', 'План обновлён.'],
};

/** Scene times (ms). */
export const BX = {
  /** «Экзамены» under «Настройки» is pressed, released; the message becomes «Какие экзамены присылать». */
  exams: 1700,
  examsUp: 1840,
  examsShown: 2150,
  /** «— Зимняя сессия» pressed: it becomes «✓ Зимняя сессия». */
  winter: 3500,
  winterUp: 3640,
  winterShown: 3950,
  /** 20:00: the day's card with both exams comes in. */
  card: 5500,
  /** 4 November: K3 comes in. */
  k3: 8700,
  /** «Перенести на неделю» pressed; the message says the exam is moved. */
  move: 10350,
  moveUp: 10490,
  moved: 10850,
} as const;

export const BOT_STEPS: readonly ClipStep[] = [
  { at: 0, caption: 'Откройте /settings и нажмите «Экзамены».', still: 1500 },
  { at: 2400, caption: 'Отметьте экзамены, по которым приходит план.', still: 4700 },
  { at: 5200, caption: 'Вечером придёт план по отмеченным экзаменам.', still: 7700 },
  { at: 8450, caption: 'Экзамен перенесли? «Перенести на неделю».', still: 10100 },
  { at: BX.moved, caption: 'Бот пересчитал план под новую дату.', still: 12700 },
];

/** Telegram's curve for the chat's changes and the spring of a new message (the tip clip's). */
const TG_CURVE = bezier(0.19919, 0.01064, 0.2792, 0.91025);
function arrival(p: number): number {
  const x = clamp(p);
  if (x >= 1) return 1;
  return 1 - Math.exp(-8 * x) * (Math.cos(6 * x) + (8 / 6) * Math.sin(6 * x));
}
function overshoot(p: number): number {
  const t = clamp(p) - 1;
  return t * t * (3 * t + 2) + 1;
}

/** Telegram's dp: a line of a message, the padding of its text, a row of buttons. */
const LINE = 18.75;
const TEXT_PAD = 15.5;
const ROW = 44;
const ROW_GAP = 4;
const KB_GAP = 2.5;
const textHeight = (lines: number) => lines * LINE + TEXT_PAD;
const kbHeight = (rows: number) => rows * ROW + (rows - 1) * ROW_GAP;
const shownLines = (lines: readonly string[]) => lines.reduce((n, line) => n + (WRAPS[line] ? 2 : 1), 0);

/** The heights (dp) of each state of the bot's three messages: the bubble and its keyboard. */
const H = {
  settings: { text: textHeight(1 + shownLines(BOT_WORDS.settings.lines)), kb: kbHeight(BOT_WORDS.settings.keys.length) },
  exams: { text: textHeight(1 + shownLines(BOT_WORDS.exams.lines)), kb: kbHeight(BOT_WORDS.exams.keysBefore.length) },
  card: { text: textHeight(1 + shownLines(BOT_WORDS.card.lines)), kb: kbHeight(BOT_WORDS.card.keys.length) },
  k3: { text: textHeight(1 + shownLines(BOT_WORDS.k3.lines)), kb: kbHeight(BOT_WORDS.k3.keys.length) },
  moved: { text: textHeight(shownLines(BOT_WORDS.moved.lines)), kb: kbHeight(BOT_WORDS.moved.keys.length) },
};
const full = (state: { text: number; kb: number }) => state.text + KB_GAP + state.kb;

function Lines({ title, lines }: { title?: string; lines: readonly string[] }) {
  return (
    <>
      {title ? (
        <p>
          <b>{title}</b>
        </p>
      ) : null}
      {lines.flatMap((line, index) => {
        const parts = WRAPS[line] ?? [line];
        return parts.map((part, at) => (
          <p key={`${index}-${at}`} className={line === '' ? 'ts-tg-gap' : undefined}>
            {part}
            {index === lines.length - 1 && at === parts.length - 1 ? <i className="ts-tg-room" aria-hidden="true" /> : null}
          </p>
        ));
      })}
    </>
  );
}

function Tail() {
  return (
    <svg className="ts-tg-tail" viewBox="0 0 9 12" aria-hidden="true">
      <path d="M8 1A6.5 10 0 0 1 2.3 10.9L2.6 12H9V1Z" />
    </svg>
  );
}

function Keys({ rows, name, press, primary, hidden }: { rows: ReadonlyArray<readonly string[]>; name?: string; press?: string; primary?: string; hidden?: boolean }) {
  return (
    <div data-a={name} className="ts-tg-kb bx-kb" style={hidden ? { opacity: 0 } : undefined}>
      {rows.map((row, r) => (
        <div key={r} className={row.length > 1 ? 'ts-tg-kb-row' : 'bx-kb-one'}>
          {row.map((label, k) => {
            const last = r === rows.length - 1;
            const place = !last ? 'row' : row.length === 1 ? 'bottom' : k === 0 ? 'bottom-left' : 'bottom-right';
            const pressed = press === label;
            return (
              <span key={label} data-a={pressed ? `${name}-key` : undefined} className={`ts-tg-key${primary === label ? ' ts-tg-key--primary' : ''}`} data-place={place}>
                {pressed ? <i data-a={`${name}-ripple`} className="ts-tg-ripple" style={{ opacity: 0, left: '52%', top: '56%' }} /> : null}
                <span className="ts-tg-key-t">{label}</span>
                {pressed ? <i data-a={`${name}-load`} className="ts-tg-load" style={{ opacity: 0 }} /> : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function BotPhoto() {
  return (
    <svg className="ts-tg-photo" viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r="256" fill="#2869dd" />
      <g transform="translate(39 53) scale(.795)">
        <path d="M121 342V222a52 52 0 0 1 104 0v120M225 222a52 52 0 0 1 104 0v120" fill="none" stroke="#fff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="385" cy="322" r="30" fill="#f4c45b" />
      </g>
    </svg>
  );
}

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

export function BotExamsScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const clock = useClock();
  const widths = useRef<Record<string, number> | null>(null);

  /** The widest line of each state's text (dp): Telegram fits a bubble to it. */
  const measure = () => {
    const el = root.current;
    if (!el) return null;
    const out: Record<string, number> = {};
    el.querySelectorAll<HTMLElement>('[data-w]').forEach((block) => {
      out[block.dataset.w as string] = block.offsetWidth;
    });
    return out;
  };

  useEffect(() => {
    let live = true;
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready
      ?.then(() => {
        if (!live) return;
        widths.current = null;
        clock.seek(clock.time);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [clock]);

  useFrame((l) => {
    const w = widths.current ?? (widths.current = measure());
    const width = (name: string) => (w?.[name] ? w[name] + 21 : 0);

    // A press: the button dips under the finger with the ripple, springs back; a line runs round it until the bot answers.
    const press = (name: string, down: number, up: number, answered: number) => {
      const pressed = l < up ? seg(l, down, 100) : seg(up, down, 100) * (1 - overshoot(seg(l, up, 350)));
      put(one(`${name}-key`), 'transform', `scale(${(0.96 + 0.04 * (1 - pressed)).toFixed(4)})`);
      const ripple = one(`${name}-ripple`);
      put(ripple, 'transform', `translate(-50%,-50%) scale(${(0.08 + 0.92 * ease.out(seg(l, down, 420))).toFixed(3)})`);
      opacity(ripple, l < down ? 0 : 1 - seg(l, up + 90, 240));
      const load = one(`${name}-load`);
      const waiting = seg(l, up + 40, 140) * (1 - seg(l, answered, 140));
      opacity(load, waiting);
      put(load, '--tg-run', `${waiting > 0 ? (((l - up) * 0.5) % 360).toFixed(1) : '0'}deg`);
    };

    // 1 · «Настройки» → «Какие экзамены присылать» (an edit: the text cross-fades, the bubble takes the new width).
    press('m1a', BX.exams, BX.examsUp, BX.examsShown - 40);
    const toExams = TG_CURVE(seg(l, BX.examsShown, 250));
    opacity(one('m1-settings'), 1 - toExams);
    opacity(one('m1-exams'), toExams);
    opacity(one('m1a'), 1 - toExams);
    opacity(one('m1b'), toExams);
    const m1w = width('settings') * (1 - toExams) + width('exams') * toExams;
    if (m1w > 0) {
      put(one('m1-bubble'), 'width', `${m1w.toFixed(2)}px`);
      put(one('m1a'), 'width', `${(m1w + 1).toFixed(2)}px`);
      put(one('m1b'), 'width', `${(m1w + 1).toFixed(2)}px`);
    }
    // 2 · «— Зимняя сессия» → «✓ Зимняя сессия».
    press('m1b', BX.winter, BX.winterUp, BX.winterShown - 40);
    const ticked = TG_CURVE(seg(l, BX.winterShown, 250));
    opacity(one('winter-off'), 1 - ticked);
    opacity(one('winter-on'), ticked);

    // 3 · 20:00: the day's card comes up from under the input bar; the chat moves up with it.
    const card = arrival(seg(l, BX.card, 560));
    const cardH = full(H.card) + 6;
    // 4 · 4 November: the date and K3.
    const k3 = arrival(seg(l, BX.k3, 560));
    const k3H = full(H.k3) + 6 + 40;
    put(one('feed'), 'transform', `translate3d(0,${((1 - card) * cardH + (1 - k3) * k3H).toFixed(2)}px,0)`);
    opacity(one('m2'), clamp(seg(l, BX.card, 160)));
    opacity(one('m3'), clamp(seg(l, BX.k3, 160)));
    const m2w = width('card');
    if (m2w > 0) {
      put(one('m2-bubble'), 'width', `${m2w.toFixed(2)}px`);
      put(one('m2-kb'), 'width', `${(m2w + 1).toFixed(2)}px`);
    }

    // «Перенести на неделю» → «Экзамен «Осенняя сессия» перенесён на 11 ноября. План пересчитан.»: the message shrinks,
    // the chat keeps its bottom.
    press('m3a', BX.move, BX.moveUp, BX.moved - 40);
    const toMoved = TG_CURVE(seg(l, BX.moved, 250));
    opacity(one('m3-k3'), 1 - toMoved);
    opacity(one('m3-moved'), toMoved);
    opacity(one('m3a'), 1 - toMoved);
    opacity(one('m3b'), toMoved);
    const textH = H.k3.text * (1 - toMoved) + H.moved.text * toMoved;
    const kbH = H.k3.kb * (1 - toMoved) + H.moved.kb * toMoved;
    put(one('m3-live'), 'height', `${(textH + KB_GAP + kbH).toFixed(2)}px`);
    put(one('m3-bubble'), 'height', `${textH.toFixed(2)}px`);
    put(one('m3-bubble'), 'bottom', `${(kbH + KB_GAP).toFixed(2)}px`);
    const m3w = width('k3') * (1 - toMoved) + width('moved') * toMoved;
    if (m3w > 0) {
      put(one('m3-bubble'), 'width', `${m3w.toFixed(2)}px`);
      put(one('m3a'), 'width', `${(m3w + 1).toFixed(2)}px`);
      put(one('m3b'), 'width', `${(m3w + 1).toFixed(2)}px`);
    }
  });

  return (
    <div ref={root} className="mr-scene bx-scene">
      <div className="bx-fit">
        <div className="ts-tg bx">
          <div className="ts-tg-wall" />
          <div className="ts-tg-chat bx-chat">
            <div data-a="feed" className="ts-tg-feed">
              <span className="ts-tg-day">{BOT_WORDS.days[0]}</span>
              <div className="bx-out">
                <span className="bx-out-t">{BOT_WORDS.command}</span>
                <span className="bx-out-time">
                  {BOT_WORDS.times.command}
                  <svg viewBox="0 0 18 12" aria-hidden="true">
                    <path d="M1 6.5l3 3 6-7M7.5 9.5l1 1 6-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>

              {/* «Настройки» → «Какие экзамены присылать». */}
              <div className="ts-tg-msg bx-msg" style={{ height: full(H.settings) }}>
                <div data-a="m1-bubble" className="ts-tg-bubble ts-tg-bubble--keys" style={{ height: H.settings.text, bottom: H.settings.kb + KB_GAP }}>
                  <div data-a="m1-settings" className="ts-tg-text">
                    <div data-w="settings" className="bx-w">
                      <Lines title={BOT_WORDS.settings.title} lines={BOT_WORDS.settings.lines} />
                    </div>
                  </div>
                  <div data-a="m1-exams" className="ts-tg-text" style={{ opacity: 0 }}>
                    <div data-w="exams" className="bx-w">
                      <Lines title={BOT_WORDS.exams.title} lines={BOT_WORDS.exams.lines} />
                    </div>
                  </div>
                  <span className="ts-tg-time">{BOT_WORDS.times.settings}</span>
                  <Tail />
                </div>
                <Keys rows={BOT_WORDS.settings.keys} name="m1a" press="Экзамены" />
                <div data-a="m1b" className="ts-tg-kb bx-kb" style={{ opacity: 0 }}>
                  {BOT_WORDS.exams.keysBefore.map((row, r) => {
                    const label = row[0];
                    const winter = r === 1;
                    return (
                      <div key={label} className="bx-kb-one">
                        <span data-a={winter ? 'm1b-key' : undefined} className="ts-tg-key" data-place={r === 2 ? 'bottom' : 'row'}>
                          {winter ? <i data-a="m1b-ripple" className="ts-tg-ripple" style={{ opacity: 0, left: '52%', top: '56%' }} /> : null}
                          {winter ? (
                            <span className="ts-tg-key-t bx-swap">
                              <span data-a="winter-off">{label}</span>
                              <span data-a="winter-on" style={{ opacity: 0 }}>
                                {BOT_WORDS.exams.keysAfter[1][0]}
                              </span>
                            </span>
                          ) : (
                            <span className="ts-tg-key-t">{label}</span>
                          )}
                          {winter ? <i data-a="m1b-load" className="ts-tg-load" style={{ opacity: 0 }} /> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 20:00: the day's card. */}
              <div data-a="m2" className="ts-tg-msg bx-msg bx-gap" style={{ height: full(H.card), opacity: 0 }}>
                <div data-a="m2-bubble" className="ts-tg-bubble ts-tg-bubble--keys" style={{ height: H.card.text, bottom: H.card.kb + KB_GAP }}>
                  <div className="ts-tg-text">
                    <div data-w="card" className="bx-w">
                      <Lines title={BOT_WORDS.card.title} lines={BOT_WORDS.card.lines} />
                    </div>
                  </div>
                  <span className="ts-tg-time">{BOT_WORDS.times.card}</span>
                  <Tail />
                </div>
                <Keys rows={BOT_WORDS.card.keys} name="m2-kb" primary={BOT_WORDS.card.keys[0][0]} />
              </div>

              {/* 4 November: K3, then the move. */}
              <div data-a="m3" className="bx-arrive" style={{ opacity: 0 }}>
                <span className="ts-tg-day">{BOT_WORDS.days[1]}</span>
                <div data-a="m3-live" className="ts-tg-msg bx-msg" style={{ height: full(H.k3) }}>
                  <div data-a="m3-bubble" className="ts-tg-bubble ts-tg-bubble--keys" style={{ height: H.k3.text, bottom: H.k3.kb + KB_GAP }}>
                    <div data-a="m3-k3" className="ts-tg-text">
                      <div data-w="k3" className="bx-w">
                        <Lines title={BOT_WORDS.k3.title} lines={BOT_WORDS.k3.lines} />
                      </div>
                    </div>
                    <div data-a="m3-moved" className="ts-tg-text" style={{ opacity: 0 }}>
                      <div data-w="moved" className="bx-w">
                        <Lines lines={BOT_WORDS.moved.lines} />
                      </div>
                    </div>
                    <span className="ts-tg-time">{BOT_WORDS.times.k3}</span>
                    <Tail />
                  </div>
                  <Keys rows={BOT_WORDS.k3.keys} name="m3a" press="Перенести на неделю" />
                  <Keys rows={BOT_WORDS.moved.keys} name="m3b" hidden />
                </div>
              </div>
            </div>
          </div>
          <div className="ts-tg-head">
            <Icon name="back" />
            <BotPhoto />
            <span className="ts-tg-who">
              <span className="ts-tg-name">Meldy</span>
              <span className="ts-tg-sub">бот</span>
            </span>
          </div>
          <div className="ts-tg-input">
            <div className="ts-tg-field">
              <span className="ts-tg-menu">Открыть Meldy</span>
              <Icon name="smile" />
              <span className="ts-tg-hint">Сообщение</span>
              <Icon name="clip" />
            </div>
            <span className="ts-tg-mic">
              <Icon name="mic" />
            </span>
          </div>
        </div>
      </div>
      <BotFade />
    </div>
  );
}

/** The loop's seam: the chat comes from and goes to empty paper (the theme's), as the other clips do. */
function BotFade() {
  const root = useRef<HTMLDivElement>(null);
  useFrame((l) => {
    const into = ease.out(seg(l, 0, 380));
    const out = ease.in(seg(l, BOT_TOTAL - 520, 480));
    opacity(root.current, 1 - into * (1 - out));
  });
  return <div ref={root} className="bx-paper" />;
}
