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
import { normalizeForMatch } from '../conversation/visuals';
import { splitFragmentHeading } from '../../utils/fragmentText';
import { PencilUnder, seedFrom } from '../marks';
import type { SheetCoverage } from './marks';
import { confirmedAgeSentence, glue, lecturesGenitive, NBSP } from './sheetModel';
import type { FrameBox } from './useFrame';

const REASON_NO_OVERLAP = 'Ни одного фрагмента с этими словами';
const REASON_NO_SUPPORT = 'Нет подтверждающего фрагмента';
const EXCERPT_LIMIT = 600;

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
      return {
        title: 'Проверено только по словам',
        lead: ['Сервис проверки был занят, вопрос сопоставлен с лекциями по совпадению слов.'],
      };
    case 'full':
      if (question.coverage_method === 'manual') {
        return { title: 'Отмечено вами', lead: ['Meldy этого не проверял: вы отметили, что ответ есть в лекции.'] };
      }
      return { title: 'Есть в ваших лекциях', lead: question.coverage_reason ? [question.coverage_reason] : [] };
    case 'partial': {
      const lead = question.coverage_reason ? [question.coverage_reason] : [];
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

function Excerpt({ item, matched = [], seedKey }: { item: EvidenceItem; matched?: string[]; seedKey: string }) {
  const [whole, setWhole] = useState(false);
  // The lecture's own heading keeps its line (jury memo 12), the text runs below it.
  const parts = splitFragmentHeading(item.excerpt);
  const long = parts.body.length > EXCERPT_LIMIT;
  const text = long && !whole ? `${parts.body.slice(0, EXCERPT_LIMIT).replace(/\s+\S*$/, '')}…` : parts.body;
  return (
    <>
      <blockquote className="sf-slip" style={{ margin: 0 }}>
        {parts.heading && (
          <span className="ex-slip-head" data-fragment-heading="">
            {parts.heading}
          </span>
        )}
        <MarkedExcerpt text={text} matched={matched} seedKey={seedKey} />
      </blockquote>
      {long && (
        <button type="button" className="sf-link" data-muted="" onClick={() => setWhole((value) => !value)}>
          {whole ? 'Свернуть фрагмент' : 'Показать фрагмент целиком'}
        </button>
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
          <Excerpt item={item} seedKey={`${seedKey}:${index}`} />
          {item.material_id && (
            <Link className="sf-link" data-muted="" to={`/library/${item.material_id}`}>
              Открыть материал
            </Link>
          )}
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
