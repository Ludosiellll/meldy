import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STUDIO } from './copyStudio';
import TourClip from '../clips/TourClip';

/**
 * The first visit's tour (spec §47.6 «При первом входе — короткое знакомство в 4 шага»): the palette, editing in place,
 * «/», «Посмотреть как участник». A small card beside what it talks about; it never takes the focus and never covers
 * the field being typed in (the page works under it), «Пропустить» ends it. Seen once per user on this device. Its first
 * step plays the clip «Свой тест» (components/clips): the studio's first-use tip is the tour itself.
 */

const ANCHORS = ['[data-tour="palette"], [data-tour="palette-phone"]', '[data-tour="canvas"]', '[data-tour="canvas"]', '[data-tour="preview"]'];

export const tourKey = (userId: string) => `meldy_studio_tour:${userId}`;

export function tourSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(tourKey(userId)) === '1';
  } catch {
    return true;
  }
}

function markSeen(userId: string) {
  try {
    window.localStorage.setItem(tourKey(userId), '1');
  } catch {
    // Private mode: the tour shows once per page load.
  }
}

export default function Tour({ userId, phone = false, onDone }: { userId: string; phone?: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; side: 'right' | 'below' | 'above' | 'inside' } | null>(null);
  const last = step === STUDIO.tour.length - 1;

  const finish = () => {
    markSeen(userId);
    onDone();
  };

  useLayoutEffect(() => {
    const measure = () => {
      const anchor = document.querySelector<HTMLElement>(ANCHORS[step]);
      const box = boxRef.current?.getBoundingClientRect();
      const width = box?.width || 320;
      const height = box?.height || 180;
      const viewW = window.innerWidth || 1024;
      const viewH = window.innerHeight || 768;
      if (!anchor) {
        setPlace({ top: Math.max(16, viewH - height - 24), left: Math.max(16, (viewW - width) / 2), side: 'inside' });
        return;
      }
      const rect = anchor.getBoundingClientRect();
      if (rect.top > viewH * 0.6) {
        // An anchor low on the screen (a phone's bar): the card stands above it.
        setPlace({ top: Math.max(16, rect.top - height - 14), left: Math.min(Math.max(16, rect.left), viewW - width - 16), side: 'above' });
      } else if (step === 0 && rect.right + width + 24 < viewW) {
        setPlace({ top: Math.min(Math.max(16, rect.top + 64), viewH - height - 16), left: rect.right + 16, side: 'right' });
      } else if (step === 3) {
        setPlace({ top: Math.min(rect.bottom + 12, viewH - height - 16), left: Math.min(Math.max(16, rect.right - width), viewW - width - 16), side: 'below' });
      } else {
        // Inside the page, at its top right: out of the way of the text being typed.
        setPlace({ top: Math.min(Math.max(16, rect.top + 20), viewH - height - 16), left: Math.max(16, Math.min(rect.right - width - 20, viewW - width - 16)), side: 'inside' });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && boxRef.current?.contains(document.activeElement)) finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const card = phone && step === 0 ? STUDIO.tourPhoneFirst : STUDIO.tour[step];
  return createPortal(
    <div
      ref={boxRef}
      className="st-tour"
      role="dialog"
      aria-modal="false"
      aria-label={STUDIO.tourLabel}
      data-side={place?.side}
      style={place ? { top: place.top, left: place.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {step === 0 ? <TourClip /> : null}
      <p className="st-tour-step">{STUDIO.tourStep(step + 1, STUDIO.tour.length)}</p>
      <h2 className="st-tour-title">{card.title}</h2>
      <p className="st-tour-text">{card.text}</p>
      <div className="st-tour-acts">
        <button type="button" className="st-pill st-pill-dark" onClick={() => (last ? finish() : setStep((n) => n + 1))}>
          {last ? STUDIO.tourDone : STUDIO.tourNext}
        </button>
        {last ? null : (
          <button type="button" className="sf-link" data-muted="" onClick={finish}>
            {STUDIO.tourSkip}
          </button>
        )}
        <span className="st-tour-dots" aria-hidden="true">
          {STUDIO.tour.map((_, at) => (
            <span key={at} data-on={at === step ? '' : undefined} />
          ))}
        </span>
      </div>
    </div>,
    document.body,
  );
}
