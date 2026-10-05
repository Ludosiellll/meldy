import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GUIDE_CHAPTERS } from './chapters';
import { useGuide } from './GuideContext';
import { guideClipPart } from './clipPart';
import { useLazyPart } from '../../lib/lazyPart';
import { track } from '../../lib/telemetry';
import './guide.css';

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Room around the lit menu item inside the cut-out (its yellow ring pulses out to 6 px). */
const SPOT_PAD = 8;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The lit item of the menu as it is drawn now: the top line's link on a computer, the tab on a phone. */
function litItem(): HTMLElement | null {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.sf-shell [data-guide-spot]'));
  return items.find((item) => item.getClientRects().length > 0 && item.getBoundingClientRect().width > 0) ?? null;
}

interface Hole {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

/**
 * The first run's backdrop: the app dimmed, with a cut-out over the menu item the chapter talks
 * about (the top line on a computer, the tabs on a phone). It takes every click outside the guide.
 */
function Backdrop({ chapter, pathname }: { chapter: string; pathname: string }) {
  const [hole, setHole] = useState<Hole | null>(null);

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const item = litItem();
        if (!item) {
          setHole(null);
          return;
        }
        const rect = item.getBoundingClientRect();
        const height = Math.round(rect.height + 2 * SPOT_PAD);
        // The cut-out follows the item's own corners: a pill stays a pill, a tab a rounded square.
        const own = Number.parseFloat(window.getComputedStyle(item).borderTopLeftRadius) || 0;
        const next: Hole = {
          left: Math.round(rect.left - SPOT_PAD),
          top: Math.round(rect.top - SPOT_PAD),
          width: Math.round(rect.width + 2 * SPOT_PAD),
          height,
          radius: Math.min(height / 2, own + SPOT_PAD),
        };
        setHole((previous) =>
          previous &&
          previous.left === next.left &&
          previous.top === next.top &&
          previous.width === next.width &&
          previous.height === next.height &&
          previous.radius === next.radius
            ? previous
            : next,
        );
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready?.then(measure).catch(() => undefined);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [chapter, pathname]);

  return (
    <div className="gd-dim" data-hole={hole ? '' : undefined} aria-hidden="true">
      {hole ? (
        <i className="gd-hole" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height, borderRadius: hole.radius }} />
      ) : null}
    </div>
  );
}

/**
 * The guide: one chapter per section of the menu — a short clip, the section's name and what it is
 * for — with «Назад» and «Дальше», and the strip of chapters to jump between them.
 *
 * Asked for («?», the account menu), it is a card in the corner on a computer and a sheet above the
 * tabs on a phone; the page stays usable underneath, «Не сейчас», × and Escape close it.
 * On the first run it is a blocking dialog instead: the app dimmed behind it with the
 * chapter's menu item cut out, the focus kept inside, no way to close it but «Начать» at the end.
 */
export default function GuidePanel() {
  const guide = useGuide();
  const { pathname } = useLocation();
  const titleId = useId();
  const textId = useId();
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const open = Boolean(guide?.open);
  const mandatory = Boolean(guide?.mandatory);
  // The clip is a file of its own (clipPart.ts): until it arrives the card keeps its empty frame.
  const GuideClip = useLazyPart(guideClipPart, open, {
    onError: (error) => console.error('Ролик раздела не загрузился:', error),
  });

  // Opened by the student (or as the first run), the guide takes the focus and gives it back to
  // what had it on close.
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    };
  }, [open]);

  // The first run keeps the focus inside the dialog: Tab and Shift+Tab go round its controls, a focus
  // that lands outside comes back, and Escape does nothing.
  useEffect(() => {
    if (!open || !mandatory) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const root = panel.current;
      if (!root) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab') return;
      // Every control of the card is shown (the clip has either «Смотреть» or the play button).
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (event.shiftKey && (!inside || active === first || active === root)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const root = panel.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) root.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, mandatory]);

  if (!guide || !open) return null;
  const { index, go, close, finish } = guide;
  const chapter = GUIDE_CHAPTERS[index];
  const total = GUIDE_CHAPTERS.length;
  const last = index === total - 1;
  // The section's page, unless the student is on it; the limit has none (its meter is in the top line).
  const sectionLink = chapter.route && !chapter.match?.test(pathname) ? chapter.route : null;

  const card = (
    <section
      ref={panel}
      className="gd"
      role="dialog"
      aria-modal={mandatory ? 'true' : 'false'}
      aria-labelledby={titleId}
      aria-describedby={textId}
      data-mandatory={mandatory ? '' : undefined}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (!mandatory) close();
      }}
    >
      <div className="gd-top">
        <p className="gd-kick">{mandatory ? 'Знакомство с Meldy' : 'Помощник'}</p>
        <p className="gd-count">
          {index + 1} из {total}
        </p>
        {mandatory ? null : (
          <button type="button" className="gd-x" onClick={close} aria-label="Закрыть">
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="gd-clip">
        {GuideClip ? (
          <GuideClip key={chapter.id} chapter={chapter.id} active={open} />
        ) : (
          <div className="gd-box" data-playing="false" aria-hidden="true" />
        )}
      </div>

      <ol className="gd-steps" aria-label="Разделы">
        {GUIDE_CHAPTERS.map((item, position) => (
          <li key={item.id}>
            <button
              type="button"
              className="gd-step"
              data-done={position < index ? '' : undefined}
              aria-current={position === index ? 'step' : undefined}
              aria-label={item.tab}
              onClick={() => go(position)}
            />
          </li>
        ))}
      </ol>

      <h2 id={titleId} className="gd-h">
        {chapter.title}
      </h2>
      <p id={textId} className="gd-p">
        {chapter.text}
        {chapter.phone ? <span className="gd-phone"> {chapter.phone}</span> : null}
      </p>

      <div className="gd-actions">
        {index > 0 ? (
          <button type="button" className="gd-quiet" onClick={() => go(index - 1)}>
            Назад
          </button>
        ) : mandatory ? null : (
          <button type="button" className="gd-quiet" onClick={close}>
            Не сейчас
          </button>
        )}
        {sectionLink ? (
          <Link className="gd-open" to={sectionLink}>
            Открыть раздел
          </Link>
        ) : null}
        {last ? (
          <button type="button" className="gd-next" onClick={() => { track('guide_done', { first_run: mandatory }); (mandatory ? finish : close)(); }}>
            {mandatory ? 'Начать' : 'Готово'}
          </button>
        ) : (
          <button type="button" className="gd-next" onClick={() => go(index + 1)}>
            Дальше
            <i>
              <ArrowIcon />
            </i>
          </button>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {`Раздел ${index + 1} из ${total}: ${chapter.title}`}
      </p>
    </section>
  );

  if (!mandatory) return card;
  return (
    <div className="gd-layer">
      <Backdrop chapter={chapter.id} pathname={pathname} />
      {card}
    </div>
  );
}
