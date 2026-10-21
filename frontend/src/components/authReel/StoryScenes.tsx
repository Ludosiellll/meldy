/**
 * The beats both sign-in reels share, in the film style (components/film): a question of the day's session answered
 * wrong — the key from the file and «Вернётся … завтра» — and an oral answer: its points checked against the lectures,
 * the protocol's line, and «Осталось выучить» (owner, 2026-10-21) with the topic the answer closes. The session is the
 * example exam's (data/containerExample.ts); the oral question is /try's «Микроэкономика», question 7, word for word
 * (data/ticketExample.ts). StoryScenes.test holds the words to the example and to the app's own (the protocol's line,
 * the topics' words).
 */
import { useRef, type ComponentType } from 'react';
import { blur, flag, opacity, put, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Arrow, MicIcon, Statement, focusIn, pressDepth, slideIn } from '../film/kit';
import { SESSION } from '../../data/containerExample';
import { Q7 } from '../../data/ticketExample';
import { answerSummary, summaryLine } from '../../lib/oral/answerSummary';
import type { PointStatus } from '../../lib/oral/oralGrade';
import {
  CARD_TITLE,
  closedRibbon,
  closedTopicLine,
  countWords,
  tally,
  topicRowLine,
  withResults,
  type Step,
  type Topic,
  type TopicQuestion,
} from '../../lib/containers/topics';
import { shot } from './camera';

/** The reels' «today» (a film: its dates do not move with the calendar). */
export const REEL_TODAY = '2026-10-10';

// ---------------------------------------------------------------------------------------------
// The oral example: /try's question 7

export const Q7_TEXT = Q7.text;

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
      <Statement lines={['Ошибка', 'вернётся завтра.']} at={350} out={leave} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// «Ответ вслух — по вашим лекциям.» — question 7 answered by voice; its result comes forward: the points the answer
// named, the protocol's line, and «Осталось выучить» — question 7 was the last of its topic, so the topic is learned.

const BARS = Array.from({ length: 24 }, (_, index) => index);
/** When the result comes forward, and when the check reaches its first point (scene time). */
export const RESULT_IN = 1250;
export const ORAL_AT = 1950;
/** One point's mark after another. */
export const MARK_EVERY = 160;
export const MARK_AT = (index: number) => ORAL_AT + index * MARK_EVERY;
/** The protocol's line, once every point has its mark. */
export const SUM_AT = MARK_AT(Q7.points.length) + 100;
/** Question 7's segment of the topic's bar fills, the topic is learned, the count of topics left goes down. */
export const FILL_AT = SUM_AT + 300;
export const LEARNED_AT = FILL_AT + 420;
export const COUNTED_AT = LEARNED_AT + 160;
/** How long a mark, the flag or the count takes to come in. */
export const POP = 320;

/** What the check found for each point of question 7: the three main ones in full, the detail only mentioned. */
export const Q7_STATUSES: readonly PointStatus[] = ['covered', 'covered', 'covered', 'partial'];

/** «Сами назвали 3 из 3 главных пунктов»: the protocol's line for these points (lib/oral/answerSummary). */
export const RESULT_LINE =
  summaryLine(answerSummary(Q7.points.map((point, index) => ({ id: `p${index + 1}`, essential: point.essential, status: Q7_STATUSES[index] })), null)) ?? '';

const question = (n: number, step: Step): TopicQuestion => ({ id: `q${n}`, n: String(n), pos: n, kind: 'o', step, learnedAt: null });
const topic = (lecture: number, title: string, steps: ReadonlyArray<readonly [number, Step]>): Topic => ({
  key: `o:example:l${lecture}`,
  title,
  name: title,
  part: null,
  oralTag: false,
  testTopic: null,
  questions: steps.map(([n, step]) => question(n, step)),
});

/**
 * The example exam's topics on the reel's day, before the answer: one a lecture, as «Осталось выучить» groups an oral
 * exam (lib/containers/topics.ts; question 12 is in no lecture and is not counted). In «Эластичность спроса» only
 * question 7 is left: its main points were all named the day before, today's answer names them again.
 */
export const TOPICS_BEFORE: readonly Topic[] = [
  topic(0, 'Спрос и предложение', [[1, 'done'], [2, 'started'], [3, 'started'], [4, 'done']]),
  topic(1, 'Эластичность спроса', [[5, 'done'], [6, 'done'], [7, 'started'], [8, 'done']]),
  topic(2, 'Издержки и прибыль фирмы', [[9, 'started'], [10, 'none'], [11, 'none']]),
];
export const TOPICS_AFTER: readonly Topic[] = withResults(TOPICS_BEFORE, new Set(['q7']), new Set());
const SHOWN = 1;
/** The topic on screen: «Эластичность спроса», before and after the answer. */
export const TOPIC_BEFORE = TOPICS_BEFORE[SHOWN];
export const TOPIC_AFTER = TOPICS_AFTER[SHOWN];

