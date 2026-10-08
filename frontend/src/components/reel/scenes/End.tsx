/**
 * The end card, after the only cut: the paper with one line left (the first point, written by hand), the
 * wordmark with its yellow dot, the landing's own eyebrow and one face, and the example's button.
 */
import { useRef } from 'react';
import { Arrow, Wordmark } from '../../film/kit';
import { SheetText } from '../../exams/sheet/SheetText';
import { EYEBROW, HEADLINE, TRY_LABEL } from '../../home/landingCopy';
import { clamp, ease, seg } from '../timeline';
import { opacity, put, useFrame } from '../engine';
import * as C from '../content';
import { Say } from '../paper/Say';

/** The button's place on the stage (the reel's hit area for it sits here too). */
export const END_CTA = { left: 120, top: 690, width: 640, height: 92 };

/** The headline in its two lines: the landing's sentence, split at its dash. */
const HEADLINE_LINES = (() => {
  const [first, second] = HEADLINE.split(' — ');
  return [`${first} —`, second];
})();

const LINE_WRITE_AT = 500;
const LINE_WRITE_DUR = 900;

export default function End() {
  const line = useRef<HTMLDivElement>(null);
  const eyebrow = useRef<HTMLParagraphElement>(null);
  const cta = useRef<HTMLDivElement>(null);
  useFrame((l) => {
    const write = clamp((l - LINE_WRITE_AT) / LINE_WRITE_DUR);
    put(line.current, 'clip-path', write >= 1 ? 'none' : `inset(-40% ${((1 - write) * 100).toFixed(2)}% -40% 0)`);
    opacity(eyebrow.current, ease.inOut(seg(l, 250, 500)));
    opacity(cta.current, ease.inOut(seg(l, 1700, 600)));
  });
  return (
    <div className="pe">
      <Wordmark className="pe-mark" />
      <p ref={eyebrow} className="pe-eyebrow" style={{ opacity: 0 }}>
        {EYEBROW}
      </p>
      <Say lines={HEADLINE_LINES} at={400} stagger={70} className="pe-head" />
      <div ref={cta} className="pe-cta" style={{ left: END_CTA.left, top: END_CTA.top, width: END_CTA.width, height: END_CTA.height, opacity: 0 }}>
        <span>{TRY_LABEL}</span>
        <i>
          <Arrow />
        </i>
      </div>
      <div ref={line} className="pe-line" style={{ clipPath: 'inset(-40% 100% -40% 0)' }}>
        <SheetText text={C.END_LINE} seedBase="pe:line" />
      </div>
    </div>
  );
}
