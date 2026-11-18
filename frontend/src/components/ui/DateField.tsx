import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  WEEKDAYS,
  addDays,
  addMonths,
  allowed,
  dayName,
  distance,
  firstDay,
  isDay,
  lastDay,
  monthOf,
  monthTitle,
  monthWeeks,
  nearest,
  shiftMonth,
  todayHere,
  type Month,
} from './dateGrid';
import './dateField.css';

/**
 * A date field with the site's own calendar (the owner, 18.11: the browser's default calendar on «Дата экзамена»).
 *
 * The field itself stays the browser's `<input type="date">`: the date is typed part by part as before, its value is
 * «ГГГГ-ММ-ДД», and it takes the same props. On a computer with a Chromium browser the browser's calendar mark is
 * hidden and ours is drawn in its place: a press on it (or Alt+↓, F4) opens the calendar below. On a phone, and in a
 * browser whose own calendar cannot be switched off, nothing changes: the system's picker is the better one there.
 *
 * The calendar stands in a portal, fixed to the window (as PaperSelect's list), so a sheet or a dialog never cuts it.
 */

export const DATE_COPY = {
  open: 'Открыть календарь',
  calendar: 'Календарь',
  prev: 'Предыдущий месяц',
  next: 'Следующий месяц',
  /** «Через: неделю · 2 недели · месяц» — a day counted from today, in one press. */
  picksLabel: 'Через',
  picks: [
    { label: 'неделю', days: 7, months: 0 },
    { label: '2 недели', days: 14, months: 0 },
    { label: 'месяц', days: 0, months: 1 },
  ],
} as const;

/** The width of the field's right edge that opens the calendar (the mark is drawn there). */
const MARK_ZONE = 48;
const GAP = 8;
const EDGE = 8;

/** Whether the field draws its own calendar: Chromium (its calendar mark can be hidden) with a mouse. */
export function ownsCalendar(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const chromium = Boolean((navigator as Navigator & { userAgentData?: unknown }).userAgentData);
  const mouse = typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  return chromium && mouse;
}

/** Sets the field's value the way typing does, so the page's own onChange hears it. */
function typeInto(input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (set) set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Where the calendar stands: under the field, or over it when it does not fit below and there is more room above. */
export function placeCalendar(
  field: { top: number; bottom: number; left: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number; above: boolean } {
  const below = view.height - field.bottom - GAP - EDGE;
  const over = field.top - GAP - EDGE;
  const above = size.height > below && over > below;
  const top = above ? Math.max(EDGE, field.top - GAP - size.height) : Math.max(EDGE, Math.min(field.bottom + GAP, view.height - EDGE - size.height));
  const left = Math.max(EDGE, Math.min(field.left, view.width - EDGE - size.width));
  return { top: Math.round(top), left: Math.round(left), above };
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max'> & {
  value: string;
  min?: string;
  max?: string;
};

const DateField = forwardRef<HTMLInputElement, Props>(function DateField({ value, min, max, disabled, onClick, onKeyDown, onMouseMove, ...rest }, outer) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(outer, () => inner.current as HTMLInputElement, []);
  const [own] = useState(ownsCalendar);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const popId = useId();

  const close = useCallback((focusField: boolean) => {
    setOpen(false);
    if (focusField) inner.current?.focus();
  }, []);

  const show = () => {
    const field = inner.current;
    if (!field || disabled || field.readOnly) return;
    // a dialog shown as modal keeps everything outside it inert: the calendar goes inside it
    setHost(field.closest<HTMLElement>('[aria-modal="true"], [role="dialog"], dialog') ?? document.body);
    setOpen(true);
  };

  const inMark = (event: MouseEvent<HTMLInputElement>) => event.clientX >= event.currentTarget.getBoundingClientRect().right - MARK_ZONE;

  return (
    <>
      <input
        {...rest}
        ref={inner}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        data-df={own ? 'own' : undefined}
        aria-haspopup={own ? 'dialog' : undefined}
        aria-expanded={own ? open : undefined}
        aria-controls={own && open ? popId : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!own || event.defaultPrevented || !inMark(event)) return;
          if (open) close(false);
          else show();
        }}
        onMouseMove={(event) => {
          onMouseMove?.(event);
          if (own) event.currentTarget.style.cursor = inMark(event) && !disabled ? 'pointer' : '';
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!own || event.defaultPrevented) return;
          // the keys the browser opens its own calendar with
          if ((event.key === 'ArrowDown' && event.altKey) || event.key === 'F4') {
            event.preventDefault();
            show();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            close(false);
          }
        }}
      />
      {own && open && host && inner.current
        ? createPortal(
            <Calendar
              id={popId}
              field={inner.current}
              value={isDay(value) ? value : ''}
              min={min}
              max={max}
              onPick={(day) => {
                if (inner.current) typeInto(inner.current, day);
                close(true);
              }}
              onClose={close}
            />,
            host,
          )
        : null}
    </>
  );
});

export default DateField;

interface CalendarProps {
  id: string;
  field: HTMLInputElement;
  value: string;
  min?: string;
  max?: string;
  onPick: (day: string) => void;
  onClose: (focusField: boolean) => void;
}

