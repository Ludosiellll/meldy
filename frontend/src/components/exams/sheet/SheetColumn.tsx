import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AI_USAGE_EVENT, checkAILimit, formatLimitReset, nextLimitReset } from '../../../api/limits';
import type { SheetWriteState } from '../../../api/cheatSheet';
import type { HistoryFrame, LineState, SheetBlock, SheetCounts, SheetLine } from '../../../lib/exams/cheatSheet';
import { formatShortDay, fragmentNumber } from '../../../lib/exams/format';
import { glue, NBSP } from '../sheetModel';
import type { FrameBox } from '../useFrame';
import { counterDetails, counterLabel, erasableSentence, historyLine, lineNote, linesWord, priceLine, questionsWord } from './copy';
import type { SheetViewMode } from './CheatSheet';

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
        if (alive) setLeft(status.ok ? Math.max(0, status.limit - status.count) : null);
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

export function RollingNumber({ value, roll }: { value: number; roll: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!roll || typeof requestAnimationFrame !== 'function') {
      from.current = value;
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / 450);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, roll]);
  return <>{shown}</>;
}

// ── The summary card ───────────────────────────────────────────────────────────────────────

export interface SheetSummaryProps {
  counts: SheetCounts;
  /** The counter's number now (during a replay: the count before the answer). */
  left: number;
  roll: boolean;
  /** «35 % билетов, где оба вопроса есть в лекциях», as in «Вопросы». */
  shareLine: string | null;
  /** «После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.» */
  changeLine: string | null;
  mode: SheetViewMode;
  onMode: (mode: SheetViewMode) => void;
  /** «Показать последний ответ» (null: no answer changed the sheet). */
  onReplay: (() => void) | null;
  /** «История листа» (null: no history yet). */
  onHistory: (() => void) | null;
  history: { frame: HistoryFrame; first: HistoryFrame; running: boolean } | null;
  onHistoryStop: () => void;
  compact?: boolean;
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
  const details = counterDetails(counts);
  const history = props.history;
  const shownLeft = history ? history.frame.left : props.left;
  return (
    <div className="ex-summary cs-sum" data-compact={props.compact ? '' : undefined}>
      <p className="ex-why-t cs-flag">Шпаргалка</p>
      {counts.total > 0 && (
        <div className="cs-count" aria-live="polite">
          <span className="ex-big cs-big">
            <RollingNumber value={shownLeft} roll={props.roll || Boolean(history)} />
          </span>
          <span className="cs-count-l">{counterLabel({ left: shownLeft, total: history ? history.frame.total : counts.total })}</span>
        </div>
      )}
      {history ? (
        <p className="cs-sub">
          {history.running ? `${formatShortDay(history.frame.day)}` : historyResult(history.first, history.frame)}
        </p>
      ) : (
        details && <p className="cs-sub">{details}</p>
      )}
      {props.changeLine && !history && <p className="cs-change">{glue(props.changeLine)}</p>}
      {props.shareLine && !props.compact && !history && <p className="cs-share">{glue(props.shareLine)}</p>}
      {counts.total > 0 && (
        <div className="cs-toggles">
          <Toggle label="Только то, что осталось" on={mode.onlyLeft} onChange={(on) => onMode({ ...mode, onlyLeft: on })} />
          {!props.compact && (
            <>
              <Toggle
                label="Закрыть строки"
                on={mode.cover}
                onChange={(on) => onMode({ ...mode, cover: on })}
                hint="Строки закрыты — вспомните их сами. Открыть строку значит подсмотреть"
              />
              <Toggle label="Весь лист" on={mode.zoom} onChange={(on) => onMode({ ...mode, zoom: on })} />
            </>
          )}
        </div>
      )}
      {(props.onReplay || props.onHistory || history) && (
        <div className="cs-acts">
          {history?.running ? (
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
                  История листа
                </button>
              )}
              {history && (
                <button type="button" className="sf-link" data-muted="" onClick={props.onHistoryStop}>
                  Вернуться к сегодня
                </button>
              )}
            </>
          )}
        </div>
      )}
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
  /** A server job that this tab follows (after a reload). */
  following: boolean;
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
  const [stopNote, setStopNote] = useState<string | null>(null);
  const runningNow = write.phase === 'running';

  if (runningNow) {
    const total = write.total || props.toWrite;
    return (
      <div className="ex-blk cs-write" role="status">
        <p className="ex-stmt">
          {glue(`Пишем шпаргалку: ${write.done} из ${total || '…'}`)}
          <span className="cs-write-fine"> · можно закрыть страницу — допишется</span>
        </p>
        {stopNote ? (
          <p className="ex-fine">{stopNote}</p>
        ) : (
          <button
            type="button"
            className="sf-link"
            disabled={write.stopping}
            onClick={async () => {
              props.onStop();
              setStopNote('Новые вопросы не начнутся. Уже начатые допишутся и будут списаны.');
            }}
          >
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
      {first && !props.compact && (
        <>
          <h3 className="cs-write-h">Шпаргалка ещё не написана</h3>
          <p className="ex-stmt">
            Meldy выпишет из ваших лекций пункты ответа на каждый вопрос — по ним проверяется ваш ответ на билет. Эту шпаргалку стирают только
            ответы: назвали пункт — строка стирается наполовину, назвали снова в другой день — совсем. От чтения ничего не стирается.
          </p>
        </>
      )}
      {affordable > 0 ? (
        <div className="cs-write-go">
          <button type="button" className="sf-primary" onClick={() => props.onWrite(affordable < props.toWrite ? affordable : undefined)}>
            {label}
          </button>
        </div>
      ) : (
        <p className="ex-stmt">{glue(`Дневной лимит ИИ кончился. Шпаргалку можно будет написать после ${formatLimitReset(nextLimitReset())}.`)}</p>
      )}
      <p className="ex-fine">{glue(priceLine(props.toWrite, props.units, props.unitsLeft))}</p>
      {affordable > 0 && affordable < props.toWrite && (
        <p className="ex-fine">{glue(`Остальные ${props.toWrite - affordable} — после обновления лимита в ${formatLimitReset(nextLimitReset())}`)}</p>
      )}
      {first && !props.compact && (
        <p className="ex-fine">Это те же пункты, по которым проверяется ответ на билет: второй раз за них платить не придётся.</p>
      )}
    </div>
  );
}

/** The outcome of the last run in words, or null. */
export function outcomeLine(write: SheetWriteState, toWrite: number): string | null {
  if (write.phase === 'failed' || write.phase === 'interrupted') return write.message;
  if (write.phase !== 'done') return null;
  const total = write.total || write.written + write.failed + toWrite;
  if (write.limit) return `Написано ${write.written} из ${total}: лимит ИИ на сегодня кончился`;
  if (write.failed > 0 || write.busy > 0) {
    const missed = write.failed + write.busy;
    return `${missed}${NBSP}${questionsWord(missed)} не удалось написать — можно попробовать ещё раз`;
  }
  return toWrite === 0 ? 'Шпаргалка написана' : null;
}

// ── The details of one line ────────────────────────────────────────────────────────────────

export interface LinePanelProps {
  examId: string;
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
  const { line, block, state, peeked, examId, onClose, variant } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const sheet = variant === 'sheet';
  const status = state === line.status.state ? line.status : { ...line.status, state };
  const readable = READABLE.has(state) || peeked;
  const canPeek = !peeked && (state === 'rubbed' || state === 'due');

  useEffect(() => {
    if (sheet) closeRef.current?.focus();
  }, [sheet, line.key]);

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

  const kind = line.essential ? 'главный пункт' : 'пункт';
  let heading: string;
  if (readable) heading = line.title;
  else if (state === 'rubbed') heading = 'Строка стёрта наполовину';
  else if (state === 'due') heading = 'Строка стёрта — пора проверить';
  else heading = 'Строка стёрта';

  const lines: ReactNode[] = [];
  if (state === 'rubbed' && !peeked) {
    const when = erasableSentence(status);
    if (when) lines.push(when);
  }
  if (state === 'due' && !peeked) lines.push('Назовите этот пункт в ответе на вопрос — так станет ясно, помните ли вы его.');
  if (state === 'erased') lines.push('Чтобы увидеть её снова, ответьте на вопрос: строка вернётся, если пункт не прозвучит.');
  if (!canPeek && (state === 'missed' || state === 'returned')) {
    const note = lineNote(status);
    if (note) lines.push(note.charAt(0).toUpperCase() + note.slice(1));
  }
  if (status.peekedToday && !peeked && state !== 'erased') lines.push('Сегодня вы подсматривали эту строку: сегодня она не сотрётся.');

  const caption = readable ? quoteCaption(line, block) : null;
  const history = [...line.status.history].reverse();

  const content = (
    <>
      <p className="ex-why-t">{`Вопрос ${block.number} · ${kind}`}</p>
      <h3 id={props.headingId} className={readable ? 'cs-lp-title' : undefined}>
        {glue(heading)}
      </h3>
      {lines.map((text, index) => (
        <p key={index} className="ex-stmt">
          {typeof text === 'string' ? glue(text) : text}
        </p>
      ))}
      {canPeek && (
        <div className="cs-lp-peek">
          <p className="ex-fine">Подсмотреть — значит прочитать: сегодня эта строка уже не сотрётся.</p>
          <button type="button" className="sf-secondary" onClick={props.onPeek}>
            Подсмотреть
          </button>
        </div>
      )}
      {peeked && <p className="ex-fine cs-lp-peeked">Подсмотрели — сегодня эта строка не сотрётся.</p>}
      {readable && line.quote && (
        <>
          {caption && <p className="ex-slip-cap">{caption}</p>}
          <blockquote className="sf-slip cs-lp-quote">{line.quote}</blockquote>
        </>
      )}
      {history.length > 0 && (
        <div className="ex-blk">
          <p className="ex-why-t">История строки</p>
          <ul className="ex-attempts cs-lp-history">
            {history.map((event, index) => (
              <li key={`${event.at}:${index}`}>
                {event.sessionId ? (
                  <Link to={`/exams/${examId}/ticket?session=${encodeURIComponent(event.sessionId)}`}>{historyLine(event)}</Link>
                ) : (
                  <span>{historyLine(event)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="ex-why-go">
        <Link className="sf-primary" to={`/exams/${examId}/ticket?q=${encodeURIComponent(line.questionId)}`}>
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
          <button ref={closeRef} type="button" className="sf-link" data-muted="" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {content}
      </div>
    </>
  );
}
