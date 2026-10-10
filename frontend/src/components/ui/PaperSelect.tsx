import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import './paperSelect.css';

export interface PaperSelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface PaperSelectProps<T extends string | number> {
  value: T;
  options: ReadonlyArray<PaperSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface ListPlace {
  top: number;
  left: number;
  maxHeight: number;
  above: boolean;
}

/** The list's gap to its pill, its distance to the window's edges, its tallest and its widest. */
export const LIST_GAP = 8;
export const LIST_EDGE = 8;
const LIST_MAX = 320;
const LIST_WIDE = 420;
/** Below this the list does not squeeze under or over its pill: it takes the window's height, over the pill. */
const LIST_LEAST = 132;

/**
 * Where the open list stands, in the window's coordinates: under its pill, or over it when there is less room below
 * than above; never past the window's edges (a sheet's or a dialog's own edges do not cut it, spec usability M2), so
 * every option can be reached, scrolling inside the list when it is taller than the room.
 */
export function placeList(pill: Box, list: { height: number; width: number }, view: { width: number; height: number }): ListPlace {
  const natural = Math.max(0, Math.min(list.height, LIST_MAX, Math.round(view.height * 0.6)));
  const below = view.height - pill.bottom - LIST_GAP - LIST_EDGE;
  const over = pill.top - LIST_GAP - LIST_EDGE;
  let above = false;
  let maxHeight: number;
  if (natural <= below) maxHeight = natural;
  else if (over > below) {
    above = true;
    maxHeight = Math.min(natural, over);
  } else maxHeight = below;
  let top = above ? pill.top - LIST_GAP - maxHeight : pill.bottom + LIST_GAP;
  if (maxHeight < Math.min(natural, LIST_LEAST)) {
    // No room on either side (a phone on its side): the whole window, over the pill.
    above = false;
    maxHeight = Math.max(0, Math.min(natural, view.height - 2 * LIST_EDGE));
    top = Math.min(Math.max(pill.bottom + LIST_GAP, LIST_EDGE), view.height - LIST_EDGE - maxHeight);
  }
  const widest = Math.max(0, Math.min(LIST_WIDE, view.width - 2 * LIST_EDGE));
  const width = Math.min(Math.max(list.width, Math.min(Math.max(pill.width, 180), widest)), widest);
  const left = Math.min(Math.max(pill.left, LIST_EDGE), Math.max(LIST_EDGE, view.width - LIST_EDGE - width));
  return { top: Math.round(top), left: Math.round(left), maxHeight: Math.floor(maxHeight), above };
}

/** The window's size (the visual viewport on a phone: the keyboard and the browser's bars take their part). */
function viewSize(): { width: number; height: number } {
  const visual = typeof window !== 'undefined' ? window.visualViewport : null;
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = visual?.height || window.innerHeight || document.documentElement.clientHeight;
  return { width, height };
}

/** The scroll of a list that shows its option `index` whole (the list scrolls itself, never the page or the sheet). */
export function scrollToShow(list: { scrollTop: number; clientHeight: number }, option: { offsetTop: number; offsetHeight: number }): number {
  if (option.offsetTop < list.scrollTop) return option.offsetTop;
  if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) return option.offsetTop + option.offsetHeight - list.clientHeight;
  return list.scrollTop;
}

/**
 * Выпадающий список вместо системного <select> (язык Meldy от 2026-10-04): мягкая пилюля со
 * словом и шевроном, под ней — скруглённое меню вариантов. Клавиатура как у списка: стрелки,
 * Home/End, первая буква, Enter/пробел выбирают, Esc закрывает и возвращает фокус.
 *
 * The open list lives in a portal, fixed to the window and kept inside it (placeList): a sheet or a dialog with its own
 * scroll no longer cuts it. Inside a modal dialog it goes into that dialog, so a screen reader still reads it there.
 */
