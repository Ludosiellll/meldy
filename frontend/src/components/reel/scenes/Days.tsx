import { useRef } from 'react';
import { SHEET_WORDS } from '../content';
import { blur, opacity, put, useEls, useFrame } from '../engine';
import { Kinetic, TypeLabel } from '../parts';
import { SheetCaption } from '../../film/StageSheet';
import { ease, mix, seg } from '../timeline';
import { PAPER, PAPER_AT, TicketPaper, overDays } from './ticketSheet';

/** The next answer, on another day, and one more a few days later (scene time). */
export const SECOND = 1300;
export const THIRD = 3500;
export const DAYS_LINES = overDays(SECOND, THIRD);
export const DAYS_DATES = [
  { at: -1, text: '7 окт.' },
  { at: 900, text: '8 окт.' },
  { at: 3000, text: '10 окт.' },
];
/** What each answer did: chapter 03's line is handed over with the paper. */
export const DAYS_CAPTION = [
  { at: -1, until: 900, text: SHEET_WORDS.first },
  { at: 2700, until: THIRD - 100, text: SHEET_WORDS.second },
  { at: 4500, text: SHEET_WORDS.third },
];
/** The end of the chapter: the stage clears for the reel's ending. */
const CLEAR = 5900;
/** The paper moves from where chapter 03 left it to the middle of the stage. */
const CENTER_LEFT = Math.round((1920 - PAPER.width * PAPER.zoom) / 2);

/**
 * 8 · Chapter 04, «Разные дни». The same paper on the days after: on another day the lines named
 * again go and the one named only after the examiner's question rubs half-way; a few days later it
 * goes too, and an erased line that the answer did not name comes back. What is left on the sheet is
 * what to answer next.
 */
export default function Days() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    // Chapter 03 lies under this one for its last moment: the paper is the same, the rest of it goes.
    opacity(one('bg'), l >= 380 ? 1 : 0);
    const move = ease.inOut(seg(l, 450, 800));
    const paper = one('paper');
    put(paper, 'transform', move <= 0 ? 'none' : `translate3d(${mix(0, CENTER_LEFT - PAPER_AT.left, move).toFixed(1)}px,0,0)`);
    put(one('cap'), 'transform', `translate3d(${mix(0, CENTER_LEFT - PAPER_AT.left, move).toFixed(1)}px,0,0)`);
    // The stage clears as the ending opens over it.
    const clear = ease.in(seg(l, CLEAR, 420));
    for (const name of ['head', 'paper', 'cap']) {
      const el = one(name);
      opacity(el, 1 - clear);
      blur(el, clear * 12);
    }
  });

  return (
    <div ref={root} className="mr-scene">
      <div data-a="bg" className="mr-layer mr-bg-light" style={{ opacity: 0 }} />
      <div data-a="head" className="mr-layer">
        <div className="mr-label-at">
          <TypeLabel text="Разные дни" at={300} />
        </div>
        <h3 className="mr-display mr-head">
          <Kinetic text="Одного ответа мало." at={430} unit="letter" variant="drop" stagger={22} dur={620} accentFrom={2} />
        </h3>
      </div>
      <div data-a="paper" className="mr-sh-paper" style={{ left: PAPER_AT.left, top: PAPER_AT.top }}>
        <TicketPaper lines={DAYS_LINES} dates={DAYS_DATES} />
      </div>
      <div data-a="cap" className="mr-sh-cap" style={{ left: PAPER_AT.left }}>
        <SheetCaption items={DAYS_CAPTION} className="mr-chip" />
      </div>
    </div>
  );
}
