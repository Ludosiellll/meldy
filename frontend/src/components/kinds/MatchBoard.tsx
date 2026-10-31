import { useId, useRef, useState, type PointerEvent } from 'react';
import { KINDS } from './copyKinds';
import QText from './QText';

/**
 * «Соответствие» (release 48): each left item is a row with its pair chosen in a list (a native select: every keyboard,
 * screen reader and phone picker knows it), and the right items wait as chips under the rows — a chip dragged onto a row
 * becomes its pair. `value` holds per left item the index of its right item in `right`, -1 for none; `rightOrder` is the
 * order the right items are listed in (a session shuffles them; a quiz gets them shuffled already). After the answer
 * (`review`) each row says whether its pair is right and, when the key is shown, which one is.
 */

export interface MatchReview {
  /** Per left item the index of its right pair; null when the review does not show the answers. */
  key: number[] | null;
}

interface Props {
  left: string[];
  right: string[];
  value: number[];
  rightOrder?: number[];
  onChange?: (next: number[]) => void;
  disabled?: boolean;
  review?: MatchReview | null;
  labelledBy?: string;
}

const plain = (text: string) => `«${text.replace(/\s+/g, ' ').trim().slice(0, 80)}»`;

export default function MatchBoard({ left, right, value, rightOrder, onChange, disabled = false, review = null, labelledBy }: Props) {
  const hintId = useId();
  const [said, setSaid] = useState('');
  const [drag, setDrag] = useState<{ index: number; x: number; y: number; over: number | null } | null>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement | null>());
  const pointer = useRef<number | null>(null);
  const locked = disabled || Boolean(review) || !onChange;
  const listed = rightOrder && rightOrder.length === right.length ? rightOrder : right.map((_, i) => i);
  const used = new Set(value.filter((v) => v >= 0));

  const set = (row: number, pick: number) => {
    if (!onChange) return;
    const next = left.map((_, i) => (i < value.length ? value[i] : -1));
    // a right item belongs to one row at a time: it leaves the row it was on
    if (pick >= 0) next.forEach((v, i) => (v === pick && i !== row ? (next[i] = -1) : null));
    next[row] = pick;
    onChange(next);
    setSaid(pick >= 0 ? KINDS.matchSet(plain(right[pick] ?? ''), plain(left[row] ?? '')) : KINDS.matchCleared(plain(left[row] ?? '')));
  };

  const rowAt = (x: number, y: number): number | null => {
    for (const [index, node] of rowRefs.current) {
      const box = node?.getBoundingClientRect();
      if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return index;
    }
    return null;
  };
  const onChipDown = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (locked || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointer.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no pointer to capture in a synthetic event
    }
    setDrag({ index, x: event.clientX, y: event.clientY, over: null });
  };
  const onChipMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || pointer.current !== event.pointerId) return;
    event.preventDefault();
    setDrag({ ...drag, x: event.clientX, y: event.clientY, over: rowAt(event.clientX, event.clientY) });
  };
  const onChipUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || pointer.current !== event.pointerId) return;
    const over = rowAt(event.clientX, event.clientY);
    pointer.current = null;
    setDrag(null);
    if (over !== null) set(over, drag.index);
  };

  return (
    <div className="kd-match-wrap">
      {!locked ? (
        <p className="kd-hint" id={hintId}>
          {KINDS.matchHint}
        </p>
      ) : null}
      <ul className="kd-match" aria-labelledby={labelledBy}>
        {left.map((text, row) => {
          const pick = value[row] ?? -1;
          const keyPick = review?.key ? review.key[row] : undefined;
          const state = !review ? undefined : review.key ? (pick === keyPick ? 'right' : 'wrong') : undefined;
          const selectId = `${hintId}-s${row}`;
          return (
            <li
              key={row}
              ref={(node) => {
                rowRefs.current.set(row, node);
              }}
              className="kd-match-row"
              data-state={state}
              data-over={drag?.over === row ? '' : undefined}
            >
              <label className="kd-match-left" htmlFor={selectId}>
                <QText text={text} />
              </label>
              <span className="kd-match-arrow" aria-hidden="true">
                →
              </span>
              <span className="kd-match-right">
                {locked ? (
                  <span className="kd-match-chosen" id={selectId} data-empty={pick < 0 ? '' : undefined}>
                    {pick >= 0 ? <QText text={right[pick] ?? ''} /> : KINDS.pairEmpty}
                  </span>
                ) : (
                  <select
                    id={selectId}
                    className="kd-select"
                    value={pick}
                    aria-describedby={hintId}
                    onChange={(event) => set(row, Number(event.target.value))}
                  >
                    <option value={-1}>{KINDS.matchPick}</option>
                    {listed.map((index) => (
                      <option key={index} value={index}>
                        {right[index]}
                      </option>
                    ))}
                  </select>
                )}
                {review?.key && state === 'wrong' && keyPick !== undefined && keyPick >= 0 ? (
                  <span className="kd-tag">{KINDS.pairWrong(right[keyPick] ?? '')}</span>
                ) : state === 'right' ? (
                  <span className="kd-tag" data-tone="right">
                    {KINDS.pairRight}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {!locked ? (
        <div className="kd-pool" role="group" aria-label={KINDS.matchPool}>
          {listed.map((index) => (
            <button
              key={index}
              type="button"
              className="kd-chip"
              data-used={used.has(index) ? '' : undefined}
              data-dragging={drag?.index === index ? '' : undefined}
              tabIndex={-1}
              aria-hidden="true"
              onPointerDown={(event) => onChipDown(event, index)}
              onPointerMove={onChipMove}
              onPointerUp={onChipUp}
              onPointerCancel={() => {
                pointer.current = null;
                setDrag(null);
              }}
            >
              <QText text={right[index] ?? ''} />
            </button>
          ))}
        </div>
      ) : null}
      {drag ? (
        <span className="kd-chip kd-chip-ghost" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>
          {right[drag.index]}
        </span>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
