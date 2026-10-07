import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import type { EvidenceItem, ExamQuestion, NearestItem } from '../../api/exams';
import type { LearningEvent } from '../../api/learning';
import { compareEventTime, questionState, type QuestionState } from '../../lib/learning/readiness';
import { formatShortDay, formatShortMoment, fragmentNumber } from '../../lib/exams/format';
import { isGenericReason } from '../../lib/exams/genericReason';
import { normalizeForMatch } from '../conversation/visuals';
import { focusWindow, fragmentView, type Span } from '../../utils/fragmentText';
import { PencilUnder, seedFrom } from '../marks';
import type { SheetCoverage } from './marks';
import { confirmedAgeSentence, glue, lecturesGenitive, NBSP } from './sheetModel';
import type { FrameBox } from './useFrame';

const REASON_NO_OVERLAP = 'Ни одного фрагмента с этими словами';
const REASON_NO_SUPPORT = 'Нет подтверждающего фрагмента';
// A question the model did not judge: the server says why after this prefix (exams_map.py, REASON_NO_ANSWER,
// REASON_NO_QUOTE and the reasons of a failed batch: «сервис ИИ был занят», «…не ответил вовремя»).
const UNVERIFIED_PREFIX = 'Проверено только по словам:';
/** A longer fragment is cut: to its start, or to this many characters around the place of the answer. */
export const EXCERPT_LIMIT = 600;
/** The place of the answer is underlined lighter than the readiness marks (2.2): a pointer, not a verdict. */
const FOCUS_WEIGHT = 1.6;

export interface WhyPanelProps {
  examId: string;
  question: ExamQuestion;
  number: string;
  coverage: SheetCoverage;
  /** Lectures attached to the exam (the «Ни в одной из 9 лекций» count). */
  lectureCount: number;
  /** Material ids still attached to the exam: evidence from a removed lecture is labelled. */
  examMaterialIds: ReadonlySet<string>;
  /** exam_answer events of this question (by question hash), oldest first. */
  answers: LearningEvent[];
  answersError: string | null;
  variant: 'column' | 'sheet';
  frameBox?: FrameBox;
  headingId: string;
  /** Opened from a printed line of the cheat sheet: the heading takes the keyboard (the line is far from the column). */
  focusHeading?: boolean;
  onClose: () => void;
  onManualMark: () => void;
  manualPending: boolean;
  manualError: string | null;
  /** «Проверить снова» for a question checked only by words (null when a run is going). */
  onRecheck: (() => void) | null;
  /** The moment the ages are counted from (the page passes the time the journal was read). */
  now?: Date;
}

interface Verdict {
  title: string;
  lead: string[];
}

/**
 * Why a question was matched only by words, in the server's own words: «Сервис ИИ был занят, поэтому …»,
 * «Модель не подтвердила ответ цитатой из лекции, поэтому …». An older or unknown reason gets the plain line.
 */
export function unverifiedLead(reason: string | null | undefined): string {
  const cause = typeof reason === 'string' && reason.startsWith(UNVERIFIED_PREFIX) ? reason.slice(UNVERIFIED_PREFIX.length).trim() : '';
  if (!cause) return 'Модель этот вопрос не проверила: он сопоставлен с лекциями только по совпадению слов.';
  const sentence = `${cause.charAt(0).toUpperCase()}${cause.slice(1)}`.replace(/[.\s]+$/, '');
  return `${sentence}, поэтому вопрос сопоставлен с лекциями только по совпадению слов.`;
}

/**
 * The judge's reason when it says what the fragments hold; a general verdict («Вопрос полностью раскрыт в
 * приложенных фрагментах», the server's old «Ответ есть во фрагментах лекций») tells nothing under «Есть в
 * ваших лекциях» and is not shown (rows mapped before the server dropped them).
 */
function reasonLead(reason: string | null | undefined): string[] {
  return reason && !isGenericReason(reason) ? [reason] : [];
}

