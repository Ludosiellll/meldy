import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GUIDE_CHAPTERS } from './chapters';
import { useGuide } from './GuideContext';
import { guideClipPart } from './clipPart';
import { useLazyPart } from '../../lib/lazyPart';
import StepClipPlaceholder from '../clips/Placeholder';
import { track } from '../../lib/telemetry';
import { usePhone } from '../../lib/usePhone';
import './guide.css';
import GuideGoal from './GuideGoal';
import { GUIDE_START } from '../quick/copyQuick';
import { useExamsEmpty } from './useExamsEmpty';

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

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 5.2v9.6a.8.8 0 0 0 1.2.7l7.6-4.8a.8.8 0 0 0 0-1.4L8.2 4.5A.8.8 0 0 0 7 5.2Z" fill="currentColor" />
    </svg>
  );
}

/**
 * A screen narrower than 480 px: the clip, a computer's screen drawn at a quarter of its size, is too small to read
 * there and pushed «Назад / Дальше» off the card (phone audit 47.3), so it waits for «Показать ролик».
 */
export const NARROW_QUERY = '(max-width: 479px)';

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  let list: MediaQueryList;
  try {
    list = window.matchMedia(NARROW_QUERY);
  } catch {
    return () => undefined;
  }
  if (typeof list.addEventListener === 'function') list.addEventListener('change', onChange);
  else list.addListener?.(onChange);
  return () => {
    if (typeof list.removeEventListener === 'function') list.removeEventListener('change', onChange);
    else list.removeListener?.(onChange);
  };
}

function narrowNow(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
  } catch {
    return false;
  }
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

  // The cut-out moves to the next item by a transform: it stands at its new place at once and comes there from the
  // old one (.5 s, the app's ease), on the compositor. Its left/top/width/height were a transition that laid the
  // dimmed layer out and repainted it on every frame (smoothness audit 20.10). The box's edges move as they did.
  const holeRef = useRef<HTMLElement>(null);
  const shown = useRef<Hole | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = hole;
    const element = holeRef.current;
    if (!element || !hole || !before || typeof element.animate !== 'function') return;
    if (before.left === hole.left && before.top === hole.top && before.width === hole.width && before.height === hole.height) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const from = `translate(${before.left - hole.left}px, ${before.top - hole.top}px) scale(${before.width / hole.width}, ${before.height / hole.height})`;
    element.animate([{ transform: from }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }, [hole]);

  return (
    <div className="gd-dim" data-hole={hole ? '' : undefined} aria-hidden="true">
      {hole ? (
        <i ref={holeRef} className="gd-hole" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height, borderRadius: hole.radius }} />
      ) : null}
    </div>
  );
}

