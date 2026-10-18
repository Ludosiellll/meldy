import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import './moreMenu.css';

/**
 * «Ещё»: the secondary actions of a screen in one menu, so the screen keeps one main action in sight
 * (10_Project/Phone_Declutter_2026-10-08). The same menu as the lecture's «⋯» (`.sf-menu`): arrows move between
 * items, Escape closes it and gives the focus back to the button, Tab and a click outside close it; an action gives
 * the focus back to the button before it runs. A switch (`checked`) is turned in place: the menu stays open on it.
 *
 * `variant="text"` is a quiet «Ещё» link in a row of links; `variant="round"` is the 44 px «⋯» circle. The menu opens
 * under its button, or above it when it would leave the window there and the room above is larger (measured as it
 * opens, before it is painted: a subject's «⋯» near the bottom of «Настройки», usability check 2026-10-10, n1).
 */

/** The menu's distance from its button and the least room it keeps to the window's edge (px). */
const MENU_GAP = 8;
const MENU_EDGE = 8;

/**
 * The menu opens upwards: under the button it would pass the window's bottom, and above it there is more room.
 * `button` is the button's box in the window, `viewHeight` the window's height (the visual viewport on a phone).
 */
export function opensUp(button: { top: number; bottom: number }, menuHeight: number, viewHeight: number): boolean {
  const below = viewHeight - button.bottom - MENU_GAP - MENU_EDGE;
  const above = button.top - MENU_GAP - MENU_EDGE;
  return menuHeight > below && above > below;
}

/** Above the button: stronger than a page's own «top» for its menu (`.ct-more`, the oral page's head). */
const UPWARDS: CSSProperties = { top: 'auto', bottom: `calc(100% + ${MENU_GAP}px)` };
export interface MoreMenuItem {
  key: string;
  label: ReactNode;
  /** A page of the app. */
  to?: string;
  /** Anything else (a dialog, a switch). */
  onSelect?: () => void;
  /**
   * A switch (role menuitemcheckbox): its state is drawn as the app's switch and said by aria-checked. Choosing it
   * runs `onSelect` (which turns it) and keeps the menu open, so the new state is seen at once.
   */
  checked?: boolean;
  /** Under a switch's label, smaller, read as its description («и проверить, что помните их»). */
  hint?: ReactNode;
  /** «Удалить …»: drawn in the danger colour, after a line. */
  danger?: boolean;
  /** A line above this item. */
  separatorBefore?: boolean;
  /** The item opens a dialog (aria-haspopup): «Удалить», «Время в день», «Пригласить группу» on the exam's page. */
  haspopup?: 'dialog';
}

interface MoreMenuProps {
  items: MoreMenuItem[];
  /** The accessible name of the button and the menu («Ещё: лист экзамена»). */
  label?: string;
  /** The visible word of the text button. */
  text?: string;
  variant?: 'text' | 'round';
  /** The menu always opens upwards (a bar at the bottom of the screen); otherwise only when there is no room below. */
  up?: boolean;
  /** The menu's left edge at the button's (it opens to the right). */
  alignStart?: boolean;
  className?: string;
}

const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"]';

export default function MoreMenu({ items, label = 'Ещё', text = 'Ещё', variant = 'text', up = false, alignStart = false, className = '' }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);

  // Where it opens is measured as it opens, before the first paint: the button's place in the window and the menu's height.
  useLayoutEffect(() => {
    if (!open || up) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu || typeof window === 'undefined') return;
    const view = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
    setFlip(view > 0 && opensUp(button.getBoundingClientRect(), menu.offsetHeight, view));
  }, [open, up]);

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
        <div
          id={menuId}
          ref={menuRef}
          className="sf-menu mm-menu"
          role="menu"
          aria-label={label}
          data-up={up || flip ? '' : undefined}
          data-start={alignStart ? '' : undefined}
          style={flip && !up ? UPWARDS : undefined}
        >
          {items.map((item) => (
            <MenuRow key={item.key} item={item} onPicked={close} buttonRef={buttonRef} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({ item, onPicked, buttonRef }: { item: MoreMenuItem; onPicked: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const hintId = useId();
  const sep = item.separatorBefore || item.danger ? <div className="sf-menu-sep" role="separator" /> : null;
  if (item.checked !== undefined) {
    // A switch stays in its menu: the focus stays on it, and its state changes under the eye.
    return (
      <>
        {sep}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={item.checked}
          aria-describedby={item.hint ? hintId : undefined}
          className="mm-item mm-check"
          onClick={() => item.onSelect?.()}
        >
          <span className="mm-check-text">
            <span>{item.label}</span>
            {/* The name is the label; the hint is the item's description (and seen under it). */}
            {item.hint ? (
              <span className="mm-check-hint" id={hintId} aria-hidden="true">
                {item.hint}
              </span>
            ) : null}
          </span>
          <span className="mm-switch" aria-hidden="true" />
        </button>
      </>
    );
  }
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
        aria-haspopup={item.haspopup}
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
