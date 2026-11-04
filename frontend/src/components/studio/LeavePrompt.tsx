import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { nb } from '../containers/copyImport';

/**
 * The question before the studio is left with something not saved (StudioPage; owner, 04.11): «В вопросе 3 есть
 * несохранённые правки» — «Сохранить и выйти», «Не сохранять», «Остаться». A dialog over the page: the focus starts on
 * the first answer and stays inside; Escape and a press beside it mean «Остаться»; the focus comes back to where it was.
 * While the save runs its answers wait; a save that did not go says so in it, and the page stays.
 */
export default function LeavePrompt({
  title,
  text,
  problem,
  busy,
  saveLabel,
  discardLabel,
  stayLabel,
  onSave,
  onDiscard,
  onStay,
}: {
  title: string;
  text: string | null;
  /** Why «Сохранить» did not go (the question's own line is in its editor). */
  problem: string | null;
  busy: boolean;
  /** null: nothing here can be saved (the page waits for «Обновить»), only leaving or staying. */
  saveLabel: string | null;
  discardLabel: string;
  stayLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      if (back.current?.isConnected) back.current.focus({ preventScroll: true });
    };
  }, []);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onStay();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(boxRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="st-ask-wrap" onPointerDown={(event) => event.target === event.currentTarget && !busy && onStay()}>
      <div
        ref={boxRef}
        className="st-ask"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={text || problem ? `${id}-text` : undefined}
        aria-busy={busy || undefined}
        onKeyDown={onKey}
      >
        <h2 id={`${id}-title`} className="st-ask-title">
          {nb(title)}
        </h2>
        {text || problem ? (
          <div id={`${id}-text`}>
            {text ? <p className="st-ask-text">{nb(text)}</p> : null}
            {problem ? (
              <p className="st-ask-text" data-bad="" role="alert">
                {nb(problem)}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="st-ask-acts">
          {saveLabel ? (
            <button type="button" className="sf-primary st-ask-save" disabled={busy} aria-busy={busy || undefined} onClick={onSave}>
              {saveLabel}
            </button>
          ) : null}
          <button type="button" className="st-ask-quiet" disabled={busy} onClick={onDiscard}>
            {discardLabel}
          </button>
          <button type="button" className="st-ask-quiet" data-stay="" disabled={busy} onClick={onStay}>
            {stayLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
