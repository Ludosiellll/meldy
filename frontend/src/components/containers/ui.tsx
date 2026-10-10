import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as copy from './copy';
import './containers.css';

/**
 * Small pieces the exam's screens share: the screen's one hand-drawn yellow line under a few words (design language
 * 3), a sheet (a bottom sheet on a phone, a dialog card on a computer) and the arrow of a row.
 */

/** The yellow line under the key words, drawn in once; under reduced motion it is simply there. */
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="ct-mark">
      {children}
      <svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path pathLength={1} d="M4 15 C 80 7, 170 6, 262 10 S 362 15, 396 8" />
      </svg>
    </span>
  );
}

export function Chevron() {
  return (
    <svg className="ct-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The sheet's own action row at the bottom (the one blue pill of the screen while the sheet is open). */
  actions?: ReactNode;
  /** No «Закрыть»: the sheet closes by its own buttons, the scrim or Escape. */
  bare?: boolean;
  className?: string;
}

/**
 * A modal sheet: on a phone it rises from the bottom over a dimmed page (the page's own bar stays under it, the
 * critique's N4); on a computer it is a card in the middle. Escape and the scrim close it, the focus moves to the sheet
 * (or the control it names with data-autofocus) and comes back to what opened it, Tab stays inside.
 */
export function Sheet({ title, onClose, children, actions, bare = false, className = '' }: SheetProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    // The sheet itself takes the focus (its title is read; Tab goes to its first control), unless it names one.
    const first = node?.querySelector<HTMLElement>('[data-autofocus]');
    (first ?? node)?.focus({ preventScroll: true });
    const back = opener.current;
    const onKey = (event: KeyboardEvent) => {
      // An open list in the sheet (PaperSelect) takes Escape itself: it closes, the sheet stays.
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === 'Escape' && target?.getAttribute('role') === 'combobox' && target.getAttribute('aria-expanded') === 'true') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null || item === document.activeElement);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && at <= 0) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && at === items.length - 1) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (back && back.isConnected) {
        try {
          back.focus({ preventScroll: true });
        } catch {
          back.focus();
        }
      }
    };
  }, []);

  const sheet = (
    <div className="ct-sheet-root" data-ct-sheet="">
      <div className="ct-scrim" aria-hidden="true" onClick={() => closeRef.current()} />
      <div ref={ref} className={`ct-sheet ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="ct-sheet-head">
          <h2 className="ct-sheet-t" id={titleId}>
            {title}
          </h2>
          {bare ? null : (
            <button type="button" className="sf-link ct-sheet-x" data-muted="" onClick={() => closeRef.current()}>
              {copy.CLOSE}
            </button>
          )}
        </div>
        <div className="ct-sheet-body">{children}</div>
        {actions ? <div className="ct-sheet-acts">{actions}</div> : null}
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}

/** A line of words with a link at its end («4 вопроса без ключа не идут в занятия. Отметить ответы»). */
export function NoteLine({ text, action, tone }: { text: string; action?: ReactNode; tone?: 'ink' }) {
  return (
    <p className="ct-note" data-tone={tone}>
      {text}
      {action ? <> {action}</> : null}
    </p>
  );
}
