import { useMemo, useRef } from 'react';
import { TICKET } from '../content';
import { blur, flag, opacity, place, put, text, useEls, useFrame } from '../engine';
import { drawBurst, makeBurst } from '../particles';
import { Cursor, Kinetic, ParticleCanvas, Pill, TypeLabel } from '../parts';
import { clamp, ease, mix, pulse, rng, seg } from '../timeline';

const WORDS = TICKET.answer.split(' ');
const WORD_MS = 56;
const SPEAK_AT = 900;
const wordAt = (index: number) => SPEAK_AT + index * WORD_MS;
const SPOKEN_UNTIL = wordAt(WORDS.length - 1) + 380;

const DONE = 2750;
const ASK_AT = 3000;
const ASK_CPS = 64;
const ASK_END = ASK_AT + (TICKET.examiner.length / ASK_CPS) * 1000;
const REPLY = TICKET.reply.split(' ');
const REPLY_AT = ASK_END + 180;
const REPLY_MS = 95;
const replyAt = (index: number) => REPLY_AT + index * REPLY_MS;
const CLOSED_AT = replyAt(REPLY.length - 1) + 380;
const STAMP = CLOSED_AT + 200;
/** The next scene starts here and takes the missed point away. */
const HANDOFF = 5800;

/** When each point of the answer sheet is named. */
const NAMED_AT = TICKET.points.map((_, index) =>
  index === TICKET.missed ? CLOSED_AT : wordAt(TICKET.namedAfterWord[index]) + 200,
);

const WAVE = Array.from({ length: 22 }, (_, index) => index);

export const ORAL_CURSOR = [
  { at: 2250, x: 1990, y: 1120 },
  { at: 2680, x: 1104, y: 926 },
  { at: 3050, x: 1170, y: 990 },
];

/**
 * 6 · Chapter 02, «Ответ вслух». The student answers the ticket aloud: words appear as they are
 * said, the points of the answer sheet are ticked, the examiner asks about the missed one, and the
 * answer is stamped «Засчитано».
 */
