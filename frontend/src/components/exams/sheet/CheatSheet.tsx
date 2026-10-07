import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import type { LineChange, LineState, LineStatus, SheetBlock, SheetLine } from '../../../lib/exams/cheatSheet';
import { MarginStroke, Mark, PencilUnder, seedFrom } from '../../marks';
import { usePrefersReducedMotion } from '../../landing/usePrefersReducedMotion';
import { glue, NBSP } from '../sheetModel';
import { blockNote, lineNote, lineSpeech } from './copy';
import { blockRows, estimateRows, PAPER_PAD, PAPER_PAD_NARROW, paperGeometry, rowMetrics, splitColumns, splitMany, zoomPlan } from './layout';
import { SheetText } from './SheetText';
import { isSheetFontSettled, loadSheetFont } from './sheetFont';
import './sheet.css';

/**
 * «Шпаргалка, которая исчезает» (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05): squared
 * paper with the department's questions printed and the answer points written by hand under them.
 * Every answer is a pass of the eraser: a named point is rubbed half-way (unreadable), a point named
 * again on another day is erased, a missed one comes back in ink with a pencil wave. The page builds
 * the model (lib/exams/cheatSheet.ts) and passes it in; this component draws it, plays the changes
 * of an answer and the writing of new questions, and reports clicks.
 */

export interface SheetViewMode {
  /** «Только то, что осталось»: erased lines hidden, learned questions folded to their printed line. */
  onlyLeft: boolean;
  /** «Спрятать строки»: readable lines covered by a dotted slot (a self-test); a tap opens one. */
  cover: boolean;
  /** «Вся шпаргалка»: the whole paper scaled into the window. */
  zoom: boolean;
}

export interface SheetReplay {
  /** A new token starts a new replay. */
  token: number;
  /** The lines that change, in the sheet's order, from the sheet before the answer to the sheet after it. */
  changes: LineChange[];
  /**
   * The questions answered (a ticket has two): each is brought into view, marked and played in turn,
   * these first; other questions whose lines changed (the same question elsewhere) after them.
   */
  focusQuestionIds: readonly string[];
  /** «Показ на проекторе»: everything twice as slow. */
  slow: boolean;
  /** «Показ на проекторе»: nothing moves before «Показать». */
  waitForClick: boolean;
}

export interface CheatSheetProps {
  examId: string;
  /** «Добавить лекцию» under a question that is in no lecture (the exam's lectures by default; null: none). */
  addMaterialHref?: string | null;
  blocks: SheetBlock[];
  /** exams.ticket_layout.section_titles: printed above the first question of each section. */
  sectionTitles: readonly string[];
  /** Lectures of the exam («Ни в одной из 9 лекций…»). */
  lectureCount: number;
  /** What went wrong when a question was being written, by question id; it replaces the block's own note. */
  writeNotes: ReadonlyMap<string, string>;
  mode: SheetViewMode;
  /** Questions that just arrived from the writer: their lines are written in, once. */
  freshIds: ReadonlySet<string>;
  /** One pen: when each fresh question's lines start being written, ms after it arrived. */
  writeDelays?: ReadonlyMap<string, number>;
  /** The question that starts the second column stays where it is (while writing, while the history plays). */
  holdColumns?: boolean;
  selectedKey: string | null;
  /** Lines uncovered now: key → until when (ms). */
  peeked: ReadonlyMap<string, number>;
  /** Lines opened in the self-test. */
  opened: ReadonlySet<string>;
  /** The questions of the last answer: their printed text wears the yellow marker. */
  markedQuestionIds: ReadonlySet<string>;
  replay: SheetReplay | null;
  /** «История шпаргалки»: the day shown, written in the paper's corner like a date in a notebook. */
  stamp?: string | null;
  /** The sheet is being written: no «Ещё не написано» under every question at once while it goes on. */
  writing?: boolean;
  /** The question whose «почему» is open (its printed line says it is expanded), and the panel's id. */
  openQuestionId?: string | null;
  questionPanelId?: string;
  /**
   * «Показ на проекторе»: the page shows «Показать, что изменилось» where the eye is (the column, or over
   * a phone's bottom bar) and calls `show`; null when nothing waits. Without it the paper shows its own.
   */
  onWaiting?: (show: (() => void) | null) => void;
  /** The first stop of the paper for a keyboard: past every line, to the counter and the switches. */
  skip?: { label: string; target: () => HTMLElement | null } | null;
  onLine: (line: SheetLine, block: SheetBlock) => void;
  onQuestion: (block: SheetBlock) => void;
  /** «Вся шпаргалка»: a click on a question leaves the overview there. */
  onZoomPick: (questionId: string) => void;
  onReplayEnd: (token: number) => void;
}

type Anim = 'write' | 'rub' | 'erase' | 'return' | 'miss';

interface Motion {
  anim: Anim;
  delay: number;
  ms: number;
  /** The state the line moves from (a returning line keeps its trace under the new ink). */
  from?: LineState;
}

const READABLE: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'missed', 'returned']);
/** States whose place on the paper is rubbed (the dull patch under the words). */
const PATCHED: ReadonlySet<LineState> = new Set<LineState>(['rubbed', 'erased', 'due', 'returned']);
const NO_MOTIONS: ReadonlyMap<string, Motion> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_STATUSES: ReadonlyMap<string, LineStatus> = new Map();

/**
 * The movement that takes a line from one state to another (null: it just changes). A due line reads
 * as a rubbed one (with its ring): a line becomes due by a rub, a due line passes its check by an erase.
 */
export function animFor(from: LineState, to: LineState): Exclude<Anim, 'write'> | null {
  if (from === to) return null;
  if (to === 'rubbed' || to === 'due') return READABLE.has(from) ? 'rub' : null;
  if (to === 'erased') return from === 'rubbed' || from === 'due' || READABLE.has(from) ? 'erase' : null;
  if (to === 'returned') return 'return';
  if (to === 'missed') return from === 'fresh' ? 'miss' : 'return';
  return null;
}

