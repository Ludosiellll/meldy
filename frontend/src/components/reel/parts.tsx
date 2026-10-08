import { useRef } from 'react';
import { blur, opacity, put, useEls, useFrame } from './engine';
import { clamp, ease, mix, seg } from './timeline';

// ---------------------------------------------------------------------------------------------
// A counter with rolling digits (up to two digits), blurred while it runs fast. The guide's clips use it.

const STRIP = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export function Counter({
  from,
  to,
  at,
  dur,
  className,
  value,
}: {
  from: number;
  to: number;
  at: number;
  dur: number;
  className?: string;
  /** Overrides the eased count: the value at scene time `lt`. */
  value?: (lt: number) => number;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const { all } = useEls(root);
  const read = (lt: number) => (value ? value(lt) : mix(from, to, ease.inOut(seg(lt, at, dur))));
  useFrame((lt) => {
    const v = Math.max(0, read(lt));
    const speed = Math.abs(v - read(lt - 16));
    const [tensCell, onesCell] = all('cell');
    const [tensStrip, onesStrip] = all('strip');
    const ones = v % 10;
    const tens = Math.floor(v / 10) + Math.max(0, (v % 10) - 9);
    put(onesStrip, 'transform', `translate3d(0,${(-ones).toFixed(3)}em,0)`);
    put(tensStrip, 'transform', `translate3d(0,${(-(tens % 10)).toFixed(3)}em,0)`);
    blur(onesStrip, Math.min(7, speed * 22));
    blur(tensStrip, Math.min(5, speed * 2.2));
    const showTens = clamp((v - 9) / 0.6);
    put(tensCell, 'width', `${(0.6 * showTens).toFixed(3)}em`);
    opacity(tensCell, showTens);
    put(onesCell, 'width', '0.6em');
  });
  return (
    <span ref={root} className={`mr-count ${className ?? ''}`} aria-hidden="true">
      {[0, 1].map((cell) => (
        <span key={cell} data-a="cell" className="mr-count-cell">
          <span data-a="strip" className="mr-count-strip">
            {STRIP.map((digit, position) => (
              <span key={position}>{digit}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
