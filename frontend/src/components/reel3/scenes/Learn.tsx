/**
 * Chapter «Осталось выучить» (owner, 21.10: the cheat sheet goes; the exam is split into topics, and a topic is done
 * when all its questions are learned). The last question of «Эластичность спроса» is answered, then the card the app
 * shows at a session's end: the topic learned, its bar full, and what is left, 3 topics of 4 becoming 2. Words as the
 * app's card says them (learn-left/DESIGN.md, plain words of 21.10).
 */
import { useRef } from 'react';
import { flag, put, useEls, useFrame } from '../../reel/engine';
import { SAY } from '../../home3/copy3';
import { Count, Say, appear, ease, seg } from '../kit3';
import { Cursor, pressAt, usePointer, type CursorKey } from '../pointer3';

const QUESTION = {
  where: 'Эластичность спроса, последний вопрос',
  stem: 'Когда снижение цены увеличивает выручку?',
  options: ['Спрос эластичный', 'Спрос неэластичный', 'При любом спросе'],
  right: 0,
};

/** The open topics: the first is the one this answer closes. Bars: one segment a question (learned, started, not yet). */
const TOPICS = [
  { title: 'Эластичность спроса', left: 'Остался 1 вопрос из 6', done: 'Все 6 вопросов выучены', learned: 5, started: 1, of: 6 },
  { title: 'Спрос и предложение', left: 'Осталось 3 вопроса из 8', learned: 5, started: 1, of: 8 },
  { title: 'Издержки фирмы', left: 'Осталось 7 вопросов из 7', learned: 0, started: 1, of: 7 },
];

/** The answer: «Спрос эластичный»; the pointer waits in the card's empty foot and goes before the card changes. */
export const LEARN_KEYS: readonly CursorKey[] = [
  { t: 650, aim: 'q', fx: 0.88, fy: 1, dy: -20 },
  { t: 1300, aim: 'pick', press: true, fx: 0.24 },
  { t: 1900, aim: 'q', fx: 0.88, fy: 1, dy: -20 },
  { t: 2200, hide: true },
];
const ANSWERED = pressAt(LEARN_KEYS, 'pick');
/** The question goes, the card of what is left comes up, the last segment fills and the topic is learned. */
const CARD = ANSWERED + 850;
const FILL = CARD + 450;
const LEARNED = FILL + 400;
const COUNTED = LEARNED + 150;

export function LearnScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const pointer = usePointer(LEARN_KEYS);
  useFrame((l) => {
    appear(one('top'), l, 100, 350, 8, ANSWERED + 700);
    appear(one('q'), l, 150, 450, 20, ANSWERED + 700);
    flag(one('pick'), 'is-right', l >= ANSWERED);
    appear(one('ok'), l, ANSWERED + 60, 300, 6, ANSWERED + 700);
    appear(one('card'), l, CARD, 450, 20);
    all('topic').forEach((topic, index) => appear(topic, l, CARD + 120 + index * 90, 380, 8));
    put(one('fill'), 'transform', `scaleX(${ease.inOut(seg(l, FILL, 400)).toFixed(3)})`);
    flag(one('meta0'), 'is-later', l >= LEARNED);
    appear(one('learned'), l, LEARNED, 320, 4);
    flag(one('fold'), 'is-later', l >= COUNTED);
  });
  return (
    <div ref={root} className="r3-scene is-flip">
      <Say text={SAY.learn[0]} at={300} until={ANSWERED + 650} />
      <Say text={SAY.learn[1]} at={CARD + 100} />
      <div className="r3-ui">
        <p data-a="top" className="r3-sess-top" style={{ opacity: 0 }}>
          <span>{QUESTION.where}</span>
          <span>Закончить</span>
        </p>
        <div data-a="q" data-aim="q" className="r3-card r3-sess" style={{ opacity: 0 }}>
          <div className="r3-sess-q">
            <p className="r3-stem">{QUESTION.stem}</p>
            {QUESTION.options.map((option, index) => (
              <span
                key={option}
                data-a={index === QUESTION.right ? 'pick' : undefined}
                data-aim={index === QUESTION.right ? 'pick' : undefined}
                data-aim-on={index === QUESTION.right ? 'is-right' : undefined}
                className="r3-opt r3-opt--row"
              >
                <b>{'АБВ'[index]}</b>
                <span>
                  {option}
                  {index === QUESTION.right ? <small>Ваш ответ</small> : null}
                </span>
              </span>
            ))}
            <p data-a="ok" className="r3-note" style={{ opacity: 0 }}>
              Верно.
            </p>
          </div>
        </div>
        <div data-a="card" className="r3-card r3-left" style={{ opacity: 0 }}>
          <p className="r3-h">Осталось выучить</p>
          <p className="r3-left-count">
            <b>
              <Count from={3} to={2} at={COUNTED} dur={260} />
            </b>
            <span>темы из 4</span>
          </p>
          {TOPICS.map((topic, index) => (
            <div key={topic.title} data-a="topic" className="r3-topic" style={{ opacity: 0 }}>
              <p className="r3-topic-t">{topic.title}</p>
              {topic.done ? (
                <p data-a="meta0" className="r3-meta r3-two">
                  <span>{topic.left}</span>
                  <span>{topic.done}</span>
                </p>
              ) : (
                <p className="r3-meta">{topic.left}</p>
              )}
              <span className="r3-segs" aria-hidden="true">
                {Array.from({ length: topic.of }, (_, at) => (
                  <i key={at} className={at < topic.learned ? 'is-on' : at < topic.learned + topic.started ? 'is-half' : undefined}>
                    {index === 0 && at === topic.learned ? <b data-a="fill" /> : null}
                  </i>
                ))}
              </span>
              {index === 0 ? (
                <span data-a="learned" className="r3-flag r3-flag--g" style={{ opacity: 0 }}>
                  Тема выучена
                </span>
              ) : null}
            </div>
          ))}
          <p className="r3-left-fold">
            <i>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </i>
            <span data-a="fold" className="r3-two">
              <span>Выучена 1 тема</span>
              <span>Выучено 2 темы</span>
            </span>
          </p>
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}