/** The changes of an answer by question, in turn: the questions answered first, then the others, each in the sheet's order. */
export function changeGroups(changes: readonly LineChange[], first: readonly string[]): Array<{ questionId: string; changes: LineChange[] }> {
  const groups = new Map<string, LineChange[]>();
  for (const change of changes) {
    const group = groups.get(change.questionId);
    if (group) group.push(change);
    else groups.set(change.questionId, [change]);
  }
  const order = [...first.filter((id) => groups.has(id)), ...[...groups.keys()].filter((id) => !first.includes(id))];
  return order.map((questionId) => ({ questionId, changes: groups.get(questionId) as LineChange[] }));
}

/** How long a line takes to be written: 26 ms a character, between 280 ms and 1 s (spec 6). */
export function writeMs(text: string): number {
  return Math.min(1000, Math.max(280, text.length * 26));
}

/** Each line of a question is written from 90 % of the one before (spec 6), from `start` ms. */
function writeSteps(lines: readonly { key: string; text: string }[], start = 0): Map<string, Motion> {
  const map = new Map<string, Motion>();
  let at = start;
  for (const line of lines) {
    const ms = writeMs(line.text);
    map.set(line.key, { anim: 'write', delay: at, ms });
    at += Math.round(ms * 0.9);
  }
  return map;
}

/** How long a question's lines take to be written in, ms. */
export function writeDuration(lines: readonly { key: string; text: string }[]): number {
  let end = 0;
  for (const step of writeSteps(lines).values()) end = Math.max(end, step.delay + step.ms);
  return end;
}

/** Durations and the start of the next line after this one, ms (spec 4.2). */
const DURATION: Record<Exclude<Anim, 'write'>, number> = { rub: 600, erase: 560, return: 1200, miss: 500 };
const NEXT_AFTER: Record<Exclude<Anim, 'write'>, number> = { rub: 120, erase: 300, return: 1200, miss: 400 };
/** Lines that move in one replay; past them everything changes at once. */
const MAX_ANIMATED = 12;
const SCROLL_FALLBACK_MS = 700;
const MARKER_MS = 450;
const TICK_AFTER_MS = 150;
/** Between the questions of one show, and per line under reduced motion (a 150 ms change, no masks). */
const NEXT_QUESTION_MS = 300;
const REDUCED_LINE_MS = 300;
/** «Весь лист»: room left under the paper, and between the top line and the paper, px. */
const ZOOM_BOTTOM = 20;
const ZOOM_TOP = 12;

interface Signal {
  cancelled: boolean;
}

function sleep(ms: number, signal: Signal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.cancelled || ms <= 0) {
      resolve();
      return;
    }
    window.setTimeout(resolve, ms);
  });
}

/**
 * Scrolls the block to the middle of the window unless it is in view already, and waits for the scroll
 * to end. Farther than a screen and a half it jumps: a smooth scroll over metres of paper is a blur.
 */
async function bringIntoView(element: HTMLElement, smooth: boolean, signal: Signal): Promise<void> {
  const box = element.getBoundingClientRect();
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  if (box.top >= 80 && box.bottom <= viewport - 40) return;
  const far = Math.abs(box.top + box.height / 2 - viewport / 2) > viewport * 1.5;
  if (far) smooth = false;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('scrollend', finish);
      resolve();
    };
    window.addEventListener('scrollend', finish, { once: true });
    window.setTimeout(finish, SCROLL_FALLBACK_MS);
    if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    if (signal.cancelled) finish();
  });
}

/** The bottom of the page's top line (it stays over the page), px from the window's top. */
function topLineBottom(): number {
  const bar = typeof document !== 'undefined' ? document.querySelector('.sf-bar') : null;
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
}

// ── The rows of a line's words ─────────────────────────────────────────────────────────────

interface Row {
  /** In the line body's own px (a scaled paper is undone). */
  x: number;
  w: number;
  /** The grid row's top. */
  top: number;
}

function sameRows(a: readonly Row[], b: readonly Row[]): boolean {
  return a.length === b.length && a.every((row, index) => Math.abs(row.x - b[index].x) < 0.5 && Math.abs(row.w - b[index].w) < 0.5 && Math.abs(row.top - b[index].top) < 0.5);
}

/**
 * Where a line's words lie, row by row, in its body: the rubbed paper and the self-test's dotted
 * slot go under each row of words, not over a whole wrapped block. Measured only while needed.
 */
