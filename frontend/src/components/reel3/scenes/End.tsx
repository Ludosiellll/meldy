/**
 * The end card: the wordmark with its yellow dot, the page's headline and «Попробовать на примере» (the frame lays a
 * real button over it, Reel3 END_CTA). Its places are stage px of each layout (reel3.css .r3-end-*).
 */
import { useRef } from 'react';
import { useEls, useFrame } from '../../reel/engine';
import { CTA, HEADLINE, bind } from '../../home3/copy3';
import { Arrow, appear, ease, move, seg } from '../kit3';

/** The pill's box on each stage (stage px) and when it is there: the frame's button covers exactly this. */
export const END_CTA = {
  at: 1300,
  wide: { x: 510, y: 610, w: 580, h: 92 },
  tall: { x: 40, y: 352, w: 320, h: 58 },
} as const;

export function EndScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    const p = ease.brand(seg(l, 150, 700));
    appear(one('mark'), l, 150, 600, 0);
    move(one('mark'), 0, 24 * (1 - p), 0.94 + 0.06 * p);
    appear(one('line'), l, 650, 500, 14);
    appear(one('cta'), l, END_CTA.at - 200, 420, 12);
  });
  return (
    <div ref={root} className="r3-scene r3-end">
      <p data-a="mark" className="r3-end-mark" style={{ opacity: 0 }}>
        Meldy
        <i className="r3-dot" />
      </p>
      <p data-a="line" className="r3-end-line" style={{ opacity: 0 }}>
        {bind(HEADLINE)}
      </p>
      <span data-a="cta" className="r3-end-cta" style={{ opacity: 0 }}>
        {CTA.example}
        <i>
          <Arrow />
        </i>
      </span>
    </div>
  );
}
