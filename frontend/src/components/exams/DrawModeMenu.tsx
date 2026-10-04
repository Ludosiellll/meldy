import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DrawMode } from '../../lib/exams/draw';
import type { FrameBox } from './useFrame';

/** The ways of drawing (contracts §8, Jury_Check item 4), in the words of the sheet (redesign spec 5.9). */
export const DRAW_MODES: DrawMode[] = ['exam', 'weak', 'answered', 'awaiting'];

export const DRAW_CAPTIONS: Record<DrawMode, string> = {
  exam: 'Как на экзамене',
  weak: 'Чаще слабые',
  answered: 'Из вопросов, на которые вы уже отвечали',
  awaiting: 'Из вопросов, которые ждут подтверждения',
};

export const DRAW_HINTS: Record<DrawMode, string> = {
  exam: 'Случайные вопросы; известные билеты — целиком. Отметки пунктов во время ответа выключены.',
  weak: 'Чаще не проверявшиеся и не засчитанные; вопросов без материала не будет.',
  answered: 'Только вопросы, на которые вы уже отвечали.',
  // «в другой день» belongs to the rule too: an answer 20 hours later on the same day confirms nothing.
  awaiting: 'Засчитаны раньше — в другой день и не меньше 20 часов назад: хороший ответ сейчас подтвердит вопрос.',
};

/** 'exam' is the default and stays out of the address: /draw, /draw?mode=weak|answered|awaiting. */
export function drawModeOf(value: string | null): DrawMode {
  return value === 'weak' || value === 'answered' || value === 'awaiting' ? value : 'exam';
}

interface DrawModeMenuProps {
  mode: DrawMode;
  onChange: (mode: DrawMode) => void;
  /**
   * 'popover' under the desktop pill; 'sheet' on phones and tablets: a bottom sheet over the page
   * (the fixed «Тянуть билет» bar leaves no room for a popover).
   */
  variant: 'popover' | 'sheet';
  /** The page root (.sf-page) the bottom sheet is put into, so it is above the fixed bar. */
  sheetHost?: HTMLElement | null;
  /** Left and right edges of the page frame: the bottom sheet spans exactly the page. */
  frameBox?: FrameBox;
  className?: string;
}

/**
 * «Как на экзамене · изменить»: the way of drawing in words and a menu of the ways. The same
 * control under the desktop pill, under the fixed phone bar and on the draw page itself, so the mode is
 * never only in the address (stage QA round 2). Menu keys: arrows, Home, End, Escape, Tab.
 */
export default function DrawModeMenu({ mode, onChange, variant, sheetHost, frameBox, className = '' }: DrawModeMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const sheet = variant === 'sheet';

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  // The chosen way gets the focus when the menu opens.
  useEffect(() => {
    if (!open) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [open]);

  // A click outside closes the popover; the sheet has its own scrim.
  useEffect(() => {
    if (!open || sheet) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, sheet, close]);

  // The bottom sheet holds the page still while it is open (the window is the scroller).
  useEffect(() => {
    if (!open || !sheet) return;
    const targets = [document.documentElement, document.body];
    const previous = targets.map((element) => element.style.overflow);
    targets.forEach((element) => {
      element.style.overflow = 'hidden';
    });
    return () => {
      targets.forEach((element, index) => {
        element.style.overflow = previous[index];
      });
    };
  }, [open, sheet]);

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  };

  const choose = (next: DrawMode) => {
    if (next !== mode) onChange(next);
    close(true);
  };

  const items = DRAW_MODES.map((item) => (
    <button key={item} type="button" role="menuitemradio" aria-checked={mode === item} tabIndex={-1} onClick={() => choose(item)}>
      {DRAW_CAPTIONS[item]}
      <small>{DRAW_HINTS[item]}</small>
    </button>
  ));

  const menu = open ? (
    sheet ? (
      <>
        <div className="ex-scrim" aria-hidden="true" onClick={() => close(true)} />
        <div
          ref={menuRef}
          id={menuId}
          className="ex-mode-sheet"
          role="menu"
          aria-label="Как тянуть билет"
          onKeyDown={onMenuKey}
          style={{ left: frameBox?.left ?? 0, right: frameBox?.right ?? 0 }}
        >
          <p className="ex-mode-sheet-t" aria-hidden="true">
            Как тянуть билет
          </p>
          {items}
        </div>
      </>
    ) : (
      <div ref={menuRef} id={menuId} className="ex-mode-menu" role="menu" aria-label="Как тянуть билет" onKeyDown={onMenuKey}>
        {items}
      </div>
    )
  ) : null;

  return (
    <div ref={rootRef} className={`ex-mode ${className}`.trim()} data-variant={variant}>
      <p className="ex-draw-mode">
        <span className="ex-draw-mode-word">{DRAW_CAPTIONS[mode]}</span> ·{' '}
        <button
          ref={openerRef}
          type="button"
          className="sf-link"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          изменить
        </button>
      </p>
      {sheet && sheetHost && menu ? createPortal(menu, sheetHost) : menu}
    </div>
  );
}
