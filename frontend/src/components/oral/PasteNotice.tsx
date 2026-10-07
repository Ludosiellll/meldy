import { useEffect, useRef } from 'react';
import type { PasteGuard } from './usePasteGuard';

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Brings the refusal line into view when it is not seen whole (QA 2026-10-07: at 1280×720 it appeared
 * under the window's edge and a refused paste looked like nothing happened). The least scroll that
 * shows it — scrollIntoView «nearest», its scroll-margin keeping it clear of the bars pinned over the
 * page (oral.css) — smooth, or at once under reduced motion. Nothing takes the focus: the student
 * stays in the field.
 */
export function revealNotice(element: HTMLElement): void {
  if (typeof element.scrollIntoView !== 'function') return;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.scrollMarginTop) || 0;
  const marginBottom = parseFloat(style.scrollMarginBottom) || 0;
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0;
  const bottom = top + (viewport ? viewport.height : window.innerHeight);
  if (rect.top - marginTop >= top && rect.bottom + marginBottom <= bottom) return;
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
}

/**
 * The line under an answer field that says why a paste was refused («Чистый ответ», Н7): a status line,
 * shown like the room's other notices only while there is something to say, and the field's description
 * while it is there. Each refused paste brings it into view (revealNotice).
 */
export default function PasteNotice({ guard }: { guard: Pick<PasteGuard, 'notice' | 'noticeId'> & Partial<Pick<PasteGuard, 'refusals'>> }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const shown = Boolean(guard.notice);
  useEffect(() => {
    if (shown && ref.current) revealNotice(ref.current);
  }, [shown, guard.refusals]);
  if (!guard.notice) return null;
  return (
    <p ref={ref} id={guard.noticeId} className="or-paste-note" role="status">
      {guard.notice}
    </p>
  );
}
