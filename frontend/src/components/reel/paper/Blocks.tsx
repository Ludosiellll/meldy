/**
 * The blocks on the sheet, each in its place (layout.ts) and each moved only by the reel's clock:
 * the department's list (typed), the focus column (the lecture slip, the points written by hand, the
 * dates, the ticket, the answer typed word by word with the voice wave, the editor's count) and the
 * copy the group receives. Ink lines are the cheat sheet's own (film/ink, film/StageSheet's paintLine).
 */
import { useRef } from 'react';
import { paintLine } from '../../film/StageSheet';
import { inkAt, type InkLine, type InkStep } from '../../film/ink';
import { SheetText } from '../../exams/sheet/SheetText';
import { PencilUnder, seedFrom } from '../../marks';
import { opacity, put, text as setText, useFrame } from '../engine';
import { clamp, ease, seg } from '../timeline';
import * as C from '../content';
import { COPY, CLUSTER, LIST } from './layout';
import { SCHEDULE as S } from './schedule';
import { fadeIn, glideIn } from './motion';

// ---------------------------------------------------------------------------------------------
// The department's list: the heading and the rows, typed one after another.

const typedPart = (text: string, l: number, at: number, dur: number) => text.slice(0, Math.floor(clamp((l - at) / dur) * text.length));

