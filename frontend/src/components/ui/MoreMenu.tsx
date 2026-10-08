import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import './moreMenu.css';

/**
 * «Ещё»: the secondary actions of a screen in one menu, so the screen keeps one main action in sight
 * (10_Project/Phone_Declutter_2026-10-08). The same menu as the lecture's «⋯» (`.sf-menu`): arrows move between
 * items, Escape closes it and gives the focus back to the button, Tab and a click outside close it; an action gives
 * the focus back to the button before it runs.
 *
 * `variant="text"` is a quiet «Ещё» link in a row of links; `variant="round"` is the 44 px «⋯» circle.
 */
export interface MoreMenuItem {
  key: string;
  label: ReactNode;
  /** A page of the app. */
  to?: string;
  /** Anything else (a dialog, a switch). */
  onSelect?: () => void;
  /** «Удалить …»: drawn in the danger colour, after a line. */
  danger?: boolean;
  /** A line above this item. */
  separatorBefore?: boolean;
}

interface MoreMenuProps {
  items: MoreMenuItem[];
  /** The accessible name of the button and the menu («Ещё: лист экзамена»). */
  label?: string;
  /** The visible word of the text button. */
  text?: string;
  variant?: 'text' | 'round';
  /** The menu opens upwards (a bar at the bottom of the screen). */
  up?: boolean;
  /** The menu's left edge at the button's (it opens to the right). */
  alignStart?: boolean;
  className?: string;
}

const ITEMS = '[role="menuitem"]';

export default function MoreMenu({ items, label = 'Ещё', text = 'Ещё', variant = 'text', up = false, alignStart = false, className = '' }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Tab leaves the menu: it closes behind the focus instead of staying open over the page.
    if (event.key === 'Tab' && open) {
      setOpen(false);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (!open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End')) return;
    const list = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    if (list.length === 0) return;
    event.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === 'End') next = list.length - 1;
    else if (event.key === 'ArrowDown') next = (at + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
    list[next].focus();
  };

  if (items.length === 0) return null;

  return (
    <div className={`sf-head-more mm-root ${className}`.trim()} ref={rootRef} onKeyDown={onKeyDown} data-variant={variant}>
      <button
        ref={buttonRef}
        type="button"
        className={variant === 'round' ? 'sf-more mm-round' : 'sf-link mm-text'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={variant === 'round' || label !== text ? label : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {variant === 'round' ? <MoreHorizontal aria-hidden="true" strokeWidth={1.75} /> : text}
      </button>
      {open ? (
        <div id={menuId} className="sf-menu mm-menu" role="menu" aria-label={label} data-up={up ? '' : undefined} data-start={alignStart ? '' : undefined}>
          {items.map((item) => (
            <MenuRow key={item.key} item={item} onPicked={close} buttonRef={buttonRef} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({ item, onPicked, buttonRef }: { item: MoreMenuItem; onPicked: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const sep = item.separatorBefore || item.danger ? <div className="sf-menu-sep" role="separator" /> : null;
  if (item.to) {
    return (
      <>
        {sep}
        <Link to={item.to} role="menuitem" className="mm-item" data-danger={item.danger ? '' : undefined} onClick={onPicked}>
          {item.label}
        </Link>
      </>
    );
  }
  return (
    <>
      {sep}
      <button
        type="button"
        role="menuitem"
        className="mm-item"
        data-danger={item.danger ? '' : undefined}
        onClick={() => {
          onPicked();
          // The focus goes back to «Ещё» (the item is gone with the menu); a dialog the action opens takes it from there.
          buttonRef.current?.focus();
          item.onSelect?.();
        }}
      >
        {item.label}
      </button>
    </>
  );
}
