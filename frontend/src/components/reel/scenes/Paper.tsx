/**
 * The film's one sheet: squared paper with the department's list, the lecture slips, the points written
 * under the question, the ticket and the answer, the days, the copies. The camera moves along it; the
 * paper is never remounted, and nothing is cut inside it (the only cut is into the end card).
 */
import { useEffect, useRef, useState } from 'react';
import { Wordmark } from '../../film/kit';
import { isSheetFontSettled, loadSheetFont } from '../../exams/sheet/sheetFont';
import { ease, seg } from '../timeline';
import { put, useFrame } from '../engine';
import * as C from '../content';
import { cameraAt } from '../paper/camera';
import { ClusterBlock, CopyBlock, ListBlock } from '../paper/Blocks';
import { SHEET_H, SHEET_W } from '../paper/layout';
import { Say } from '../paper/Say';

/** The pen draws the sheet's margin from its top-left corner: along the top, down, back along the bottom. */
const MARGIN = 'M40 40 H1880 V1040 H40 V40';
const REVEAL_AT = 900;
const REVEAL_DUR = 1700;
const MARGIN_DRAW = 1100;
const MARGIN_FADE_AT = 2400;
const MARGIN_FADE = 700;

/** The chapter lines, one at a time, at the top of the frame (camera-fixed): each comes in and leaves. */
const SAYINGS: ReadonlyArray<{ lines: readonly string[]; at: number; out?: number }> = [
  { lines: C.STATEMENTS.list, at: 6800, out: 8400 },
  { lines: C.STATEMENTS.lectures, at: 9100, out: 11900 },
  { lines: C.STATEMENTS.sheet, at: 13900, out: 17900 },
  { lines: C.STATEMENTS.oral, at: 18900, out: 34200 },
  { lines: C.STATEMENTS.days, at: 35300, out: 40600 },
  { lines: C.STATEMENTS.group, at: 42600, out: 44700 },
];

export default function Paper() {
  const sheet = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const margin = useRef<SVGSVGElement>(null);
  const marginPath = useRef<SVGPathElement>(null);
  // The handwriting waits for its font (at most 1.5 s): no line is drawn in the fallback face.
  const [fontReady, setFontReady] = useState(isSheetFontSettled);

  useEffect(() => {
    let alive = true;
    void loadSheetFont().then(() => {
      if (alive) setFontReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useFrame((l) => {
    const cam = cameraAt(l);
    put(sheet.current, 'transform', `translate3d(${cam.x.toFixed(2)}px,${cam.y.toFixed(2)}px,0) scale(${cam.scale.toFixed(5)})`);
    const reach = ease.inOut(seg(l, REVEAL_AT, REVEAL_DUR)) * (SHEET_W + SHEET_H);
    put(grid.current, 'clip-path', reach >= SHEET_W + SHEET_H ? 'none' : `polygon(0 0, ${reach.toFixed(1)}px 0, 0 ${reach.toFixed(1)}px)`);
    // The pen draws the margin once, at the start; the sheet keeps the ruled grid and nothing else.
    put(marginPath.current, 'stroke-dashoffset', (1 - ease.inOut(seg(l, 0, MARGIN_DRAW))).toFixed(4));
    put(margin.current, 'opacity', (1 - seg(l, MARGIN_FADE_AT, MARGIN_FADE)).toFixed(3));
  });

  return (
    <div className="pp" data-font={fontReady ? 'ready' : 'waiting'} aria-hidden="true">
      <div ref={sheet} className="pp-sheet" style={{ width: SHEET_W, height: SHEET_H }}>
        <div ref={grid} className="pp-grid" />
        <svg ref={margin} className="pp-margin" width={SHEET_W} height={SHEET_H} viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}>
          <path ref={marginPath} pathLength={1} d={MARGIN} />
        </svg>
        <ListBlock />
        <ClusterBlock />
        <CopyBlock />
      </div>
      {SAYINGS.map((say) => (
        <Say key={say.at} lines={say.lines} at={say.at} out={say.out} />
      ))}
      <Wordmark className="pp-mark" />
    </div>
  );
}
