import { useRef } from 'react';
import { FIGURE_AFTER, FIGURE_AFTER_FIRST, FIGURE_BEFORE, SESSION_QUESTIONS, SESSION_SIZE, SESSION_SUBJECT, SESSION_WORDS } from '../content';
import { blur, flag, opacity, place, put, text, useEls, useFrame } from '../engine';
import { Cursor, Kinetic, Pill, Roller, TypeLabel } from '../parts';
import { clamp, ease, mix, pulse, seg } from '../timeline';

/** The right answer, the move to the next question, the wrong one, the rest of the session, its end. */
export const TAP_RIGHT = 1700;
/** A right answer moves on after a second (StudyRun AUTO_MS). */
const NEXT_AT = TAP_RIGHT + 1000;
export const TAP_WRONG = 3500;
/** The other 12 questions go by; the end screen opens. */
const FAST_AT = 4900;
const FAST_MS = 330;
export const END_AT = 5250;
const LEAVE = 7150;

export const SESSION_CURSOR = [
  { at: 1050, x: 1990, y: 1150 },
  { at: TAP_RIGHT - 120, x: 1250, y: 540 },
  { at: TAP_RIGHT + 500, x: 1275, y: 572 },
  { at: TAP_WRONG - 160, x: 1180, y: 440 },
  { at: TAP_WRONG + 600, x: 1205, y: 470 },
];

/** The figure at scene time `l`: 143, one more when the right answer counts, three more by the end. */
export function figureAt(l: number): number {
  const first = ease.inOut(seg(l, TAP_RIGHT + 280, 520));
  const rest = ease.inOut(seg(l, FAST_AT, 900));
  return FIGURE_BEFORE + (FIGURE_AFTER_FIRST - FIGURE_BEFORE) * first + (FIGURE_AFTER - FIGURE_AFTER_FIRST) * rest;
}

/** «Экономика · 7 из 20» at `l`: the two questions shown, then the rest of the session running by. */
export function questionAt(l: number): number {
  if (l < NEXT_AT + 150) return SESSION_QUESTIONS[0].n;
  if (l < FAST_AT) return SESSION_QUESTIONS[1].n;
  return Math.round(mix(SESSION_QUESTIONS[1].n + 1, SESSION_SIZE, clamp((l - FAST_AT) / FAST_MS)));
}

/**
 * 7 · Chapter 03, «Занятие». A «занятие» of «Экономика» as the app's room shows it: a tap is the answer and the key
 * from the file shows at once — right, and the figure on the left moves (an answer counts when it is right on a second
 * day); wrong, and the question comes back in a few questions and on the next study day. Then the end of the session in
 * its own words: the figure, the time, the mistakes, what is left today.
 */
