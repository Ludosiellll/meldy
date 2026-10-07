/**
 * The beats both sign-in reels share, in the film style (components/film): the department's questions
 * checked against the lectures with a quote, the ticket aloud with the examiner's follow-up, and the
 * cheat sheet that only answers erase. The example is /try's «Микроэкономика», question 7, word for
 * word (data/example/questions.ts; StoryScenes.test holds the words to it and to the exam page's).
 */
import { useRef, type ComponentType } from 'react';
import { opacity, put, text as setText, useEls, useFrame } from '../reel/engine';
import { clamp, ease, seg } from '../reel/timeline';
import { MicIcon, Statement, focusIn, pressDepth, slideIn } from '../film/kit';
import { SheetCaption, StageSheet, type StageDate, type StageQuestion } from '../film/StageSheet';
import type { InkLine } from '../film/ink';
import { shot } from './camera';

// ---------------------------------------------------------------------------------------------
// The example

/** Question 6: every main line erased (named on two different days), the last one never named. */
export const Q6: StageQuestion = {
  number: 6,
  text: 'Факторы ценовой эластичности спроса.',
  learned: true,
  lines: [
    { text: 'заменителей ↑ → спрос эластичнее', essential: true, from: 'erased' },
    { text: 'доля в бюджете ↑ → эластичность ↑', essential: true, from: 'erased' },
    { text: 'необходимость — неэластичный, роскошь — эластичный', essential: true, from: 'erased' },
    { text: 'со временем спрос эластичнее', essential: false, from: 'fresh' },
  ],
};

export const Q7_TEXT = 'Эластичность спроса и выручка продавца.';
/** The short lines of question 7's answer points, in their order. */
export const Q7_LINES = [
  'выручка = цена × количество',
  'эластичный: снижение цены → выручка ↑',
  'неэластичный: выручка ↑ при повышении цены',
  'единичная эластичность: выручка не меняется',
] as const;
/** The examiner's follow-up on point 3, the one the answer missed. */
export const FOLLOWUP = 'А если спрос неэластичный, как продавцу увеличить выручку?';
/** The quote question 7 is checked by (lecture «Эластичность спроса», fragment 5). */
export const QUOTE = 'Если спрос эластичный, снижение цены увеличивает выручку';
/** The pencil note of a point named only after the examiner's question (the exam page's words). */
export const AFTER_QUESTION = 'назван только после вопроса экзаменатора';
/** What today's answer did to question 7, in the exam page's words (copy.ts changeSentence). */
export const ANSWER_CHANGE = 'После ответа: 1\u00a0строка стёрлась, 2\u00a0—\u00a0наполовину, 1\u00a0не стёрлась.';

/**
 * Question 7: its first line was named the day before (rubbed). With `answer` (scene time), today's
 * answer plays: the first line is named again on another day and goes (←), lines 2 and 4 are named
 * for the first time (→ half-way), line 3 is named only after the examiner asked about it — it stays,
 * with the pencil wave.
 */
export function q7(answer: number | null): StageQuestion {
  const lines: InkLine[] = [
    { text: Q7_LINES[0], essential: true, from: 'rubbed', steps: answer === null ? [] : [{ at: answer, to: 'erased' }] },
    { text: Q7_LINES[1], essential: true, from: 'fresh', steps: answer === null ? [] : [{ at: answer + 280, to: 'rubbed' }] },
    { text: Q7_LINES[2], essential: true, from: 'fresh', steps: answer === null ? [] : [{ at: answer + 980, to: 'missed', note: AFTER_QUESTION }] },
    { text: Q7_LINES[3], essential: false, from: 'fresh', steps: answer === null ? [] : [{ at: answer + 560, to: 'rubbed' }] },
  ];
  return { number: 7, text: Q7_TEXT, lines };
}

/** The paper's width at its own size: question 7's longest line fits on one row. */
export const SHEET_W = 474;