export function ListBlock() {
  const head = useRef<HTMLParagraphElement>(null);
  const rows = useRef<Array<HTMLParagraphElement | null>>([]);
  useFrame((l) => {
    setText(head.current, typedPart(C.LIST_TITLE, l, S.head.at, S.head.dur));
    C.LIST.forEach((item, index) => {
      const at = S.rows.at + index * S.rows.step;
      setText(rows.current[index], typedPart(`${item.number}. ${item.text}`, l, at, S.rows.dur));
    });
  });
  return (
    <div className="pp-list" style={{ left: LIST.x, top: LIST.titleY }}>
      <p ref={head} className="pp-title" />
      {C.LIST.map((item, index) => (
        <p
          key={item.number}
          ref={(el) => {
            rows.current[index] = el;
          }}
          className="pp-row"
          style={{ top: LIST.rowY0 - LIST.titleY + index * LIST.pitch }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The focus column.

const DAY_WRITE = 450;

/** The answer dates, written in the sheet's corner; each one replaces the one before it. */
function Dates() {
  const refs = useRef<Array<HTMLParagraphElement | null>>([]);
  useFrame((l) => {
    S.dates.forEach((date, index) => {
      const el = refs.current[index];
      const write = ease.inOut(seg(l, date.at, DAY_WRITE));
      const gone = date.until === undefined ? 0 : ease.inOut(seg(l, date.until, 260));
      put(el, 'clip-path', `inset(-40% ${((1 - write) * 100).toFixed(2)}% -40% 0)`);
      opacity(el, (l >= date.at ? 1 : 0) * (1 - gone));
    });
  });
  return (
    <div className="pp-dates">
      {S.dates.map((date, index) => (
        <p
          key={date.at}
          ref={(el) => {
            refs.current[index] = el;
          }}
          className="pp-date"
          style={{ left: CLUSTER.dates.x, top: CLUSTER.dates.y, opacity: 0 }}
        >
          {date.text}
        </p>
      ))}
    </div>
  );
}

/** The ink of each point: the first answer rubs the point it names, the rest are missed, one is erased and returns. */
const POINT_STEPS: Record<number, readonly InkStep[]> = {
  0: [
    { at: S.rub, to: 'rubbed' },
    { at: S.erase, to: 'erased' },
    { at: S.returnAt, to: 'returned', note: C.NOTES.returned },
  ],
  1: [{ at: S.missB, to: 'missed', note: C.NOTES.notNamed }],
  2: [{ at: S.lateMiss, to: 'missed', note: C.NOTES.afterQuestion }],
  3: [{ at: S.missD, to: 'missed', note: C.NOTES.notNamed }],
};

/** The cheat sheet's four lines of the focus question, as the ink engine draws them (exported for the tests). */
export const POINT_LINES: readonly InkLine[] = C.POINTS.map((point, index) => ({
  text: point.short,
  essential: point.essential,
  from: 'fresh',
  steps: POINT_STEPS[index],
}));

const pointKey = (index: number) => `pp:point:${index}`;

/** The points written under the question by hand, one pen stroke each; then they change with the answers. */
function Points() {
  const lines = useRef<Array<HTMLDivElement | null>>([]);
  const inks = useRef<Array<HTMLSpanElement | null>>([]);
  const bullets = useRef<Array<HTMLSpanElement | null>>([]);
  const patches = useRef<Array<HTMLSpanElement | null>>([]);
  const notes = useRef<Array<HTMLSpanElement | null>>([]);
  const tips = useRef<Array<HTMLSpanElement | null>>([]);
  useFrame((l) => {
    POINT_LINES.forEach((line, index) => {
      const writeAt = S.points.writeAt[index];
      const write = clamp((l - writeAt) / S.points.writeDur);
      const el = lines.current[index] ?? undefined;
      put(el, 'visibility', l < writeAt ? 'hidden' : 'visible');
      paintLine(inkAt(line, l), {
        line: el,
        ink: inks.current[index] ?? undefined,
        bullet: bullets.current[index] ?? undefined,
        patch: patches.current[index] ?? undefined,
        note: notes.current[index] ?? undefined,
      });
      put(inks.current[index], 'clip-path', write >= 1 ? 'none' : `inset(-40% ${((1 - write) * 100).toFixed(2)}% -40% 0)`);
      put(tips.current[index], 'left', `${(write * 100).toFixed(2)}%`);
      opacity(tips.current[index], write > 0 && write < 1 ? 1 : 0);
    });
  });
  return (
    <div className="pp-lines">
      {POINT_LINES.map((line, index) => (
        <div
          key={pointKey(index)}
          ref={(el) => {
            lines.current[index] = el;
          }}
          className="pp-line"
          style={{ left: CLUSTER.points.x, top: CLUSTER.points.y0 + index * CLUSTER.points.pitch, visibility: 'hidden' }}
        >
          <span
            ref={(el) => {
              bullets.current[index] = el;
            }}
            className="pp-bullet"
          >
            {line.essential ? '•' : '–'}
          </span>
          <span className="pp-body">
            <span
              ref={(el) => {
                patches.current[index] = el;
              }}
              className="ss-patch"
              style={{ opacity: 0 }}
            />
            <span
              ref={(el) => {
                inks.current[index] = el;
              }}
              className="ss-ink pp-ink"
            >
              <PencilUnder seed={seedFrom(pointKey(index), 'wave')} hand="graphite" kind="wave" weight={1.8} dy={-1} watch={line.text}>
                <SheetText text={line.text} seedBase={pointKey(index)} />
              </PencilUnder>
            </span>
            <span
              ref={(el) => {
                tips.current[index] = el;
              }}
              className="pp-tip"
              style={{ opacity: 0 }}
            />
          </span>
          <span
            ref={(el) => {
              notes.current[index] = el;
            }}
            className="pp-note"
            style={{ opacity: 0 }}
          />
        </div>
      ))}
    </div>
  );
}

/** The lecture slip pinned beside the question: its quote, the editor's hint, and the questions no lecture fits. */
function Slip() {
  const card = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLParagraphElement>(null);
  useFrame((l) => {
    glideIn(card.current, l, S.slip.at, { dy: 26, dur: 760, smear: 10 });
    fadeIn(hint.current, l, S.hint.at, 500);
    fadeIn(lead.current, l, S.lead.at, 700);
  });
  return (
    <>
      <div ref={card} className="pp-slip" style={{ left: CLUSTER.slip.x, top: CLUSTER.slip.y, width: CLUSTER.slip.w, opacity: 0 }}>
        <p className="pp-slip-cap">{C.SLIP.caption}</p>
        <p className="pp-slip-quote">«{C.SLIP.quote}»</p>
        <div ref={hint} className="pp-slip-hint" style={{ opacity: 0 }}>
          <span>{C.FIT_HINT}</span>
          <span className="pp-pill">{C.FIT_BUTTON}</span>
        </div>
      </div>
      <p ref={lead} className="pp-lead" style={{ left: CLUSTER.lead.x, top: CLUSTER.lead.y, opacity: 0 }}>
        {C.UNMATCHED_LINE}
      </p>
    </>
  );
}

/** The ticket lies on the sheet beside the points. */
function Ticket() {
  const card = useRef<HTMLDivElement>(null);
  useFrame((l) => glideIn(card.current, l, S.ticket.at, { dx: 90, dur: 720, smear: 14 }));
  return (
    <div ref={card} className="pp-ticket" style={{ left: CLUSTER.ticket.x, top: CLUSTER.ticket.y, width: CLUSTER.ticket.w, opacity: 0 }}>
      <p className="pp-ticket-l">{C.TICKET.label}</p>
      <p className="pp-ticket-q">{`${C.FOCUS_NUMBER}. ${C.FOCUS_TEXT}`}</p>
    </div>
  );
}

const TOKENS = C.TICKET.turns.map((turn) => turn.text.split(' '));
const TURN_END = C.TICKET.turns.map((turn, index) => turn.at + TOKENS[index].length * turn.wordMs);
const BARS = 30;

/**
 * The answer as a live transcript: each word appears at its moment (content.ts wordAt), turn after turn,
 * under its speaker's label; the voice wave beside the label moves while the student speaks.
 */
function Talk() {
  const box = useRef<HTMLDivElement>(null);
  const who = useRef<HTMLParagraphElement>(null);
  const words = useRef<HTMLParagraphElement>(null);
  const wave = useRef<HTMLSpanElement>(null);
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  useFrame((l) => {
    let active = -1;
    C.TICKET.turns.forEach((turn, index) => {
      if (l >= turn.at) active = index;
    });
    const fade = 1 - ease.inOut(seg(l, S.talkOut.at, S.talkOut.dur));
    opacity(box.current, (active >= 0 ? 1 : 0) * fade);
    opacity(wave.current, ease.inOut(seg(l, S.wave.from, 400)) * (1 - ease.inOut(seg(l, S.wave.to, 400))));
    let level = 0;
    C.TICKET.turns.forEach((turn, index) => {
      if (turn.speaker !== 'student') return;
      const on = Math.min(ease.inOut(seg(l, turn.at, 220)), 1 - ease.inOut(seg(l, TURN_END[index], 260)));
      level = Math.max(level, on);
    });
    for (let i = 0; i < BARS; i += 1) {
      const phase = l / 85 + i * 1.3;
      const swing = Math.abs(Math.sin(phase) * Math.cos(phase * 0.43 + i * 0.7));
      put(bars.current[i], 'transform', `scaleY(${(0.16 + level * (0.2 + 0.8 * swing)).toFixed(3)})`);
    }
    if (active < 0) return;
    const turn = C.TICKET.turns[active];
    const shown = Math.min(TOKENS[active].length, Math.floor((l - turn.at) / turn.wordMs) + 1);
    setText(words.current, TOKENS[active].slice(0, shown).join(' '));
    setText(who.current, turn.speaker === 'examiner' ? C.TICKET.examinerLabel : C.TICKET.voiceLabel);
  });
  return (
    <div ref={box} className="pp-talk" style={{ left: CLUSTER.talk.x, top: CLUSTER.talk.y, width: CLUSTER.talk.w, opacity: 0 }}>
      <div className="pp-talk-head">
        <p ref={who} className="pp-talk-who" />
        <span ref={wave} className="pp-wave-bars" style={{ opacity: 0 }}>
          {Array.from({ length: BARS }, (_, index) => (
            <i
              key={index}
              ref={(el) => {
                bars.current[index] = el;
              }}
            />
          ))}
        </span>
      </div>
      <p ref={words} className="pp-talk-words" />
    </div>
  );
}

/** The editor's count of the answer and its fine print, once the answer is given. */
function Count() {
  const el = useRef<HTMLParagraphElement>(null);
  useFrame((l) => opacity(el.current, ease.inOut(seg(l, S.count.at, S.count.dur)) * (1 - ease.inOut(seg(l, S.count.out, S.count.dur)))));
  return (
    <p ref={el} className="pp-count" style={{ left: CLUSTER.count.x, top: CLUSTER.count.y, opacity: 0 }}>
      <b>{C.TICKET.countHead}</b>
      <b>{C.TICKET.countTail}</b>
      <span>{C.TICKET.countFine}</span>
    </p>
  );
}

export function ClusterBlock() {
  return (
    <>
      <p className="pp-focus" style={{ left: CLUSTER.x, top: CLUSTER.focusY }}>
        {`${C.FOCUS_NUMBER}. ${C.FOCUS_TEXT}`}
      </p>
      <Dates />
      <Points />
      <Slip />
      <Ticket />
      <Talk />
      <Count />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The copy: the sheet duplicates, the copy slides to the classmate's label; the day's card and the reminder.

/** The copy's own box, at the focus column's place less a margin; its lines sit where the originals do. */
const COPY_BOX = { x: CLUSTER.x - 40, y: CLUSTER.focusY - 60 };

export function CopyBlock() {
  const sheet = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLParagraphElement>(null);
  const day = useRef<HTMLDivElement>(null);
  const remind = useRef<HTMLDivElement>(null);
  useFrame((l) => {
    const slide = ease.inOut(clamp((l - S.copy.slide) / S.copy.slideDur));
    put(sheet.current, 'transform', `translate3d(${(slide * (COPY.x - CLUSTER.x)).toFixed(1)}px,0,0)`);
    fadeIn(sheet.current, l, S.copy.appear, 350);
    fadeIn(label.current, l, S.copy.label, 500);
    fadeIn(day.current, l, S.copy.day, 500);
    fadeIn(remind.current, l, S.copy.remind, 500);
  });
  return (
    <>
      <div ref={sheet} className="pp-copy" style={{ left: COPY_BOX.x, top: COPY_BOX.y, opacity: 0 }}>
        <p className="pp-copy-q" style={{ left: CLUSTER.x - COPY_BOX.x, top: CLUSTER.focusY - COPY_BOX.y }}>
          {`${C.FOCUS_NUMBER}. ${C.FOCUS_TEXT}`}
        </p>
        {C.POINTS.map((point, index) => (
          <p
            key={point.short}
            className="pp-copy-l"
            style={{ left: CLUSTER.points.x - COPY_BOX.x, top: CLUSTER.points.y0 - COPY_BOX.y + index * CLUSTER.points.pitch }}
          >
            <span className="pp-bullet">{point.essential ? '•' : '–'}</span>
            {point.short}
          </p>
        ))}
      </div>
      <p ref={label} className="pp-copy-label" style={{ left: COPY.label.x, top: COPY.label.y, opacity: 0 }}>
        {C.GROUP.copyLabel}
      </p>
      <div ref={day} className="pp-day" style={{ left: COPY.day.x, top: COPY.day.y, width: COPY.day.w, opacity: 0 }}>
        <p className="pp-day-l">{C.GROUP.questionOfDay}</p>
        <p className="pp-day-q">{`${C.FOCUS_NUMBER}. ${C.FOCUS_TEXT}`}</p>
      </div>
      <div ref={remind} className="pp-remind" style={{ left: COPY.remind.x, top: COPY.remind.y, opacity: 0 }}>
        <span className="pp-pill">{C.GROUP.remind}</span>
        <p>{C.GROUP.reminderTime}</p>
      </div>
    </>
  );
}
