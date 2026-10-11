import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { localDayOf, type LineChange, type LineState, type LineStatus, type SheetBlock, type SheetLine } from '../../../lib/exams/cheatSheet';
import { formatShortDay } from '../../../lib/exams/format';
import { usePrefersReducedMotion } from '../../landing/usePrefersReducedMotion';
import { glue, NBSP } from '../sheetModel';
import { blockNote, gluedArrows, lineNote, lineSpeech } from './copy';
import { blockHeight, estimateHeight, numberGutter, paperGeometry, rowMetrics, splitColumns, splitMany, zoomPlan } from './layout';
import { markSquare, type DrawnMotion, type DrawnStore } from './SheetMap';
import './sheet.css';

/**
 * «Шпаргалка, которая исчезает» (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05; the look since
 * 2026-10-10: 40_Decisions/2026-10-10_cheat-sheet-native-look). The department's questions with the answer
 * points under them, in the app's own card and type: a question is its number and title, a point a line with a
 * marker — a dot for a main point, a dash for a detail. Only answers erase: a point named once keeps its line
 * with a yellow dot in a quieter ink, a point named again on another day is struck through, a missed one keeps
 * its line with a small caption. The page builds the model (lib/exams/cheatSheet.ts) and passes it in; this
 * component draws it, plays the changes of an answer, the history and the writing of new questions, tells the
 * map of lines what it draws, and reports clicks.
 */

export interface SheetViewMode {
  /** «Скрыть строки, стёртые совсем»: erased lines hidden, a question with nothing left folded to its title. */
  onlyLeft: boolean;
  /** «Спрятать строки»: the lines' words covered by a soft bar (a self-test); a tap opens one. */
  cover: boolean;
  /** «Весь лист на экране»: the whole card scaled into the window. */
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
  /** exams.ticket_layout.section_titles: above the first question of each section. */
  sectionTitles: readonly string[];
  /** Lectures of the exam («Ни в одной из 9 лекций…»). */
  lectureCount: number;
  /** What went wrong when a question was being written, by question id; it replaces the block's own note. */
  writeNotes: ReadonlyMap<string, string>;
  /**
   * (Almost) every question is in no lecture: «В лекции нет фрагмента об этом · Добавить лекцию» would stand under
   * each one (owner, 2026-10-07: «глаза разбегаются»). The page's status says it once; such a question here keeps
   * only a short dash after its title.
   */
  quietGaps?: boolean;
  mode: SheetViewMode;
  /** Questions that just arrived from the writer: their lines come in, once. */
  freshIds: ReadonlySet<string>;
  /** One pen: when each fresh question's lines start coming in, ms after it arrived. */
  writeDelays?: ReadonlyMap<string, number>;
  /** The question that starts the second column stays where it is (while writing, while the history plays). */
  holdColumns?: boolean;
  selectedKey: string | null;
  /** Lines uncovered now: key → until when (ms). */
  peeked: ReadonlyMap<string, number>;
  /** Lines opened in the self-test. */
  opened: ReadonlySet<string>;
  /** The questions of the last answer: their title stands on a soft yellow band. */
  markedQuestionIds: ReadonlySet<string>;
  replay: SheetReplay | null;
  /** «История шпаргалки»: the day shown, on a tag at the card's top edge. */
  stamp?: string | null;
  /** The sheet is being written: no «Ещё не написано» under every question at once while it goes on. */
  writing?: boolean;
  /** The question whose «почему» is open (its title says it is expanded), and the panel's id. */
  openQuestionId?: string | null;
  questionPanelId?: string;
  /**
   * «Показ на проекторе»: the page shows «Показать, что изменилось» where the eye is (the column, or over
   * a phone's bottom bar) and calls `show`; null when nothing waits. Without it the card shows its own.
   */
  onWaiting?: (show: (() => void) | null) => void;
  /** The first stop of the card for a keyboard: past every line, to the counter and the switches. */
  skip?: { label: string; target: () => HTMLElement | null } | null;
  /** A phone: the count and the map of lines at the top of the card, so the list starts high. */
  head?: ReactNode;
  /** The map of lines follows what the card draws (a show draws lines as they were, then moves them). */
  drawn?: DrawnStore | null;
  onLine: (line: SheetLine, block: SheetBlock) => void;
  onQuestion: (block: SheetBlock) => void;
  /** «Весь лист на экране»: a click on a question leaves the overview there. */
  onZoomPick: (questionId: string) => void;
  onReplayEnd: (token: number) => void;
  /**
   * The lines of a show whose change is now drawn — a strike done, a line back in ink — reported as each one lands, so
   * the counter moves with the paper, not after the whole show. Every line of the show is reported before its end.
   */
  onReplayStep?: (token: number, keys: readonly string[]) => void;
}

