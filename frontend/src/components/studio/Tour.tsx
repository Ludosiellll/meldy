import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getProfile, markOnboardingTourSeen } from '../../api/social';
import { STUDIO } from './copyStudio';
import { tourClipFits } from './phone';
import TourClip from '../clips/TourClip';

/**
 * The first visit's tour (spec §47.6 «При первом входе — короткое знакомство»): editing in place, «/», «Посмотреть как
 * участник». A small card beside what it talks about; it never takes the focus and never covers the field being typed
 * in (the page works under it), «Пропустить» ends it. Its first step plays the clip «Свой тест» from the studio on
 * (components/clips: the studio's first-use tip is the tour itself).
 *
 * UX audit of 21.10: the tour comes once the page has its first block (StudioPage, useStudioTour), not over the empty
 * page's starters; a computer leaves out «Блоки», whose words the palette's own line already says; the clip no longer
 * opens with «Новый тест», which is behind the author already; seen once per user — on this device and in the profile
 * (`onboarding_status.studio_tour`), as the first-use tips are.
 *
 * On a phone (phone audit of 19.10: the card took 459 of 667 px, showed the computer's studio and said «Перетащите
 * «Заголовок» на страницу»): no clip below 480 px or on a low screen (tourClipFits), the phone's own words for «Блоки»
 * (its palette is a sheet behind the bottom bar) and for the settings, one counter (the clip's own is hidden,
 * studio.css), and the card scrolls inside itself when the screen is lower than it.
 */

export const tourKey = (userId: string) => `meldy_studio_tour:${userId}`;
/** The profile's `onboarding_status` key. */
export const TOUR_PROFILE_KEY = 'studio_tour';

export function tourSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(tourKey(userId)) === '1';
  } catch {
    return true;
  }
}

function rememberHere(userId: string) {
  try {
    window.localStorage.setItem(tourKey(userId), '1');
  } catch {
    // Private mode: the profile still remembers it.
  }
}

function markSeen(userId: string) {
  rememberHere(userId);
  void Promise.resolve()
    .then(() => markOnboardingTourSeen(userId, TOUR_PROFILE_KEY))
    .catch(() => undefined);
}

/**
 * Whether the tour is due: `ready` (the page has its first block), and neither this device nor the profile says it was
 * seen. The profile is read once; while it is unread, or cannot be read, nothing is shown (as with the tips).
 */
export function useStudioTour(userId: string | null | undefined, ready: boolean): boolean {
  const [due, setDue] = useState(false);
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !userId || asked.current === userId || tourSeen(userId)) return undefined;
    asked.current = userId;
    let live = true;
    void Promise.resolve()
      .then(() => getProfile(userId))
      .then(
        (row) => {
          if (!live || !row) return;
          if (row.onboarding_status?.[TOUR_PROFILE_KEY]) rememberHere(userId);
          else setDue(true);
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [ready, userId]);
  return due;
}

type Step = { title: string; text: string };
/** What each step points at: the palette, the page, «Посмотреть как участник». */
type Anchor = 'palette' | 'canvas' | 'preview';

const ANCHORS: Record<Anchor, string> = {
  palette: '[data-tour="palette"], [data-tour="palette-phone"]',
  canvas: '[data-tour="canvas"]',
  preview: '[data-tour="preview"]',
};

/** The steps: a computer without «Блоки» (the palette says it), a phone with its own «Блоки» and settings. */
export function tourSteps(phone: boolean): Array<{ step: Step; anchor: Anchor }> {
  const [, edit, slash, preview] = STUDIO.tour;
  if (phone) {
    return [
      { step: STUDIO.tourPhoneFirst, anchor: 'palette' },
      { step: STUDIO.tourPhoneEdit, anchor: 'canvas' },
      { step: slash, anchor: 'canvas' },
      { step: preview, anchor: 'preview' },
    ];
  }
  return [
    { step: edit, anchor: 'canvas' },
    { step: slash, anchor: 'canvas' },
    { step: preview, anchor: 'preview' },
  ];
}

export default function Tour({ userId, phone = false, onDone }: { userId: string; phone?: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; side: 'right' | 'below' | 'above' | 'inside' } | null>(null);
  const [roomy, setRoomy] = useState(() => tourClipFits(window.innerWidth || 1024, window.innerHeight || 768));
  const steps = tourSteps(phone);
  const last = step === steps.length - 1;
  const anchorKind = steps[step].anchor;

  const finish = () => {
    markSeen(userId);
    onDone();
  };

  useLayoutEffect(() => {
    const measure = () => {
      const anchor = document.querySelector<HTMLElement>(ANCHORS[anchorKind]);
      const box = boxRef.current?.getBoundingClientRect();
      const width = box?.width || 320;
      const height = box?.height || 180;
      const viewW = window.innerWidth || 1024;
      const viewH = window.innerHeight || 768;
      setRoomy(tourClipFits(viewW, viewH));
      if (!anchor) {
        setPlace({ top: Math.max(16, viewH - height - 24), left: Math.max(16, (viewW - width) / 2), side: 'inside' });
        return;
      }
      const rect = anchor.getBoundingClientRect();
      if (rect.top > viewH * 0.6) {
        // An anchor low on the screen (a phone's bar): the card stands above it.
        setPlace({ top: Math.max(16, rect.top - height - 14), left: Math.min(Math.max(16, rect.left), viewW - width - 16), side: 'above' });
      } else if (anchorKind === 'palette' && rect.right + width + 24 < viewW) {
        setPlace({ top: Math.min(Math.max(16, rect.top + 64), viewH - height - 16), left: rect.right + 16, side: 'right' });
      } else if (anchorKind === 'preview') {
        setPlace({ top: Math.min(rect.bottom + 12, viewH - height - 16), left: Math.min(Math.max(16, rect.right - width), viewW - width - 16), side: 'below' });
      } else {
        // Inside the page, at its top right: out of the way of the text being typed.
        setPlace({ top: Math.min(Math.max(16, rect.top + 20), viewH - height - 16), left: Math.max(16, Math.min(rect.right - width - 20, viewW - width - 16)), side: 'inside' });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step, roomy, anchorKind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && boxRef.current?.contains(document.activeElement)) finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const card = steps[step].step;
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
      <div className="st-tour-in">
        {step === 0 && roomy ? <TourClip /> : null}
        <p className="st-tour-step">{STUDIO.tourStep(step + 1, steps.length)}</p>
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
            {steps.map((_, at) => (
              <span key={at} data-on={at === step ? '' : undefined} />
            ))}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
