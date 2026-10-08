/**
 * A statement of the film: heavy words that come in from the right with motion blur, one after another,
 * and leave to the left. It sits at the top of the frame, over the sheet, and speaks for one chapter.
 */
import { useMemo, useRef, type CSSProperties } from 'react';
import { useFrame } from '../engine';
import { glideIn, glideOut } from './motion';

interface SayProps {
  lines: readonly string[];
  /** Scene time of the first word. */
  at: number;
  /** Between words (ms). */
  stagger?: number;
  /** Leaves from this moment. */
  out?: number;
  className?: string;
  style?: CSSProperties;
}

export function Say({ lines, at, stagger = 90, out, className, style }: SayProps) {
  const root = useRef<HTMLParagraphElement>(null);
  const words = useRef<Array<HTMLSpanElement | null>>([]);
  const split = useMemo(() => lines.map((line) => line.split(' ')), [lines]);
  const count = split.reduce((sum, line) => sum + line.length, 0);
  useFrame((l) => {
    for (let i = 0; i < count; i += 1) glideIn(words.current[i], l, at + i * stagger, { dx: 120, dur: 720, smear: 20 });
    if (out !== undefined) glideOut(root.current, l, out, { dx: -180, dur: 480, smear: 22 });
  });
  let index = 0;
  return (
    <p ref={root} className={`pp-say ${className ?? ''}`} style={style}>
      {split.map((line, lineIndex) => (
        <span key={lineIndex} className="fm-say-line">
          {line.map((word, wordIndex) => {
            const slot = index;
            index += 1;
            return (
              <span
                key={wordIndex}
                ref={(el) => {
                  words.current[slot] = el;
                }}
                className="fm-say-w"
                style={{ opacity: 0 }}
              >
                {word}
              </span>
            );
          })}
        </span>
      ))}
    </p>
  );
}
