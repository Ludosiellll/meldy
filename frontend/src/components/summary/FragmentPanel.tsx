import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePhone } from '../../lib/usePhone';
import { FragmentText } from './FragmentText';
import {
  closeFragmentPanel,
  openFragmentPanel,
  showFragment,
  useFragmentPanelState,
  type FragmentPanelOpen,
  type FragmentPanelRequest,
  type PanelFragment,
} from './fragmentPanelStore';
import './fragmentPanel.css';

/** A pull of the phone's sheet down by this much closes it. */
const DRAG_CLOSE = 90;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** «Фрагмент 4»; «Фрагмент лекции» for an id without a number. */
export function fragmentTitle(fragment: Pick<PanelFragment, 'number'>): string {
  return fragment.number === null ? 'Фрагмент лекции' : `Фрагмент ${fragment.number}`;
}

/** «S04» → 4, null for an id that is not an «S…» label. */
export function fragmentIdNumber(id: string): number | null {
  const match = /S0*(\d+)$/i.exec(id.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Where the app's top line ends (the menu line, the room's line of /try or of «Поговорить о лекции»): the panel and
 * its dim start under it, so the line stays as it was. 0 when there is none (Telegram's Mini App, tests).
 */
function barBottom(): number {
  if (typeof document === 'undefined') return 0;
  let bottom = 0;
  document.querySelectorAll<HTMLElement>('.sf-bar, .sf-room-bar').forEach((bar) => {
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0 && rect.top <= 1 && rect.bottom > bottom) bottom = rect.bottom;
  });
  return Math.max(0, Math.round(bottom));
}

function usePanelTop(): number {
  const [top, setTop] = useState(barBottom);
  useLayoutEffect(() => {
    const update = () => setTop(barBottom());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, []);
  return top;
}

/**
 * The panel itself: on a computer it comes in from the left under the top line, about 460 px wide and as tall as the
 * window, with a light dim over the rest of the page (nothing under it moves); on a phone it is a bottom sheet with a
 * handle, as «почему» on the exam page. The ×, Escape, a click on the dim and a pull of the sheet down close it; the
 * focus goes in and comes back to the chip that opened it.
 */
function FragmentPanel({ request }: { request: FragmentPanelRequest }) {
  const phone = usePhone();
  const top = usePanelTop();
  const panelRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const switchId = useId();
  const { fragments, owner } = request;
  const fragment = fragments.find((item) => item.id === request.current) ?? fragments[0];

  const close = useCallback(() => {
    const target = closeFragmentPanel(owner);
    if (target && target.isConnected) target.focus({ preventScroll: true });
  }, [owner]);

  // The focus goes into the panel with each opening (another chip replaces what it shows).
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [request.seq]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [close]);

  // The page under the dim stays where it is: a wheel or a swipe over the dim does not scroll it. A computer keeps its
  // scrollbar (hiding it would move the page sideways); a phone's sheet holds the page as «почему» does.
  useEffect(() => {
    const dim = dimRef.current;
    if (!dim) return undefined;
    const hold = (event: Event) => event.preventDefault();
    dim.addEventListener('wheel', hold, { passive: false });
    dim.addEventListener('touchmove', hold, { passive: false });
    return () => {
      dim.removeEventListener('wheel', hold);
      dim.removeEventListener('touchmove', hold);
    };
  }, []);
  useEffect(() => {
    if (!phone) return undefined;
    const targets = [document.documentElement, document.body];
    const previous = targets.map((element) => element.style.overflow);
    targets.forEach((element) => {
      element.style.overflow = 'hidden';
    });
    return () => {
      targets.forEach((element, index) => {
        element.style.overflow = previous[index];
      });
    };
  }, [phone]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current !== null) setDragY(Math.max(0, event.clientY - dragStart.current));
  };
  const onGripUp = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (dragY > DRAG_CLOSE) close();
    setDragY(0);
  };

  const label = fragment.number === null ? 'Фрагмент лекции' : `Фрагмент ${fragment.number} лекции`;
  // The panel sits in a portal, but React still passes its events up to the chip's card: a click on the fragment must
  // not also open the card's answer (FlashcardsView) or reach any other handler of the page under it.
  const keep = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return createPortal(
    <div
      className="fp-layer"
      data-phone={phone ? '' : undefined}
      data-still={request.replaced ? '' : undefined}
      style={{ '--fp-top': `${top}px` } as CSSProperties}
      onClick={keep}
      onPointerDown={keep}
      onMouseDown={keep}
      onKeyDown={keep}
    >
      <div ref={dimRef} className="fp-dim" aria-hidden="true" onClick={close} />
      <div
        ref={panelRef}
        className="fp-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={trapFocus}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        {phone && (
          <div
            className="fp-grip-area"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            style={{ touchAction: 'none' }}
          >
            <span className="fp-grip" aria-hidden="true" />
          </div>
        )}
        <div className="fp-head">
          {fragments.length > 1 ? (
            <div id={switchId} className="fp-switch" role="group" aria-label="Фрагменты лекции">
              {fragments.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="fp-pill"
                  aria-pressed={item.id === fragment.id}
                  onClick={() => showFragment(item.id)}
                >
                  {fragmentTitle(item)}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="fp-h">{fragmentTitle(fragment)}</h2>
          )}
          <button type="button" className="fp-close" aria-label="Закрыть фрагмент" onClick={close}>
            <X aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>
        {request.note ? <p className="fp-note">{request.note}</p> : null}
        <FragmentText key={fragment.id} id={fragment.id} text={fragment.text} stems={fragment.stems ?? []} />
      </div>
    </div>,
    document.body,
  );
}

export interface FragmentPanelHandle {
  /** Opens the panel with these fragments; another opening anywhere in the app replaces it. */
  open: (request: FragmentPanelOpen) => void;
  /** The fragment the panel shows for this component, or null when it is closed or shows another one's. */
  current: string | null;
  /** The panel, while this component has it: render it anywhere (it goes into a portal). */
  panel: ReactNode;
}

/**
 * A component that opens lecture fragments: `open(…)` from its chip, `current` marks the chip, `panel` is rendered by
 * it. One request for the whole app (fragmentPanelStore): only the component that opened the panel draws it.
 */
export function useFragmentPanel(): FragmentPanelHandle {
  const owner = useId();
  const state = useFragmentPanelState();
  const mine = state && state.owner === owner ? state : null;
  // The chip's page goes away (another tab, another page): its panel goes with it.
  useEffect(() => () => void closeFragmentPanel(owner), [owner]);
  const open = useCallback((request: FragmentPanelOpen) => openFragmentPanel(owner, request), [owner]);
  return { open, current: mine ? mine.current : null, panel: mine ? <FragmentPanel request={mine} /> : null };
}
