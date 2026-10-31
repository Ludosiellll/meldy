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
/** A phone: air between the block and the bars over the page, px. */
const BAR_GAP_PX = 12;

/**
 * A phone or a tablet: the part of the window the room leaves to the page, px from its top — under the room's top line
 * (.sf-room-bar) and above the answer bar pinned at the bottom (oral.css: .or-acts is fixed to the window's bottom below
 * 1024 px). The bar is taken by its height, not where it is drawn: while the examiner's card rises in (a transform),
 * the bar inside it is fixed to the card, not to the window, and stood 90 px lower.
 */
export function roomBand(): { top: number; bottom: number } {
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  const topBar = document.querySelector<HTMLElement>('.sf-room-bar');
  const top = topBar ? Math.max(0, topBar.getBoundingClientRect().bottom) : 0;
  let bottom = viewport;
  for (const bar of document.querySelectorAll<HTMLElement>('.or-acts')) {
    if (getComputedStyle(bar).position !== 'fixed') continue;
    const height = bar.getBoundingClientRect().height;
    if (height > 0) bottom = Math.min(bottom, viewport - height);
  }
  return { top, bottom };
}

/**
 * A phone: brings the examiner's block — the question and the answer under it — into the room's band (roomBand), with the
 * least scroll; the window alone did not do: at 360×800 the question's last line and the answer field stood under the
 * bar (jury QA, 2026-10-11). A block taller than the band shows its question when it comes (`question`) and the answer
 * being given when it grows (`answer`). `onlyWhenSeen`: only while the block's top is in the band (it grew under the
 * eye, not after the student scrolled away from it).
 */
export function revealInRoom(block: HTMLElement, behavior: 'instant' | 'smooth', prefer: 'question' | 'answer', onlyWhenSeen = false): void {
  if (typeof window.scrollTo !== 'function') return;
  const band = roomBand();
  const top = band.top + BAR_GAP_PX;
  const bottom = band.bottom - BAR_GAP_PX;
  const box = block.getBoundingClientRect();
  if (onlyWhenSeen && (box.top < band.top || box.top > band.bottom)) return;
  let delta: number;
  if (box.height <= bottom - top) delta = box.top < top ? box.top - top : box.bottom > bottom ? box.bottom - bottom : 0;
  else delta = prefer === 'question' ? box.top - top : box.bottom - bottom;
  if (Math.abs(delta) < 2) return;
  window.scrollTo({ top: Math.max(0, Math.round(window.scrollY + delta)), behavior });
}

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
 * The examiner on the desk (redesign spec 5.11): a blue-tinted card with the examiner's «Э», the name
 * and the quoted question, as in the reel — the pencil brace and the flag on the sheet tie it to its
 * row. On a desktop the block moves down to the asked row's height, never further than the window
 * allows: its question and its buttons stay in view (at 1280×720 too). It is placed again when it
 * grows (a transcript, a hint) or the window changes.
 */
export default function ExaminerLine({ question, onRepeat, alignTo, children }: ExaminerLineProps) {
  const ref = useRef<HTMLElement>(null);
  const size = questionSize(question);

  useLayoutEffect(() => {
    const block = ref.current;
    if (!block || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 1024px)');
    const asked = alignTo && /^p[1-6]$/.test(alignTo) ? alignTo : null;
    /** How far below its own place the block stands now (px over its base margin). */
    let placed = 0;
    /**
     * A computer: the block moves down to the asked row's height, never further than the window allows. When the block
     * only changed its height (`grew`: a hint came or went, the microphone's line, the transcript), it moves up when it
     * must, to keep its buttons in view, and never back down: a line that comes and goes made it jump up and down at
     * every change (the examiner's block jittered under its ResizeObserver).
     */
    const placeAtRow = (pointId: string, upOnly: boolean) => {
      const row = document.querySelector<HTMLElement>(`[data-point="${pointId}"]`);
      if (!row) return;
      const box = block.getBoundingClientRect();
      const top = row.getBoundingClientRect().top - box.top;
      const room = window.innerHeight - box.bottom;
      let delta = Math.max(0, Math.min(top - ROW_LEAD_PX, room - WINDOW_GAP_PX));
      if (upOnly) delta = Math.min(delta, placed);
      placed = delta;
      if (delta > 0) block.style.marginTop = `${BASE_MARGIN_PX + delta}px`;
    };
    const place = (moment: 'shown' | 'grew' | 'resized') => {
      block.style.marginTop = '';
      if (!wide.matches) {
        // A phone: the question and its answer above the answer bar — at once when the question comes, before it is
        // seen; then, while the student looks at it, when it grows (the transcript opens) or the window does (a keyboard).
        if (moment === 'shown') revealInRoom(block, 'instant', 'question');
        else revealInRoom(block, 'smooth', 'answer', true);
        return;
      }
      if (asked) placeAtRow(asked, moment === 'grew');
      else placed = 0;
    };
    place('shown');
    const onResize = () => place('resized');
    window.addEventListener('resize', onResize);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      let height = block.offsetHeight;
      observer = new ResizeObserver(() => {
        // Only a change of the block's own height: the margin it sets moves it, never resizes it.
        if (block.offsetHeight === height) return;
        height = block.offsetHeight;
        place('grew');
      });
      observer.observe(block);
    }
    return () => {
      window.removeEventListener('resize', onResize);
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