/**
 * The guide: one chapter per section of the menu — a short clip, the section's name and what it is
 * for — with «Назад» and «Дальше», and the strip of chapters to jump between them.
 *
 * Asked for («?», the account menu — the menu only on a phone), it is a card in the corner on a computer and a
 * sheet above the tabs on a phone; the page stays usable underneath, «Не сейчас», × and Escape close it.
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
  // A phone's top line has no «+ Лекция»: its chapter says where «Разобрать лекцию» is there.
  const phone = usePhone();
  /** The chapter's clip chosen under the clip (its `reels`); the first one when the chapter changes. */
  const [chosen, setChosen] = useState<{ chapter: string; at: number }>({ chapter: '', at: 0 });
  // Under 480 px the clip waits for «Показать ролик»; once asked for, it stays while the guide is open.
  const narrow = useSyncExternalStore(subscribeNarrow, narrowNow, () => false);
  const [clipAsked, setClipAsked] = useState(false);
  useEffect(() => {
    if (!open) setClipAsked(false);
  }, [open]);
  const guideRef = useRef(guide);
  guideRef.current = guide;
  // «Экзамены» empty shows «Выбрать файлы», not «Новый экзамен»: the chapter names the button on screen.
  const examsEmpty = useExamsEmpty(open && guide?.index === GUIDE_CHAPTERS.findIndex((entry) => entry.id === 'exams'));
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
        // The first run has a way out (UX audit of 21.10): Escape ends it, as × and «Пропустить знакомство».
        event.preventDefault();
        event.stopPropagation();
        guideRef.current?.close();
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
  const { index, go, close, finish, stops, at, goStop } = guide;
  if (mandatory && guide.phase === 'goal') {
    return (
      <div className="gd-layer">
        <Backdrop chapter="goal" pathname={pathname} />
        <GuideGoal panelRef={panel} titleId={titleId} textId={textId} phone={phone} onChoose={guide.chooseGoal} onSkip={close} />
      </div>
    );
  }
  const chapter = GUIDE_CHAPTERS[index];
  const stop = stops ? stops[at] : null;
  // A goal's way (firstRun.ts) counts its own cards; the whole guide counts the chapters.
  const total = stops ? stops.length : GUIDE_CHAPTERS.length;
  const position = stops ? at : index;
  const last = position === total - 1;
  const goTo = (next: number) => (stops ? goStop(next) : go(next));
  const reels = stops ? null : chapter.reels ?? null;
  const reelAt = reels && chosen.chapter === chapter.id ? Math.min(chosen.at, reels.length - 1) : 0;
  const reel = reels ? reels[reelAt] : null;
  const examsWords = chapter.id === 'exams' && reelAt === 0 && examsEmpty ? GUIDE_START.examsEmpty : null;
  const title = stop?.title ?? reel?.title ?? chapter.title;
  const text = stop?.text ?? examsWords ?? reel?.text ?? chapter.text;
  // The section's page, unless the student is on it; the limit has none (its meter is in the top line).
  const sectionLink = chapter.route && !chapter.match?.test(pathname) && chapter.route !== pathname ? chapter.route : null;
  // Where the section is on a phone: said with the chapter's own clip.
  const where = reelAt > 0 ? undefined : phone && chapter.narrow ? chapter.narrow : chapter.phone;
  const stepReel = stop && stop.clip !== undefined ? stop.clip : reel?.clip ?? (chapter.id === 'tests' ? 'studio' : null);
  // A card of words only (a stop with clip null): no frame, no «Показать ролик».
  const noClip = Boolean(stop && stop.clip === null);
  const clipShown = !noClip && (!narrow || clipAsked);

  const card = (
    <section
      ref={panel}
      className="gd"
      role="dialog"
      aria-modal={mandatory ? 'true' : 'false'}
      aria-labelledby={titleId}
      aria-describedby={textId}
      data-mandatory={mandatory ? '' : undefined}
      data-reels={reels ? '' : undefined}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
      }}
    >
      <div className="gd-top">
        <p className="gd-kick">{mandatory ? GUIDE_START.kicker : 'Помощник'}</p>
        <p className="gd-count">
          {position + 1} из {total}
        </p>
        <button type="button" className="gd-x" onClick={close} aria-label={GUIDE_START.close}>
          <CloseIcon />
        </button>
      </div>

      {narrow && !noClip ? (
        <button type="button" className="gd-clip-toggle" aria-expanded={clipAsked} onClick={() => setClipAsked((asked) => !asked)}>
          <PlayIcon />
          {clipAsked ? 'Скрыть ролик' : 'Показать ролик'}
        </button>
      ) : null}
      {clipShown ? (
        <div className="gd-clip" data-step={stepReel ? '' : undefined}>
          {GuideClip ? (
            <GuideClip key={`${chapter.id}-${stepReel ?? 'own'}`} chapter={chapter.id} reel={stepReel} active={open} />
          ) : stepReel ? (
            <StepClipPlaceholder />
          ) : (
            <div className="gd-box" data-playing="false" aria-hidden="true" />
          )}
        </div>
      ) : null}

      {reels ? (
        <div className="gd-reels" role="group" aria-label="Ролики раздела">
          {reels.map((item, at) => (
            <button
              key={item.label}
              type="button"
              className="gd-reel"
              aria-pressed={at === reelAt}
              onClick={() => setChosen({ chapter: chapter.id, at })}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <ol className="gd-steps" aria-label="Разделы">
        {(stops ?? GUIDE_CHAPTERS).map((item, step) => {
          const label = 'tab' in item ? item.tab : item.title ?? GUIDE_CHAPTERS.find((entry) => entry.id === item.chapter)?.tab ?? '';
          return (
            <li key={`${step}-${label}`}>
              <button
                type="button"
                className="gd-step"
                data-done={step < position ? '' : undefined}
                aria-current={step === position ? 'step' : undefined}
                aria-label={label}
                onClick={() => goTo(step)}
              />
            </li>
          );
        })}
      </ol>

      <h2 id={titleId} className="gd-h">
        {title}
      </h2>
      <p id={textId} className="gd-p">
        {text}
        {where ? <span className="gd-phone"> {where}</span> : null}
      </p>

      <div className="gd-actions">
        {position > 0 ? (
          <button type="button" className="gd-quiet" onClick={() => goTo(position - 1)}>
            Назад
          </button>
        ) : (
          <button type="button" className="gd-quiet" onClick={close}>
            {mandatory ? GUIDE_START.skip : 'Не сейчас'}
          </button>
        )}
        {sectionLink ? (
          <Link className="gd-open" to={sectionLink}>
            Открыть раздел
          </Link>
        ) : null}
        {last ? (
          <button type="button" className="gd-next" onClick={() => { track('guide_done', { first_run: mandatory }); (mandatory ? finish : close)(); }}>
            {mandatory ? (guide.goal === 'test' ? GUIDE_START.startTest : 'Начать') : 'Готово'}
            {mandatory ? (
              <i>
                <ArrowIcon />
              </i>
            ) : null}
          </button>
        ) : (
          <button type="button" className="gd-next" onClick={() => goTo(position + 1)}>
            Дальше
            <i>
              <ArrowIcon />
            </i>
          </button>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {`Раздел ${position + 1} из ${total}: ${title}`}
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
