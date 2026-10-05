import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useLazyPart } from '../../lib/lazyPart';
import { tipClipPart } from './clipPart';
import type { TipDef } from './tips';
import './tips.css';

/** Phones: the card takes the width of the screen less the gutters. */
const PHONE_MAX = 639;
const GUTTER = 16;
/** From the anchor's bottom to the card's top edge; the arrow (10 px tall) lives in it. */
const GAP = 14;
/** Less when buttons that wrapped under the anchor are to be covered whole, never less than this. */
const MIN_GAP = 9;
/** The arrow keeps this far from the card's sides (clear of the rounded corners). */
const ARROW_EDGE = 44;
const MIN_W = 400;
const MAX_W = 520;
/** The clip is 16:10. */
const CLIP_RATIO = 1.6;
/** Below this share of the card's width the clip goes beside the words (a short window). */
const COLUMN_CLIP_SHARE = 0.86;
/** The card with the clip beside the words. */
const ROW_W = 580;
const ROW_CLIP_W = 272;
const MIN_CLIP_W = 200;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface TipCardProps {
  tip: TipDef;
  /** What the tip points at: the card hangs under it, and it gets a ring while the card is shown. */
  anchor: RefObject<HTMLElement>;
  /**
   * The group the card lines up with (the header's buttons): its right edge on the group's when the
   * group ends its row, its left edge on the group's otherwise. The anchor itself by default.
   */
  alignTo?: RefObject<HTMLElement>;
  /** «Попробовать» is a link here when given, otherwise a button. */
  to?: string;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * A first-use tip (tips.ts, useFirstUseTip): a card under the thing it is about, with a small arrow
 * at it — the clip, the title, a sentence or two, «Попробовать» and the quiet «Не сейчас». Not a
 * dialog: the page stays usable around it, it never takes the focus, and a polite live region says
 * it once. Escape inside it is «Не сейчас». The card lies over the page (it moves nothing) and never
 * over its anchor; a control under it that gets the keyboard's focus makes it step aside.
 *
 * Render it right after the anchor, inside a positioned box: the Tab key then goes from the anchor to
 * the tip. The card measures the anchor and places itself, also when the window or the page changes:
 * the clip on top, or beside the words when the window is too short for that.
 */
export default function TipCard({ tip, anchor, alignTo, to, onAction, onDismiss }: TipCardProps) {
  const card = useRef<HTMLElement>(null);
  const titleId = useId();
  const textId = useId();
  const [said, setSaid] = useState('');
  const [aside, setAside] = useState(false);
  const Clip = useLazyPart(tipClipPart, true, {
    onError: (error) => console.error('Ролик подсказки не загрузился:', error),
  });

  const place = useCallback(() => {
    const el = card.current;
    const target = anchor.current;
    if (!el || !target) return;
    const group = alignTo?.current ?? target;
    const host = (el.offsetParent as HTMLElement | null) ?? document.documentElement;
    const hostBox = host.getBoundingClientRect();
    const a = target.getBoundingClientRect();
    const g = group.getBoundingClientRect();
    const row = group.parentElement?.getBoundingClientRect() ?? g;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const phone = vw <= PHONE_MAX;
    const centre = a.left + a.width / 2;
    // Buttons of the group that wrapped under the anchor (a phone) are covered whole, not left peeking out.
    let top = a.bottom + GAP;
    for (const item of Array.from(group.children)) {
      if (item === el) continue;
      const box = item.getBoundingClientRect();
      if (box.height > 0 && box.top >= a.bottom) top = Math.min(top, Math.max(box.top, a.bottom + MIN_GAP));
    }
    const endsRow = Math.abs(g.right - row.right) <= 2 && g.left - row.left > 2;

    /** The card's left edge: lined up with the group, the arrow within reach of the anchor, inside the window. */
    const leftFor = (width: number) => {
      if (phone) return GUTTER;
      let left = endsRow ? g.right - width : g.left;
      left = clamp(left, centre + ARROW_EDGE - width, centre - ARROW_EDGE);
      return clamp(left, GUTTER, vw - GUTTER - width);
    };
    const apply = (width: number, layout: 'column' | 'row') => {
      const left = leftFor(width);
      el.dataset.layout = layout;
      el.style.width = `${width}px`;
      el.style.left = `${Math.round(left - hostBox.left - host.clientLeft)}px`;
      el.style.top = `${Math.round(top - hostBox.top - host.clientTop)}px`;
      el.style.setProperty('--tp-arrow-x', `${Math.round(clamp(centre - left, ARROW_EDGE, width - ARROW_EDGE))}px`);
    };

    // A card that ends where the group ends is as wide as it takes for the arrow to reach the anchor.
    const fit = vw - 2 * GUTTER;
    let width = phone ? fit : Math.min(endsRow ? clamp(Math.round(g.right - centre + ARROW_EDGE), MIN_W, MAX_W) : MIN_W, fit);
    apply(width, 'column');

    // The whole card in the window as the page first shows it: on a short window the clip gets smaller
    // or, when it would be much narrower than the card, goes beside the words.
    const clip = el.querySelector<HTMLElement>('.tp-clip');
    if (!clip) return;
    const room = window.innerHeight - GUTTER - (top + window.scrollY);
    const style = window.getComputedStyle(el);
    const inner = width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    el.style.setProperty('--tp-clip-w', `${inner}px`);
    const words = el.offsetHeight - clip.offsetHeight;
    const columnClip = Math.floor((room - words) * CLIP_RATIO);
    if (phone || columnClip >= inner * COLUMN_CLIP_SHARE) {
      el.style.setProperty('--tp-clip-w', `${clamp(columnClip, Math.min(MIN_CLIP_W, inner), inner)}px`);
      return;
    }
    width = Math.max(width, Math.min(ROW_W, fit));
    apply(width, 'row');
    el.style.setProperty('--tp-clip-w', `${ROW_CLIP_W}px`);
    const over = el.offsetHeight - room;
    if (over > 0) el.style.setProperty('--tp-clip-w', `${Math.max(MIN_CLIP_W, Math.floor(ROW_CLIP_W - over * CLIP_RATIO))}px`);
  }, [anchor, alignTo]);

  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    const page = card.current?.offsetParent?.parentElement;
    for (const el of [anchor.current, alignTo?.current, page]) if (el && observer) observer.observe(el);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    let live = true;
    void fonts?.ready?.then(() => live && place()).catch(() => undefined);
    return () => {
      live = false;
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [place, anchor, alignTo]);

  // The ring on what the tip is about, while the card is shown.
  useEffect(() => {
    const target = anchor.current;
    if (!target) return undefined;
    target.setAttribute('data-tip-spot', '');
    return () => target.removeAttribute('data-tip-spot');
  }, [anchor]);

  // Said once by a screen reader: the live region is in place before its words arrive.
  useEffect(() => {
    const timer = window.setTimeout(() => setSaid(`Подсказка. ${tip.title}. ${tip.text}`), 150);
    return () => window.clearTimeout(timer);
  }, [tip.title, tip.text]);

  // A control under the card that gets the keyboard's focus is not hidden by it: the card steps aside
  // until the focus is somewhere it does not cover (or back in the card).
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const el = card.current;
      const target = event.target;
      if (!el || !(target instanceof Element) || el.contains(target)) {
        setAside(false);
        return;
      }
      const a = el.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      setAside(b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom);
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);

  /** A focus inside the card goes back to the anchor when the card goes away. */
  const dismiss = () => {
    const el = card.current;
    if (el && el.contains(document.activeElement)) anchor.current?.focus({ preventScroll: true });
    onDismiss();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };

  return (
    <section
      ref={card}
      className="tp-card"
      aria-labelledby={titleId}
      aria-describedby={textId}
      data-aside={aside ? '' : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="tp-clip">
        {Clip ? <Clip id={tip.id} active={!aside} /> : <div className="tp-box" data-playing="false" aria-hidden="true" />}
      </div>
      <h2 id={titleId} className="tp-title">
        {tip.title}
      </h2>
      <p id={textId} className="tp-text">
        {tip.text}
      </p>
      <div className="tp-acts">
        {to ? (
          <Link className="sf-primary tp-go" to={to} onClick={onAction}>
            {tip.action}
          </Link>
        ) : (
          <button type="button" className="sf-primary tp-go" onClick={onAction}>
            {tip.action}
          </button>
        )}
        <button type="button" className="sf-link tp-later" data-muted="" onClick={dismiss}>
          {tip.later}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </section>
  );
}