function verdictOf(question: ExamQuestion, coverage: SheetCoverage, lectureCount: number): Verdict {
  // «В лекции» for the only one: «ни в одной из 1 лекции» is not Russian.
  const lectures =
    lectureCount === 1 ? 'В лекции' : lectureCount > 1 ? `Ни в одной из ${lectureCount}${NBSP}${lecturesGenitive(lectureCount)}` : 'Ни в одной лекции';
  switch (coverage) {
    case 'checking':
      return { title: 'Проверяем по лекциям…', lead: [] };
    case 'unmapped':
      return { title: 'Вопрос ещё не сверен с лекциями', lead: ['Пометка появится после сверки с лекциями.'] };
    case 'unverified':
      return { title: 'Проверено только по словам', lead: [unverifiedLead(question.coverage_reason)] };
    case 'full':
      if (question.coverage_method === 'manual') {
        return { title: 'Отмечено вами', lead: ['Meldy этого не проверял: вы отметили, что ответ есть в лекции.'] };
      }
      return { title: 'Есть в ваших лекциях', lead: reasonLead(question.coverage_reason) };
    case 'partial': {
      const lead = reasonLead(question.coverage_reason);
      if (question.missing_note) lead.push(`Не хватает: ${question.missing_note}`);
      return { title: 'Есть частично', lead };
    }
    case 'none':
    default:
      if (question.coverage_reason === REASON_NO_SUPPORT) {
        return {
          title: 'Нет фрагмента, который подтверждает ответ',
          lead: ['Похожие места есть, но без ссылки на конкретный фрагмент вопрос не считается найденным.'],
        };
      }
      if (question.coverage_reason === REASON_NO_OVERLAP) {
        return { title: `${lectures} нет фрагмента с этими словами`, lead: [] };
      }
      return { title: `${lectures} нет фрагмента об этом`, lead: [] };
  }
}

function fragmentLabel(item: Pick<EvidenceItem, 'source_id'>): string {
  const n = fragmentNumber(item.source_id);
  return n === null ? 'фрагмент' : `фрагмент${NBSP}${n}`;
}

function quoted(words: string[]): string {
  return words.map((word) => `«${word}»`).join(', ');
}

/** «Ближе всего — «Поведение потребителя», фрагмент 12: совпало только слово «выбор».» */
export function nearestSentence(item: NearestItem): string {
  const where = `«${item.material_title || 'Лекция'}», ${fragmentLabel(item)}`;
  const words = Array.from(new Set(item.matched.filter((word) => word.trim()))).slice(0, 4);
  if (words.length === 0) return `Ближе всего — ${where}.`;
  if (words.length === 1) return `Ближе всего — ${where}: совпало только слово ${quoted(words)}.`;
  return `Ближе всего — ${where}: совпали слова ${quoted(words)}.`;
}

