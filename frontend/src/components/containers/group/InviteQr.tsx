import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { qrCode, shortLink } from '../../../lib/quizzes/qr';
import { INVITE } from '../copyImport';

/**
 * «Показать QR» of the group's link (release 47.3): the code over the whole screen with the address in large letters,
 * for a projector or a phone held up in class, drawn on the device from the link (lib/quizzes/qr.ts, read as it is;
 * nothing is sent). Escape or «Закрыть» closes it — only it: the invite under it stays open — and the focus goes back
 * to «Показать QR». The one control keeps the focus.
 */
const QUIET = 4;

export default function InviteQr({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeWith = useRef(onClose);
  closeWith.current = onClose;
  const code = useMemo(() => qrCode(url), [url]);
  const outer = code.size + QUIET * 2;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    // Captured on the document before the invite's own Escape: this screen closes, the invite stays.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeWith.current();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="gr-qr-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="gr-qr">
        <h2 id={titleId} className="gr-qr-t">
          {title}
        </h2>
        <svg className="gr-qr-code" viewBox={`${-QUIET} ${-QUIET} ${outer} ${outer}`} role="img" aria-label={INVITE.qrTitle} shapeRendering="crispEdges">
          <rect x={-QUIET} y={-QUIET} width={outer} height={outer} fill="#fff" />
          <path d={code.path} fill="#0b121c" />
        </svg>
        <p className="gr-qr-link">
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
        <p className="gr-qr-hint">{INVITE.qrHint}</p>
        <button ref={closeRef} type="button" className="sf-secondary gr-qr-close" onClick={() => closeWith.current()}>
          {INVITE.qrClose}
        </button>
      </div>
    </div>,
    document.body,
  );
}
