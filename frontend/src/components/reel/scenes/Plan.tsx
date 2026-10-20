import { useRef } from 'react';
import { PLAN_DAYS, PLAN_TODAY, PLAN_WORDS } from '../content';
import { blur, opacity, put, useEls, useFrame } from '../engine';
import { Cursor, Kinetic, Pill, TypeLabel } from '../parts';
import { ease, mix, pulse, seg } from '../timeline';

/** A day's tile and the step between tiles (stage px). */
export const TILE = { width: 200, gap: 16 } as const;
const STEP = TILE.width + TILE.gap;
/** The strip's visible width: from the label's margin to the stage's right margin. */
const VIEW = 1920 - 150 - 150;
/** The strip runs from today to the exam, then back to today. */
const PAN_AT = 1750;
const PAN_MS = 1700;
const BACK_AT = 4250;
const BACK_MS = 650;
/** How far the strip moves to show the exam's tile at the right edge. */
export const PAN = PLAN_DAYS.length * STEP - TILE.gap - VIEW;
/** «Начать» is pressed: the «занятие» opens. */
export const START_AT = 5650;
const LEAVE = 5780;

export const PLAN_CURSOR = [
  { at: 4500, x: 1990, y: 1150 },
  { at: START_AT - 380, x: 1440, y: 868 },
  { at: START_AT + 300, x: 1456, y: 880 },
];

/** The strip's offset at `l`: still, to the exam, held, back to today. */
export function stripAt(l: number): number {
  const out = ease.inOut(seg(l, PAN_AT, PAN_MS));
  const back = ease.inOut(seg(l, BACK_AT, BACK_MS));
  return PAN * out * (1 - back);
}

/**
 * 6 · Chapter 02, «План». The days from today to the exam's date as a strip of the plan's days: each day its questions
 * and «около 45 минут», a Sunday off (not one of the study days), the final days with only the known questions, the
 * exam. The strip runs to the exam and back to today; today's card says the day in the plan's words, and «Начать».
 */
export default function Plan() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);

  useFrame((l) => {
    opacity(root.current, seg(l, 60, 260));
    const cam = one('cam');
    const enter = ease.brand(seg(l, 0, 440));
    const push = mix(1, 1.025, ease.sine(seg(l, 400, 5400)));
    const leave = ease.in(seg(l, LEAVE, 380));
    put(cam, 'transform', `scale(${(mix(1.1, 1, enter) * push * mix(1, 1.12, leave)).toFixed(4)})`);
    blur(cam, (1 - enter) * 12 + leave * 14);
    opacity(cam, seg(l, 0, 260) * (1 - seg(l, LEAVE + 60, 220)));

    // The strip: tiles rise in, then it runs to the exam's date and back, blurred while it is fast.
    const x = stripAt(l);
    const speed = Math.abs(x - stripAt(l - 16));
    const strip = one('strip');
    put(strip, 'transform', `translate3d(${(-x).toFixed(1)}px,0,0)`);
    blur(strip, Math.min(6, speed * 0.16));
    all('tile').forEach((tile, index) => {
      const p = ease.brand(seg(l, 200 + Math.min(index, 9) * 45, 640));
      put(tile, 'transform', `translate3d(0,${mix(60, 0, p).toFixed(1)}px,0)`);
      opacity(tile, p);
    });

    // Today's card: the plan in its own words.
    const card = one('card');
    const rise = ease.brand(seg(l, 520, 700));
    put(card, 'transform', `translate3d(0,${mix(50, 0, rise).toFixed(1)}px,0)`);
    opacity(card, rise);
    blur(card, (1 - rise) * 10);

    const days = one('days');
    const daysIn = ease.brand(seg(l, 700, 600));
    put(days, 'transform', `translate3d(0,${mix(16, 0, daysIn).toFixed(1)}px,0)`);
    opacity(days, daysIn);

    const pill = one('pill');
    const press = pulse(l, START_AT - 60, 260);
    put(pill, 'transform', `scale(${(1 - 0.05 * press).toFixed(3)})`);
    put(one('pill-dot'), 'transform', `translate3d(${(6 * ease.brand(seg(l, START_AT - 320, 300))).toFixed(2)}px,0,0)`);
  });

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <div data-a="cam" className="mr-layer">
        <div className="mr-label-at">
          <TypeLabel text="План" at={160} />
        </div>
        <h3 className="mr-display mr-head">
          <Kinetic text={PLAN_WORDS.head} at={260} unit="letter" variant="drop" stagger={22} dur={620} accentFrom={2} />
        </h3>

        <div className="mr-p-view">
          <div data-a="strip" className="mr-p-strip">
            {PLAN_DAYS.map((day, index) => (
              <div
                key={day.day}
                data-a="tile"
                className={`mr-p-tile mr-p-tile--${day.day === PLAN_TODAY ? 'today' : day.kind}`}
                style={{ left: index * STEP, opacity: 0 }}
              >
                <span className="mr-p-wd">{day.day === PLAN_TODAY ? 'Сегодня' : PLAN_WORDS.weekday(day.day)}</span>
                <span className="mr-p-date">{PLAN_WORDS.date(day.day)}</span>
                {day.kind === 'off' ? <span className="mr-p-off">{PLAN_WORDS.off}</span> : null}
                {day.kind === 'exam' ? <span className="mr-p-exam">{PLAN_WORDS.exam}</span> : null}
                {day.questions > 0 ? (
                  <>
                    <b className="mr-p-n">{day.questions}</b>
                    <span className="mr-p-q">{PLAN_WORDS.questionsWord(day.questions)}</span>
                    <span className="mr-p-min">{day.kind === 'window' ? PLAN_WORDS.window : PLAN_WORDS.minutes45}</span>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <p data-a="days" className="mr-p-days" style={{ opacity: 0 }}>
          {PLAN_WORDS.studyDays} · {PLAN_WORDS.minutes}
        </p>

        <div data-a="card" className="mr-card mr-p-card" style={{ opacity: 0 }}>
          <div className="mr-p-card-t">
            <b className="mr-p-title">{PLAN_WORDS.title}</b>
            <p className="mr-p-card-sub">
              {PLAN_WORDS.detail}
              <span className="mr-p-link">{PLAN_WORDS.byDays}</span>
            </p>
          </div>
          <Pill name="pill">{PLAN_WORDS.start}</Pill>
        </div>
        <Cursor keys={PLAN_CURSOR} clicks={[START_AT]} from={4500} to={START_AT + 420} />
      </div>
    </div>
  );
}
