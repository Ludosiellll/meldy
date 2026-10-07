import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AI_USAGE_EVENT, checkAILimit, formatLimitReset, nextLimitReset } from '../../../api/limits';
import type { SheetWriteState } from '../../../api/cheatSheet';
import type { HistoryFrame, LineState, SheetBlock, SheetCounts, SheetLine } from '../../../lib/exams/cheatSheet';
import { formatShortDay, fragmentNumber } from '../../../lib/exams/format';
import { glue, NBSP } from '../sheetModel';
import type { FrameBox } from '../useFrame';
import { usePrefersReducedMotion } from '../../landing/usePrefersReducedMotion';
import { splitFragmentHeading } from '../../../utils/fragmentText';
import {
  counterDetails,
  counterLabel,
  erasableSentence,
  historyLine,
  lineNote,
  linesWord,
  priceLine,
  questionsWord,
  SHEET_RULE,
  writtenLabel,
} from './copy';
import type { SheetViewMode } from './CheatSheet';
import type { SheetLinks } from './useSheetPage';

/**
 * Meldy's column beside the cheat sheet (spec 4.1, 8): how many lines are left, writing the sheet
 * (its price, its progress, its outcome), the quiet switches of the view, the last answer and the
 * history of the sheet; and the details of one line, which replace the column (a bottom sheet on a
 * phone), as «почему» does in «Вопросы».
 */

// ── The units left today (for the price line) ─────────────────────────────────────────────

export function useUnitsLeft(userId: string | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    const read = () => {
      void checkAILimit(userId, 0).then((status) => {
        if (alive) setLeft(status.ok && Number.isFinite(status.limit - status.count) ? Math.max(0, status.limit - status.count) : null);
      });
    };
    read();
    window.addEventListener(AI_USAGE_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(AI_USAGE_EVENT, read);
    };
  }, [userId]);
  return left;
}

// ── A number that rolls to its new value (450 ms, spec 6) ─────────────────────────────────

/**
 * The digits roll from the number on screen to the new one (a roll cut short by the next value goes on
 * from where it stood, so the history's fast frames never jump back); no roll under reduced motion.
 */
export function RollingNumber({ value, roll }: { value: number; roll: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    if (!roll || reduced || typeof requestAnimationFrame !== 'function') {
      current.current = value;
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    const origin = current.current;
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / 450);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(origin + (value - origin) * eased);
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, roll, reduced]);
  return <>{shown}</>;
}

// ── The summary card ───────────────────────────────────────────────────────────────────────

export interface SheetSummaryProps {
  counts: SheetCounts;
  /** The counter's number now (during a replay: the count before the answer). */
  left: number;
  roll: boolean;
  /** The sheet is being written: on a sheet nothing has touched yet the counter says «строк написано». */
  writing?: boolean;
  /** «35 % билетов, где оба вопроса есть в лекциях», as in «Вопросы». */
  shareLine: string | null;
  /** «После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.» */
  changeLine: string | null;
  /** Under it, smaller: why lines the answer named stayed as they were (named again too soon, a peek). */
  changeNote?: string | null;
  mode: SheetViewMode;
  onMode: (mode: SheetViewMode) => void;
  /** «Показать последний ответ» (null: no answer changed the sheet). */
  onReplay: (() => void) | null;
  /** «История листа» (null: no history yet). */
  onHistory: (() => void) | null;
  history: { frame: HistoryFrame; first: HistoryFrame; running: boolean } | null;
  onHistoryStop: () => void;
  /**
   * full — the column beside the sheet; on a phone the card is cut in two: top — the count and «Только
   * то, что осталось» above the paper, after — the share, the self-test, the last answer and the history
   * under it.
   */
  variant?: 'full' | 'top' | 'after';
}

function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (on: boolean) => void; hint?: string }) {
  return (
    <button type="button" className="cs-toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)} title={hint}>
      <span className="cs-toggle-box" aria-hidden="true" />
      <span className="cs-toggle-t">{label}</span>
    </button>
  );
}

