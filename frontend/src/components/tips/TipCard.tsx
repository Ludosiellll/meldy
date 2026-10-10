import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useLazyPart } from '../../lib/lazyPart';
import { tipClipPart } from './clipPart';
import type { TipDef } from './tips';
import './tips.css';

/** Phones: the card is a sheet at the bottom of the screen (finding LIB-4: hung under the pill it covered seven of
    the lecture's controls, its tabs among them). */
const PHONE_MAX = 639;
const GUTTER = 16;
/** From the anchor's bottom to the card's top edge; the arrow (10 px tall) lives in it. */
const GAP = 14;
/** A row of controls (tabs) this close under the anchor is never covered: the card goes below it. */
const CONTROL_BAND = 96;
const CONTROLS = 'a[href], button, [role="tab"], input, select, textarea, summary';
/** The arrow keeps this far from the card's sides (clear of the rounded corners). */
const ARROW_EDGE = 44;
const MIN_W = 400;
const MAX_W = 520;
/** The clip is 16:10 unless the tip's own frame says otherwise (tips.ts `clip`). */
const CLIP_RATIO = 1.6;
/** A clip this square or taller (the Telegram chat) stands beside the title, the words and the buttons in a short
    window, as tall as the card: under them all it would be too small to read. */
const TALL_CLIP = 1.25;
/** The words' column beside a tall clip (the title, two lines, both buttons in a row), the card's padding and gap. */
const TALL_WORDS_W = 440;
const TALL_EXTRA = 18 + 24;
const MIN_TALL_CLIP_H = 160;
/** Below this share of the card's width the clip goes beside the words (a short window). */
const COLUMN_CLIP_SHARE = 0.86;
/** The card with the clip beside the words. */
const ROW_W = 580;
const ROW_CLIP_W = 272;
const MIN_CLIP_W = 200;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function viewportWidth(): number {
  if (typeof window === 'undefined') return 1280;
  return document.documentElement.clientWidth || window.innerWidth;
}

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
  /**
   * How far under the anchor a row of controls (a page's tabs) keeps the card below it; CONTROL_BAND by default. 0 for an
   * anchor that holds its own controls (a whole card, as the exam page's plan): the card hangs right under it, over the
   * page's content, and no line has to cross the anchor's neighbours to reach it.
   */
  controlBand?: number;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * A first-use tip (tips.ts, useFirstUseTip): a card under the thing it is about, with a small arrow
 * at it — the clip, the title, a sentence or two, «Попробовать» and the quiet «Не сейчас». Not a
 * dialog: the page stays usable around it, it never takes the focus, and a polite live region says
 * it once. Escape inside it is «Не сейчас». The card lies over the page (it moves nothing), never
 * over its anchor and never over a row of controls right under it (a page's tabs): then it hangs
 * below that row, joined to the anchor by a thin line. A control under it that gets the keyboard's
 * focus makes it step aside.
 *
 * On a phone it is a sheet at the bottom of the screen, without the clip (the anchor keeps its ring);
 * a page with its own bar at the bottom says how high it is with the CSS variable --tp-sheet-lift.
 *
 * Render it right after the anchor, inside a positioned box: the Tab key then goes from the anchor to
 * the tip. The card measures the anchor and places itself, also when the window or the page changes:
 * the clip on top, or beside the words when the window is too short for that.
 */
export default function TipCard({ tip, anchor, alignTo, to, controlBand = CONTROL_BAND, onAction, onDismiss }: TipCardProps) {
  const ratio = tip.clip?.ratio ?? CLIP_RATIO;
  const tall = ratio < TALL_CLIP;
  const card = useRef<HTMLElement>(null);
  const titleId = useId();
  const textId = useId();
  const [said, setSaid] = useState('');
  const [aside, setAside] = useState(false);
  const [sheet, setSheet] = useState(() => viewportWidth() <= PHONE_MAX);
  const Clip = useLazyPart(tipClipPart, true, {
    onError: (error) => console.error('Ролик подсказки не загрузился:', error),
  });

  const place = useCallback(() => {
    const el = card.current;
    const target = anchor.current;
    if (!el || !target) return;
    const vw = viewportWidth();
    const phone = vw <= PHONE_MAX;
    setSheet(phone);
    if (phone) {
      // A sheet at the bottom of the screen (tips.css): nothing to measure.
      el.dataset.layout = 'sheet';
      for (const name of ['width', 'left', 'top', '--tp-arrow-x', '--tp-lead', '--tp-clip-w']) el.style.removeProperty(name);
      return;
    }
    const group = alignTo?.current ?? target;
    const host = (el.offsetParent as HTMLElement | null) ?? document.documentElement;
    const hostBox = host.getBoundingClientRect();
    const a = target.getBoundingClientRect();
    const g = group.getBoundingClientRect();
    const row = group.parentElement?.getBoundingClientRect() ?? g;
    const centre = a.left + a.width / 2;
    const endsRow = Math.abs(g.right - row.right) <= 2 && g.left - row.left > 2;

    /** The card's left edge: lined up with the group, the arrow within reach of the anchor, inside the window. */
    const leftFor = (width: number) => {
      let left = endsRow ? g.right - width : g.left;
      left = clamp(left, centre + ARROW_EDGE - width, centre - ARROW_EDGE);
      return clamp(left, GUTTER, vw - GUTTER - width);
    };
    /** Under the anchor, or under a row of controls (a page's tabs) that lies right under it where the card goes. */
    const topFor = (width: number) => {
      const left = leftFor(width);
      let below = a.bottom + GAP;
      for (const control of Array.from(document.querySelectorAll<HTMLElement>(CONTROLS))) {
        if (el.contains(control) || control === target || target.contains(control)) continue;
        const box = control.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) continue;
        if (box.top < a.bottom - 1 || box.top > a.bottom + controlBand) continue;
        if (box.right <= left || box.left >= left + width) continue;
        below = Math.max(below, box.bottom + GAP);
      }
      return below;
    };
    let top = a.bottom + GAP;
    const apply = (width: number, layout: 'column' | 'row') => {
      const left = leftFor(width);
      top = topFor(width);
      el.dataset.layout = layout;
      el.style.width = `${width}px`;
      el.style.left = `${Math.round(left - hostBox.left - host.clientLeft)}px`;
      el.style.top = `${Math.round(top - hostBox.top - host.clientTop)}px`;
      el.style.setProperty('--tp-arrow-x', `${Math.round(clamp(centre - left, ARROW_EDGE, width - ARROW_EDGE))}px`);
      // Below a row of controls the arrow no longer touches the anchor: a thin line joins them.
      const lead = Math.round(top - a.bottom - GAP);
      if (lead > 0) el.style.setProperty('--tp-lead', `${lead + 3}px`);
      else el.style.removeProperty('--tp-lead');
    };

    // A card that ends where the group ends is as wide as it takes for the arrow to reach the anchor.
    const fit = vw - 2 * GUTTER;
    let width = Math.min(endsRow ? clamp(Math.round(g.right - centre + ARROW_EDGE), MIN_W, MAX_W) : MIN_W, fit);
    apply(width, 'column');

    // The whole card in the window as the page first shows it: on a short window the clip gets smaller
    // or, when it would be much narrower than the card, goes beside the words. A bar the page keeps at the
    // bottom of the screen (--tp-sheet-lift) is not room.
    const clip = el.querySelector<HTMLElement>('.tp-clip');
    if (!clip) return;
    const style = window.getComputedStyle(el);
    const lift = parseFloat(style.getPropertyValue('--tp-sheet-lift')) || 0;
    const room = window.innerHeight - GUTTER - lift - (top + window.scrollY);
    const inner = width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    el.style.setProperty('--tp-clip-w', `${inner}px`);
    const words = el.offsetHeight - clip.offsetHeight;
    const columnClip = Math.floor((room - words) * ratio);
    if (columnClip >= inner * COLUMN_CLIP_SHARE) {
      el.style.setProperty('--tp-clip-w', `${clamp(columnClip, Math.min(MIN_CLIP_W, inner), inner)}px`);
      return;
    }
    if (tall) {
      // Beside the words and the buttons, the clip as tall as the room lets the card be.
      const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const clipW = Math.floor(clamp(Math.floor(room - pad), MIN_TALL_CLIP_H, ROW_CLIP_W) * ratio);
      apply(Math.min(fit, clipW + TALL_EXTRA + TALL_WORDS_W), 'row');
      el.style.setProperty('--tp-clip-w', `${clipW}px`);
      return;
    }
    width = Math.max(width, Math.min(ROW_W, fit));
    apply(width, 'row');
    el.style.setProperty('--tp-clip-w', `${ROW_CLIP_W}px`);
    const over = el.offsetHeight - room;
    if (over > 0) el.style.setProperty('--tp-clip-w', `${Math.max(MIN_CLIP_W, Math.floor(ROW_CLIP_W - over * CLIP_RATIO))}px`);
  }, [anchor, alignTo, controlBand, ratio, tall]);

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
      data-clip={tall ? 'tall' : undefined}
      onKeyDown={onKeyDown}
    >
      {sheet ? null : (
        <div className="tp-clip">
          {Clip ? (
            <Clip id={tip.id} active={!aside} />
          ) : (
            <div
              className="tp-box"
              data-playing="false"
              data-themed={tip.clip?.themed ? '' : undefined}
              style={tip.clip ? { aspectRatio: String(tip.clip.ratio) } : undefined}
              aria-hidden="true"
            />
          )}
        </div>
      )}
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
