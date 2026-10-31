import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { KINDS } from './copyKinds';
import QText from './QText';

/**
 * «Порядок» (release 48): the items as rows of one card, put in order by dragging a row by its handle, by the arrows on
 * each row, or from the keyboard — Space or Enter on the handle takes the row, ↑ / ↓ move it, Space / Enter puts it
 * down, Escape puts everything back. A live region says where the row is («Два — место 1 из 4»). `value` is the
 * arrangement top to bottom: indices into `items`. After the answer (`review`) the rows say which stand right.
 */

export interface OrderReview {
  /** The right arrangement in the same indices (top to bottom). */
  key: number[] | null;
}

interface Props {
  items: string[];
  value: number[];
  onChange?: (next: number[]) => void;
  disabled?: boolean;
  review?: OrderReview | null;
  labelledBy?: string;
}

const plain = (text: string) => `«${text.replace(/\s+/g, ' ').trim().slice(0, 80)}»`;

function Grip() {
  return (
    <svg viewBox="0 0 12 20" aria-hidden="true">
      {[3, 10, 17].map((y) => (
        <g key={y}>
          <circle cx="3" cy={y} r="1.6" />
          <circle cx="9" cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} />
    </svg>
  );
}

export default function OrderList({ items, value, onChange, disabled = false, review = null, labelledBy }: Props) {
  const hintId = useId();
  const [grabbed, setGrabbed] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [said, setSaid] = useState('');
  const before = useRef<number[] | null>(null);
  const handles = useRef(new Map<number, HTMLButtonElement | null>());
  const rows = useRef(new Map<number, HTMLLIElement | null>());
  const focusAfter = useRef<number | null>(null);
  const locked = disabled || Boolean(review) || !onChange;

  useEffect(() => {
    if (focusAfter.current === null) return;
    handles.current.get(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  const move = (item: number, to: number) => {
    const from = value.indexOf(item);
    if (from < 0 || to < 0 || to >= value.length || to === from || !onChange) return;
    const next = [...value];
    next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    return next;
  };

  const step = (item: number, delta: number, announce: (place: number) => string) => {
    const to = value.indexOf(item) + delta;
    if (move(item, to)) {
      focusAfter.current = item;
      setSaid(announce(to + 1));
    }
  };

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, item: number) => {
    if (locked) return;
    const text = plain(items[item] ?? '');
    const place = value.indexOf(item) + 1;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (grabbed === item) {
        setGrabbed(null);
        before.current = null;
        setSaid(KINDS.orderDropped(text, place, value.length));
      } else {
        setGrabbed(item);
        before.current = [...value];
        setSaid(KINDS.orderTaken(text, place, value.length));
      }
      return;
    }
    if (event.key === 'Escape' && grabbed !== null) {
      event.preventDefault();
      if (before.current && onChange) onChange(before.current);
      focusAfter.current = item;
      before.current = null;
      setGrabbed(null);
      setSaid(KINDS.orderCancelled);
      return;
    }
    if (grabbed === item && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      step(item, event.key === 'ArrowUp' ? -1 : 1, (to) => KINDS.orderMoved(text, to, value.length));
    }
  };

  // Dragging by the handle: the row follows the pointer; it takes the place of the row whose middle it passes.
  const drag = useRef<{ item: number; pointer: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, item: number) => {
    if (locked || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag.current = { item, pointer: event.pointerId };
    setDragging(item);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic event in tests has no pointer to capture
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    event.preventDefault();
    const y = event.clientY;
    let target = value.indexOf(d.item);
    value.forEach((other, index) => {
      if (other === d.item) return;
      const box = rows.current.get(other)?.getBoundingClientRect();
      if (!box) return;
      const middle = box.top + box.height / 2;
      const from = value.indexOf(d.item);
      if (index < from && y < middle) target = Math.min(target, index);
      if (index > from && y > middle) target = Math.max(target, index);
    });
    if (target !== value.indexOf(d.item)) move(d.item, target);
  };
  const onPointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(null);
    setSaid(KINDS.orderDropped(plain(items[d.item] ?? ''), value.indexOf(d.item) + 1, value.length));
  };

  const keyPlace = (item: number) => (review?.key ? review.key.indexOf(item) : -1);
  return (
    <div className="kd-order-wrap">
      {!locked ? (
        <p className="kd-hint" id={hintId}>
          {KINDS.orderHint} <span className="kd-hint-keys">{KINDS.orderKeys}</span>
        </p>
      ) : null}
      <ol className="kd-order" aria-labelledby={labelledBy} data-locked={locked ? '' : undefined}>
        {value.map((item, index) => {
          const text = items[item] ?? '';
          const right = review?.key ? keyPlace(item) === index : null;
          return (
            <li
              key={item}
              ref={(node) => {
                rows.current.set(item, node);
              }}
              className="kd-order-row"
              data-grabbed={grabbed === item || dragging === item ? '' : undefined}
              data-state={right === null ? undefined : right ? 'right' : 'wrong'}
            >
              {!locked ? (
                <button
                  type="button"
                  className="kd-grip"
                  ref={(node) => {
                    handles.current.set(item, node);
                  }}
                  aria-label={KINDS.orderGrab(plain(text))}
                  aria-describedby={hintId}
                  aria-pressed={grabbed === item}
                  onKeyDown={(event) => onHandleKey(event, item)}
                  onBlur={() => {
                    if (grabbed === item) {
                      setGrabbed(null);
                      before.current = null;
                    }
                  }}
                  onPointerDown={(event) => onPointerDown(event, item)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerEnd}
                  onPointerCancel={onPointerEnd}
                >
                  <Grip />
                </button>
              ) : null}
              <span className="kd-order-n" aria-hidden={locked ? undefined : 'true'}>
                {index + 1}
              </span>
              <span className="kd-order-t">
                <QText text={text} />
                {right === false && review?.key ? (
                  <span className="kd-tag">{KINDS.placeWrong(keyPlace(item) + 1)}</span>
                ) : right ? (
                  <span className="kd-tag" data-tone="right">
                    {KINDS.placeRight}
                  </span>
                ) : null}
              </span>
              {!locked ? (
                <span className="kd-order-steps">
                  <button
                    type="button"
                    className="kd-step"
                    aria-label={KINDS.orderUp(plain(text))}
                    disabled={index === 0}
                    onClick={() => step(item, -1, (to) => KINDS.orderMoved(plain(text), to, value.length))}
                  >
                    <Chevron up />
                  </button>
                  <button
                    type="button"
                    className="kd-step"
                    aria-label={KINDS.orderDown(plain(text))}
                    disabled={index === value.length - 1}
                    onClick={() => step(item, 1, (to) => KINDS.orderMoved(plain(text), to, value.length))}
                  >
                    <Chevron up={false} />
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
