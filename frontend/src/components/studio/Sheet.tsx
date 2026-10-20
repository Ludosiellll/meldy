import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { STUDIO } from './copyStudio';
import { UiIcon } from './icons';

/**
 * A sheet from the bottom of a phone's screen (the palette, the settings): the page stays behind it, dimmed; Escape,
 * the backdrop or «Закрыть» close it, and the focus comes back to where it was. `away`: out of sight while it stays
 * mounted (a block dragged by finger out of «Блоки» — the drop is not blind).
 */
export default function Sheet({ title, onClose, children, className, away = false }: { title: string; onClose: () => void; children: ReactNode; className?: string; away?: boolean }) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.focus({ preventScroll: true });
    return () => back.current?.focus?.({ preventScroll: true });
  }, []);
  return createPortal(
    <div className="st-sheet-wrap" data-away={away ? '' : undefined} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={boxRef}
        className={`st-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="st-sheet-head">
          <span className="st-sheet-grip" aria-hidden="true" />
          <h2 id={id} className="st-sheet-title">
            {title}
          </h2>
          <button type="button" className="st-icon-btn" aria-label={STUDIO.previewClose} onClick={onClose}>
            <UiIcon name="close" />
          </button>
        </div>
        <div className="st-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