export default function Session() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);

  useFrame((l) => {
    opacity(root.current, seg(l, 60, 260));
    const cam = one('cam');
    const enter = ease.brand(seg(l, 0, 440));
    const push = mix(1, 1.03, ease.sine(seg(l, 400, 6800)));
    const leave = ease.in(seg(l, LEAVE, 400));
    put(cam, 'transform', `translate3d(${(-120 * leave).toFixed(1)}px,0,0) scale(${(mix(1.1, 1, enter) * push).toFixed(4)})`);
    blur(cam, (1 - enter) * 12 + leave * 12);
    opacity(cam, seg(l, 0, 260) * (1 - leave));

    // The room swings in from the right in perspective, as the exam list did.
    const card = one('card');
    const swing = (at: number) => ease.brand(seg(at, 150, 1000));
    const p = swing(l);
    const speed = Math.abs(p - swing(l - 16)) * 520;
    const sway = Math.sin(l / 1400) * 0.7;
    put(
      card,
      'transform',
      `translate3d(${mix(560, 0, p).toFixed(1)}px,${mix(50, 0, p).toFixed(1)}px,0) rotateY(${(mix(-40, -7, p) + sway).toFixed(2)}deg) rotateX(${mix(8, 2, p).toFixed(2)}deg)`,
    );
    opacity(card, seg(l, 150, 220));
    blur(card, Math.min(12, speed * 0.5));

    // The room's line: «Экономика · 7 из 20».
    text(one('where'), SESSION_WORDS.bar(questionAt(l)));
    opacity(one('where'), l < END_AT ? 1 : 1 - seg(l, END_AT, 160));
    opacity(one('where-end'), seg(l, END_AT + 60, 200));
    // The end's way out is «Закрыть» (SessionEnd), the room's «Закончить».
    opacity(one('exit'), 1 - seg(l, END_AT, 160));
    opacity(one('exit-end'), seg(l, END_AT + 60, 200));

    // The two questions: the first leaves a second after its right answer, the second comes in.
    const swap = ease.inOut(seg(l, NEXT_AT, 360));
    const fast = ease.in(seg(l, FAST_AT, FAST_MS));
    const q0 = one('q0');
    const q1 = one('q1');
    place(q0, -90 * swap, 0);
    opacity(q0, 1 - swap);
    blur(q0, swap * 10);
    place(q1, mix(90, 0, swap) - 140 * fast, 0);
    opacity(q1, swap * (1 - fast));
    blur(q1, (1 - swap) * 10 + fast * 14);

    // Options answer in the app's words: «Верно», «В файле», «Ваш ответ».
    SESSION_QUESTIONS.forEach((question, qi) => {
      const tap = qi === 0 ? TAP_RIGHT : TAP_WRONG;
      const answered = l >= tap;
      all(`opt${qi}`).forEach((option, index) => {
        const isKey = index === question.key;
        const chosen = index === question.chosen;
        flag(option, 'is-file', answered && isKey);
        flag(option, 'is-wrong', answered && chosen && !isKey);
        const pressed = chosen ? pulse(l, tap - 60, 240) : 0;
        put(option, 'transform', `scale(${(1 - 0.015 * pressed).toFixed(4)})`);
      });
      all(`tag${qi}`).forEach((tag) => {
        const q = seg(l, tap + 40, 260);
        opacity(tag, q);
        put(tag, 'transform', `translate3d(0,${mix(6, 0, ease.brand(q)).toFixed(1)}px,0)`);
      });
    });

    // The bar under the question: the verdict and «Дальше».
    const right = one('v-right');
    const wrong = one('v-wrong');
    const vr = seg(l, TAP_RIGHT + 60, 260) * (1 - seg(l, NEXT_AT, 200));
    const vw = seg(l, TAP_WRONG + 60, 260) * (1 - seg(l, FAST_AT, 200));
    opacity(right, vr);
    opacity(wrong, vw);
    put(right, 'transform', `translate3d(0,${mix(10, 0, ease.brand(seg(l, TAP_RIGHT + 60, 300))).toFixed(1)}px,0)`);
    put(wrong, 'transform', `translate3d(0,${mix(10, 0, ease.brand(seg(l, TAP_WRONG + 60, 300))).toFixed(1)}px,0)`);
    opacity(one('next'), Math.max(vr, vw));

    // The end of the session.
    const end = one('end');
    const open = ease.brand(seg(l, END_AT, 700));
    put(end, 'transform', `translate3d(0,${mix(40, 0, open).toFixed(1)}px,0)`);
    opacity(end, seg(l, END_AT, 260));
    blur(end, (1 - open) * 10);
    all('end-p').forEach((line, index) => {
      const q = ease.brand(seg(l, END_AT + 350 + index * 160, 600));
      put(line, 'transform', `translate3d(0,${mix(18, 0, q).toFixed(1)}px,0)`);
      opacity(line, q);
    });
  });

  const [lead, marked, tail] = SESSION_WORDS.endHead;
  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <div data-a="cam" className="mr-layer">
        <div className="mr-abs" style={{ left: 154, top: 236 }}>
          <TypeLabel text="Занятие" at={250} />
        </div>
        <div className="mr-big">
          <Roller value={figureAt} digits={3} />
        </div>
        <div className="mr-big-of">
          <Kinetic text={SESSION_WORDS.figure.of} at={420} unit="letter" variant="drop" stagger={30} dur={620} />
        </div>
        <div className="mr-big-in">
          <Kinetic text={`${SESSION_WORDS.figure.label}.`} at={900} stagger={95} accentFrom={1} />
        </div>

        <div className="mr-persp">
          <div data-a="card" className="mr-card mr-s-card" style={{ opacity: 0 }}>
            <div className="mr-s-bar">
              <span className="mr-s-mark">
                Meldy
                <i />
              </span>
              <span className="mr-s-wh">
                <span data-a="where">{SESSION_WORDS.bar(SESSION_QUESTIONS[0].n)}</span>
                <span data-a="where-end" style={{ opacity: 0 }}>
                  {SESSION_SUBJECT}
                </span>
              </span>
              <span className="mr-s-exit">
                <span data-a="exit">{SESSION_WORDS.finish}</span>
                <span data-a="exit-end" style={{ opacity: 0 }}>
                  {SESSION_WORDS.close}
                </span>
              </span>
            </div>
            <div className="mr-s-body">
              {SESSION_QUESTIONS.map((question, qi) => (
                <div key={question.n} data-a={`q${qi}`} className="mr-s-q" style={qi === 1 ? { opacity: 0 } : undefined}>
                  <p className="mr-s-ctx">{SESSION_SUBJECT}</p>
                  <p className="mr-s-stem">{question.stem}</p>
                  <div className="mr-s-opts">
                    {question.options.map((option, index) => (
                      <div key={option} data-a={`opt${qi}`} className="mr-s-opt">
                        <span className="mr-s-l">{SESSION_WORDS.letters[index]}</span>
                        <span className="mr-s-t">
                          {option}
                          {index === question.key || index === question.chosen ? (
                            <span data-a={`tag${qi}`} className="mr-s-tag" style={{ opacity: 0 }}>
                              {index === question.key
                                ? index === question.chosen
                                  ? SESSION_WORDS.tagRight
                                  : SESSION_WORDS.tagFile
                                : SESSION_WORDS.tagYours}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="mr-s-verdict">
                <p data-a="v-right" className="mr-s-v mr-s-v--right" style={{ opacity: 0 }}>
                  {SESSION_WORDS.right}
                </p>
                <p data-a="v-wrong" className="mr-s-v" style={{ opacity: 0 }}>
                  {SESSION_WORDS.wrong}
                </p>
                <span data-a="next" className="mr-s-next" style={{ opacity: 0 }}>
                  <Pill>{SESSION_WORDS.next}</Pill>
                </span>
              </div>

              <div data-a="end" className="mr-s-end" style={{ opacity: 0 }}>
                <p className="mr-s-end-h">
                  {lead}
                  {marked}
                  {tail}
                </p>
                <p data-a="end-p" className="mr-s-end-p">
                  {SESSION_WORDS.endText}
                </p>
                <p data-a="end-p" className="mr-s-end-next">
                  {SESSION_WORDS.endLeft}
                </p>
                <div data-a="end-p" className="mr-s-end-acts">
                  <span className="mr-s-done">{SESSION_WORDS.done}</span>
                  <Pill>{SESSION_WORDS.endMore}</Pill>
                </div>
              </div>
            </div>
          </div>
        </div>
        <Cursor keys={SESSION_CURSOR} clicks={[TAP_RIGHT, TAP_WRONG]} from={1050} to={TAP_WRONG + 700} />
      </div>
    </div>
  );
}
