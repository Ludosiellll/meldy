/**
 * The beats both sign-in reels share, in the film style (components/film): a question of the day's session answered
 * wrong — the key from the file and «Вернётся … завтра» — and an oral answer that the cheat sheet takes in Meldy's own
 * look (decision 2026-10-10): a line named on another day is struck off, two lines named for the first time turn
 * yellow, the map of the sheet empties by one square. The session is the example exam's (data/containerExample.ts);
 * the oral question is /try's «Микроэкономика», question 7, word for word (data/sheetExample.ts;
 * StoryScenes.test holds the words to the example and to the exam page's).
 */
import { useRef, type ComponentType } from 'react';
import { blur, flag, opacity, put, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Arrow, MicIcon, Statement, pressDepth, slideIn } from '../film/kit';
import { ListCaption, StageCount, StageList, StageMap } from '../film/StageList';
import type { ListLine, SheetState } from '../film/listLine';
import { SESSION } from '../../data/containerExample';
import { AFTER_QUESTION, Q7, SHEET_BEFORE, SHEET_SUBJECT } from '../../data/sheetExample';
import { shot } from './camera';

/** The reels' «today» (a film: its dates do not move with the calendar). */
export const REEL_TODAY = '2026-10-10';

// ---------------------------------------------------------------------------------------------
// The oral example: /try's question 7 and the sheet around it

export const Q7_TEXT = Q7.text;
/** The short lines of question 7's answer points, in their order. */
export const Q7_LINES = Q7.lines.map((line) => line.text);
export { AFTER_QUESTION };
/** What the answer did to question 7, in the exam page's words (copy.ts changeSentence). */
export const ANSWER_CHANGE = 'После ответа: 1 строка стёрлась, 2 — наполовину, 1 не стёрлась.';

/**
 * Question 7: its first line was named the day before (named once). With `answer` (scene time), today's answer reaches
 * the sheet: the first line is named again on another day and is struck off, lines 2 and 4 are named for the first
 * time (yellow), line 3 is named only after the examiner asked about it — it stays, with its note.
 */
export function q7(answer: number | null): ListLine[] {
  const step = (offset: number, to: SheetState, note?: string) => (answer === null ? [] : [{ at: answer + offset, to, note }]);
  const [first, second, third, fourth] = Q7.lines;
  return [
    { ...first, from: 'rubbed', steps: step(0, 'erased') },
    { ...second, from: 'fresh', steps: step(260, 'rubbed') },
    { ...third, from: 'fresh', steps: step(700, 'missed', AFTER_QUESTION) },
    { ...fourth, from: 'fresh', steps: step(520, 'rubbed') },
  ];
}

/** The map's lines: every question's as they stand (data/sheetExample.ts), question 7's moved by the answer. */
export function mapLines(question7: readonly ListLine[]): ListLine[][] {
  return SHEET_BEFORE.map((question) =>
    question.number === 7 ? [...question7] : question.states.map((state) => ({ text: '', essential: true, from: state })),
  );
}

// ---------------------------------------------------------------------------------------------
// «Ошибка — вернётся завтра.» — a question of today's session, answered wrong: the options say it in words, the
// verdict names the key from the file and when the question comes back.

/** The wrong option is pressed, then the options say what happened (scene time). */
export const PICK = 1000;
export const MARKED = 1180;
const LETTERS = ['А', 'Б', 'В', 'Г'];