export default function Oral() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const confetti = useMemo(() => makeBurst(61, { count: 34, colors: ['#3F9A5A', '#8ACB97', '#F4C45B', '#2869DD'], near: 120, far: 330, dashes: 0.7, size: [2.5, 5] }), []);
  const waveSeed = useMemo(() => {
    const random = rng(62);
    return WAVE.map(() => ({ a: random() * 6, b: 0.004 + random() * 0.006, c: random() * 6 }));
  }, []);

  useFrame((l) => {
    opacity(root.current, seg(l, 100, 280));
    const cam = one('cam');
    const enter = ease.brand(seg(l, 60, 440));
    const leave = ease.in(seg(l, HANDOFF - 20, 340));
    const push = mix(1, 1.025, ease.sine(seg(l, 400, 5400)));
    put(cam, 'transform', `translate3d(${(-120 * leave).toFixed(1)}px,0,0) scale(${(mix(1.1, 1, enter) * push).toFixed(4)})`);
    blur(cam, (1 - enter) * 12 + leave * 12);
    opacity(cam, seg(l, 0, 260) * (1 - leave));

    // The answer, word by word: grey while it is being recognised, ink once it is settled.
    all('w').forEach((word, index) => {
      const shown = l >= wordAt(index);
      opacity(word, shown ? clamp((l - wordAt(index)) / 90) : 0);
      flag(word, 'is-interim', shown && l < wordAt(index) + 380);
      flag(word, 'is-last', shown && l < SPOKEN_UNTIL && (index === WORDS.length - 1 || l < wordAt(index + 1)));
    });

    // The microphone listens until «Готово».
    const listening = l >= SPEAK_AT - 200 && l < DONE;
    all('ring').forEach((ring, index) => {
      const cycle = ((l + index * 600) % 1200) / 1200;
      put(ring, 'transform', `scale(${(1 + cycle * 0.9).toFixed(3)})`);
      opacity(ring, listening ? (1 - cycle) * 0.6 : 0);
    });
    all('bar').forEach((bar, index) => {
      const seed = waveSeed[index];
      const level = listening ? 0.25 + 0.75 * Math.abs(Math.sin(l * seed.b + seed.a) * Math.cos(l * seed.b * 0.7 + seed.c)) : 0.12;
      put(bar, 'transform', `scaleY(${level.toFixed(3)})`);
    });

    // «Готово» is pressed, then the examiner asks about the missed point.
    const done = one('done');
    const press = pulse(l, DONE - 60, 260);
    put(done, 'transform', `scale(${(1 - 0.05 * press).toFixed(3)})`);
    opacity(done, ease.brand(seg(l, 1400, 400)) * (1 - seg(l, DONE + 150, 200)));

    const exam = one('exam');
    const ask = ease.brand(seg(l, ASK_AT - 140, 420));
    put(exam, 'transform', `translate3d(0,${mix(40, 0, ask).toFixed(1)}px,0)`);
    opacity(exam, ask);
    const typed = clamp(Math.floor(((l - ASK_AT) * ASK_CPS) / 1000), 0, TICKET.examiner.length);
    text(one('ask'), TICKET.examiner.slice(0, typed));
    all('r').forEach((word, index) => {
      opacity(word, clamp((l - replyAt(index)) / 90));
      flag(word, 'is-interim', l >= replyAt(index) && l < replyAt(index) + 380);
    });

    // The answer sheet: points are ticked as they are named; the missed one is flagged, then closed.
    const greens = all('fg');
    const checks = all('ck');
    TICKET.points.forEach((_, index) => {
      const named = NAMED_AT[index];
      const fill = greens[index];
      const check = checks[index];
      put(fill, 'transform', `scaleX(${ease.brand(seg(l, named, 520)).toFixed(4)})`);
      const tick = seg(l, named + 60, 300);
      put(check, 'transform', `scale(${(tick <= 0 ? 0 : ease.back(tick)).toFixed(3)})`);
      opacity(check, clamp(tick * 4));
    });
    const missed = all('point')[TICKET.missed];
    if (missed) {
      const yellow = one('fy');
      const flagEl = one('flag');
      const raised = ease.brand(seg(l, DONE + 180, 520));
      put(yellow, 'transform', `scaleX(${raised.toFixed(4)})`);
      opacity(yellow, 1 - seg(l, CLOSED_AT, 300));
      const wave = seg(l, DONE + 240, 360);
      put(flagEl, 'transform', `translate3d(${mix(30, 0, ease.back(wave)).toFixed(1)}px,0,0)`);
      opacity(flagEl, clamp(wave * 3) * (1 - seg(l, CLOSED_AT, 200)));
      // Hand-over: from here the flying card of the next scene carries this point.
      opacity(missed, l >= HANDOFF ? 0 : 1);
    }

    // The stamp falls on the protocol and the card shakes under it.
    const stamp = one('stamp');
    const fall = seg(l, STAMP, 170);
    const settle = pulse(l, STAMP + 170, 240);
    put(stamp, 'transform', `rotate(-9deg) scale(${(mix(2.7, 1, ease.in(fall)) * (1 + 0.05 * settle)).toFixed(3)})`);
    opacity(stamp, clamp(fall * 2.5));
    const shake = seg(l, STAMP + 170, 300);
    const main = one('main');
    place(main, shake > 0 && shake < 1 ? Math.sin(shake * 42) * 7 * (1 - shake) : 0, 0);
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawBurst(ctx, confetti, 960, 640, l - STAMP - 170, 900);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <div data-a="cam" className="mr-layer">
        <div className="mr-label-at">
          <TypeLabel text="Ответ вслух" at={240} />
        </div>
        <h3 className="mr-display mr-head">
          <Kinetic text="Отвечай вслух, как на экзамене." at={380} unit="letter" variant="drop" stagger={19} dur={620} accentFrom={2} />
        </h3>

        <div data-a="main" className="mr-card mr-oral-main">
          <div className="mr-oral-top">
            <span className="mr-ticket-tag">{TICKET.name}</span>
            <span className="mr-oral-sub">{TICKET.subject}</span>
            <span className="mr-wave" style={{ marginLeft: 'auto' }}>
              {WAVE.map((index) => (
                <i key={index} data-a="bar" />
              ))}
            </span>
            <span className="mr-mic" style={{ marginLeft: 0 }}>
              <span data-a="ring" className="mr-mic-ring" />
              <span data-a="ring" className="mr-mic-ring" />
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="8.5" y="3" width="7" height="12" rx="3.5" fill="currentColor" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          <div className="mr-oral-q">{TICKET.question}</div>
          <div className="mr-oral-said">
            {WORDS.map((word, index) => (
              <span key={index} data-a="w" className="mr-said-w">
                {word}
              </span>
            ))}
          </div>
          <div data-a="exam" className="mr-exam">
            <span className="mr-exam-ava">Э</span>
            <div>
              <b>Экзаменатор</b>
              <p data-a="ask" />
              <span className="mr-reply">
                <span className="mr-reply-who">Ты</span>
                {REPLY.map((word, index) => (
                  <span key={index} data-a="r" className="mr-said-w">
                    {word}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="mr-done">
            <Pill name="done" tone="ink">
              Готово
            </Pill>
          </div>
        </div>

        <div className="mr-card mr-points">
          <div className="mr-points-h">Пункты ответа</div>
          {TICKET.points.map((point, index) => (
            <div key={point} data-a="point" className="mr-point">
              {index === TICKET.missed ? <span data-a="fy" className="mr-point-fill mr-point-fill--y" style={{ transform: 'scaleX(0)' }} /> : null}
              <span data-a="fg" className="mr-point-fill" style={{ transform: 'scaleX(0)' }} />
              <span className="mr-num">{index + 1}</span>
              <span className="mr-point-t">{point}</span>
              <span data-a="ck" className="mr-check" style={{ opacity: 0 }}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {index === TICKET.missed ? (
                <span data-a="flag" className="mr-flag mr-flag--y" style={{ opacity: 0 }}>
                  не назван
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <div data-a="stamp" className="mr-stamp" style={{ left: 790, top: 588 }}>
          Засчитано
        </div>
        <ParticleCanvas draw={draw} />
        <Cursor keys={ORAL_CURSOR} clicks={[DONE]} from={2250} to={3250} />
      </div>
    </div>
  );
}