/** How a line moves: written in, named once, erased, back in the list, missed; covered again after «Подсмотреть». */
type Anim = 'write' | 'rub' | 'erase' | 'return' | 'miss' | 'recover';

interface Motion {
  anim: Anim;
  delay: number;
  ms: number;
  /** The state the line moves from: what it looks like before its delay is over. */
  from?: LineState;
}

/** Lines that are simply there: no marker of a state, words in full ink. */
const READABLE: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'missed', 'returned']);
const NO_MOTIONS: ReadonlyMap<string, Motion> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_STATUSES: ReadonlyMap<string, LineStatus> = new Map();

/**
 * «Спрятать строки» covers every line whose words are on the card to be recalled — the ones there and the ones
 * named once (in a quieter ink, but readable); an erased line stays struck through.
 */
export function isCoverable(state: LineState): boolean {
  return state !== 'erased';
}

/**
 * The movement that takes a line from one state to another (null: it just changes). A due line reads as a line
 * named once (with a ring for its dot): a line becomes due by a rub, a due line passes its check by an erase.
 */
export function animFor(from: LineState, to: LineState): Exclude<Anim, 'write' | 'recover'> | null {
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

/** The pace of a line being written in: 26 ms a character, between 280 ms and 1 s (spec 6) — the next line starts at 90 % of it. */
export function writeMs(text: string): number {
  return Math.min(1000, Math.max(280, text.length * 26));
}

/** A line written in fades in this long at most, whatever its pace, ms. */
const WRITE_FADE_MS = 420;

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
const DURATION: Record<Exclude<Anim, 'write' | 'recover'>, number> = { rub: 600, erase: 560, return: 800, miss: 500 };
const NEXT_AFTER: Record<Exclude<Anim, 'write' | 'recover'>, number> = { rub: 120, erase: 300, return: 700, miss: 400 };
/** «История шпаргалки»: a line that changes between two days moves this long (the days pass faster), ms. */
const HISTORY_LINE_MS = 320;
/** The strike of an erased line takes this part of its movement; the words fade over all of it. */
const STRIKE_PART = 0.85;
/** Lines that move in one replay; past them everything changes at once. */
const MAX_ANIMATED = 12;
const SCROLL_FALLBACK_MS = 700;
/** Air between a question brought into view and the bars over the page, px. */
const VIEW_MARGIN = 12;
/**
 * A phone: the count of a show rides over the bottom bar (useSheetPage's chip, one line while the lines move): the
 * question played stands above it, px.
 */
const CHIP_ROOM = 64;
const MARKER_MS = 450;
const TICK_AFTER_MS = 150;
/** Between the questions of one show, and per line under reduced motion (each one changes at once). */
const NEXT_QUESTION_MS = 300;
const REDUCED_LINE_MS = 300;
/** «Весь лист на экране»: room left under the card, and between the top line and the card, px. */
const ZOOM_BOTTOM = 20;
const ZOOM_TOP = 12;

/** A show in progress: set once it is over (finished, skipped, replaced). */
export interface Signal {
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
 * Brings the block into the part of the window nothing covers (visibleBand) unless it is there already, and waits
 * for the scroll to end: its middle in the middle of that part, or its top under the top line when it is taller.
 * Farther than a screen and a half it jumps: a smooth scroll over metres of a list is a blur. The scroll says which
 * it is: «auto» would take the page's own smooth scrolling (html { scroll-behavior }) and glide anyway — on a phone
 * coming back from a protocol the question stood off screen while its lines were struck (jury QA, 2026-10-11).
 */
export async function bringIntoView(element: HTMLElement, smooth: boolean, signal: Signal, reserve = 0): Promise<void> {
  if (typeof window.scrollTo !== 'function') return;
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  const band = visibleBand(reserve);
  const top = band.top + VIEW_MARGIN;
  const bottom = Math.max(top, band.bottom - VIEW_MARGIN);
  const box = element.getBoundingClientRect();
  if (box.top >= top && box.bottom <= bottom) return;
  const room = bottom - top;
  const target = box.height <= room ? top + (room - box.height) / 2 : top;
  const to = Math.max(0, Math.round(window.scrollY + box.top - target));
  if (Math.abs(to - window.scrollY) < 2) return;
  if (!smooth || Math.abs(box.top - target) > viewport * 1.5) {
    window.scrollTo({ top: to, behavior: 'instant' });
    return;
  }
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
    window.scrollTo({ top: to, behavior: 'smooth' });
    if (signal.cancelled) finish();
  });
}

/**
 * The top of a bar pinned over the bottom of the page (a phone's «Тянуть билет», .ex-cta), px from the window's top;
 * null when none covers the page (a computer, a window too low for it, the end of a short page).
 */