function useRows(text: RefObject<HTMLElement>, active: boolean, content: string): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  useLayoutEffect(() => {
    const element = text.current;
    const host = element?.closest<HTMLElement>('.cs-body') ?? null;
    if (!active || !element || !host) {
      setRows((previous) => (previous.length === 0 ? previous : []));
      return undefined;
    }
    let frame = 0;
    const measure = () => {
      const box = host.getBoundingClientRect();
      const scale = host.offsetWidth > 0 && box.width > 0 ? box.width / host.offsetWidth : 1;
      const row = parseFloat(getComputedStyle(host).getPropertyValue('--cs-row')) || 24;
      // One strip per grid row: an arrow drawn in ink is a box of its own, and the words around it are
      // more rects on the same row — strips per rect overlapped, and their seams showed lighter.
      const byRow = new Map<number, { left: number; right: number }>();
      for (const rect of Array.from(element.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const middle = (rect.top + rect.height / 2 - box.top) / scale;
        const top = Math.max(0, Math.floor(middle / row) * row);
        const left = (rect.left - box.left) / scale;
        const right = left + rect.width / scale;
        const seen = byRow.get(top);
        byRow.set(top, seen ? { left: Math.min(seen.left, left), right: Math.max(seen.right, right) } : { left, right });
      }
      const next = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([top, span]) => ({ x: span.left, w: span.right - span.left, top }));
      setRows((previous) => (sameRows(previous, next) ? previous : next));
    };
    const schedule = () => {
      if (typeof requestAnimationFrame !== 'function') {
        measure();
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      // A new observer reports the size it starts with: that one is measured above already (a second
      // measure of every patched line would lay a long sheet out once more).
      let initial = true;
      observer = new ResizeObserver(() => {
        if (initial) {
          initial = false;
          return;
        }
        schedule();
      });
      observer.observe(host);
    }
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [text, active, content]);
  return rows;
}

// ── One line ───────────────────────────────────────────────────────────────────────────────

/** A line uncovered by «Подсмотреть» is rubbed again by the eraser when it covers (ms). */
const RECOVER_MS = 380;
/** «Стирает только ответ» after the last word: its width, px (Onest 14). */
const RUB_NOTE_PX = 160;

interface LineViewProps {
  line: SheetLine;
  block: SheetBlock;
  /** The line as drawn now: its own status, or the one before the answer while a replay waits. */
  status: LineStatus;
  motion: Motion | null;
  selected: boolean;
  peeked: boolean;
  covered: boolean;
  /** A pencil note that appears or goes during the show: its row is kept, empty, so nothing below moves. */
  reserve: string | null;
  /** «Вся шпаргалка»: not a stop of the keyboard (a question is picked by its printed line). */
  inert: boolean;
  reduced: boolean;
  onLine: (line: SheetLine, block: SheetBlock) => void;
}

const LineView = memo(function LineView({ line, block, status, motion, selected, peeked, covered, reserve, inert, reduced, onLine }: LineViewProps) {
  const [rubNote, setRubNote] = useState<{ top: number; left: number | null } | null>(null);
  const pointer = useRef<{ x: number; moved: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  // «Стирает только ответ» (spec 7.1): after the last word of the line when it fits there, on the
  // paper's own grid; else at the end of that row, over the words, on a strip of paper.
  const placeRubNote = () => {
    const text = textRef.current;
    const item = itemRef.current;
    const rects = text ? Array.from(text.getClientRects()).filter((rect) => rect.width > 0) : [];
    const last = rects[rects.length - 1];
    if (!item || !last) return { top: 0, left: null };
    const box = item.getBoundingClientRect();
    const scale = item.offsetWidth > 0 && box.width > 0 ? box.width / item.offsetWidth : 1;
    const row = parseFloat(getComputedStyle(item).getPropertyValue('--cs-row')) || 24;
    const top = Math.max(0, Math.floor(((last.top + last.height / 2 - box.top) / scale) / row) * row);
    const left = (last.right - box.left) / scale + 12;
    return { top, left: left + RUB_NOTE_PX <= item.offsetWidth ? left : null };
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    pointer.current = { x: event.clientX, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const start = pointer.current;
    if (!start || start.moved || (event.pointerType === 'mouse' && event.buttons === 0)) return;
    if (Math.abs(event.clientX - start.x) > 24) {
      start.moved = true;
      setRubNote(placeRubNote());
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setRubNote(null), 2000);
    }
  };
  const onClick = () => {
    const rubbed = pointer.current?.moved;
    pointer.current = null;
    if (!rubbed) onLine(line, block);
  };

  // Covered again after «Подсмотреть»: the eraser passes once more, not a snap back.
  const [recover, setRecover] = useState(false);
  const wasPeeked = useRef(peeked);
  const recoverTimer = useRef<number | null>(null);
  useEffect(() => {
    const was = wasPeeked.current;
    wasPeeked.current = peeked;
    if (!was || peeked || reduced || (status.state !== 'rubbed' && status.state !== 'due')) return;
    setRecover(true);
    if (recoverTimer.current) window.clearTimeout(recoverTimer.current);
    recoverTimer.current = window.setTimeout(() => setRecover(false), RECOVER_MS + 40);
  }, [peeked, reduced, status.state]);
  useEffect(
    () => () => {
      if (recoverTimer.current) window.clearTimeout(recoverTimer.current);
    },
    [],
  );

  const state = status.state;
  const patched = PATCHED.has(state);
  const rows = useRows(textRef, patched || covered, line.text);
  // The note keeps its row under a hidden line too (hidden with it): the self-test does not move the sheet.
  const note = lineNote(status, peeked);

  // A note that appears under the eye (after «Подсмотреть») opens its row instead of pushing the sheet down at once.
  const [noteEnters, setNoteEnters] = useState(false);
  const hadNote = useRef(Boolean(note));
  useLayoutEffect(() => {
    const had = hadNote.current;
    hadNote.current = Boolean(note);
    if (had || !note || !peeked || reduced) return undefined;
    setNoteEnters(true);
    const end = window.setTimeout(() => setNoteEnters(false), 260);
    return () => window.clearTimeout(end);
  }, [note, peeked, reduced]);

  const shown = motion ?? (recover ? { anim: 'rub' as const, delay: 0, ms: RECOVER_MS } : null);
  const wave = state === 'missed' || state === 'returned';
  const kind = line.essential ? 'Главный пункт' : 'Пункт';
  const speech = covered ? { name: `${kind} спрятан. Открыть`, description: null } : lineSpeech(line, status, peeked);
  const describedId = speech.description ? `cs-ld-${block.questionId}-${line.key}` : undefined;
  const fromErased = shown?.from === 'erased' || shown?.from === 'due';
  const style = shown ? ({ '--cs-delay': `${shown.delay}ms`, '--cs-ms': `${shown.ms}ms` } as CSSProperties) : undefined;
  const words = (
    <span className="cs-ink-t" ref={textRef}>
      <SheetText text={line.text} seedBase={line.key} />
    </span>
  );
  const drawWave = shown?.anim === 'miss' || shown?.anim === 'return';
  const shownNote = note ?? reserve;
  return (
    <li
      ref={itemRef}
      className="cs-line"
      data-key={line.key}
      data-state={state}
      data-anim={shown?.anim}
      data-trace={shown?.anim === 'return' ? (fromErased ? 'erased' : 'rubbed') : undefined}
      data-essential={line.essential ? '' : undefined}
      data-peek={peeked ? '' : undefined}
      data-cover={covered ? '' : undefined}
      data-selected={selected ? '' : undefined}
      style={style}
    >
      <button
        type="button"
        className="cs-lbtn"
        aria-label={speech.name}
        aria-describedby={describedId}
        aria-current={selected || undefined}
        tabIndex={inert ? -1 : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onClick={onClick}
      >
        <span className="cs-bullet" aria-hidden="true">
          {line.essential ? '•' : '–'}
        </span>
        <span className="cs-body">
          {patched &&
            (rows.length > 0 ? (
              rows.map((row, index) => <span key={index} className="cs-patch" aria-hidden="true" style={{ left: row.x - 8, top: row.top + 1, width: row.w + 16 }} />)
            ) : (
              <span className="cs-patch" data-whole="" aria-hidden="true" />
            ))}
          <span className="cs-ink" aria-hidden="true">
            {wave ? (
              <PencilUnder
                seed={seedFrom(line.key, 'wave')}
                hand="graphite"
                kind="wave"
                weight={1.8}
                animate={drawWave}
                delayMs={shown ? shown.delay + Math.round(shown.ms * (shown.anim === 'return' ? 0.62 : 0.2)) : 0}
                dy={-1}
                watch={line.text}
              >
                {words}
              </PencilUnder>
            ) : (
              words
            )}
          </span>
          {covered &&
            (rows.length > 0 ? (
              rows.map((row, index) => <span key={index} className="cs-slot" aria-hidden="true" style={{ left: row.x, top: row.top, width: row.w }} />)
            ) : (
              <span className="cs-slot" data-whole="" aria-hidden="true" />
            ))}
        </span>
        {describedId && (
          <span className="sr-only" id={describedId}>
            {speech.description}
          </span>
        )}
      </button>
      {state === 'due' && !covered && (
        <span className="cs-due" aria-hidden="true">
          <Mark kind="ring" seed={seedFrom(line.key, 'due')} width={22} height={20} weight={1.5} hand="graphite" />
        </span>
      )}
      {selected && <MarginStroke seed={seedFrom(line.key, 'selected')} />}
      {/* The line's name or description says the note already: here it is for the eye only. */}
      {shownNote && (
        <p className="cs-note" data-kind={peeked ? 'peek' : state} data-reserve={note ? undefined : ''} data-enter={noteEnters ? '' : undefined} aria-hidden="true">
          {shownNote}
        </p>
      )}
      {rubNote && (
        <span className="cs-rubnote" role="status" data-after={rubNote.left !== null ? '' : undefined} style={rubNote.left !== null ? { left: rubNote.left, top: rubNote.top } : { top: rubNote.top }}>
          Стирает только ответ
        </span>
      )}
    </li>
  );
});

// ── One question ───────────────────────────────────────────────────────────────────────────

interface BlockViewProps {
  block: SheetBlock;
  heading: string | null;
  note: string | null;
  addMaterial: string | null;
  /** Lines drawn as they were before the answer, while a replay waits to play. */
  statuses: ReadonlyMap<string, LineStatus>;
  motions: ReadonlyMap<string, Motion>;
  /** Notes whose rows are kept while the show plays. */
  reserves: ReadonlyMap<string, string>;
  /** Erased lines that stay in view under «Только то, что осталось» (the last answer erased them). */
  kept: ReadonlySet<string>;
  tickDelay: number | null;
  /** A returning line breaks the question's tick: the tick stays until that line is written again, then fades (ms). */
  tickOut: number | null;
  marker: 'none' | 'still' | 'draw';
  mode: SheetViewMode;
  fresh: boolean;
  /** One pen: the lines of a question that arrived with others start after theirs, ms. */
  writeDelay: number;
  selectedKey: string | null;
  peeked: ReadonlyMap<string, number>;
  opened: ReadonlySet<string>;
  now: number;
  reduced: boolean;
  /** «почему» of this question is open (its printed line says it is expanded). */
  open: boolean;
  panelId: string | undefined;
  onLine: (line: SheetLine, block: SheetBlock) => void;
  onQuestion: (block: SheetBlock) => void;
}

const BlockView = memo(function BlockView({
  block,
  heading,
  note,
  addMaterial,
  statuses,
  motions,
  reserves,
  kept,
  tickDelay,
  tickOut,
  marker,
  mode,
  fresh,
  writeDelay,
  selectedKey,
  peeked,
  opened,
  now,
  reduced,
  open,
  panelId,
  onLine,
  onQuestion,
}: BlockViewProps) {
  const statusOf = (line: SheetLine) => statuses.get(line.key) ?? line.status;
  const stateOf = (line: SheetLine) => statusOf(line).state;
  const essentials = block.lines.filter((line) => line.essential);
  const deciding = essentials.length > 0 ? essentials : block.lines;
  // The tick: every deciding line erased (a due line waits for its check: no tick beside «пора проверить»).
  const learned = deciding.length > 0 && deciding.every((line) => stateOf(line) === 'erased');
  // «Только то, что осталось»: a question folds to its printed line only when nothing of it is left
  // (every line erased); a secondary line still there stays in view under the tick.
  const hidden = (line: SheetLine) => mode.onlyLeft && stateOf(line) === 'erased' && !motions.has(line.key) && !kept.has(line.key);
  const folded = block.lines.length > 0 && block.lines.every(hidden);
  // Written in one after another.
  const writes = useMemo(() => (fresh ? writeSteps(block.lines, writeDelay) : NO_MOTIONS), [fresh, block.lines, writeDelay]);
  const numberId = `cs-qn-${block.questionId}`;
  const showTick = learned || tickOut !== null;
  return (
    <>
      {/* The section's title is a heading of its own, before its first question (not inside it). */}
      {heading && <h2 className="cs-sec">{heading}</h2>}
      <article
        className="cs-q"
        id={`cs-q-${block.questionId}`}
        data-qid={block.questionId}
        data-kind={block.kind}
        data-learned={learned ? '' : undefined}
        data-folded={folded ? '' : undefined}
        aria-labelledby={numberId}
      >
        <h3 className="cs-qh">
          <button type="button" className="cs-qbtn" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => onQuestion(block)}>
            <span className="sr-only" id={numberId}>{`Вопрос ${block.number}. `}</span>
            <span className="cs-qn" aria-hidden="true">
              {block.number}.
            </span>
            <span className="cs-qt">
              <span className="cs-qm" data-marker={marker === 'none' ? undefined : marker}>
                {glue(block.text)}
              </span>
            </span>
          </button>
          {showTick && (
            <span className="cs-tick" data-out={learned ? undefined : ''} style={learned ? undefined : ({ '--cs-out': `${tickOut ?? 0}ms` } as CSSProperties)}>
              <Mark kind="tick" seed={seedFrom(block.questionId, 'tick')} width={20} height={16} hand="graphite" animate={learned && tickDelay !== null} delayMs={tickDelay ?? 0} />
              {learned && <span className="sr-only">Главные строки стёрты</span>}
            </span>
          )}
        </h3>
        {!folded && block.lines.length > 0 && (
          <ul className="cs-lines">
            {block.lines.map((line) => {
              if (hidden(line)) return null;
              const status = statusOf(line);
              const peekedNow = (peeked.get(line.key) ?? 0) > now;
              return (
                <LineView
                  key={line.key}
                  line={line}
                  block={block}
                  status={status}
                  motion={peekedNow ? null : (motions.get(line.key) ?? writes.get(line.key) ?? null)}
                  selected={selectedKey === line.key}
                  peeked={peekedNow}
                  covered={mode.cover && READABLE.has(status.state) && !opened.has(line.key) && !peekedNow}
                  reserve={reserves.get(line.key) ?? null}
                  inert={mode.zoom}
                  reduced={reduced}
                  onLine={onLine}
                />
              );
            })}
          </ul>
        )}
        {note && !folded && (
          <p className="cs-pnote">
            {glue(note)}
            {addMaterial && (
              <>
                {`${NBSP}· `}
                <Link className="cs-pnote-link" to={addMaterial} tabIndex={mode.zoom ? -1 : undefined}>
                  Добавить лекцию
                </Link>
              </>
            )}
          </p>
        )}
      </article>
    </>
  );
});

// ── The sheet ──────────────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'before' | 'marker' | 'lines';

interface Zoom {
  /** Columns of the overview (more than the page's two when that shows the paper larger). */
  columns: number;
  scale: number;
  /** The paper's own width in the overview, px (before it is scaled). */
  width: number;
  /** The scaled paper's height and its offset to the middle of the column, px. */
  height: number;
  offset: number;
}

const NO_ZOOM: Zoom = { columns: 0, scale: 1, width: 0, height: 0, offset: 0 };
const NO_NOTES: ReadonlyMap<string, string> = new Map();
const NO_MARKERS: ReadonlyMap<string, 'draw' | 'still'> = new Map();
const NO_TIMES: ReadonlyMap<string, number> = new Map();

/** The printed line of a question, the place the keyboard stands while its answer is shown. */
function questionButton(questionId: string): HTMLElement | null {
  return document.getElementById(`cs-q-${questionId}`)?.querySelector<HTMLElement>('.cs-qbtn') ?? null;
}

export default function CheatSheet({
  examId,
  addMaterialHref,
  blocks,
  sectionTitles,
  lectureCount,
  writeNotes,
  mode,
  freshIds,
  writeDelays,
  holdColumns = false,
  selectedKey,
  peeked,
  opened,
  markedQuestionIds,
  replay,
  stamp = null,
  writing = false,
  openQuestionId = null,
  questionPanelId,
  onWaiting,
  skip = null,
  onLine,
  onQuestion,
  onZoomPick,
  onReplayEnd,
}: CheatSheetProps) {
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef<HTMLElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The page waits for the font before it shows the paper (useSheetView): then it is ready at once.
  const [fontReady, setFontReady] = useState(isSheetFontSettled);
  const [phase, setPhase] = useState<Phase>('idle');
  const [overrides, setOverrides] = useState<ReadonlyMap<string, LineStatus>>(NO_STATUSES);
  const [motions, setMotions] = useState<ReadonlyMap<string, Motion>>(NO_MOTIONS);
  const [reserves, setReserves] = useState<ReadonlyMap<string, string>>(NO_NOTES);
  // Lines the last answer erased stay under «Только то, что осталось» until the switch is turned:
  // they vanish on the next visit, never under the eye (and the columns do not jump after the show).
  const [kept, setKept] = useState<ReadonlySet<string>>(NO_KEYS);
  const [ticks, setTicks] = useState<ReadonlyMap<string, number>>(NO_TIMES);
  const [unticks, setUnticks] = useState<ReadonlyMap<string, number>>(NO_TIMES);
  const [markers, setMarkers] = useState<ReadonlyMap<string, 'draw' | 'still'>>(NO_MARKERS);
  const [awaitingClick, setAwaitingClick] = useState(false);
  const clickResolver = useRef<(() => void) | null>(null);
  const firstShown = useRef<string | null>(null);
  const waitingHandler = useRef(onWaiting);
  waitingHandler.current = onWaiting;
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void loadSheetFont().then(() => {
      if (alive) setFontReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // An uncovered line closes by itself: re-render when the nearest one is over.
  useEffect(() => {
    const current = Date.now();
    setNow(current);
    const ends = [...peeked.values()].filter((until) => until > current);
    if (ends.length === 0) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(...ends) - current + 20);
    return () => window.clearTimeout(timer);
  }, [peeked]);

  // The paper's width (the wrap's, while «Вся шпаргалка» gives the paper a width of its own).
  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const measure = () => setWidth((previous) => (previous === element.clientWidth ? previous : element.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => paperGeometry(width), [width]);

  // The question that starts the second column, held while the sheet is being written.
  const secondStart = useRef<string | null>(null);

  // Section titles and notes, and each block's height in grid rows. While a run writes the sheet,
  // «Ещё не написано» does not appear under every question at once: it waits for the run's end.
  const anyWritten = !writing && blocks.some((block) => block.kind === 'lines');
  const measured = useMemo(() => {
    let previous: number | null = null;
    const items = blocks.map((block) => {
      const section = block.section;
      const heading = section !== null && section !== previous ? sectionTitles[section - 1]?.trim() || `Раздел ${section}` : null;
      if (section !== null) previous = section;
      const note = writeNotes.get(block.questionId) ?? blockNote(block, lectureCount, { anyWritten });
      return { block, heading, note };
    });
    const metrics = rowMetrics(geometry.column);
    const estimate = estimateRows(blocks, metrics);
    const rows = items.map((item) =>
      blockRows(item.block, metrics, { hideErased: mode.onlyLeft, keep: kept, note: item.note, heading: Boolean(item.heading), estimate }),
    );
    return { items, rows };
  }, [blocks, sectionTitles, writeNotes, lectureCount, anyWritten, geometry.column, mode.onlyLeft, kept]);

  // The split into columns by the blocks' heights. A question still to be written counts as tall as the
  // written ones, so the split hardly moves when it gets its lines; while the writing goes on (and while
  // the history plays) it does not move at all. «Вся шпаргалка» may lay the paper out in more columns.
  const zoomColumns = mode.zoom ? zoom.columns : 0;
  const laid = useMemo(() => {
    const { items, rows } = measured;
    if (zoomColumns > geometry.columns) return splitMany(items, rows, zoomColumns);
    const held = holdColumns && secondStart.current ? items.findIndex((item) => item.block.questionId === secondStart.current) : -1;
    return splitColumns(items, rows, geometry.columns, held > 0 ? held : null);
  }, [measured, geometry.columns, holdColumns, zoomColumns]);
  useEffect(() => {
    if (zoomColumns > geometry.columns) return;
    secondStart.current = laid[1]?.[0]?.block.questionId ?? null;
  }, [laid, zoomColumns, geometry.columns]);

  // «Вся шпаргалка» (spec 7.4): the paper's top under the top line, then the whole paper in the rest of the
  // window — in more columns while that shows it larger, scaled to fit, in the middle of the column.
  const zoomOn = mode.zoom;
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!zoomOn || !wrap) {
      setZoom((previous) => (previous === NO_ZOOM ? previous : NO_ZOOM));
      return undefined;
    }
    const scrollUp = () => {
      const target = wrap.getBoundingClientRect().top - topLineBottom() - ZOOM_TOP;
      if (Math.abs(target) > 2) window.scrollTo({ top: Math.max(0, window.scrollY + target), behavior: 'auto' });
    };
    const measure = () => {
      const available = Math.max(240, (window.innerHeight || 800) - topLineBottom() - ZOOM_TOP - ZOOM_BOTTOM);
      const plan = zoomPlan({ wrapWidth: wrap.clientWidth, available, rows: measured.rows, geometry });
      const paper = paperRef.current;
      const natural = paper && plan.columns === zoomColumns ? paper.offsetHeight : 0;
      const scale = natural > 0 ? Math.min(plan.scale, wrap.clientWidth / plan.width, available / natural) : plan.scale;
      const next: Zoom = {
        columns: plan.columns,
        scale,
        width: plan.width,
        height: natural > 0 ? Math.ceil(natural * scale) : 0,
        offset: Math.max(0, Math.round((wrap.clientWidth - plan.width * scale) / 2)),
      };
      setZoom((previous) =>
        previous.columns === next.columns && Math.abs(previous.scale - next.scale) < 0.001 && previous.height === next.height && previous.offset === next.offset && previous.width === next.width
          ? previous
          : next,
      );
    };
    scrollUp();
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [zoomOn, measured.rows, geometry, zoomColumns, laid]);

  // Turning the switch shows (or hides) every erased line alike. A layout effect declared before the
  // replay's: when both change in one commit, the replay sets its own lines after this.
  const lastOnlyLeft = useRef(mode.onlyLeft);
  useLayoutEffect(() => {
    if (lastOnlyLeft.current === mode.onlyLeft) return;
    lastOnlyLeft.current = mode.onlyLeft;
    setKept(NO_KEYS);
  }, [mode.onlyLeft]);

  // ── The replay of an answer (spec 4.2): for each question answered in turn — into view → marker → its
  // lines one by one; then the column. A layout effect: the lines are drawn as they were before the
  // answer from the first frame, so the new state never flashes before the show.
  useLayoutEffect(() => {
    if (!replay) return undefined;
    setKept(replay.changes.length > 0 ? new Set(replay.changes.map((change) => change.key)) : NO_KEYS);
    const signal: Signal = { cancelled: false };
    const factor = replay.slow ? 2 : 1;
    const groups = changeGroups(replay.changes, replay.focusQuestionIds);
    firstShown.current = groups[0]?.questionId ?? null;
    const current = new Map<string, LineStatus>();
    for (const block of blocks) for (const line of block.lines) current.set(line.key, line.status);
    const before = new Map<string, LineStatus>();
    const reserve = new Map<string, string>();
    for (const change of replay.changes) {
      const now = current.get(change.key);
      const was = change.before ?? (now ? { ...now, state: change.from } : ({ state: change.from } as LineStatus));
      before.set(change.key, was);
      // A note that appears (a missed point) or goes (a missed point named) keeps its row all show long.
      const noteBefore = lineNote(was);
      const noteAfter = now ? lineNote(now) : null;
      if (Boolean(noteBefore) !== Boolean(noteAfter)) reserve.set(change.key, (noteBefore ?? noteAfter) as string);
    }
    setOverrides(before);
    setReserves(reserve.size > 0 ? reserve : NO_NOTES);
    setMotions(NO_MOTIONS);
    setTicks(NO_TIMES);
    setUnticks(NO_TIMES);
    setMarkers(NO_MARKERS);
    setPhase('before');

    const waiting = (on: boolean) => {
      const handler = waitingHandler.current;
      if (handler) handler(on ? showNowRef.current : null);
      else setAwaitingClick(on);
    };
    const finish = () => {
      if (signal.cancelled) return;
      signal.cancelled = true;
      if (clickResolver.current) waiting(false);
      clickResolver.current = null;
      setOverrides(NO_STATUSES);
      setMotions(NO_MOTIONS);
      setReserves(NO_NOTES);
      setTicks(NO_TIMES);
      setUnticks(NO_TIMES);
      setMarkers(NO_MARKERS);
      setPhase('idle');
      onReplayEnd(replay.token);
    };

    const run = async () => {
      await loadSheetFont();
      if (signal.cancelled) return;
      // Nothing changed: no «Показать» and no show, only the column's sentence.
      if (groups.length === 0) {
        finish();
        return;
      }
      const remaining = new Map(before);
      const marked = new Map<string, 'draw' | 'still'>();
      let budget = MAX_ANIMATED;
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        // Past the twelfth line the rest changes at once, where it is.
        if (budget <= 0) {
          for (const change of group.changes) remaining.delete(change.key);
          setOverrides(new Map(remaining));
          continue;
        }
        const element = document.getElementById(`cs-q-${group.questionId}`);
        if (element) await bringIntoView(element, !reduced, signal);
        if (signal.cancelled) return;
        if (index === 0 && replay.waitForClick) {
          await new Promise<void>((resolve) => {
            clickResolver.current = resolve;
            waiting(true);
          });
          clickResolver.current = null;
          waiting(false);
          if (signal.cancelled) return;
        }
        await sleep((index === 0 ? 250 : NEXT_QUESTION_MS) * factor, signal);
        if (signal.cancelled) return;
        const block = blocks.find((item) => item.questionId === group.questionId) ?? null;
        if (reduced) {
          // No sweeps: the marker stands still, the lines change one by one in 150 ms.
          marked.set(group.questionId, 'still');
          setMarkers(new Map(marked));
          setPhase('lines');
          for (const change of group.changes) {
            remaining.delete(change.key);
            budget -= 1;
            setOverrides(new Map(remaining));
            await sleep(REDUCED_LINE_MS * factor, signal);
            if (signal.cancelled) return;
          }
          continue;
        }
        marked.set(group.questionId, 'draw');
        setMarkers(new Map(marked));
        setPhase('marker');
        await sleep(MARKER_MS * factor, signal);
        if (signal.cancelled) return;
        const next = new Map<string, Motion>();
        const ends = new Map<string, number>();
        let at = 0;
        for (const change of group.changes) {
          remaining.delete(change.key);
          const anim = animFor(change.from, change.to);
          if (!anim || budget <= 0) continue;
          budget -= 1;
          const ms = DURATION[anim] * factor;
          next.set(change.key, { anim, delay: at, ms, from: change.from });
          ends.set(change.key, at + ms);
          at += NEXT_AFTER[anim] * factor;
        }
        // The question's tick: drawn 150 ms after its last essential line is erased; or, when a line of
        // it comes back, kept until that line is written again, then faded.
        const tickAt = new Map<string, number>();
        const untickAt = new Map<string, number>();
        if (block) {
          const essentials = block.lines.filter((line) => line.essential);
          const deciding = essentials.length > 0 ? essentials : block.lines;
          const was = deciding.length > 0 && deciding.every((line) => (before.get(line.key)?.state ?? line.status.state) === 'erased');
          const is = deciding.length > 0 && deciding.every((line) => line.status.state === 'erased');
          if (is && !was) tickAt.set(block.questionId, Math.max(0, ...deciding.map((line) => ends.get(line.key) ?? 0)) + TICK_AFTER_MS * factor);
          if (was && !is) untickAt.set(block.questionId, Math.max(0, ...deciding.map((line) => ends.get(line.key) ?? 0)));
        }
        setOverrides(new Map(remaining));
        setMotions(next);
        setTicks(tickAt);
        setUnticks(untickAt);
        setPhase('lines');
        const longest = Math.max(0, ...ends.values(), ...[...tickAt.values()].map((value) => value + 250), ...[...untickAt.values()].map((value) => value + 200));
        await sleep(longest + 120, signal);
        if (signal.cancelled) return;
        marked.set(group.questionId, 'still');
        setMarkers(new Map(marked));
      }
      finish();
    };
    void run();

    // Any input skips to the end (the column still tells what changed). While «Показать» waits, only it goes on.
    const onInput = (event: Event) => {
      if (clickResolver.current) {
        if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') finish();
        return;
      }
      if (event.type === 'keydown') {
        const key = (event as KeyboardEvent).key;
        if (key === 'Tab' || key === 'Shift') return;
      }
      finish();
    };
    window.addEventListener('keydown', onInput);
    window.addEventListener('pointerdown', onInput);
    window.addEventListener('wheel', onInput, { passive: true });
    window.addEventListener('touchmove', onInput, { passive: true });
    return () => {
      // Replaced (another answer, the history) or gone with the paper: nothing of this show stays drawn.
      signal.cancelled = true;
      const resolve = clickResolver.current;
      clickResolver.current = null;
      if (resolve) {
        if (waitingHandler.current) waitingHandler.current(null);
        resolve();
      }
      setAwaitingClick(false);
      setOverrides(NO_STATUSES);
      setMotions(NO_MOTIONS);
      setReserves(NO_NOTES);
      setTicks(NO_TIMES);
      setUnticks(NO_TIMES);
      setMarkers(NO_MARKERS);
      setPhase('idle');
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('wheel', onInput);
      window.removeEventListener('touchmove', onInput);
    };
    // One replay per token; its inputs are read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay?.token]);

  // «Показать»: the keyboard goes to the first question shown (the button goes away under it).
  const showNow = useCallback(() => {
    const resolve = clickResolver.current;
    clickResolver.current = null;
    const first = firstShown.current;
    if (first) questionButton(first)?.focus({ preventScroll: true });
    resolve?.();
  }, []);
  const showNowRef = useRef(showNow);
  showNowRef.current = showNow;

  const onPickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!mode.zoom) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-qid]');
      if (target?.dataset.qid) {
        event.preventDefault();
        event.stopPropagation();
        onZoomPick(target.dataset.qid);
      }
    },
    [mode.zoom, onZoomPick],
  );

  const zoomed = mode.zoom && zoom.columns > 0;
  const columnCount = laid.length;
  // The pink margin line stands on a line of the grid, not 5 px beside one (a misprint to the eye).
  const paperWidth = zoomed ? zoom.width : width;
  const pad = geometry.narrow ? PAPER_PAD_NARROW : PAPER_PAD;
  const gridFrom = geometry.narrow ? pad.left : 0;
  const marginAt = paperWidth - (pad.right - (geometry.narrow ? 14 : 24));
  const marginX = paperWidth > 0 ? gridFrom + Math.round((marginAt - gridFrom) / geometry.row) * geometry.row : null;
  const paperStyle = {
    '--cs-col': `${geometry.column}px`,
    ...(marginX !== null ? { '--cs-margin-x': `${marginX}px` } : null),
    ...(columnCount > 2 ? { gridTemplateColumns: `repeat(${columnCount}, var(--cs-col))` } : null),
    // Scaled down, the grid's lines and the focus ring stay one device pixel and two px wide.
    ...(zoomed ? { width: zoom.width, transform: `translateX(${zoom.offset}px) scale(${zoom.scale})`, transformOrigin: '0 0', '--cs-zoom': String(zoom.scale) } : null),
  } as CSSProperties;
  const markerOf = (questionId: string): 'none' | 'still' | 'draw' => {
    if (phase === 'idle') return markedQuestionIds.has(questionId) ? 'still' : 'none';
    return markers.get(questionId) ?? 'none';
  };
  const titled = measured.items.some((item) => item.heading);

  return (
    <section
      className="cs-wrap"
      data-zoom={mode.zoom ? '' : undefined}
      data-slow={replay?.slow && phase !== 'idle' ? '' : undefined}
      ref={wrapRef}
      style={zoomed && zoom.height > 0 ? { height: zoom.height } : undefined}
    >
      {skip && (
        <button type="button" className="cs-skip" onClick={() => skip.target()?.focus()}>
          {skip.label}
        </button>
      )}
      {/* Without section titles the questions still sit under a heading of the page's next level. */}
      {!titled && <h2 className="sr-only">Шпаргалка</h2>}
      <div
        ref={paperRef}
        className="cs-paper"
        data-columns={columnCount > 1 ? columnCount : 1}
        data-narrow={geometry.narrow ? '' : undefined}
        data-font={fontReady ? 'ready' : 'waiting'}
        style={paperStyle}
        onClickCapture={onPickCapture}
      >
        {stamp && (
          <p className="cs-date" aria-hidden="true">
            {stamp}
          </p>
        )}
        {laid.map((column, index) => (
          // A column is the same column while its first question is: blocks that stay do not remount (and the keyboard stays on them).
          <div className="cs-col" key={column[0]?.block.questionId ?? `empty-${index}`}>
            {column.map(({ block, heading, note }) => (
              <BlockView
                key={block.questionId}
                block={block}
                heading={heading}
                note={note}
                addMaterial={block.kind === 'gap' && block.coverage === 'none' ? (addMaterialHref === undefined ? `/exams/${examId}/edit#lectures` : addMaterialHref) : null}
                statuses={overrides}
                motions={motions}
                reserves={reserves}
                kept={kept}
                tickDelay={ticks.get(block.questionId) ?? null}
                tickOut={unticks.get(block.questionId) ?? null}
                marker={markerOf(block.questionId)}
                mode={mode}
                fresh={freshIds.has(block.questionId) && !reduced}
                writeDelay={writeDelays?.get(block.questionId) ?? 0}
                selectedKey={selectedKey}
                peeked={peeked}
                opened={opened}
                now={now}
                reduced={reduced}
                open={openQuestionId === block.questionId}
                panelId={questionPanelId}
                onLine={onLine}
                onQuestion={onQuestion}
              />
            ))}
          </div>
        ))}
      </div>
      {awaitingClick && (
        <div className="cs-show">
          <button type="button" className="sf-primary" onClick={showNow} autoFocus>
            Показать, что изменилось
          </button>
        </div>
      )}
    </section>
  );
}
