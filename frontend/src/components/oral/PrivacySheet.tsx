import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

interface PrivacySheetProps {
  /** The privacy line of contracts §7.2, word for word. */
  text: string;
  onClose: () => void;
}

/**
 * «Кто видит ответ» on a phone while answering (redesign critique 11): the privacy paragraph would
 * sit under the fixed answer bar, so one link opens it in a bottom sheet instead. Esc, the scrim and
 * «Закрыть» close it; the focus stays inside and returns to the link; the page under it holds still.
 */
export default function PrivacySheet({ text, onClose }: PrivacySheetProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      root.style.overflow = previous;
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // The sheet has one control: Tab stays on it.
  const trap = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    closeRef.current?.focus();
  };

  return (
    <>
      <div className="or-psh-scrim" aria-hidden="true" onClick={onClose} />
      <div className="or-psh" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trap}>
        <p id={titleId} className="or-psh-t">
          Кто видит ответ
        </p>
        <p className="or-psh-text">{text}</p>
        <button ref={closeRef} type="button" className="sf-link" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </>
  );
}