export function bottomBarTop(): number | null {
  if (typeof document === 'undefined') return null;
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  for (const bar of document.querySelectorAll<HTMLElement>('.ex-cta')) {
    const position = getComputedStyle(bar).position;
    if (position !== 'sticky' && position !== 'fixed') continue;
    const box = bar.getBoundingClientRect();
    if (box.height > 0 && box.top < viewport && box.bottom >= viewport - 2) return Math.max(0, box.top);
  }
  return null;
}

/**
 * The part of the window the page is not covered in, px from its top: under the top line, above a bar pinned at the
 * bottom — and `reserve` px above that bar, kept for what rides over it (the count of a show on a phone).
 */
export function visibleBand(reserve = 0): { top: number; bottom: number } {
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  const bar = bottomBarTop();
  return { top: topLineBottom(), bottom: bar === null ? viewport : bar - reserve };
}

/**
 * The bottom of the page's top line (it stays over the page), px from the window's top: the app's line
 * (.sf-bar) or a room's own (.sf-room-bar: the example /try, the draw and the answer).
 */
export function topLineBottom(): number {
  const bar = typeof document !== 'undefined' ? document.querySelector('.sf-bar, .sf-room-bar') : null;
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
}

// ── The rows of a line's words ─────────────────────────────────────────────────────────────

interface Row {
  /** In the line body's own px (a scaled card is undone). */
  x: number;
  w: number;
  /** The text row's top. */
  top: number;
}

function sameRows(a: readonly Row[], b: readonly Row[]): boolean {
  return a.length === b.length && a.every((row, index) => Math.abs(row.x - b[index].x) < 0.5 && Math.abs(row.w - b[index].w) < 0.5 && Math.abs(row.top - b[index].top) < 0.5);
}

/**
 * Where a line's words lie, row by row, in its body: the self-test's bar goes under each row of words, not over
 * a whole wrapped block. Measured only while needed.
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
    // The body's size the rows were measured at.
    let size = { width: -1, height: -1 };
    const measure = () => {
      size = { width: host.offsetWidth, height: host.offsetHeight };
      const box = host.getBoundingClientRect();
      const scale = host.offsetWidth > 0 && box.width > 0 ? box.width / host.offsetWidth : 1;
      const row = parseFloat(getComputedStyle(host).getPropertyValue('--cs-row')) || 24;
      // No bar reaches past the line's own body (its column): words never lie outside it.
      const limit = host.offsetWidth > 0 ? host.offsetWidth : Number.POSITIVE_INFINITY;
      const byRow = new Map<number, { left: number; right: number }>();
      for (const rect of Array.from(element.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const middle = (rect.top + rect.height / 2 - box.top) / scale;
        const top = Math.max(0, Math.floor(middle / row) * row);
        const left = Math.max(0, (rect.left - box.left) / scale);
        const right = Math.min(limit, (rect.left - box.left + rect.width) / scale);
        if (right <= left) continue;
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
      // A new observer reports the size it starts with. When that is the size measured above, nothing is
      // measured again; a body that changed in between — the card laid out in its columns after this line
      // first measured its words (EX-18) — is.
      observer = new ResizeObserver(() => {
        if (host.offsetWidth === size.width && host.offsetHeight === size.height) return;
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

interface StrikeRow {
  x: number;
  /** The strike's top, in the words' box (at the height the steady strike of sheet.css stands). */
  y: number;
  w: number;
}

/**
 * Where the strike of a line being erased runs, row by row: measured when the movement starts, at the height of
 * the steady strike (sheet.css: --cs-strike-f of the words' box), so the drawn strike ends where the steady one
 * stands. Null while no strike moves; [] where nothing is laid out (one strike over the whole words then).
 */
function useStrikeRows(text: RefObject<HTMLElement>, active: boolean, content: string): StrikeRow[] | null {
  const [rows, setRows] = useState<StrikeRow[] | null>(null);
  useLayoutEffect(() => {
    const element = text.current;
    const host = element?.parentElement ?? null;
    if (!active || !element || !host) {
      setRows(null);
      return;
    }
    const box = host.getBoundingClientRect();
    const scale = host.offsetWidth > 0 && box.width > 0 ? box.width / host.offsetWidth : 1;
    const style = getComputedStyle(host);
    const thick = parseFloat(style.getPropertyValue('--cs-strike-w')) || 1.5;
    const at = (parseFloat(style.getPropertyValue('--cs-strike-f')) || 60) / 100;
    setRows(
      Array.from(element.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: (rect.left - box.left) / scale,
          y: (rect.top - box.top) / scale + (rect.height / scale - thick) * at,
          w: rect.width / scale,
        })),
    );
  }, [text, active, content]);
  return rows;
}

// ── One line ───────────────────────────────────────────────────────────────────────────────

/** A line uncovered by «Подсмотреть» goes back to its quieter ink when it covers, ms. */
const RECOVER_MS = 380;
/** «Стирает только ответ» after the last word: its width, px (Onest 13). */
const RUB_NOTE_PX = 150;