/** The sheet in a white card, as the landing's first screen shows it: the pink flag, the exam, the paper. */
export function SheetCard({
  name,
  className,
  questions,
  dates,
  caption,
  width,
  zoom,
}: {
  name: string;
  className: string;
  questions: readonly StageQuestion[];
  dates?: readonly StageDate[];
  caption?: ReadonlyArray<{ at: number; text: string }>;
  width: number;
  zoom: number;
}) {
  return (
    <div data-a={name} className={`fm-card ar-card ${className}`} style={{ opacity: 0 }}>
      <div className="ar-card-top">
        <span className="ar-flag">Шпаргалка</span>
        <span className="ar-card-meta">Микроэкономика</span>
      </div>
      <StageSheet questions={questions} dates={dates} width={width} zoom={zoom} seed="auth-reel" className="ar-paper" />
      {caption ? <SheetCaption items={caption} className="ar-cap" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Ответы — из лекций.» — the department's questions get their marks against the lectures, then the
// quote that answers question 7.

/** Questions 6–8 of the list as «Вопросы» shows them: the mark and where in the lectures the answer is. */
export const QUESTION_ROWS: Array<{ n: number; text: string; kind: 'ok' | 'half'; word: string; source: string }> = [
  { n: 6, text: 'Факторы ценовой эластичности спроса.', kind: 'ok', word: 'есть в лекциях', source: 'Эластичность спроса, фрагмент 4' },
  { n: 7, text: Q7_TEXT, kind: 'ok', word: 'есть в лекциях', source: 'там же, фрагмент 5' },
  { n: 8, text: 'Перекрёстная эластичность и эластичность спроса по доходу. Товары Гиффена.', kind: 'half', word: 'частично', source: 'там же, фрагмент 6' },
];

export function Answers({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('list'), l, leave);
    all('st').forEach((chip, index) => slideIn(chip, l, 760 + index * 200, { dx: 50, dur: 560, smear: 10 }));
    all('src').forEach((source, index) => opacity(source, seg(l, 900 + index * 200, 320)));
    opacity(one('focus'), seg(l, 1500, 360));
    slideIn(one('slip'), l, 1650, { dx: 260, dy: 30, dur: 760, smear: 16 });
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="list" className="ar-q" style={{ opacity: 0 }}>
        <div className="fm-card ar-q-card">
          <p className="ar-q-h">Вопросы к экзамену по микроэкономике</p>
          {QUESTION_ROWS.map((row) => (
            <div key={row.n} className="ar-q-row">
              {row.n === 7 ? <i data-a="focus" className="ar-q-focus" style={{ opacity: 0 }} /> : null}
              <span className="ar-q-n">{row.n}</span>
              <span className="ar-q-t">
                {row.text}
                <small data-a="src" style={{ opacity: 0 }}>
                  {row.source}
                </small>
              </span>
              <span data-a="st" className={`fm-st fm-st--${row.kind}`} style={{ opacity: 0 }}>
                <b />
                {row.word}
              </span>
            </div>
          ))}
        </div>
        <div data-a="slip" className="fm-card ar-slip" style={{ opacity: 0 }}>
          <p className="ar-slip-c fm-muted">Лекция «Эластичность спроса» · фрагмент 5</p>
          <p className="ar-slip-q">«{QUOTE}»</p>
        </div>
      </div>
      <Statement lines={['Ответы —', 'из лекций.']} at={350} out={leave} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Билет — вслух.» — question 7 answered by voice; three points of four are named, and the examiner
// asks about the one that was not.

const BARS = Array.from({ length: 26 }, (_, index) => index);
/** When each named point is counted (3 of 4: the answer misses point 3). */
const NAMED = [1120, 1360, 1580];

export function Ticket({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('room'), l, leave);
    put(one('voice'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 820)).toFixed(3)})`);
    const talk = seg(l, 960, 160) * (1 - seg(l, 1760, 220));
    all('bar').forEach((bar, index) => {
      const wave = 0.5 + 0.5 * Math.sin(l / 85 + index * 0.8) * Math.sin(l / 260 + index * 0.31);
      put(bar, 'transform', `scaleY(${(0.1 + 0.9 * wave * talk).toFixed(3)})`);
    });
    opacity(one('wave'), clamp(seg(l, 900, 200) * 3));
    const named = NAMED.filter((at) => l >= at).length;
    setText(one('count'), String(named));
    all('mark').forEach((mark, index) => {
      const at = index < 2 ? NAMED[index] : index === 3 ? NAMED[2] : Number.POSITIVE_INFINITY;
      put(mark, 'transform', `scale(${(l >= at ? ease.back(seg(l, at, 300)) : 1).toFixed(3)})`);
      opacity(one(`fill${index}`), l >= at ? 1 : 0);
    });
    opacity(one('countline'), seg(l, 1000, 300));
    slideIn(one('ask'), l, 1820, { dy: 60, dur: 680, smear: 10 });
    focusIn(one('askq'), l, 1980, 520, 10);
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="room" className="ar-room" style={{ opacity: 0 }}>
        <div className="fm-card ar-ticket">
          <span className="ar-pill">Вопрос 7</span>
          <p className="fm-h1 ar-ticket-q">{Q7_TEXT}</p>
          <div className="ar-voice">
            <span data-a="voice" className="fm-btn fm-btn--blue">
              <MicIcon />
              Отвечать голосом
            </span>
            <span data-a="wave" className="ar-wave" style={{ opacity: 0 }}>
              {BARS.map((index) => (
                <i key={index} data-a="bar" />
              ))}
            </span>
          </div>
        </div>
        <p data-a="countline" className="ar-count" style={{ opacity: 0 }}>
          По ключевым словам: <b data-a="count">0</b> <b>из 4</b>
          <span className="ar-marks">
            {[0, 1, 2, 3].map((index) => (
              <i key={index} data-a="mark" className="ar-mark-slot">
                <i data-a={`fill${index}`} className="ar-mark-fill" style={{ opacity: 0 }} />
              </i>
            ))}
          </span>
        </p>
        <div data-a="ask" className="ar-ask" style={{ opacity: 0 }}>
          <p className="ar-ask-who">
            <span className="ar-ask-ava">Э</span>
            Экзаменатор
          </p>
          <p data-a="askq" className="ar-ask-q" style={{ opacity: 0 }}>
            «{FOLLOWUP}»
          </p>
        </div>
      </div>
      <Statement lines={['Билет —', 'вслух.']} at={350} out={leave} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Стирают только ответы.» — the sheet the next day: today's answer erases the line named yesterday,
// rubs two named for the first time, and leaves the one named only after the examiner's question.

/** Today's answer on the sheet (scene time) and the day in the paper's corner. */
export const ERASE_AT = 1000;
const ERASE_DATES: readonly StageDate[] = [{ at: 450, text: '8 окт.' }];
const ERASE_CAPTION = [{ at: ERASE_AT + 1750, text: ANSWER_CHANGE }];
const ERASE_QUESTIONS = [q7(ERASE_AT)];

export function Erase({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => shot(one('sheet'), l, leave));
  return (
    <div ref={root} className="mr-scene">
      <SheetCard name="sheet" className="ar-erase" questions={ERASE_QUESTIONS} dates={ERASE_DATES} caption={ERASE_CAPTION} width={SHEET_W} zoom={1.74} />
      <Statement lines={['Стирают', 'только ответы.']} at={350} out={leave} className="ar-say ar-say--erase" />
    </div>
  );
}

/** A scene with its leaving moment fixed: the views of a reel take no props. */
export function withLeave(View: ComponentType<{ leave: number }>, leave: number): ComponentType {
  function Scene() {
    return <View leave={leave} />;
  }
  Scene.displayName = `${View.name}At${leave}`;
  return Scene;
}
