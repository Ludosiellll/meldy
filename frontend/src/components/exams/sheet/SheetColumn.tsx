import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AI_USAGE_EVENT, checkAILimit, formatLimitReset, nextLimitReset } from '../../../api/limits';
import type { SheetWriteState } from '../../../api/cheatSheet';
import { POINTS_NOT_WRITTEN, type HistoryFrame, type LineState, type SheetBlock, type SheetCounts, type SheetLine } from '../../../lib/exams/cheatSheet';
import { formatShortDay, fragmentNumber } from '../../../lib/exams/format';
import { genitiveOf, glue, NBSP } from '../sheetModel';
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
  writtenLabel,
} from './copy';
import type { SheetViewMode } from './CheatSheet';
import { SheetRule } from './SheetLegend';
import type { SheetLinks } from './useSheetPage';

/**
 * Meldy's column beside the cheat sheet (spec 4.1, 8): how many lines are left and their map, writing the
 * sheet (its price, its progress, its outcome), the quiet switches of the view, the last answer and the
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
  /** The card the paper's «К счётчику и переключателям» leads to. */
  id?: string;
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
  history: { frame: HistoryFrame; first: HistoryFrame; lowest: number; running: boolean } | null;
  onHistoryStop: () => void;
  /** «Показ на проекторе»: the paper waits; «Показать, что изменилось» stands where the links are. */
  onShow?: (() => void) | null;
  /** A word that something went wrong (a peek not saved), under the change. */
  notice?: ReactNode;
  /**
   * The page's next step after the change (the example: its own exam after the guest's answer), between
   * what the answer changed and the rule; the column's card only.
   */
  next?: ReactNode;
  /**
   * What «Скрыть строки, стёртые совсем» says while no line is erased (the example: which answer erases
   * them); by default ONLY_LEFT_NONE.
   */
  onlyLeftNone?: string | null;
  /**
   * full — the column beside the sheet; on a phone the card is cut in two: top — the count and «Скрыть
   * строки, стёртые совсем» in one row and the map under them, at the top of the sheet's card (its lines on the
   * first screen), after — what the count means, the last answer's change, the rule, the share, the self-test,
   * the last answer and the history under the card. phone — the exam page on a phone (10_Project/Phone_Declutter_2026-10-08):
   * at the top of the sheet's card the count and the map, the last answer's change, and what the count means, the rule,
   * the share and `more` behind «Как стираются строки»; phone-tools — under the card the switches, the last answer
   * and the history.
   */
  variant?: 'full' | 'top' | 'after' | 'phone' | 'phone-tools';
  /** More lines behind «Подробнее» of the phone's block (the questions whose points could not be written). */
  more?: ReactNode;
  /**
   * The map of lines (SheetMap) under the count: in the column's card, and at the top of a phone's card (top, phone);
   * not under the card (after).
   */
  map?: ReactNode;
}

/** «Скрыть строки, стёртые совсем»: hides the erased lines and folds a question with nothing left (spec 4.1). */
export const ONLY_LEFT_LABEL = 'Скрыть строки, стёртые совсем';
/** Said under it while no line is erased yet, so the switch does not seem to do nothing (PUB-16). */
export const ONLY_LEFT_NONE = 'Таких строк пока нет';
/** «Спрятать строки» (spec 7.3), and under it what it is for: a newcomer read the name as «удалить». */
export const COVER_LABEL = 'Спрятать строки';
export const COVER_HINT = 'и проверить, что помните их';
/**
 * «Вся шпаргалка» (spec 7.4) is a zoom, not a third filter beside «Скрыть строки…» (EX-14: it read as
 * «show all»): a quiet button with a magnifier by the card's flag, named by what it does.
 */
export const ZOOM_IN_LABEL = 'Весь лист на экране';
export const ZOOM_OUT_LABEL = 'Обычный размер';

