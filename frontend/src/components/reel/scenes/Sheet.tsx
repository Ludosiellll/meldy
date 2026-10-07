import { useRef } from 'react';
import { SHEET_WORDS, TICKET } from '../content';
import { blur, opacity, put, useEls, useFrame } from '../engine';
import { Kinetic, TypeLabel } from '../parts';
import { SheetCaption } from '../../film/StageSheet';
import { ease, mix, seg } from '../timeline';
import { PAPER_AT, TicketPaper, afterAnswer } from './ticketSheet';

/** The answer of chapter 02 on the sheet: the named points, then the one asked about. */
const RUB_AT = 1150;
const MISSED_AT = 1900;
export const SHEET_LINES = afterAnswer(RUB_AT, MISSED_AT);
const DATES = [{ at: -1, text: '7 окт.' }];
export const SHEET_CAPTION = [{ at: 2650, text: SHEET_WORDS.first }];
/** From here the words and the examiner leave; the paper and its caption stay where chapter 04 takes them. */
export const SHEET_LEAVE = 3150;

/**
 * 7 · Chapter 03, «Шпаргалка». The examiner's follow-up of the oral chapter stays on the left; on
 * the ticket's cheat sheet the four points named in the answer rub half-way, and the one named only
 * after the examiner's question stays, with the pencil wave. Only answers move a line.
 */
export default function Sheet() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    opacity(one('bg'), seg(l, 100, 260));
    // The words and the examiner leave; the paper and what the answer did stay for chapter 04.
    const leave = ease.in(seg(l, SHEET_LEAVE, 340));
    const head = one('head');
    put(head, 'transform', `translate3d(0,${(-26 * leave).toFixed(1)}px,0)`);
    blur(head, leave * 14);
    opacity(head, 1 - leave);

    // The follow-up comes in from where the oral chapter left it; the paper swings in from the right.
    const ask = one('ask');
    const askIn = ease.brand(seg(l, 150, 700));
    put(ask, 'transform', `translate3d(${mix(-90, 0, askIn).toFixed(1)}px,${(-26 * leave).toFixed(1)}px,0)`);
    blur(ask, (1 - askIn) * 12 + leave * 14);
    opacity(ask, Math.min(seg(l, 150, 260), 1 - leave));

    const paper = one('paper');
    const swing = ease.brand(seg(l, 250, 900));
    put(paper, 'transform', swing >= 1 ? 'none' : `perspective(2200px) translate3d(${mix(380, 0, swing).toFixed(1)}px,${mix(30, 0, swing).toFixed(1)}px,0) rotateY(${mix(-24, 0, swing).toFixed(2)}deg)`);
    blur(paper, (1 - swing) * 14);
    opacity(paper, seg(l, 250, 240));
  });

  return (
    <div ref={root} className="mr-scene">
      <div data-a="bg" className="mr-layer mr-bg-light" style={{ opacity: 0 }} />
      <div data-a="head" className="mr-layer">
        <div className="mr-label-at">
          <TypeLabel text="Шпаргалка" at={320} />
        </div>
        <h3 className="mr-display mr-head">
          <Kinetic text="Строки стирают только ответы." at={460} unit="letter" variant="drop" stagger={19} dur={620} accentFrom={2} />
        </h3>
      </div>
      <div data-a="ask" className="mr-card mr-sh-ask" style={{ opacity: 0 }}>
        <div className="mr-sh-ask-who">
          <span className="mr-exam-ava">Э</span>
          <b>Экзаменатор</b>
        </div>
        <p className="mr-sh-ask-q">{TICKET.examiner}</p>
        <p className="mr-sh-ask-a">
          <span className="mr-reply-who">Вы</span>
          {TICKET.reply}
        </p>
      </div>
      <div data-a="paper" className="mr-sh-paper" style={{ left: PAPER_AT.left, top: PAPER_AT.top, opacity: 0 }}>
        <TicketPaper lines={SHEET_LINES} dates={DATES} />
      </div>
      <div data-a="cap" className="mr-sh-cap" style={{ left: PAPER_AT.left }}>
        <SheetCaption items={SHEET_CAPTION} className="mr-chip" />
      </div>
    </div>
  );
}
