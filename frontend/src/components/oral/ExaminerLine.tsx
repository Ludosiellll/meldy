import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** The examiner's question by its length (Jury_Check item 9, peak 2): l — 40 px, m — 32 px, s — 26 px (phones 28/27/26). */
export type QuestionSize = 'l' | 'm' | 's';

/** Up to about 90 characters the question is set at 40 px, up to about 140 at 32 px, beyond at 26 px. */
export function questionSize(question: string): QuestionSize {
  const length = question.trim().length;
  if (length <= 90) return 'l';
  if (length <= 140) return 'm';
  return 's';
}

/** The block's top stands this far above the asked row, so the question's first line meets the row. */
const ROW_LEAD_PX = 18;
/** Never closer than this to the bottom of the window. */
const WINDOW_GAP_PX = 16;
/** The block's own top margin in oral.css. */
const BASE_MARGIN_PX = 28;

interface ExaminerLineProps {
  /** The follow-up question, shown in full (the voice may fail; the text never does). */
  question: string;
  /** «Повторить вопрос»: plays the question again. */
  onRepeat?: () => void;
  /** The data-point id of the asked row: on a desktop the block stands at that row's height. */
  alignTo?: string | null;
  children?: ReactNode;
}

/** «Экзаменатор слушает ответ…» — the pause between «Готово» and the examiner's question. */
export function ExaminerThinking({ text = 'Экзаменатор слушает ответ…' }: { text?: string }) {
  return (
    <p className="or-line" role="status">
      {text}
    </p>
  );
}

/**
 * The examiner on the desk (redesign spec 5.11): a name and a quoted question, no coloured bar —
 * the pencil brace on the sheet ties it to its row. On a desktop the block moves down to the asked
 * row's height, never further than the window allows: its question and its buttons stay in view
 * (at 1280×720 too). It is placed again when it grows (a transcript, a hint) or the window changes.
 */
export default function ExaminerLine({ question, onRepeat, alignTo, children }: ExaminerLineProps) {
  const ref = useRef<HTMLElement>(null);
  const size = questionSize(question);

  useLayoutEffect(() => {
    const block = ref.current;
    if (!block || !alignTo || !/^p[1-6]$/.test(alignTo) || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 1024px)');
    const place = () => {
      block.style.marginTop = '';
      if (!wide.matches) return;
      const row = document.querySelector<HTMLElement>(`[data-point="${alignTo}"]`);
      if (!row) return;
      const box = block.getBoundingClientRect();
      const top = row.getBoundingClientRect().top - box.top;
      const room = window.innerHeight - box.bottom;
      const delta = Math.max(0, Math.min(top - ROW_LEAD_PX, room - WINDOW_GAP_PX));
      if (delta > 0) block.style.marginTop = `${BASE_MARGIN_PX + delta}px`;
    };
    place();
    window.addEventListener('resize', place);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      let height = block.offsetHeight;
      observer = new ResizeObserver(() => {
        // Only a change of the block's own height: the margin it sets moves it, never resizes it.
        if (block.offsetHeight === height) return;
        height = block.offsetHeight;
        place();
      });
      observer.observe(block);
    }
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [alignTo, question]);

  return (
    <section ref={ref} className="or-examiner" aria-label="Экзаменатор">
      <p className="or-examiner-who">Экзаменатор</p>
      <p className="or-examiner-q" data-size={size}>
        «{question}»
      </p>
      {onRepeat ? (
        <button type="button" className="sf-link or-again" data-muted="" onClick={onRepeat}>
          Повторить вопрос
        </button>
      ) : null}
      {children}
    </section>
  );
}