function Calendar({ id, field, value, min, max, onPick, onClose }: CalendarProps) {
  const [today] = useState(() => todayHere());
  /** The day the keys stand on (the chosen one, else today or the nearest day the field takes). */
  const [cursor, setCursor] = useState(() => (value && allowed(value, min, max) ? value : nearest(today, min, max)));
  const [month, setMonth] = useState<Month>(() => monthOf(value || nearest(today, min, max)));
  /** The day under the mouse: the line under the grid speaks of it. */
  const [hover, setHover] = useState<string | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const moved = useRef(true); // the keys moved the cursor (or the calendar has just opened): the focus follows it

  // Stands against its field before the first paint, and again while the page or the window moves (PaperSelect's way).
  useLayoutEffect(() => {
    const node = pop.current;
    if (!node) return undefined;
    let shift = { x: 0, y: 0 };
    const place = (first: boolean) => {
      const view = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight || document.documentElement.clientHeight };
      const spot = placeCalendar(field.getBoundingClientRect(), { width: node.offsetWidth, height: node.offsetHeight }, view);
      node.style.top = `${spot.top - shift.y}px`;
      node.style.left = `${spot.left - shift.x}px`;
      node.toggleAttribute('data-above', spot.above);
      if (first) {
        // a transformed ancestor would make it fixed to itself, not to the window: measure once and make up for it
        const got = node.getBoundingClientRect();
        if (Math.abs(got.top - spot.top) > 0.5 || Math.abs(got.left - spot.left) > 0.5) {
          shift = { x: got.left - spot.left, y: got.top - spot.top };
          node.style.top = `${spot.top - shift.y}px`;
          node.style.left = `${spot.left - shift.x}px`;
        }
        node.setAttribute('data-placed', '');
      }
    };
    place(true);
    let frame = 0;
    const later = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place(false);
      });
    };
    window.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    return () => {
      window.removeEventListener('scroll', later, true);
      window.removeEventListener('resize', later);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [field]);

  // A press outside the calendar and its field closes it.
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (pop.current?.contains(target) || field.contains(target))) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [field, onClose]);

  // The focus stands on the cursor's day: when the calendar opens and after each key that moves it.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    pop.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus({ preventScroll: true });
  }, [cursor, month]);

  const go = (day: string) => {
    const next = nearest(day, min, max);
    moved.current = true;
    setCursor(next);
    setMonth(monthOf(next));
  };
  const turn = (n: number) => {
    const next = shiftMonth(month, n);
    setMonth(next);
    // the cursor keeps its day of the month where the month has it and the field takes it
    const same = nearest(addMonths(cursor, n), min, max);
    setCursor(monthOf(same).m === next.m && monthOf(same).y === next.y ? same : nearest(firstDay(next), min, max));
  };
  const canTurn = (n: number) => {
    const next = shiftMonth(month, n);
    return n < 0 ? !isDay(min) || lastDay(next) >= min : !isDay(max) || firstDay(next) <= max;
  };

  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // a dialog around the field stays open
      onClose(true);
      return;
    }
    const onDay = (event.target as HTMLElement).hasAttribute('data-day');
    if (!onDay) return;
    const steps: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
      Home: () => firstDay(monthOf(cursor)),
      End: () => lastDay(monthOf(cursor)),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    go(step());
  };

  const spoken = hover ?? cursor;
  const weeks = monthWeeks(month);
  return (
    <div
      ref={pop}
      id={id}
      className="df-pop"
      role="dialog"
      aria-label={DATE_COPY.calendar}
      onKeyDown={onKeys}
      onBlur={(event) => {
        // the focus left the calendar for something that is not its field: it closes
        const to = event.relatedTarget as Node | null;
        if (to && !event.currentTarget.contains(to) && !field.contains(to)) onClose(false);
      }}
    >
      <div className="df-head">
        <p className="df-title" id={titleId} aria-live="polite">
          {monthTitle(month)}
        </p>
        <button type="button" className="df-turn" aria-label={DATE_COPY.prev} disabled={!canTurn(-1)} onClick={() => turn(-1)}>
          <Chevron left />
        </button>
        <button type="button" className="df-turn" aria-label={DATE_COPY.next} disabled={!canTurn(1)} onClick={() => turn(1)}>
          <Chevron />
        </button>
      </div>
      <table className="df-grid" role="grid" aria-labelledby={titleId}>
        <thead>
          <tr>
            {WEEKDAYS.map((name) => (
              <th key={name} scope="col" abbr={name}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody onMouseLeave={() => setHover(null)}>
          {weeks.map((week, index) => (
            <tr key={index}>
              {week.map((day, at) =>
                day ? (
                  <td key={day} role="gridcell" aria-selected={day === value}>
                    <button
                      type="button"
                      className="df-day"
                      data-day={day}
                      data-today={day === today ? '' : undefined}
                      aria-label={dayName(day)}
                      aria-current={day === today ? 'date' : undefined}
                      aria-pressed={day === value}
                      tabIndex={day === cursor ? 0 : -1}
                      disabled={!allowed(day, min, max)}
                      onMouseEnter={() => setHover(day)}
                      onFocus={() => setCursor(day)}
                      onClick={() => onPick(day)}
                    >
                      {Number(day.slice(8, 10))}
                    </button>
                  </td>
                ) : (
                  <td key={`gap-${at}`} role="gridcell" aria-hidden="true" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="df-line">
        <span className="df-line-day">{dayName(spoken)}</span>
        <span className="df-line-far">{distance(spoken, today)}</span>
      </p>
      <div className="df-picks" role="group" aria-label={DATE_COPY.picksLabel}>
        <span className="df-picks-l" aria-hidden="true">
          {DATE_COPY.picksLabel}
        </span>
        {DATE_COPY.picks.map((pick, index) => {
          const day = pick.months ? addMonths(today, pick.months) : addDays(today, pick.days);
          return (
            <button
              key={pick.label}
              data-first={index === 0 ? '' : undefined}
              type="button"
              className="df-pick"
              aria-label={`${DATE_COPY.picksLabel} ${pick.label}: ${dayName(day)}`}
              disabled={!allowed(day, min, max)}
              onMouseEnter={() => setHover(day)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(day)}
            >
              {pick.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chevron({ left = false }: { left?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={left ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