export function SheetSummaryCard(props: SheetSummaryProps) {
  const { counts, mode, onMode } = props;
  const variant = props.variant ?? 'full';
  const details = counterDetails(counts);
  const history = props.history;
  const shownLeft = history ? history.frame.left : props.left;
  const shownTotal = history ? history.frame.total : counts.total;
  const showCount = variant !== 'after' && counts.total > 0;
  // Writing a sheet nothing has touched yet: «12 строк написано», not «12 строк осталось из 12».
  const firstLines = Boolean(props.writing) && !history && counts.left === counts.total && counts.rubbed === 0;
  const countLabel = firstLines ? writtenLabel(counts.total) : counterLabel({ left: shownLeft, total: shownTotal });
  const countValue = firstLines ? counts.total : shownLeft;
  const playing = Boolean(history?.running);
  const acts = (props.onReplay || props.onHistory || history) && (variant !== 'top' || playing) && (
    <div className="cs-acts">
      {playing ? (
        <button type="button" className="sf-link" onClick={props.onHistoryStop}>
          Остановить
        </button>
      ) : (
        <>
          {props.onReplay && (
            <button type="button" className="sf-link" onClick={props.onReplay}>
              Показать последний ответ
            </button>
          )}
          {props.onHistory && (
            <button type="button" className="sf-link" onClick={props.onHistory}>
              История шпаргалки
            </button>
          )}
          {history && (
            <button type="button" className="sf-link" data-muted="" onClick={props.onHistoryStop}>
              Закрыть историю
            </button>
          )}
        </>
      )}
    </div>
  );
  return (
    <div className="ex-summary cs-sum" data-variant={variant}>
      {variant === 'full' && <p className="ex-why-t cs-flag">Шпаргалка</p>}
      {showCount && (
        <div className="cs-count">
          <span className="ex-big cs-big" aria-hidden="true">
            <RollingNumber value={countValue} roll={props.roll || Boolean(history)} />
          </span>
          <span className="cs-count-l" aria-hidden="true">
            {countLabel}
          </span>
          {/* Read once, at the new number: the rolling digits are not announced frame by frame. */}
          <span className="sr-only" aria-live="polite">{`${countValue} ${countLabel}`}</span>
        </div>
      )}
      {showCount &&
        (history ? (
          <p className="cs-sub">{history.running ? `История шпаргалки: ${formatShortDay(history.frame.day)}` : historyResult(history.first, history.frame)}</p>
        ) : (
          details && <p className="cs-sub">{details}</p>
        ))}
      {variant !== 'after' && props.changeLine && !history && <p className="cs-change">{glue(props.changeLine)}</p>}
      {variant !== 'after' && props.changeLine && props.changeNote && !history && <p className="cs-change-note">{glue(props.changeNote)}</p>}
      {/* The promise stays on screen after the first-use tip: what erases the lines. */}
      {showCount && !history && <p className="cs-rule">{glue(SHEET_RULE)}</p>}
      {variant !== 'top' && props.shareLine && !history && <p className="cs-share">{glue(props.shareLine)}</p>}
      {counts.total > 0 && !playing && (
        <div className="cs-toggles">
          {variant !== 'after' && <Toggle label="Только то, что осталось" on={mode.onlyLeft} onChange={(on) => onMode({ ...mode, onlyLeft: on })} />}
          {variant !== 'top' && (
            <Toggle label="Спрятать строки" on={mode.cover} onChange={(on) => onMode({ ...mode, cover: on })} hint="Спрятать читаемые строки и вспомнить их по памяти" />
          )}
          {variant === 'full' && <Toggle label="Вся шпаргалка" on={mode.zoom} onChange={(on) => onMode({ ...mode, zoom: on })} />}
        </div>
      )}
      {mode.cover && variant !== 'top' && !playing && <p className="cs-sub cs-cover-note">Нажмите на спрятанную строку, чтобы открыть её. Это не «Подсмотреть»: ответ стирает её как обычно.</p>}
      {acts}
    </div>
  );
}

/** «180 → 61 строка за 5 недель» */
export function historyResult(first: HistoryFrame, last: HistoryFrame): string {
  const days = Math.max(1, Math.round((Date.parse(`${last.day}T12:00:00`) - Date.parse(`${first.day}T12:00:00`)) / 86_400_000));
  const span =
    days >= 14
      ? `${Math.round(days / 7)}${NBSP}${weeksWord(Math.round(days / 7))}`
      : `${days}${NBSP}${days % 10 === 1 && days % 100 !== 11 ? 'день' : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14) ? 'дня' : 'дней'}`;
  // Half-erasing does not change the count: a history of rubbed lines only says that nothing is gone yet.
  if (last.left === first.left) return `За ${span} ни одна строка не стёрлась совсем`;
  return `${first.left} → ${last.left}${NBSP}${linesWord(last.left)} за ${span}`;
}