export default function PaperSelect<T extends string | number>(props: PaperSelectProps<T>) {
  const { value, options, onChange, ariaLabel, disabled } = props;
  const id = useId();
  const listId = `${id}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const typed = useRef({ text: '', at: 0 });

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options[selectedIndex];

  const enabledFrom = useCallback(
    (start: number, step: 1 | -1): number => {
      for (let i = 0, index = start; i < options.length; i += 1, index += step) {
        const wrapped = (index + options.length) % options.length;
        if (!options[wrapped]?.disabled) return wrapped;
      }
      return start;
    },
    [options],
  );

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  const openList = (index = selectedIndex) => {
    if (disabled || options.length === 0) return;
    const dialog = buttonRef.current?.closest<HTMLElement>('[aria-modal="true"], [role="dialog"], dialog') ?? null;
    setHost(dialog ?? (typeof document !== 'undefined' ? document.body : null));
    setActive(options[index]?.disabled ? enabledFrom(index, 1) : index);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };

  // Places the list against its pill before the first paint, and again while the page, a sheet or the window moves.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const list = listRef.current;
    const button = buttonRef.current;
    if (!list || !button || typeof window === 'undefined') return undefined;
    let shift = { x: 0, y: 0 };
    const place = (first: boolean) => {
      const rect = button.getBoundingClientRect();
      const view = viewSize();
      // The width first (at least the pill's, at most the window's), so the list's own width can be measured.
      const widest = Math.max(0, Math.min(LIST_WIDE, view.width - 2 * LIST_EDGE));
      list.style.maxWidth = `${widest}px`;
      list.style.minWidth = `${Math.min(Math.max(rect.width, 180), widest)}px`;
      const spot = placeList(rect, { height: list.scrollHeight, width: list.offsetWidth }, view);
      list.style.top = `${spot.top - shift.y}px`;
      list.style.left = `${spot.left - shift.x}px`;
      list.style.maxHeight = `${spot.maxHeight}px`;
      list.toggleAttribute('data-above', spot.above);
      if (first) {
        // A transformed ancestor would make it fixed to itself, not to the window: measure once and make up for it.
        const got = list.getBoundingClientRect();
        if (Math.abs(got.top - spot.top) > 0.5 || Math.abs(got.left - spot.left) > 0.5) {
          shift = { x: got.left - spot.left, y: got.top - spot.top };
          list.style.top = `${spot.top - shift.y}px`;
          list.style.left = `${spot.left - shift.x}px`;
        }
        list.setAttribute('data-placed', '');
      }
    };
    place(true);
    let frame = 0;
    const later = (event?: Event) => {
      if (event && event.target instanceof Node && list.contains(event.target)) return; // the list's own scroll
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place(false);
      });
    };
    window.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    window.visualViewport?.addEventListener('resize', later);
    window.visualViewport?.addEventListener('scroll', later);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', later, true);
      window.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('scroll', later);
    };
  }, [open, host, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (list && option) list.scrollTop = scrollToShow(list, option);
  }, [active, open]);

  // Фокус всегда на кнопке (шаблон select-only combobox): стрелки двигают выделение в листке.
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => enabledFrom(index + 1, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => enabledFrom(index - 1, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(enabledFrom(0, 1));
        return;
      case 'End':
        event.preventDefault();
        setActive(enabledFrom(options.length - 1, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        close(false);
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const now = Date.now();
          typed.current = { text: now - typed.current.at < 700 ? typed.current.text + event.key : event.key, at: now };
          const needle = typed.current.text.toLocaleLowerCase('ru-RU');
          const found = options.findIndex(
            (option) => !option.disabled && option.label.toLocaleLowerCase('ru-RU').startsWith(needle),
          );
          if (found >= 0) setActive(found);
        }
    }
  };

  // span, а не ul/li: список стоит и внутри абзаца («В билете [2] вопроса»), где ul недопустим.
  const list = open ? (
    <span ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="ps-list" data-float="">
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <span
            key={String(option.value)}
            id={`${id}-opt-${index}`}
            role="option"
            aria-selected={selected}
            aria-disabled={option.disabled || undefined}
            data-index={index}
            data-active={index === active ? '' : undefined}
            className="ps-option"
            onPointerMove={() => !option.disabled && setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(index)}
          >
            <span className="ps-label">{option.label}</span>
            {selected && (
              <svg className="ps-tick" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8.6 6.4 12 13 4.6" />
              </svg>
            )}
          </span>
        );
      })}
    </span>
  ) : null;

  return (
    <span ref={rootRef} className={`ps-root${props.className ? ` ${props.className}` : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className="ps-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        data-value={String(value)}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKey}
      >
        <span className="ps-value">{current?.label ?? ''}</span>
        <ChevronDown aria-hidden="true" strokeWidth={2} className="ps-chevron" data-open={open ? '' : undefined} />
      </button>
      {list && host ? createPortal(list, host) : list}
    </span>
  );
}