interface ToggleProps {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  /** Under the label, smaller, for everyone (it was only a `title`, which a phone never shows). */
  hint?: string | null;
  /** The switch cannot be turned now: why, in place of the hint. It stays a stop of the keyboard. */
  unavailable?: string | null;
}

function Toggle({ label, on, onChange, hint, unavailable }: ToggleProps) {
  const id = useId();
  const note = unavailable ?? hint ?? null;
  return (
    <button
      type="button"
      className="cs-toggle"
      role="switch"
      aria-checked={unavailable ? false : on}
      aria-disabled={unavailable ? true : undefined}
      aria-describedby={note ? id : undefined}
      onClick={() => {
        if (!unavailable) onChange(!on);
      }}
    >
      <span className="cs-toggle-box" aria-hidden="true" />
      <span className="cs-toggle-text">
        <span className="cs-toggle-t">{label}</span>
        {/* The name is the label; the note is the switch's description (and seen under it). */}
        {note && (
          <span className="cs-toggle-hint" id={id} aria-hidden="true">
            {glue(note)}
          </span>
        )}
      </span>
    </button>
  );
}

/** A magnifier with a minus (the whole sheet, smaller) or a plus (back to its size). */
function ZoomIcon({ out }: { out: boolean }) {
  return (
    <svg className="cs-zoom-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 20 20M7.5 10.5h6" />
      {out ? null : <path d="M10.5 7.5v6" />}
    </svg>
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
  const explains = variant !== 'top';
  // Writing a sheet nothing has touched yet: «12 строк написано», not «12 строк осталось из 12».
  const firstLines = Boolean(props.writing) && !history && counts.left === counts.total && counts.rubbed === 0;
  const countLabel = firstLines ? writtenLabel(counts.total) : counterLabel({ left: shownLeft, total: shownTotal });
  const countValue = firstLines ? counts.total : shownLeft;
  const playing = Boolean(history?.running);
  // Nothing erased yet: «Скрыть строки, стёртые совсем» would change nothing — it says so instead (PUB-16).
  const onlyLeftNone = counts.erased === 0 ? (props.onlyLeftNone ?? ONLY_LEFT_NONE) : null;

  // The keyboard follows the buttons that replace each other («История шпаргалки» → «Остановить» →
  // «Закрыть историю» → «История шпаргалки»), when it stood on them (not when it is elsewhere).
  const rootRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef<HTMLButtonElement>(null);
  const hasHistory = Boolean(history);
  const was = useRef({ playing, hasHistory });
  useEffect(() => {
    const before = was.current;
    was.current = { playing, hasHistory };
    const acts = rootRef.current?.querySelector<HTMLElement>('.cs-acts') ?? null;
    if (playing && !before.playing) keepFocus(stopRef.current, acts);
    else if (!playing && before.playing && hasHistory) keepFocus(closeRef.current, acts);
    else if (!hasHistory && before.hasHistory) keepFocus(historyRef.current, acts);
  }, [playing, hasHistory]);

  // A phone's card under the paper says nothing while the history plays (its day rides over the bottom bar).
  if (variant === 'after' && playing) return null;
  if (variant === 'phone' || variant === 'phone-tools') return <PhoneSummaryCard {...props} />;

  const acts = props.onShow && variant !== 'top' ? (
    <div className="cs-acts">
      <button type="button" className="sf-primary cs-show-now" onClick={props.onShow} autoFocus>
        Показать, что изменилось
      </button>
    </div>
  ) : (
    // A phone's card above the paper has no links: the history's «Остановить» rides over the bottom bar.
    (props.onReplay || props.onHistory || history) &&
    variant !== 'top' && (
      <div className="cs-acts">
        {playing ? (
          <button type="button" className="sf-link" ref={stopRef} onClick={props.onHistoryStop}>
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
              <button type="button" className="sf-link" ref={historyRef} onClick={props.onHistory}>
                История шпаргалки
              </button>
            )}
            {history && (
              <button type="button" className="sf-link" ref={closeRef} data-muted="" onClick={props.onHistoryStop}>
                Закрыть историю
              </button>
            )}
          </>
        )}
      </div>
    )
  );
  const sub = history ? (
    <p className="cs-sub">{history.running ? `История шпаргалки: ${formatShortDay(history.frame.day)}` : historyResult(history.first, history.frame, history.lowest)}</p>
  ) : (
    details && <p className="cs-sub">{details}</p>
  );
  return (
    <div className="ex-summary cs-sum" data-variant={variant} id={props.id} tabIndex={props.id ? -1 : undefined} ref={rootRef}>
      {variant === 'full' && (
        <div className="cs-head">
          <p className="ex-why-t cs-flag">Шпаргалка</p>
          {counts.total > 0 && !playing && (
            <button type="button" className="cs-zoom" onClick={() => onMode({ ...mode, zoom: !mode.zoom })}>
              <ZoomIcon out={!mode.zoom} />
              {mode.zoom ? ZOOM_OUT_LABEL : ZOOM_IN_LABEL}
            </button>
          )}
        </div>
      )}
      {showCount && (
        <div className="cs-count">
          <span className="ex-big cs-big" aria-hidden="true">
            <RollingNumber value={countValue} roll={props.roll || Boolean(history)} />
          </span>
          <span className="cs-count-l" aria-hidden="true">
            {countLabel}
          </span>
          {/* Read in place, whole; what changed is told once, by the page's status line, not by every new number. */}
          <span className="sr-only">{`${countValue} ${countLabel}`}</span>
          {/* A phone: the one switch beside the count, in the same row — once there is something for it to hide. */}
          {variant === 'top' && counts.total > 0 && !playing && !onlyLeftNone && (
            <span className="cs-count-switch">
              <Toggle label={ONLY_LEFT_LABEL} on={mode.onlyLeft} onChange={(on) => onMode({ ...mode, onlyLeft: on })} />
            </span>
          )}
        </div>
      )}
      {explains && counts.total > 0 && sub}
      {variant !== 'after' && counts.total > 0 && props.map}
      {explains && props.changeLine && !history && <p className="cs-change">{glue(props.changeLine)}</p>}
      {explains && props.changeLine && props.changeNote && !history && <p className="cs-change-note">{glue(props.changeNote)}</p>}
      {explains && props.notice}
      {variant === 'full' && props.next && !history && <div className="cs-next">{props.next}</div>}
      {/* The promise stays on screen after the first-use tip: what erases the lines (the map's key says how they look). */}
      {explains && counts.total > 0 && !history && <SheetRule />}
      {explains && props.shareLine && !history && <p className="cs-share">{glue(props.shareLine)}</p>}
      {counts.total > 0 && !playing && variant !== 'top' && (
        <div className="cs-toggles">
          {variant === 'full' && <Toggle label={ONLY_LEFT_LABEL} on={mode.onlyLeft} onChange={(on) => onMode({ ...mode, onlyLeft: on })} unavailable={onlyLeftNone} />}
          <Toggle label={COVER_LABEL} on={mode.cover} onChange={(on) => onMode({ ...mode, cover: on })} hint={mode.cover ? null : COVER_HINT} />
        </div>
      )}
      {mode.cover && variant !== 'top' && !playing && <p className="cs-sub cs-cover-note">Нажмите на спрятанную строку, чтобы открыть её. Это не «Подсмотреть»: ответ стирает её как обычно.</p>}
      {acts}
    </div>
  );
}