function weeksWord(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'неделю';
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return 'недели';
  return 'недель';
}

// ── Writing the sheet ──────────────────────────────────────────────────────────────────────

export interface SheetWriteProps {
  /** Questions with a rubric already, questions that can still be written, their price. */
  written: number;
  toWrite: number;
  units: number;
  /** Units left today (null: unknown). */
  unitsLeft: number | null;
  write: SheetWriteState;
  onWrite: (count?: number) => void;
  onStop: () => void;
  /** The mapping is running: nothing can be written until it ends. */
  mappingRunning: boolean;
  /** No question has been checked against the lectures yet. */
  unmapped: boolean;
  compact?: boolean;
}

export function SheetWriteCard(props: SheetWriteProps) {
  const { write } = props;

  if (write.phase === 'running') {
    const total = write.total || props.toWrite;
    return (
      <div className="ex-blk cs-write" role="status">
        <p className="ex-stmt">
          {glue(`Пишем шпаргалку: ${write.done} из ${total || '…'}`)}
          <span className="cs-write-fine"> · можно закрыть страницу — допишется</span>
        </p>
        {write.stopping ? (
          <p className="ex-fine">Новые вопросы не начнутся. Начатые допишутся — единицы за них спишутся.</p>
        ) : (
          <button type="button" className="sf-link" onClick={props.onStop}>
            Остановить
          </button>
        )}
      </div>
    );
  }

  const outcome = outcomeLine(write, props.toWrite);
  if (props.toWrite === 0) {
    if (!outcome) return null;
    return (
      <div className="ex-blk cs-write">
        <p className="ex-stmt">{glue(outcome)}</p>
      </div>
    );
  }

  if (props.mappingRunning) {
    return (
      <div className="ex-blk cs-write">
        <p className="ex-stmt">Шпаргалку можно будет написать, когда закончится сверка с лекциями.</p>
      </div>
    );
  }

  // Units are enough for some questions only: the button writes those; the rest after the reset.
  const affordable = props.unitsLeft === null ? props.toWrite : Math.min(props.toWrite, props.unitsLeft);
  const first = props.written === 0;
  const label = affordable < props.toWrite && affordable > 0 ? `Написать ${affordable}${NBSP}${questionsWord(affordable)}` : first ? 'Написать шпаргалку' : `Дописать ${props.toWrite}${NBSP}${questionsWord(props.toWrite)}`;
  return (
    <div className="ex-blk cs-write" data-first={first ? '' : undefined}>
      {outcome && <p className="ex-stmt cs-outcome">{glue(outcome)}</p>}
      {first && props.compact && (
        <p className="ex-stmt cs-write-short">
          Meldy выпишет из ваших лекций пункты ответа на вопросы, которые в них есть. Строки шпаргалки стирают только ваши ответы, от чтения ничего не стирается.
        </p>
      )}
      {first && !props.compact && (
        <>
          <h3 className="cs-write-h">Шпаргалка ещё не написана</h3>
          <p className="ex-stmt">
            Meldy выпишет из ваших лекций пункты ответа на вопросы, которые в них есть. Эту шпаргалку стирают только ответы: назвали пункт —
            строка стирается наполовину, назвали снова в другой день — совсем. От чтения ничего не стирается.
          </p>
        </>
      )}
      {affordable > 0 ? (
        <div className="cs-write-go">
          {/* The column's filled pill only before the first write; then «Тянуть билет» stays the one. */}
          <button type="button" className={first ? 'sf-primary' : 'ex-secondary'} onClick={() => props.onWrite(affordable < props.toWrite ? affordable : undefined)}>
            {label}
          </button>
        </div>
      ) : (
        <p className="ex-stmt">{glue(`Дневной лимит ИИ кончился. Шпаргалку можно будет написать после ${formatLimitReset(nextLimitReset())}.`)}</p>
      )}
      <p className="ex-fine">{glue(priceLine(props.toWrite, props.units, props.unitsLeft))}</p>
      {affordable > 0 && affordable < props.toWrite && (
        <p className="ex-fine">{glue(`Ещё ${props.toWrite - affordable}${NBSP}${questionsWord(props.toWrite - affordable)} — после обновления лимита в ${formatLimitReset(nextLimitReset())}`)}</p>
      )}
      {first && !props.compact && (
        <p className="ex-fine">Это те же пункты, по которым проверяется ответ на билет: когда будете отвечать, за них второй раз платить не придётся.</p>
      )}
    </div>
  );
}