/** The fragment text with the matched words underlined by pencil (no regex lookbehind: Safari). */
function MarkedExcerpt({ text, matched, seedKey }: { text: string; matched: string[]; seedKey: string }) {
  const wanted = new Set(matched.map((word) => normalizeForMatch(word)).filter(Boolean));
  if (wanted.size === 0) return <>{text}</>;
  const parts = text.split(/([\p{L}\p{N}]+)/u);
  let count = 0;
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 1 && wanted.has(normalizeForMatch(part))) {
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

/**
 * The place of the answer in the fragment (the words of the quote the mapping verified, evidence focus)
 * underlined lightly in pencil — never a highlighter. The mark is aria-hidden: screen readers hear its meaning.
 */
export function FocusedText({ text, focus, seed }: { text: string; focus: Span | null; seed: number }) {
  if (!focus) return <>{text}</>;
  return (
    <>
      {text.slice(0, focus[0])}
      <span className="ex-sr">Место ответа: </span>
      <PencilUnder seed={seed} weight={FOCUS_WEIGHT} className="ex-focus">
        {text.slice(focus[0], focus[1])}
      </PencilUnder>
      {text.slice(focus[1])}
    </>
  );
}

const covers = (span: Span | null, length: number) => span !== null && span[0] === 0 && span[1] === length;

function Excerpt({ item, matched = [], seedKey, actions = null }: { item: EvidenceItem; matched?: string[]; seedKey: string; actions?: ReactNode }) {
  const [whole, setWhole] = useState(false);
  // The lecture's own heading keeps its line (jury memo 12), the text runs below it; a table row reads
  // «ячейка — ячейка; …»; focus — where the verified quote is (absent in rows mapped before it was stored).
  const view = fragmentView(item.excerpt, item.focus);
  const long = view.body.length > EXCERPT_LIMIT;
  let body = view.body;
  let focus = view.bodyFocus;
  let before = '';
  let after = '';
  if (long && !whole) {
    if (focus) {
      // A long fragment opens around the place of the answer, not at its start (Q6 of the live run 07.10).
      const [start, end] = focusWindow(view.body, focus, EXCERPT_LIMIT);
      body = view.body.slice(start, end);
      focus = [focus[0] - start, focus[1] - start];
      before = start > 0 ? '…' : '';
      after = end < view.body.length ? '…' : '';
    } else {
      body = view.body.slice(0, EXCERPT_LIMIT).replace(/\s+\S*$/, '');
      after = '…';
    }
  }
  // A quote that is the whole fragment points at nothing in particular: no mark then.
  const quotesAll = covers(view.bodyFocus, view.body.length) && (view.heading === null || covers(view.headingFocus, view.heading.length));
  const bodyFocus = quotesAll ? null : focus;
  const headingFocus = quotesAll ? null : view.headingFocus;
  const seed = seedFrom(seedKey, 97);
  return (
    <>
      <blockquote className="sf-slip" style={{ margin: 0 }}>
        {view.heading && (
          <span className="ex-slip-head" data-fragment-heading="">
            <FocusedText text={view.heading} focus={headingFocus} seed={seed + 3} />
          </span>
        )}
        {before}
        {bodyFocus ? <FocusedText text={body} focus={bodyFocus} seed={seed} /> : <MarkedExcerpt text={body} matched={matched} seedKey={seedKey} />}
        {after}
      </blockquote>
      {/* One row of the fragment's actions: «Показать фрагмент целиком» and «Открыть материал» ran together. */}
      {(long || actions) && (
        <div className="ex-slip-acts">
          {long && (
            <button type="button" className="sf-link" data-muted="" onClick={() => setWhole((value) => !value)}>
              {whole ? 'Свернуть фрагмент' : 'Показать фрагмент целиком'}
            </button>
          )}
          {actions}
        </div>
      )}
    </>
  );
}

/**
 * «7 окт., 14:02 · названо достаточно» — one answer in «Ответы», its protocol a click away. No grade
 * (Ф1): whether the answer named enough of the points (the readiness rule's passed answer) or not.
 */
export function attemptLabel(event: LearningEvent): string {
  const when = formatShortMoment(event.created_at) || formatShortDay(event.local_date);
  if (event.correct === true) return `${when} · названо достаточно`;
  if (event.correct === false) return `${when} · названо недостаточно`;
  return when;
}

/**
 * Where the question stands by the rule «подтверждено» (Jury_Check items 3 and 6), with no grade and
 * no «засчитано» (Ф1):
 * - confirmed: «Подтверждено 3 октября — 2 дня назад.» counted from the last passed answer (the
 *   moment the 14-day rule uses), «Подтверждено 16 дней назад — пора проверить.» when it is stale;
 * - once: «Ответ 3 окт., 14:02 — названо достаточно. Подтвердит такой же ответ на другой день, не
 *   раньше 4 окт., 10:02.»;
 * - not_passed: «Последний ответ 3 окт. — названо недостаточно. Серия начнётся заново со следующего
 *   ответа, где названо достаточно.»
 * Null for a question that has no graded answer.
 */
export function readinessLine(state: QuestionState, answers: LearningEvent[], now: Date = new Date()): string | null {
  if (state.readiness === 'confirmed') return confirmedAgeSentence(state, now);
  if (state.readiness === 'once') {
    const passed = state.seriesStartAt ? `Ответ ${formatShortMoment(state.seriesStartAt, now)} — названо достаточно.` : 'Названо достаточно.';
    if (state.awaiting) return `${passed} Такой же ответ сейчас подтвердит вопрос.`;
    const from = formatShortMoment(state.confirmableFrom, now);
    return `${passed} Подтвердит такой же ответ на другой день${from ? `, не раньше ${from}` : ''}.`;
  }
  if (state.readiness === 'not_passed') {
    const failed = answers.filter((event) => event.kind === 'exam_answer' && event.correct === false).sort(compareEventTime);
    const last = failed[failed.length - 1];
    const day = last ? formatShortDay(last.local_date, now) : '';
    return `Последний ответ${day ? ` ${day}` : ''} — названо недостаточно. Серия начнётся заново со следующего ответа, где названо достаточно.`;
  }
  return null;
}

/**
 * «Почему»: what the mapping found for one question — the verdict in words, the whole lecture
 * fragment with its lecture and number, or for a gap the nearest fragment and the word that
 * matched — the answers aloud with dates (each opens its protocol) and what to do next.
 */
export default function WhyPanel(props: WhyPanelProps) {
  const { examId, question, number, coverage, variant, onClose } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const sheet = variant === 'sheet';

  useEffect(() => {
    if (sheet) closeRef.current?.focus();
    else if (props.focusHeading) document.getElementById(props.headingId)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, question.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A bottom sheet holds the page still while it is open (the window is the scroller).
  useEffect(() => {
    if (!sheet || !rootRef.current) return;
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
    const focusable = Array.from(
      rootRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
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

  const verdict = verdictOf(question, coverage, props.lectureCount);
  const now = props.now ?? new Date();
  const ready = props.answersError ? null : readinessLine(questionState(props.answers, [], now), props.answers, now);
  const evidence = coverage === 'full' || coverage === 'partial' ? question.evidence : [];
  const nearest = coverage === 'none' || coverage === 'unverified' ? question.nearest : [];
  const answers = [...props.answers].reverse();
  const reviewMaterial = evidence.find((item) => item.material_id)?.material_id ?? null;
  const canMark = coverage !== 'checking' && coverage !== 'full' && question.coverage_method !== 'manual';
  const canAnswer = coverage !== 'none' && coverage !== 'checking';
  const seedKey = `${examId}:${question.position}:why`;

  let body: ReactNode = null;
  if (evidence.length > 0) {
    body = evidence.map((item, index) => {
      const removed = item.material_id !== '' && !props.examMaterialIds.has(item.material_id);
      return (
        <div key={`${item.material_id}:${item.source_id}:${index}`}>
          <p className="ex-slip-cap">
            Лекция «{item.material_title || 'без названия'}», {fragmentLabel(item)}
            {removed ? ' — лекция убрана из экзамена' : ''}
          </p>
          <Excerpt
            item={item}
            seedKey={`${seedKey}:${index}`}
            actions={
              item.material_id ? (
                <Link className="sf-link" data-muted="" to={`/library/${item.material_id}`}>
                  Открыть материал
                </Link>
              ) : null
            }
          />
        </div>
      );
    });
  } else if (nearest.length > 0) {
    const first = nearest[0];
    body = (
      <>
        <p className="ex-stmt">{glue(nearestSentence(first))}</p>
        <p className="ex-slip-cap">
          Лекция «{first.material_title || 'без названия'}», {fragmentLabel(first)}
        </p>
        <Excerpt item={first} matched={first.matched} seedKey={seedKey} />
      </>
    );
  } else if (coverage === 'none') {
    body = <p className="ex-stmt">Похожих фрагментов не нашлось.</p>;
  }

  const content = (
    <>
      <p className="ex-why-t">Вопрос {number}</p>
      <h3 id={props.headingId} tabIndex={props.focusHeading && !sheet ? -1 : undefined}>
        {glue(verdict.title)}
      </h3>
      {verdict.lead.map((line) => (
        <p key={line} className="ex-stmt">
          {glue(line)}
        </p>
      ))}
      {body}

      {(answers.length > 0 || props.answersError) && (
        <div className="ex-blk">
          {/* «Ответы»: a written answer counts as much as a spoken one (Jury_Check 11). */}
          <p className="ex-why-t">Ответы</p>
          {ready && <p className="ex-stmt ex-why-ready">{glue(ready)}</p>}
          {props.answersError ? (
            <p className="ex-fine">{props.answersError}</p>
          ) : (
            <ul className="ex-attempts">
              {answers.map((event) => (
                <li key={event.id}>
                  {event.session_id ? (
                    <Link to={`/exams/${examId}/ticket?session=${encodeURIComponent(event.session_id)}`}>{attemptLabel(event)}</Link>
                  ) : (
                    <span>{attemptLabel(event)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {props.manualError && (
        <p className="ex-note" role="alert">
          {props.manualError}
        </p>
      )}
      {/* The panel's one filled pill (redesign critique 6, round 2): on stage the step from row 12 to its
          answer. The sheet's «Тянуть билет» steps down to an outlined pill while the panel is open. */}
      {canAnswer && (
        <div className="ex-why-go">
          <Link className="sf-primary" to={`/exams/${examId}/ticket?q=${encodeURIComponent(question.id)}`}>
            Ответить на этот вопрос
          </Link>
        </div>
      )}
      <div className="ex-why-acts">
        {reviewMaterial && (
          <Link className="sf-link" to={`/review?material=${encodeURIComponent(reviewMaterial)}`}>
            Повторить карточки этой лекции
          </Link>
        )}
        {coverage === 'unverified' && props.onRecheck && (
          <button type="button" className="sf-link" onClick={props.onRecheck}>
            Проверить снова
          </button>
        )}
        {coverage === 'none' && (
          <Link className="sf-link" to={`/exams/${examId}/edit#lectures`}>
            Добавить материал к вопросу
          </Link>
        )}
        {canMark && (
          <button type="button" className="sf-link" onClick={props.onManualMark} disabled={props.manualPending}>
            {props.manualPending ? 'Сохраняем…' : 'Это есть в лекции…'}
          </button>
        )}
        {!sheet && (
          <button type="button" className="sf-link" data-muted="" onClick={onClose}>
            Закрыть
          </button>
        )}
      </div>
    </>
  );

  if (!sheet) {
    return (
      <section className="ex-why" aria-labelledby={props.headingId} aria-live="polite" ref={rootRef}>
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
        aria-labelledby={props.headingId}
        onKeyDown={trapFocus}
        style={{
          left: props.frameBox?.left ?? 0,
          right: props.frameBox?.right ?? 0,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
        }}
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
