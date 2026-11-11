import type { CSSProperties } from 'react';
import './dot.css';

/**
 * «Точка»: the yellow dot of the wordmark as Meldy's character (notes: 10_Project/Face_and_Final_Ideas_2026-11-11).
 * It stands where Meldy is at work or has just finished something: on the bar while a lecture is read (AgentCards), at
 * the end of a topic that was just learned (TopicClosed). Where no markup can go, the stylesheets draw the same face
 * from `--m-dot-face` (the oral answer's status pill).
 *
 * A decoration: the words beside it carry the state, so it is hidden from screen readers. It moves by CSS only — no
 * timers, no state — and stands still under «меньше движения».
 */
export type DotMove =
  /** Stands and blinks. */
  | 'still'
  /** Hops in place: Meldy is working. */
  | 'hop'
  /** Comes down once and stays as a full stop (its eyes close): something is finished. */
  | 'land';

export type DotLook = 'ahead';

interface MeldyDotProps {
  /** The diameter in px; a landing dot takes the size of a full stop of the text it ends instead. */
  size?: number;
  move?: DotMove;
  /** «ahead»: the eyes look to the right, where the work goes. */
  look?: DotLook;
  className?: string;
}

export default function MeldyDot({ size = 22, move = 'still', look, className }: MeldyDotProps) {
  return (
    <span
      className={className ? `md ${className}` : 'md'}
      data-move={move}
      data-look={look}
      style={move === 'land' ? undefined : ({ '--md-size': `${size}px` } as CSSProperties)}
      aria-hidden="true"
    >
      <i className="md-b">
        <b />
        <b />
      </i>
    </span>
  );
}

/** A title that ends with its own full stop, question mark, exclamation mark or ellipsis: the dot does not end it twice. */
export function endsWithStop(title: string): boolean {
  return /[.!?…]\s*$/u.test(title);
}