const before = tally(TOPICS_BEFORE);
const after = tally(TOPICS_AFTER);
/** The card's words, as «Осталось выучить» on the exam page and at a session's end say them. */
export const LEFT_WORDS = {
  title: CARD_TITLE,
  count: [before.left, after.left] as const,
  of: [countWords(before.left, before.total, before.begun), countWords(after.left, after.total, after.begun)] as const,
  row: [topicRowLine(TOPIC_BEFORE), closedTopicLine(TOPIC_AFTER)] as const,
  learned: closedRibbon(1),
};

function Tick() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12.5l4 4L18 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** «упомянут»: half of the point (the protocol counts it for half). */
function Half() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 5.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" />
    </svg>
  );
}

export function Oral({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('room'), l, leave);
    // The ticket steps back out of focus as the result comes forward.
    const back = ease.inOut(seg(l, RESULT_IN, 700));
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
    slideIn(one('result'), l, RESULT_IN, { dx: 220, dy: 60, dur: 760, smear: 14 });
    // Each point's mark pops in on its number as the check reaches it.
    all('pt').forEach((row, index) => flag(row, 'is-checked', l >= MARK_AT(index)));
    all('mark').forEach((mark, index) => {
      const p = seg(l, MARK_AT(index), POP);
      put(mark, 'transform', `scale(${mix(0.4, 1, ease.back(p)).toFixed(3)})`);
      opacity(mark, clamp(p * 3));
    });
    focusIn(one('sum'), l, SUM_AT, 260, 8);
    // Question 7's segment fills, the topic is learned, one topic fewer is left.
    put(one('fill'), 'transform', `scaleX(${ease.inOut(seg(l, FILL_AT, 380)).toFixed(3)})`);
    flag(one('row'), 'is-later', l >= LEARNED_AT);
    const learned = seg(l, LEARNED_AT, POP);
    put(one('learned'), 'transform', `scale(${mix(0.6, 1, ease.back(learned)).toFixed(3)})`);
    opacity(one('learned'), clamp(learned * 3));
    flag(one('count'), 'is-later', l >= COUNTED_AT);
    put(one('count'), 'transform', `scale(${(1 + 0.12 * Math.sin(Math.PI * seg(l, COUNTED_AT, POP))).toFixed(3)})`);
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
        <div data-a="result" className="fm-card ar-res" style={{ opacity: 0 }}>
          <ol className="ar-pts">
            {Q7.points.map((point, index) => (
              <li key={point.text} data-a="pt" className="ar-pt" data-status={Q7_STATUSES[index]}>
                <span className="ar-pt-n">
                  {index + 1}
                  <span data-a="mark" className="ar-pt-mark" style={{ opacity: 0 }}>
                    {Q7_STATUSES[index] === 'covered' ? <Tick /> : <Half />}
                  </span>
                </span>
                <span className="ar-pt-t">{point.text}</span>
              </li>
            ))}
          </ol>
          <p data-a="sum" className="ar-sum" style={{ opacity: 0 }}>
            {RESULT_LINE}
          </p>
          <div className="ar-left">
            <div className="ar-left-top">
              <p className="ar-left-h">{LEFT_WORDS.title}</p>
              <p className="ar-left-n">
                <b data-a="count" className="ar-two">
                  <span>{LEFT_WORDS.count[0]}</span>
                  <span>{LEFT_WORDS.count[1]}</span>
                </b>
                <span className="ar-two">
                  <span>{LEFT_WORDS.of[0]}</span>
                  <span>{LEFT_WORDS.of[1]}</span>
                </span>
              </p>
            </div>
            <div className="ar-topic">
              <p className="ar-topic-t">
                {TOPIC_BEFORE.title}
                <span data-a="learned" className="ar-topic-flag" style={{ opacity: 0 }}>
                  {LEFT_WORDS.learned}
                </span>
              </p>
              <p data-a="row" className="ar-topic-m ar-two">
                <span>{LEFT_WORDS.row[0]}</span>
                <span>{LEFT_WORDS.row[1]}</span>
              </p>
              <span className="ar-segs" aria-hidden="true">
                {TOPIC_BEFORE.questions.map((q) => (
                  <i key={q.id} data-s={q.step}>
                    {q.id === 'q7' ? <b data-a="fill" /> : null}
                  </i>
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>
      <Statement lines={['Ответ вслух', 'по вашим лекциям.']} at={350} out={leave} className="ar-say ar-say--oral" />
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