/** The outcome of the last run in words, or null. */
export function outcomeLine(write: SheetWriteState, toWrite: number): string | null {
  if (write.phase === 'failed' || write.phase === 'interrupted') return write.message;
  if (write.phase !== 'done') return null;
  const total = write.total || write.written + write.failed + toWrite;
  if (write.limit) return `Написано ${write.written} из ${total}: дневной лимит ИИ кончился`;
  if (write.failed > 0 || write.busy > 0) {
    const missed = write.failed + write.busy;
    return `${missed}${NBSP}${questionsWord(missed)} не удалось написать — можно попробовать ещё раз`;
  }
  return toWrite === 0 ? 'Шпаргалка написана' : null;
}

// ── The details of one line ────────────────────────────────────────────────────────────────

export interface LinePanelProps {
  /** Where «Ответить на этот вопрос» and the answers of the history lead. */
  links: Pick<SheetLinks, 'answer' | 'session' | 'sessionNote'>;
  line: SheetLine;
  block: SheetBlock;
  /** The line's state as drawn now. */
  state: LineState;
  /** Uncovered now. */
  peeked: boolean;
  onPeek: () => void;
  onClose: () => void;
  variant: 'column' | 'sheet';
  frameBox?: FrameBox;
  headingId: string;
}

const READABLE: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'missed', 'returned']);

/**
 * The lecture's words under a line: a heading on its own line at the start of the fragment is left
 * out (it is not part of the sentence), and a quote cut off mid-sentence ends with «…».
 */
