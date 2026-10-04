import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { PencilUnder, seedFrom } from '../marks';
import { glue, lecturesGenitive, NBSP } from '../exams/sheetModel';
import type { FrameBox } from '../exams/useFrame';
import { normalize } from '../../lib/oral/rubricMatch';
import { splitFragmentHeading } from '../../utils/fragmentText';
import { EXAMPLE_LECTURES, fragmentText, lectureOf, type ExampleQuestion } from '../../data/example';

/** «фрагмент 2» (never broken before the number). */
function fragmentWord(fragment: string): string {
  const match = /^S0*(\d{1,4})$/.exec(fragment);
  return match ? `фрагмент${NBSP}${match[1]}` : 'фрагмент';
}

/** The nearest fragment with the words it shares with the question underlined (WhyPanel's MarkedExcerpt). */
function MarkedText({ text, matched, seedKey }: { text: string; matched: string[]; seedKey: string }) {
  const wanted = new Set(matched.map((word) => normalize(word)));
  const parts = text.split(/([\p{L}\p{N}]+)/u);
  let count = 0;
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 1 && wanted.has(normalize(part))) {
          count += 1;
          return (
            <PencilUnder key={index} seed={seedFrom(seedKey, count)}>
              {part}
            </PencilUnder>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

interface ExampleWhyProps {
  question: ExampleQuestion;
  /** 'column' beside the sheet (1024 px and wider); 'sheet' — a bottom sheet on phones and tablets. */
  variant: 'column' | 'sheet';
  frameBox?: FrameBox;
  headingId: string;
  onClose: () => void;
  /** «Ответить на этот вопрос». */
  onAnswer: (questionId: string) => void;
}

/**
 * «Почему» of the example's sheet: the verdict in words, the lecture quote behind the mark (word for
 * word, with the lecture and its fragment), what a partial question lacks, and for the question that
 * is in no lecture the nearest fragment with the words that matched — and why that is not an answer.
 * The same layout as the real sheet's panel (components/exams/WhyPanel.tsx, adapted: its links lead
 * into a real exam of an account — the lectures, the answers, a mark by hand — so it is not reused
 * as it is); the bottom sheet behaves the same: the handle, the scrim, Esc, the focus kept inside.
 */
export default function ExampleWhy({ question, variant, frameBox, headingId, onClose, onAnswer }: ExampleWhyProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const sheet = variant === 'sheet';

  useEffect(() => {
    if (sheet) closeRef.current?.focus();
  }, [sheet, question.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A bottom sheet holds the page still while it is open.
  useEffect(() => {
    if (!sheet) return;
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
  }, [sheet]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!sheet || event.key !== 'Tab' || !rootRef.current) return;
    const focusable = Array.from(rootRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
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
    if (dragY > 90) onClose();
    setDragY(0);
  };

  const lectures = EXAMPLE_LECTURES.length;
  const title =
    question.coverage === 'full'
      ? 'Есть в лекциях примера'
      : question.coverage === 'partial'
        ? 'Есть частично'
        : `Ни в одной из ${lectures}${NBSP}${lecturesGenitive(lectures)} нет фрагмента об этом`;
  const lead = [question.reason, question.coverage === 'partial' && question.missing ? `Не хватает: ${question.missing}.` : ''].filter(Boolean);
  const nearest = question.nearest;
  const seedKey = `example:${question.number}:why`;

  const content = (
    <>
      <p className="ex-why-t">Вопрос {question.number}</p>
      <h3 id={headingId}>{glue(title)}</h3>
      {lead.map((line) => (
        <p key={line} className="ex-stmt">
          {glue(line)}
        </p>
      ))}
      {question.evidence.map((item, index) => (
        <div key={`${item.lecture}:${item.fragment}:${index}`}>
          <p className="ex-slip-cap">
            Лекция «{lectureOf(item.lecture).title}», {fragmentWord(item.fragment)}
          </p>
          <blockquote className="sf-slip tx-quote" style={{ margin: 0 }}>
            {item.quote}
          </blockquote>
        </div>
      ))}
      {nearest ? (
        <>
          <p className="ex-stmt">
            {glue(
              `Ближе всего — «${lectureOf(nearest.lecture).title}», ${fragmentWord(nearest.fragment)}: ${
                nearest.matched.length === 1 ? 'совпало только слово' : 'совпали слова'
              } ${nearest.matched.map((word) => `«${word}»`).join(', ')}.`,
            )}
          </p>
          <p className="ex-slip-cap">
            Лекция «{lectureOf(nearest.lecture).title}», {fragmentWord(nearest.fragment)}
          </p>
          <blockquote className="sf-slip tx-quote" style={{ margin: 0 }}>
            <MarkedText text={splitFragmentHeading(fragmentText(nearest.lecture, nearest.fragment)).body} matched={nearest.matched} seedKey={seedKey} />
          </blockquote>
        </>
      ) : null}
      {question.coverage === 'none' ? (
        <p className="ex-fine tx-why-fine">Ответ на этот вопрос не с чем сверить, поэтому в билеты примера он не попадает. В своём экзамене к такому вопросу можно добавить лекцию.</p>
      ) : (
        <div className="ex-why-go">
          <button type="button" className="sf-primary" onClick={() => onAnswer(question.id)}>
            Ответить на этот вопрос
          </button>
        </div>
      )}
      {!sheet ? (
        <div className="ex-why-acts">
          <button type="button" className="sf-link" data-muted="" onClick={onClose}>
            Закрыть
          </button>
        </div>
      ) : null}
    </>
  );

  if (!sheet) {
    return (
      <section className="ex-why" aria-labelledby={headingId} aria-live="polite" ref={rootRef}>
        {content}
      </section>
    );
  }

  return (
    <>
      <div className="ex-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={rootRef}
        className="ex-why ex-why-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={trapFocus}
        style={{ left: frameBox?.left ?? 0, right: frameBox?.right ?? 0, transform: dragY ? `translateY(${dragY}px)` : undefined }}
      >
        <div
          className="ex-grip-area"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          style={{ touchAction: 'none' }}
        >
          <span className="ex-grip" aria-hidden="true" />
        </div>
        <div className="ex-sheet-close">
          <button ref={closeRef} type="button" className="sf-link" data-muted="" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {content}
      </div>
    </>
  );
}
