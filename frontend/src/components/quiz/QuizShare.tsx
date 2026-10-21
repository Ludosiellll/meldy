import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { qrCode, shortLink } from '../../lib/quizzes/qr';
import { QA_STATS } from './copyAuthor';
import './quizAuthor.css';

/**
 * Sharing a quiz's link from its stats page (release 47): «Показать QR» opens the code over the whole screen with the
 * link in large letters (for a projector or a phone held up in class; Escape or «Закрыть» closes it, the focus goes
 * back), «Поделиться» hands the link to the device's own sharing where there is one (navigator.share), «Открыть как
 * ученик» opens /k/<код> in a new tab. The code is drawn here from the link (lib/quizzes/qr.ts); nothing is sent.
 */

const QUIET = 4;

/** The code over the whole screen (also «Быстрая контрольная»'s link page, components/quick/QuickLink.tsx). */
export function QrScreen({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeWith = useRef(onClose);
  closeWith.current = onClose;
  const code = useMemo(() => qrCode(url), [url]);
  const outer = code.size + QUIET * 2;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeWith.current();
      } else if (event.key === 'Tab') {
        // The one control of the screen keeps the focus.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="qa-qr-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="qa-qr">
        <h2 id={titleId} className="qa-qr-t">
          {title}
        </h2>
        <svg
          className="qa-qr-code"
          viewBox={`${-QUIET} ${-QUIET} ${outer} ${outer}`}
          role="img"
          aria-label={QA_STATS.qrTitle}
          shapeRendering="crispEdges"
        >
          <rect x={-QUIET} y={-QUIET} width={outer} height={outer} fill="#fff" />
          <path d={code.path} fill="#0b121c" />
        </svg>
        <p className="qa-qr-link">
          {/* A narrow screen breaks the address after a «/», never inside the code. */}
          {shortLink(url)
            .split('/')
            .map((part, index) => (
              <span key={index}>
                {index > 0 ? '/' : null}
                {index > 0 ? <wbr /> : null}
                {part}
              </span>
            ))}
        </p>
        <p className="qa-qr-hint">{QA_STATS.qrHint}</p>
        <button ref={closeRef} type="button" className="sf-secondary qa-qr-close" onClick={() => closeWith.current()}>
          {QA_STATS.qrClose}
        </button>
      </div>
    </div>,
    document.body,
  );
}

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export default function QuizShare({ url, title }: { url: string; title: string }) {
  const [qr, setQr] = useState(false);
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await navigator.share({ title, url });
    } catch {
      // Closed without sharing, or the device refused: nothing to say.
    } finally {
      setSharing(false);
    }
  };
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  return (
    <>
      <p className="qa-shares">
        <button type="button" className="qa-share-b" aria-haspopup="dialog" onClick={() => setQr(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1" />
            <rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" />
            <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" strokeLinecap="round" />
          </svg>
          {QA_STATS.qr}
        </button>
        {canShare() ? (
          <button type="button" className="qa-share-b" aria-busy={sharing || undefined} onClick={() => void share()}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
            </svg>
            {QA_STATS.share}
          </button>
        ) : null}
        <a className="qa-share-b" href={path} target="_blank" rel="noopener noreferrer" aria-label={QA_STATS.asTakerLabel}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 5h5v5M19 5l-8 8M17 14v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />
          </svg>
          {QA_STATS.asTaker}
        </a>
      </p>
      {qr ? <QrScreen url={url} title={title} onClose={() => setQr(false)} /> : null}
    </>
  );
}