interface LineViewProps {
  line: SheetLine;
  block: SheetBlock;
  /** The line as drawn now: its own status, or the one before the answer while a replay waits. */
  status: LineStatus;
  motion: Motion | null;
  selected: boolean;
  peeked: boolean;
  covered: boolean;
  /** A caption that appears or goes during the show: its row is kept, empty, so nothing below moves. */
  reserve: string | null;
  /**
   * The first line named once and the first erased line of the sheet say in a caption what their look means
   * (EX-17): «стёрта наполовину: назван 7 окт.». Its row is there all along; the words show once the line is
   * drawn in the state they describe (not while a show still draws it as it was).
   */
  explain: string | null;
  /** «Весь лист на экране»: not a stop of the keyboard (a question is picked by its title). */
  inert: boolean;
  reduced: boolean;
  onLine: (line: SheetLine, block: SheetBlock) => void;
}

const LineView = memo(function LineView({ line, block, status, motion, selected, peeked, covered, reserve, explain, inert, reduced, onLine }: LineViewProps) {
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

  // «Стирает только ответ» (spec 7.1): after the last word of the line when it fits there; else at the end of that row.
  const placeRubNote = () => {
    const text = textRef.current;
    const item = itemRef.current;
    const rects = text ? Array.from(text.getClientRects()).filter((rect) => rect.width > 0) : [];
    const last = rects[rects.length - 1];
    if (!item || !last) return { top: 0, left: null };
    const box = item.getBoundingClientRect();
    const scale = item.offsetWidth > 0 && box.width > 0 ? box.width / item.offsetWidth : 1;
    const top = Math.max(0, (last.top + last.height / 2 - box.top) / scale - 12);
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

  // Covered again after «Подсмотреть»: the words go back to their quieter ink, not in a snap.
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
  const shown: Motion | null = motion ?? (recover ? { anim: 'recover', delay: 0, ms: RECOVER_MS } : null);
  // The strike runs while the line is erased, and goes while an erased line comes back.
  const strikes = shown?.anim === 'erase' || (shown?.anim === 'return' && shown.from === 'erased');
  const strikeRows = useStrikeRows(textRef, strikes, line.text);
  const rows = useRows(textRef, covered, line.text);
  // The caption keeps its row under a covered line too (hidden with it): the self-test does not move the list.
  const lineOwn = lineNote(status, peeked);
  const explained = !lineOwn && explain && status.state === line.status.state ? explain : null;
  const note = lineOwn ?? explained;

  // A caption that appears under the eye (after «Подсмотреть») opens its row instead of pushing the list down at once.
  const [noteEnters, setNoteEnters] = useState(false);
  const hadNote = useRef(Boolean(note) || Boolean(explain));
  useLayoutEffect(() => {
    const had = hadNote.current;
    hadNote.current = Boolean(note) || Boolean(explain);
    if (had || !note || !peeked || reduced) return undefined;
    setNoteEnters(true);
    const end = window.setTimeout(() => setNoteEnters(false), 260);
    return () => window.clearTimeout(end);
  }, [note, explain, peeked, reduced]);

  const kind = line.essential ? 'Главный пункт' : 'Пункт';
  const speech = covered ? { name: `${kind} спрятан. Открыть`, description: null } : lineSpeech(line, status, peeked);
  const describedId = speech.description ? `cs-ld-${block.questionId}-${line.key}` : undefined;
  const ms = shown ? (shown.anim === 'write' ? Math.min(shown.ms, WRITE_FADE_MS) : shown.ms) : 0;
  const style = shown ? ({ '--cs-delay': `${shown.delay}ms`, '--cs-ms': `${ms}ms` } as CSSProperties) : undefined;
  const shownNote = note ?? reserve ?? explain;
  // The strike of each row is drawn in turn, left to right, as one stroke across the rows.
  let strikeLayer: ReactNode = null;
  if (strikes && strikeRows && shown) {
    if (strikeRows.length === 0) {
      strikeLayer = <span className="cs-strike" data-whole="" />;
    } else {
      const total = strikeRows.reduce((sum, row) => sum + row.w, 0) || 1;
      let done = 0;
      strikeLayer = strikeRows.map((row, index) => {
        const share = row.w / total;
        const rowStyle = {
          left: row.x,
          top: row.y,
          width: row.w,
          '--cs-row-delay': `${Math.round(shown.delay + done * shown.ms * STRIKE_PART)}ms`,
          '--cs-row-ms': `${Math.max(60, Math.round(share * shown.ms * STRIKE_PART))}ms`,
        } as CSSProperties;
        done += share;
        return <span key={index} className="cs-strike" data-one={strikeRows.length === 1 ? '' : undefined} style={rowStyle} />;
      });
    }
  }
  return (
    <li
      ref={itemRef}
      className="cs-line"
      data-key={line.key}
      data-state={state}
      data-anim={shown?.anim}
      data-from={shown && shown.anim !== 'write' && shown.anim !== 'recover' ? shown.from : undefined}
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
        <span className="cs-mk" aria-hidden="true" />
        <span className="cs-body">
          <span className="cs-ink" aria-hidden="true">
            <span className="cs-ink-t" ref={textRef}>
              {gluedArrows(line.text)}
            </span>
            {strikeLayer}
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
      {/* The line's name or description says the caption already: here it is for the eye only. */}
      {shownNote && (
        <p className="cs-note" data-kind={peeked ? 'peek' : explained ? 'explain' : state} data-reserve={note ? undefined : ''} data-enter={noteEnters ? '' : undefined} aria-hidden="true">
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

/** «Главные строки стёрты»: a small check after the title. */
function TickIcon() {
  return (
    <svg className="cs-tick-i" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.5 8.4 6.6 11.4 12.5 4.8" />
    </svg>
  );
}

/** A question in no lecture, when the page says so once for the whole sheet: a short dash after its title. */
function GapIcon() {
  return (
    <svg className="cs-tick-i" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4.5 8.5h7" />
    </svg>
  );
}

interface BlockViewProps {
  block: SheetBlock;
  heading: string | null;
  note: string | null;
  addMaterial: string | null;
  /** A question in no lecture, said once by the page: a dash after its title instead of the note under it. */
  gapMark: boolean;
  /** Lines drawn as they were before the answer, while a replay waits to play. */
  statuses: ReadonlyMap<string, LineStatus>;
  motions: ReadonlyMap<string, Motion>;
  /** Captions whose rows are kept while the show plays. */
  reserves: ReadonlyMap<string, string>;
  /** The lines that say what their look means (the first named once and the first erased of the sheet). */
  explained: ReadonlyMap<string, string>;
  /** Erased lines that stay in view under «Скрыть строки, стёртые совсем» (the last answer erased them). */
  kept: ReadonlySet<string>;
  tickDelay: number | null;
  /** A returning line breaks the question's tick: the tick stays until that line is back, then fades (ms). */
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
  /** «почему» of this question is open (its title says it is expanded). */
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
  gapMark,
  statuses,
  motions,
  reserves,
  explained,
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
  // «Скрыть строки, стёртые совсем»: a question folds to its title only when nothing of it is left (every line
  // erased); a secondary line still there stays in view under the tick.
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
              {gapMark && (
                <span className="cs-tick cs-gapmark">
                  {NBSP}
                  <GapIcon />
                  <span className="sr-only">Ответа в лекциях нет</span>
                </span>
              )}
              {showTick && (
                <span className="cs-tick" data-out={learned ? undefined : ''} data-draw={learned && tickDelay !== null ? '' : undefined} style={learned ? (tickDelay !== null ? ({ '--cs-tick-in': `${tickDelay}ms` } as CSSProperties) : undefined) : ({ '--cs-out': `${tickOut ?? 0}ms` } as CSSProperties)}>
                  {NBSP}
                  <TickIcon />
                  {learned && <span className="sr-only">Главные строки стёрты</span>}
                </span>
              )}
            </span>
          </button>
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
                  covered={mode.cover && isCoverable(status.state) && !opened.has(line.key) && !peekedNow}
                  reserve={reserves.get(line.key) ?? null}
                  explain={explained.get(line.key) ?? null}
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
  /** Columns of the overview (more than the page's two when that shows the card larger). */
  columns: number;
  scale: number;
  /** The card's own width in the overview, px (before it is scaled). */
  width: number;
  /** The scaled card's height and its offset to the middle of the column, px. */
  height: number;
  offset: number;
}

const NO_ZOOM: Zoom = { columns: 0, scale: 1, width: 0, height: 0, offset: 0 };

/** A question the mapping found in no lecture (not one whose points could not be written). */
function isNoneGap(block: SheetBlock): boolean {
  return block.kind === 'gap' && block.coverage === 'none';
}

/** «стёрта наполовину: назван 7 окт.», «стёрта совсем: назван в разные дни» (EX-17); else null. */
export function explainNote(status: LineStatus): string | null {
  if (status.state === 'erased') return 'стёрта совсем: назван в разные дни';
  if (status.state !== 'rubbed') return null;
  const last = [...status.history].reverse().find((event) => event.outcome === 'named') ?? null;
  const time = last ? Date.parse(last.at) : Number.NaN;
  const day = last ? (Number.isFinite(time) ? localDayOf(time) : last.date) : null;
  const when = day ? formatShortDay(day).replace(/ /g, NBSP) : '';
  return when ? `стёрта наполовину: назван ${when}` : 'стёрта наполовину: назван';
}

/**
 * The first line named once and the first erased line of the sheet, in the department's order (down the first
 * column, then the second), with what they say. `shownErased`: under «Скрыть строки, стёртые совсем» the erased
 * lines still in view (the ones the last answer erased); null when every line is shown.
 */
export function explainedLines(blocks: readonly SheetBlock[], shownErased: ReadonlySet<string> | null): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const wanted = new Set<LineState>(['rubbed', 'erased']);
  for (const block of blocks) {
    for (const line of block.lines) {
      const state = line.status.state;
      if (!wanted.has(state)) continue;
      if (state === 'erased' && shownErased && !shownErased.has(line.key)) continue;
      // A line uncovered today says so; the next one of its kind explains.
      if (lineNote(line.status)) continue;
      const note = explainNote(line.status);
      if (!note) continue;
      out.set(line.key, note);
      wanted.delete(state);
    }
    if (wanted.size === 0) break;
  }
  return out;
}

const NO_NOTES: ReadonlyMap<string, string> = new Map();
const NO_MARKERS: ReadonlyMap<string, 'draw' | 'still'> = new Map();
const NO_TIMES: ReadonlyMap<string, number> = new Map();

/** The title of a question, the place the keyboard stands while its answer is shown. */
function questionButton(questionId: string): HTMLElement | null {
  return document.getElementById(`cs-q-${questionId}`)?.querySelector<HTMLElement>('.cs-qbtn') ?? null;
}

/** The map of lines is told what the card draws: the states of a show that waits or plays, and the lines moving. */
function drawnOf(overrides: ReadonlyMap<string, LineStatus>, motions: ReadonlyMap<string, Motion>): { states: Map<string, LineState>; motions: Map<string, DrawnMotion> } {
  const states = new Map<string, LineState>();
  for (const [key, status] of overrides) states.set(key, status.state);
  const moving = new Map<string, DrawnMotion>();
  for (const [key, motion] of motions) if (motion.anim !== 'write' && motion.anim !== 'recover') moving.set(key, { anim: motion.anim, delay: motion.delay, ms: motion.ms });
  return { states, motions: moving };
}

export default function CheatSheet({
  examId,
  addMaterialHref,
  blocks,
  sectionTitles,
  lectureCount,
  writeNotes,
  quietGaps = false,
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
  head = null,
  drawn = null,
  onLine,
  onQuestion,
  onZoomPick,
  onReplayEnd,
  onReplayStep,
}: CheatSheetProps) {
  const reduced = usePrefersReducedMotion();
  const replayStepHandler = useRef(onReplayStep);
  replayStepHandler.current = onReplayStep;
  const wrapRef = useRef<HTMLElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The questions are laid out once the card's width is known: a line that measured its rows of words in a card
  // of one column, before the card had its two, kept bars as wide as the whole card (EX-18). The width is read
  // before the first paint, so nothing is seen without its questions.
  const [sized, setSized] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [overrides, setOverrides] = useState<ReadonlyMap<string, LineStatus>>(NO_STATUSES);
  const [motions, setMotions] = useState<ReadonlyMap<string, Motion>>(NO_MOTIONS);
  const [reserves, setReserves] = useState<ReadonlyMap<string, string>>(NO_NOTES);
  // Lines the last answer erased stay under «Скрыть строки, стёртые совсем» until the switch is turned: they
  // vanish on the next visit, never under the eye (and the columns do not jump after the show).
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

  // An uncovered line closes by itself: re-render when the nearest one is over.
  useEffect(() => {
    const current = Date.now();
    setNow(current);
    const ends = [...peeked.values()].filter((until) => until > current);
    if (ends.length === 0) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(...ends) - current + 20);
    return () => window.clearTimeout(timer);
  }, [peeked]);

  // The card's width (the wrap's, while «Весь лист на экране» gives the card a width of its own).
  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const measure = () => setWidth((previous) => (previous === element.clientWidth ? previous : element.clientWidth));
    measure();
    setSized(true);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => paperGeometry(width), [width]);
  const gutter = useMemo(() => numberGutter(blocks), [blocks]);

  // The question that starts the second column, held while the sheet is being written.
  const secondStart = useRef<string | null>(null);

  // The first line named once and the first erased line the eye meets say in a caption what their look means
  // (EX-17). A line with a caption of its own keeps it.
  const explained = useMemo(() => explainedLines(blocks, mode.onlyLeft ? kept : null), [blocks, mode.onlyLeft, kept]);

  // Section titles and notes, and each block's height. While a run writes the sheet, «Ещё не написано» does not
  // appear under every question at once: it waits for the run's end.
  const anyWritten = !writing && blocks.some((block) => block.kind === 'lines');
  const measured = useMemo(() => {
    let previous: number | null = null;
    const items = blocks.map((block) => {
      const section = block.section;
      const heading = section !== null && section !== previous ? sectionTitles[section - 1]?.trim() || `Раздел ${section}` : null;
      if (section !== null) previous = section;
      const quiet = quietGaps && isNoneGap(block);
      const note = writeNotes.get(block.questionId) ?? (quiet ? null : blockNote(block, lectureCount, { anyWritten }));
      return { block, heading, note };
    });
    const metrics = rowMetrics(geometry.column, gutter);
    const estimate = estimateHeight(blocks, metrics);
    const heights = items.map((item) =>
      blockHeight(item.block, metrics, { hideErased: mode.onlyLeft, keep: kept, note: item.note, heading: Boolean(item.heading), estimate, explained }),
    );
    return { items, heights };
  }, [blocks, sectionTitles, writeNotes, lectureCount, quietGaps, anyWritten, geometry.column, gutter, mode.onlyLeft, kept, explained]);

  // The split into columns by the blocks' heights. A question still to be written counts as tall as the written
  // ones, so the split hardly moves when it gets its lines; while the writing goes on (and while the history plays)
  // it does not move at all. «Весь лист на экране» may lay the card out in more columns.
  const zoomColumns = mode.zoom ? zoom.columns : 0;
  const laid = useMemo(() => {
    const { items, heights } = measured;
    if (zoomColumns > geometry.columns) return splitMany(items, heights, zoomColumns);
    const held = holdColumns && secondStart.current ? items.findIndex((item) => item.block.questionId === secondStart.current) : -1;
    return splitColumns(items, heights, geometry.columns, held > 0 ? held : null);
  }, [measured, geometry.columns, holdColumns, zoomColumns]);
  useEffect(() => {
    if (zoomColumns > geometry.columns) return;
    secondStart.current = laid[1]?.[0]?.block.questionId ?? null;
  }, [laid, zoomColumns, geometry.columns]);

  // «Весь лист на экране» (spec 7.4): the card's top under the top line, then the whole card in the rest of the
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
      const plan = zoomPlan({ wrapWidth: wrap.clientWidth, available, heights: measured.heights, geometry });
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
  }, [zoomOn, measured.heights, geometry, zoomColumns, laid]);

  // Turning the switch shows (or hides) every erased line alike. A layout effect declared before the
  // replay's: when both change in one commit, the replay sets its own lines after this.
  const lastOnlyLeft = useRef(mode.onlyLeft);
  useLayoutEffect(() => {
    if (lastOnlyLeft.current === mode.onlyLeft) return;
    lastOnlyLeft.current = mode.onlyLeft;
    setKept(NO_KEYS);
  }, [mode.onlyLeft]);

  // ── «История шпаргалки»: from one day to the next, the lines that change move (shorter: the days pass fast).
  // A line still moving from the day before keeps its movement; the history over, nothing moves.
  const historyStates = useRef<Map<string, LineState> | null>(null);
  const historyEnds = useRef(new Map<string, number>());
  const motionsNow = useRef(motions);
  motionsNow.current = motions;
  useLayoutEffect(() => {
    const states = new Map<string, LineState>();
    for (const block of blocks) for (const line of block.lines) states.set(line.key, line.status.state);
    const before = historyStates.current;
    historyStates.current = stamp ? states : null;
    if (!stamp) {
      if (historyEnds.current.size > 0) {
        historyEnds.current = new Map();
        setMotions(NO_MOTIONS);
      }
      return;
    }
    if (!before || reduced) return;
    const at = Date.now();
    const ends = new Map<string, number>();
    const next = new Map<string, Motion>();
    for (const [key, end] of historyEnds.current) {
      const motion = motionsNow.current.get(key);
      if (motion && end > at) {
        next.set(key, motion);
        ends.set(key, end);
      }
    }
    for (const [key, state] of states) {
      const was = before.get(key);
      if (!was || was === state) continue;
      const anim = animFor(was, state);
      if (!anim) continue;
      next.set(key, { anim, delay: 0, ms: HISTORY_LINE_MS, from: was });
      ends.set(key, at + HISTORY_LINE_MS + 40);
    }
    if (next.size === 0 && historyEnds.current.size === 0) return;
    historyEnds.current = ends;
    setMotions(next.size > 0 ? next : NO_MOTIONS);
  }, [blocks, stamp, reduced]);

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
      // A caption that appears (a missed point) or goes (a missed point named) keeps its row all show long.
      const noteBefore = lineNote(was);
      const noteAfter = now ? lineNote(now) : null;
      if (Boolean(noteBefore) !== Boolean(noteAfter)) reserve.set(change.key, (noteBefore ?? noteAfter) as string);
    }
    historyEnds.current = new Map();
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
    // Each line is reported when its change is drawn: the strike done, the line back in ink (the counter follows).
    const landings: number[] = [];
    const land = (keys: readonly string[]) => {
      if (!signal.cancelled && keys.length > 0) replayStepHandler.current?.(replay.token, keys);
    };
    const landLater = (key: string, ms: number) => {
      if (ms <= 0) land([key]);
      else landings.push(window.setTimeout(() => land([key]), ms));
    };
    const finish = () => {
      if (signal.cancelled) return;
      signal.cancelled = true;
      for (const timer of landings) window.clearTimeout(timer);
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
      // A microtask: the card has drawn the lines as they were before anything moves.
      await Promise.resolve();
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
          land(group.changes.map((change) => change.key));
          continue;
        }
        // On a phone the count of the show rides over the bottom bar: the question stands above it.
        const element = document.getElementById(`cs-q-${group.questionId}`);
        if (element) await bringIntoView(element, !reduced, signal, CHIP_ROOM);
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
          // Nothing moves: the band stands still, the lines change one by one, each at once.
          marked.set(group.questionId, 'still');
          setMarkers(new Map(marked));
          setPhase('lines');
          for (const change of group.changes) {
            remaining.delete(change.key);
            budget -= 1;
            setOverrides(new Map(remaining));
            land([change.key]);
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
        // When each line's change is drawn: a strike when it has crossed the words (STRIKE_PART of its movement),
        // any other movement half-way; a line that does not move changes at once.
        const lands = new Map<string, number>();
        let at = 0;
        for (const change of group.changes) {
          remaining.delete(change.key);
          const anim = animFor(change.from, change.to);
          if (!anim || budget <= 0) {
            lands.set(change.key, 0);
            continue;
          }
          budget -= 1;
          const ms = DURATION[anim] * factor;
          next.set(change.key, { anim, delay: at, ms, from: change.from });
          ends.set(change.key, at + ms);
          lands.set(change.key, at + Math.round(ms * (anim === 'erase' ? STRIKE_PART : 0.5)));
          at += NEXT_AFTER[anim] * factor;
        }
        // The question's tick: drawn 150 ms after its last essential line is erased; or, when a line of it comes
        // back, kept until that line is back, then faded.
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
        for (const [key, ms] of lands) landLater(key, ms);
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
      // Replaced (another answer, the history) or gone with the card: nothing of this show stays drawn.
      signal.cancelled = true;
      for (const timer of landings) window.clearTimeout(timer);
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

  // The map of lines draws what the card draws: the states of a show and its movements, square by square.
  useLayoutEffect(() => {
    drawn?.set(drawnOf(overrides, motions));
  }, [drawn, overrides, motions]);
  useEffect(() => () => drawn?.set({ states: new Map(), motions: new Map() }), [drawn]);

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

  // A line under the pointer or the keyboard lights its square on the map up.
  const pointed = useRef<string | null>(null);
  const pointAt = useCallback((key: string | null) => {
    if (pointed.current === key) return;
    if (pointed.current) markSquare(pointed.current, false);
    pointed.current = key;
    if (key) markSquare(key, true);
  }, []);
  const lineKeyOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.cs-line')?.dataset.key ?? null : null);
  const onPointOver = (event: ReactMouseEvent<HTMLDivElement>) => pointAt(lineKeyOf(event.target));
  const onPointFocus = (event: ReactFocusEvent<HTMLDivElement>) => pointAt(lineKeyOf(event.target));
  const onPointBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pointAt(null);
  };

  const zoomed = mode.zoom && zoom.columns > 0;
  const columnCount = laid.length;
  const paperStyle = {
    '--cs-col': `${geometry.column}px`,
    '--cs-num-w': `${gutter}px`,
    ...(columnCount > 2 ? { gridTemplateColumns: `repeat(${columnCount}, var(--cs-col))` } : null),
    // Scaled down, the focus ring stays two px wide.
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
        data-history={stamp ? '' : undefined}
        style={paperStyle}
        onClickCapture={onPickCapture}
        onMouseOver={onPointOver}
        onMouseLeave={() => pointAt(null)}
        onFocus={onPointFocus}
        onBlur={onPointBlur}
      >
        {stamp && (
          <p className="cs-date" aria-hidden="true">
            {stamp}
          </p>
        )}
        {head && <div className="cs-top">{head}</div>}
        {(sized ? laid : []).map((column, index) => (
          // A column is the same column while its first question is: blocks that stay do not remount (and the keyboard stays on them).
          <div className="cs-col" key={column[0]?.block.questionId ?? `empty-${index}`}>
            {column.map(({ block, heading, note }) => (
              <BlockView
                key={block.questionId}
                block={block}
                heading={heading}
                note={note}
                addMaterial={isNoneGap(block) && !quietGaps ? (addMaterialHref === undefined ? `/exams/${examId}/edit#lectures` : addMaterialHref) : null}
                gapMark={quietGaps && isNoneGap(block) && !note}
                statuses={overrides}
                motions={motions}
                reserves={reserves}
                explained={explained}
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