export function quoteText(quote: string): string {
  const body = splitFragmentHeading(quote).body.trim();
  return /[.!?…»"”)]$/u.test(body) ? body : `${body}…`;
}

/** «Лекция «Спрос и предложение», фрагмент 12» for the line's quote. */
function quoteCaption(line: SheetLine, block: SheetBlock): string | null {
  const id = line.sourceIds[0];
  if (!id) return null;
  const [key] = id.split(':');
  const material = block.materials.find((item) => item.key === key);
  const number = fragmentNumber(id);
  const lecture = material?.title ? `Лекция «${material.title}»` : 'Лекция';
  return number === null ? lecture : `${lecture}, фрагмент${NBSP}${number}`;
}

export function LinePanel(props: LinePanelProps) {
  const { line, block, state, peeked, links, onClose, variant } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const sheet = variant === 'sheet';
  const status = state === line.status.state ? line.status : { ...line.status, state };
  const readable = READABLE.has(state) || peeked;
  const canPeek = !peeked && (state === 'rubbed' || state === 'due');

  // The panel takes the focus when it opens (Enter on a line lands on its details, «Подсмотреть» is
  // next); after «Подсмотреть» the button is gone, and the focus goes to the heading, which now reads
  // the line's words.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: !sheet });
  }, [sheet, line.key]);
  const onPeek = () => {
    props.onPeek();
    window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
  };

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

  // A bottom sheet holds the page still while it is open.
  useEffect(() => {
    if (!sheet) return undefined;
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

  let heading: string;
  if (readable) heading = line.title;
  else if (state === 'rubbed') heading = 'Строка стёрта наполовину';
  else if (state === 'due') heading = 'Строка стёрта — пора проверить';
  else heading = 'Строка стёрта';

  // One paragraph says what an answer will do to the line now; a peek earlier today is part of it
  // (it changes what today's answer does), never a second, contradicting sentence.
  const lines: ReactNode[] = [];
  const peekedEarlier = status.peekedToday && !peeked;
  if (state === 'rubbed' && !peeked) {
    const when = erasableSentence(status);
    if (peekedEarlier) lines.push(`Сегодня вы подсматривали эту строку, поэтому сегодняшний ответ её не сотрёт.${when ? ` ${when}` : ''}`);
    else if (when) lines.push(when);
  }
  if (state === 'due' && !peeked) {
    lines.push(
      peekedEarlier
        ? 'Сегодня вы подсматривали эту строку: сегодняшний ответ её не сотрёт, а если пункт не назвать — строка вернётся. Назовите его в ответе в другой день — снова сотрётся.'
        : 'Назовите этот пункт в ответе: назовёте — строка снова сотрётся, не назовёте — вернётся.',
    );
  }
  if (state === 'erased') lines.push('Стёртую строку не подсмотреть. Она вернётся, если в ответе этот пункт не будет назван.');
  if (!canPeek && (state === 'missed' || state === 'returned')) {
    const note = lineNote(status);
    if (note) lines.push(note.charAt(0).toUpperCase() + note.slice(1));
  }
  if (peekedEarlier && (state === 'fresh' || state === 'missed' || state === 'returned')) lines.push('Сегодня вы подсматривали эту строку, поэтому сегодняшний ответ её не сотрёт.');

  const caption = readable ? quoteCaption(line, block) : null;
  const quote = readable && line.quote ? quoteText(line.quote) : null;
  const history = [...line.status.history].reverse();
  const place = block.lines.indexOf(line) + 1;

  const content = (
    <>
      <p className="ex-why-t">{`Вопрос ${block.number} · пункт ${place > 0 ? place : 1}${line.essential ? ' · главный' : ''}`}</p>
      <h3 id={props.headingId} ref={headingRef} tabIndex={-1} className={readable ? 'cs-lp-title' : undefined}>
        {glue(heading)}
      </h3>
      {lines.map((text, index) => (
        <p key={index} className="ex-stmt">
          {typeof text === 'string' ? glue(text) : text}
        </p>
      ))}
      {canPeek && (
        <div className="cs-lp-peek">
          {!status.peekedToday && <p className="ex-fine">Если подсмотреть, сегодня ответ её не сотрёт.</p>}
          <button type="button" className="sf-secondary" onClick={onPeek}>
            Подсмотреть
          </button>
        </div>
      )}
      {peeked && <p className="ex-fine cs-lp-peeked">Подсмотрели — сегодня ответ её не сотрёт.</p>}
      {quote && (
        <>
          {caption && <p className="ex-slip-cap">{caption}</p>}
          <blockquote className="sf-slip cs-lp-quote">{quote}</blockquote>
        </>
      )}
      {history.length > 0 && (
        <div className="ex-blk">
          <p className="ex-why-t">История строки</p>
          <ul className="ex-attempts cs-lp-history">
            {history.map((event, index) => {
              const href = event.sessionId ? links.session(event.sessionId) : null;
              const note = event.sessionId ? links.sessionNote?.(event.sessionId) ?? null : null;
              const text = note ? `${historyLine(event)} (${note})` : historyLine(event);
              return <li key={`${event.at}:${index}`}>{href ? <Link to={href}>{text}</Link> : <span>{text}</span>}</li>;
            })}
          </ul>
        </div>
      )}
      <div className="ex-why-go">
        <Link className="sf-primary" to={links.answer(line.questionId)}>
          Ответить на этот вопрос
        </Link>
      </div>
      {!sheet && (
        <div className="ex-why-acts">
          <button type="button" className="sf-link" data-muted="" onClick={onClose}>
            Закрыть
          </button>
        </div>
      )}
    </>
  );

  if (!sheet) {
    return (
      <section className="ex-why cs-lp" aria-labelledby={props.headingId} aria-live="polite" ref={rootRef}>
        {content}
      </section>
    );
  }

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !rootRef.current) return;
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

  return (
    <>
      <div className="ex-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={rootRef}
        className="ex-why ex-why-sheet cs-lp"
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.headingId}
        onKeyDown={trapFocus}
        style={{ left: props.frameBox?.left ?? 0, right: props.frameBox?.right ?? 0, transform: dragY ? `translateY(${dragY}px)` : undefined }}
      >
        <div className="ex-grip-area" onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp} style={{ touchAction: 'none' }}>
          <span className="ex-grip" aria-hidden="true" />
        </div>
        <div className="ex-sheet-close">
          <button type="button" className="sf-link cs-lp-close" data-muted="" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {content}
      </div>
    </>
  );
}
