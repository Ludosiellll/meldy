/**
 * The tips' clips in the film style of the guide (components/film): a statement over the feature's
 * screen out of focus, then the screen comes sharp and does the one thing the feature is for. 16:10
 * stage, 1280 × 800, 6.4 s loops that start and end on empty paper. Example data, the screens' own words.
 */
import { useRef, type ReactNode } from 'react';
import { opacity, put, useEls, useFrame } from '../../reel/engine';
import { clamp, ease, mix, seg } from '../../reel/timeline';
import { Arrow, Statement, Wordmark, pressDepth, slideIn, slideOut } from '../../film/kit';
import type { TipClipDef } from '../TipClip';
import type { TipId } from '../tips';
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
      <div data-a="ui" className="ts-ui" style={{ opacity: 0 }}>
        {children}
      </div>
      <Statement lines={lines} at={300} out={FOCUS - 120} className="ts-say" />
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
          <span className="ts-bar-where">Разговор о лекции</span>
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
// «Шпаргалка»: a question of the exam with its three handwritten lines on squared paper. An answer
// names the first two points: the question's marker, the first line is rubbed to half. An answer on
// another day: the first line is erased, the second rubbed. The same channels as the sheet (a level of
// ink through two passes of fragments, sheet.css), drawn by the frame clock.

const SHEET_QUESTION = '12. Денежный мультипликатор.';
const SHEET_LINES = ['мультипликатор = масса / база', 'зависит от нормы резервов', 'резервы выше — он меньше'];
const SHEET_MARK = 2150;
const SHEET_DAY_1 = 2350;
const SHEET_RUB_1 = 2750;
const SHEET_DAY_2 = 3650;
const SHEET_ERASE_1 = 3950;
const SHEET_RUB_2 = 4250;
const SHEET_SWEEP = 560;
const RUB_LEVEL = 0.55;
const ERASED_LEVEL = 0.22;

/** The line's ink: full, then each step sweeps a new level from left to right (ink and patch). */
function inkAt(l: number, steps: ReadonlyArray<{ at: number; to: number }>): { mask: string; patch: number } {
  let level = 1;
  for (const step of steps) {
    const p = ease.inOut(seg(l, step.at, SHEET_SWEEP));
    if (p <= 0) break;
    const x = mix(-8, 108, p);
    const from = level;
    level = step.to;
    if (p < 1) {
      const edge = `rgba(0,0,0,${step.to}) ${(x - 6).toFixed(1)}%, rgba(0,0,0,${from}) ${(x + 6).toFixed(1)}%`;
      // Ink still whole on the right of the eraser while it was fresh: no fragments there.
      const whole = from >= 1 ? `linear-gradient(90deg, transparent ${(x - 6).toFixed(1)}%, #000 ${(x + 6).toFixed(1)}%)` : 'linear-gradient(transparent, transparent)';
      return { mask: `linear-gradient(90deg, ${edge}), ${whole}, var(--tsh-pass-a), var(--tsh-pass-b)`, patch: from >= 1 ? p : 1 };
    }
  }
  if (level >= 1) return { mask: 'none', patch: 0 };
  return { mask: `linear-gradient(rgba(0,0,0,${level}), rgba(0,0,0,${level})), linear-gradient(transparent, transparent), var(--tsh-pass-a), var(--tsh-pass-b)`, patch: 1 };
}

function Sheet() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    const steps = [[{ at: SHEET_RUB_1, to: RUB_LEVEL }, { at: SHEET_ERASE_1, to: ERASED_LEVEL }], [{ at: SHEET_RUB_2, to: RUB_LEVEL }], []];
    all('ink').forEach((ink, index) => {
      const { mask, patch } = inkAt(l, steps[index] ?? []);
      put(ink, '-webkit-mask-image', mask);
      put(ink, 'mask-image', mask);
      opacity(all('patch')[index], patch);
    });
    // The marker over the printed question, as the sheet draws it after an answer.
    put(one('mark'), 'transform', `scaleX(${ease.out(seg(l, SHEET_MARK, 420)).toFixed(3)})`);
    slideIn(one('day1'), l, SHEET_DAY_1, { dx: 80, dur: 560, smear: 10 });
    slideIn(one('day2'), l, SHEET_DAY_2, { dx: 80, dur: 560, smear: 10 });
    opacity(one('day1-t'), 1 - 0.55 * seg(l, SHEET_DAY_2, 300));
  });
  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Стирают', 'только ответы.']}>
        <div className="tsh-paper">
          <p className="tsh-q">
            <span className="tsh-q-t">
              <span data-a="mark" className="tsh-mark" aria-hidden="true" />
              {SHEET_QUESTION}
            </span>
          </p>
          <ul className="tsh-lines">
            {SHEET_LINES.map((line, index) => (
              <li key={line} className="tsh-line">
                <span className="tsh-bullet">{index < 2 ? '•' : '–'}</span>
                <span className="tsh-body">
                  <span data-a="patch" className="tsh-patch" style={{ opacity: 0 }} />
                  <span data-a="ink" className="tsh-ink">
                    {line}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="tsh-days">
            <p data-a="day1" className="tsh-day" style={{ opacity: 0 }}>
              <span data-a="day1-t">Ответ: назван пункт 1</span>
            </p>
            <p data-a="day2" className="tsh-day" style={{ opacity: 0 }}>
              Ответ в другой день: пункты 1 и 2
            </p>
          </div>
        </div>
      </Beat>
    </div>
  );
}

/**
 * Every tip's clip by the tip's id. Still frames (reduced motion): the talk clip's reply and the
 * lecture's words; the sheet with its first line erased and the second rubbed.
 */
export const TIP_CLIPS: Record<TipId, TipClipDef> = {
  talk: { total: CLIP, poster: 5300, Scene: Talk },
  sheet: { total: CLIP, poster: 5300, Scene: Sheet },
};
