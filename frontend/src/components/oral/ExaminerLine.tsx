import { useLayoutEffect, useRef, type ReactNode } from 'react';

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
 * row's height with one measurement, never further than the window allows.
 */
export default function ExaminerLine({ question, onRepeat, alignTo, children }: ExaminerLineProps) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const block = ref.current;
    if (!block || !alignTo || !/^p[1-6]$/.test(alignTo) || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const row = document.querySelector<HTMLElement>(`[data-point="${alignTo}"]`);
    if (!row) return;
    block.style.marginTop = '';
    const top = row.getBoundingClientRect().top - block.getBoundingClientRect().top;
    const room = window.innerHeight - block.getBoundingClientRect().bottom;
    const delta = Math.max(0, Math.min(top - 18, room - 16));
    if (delta > 0) block.style.marginTop = `${28 + delta}px`;
  }, [alignTo, question]);

  return (
    <section ref={ref} className="or-examiner" aria-label="Экзаменатор">
      <p className="or-examiner-who">Экзаменатор</p>
      <p className="or-examiner-q">«{question}»</p>
      {onRepeat ? (
        <button type="button" className="sf-link or-again" data-muted="" onClick={onRepeat}>
          Повторить вопрос
        </button>
      ) : null}
      {children}
    </section>
  );
}
