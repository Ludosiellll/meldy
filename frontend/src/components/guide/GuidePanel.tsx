import { useEffect, useId, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GUIDE_CHAPTERS } from './chapters';
import { useGuide } from './GuideContext';
import GuideClip from './GuideClip';
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

/**
 * The guide: a card in the corner on a computer, a sheet above the tabs on a phone. One chapter
 * per section — a short clip, the section's name and what it is for — with «Назад» and «Дальше»,
 * and the strip of chapters to jump between them. The page stays usable underneath.
 */
export default function GuidePanel() {
  const guide = useGuide();
  const { pathname } = useLocation();
  const titleId = useId();
  const textId = useId();
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const open = Boolean(guide?.open);
  const asked = Boolean(guide?.asked);

  // Opened by the student, the guide takes the focus and gives it back to what opened it on close.
  // Opened by itself, it leaves the focus alone.
  useEffect(() => {
    if (!open || !asked) return undefined;
    opener.current = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    };
  }, [open, asked]);

  if (!guide || !open) return null;
  const { index, go, close } = guide;
  const chapter = GUIDE_CHAPTERS[index];
  const total = GUIDE_CHAPTERS.length;
  const last = index === total - 1;
  const onSection = chapter.match.test(pathname);

  return (
    <section
      ref={panel}
      className="gd"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={textId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="gd-top">
        <p className="gd-kick">Помощник</p>
        <p className="gd-count">
          {index + 1} из {total}
        </p>
        <button type="button" className="gd-x" onClick={close} aria-label="Закрыть">
          <CloseIcon />
        </button>
      </div>

      <div className="gd-clip">
        <GuideClip key={chapter.id} chapter={chapter.id} active={open} />
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
        {index === 0 ? (
          <button type="button" className="gd-quiet" onClick={close}>
            Не сейчас
          </button>
        ) : (
          <button type="button" className="gd-quiet" onClick={() => go(index - 1)}>
            Назад
          </button>
        )}
        {onSection ? null : (
          <Link className="gd-open" to={chapter.route}>
            Открыть раздел
          </Link>
        )}
        {last ? (
          <button type="button" className="gd-next" onClick={close}>
            Готово
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
}