/** The phone block's disclosure: the rule of erasing — the sentence that says what the sheet is — and the rest. */
export const ERASE_RULE_LABEL = 'Как стираются строки';

/**
 * The exam page's sheet on a phone (10_Project/Phone_Declutter_2026-10-08): one summary instead of the count above the
 * card and three cards under it, cut so that the list starts high. phone — at the top of the sheet's card: the count
 * and the map of lines, what the last answer changed; the rule of erasing, what the count means, the share and the
 * questions without points behind «Как стираются строки» after the count's words (a muted link: it explains; as
 * «Подробнее» it hid the sentence that says what the sheet is). phone-tools — right under the card: the two switches,
 * «Показать последний ответ» and «История шпаргалки». While the history plays its day and «Остановить» ride over the
 * bottom bar, as before.
 */
function PhoneSummaryCard(props: SheetSummaryProps) {
  const { counts, mode, onMode } = props;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const history = props.history;
  const playing = Boolean(history?.running);
  const shownLeft = history ? history.frame.left : props.left;
  const shownTotal = history ? history.frame.total : counts.total;
  const firstLines = Boolean(props.writing) && !history && counts.left === counts.total && counts.rubbed === 0;
  const countLabel = firstLines ? writtenLabel(counts.total) : counterLabel({ left: shownLeft, total: shownTotal });
  const countValue = firstLines ? counts.total : shownLeft;
  const details = counterDetails(counts);
  const erasedSome = counts.erased > 0;
  if (counts.total === 0) return null;

  if (props.variant === 'phone-tools') {
    if (playing) return null;
    const hasActs = Boolean(props.onReplay || props.onHistory || history);
    return (
      <div className="ex-summary cs-sum" data-variant="phone-tools" id={props.id} tabIndex={props.id ? -1 : undefined}>
        <div className="cs-toggles">
          {/* Only once there is something for it to hide (PUB-16). */}
          {erasedSome && <Toggle label={ONLY_LEFT_LABEL} on={mode.onlyLeft} onChange={(on) => onMode({ ...mode, onlyLeft: on })} />}
          <Toggle label={COVER_LABEL} on={mode.cover} onChange={(on) => onMode({ ...mode, cover: on })} hint={mode.cover ? null : COVER_HINT} />
        </div>
        {mode.cover && <p className="cs-sub cs-cover-note">Нажмите на спрятанную строку, чтобы открыть её. Это не «Подсмотреть»: ответ стирает её как обычно.</p>}
        {hasActs && (
          // One row on a 360 px phone: the visible words are short, the names whole (the words are part of them).
          <div className="cs-acts">
            {props.onReplay && (
              <button type="button" className="sf-link" aria-label="Показать последний ответ" onClick={props.onReplay}>
                Последний ответ
              </button>
            )}
            {props.onHistory && (
              <button type="button" className="sf-link" aria-label="История шпаргалки" onClick={props.onHistory}>
                История
              </button>
            )}
            {history && (
              <button type="button" className="sf-link" data-muted="" aria-label="Закрыть историю шпаргалки" onClick={props.onHistoryStop}>
                Закрыть историю
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const sub = history && !playing ? historyResult(history.first, history.frame, history.lowest) : null;
  // The rule a tap away, after the count's words — as «… в лекциях. Как считается» over the list of «Вопросы».
  const disclosure = playing ? null : (
    <button type="button" className="sf-link cs-how" data-muted="" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => setOpen((value) => !value)}>
      {ERASE_RULE_LABEL}
    </button>
  );
  return (
    <div className="ex-summary cs-sum" data-variant="phone">
      <div className="cs-count">
        <span className="ex-big cs-big" aria-hidden="true">
          <RollingNumber value={countValue} roll={props.roll || Boolean(history)} />
        </span>
        <span className="sr-only">{`${countValue} ${countLabel}`}</span>
        <span className="cs-count-l">
          <span aria-hidden="true">{disclosure ? `${countLabel}.` : countLabel}</span>
          {disclosure ? <> {disclosure}</> : null}
        </span>
      </div>
      {open && !playing && (
        <div className="cs-more" id={detailsId}>
          <SheetRule />
          {details && <p className="cs-sub">{details}</p>}
          {props.shareLine && <p className="cs-share">{glue(props.shareLine)}</p>}
          {props.more}
        </div>
      )}
      {props.map}
      {sub && <p className="cs-sub">{sub}</p>}
      {props.changeLine && !history && <p className="cs-change">{glue(props.changeLine)}</p>}
      {props.changeLine && props.changeNote && !history && <p className="cs-change-note">{glue(props.changeNote)}</p>}
      {props.notice}
    </div>
  );
}

/** Moves the keyboard to `element` when it was lost (on the page's body) or stood inside `within`. */
function keepFocus(element: HTMLElement | null, within: HTMLElement | null): void {
  if (!element) return;
  const active = document.activeElement;
  if (!active || active === document.body || (within && within.contains(active))) element.focus({ preventScroll: true });
}

/**
 * «180 → 61 строка за 5 недель»; lines that went and came back are not «nothing»: «1 → 0 → 1 строка
 * за 6 дней». `lowest`: the fewest lines left on a day of the history.
 */
export function historyResult(first: HistoryFrame, last: HistoryFrame, lowest: number = Math.min(first.left, last.left)): string {
  const days = Math.max(1, Math.round((Date.parse(`${last.day}T12:00:00`) - Date.parse(`${first.day}T12:00:00`)) / 86_400_000));
  const span =
    days >= 14
      ? `${Math.round(days / 7)}${NBSP}${weeksWord(Math.round(days / 7))}`
      : `${days}${NBSP}${days % 10 === 1 && days % 100 !== 11 ? 'день' : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14) ? 'дня' : 'дней'}`;
  if (lowest < Math.min(first.left, last.left)) return `${first.left} → ${lowest} → ${last.left}${NBSP}${linesWord(last.left)} за ${span}`;
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
  /** Questions whose points failed the quote check twice: they cannot be written (not in toWrite). */
  unwritable?: number;
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
  /**
   * The page's status block offers the write with its price (components/exams/examStatus.ts): the card says what
   * the sheet is, without a second button and price line.
   */
  hideAction?: boolean;
}

export function SheetWriteCard(props: SheetWriteProps) {
  const { write } = props;
  // The keyboard follows the write: from «Написать» (gone) to «Остановить», then to what came of it.
  const stopRef = useRef<HTMLButtonElement>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const running = write.phase === 'running';
  const wasRunning = useRef(running);
  useEffect(() => {
    const was = wasRunning.current;
    wasRunning.current = running;
    if (running && !was) keepFocus(stopRef.current, null);
    else if (!running && was) keepFocus(outcomeRef.current, null);
  }, [running]);

  if (running) {
    const total = write.total || props.toWrite;
    return (
      <div className="ex-blk cs-write">
        <p className="ex-stmt">
          {glue(`Пишем шпаргалку: ${write.done} из ${total || '…'}`)}
          <span className="cs-write-fine">{`${NBSP}· можно закрыть страницу${NBSP}— допишется`}</span>
        </p>
        {/* A screen reader hears the progress every ten questions, not every one (and not «Остановить» with it). */}
        <p className="sr-only" role="status">{`Пишем шпаргалку: ${Math.floor(write.done / 10) * 10} из ${total || 'нескольких'}`}</p>
        {write.stopping ? (
          <p className="ex-fine">Новые вопросы не начнутся. Начатые допишутся — единицы за них спишутся.</p>
        ) : (
          <button type="button" className="sf-link" ref={stopRef} onClick={props.onStop}>
            Остановить
          </button>
        )}
      </div>
    );
  }

  const outcome = outcomeLine(write, props.toWrite);
  // Said plainly and not offered again: their points failed the quote check twice (live run of 2026-10-07: «2 вопроса —
  // 2 единицы» stayed on the author's sheet for good).
  const unwritable = props.unwritable ?? 0;
  const unwritableNote = unwritable > 0 ? <p className="ex-fine cs-unwritable">{glue(unwritableLine(unwritable))}</p> : null;
  if (props.toWrite === 0) {
    if (!outcome && !unwritableNote) return null;
    return (
      <div className="ex-blk cs-write">
        {outcome && (
          <p className="ex-stmt cs-outcome" ref={outcomeRef} tabIndex={-1} role="status">
            {glue(outcome)}
          </p>
        )}
        {unwritableNote}
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
  // «Дописать» offered by the status block: nothing is left for the card to say.
  if (props.hideAction && !first && !outcome && !unwritableNote) return null;
  return (
    <div className="ex-blk cs-write" data-first={first ? '' : undefined}>
      {outcome && (
        <p className="ex-stmt cs-outcome" ref={outcomeRef} tabIndex={-1} role="status">
          {glue(outcome)}
        </p>
      )}
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
      {props.hideAction ? null : affordable > 0 ? (
        <div className="cs-write-go">
          {/* The column's filled pill only before the first write; then «Тянуть билет» stays the one. */}
          <button type="button" className={first ? 'sf-primary' : 'ex-secondary'} onClick={() => props.onWrite(affordable < props.toWrite ? affordable : undefined)}>
            {label}
          </button>
        </div>
      ) : (
        <p className="ex-stmt">{glue(`Дневной лимит ИИ кончился. Шпаргалку можно будет написать после ${formatLimitReset(nextLimitReset())}.`)}</p>
      )}
      {!props.hideAction && <p className="ex-fine">{glue(priceLine(props.toWrite, props.units, props.unitsLeft))}</p>}
      {unwritableNote}
      {!props.hideAction && affordable > 0 && affordable < props.toWrite && (
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
  // The server's own daily limit of writes, not the AI and not the student's units.
  if (write.capped > 0) return `Написано ${write.written} из ${total}: сервер на сегодня исчерпал запись шпаргалок — остальное можно дописать после ${formatLimitReset(nextLimitReset())}`;
  // Points that failed the quote check twice are not «можно попробовать ещё раз»: the card says so on its own line.
  const missed = Math.max(0, write.failed - (write.unverifiable ?? 0)) + write.busy;
  if (missed > 0) return `${missed}${NBSP}${questionsWord(missed)} не удалось написать — можно попробовать ещё раз`;
  return toWrite === 0 ? 'Шпаргалка написана' : null;
}

/** «У 2 вопросов пункты не записаны: Meldy не смог подтвердить их цитатами из лекций» — POINTS_NOT_WRITTEN, counted. */
export function unwritableLine(count: number): string {
  return `У${NBSP}${count}${NBSP}${genitiveOf(count, 'вопроса', 'вопросов')} ${POINTS_NOT_WRITTEN.charAt(0).toLowerCase()}${POINTS_NOT_WRITTEN.slice(1)}`;
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
  /** A word that something went wrong (a peek not saved). */
  notice?: ReactNode;
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

  // A bottom sheet holds the page still while it is open, and is the only thing a keyboard or a screen
  // reader can reach: everything around it is inert (its scrim still closes it).
  useEffect(() => {
    if (!sheet) return undefined;
    const targets = [document.documentElement, document.body];
    const previous = targets.map((element) => element.style.overflow);
    targets.forEach((element) => {
      element.style.overflow = 'hidden';
    });
    const made: Element[] = [];
    for (let node: Element | null = rootRef.current; node && node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node || sibling.classList.contains('ex-scrim') || sibling.hasAttribute('inert') || sibling.tagName === 'SCRIPT') continue;
        sibling.setAttribute('inert', '');
        made.push(sibling);
      }
    }
    return () => {
      targets.forEach((element, index) => {
        element.style.overflow = previous[index];
      });
      made.forEach((element) => element.removeAttribute('inert'));
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
      {props.notice}
      {/* The way to erase it, before the lecture's words and the history (in view at 1532×734 and 1024×700). */}
      <div className="ex-why-go">
        <Link className="sf-primary" to={links.answer(line.questionId)}>
          Ответить на этот вопрос
        </Link>
      </div>
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
      <section className="ex-why cs-lp" aria-labelledby={props.headingId} ref={rootRef}>
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
