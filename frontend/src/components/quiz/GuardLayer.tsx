import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GUARD } from './copyTake';
import type { GuardView } from './useGuard';
import './guard.css';

/**
 * What «Защита от списывания» draws over the attempt (useGuard keeps it up to date with attribute writes, not renders):
 * - the cover: an opaque card over the whole screen, always in the page and invisible (its opacity on its own
 *   compositor layer), turned on by data-on the moment the page is away; it says why (away, split, fullscreen ended —
 *   with the button back to fullscreen). It lives on document.body, over the sheets.
 * - the strict level's watermark: the participant's name and the attempt's start, faint, repeated across the screen,
 *   one fixed layer painted once (an SVG as a mask over the ink colour, so both themes have it).
 * - GuardLine: the line under the clock once the page has been away («Вы покидали страницу: 1 раз…»), and the strict
 *   level's note after a refused copy.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** «20.10, 14:32» in the device's time. */
export function markTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);

/** The watermark's tile: the words twice, turned, as a data URL for a CSS mask. */
export function markTile(words: string): string {
  const text = escapeXml(words.slice(0, 120));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="190" viewBox="0 0 340 190">` +
    `<g transform="rotate(-24 170 95)" font-family="Onest, Arial, sans-serif" font-size="15" font-weight="600" fill="#000">` +
    `<text x="20" y="70">${text}</text><text x="120" y="150">${text}</text></g></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export default function GuardLayer({ guard, name, startedAt }: { guard: GuardView; name: string; startedAt: string }) {
  const mark = useMemo(() => (name.trim() ? markTile(GUARD.mark(name.trim(), markTime(startedAt))) : null), [name, startedAt]);
  if (guard.level === 'off' || typeof document === 'undefined') return null;
  return createPortal(
    <>
      {guard.level === 'strict' && mark ? <div className="qg-mark" aria-hidden="true" style={{ WebkitMaskImage: mark, maskImage: mark }} /> : null}
      <div ref={guard.coverRef} className="qg-cover" data-reason="away" aria-hidden="true">
        <div className="qg-card" role="status">
          <div className="qg-msg" data-for="away">
            <p className="qg-t">{GUARD.awayTitle}</p>
            <p className="qg-x">{GUARD.awayText}</p>
          </div>
          <div className="qg-msg" data-for="split">
            <p className="qg-t">{GUARD.splitTitle}</p>
            <p className="qg-x">{GUARD.splitText}</p>
          </div>
          <div className="qg-msg" data-for="fullscreen">
            <p className="qg-t">{GUARD.fullscreenTitle}</p>
            <p className="qg-x">{GUARD.fullscreenText}</p>
            <button type="button" className="sf-primary qg-back" onClick={guard.resumeFullscreen}>
              {GUARD.fullscreenBack}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** The line under the clock: nothing until the page has been away (or a copy was refused). */
export function GuardLine({ guard, limit }: { guard: GuardView; limit: number }) {
  if (guard.level === 'off' || (guard.count === 0 && !guard.copyRefused)) return null;
  return (
    <div className="qg-lines">
      {guard.count > 0 ? (
        <p className="qg-line" role="status" data-strict={guard.level === 'strict' ? '' : undefined}>
          {GUARD.line(guard.count, guard.level, limit, guard.lastMs)}
        </p>
      ) : null}
      {guard.copyRefused ? <p className="qg-line">{GUARD.noCopy}</p> : null}
    </div>
  );
}