export function Session({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('run'), l, leave);
    put(all('opt')[SESSION.chosen], 'transform', `scale(${(1 - 0.03 * pressDepth(l, PICK)).toFixed(4)})`);
    all('opt').forEach((option, index) => {
      flag(option, 'is-wrong', index === SESSION.chosen && l >= MARKED);
      flag(option, 'is-file', index === SESSION.key && l >= MARKED + 90);
    });
    all('tag').forEach((tag, index) => opacity(tag, seg(l, MARKED + 60 + index * 90, 260)));
    slideIn(one('bar'), l, MARKED + 260, { dy: 50, dur: 620, smear: 10 });
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="run" className="fm-card ar-run" style={{ opacity: 0 }}>
        <p className="ar-run-top">
          <b>{SESSION.counter}</b>
          <span>{SESSION.finish}</span>
        </p>
        <p className="ar-run-ctx">{SESSION.context}</p>
        <p className="ar-run-stem">{SESSION.stem}</p>
        <div className="ar-opts">
          {SESSION.options.map((option, index) => (
            <div key={option} data-a="opt" className="ar-opt">
              <span className="ar-opt-l">{LETTERS[index]}</span>
              <span className="ar-opt-t">
                {option}
                {index === SESSION.chosen || index === SESSION.key ? (
                  <span data-a="tag" className="ar-opt-tag" style={{ opacity: 0 }}>
                    {index === SESSION.chosen ? SESSION.yours : SESSION.inFile}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        <div data-a="bar" className="ar-run-bar" style={{ opacity: 0 }}>
          <p className="ar-verdict">{SESSION.verdict}</p>
          <span className="fm-btn fm-btn--blue ar-next">
            {SESSION.next}
            <i>
              <Arrow />
            </i>
          </span>
        </div>
      </div>
      <Statement lines={['Ошибка —', 'вернётся завтра.']} at={350} out={leave} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Ответ вслух — по вашим лекциям.» — question 7 answered by voice; the sheet comes forward and the answer reaches it.

const BARS = Array.from({ length: 24 }, (_, index) => index);
/** When the sheet comes forward, and when the answer reaches it (scene time). */
export const SHEET_IN = 1250;
export const ORAL_AT = 1950;
export const ORAL_LINES = q7(ORAL_AT);
const ORAL_MAP = mapLines(ORAL_LINES);
const ORAL_ALL = ORAL_MAP.flat();
/** What the answer did, once the strike and the namings have run. */
export const ORAL_CAPTION = [{ at: ORAL_AT + 1100, text: ANSWER_CHANGE }];

export function Oral({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('room'), l, leave);
    // The ticket steps back out of focus as the sheet comes forward.
    const back = ease.inOut(seg(l, SHEET_IN, 700));
    put(one('ticket'), 'transform', `translate3d(${(-60 * back).toFixed(1)}px,${(-30 * back).toFixed(1)}px,0) scale(${mix(1, 0.94, back).toFixed(4)})`);
    blur(one('ticket'), 7 * back);
    opacity(one('ticket'), 1 - 0.35 * back);
    put(one('voice'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, 620)).toFixed(3)})`);
    const talk = seg(l, 740, 160) * (1 - seg(l, 1700, 220));
    all('bar').forEach((bar, index) => {
      const wave = 0.5 + 0.5 * Math.sin(l / 85 + index * 0.8) * Math.sin(l / 260 + index * 0.31);
      put(bar, 'transform', `scaleY(${(0.1 + 0.9 * wave * talk).toFixed(3)})`);
    });
    opacity(one('wave'), clamp(seg(l, 680, 200) * 3));
    slideIn(one('sheet'), l, SHEET_IN, { dx: 220, dy: 60, dur: 760, smear: 14 });
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="room" className="ar-room" style={{ opacity: 0 }}>
        <div data-a="ticket" className="fm-card ar-ticket">
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
        <div data-a="sheet" className="fm-card ar-sheet" style={{ opacity: 0 }}>
          <div className="ar-sheet-top">
            <span className="ar-flag">Шпаргалка</span>
            <span className="ar-sheet-meta">{SHEET_SUBJECT}</span>
          </div>
          <StageCount lines={ORAL_ALL} className="ar-sheet-count" />
          <StageMap groups={ORAL_MAP} className="ar-sheet-map" />
          <StageList questions={[{ number: 7, text: Q7_TEXT, lines: ORAL_LINES }]} className="ar-sheet-list" />
          <ListCaption items={ORAL_CAPTION} className="ar-cap" />
        </div>
      </div>
      <Statement lines={['Ответ вслух —', 'по вашим лекциям.']} at={350} out={leave} className="ar-say ar-say--oral" />
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
