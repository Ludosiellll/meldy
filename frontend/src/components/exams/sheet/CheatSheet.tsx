import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import type { LineChange, LineState, SheetBlock, SheetLine } from '../../../lib/exams/cheatSheet';
import { MarginStroke, Mark, PencilUnder, seedFrom } from '../../marks';
import { usePrefersReducedMotion } from '../../landing/usePrefersReducedMotion';
import { blockNote, lineLabel, lineNote } from './copy';
import { blockRows, paperGeometry, rowMetrics, splitColumns } from './layout';
import { SheetText } from './SheetText';
import { loadSheetFont } from './sheetFont';
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
  /** «Закрыть строки»: readable lines covered by a dotted slot (a self-test); a tap opens one. */
  cover: boolean;
  /** «Весь лист»: the whole paper scaled into the window. */
  zoom: boolean;
}

export interface SheetReplay {
  /** A new token starts a new replay. */
  token: number;
  /** The lines that change, in the sheet's order, from the sheet before the answer to the sheet after it. */
  changes: LineChange[];
  /** The question answered: brought into view and marked first. */
  focusQuestionId: string | null;
  /** «Показ на проекторе»: everything twice as slow. */
  slow: boolean;
  /** «Показ на проекторе»: nothing moves before «Показать». */
  waitForClick: boolean;
}

export interface CheatSheetProps {
  examId: string;
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
  selectedKey: string | null;
  /** Lines uncovered now: key → until when (ms). */
  peeked: ReadonlyMap<string, number>;
  /** Lines opened in the self-test. */
  opened: ReadonlySet<string>;
  /** The question of the last answer: its printed text wears the yellow marker. */
  markedQuestionId: string | null;
  replay: SheetReplay | null;
  onLine: (line: SheetLine, block: SheetBlock) => void;
  onQuestion: (block: SheetBlock) => void;
  /** «Весь лист»: a click on a question leaves the overview there. */
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

const GONE: ReadonlySet<LineState> = new Set<LineState>(['erased', 'due']);
const READABLE: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'missed', 'returned']);
const NO_MOTIONS: ReadonlyMap<string, Motion> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();

/** The movement that takes a line from one state to another (null: it just changes). */
export function animFor(from: LineState, to: LineState): Exclude<Anim, 'write'> | null {
  if (from === to) return null;
  if (to === 'rubbed') return READABLE.has(from) ? 'rub' : null;
  if (to === 'erased' || to === 'due') return from === 'rubbed' || READABLE.has(from) ? 'erase' : null;
  if (to === 'returned') return 'return';
  if (to === 'missed') return from === 'fresh' ? 'miss' : 'return';
  return null;
}

/** How long a line takes to be written: 26 ms a character, between 280 ms and 1 s (spec 6). */
export function writeMs(text: string): number {
  return Math.min(1000, Math.max(280, text.length * 26));
}

/** Each line of a question is written from 90 % of the one before (spec 6). */
function writeSteps(lines: readonly { key: string; text: string }[]): Map<string, Motion> {
  const map = new Map<string, Motion>();
  let at = 0;
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

/** Scrolls the block to the middle of the window unless it is in view already, and waits for the scroll to end. */
async function bringIntoView(element: HTMLElement, smooth: boolean, signal: Signal): Promise<void> {
  const box = element.getBoundingClientRect();
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  if (box.top >= 80 && box.bottom <= viewport - 40) return;
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

// ── One line ───────────────────────────────────────────────────────────────────────────────

interface LineViewProps {
  line: SheetLine;
  block: SheetBlock;
  state: LineState;
  motion: Motion | null;
  selected: boolean;
  peeked: boolean;
  covered: boolean;
  onLine: (line: SheetLine, block: SheetBlock) => void;
}

const LineView = memo(function LineView({ line, block, state, motion, selected, peeked, covered, onLine }: LineViewProps) {
  const [rubNote, setRubNote] = useState(false);
  const pointer = useRef<{ x: number; moved: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  // «Стирает только ответ» (spec 7.1): rubbing a line with the mouse or a finger shows the hand cannot erase it.
  const onPointerDown = (event: ReactPointerEvent) => {
    pointer.current = { x: event.clientX, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const start = pointer.current;
    if (!start || start.moved || (event.pointerType === 'mouse' && event.buttons === 0)) return;
    if (Math.abs(event.clientX - start.x) > 24) {
      start.moved = true;
      setRubNote(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setRubNote(false), 2000);
    }
  };
  const onClick = () => {
    const rubbed = pointer.current?.moved;
    pointer.current = null;
    if (!rubbed) onLine(line, block);
  };

  const status = state === line.status.state ? line.status : { ...line.status, state };
  const note = covered ? null : lineNote(status, peeked);
  const wave = state === 'missed' || state === 'returned';
  const kind = line.essential ? 'Главный пункт' : 'Пункт';
  const label = peeked ? `${kind}: ${line.title}` : covered ? `${kind} закрыт. Открыть` : lineLabel(line.title, status, line.essential);
  const fromErased = motion?.from === 'erased' || motion?.from === 'due';
  const style = motion ? ({ '--cs-delay': `${motion.delay}ms`, '--cs-ms': `${motion.ms}ms` } as CSSProperties) : undefined;
  const ink = (
    <span className="cs-ink" aria-hidden="true">
      <SheetText text={line.text} seedBase={line.key} />
    </span>
  );
  const drawWave = motion?.anim === 'miss' || motion?.anim === 'return';
  return (
    <li
      className="cs-line"
      data-key={line.key}
      data-state={state}
      data-anim={motion?.anim}
      data-trace={motion?.anim === 'return' ? (fromErased ? 'erased' : 'rubbed') : undefined}
      data-essential={line.essential ? '' : undefined}
      data-peek={peeked ? '' : undefined}
      data-cover={covered ? '' : undefined}
      data-selected={selected ? '' : undefined}
      style={style}
    >
      <button type="button" className="cs-lbtn" aria-label={label} aria-pressed={selected} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onClick={onClick}>
        <span className="cs-bullet" aria-hidden="true">
          {line.essential ? '•' : '–'}
        </span>
        <span className="cs-body">
          <span className="cs-patch" aria-hidden="true" />
          {wave ? (
            <PencilUnder
              seed={seedFrom(line.key, 'wave')}
              hand="graphite"
              kind="wave"
              animate={drawWave}
              delayMs={motion ? motion.delay + Math.round(motion.ms * (motion.anim === 'return' ? 0.62 : 0.2)) : 0}
              dy={-1}
            >
              {ink}
            </PencilUnder>
          ) : (
            ink
          )}
          {covered && <span className="cs-slot" aria-hidden="true" />}
        </span>
      </button>
      {state === 'due' && !covered && (
        <span className="cs-due" aria-hidden="true">
          <Mark kind="vline" seed={seedFrom(line.key, 'due')} width={6} height={18} hand="graphite" />
        </span>
      )}
      {selected && <MarginStroke seed={seedFrom(line.key, 'selected')} />}
      {note && (
        <p className="cs-note" data-kind={peeked ? 'peek' : state}>
          {note}
        </p>
      )}
      {rubNote && (
        <span className="cs-rubnote" role="status">
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
  states: ReadonlyMap<string, LineState>;
  motions: ReadonlyMap<string, Motion>;
  /** Erased lines that stay in view under «Только то, что осталось» (the last answer erased them). */
  kept: ReadonlySet<string>;
  tickDelay: number | null;
  marker: 'none' | 'still' | 'draw';
  mode: SheetViewMode;
  fresh: boolean;
  selectedKey: string | null;
  peeked: ReadonlyMap<string, number>;
  opened: ReadonlySet<string>;
  now: number;
  onLine: (line: SheetLine, block: SheetBlock) => void;
  onQuestion: (block: SheetBlock) => void;
}

const BlockView = memo(function BlockView({
  block,
  heading,
  note,
  addMaterial,
  states,
  motions,
  kept,
  tickDelay,
  marker,
  mode,
  fresh,
  selectedKey,
  peeked,
  opened,
  now,
  onLine,
  onQuestion,
}: BlockViewProps) {
  const stateOf = (line: SheetLine) => states.get(line.key) ?? line.status.state;
  const essentials = block.lines.filter((line) => line.essential);
  const deciding = essentials.length > 0 ? essentials : block.lines;
  const learned = deciding.length > 0 && deciding.every((line) => GONE.has(stateOf(line)));
  // «Только то, что осталось»: a question folds to its printed line only when nothing of it is left
  // (every line erased); a secondary line still there stays in view under the tick.
  const hidden = (line: SheetLine) => mode.onlyLeft && stateOf(line) === 'erased' && !motions.has(line.key) && !kept.has(line.key);
  const folded = block.lines.length > 0 && block.lines.every(hidden);
  // Written in one after another.
  const writes = useMemo(() => (fresh ? writeSteps(block.lines) : NO_MOTIONS), [fresh, block.lines]);
  const titleId = `cs-qh-${block.questionId}`;
  return (
    <article
      className="cs-q"
      id={`cs-q-${block.questionId}`}
      data-qid={block.questionId}
      data-kind={block.kind}
      data-learned={learned ? '' : undefined}
      data-folded={folded ? '' : undefined}
      aria-labelledby={titleId}
    >
      {heading && <p className="cs-sec">{heading}</p>}
      <h3 className="cs-qh" id={titleId}>
        <button type="button" className="cs-qbtn" onClick={() => onQuestion(block)}>
          <span className="sr-only">{`Вопрос ${block.number}. `}</span>
          <span className="cs-qn" aria-hidden="true">
            {block.number}.
          </span>
          <span className="cs-qt">
            <span className="cs-qm" data-marker={marker === 'none' ? undefined : marker}>
              {block.text}
            </span>
          </span>
        </button>
        {learned && (
          <span className="cs-tick">
            <Mark kind="tick" seed={seedFrom(block.questionId, 'tick')} width={20} height={16} hand="graphite" animate={tickDelay !== null} delayMs={tickDelay ?? 0} />
            <span className="sr-only">Главные строки стёрты</span>
          </span>
        )}
      </h3>
      {!folded && block.lines.length > 0 && (
        <ul className="cs-lines">
          {block.lines.map((line) => {
            if (hidden(line)) return null;
            const state = stateOf(line);
            const peekedNow = (peeked.get(line.key) ?? 0) > now;
            return (
              <LineView
                key={line.key}
                line={line}
                block={block}
                state={state}
                motion={peekedNow ? null : (motions.get(line.key) ?? writes.get(line.key) ?? null)}
                selected={selectedKey === line.key}
                peeked={peekedNow}
                covered={mode.cover && READABLE.has(state) && !opened.has(line.key) && !peekedNow}
                onLine={onLine}
              />
            );
          })}
        </ul>
      )}
      {note && !folded && (
        <p className="cs-pnote">
          {note}
          {addMaterial && (
            <>
              {' '}
              <Link className="cs-pnote-link" to={addMaterial}>
                Добавить материал
              </Link>
            </>
          )}
        </p>
      )}
    </article>
  );
});

// ── The sheet ──────────────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'before' | 'marker' | 'lines';

export default function CheatSheet({
  examId,
  blocks,
  sectionTitles,
  lectureCount,
  writeNotes,
  mode,
  freshIds,
  selectedKey,
  peeked,
  opened,
  markedQuestionId,
  replay,
  onLine,
  onQuestion,
  onZoomPick,
  onReplayEnd,
}: CheatSheetProps) {
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef<HTMLElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fontReady, setFontReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [overrides, setOverrides] = useState<ReadonlyMap<string, LineState>>(() => new Map());
  const [motions, setMotions] = useState<ReadonlyMap<string, Motion>>(() => new Map());
  // Lines the last answer erased stay under «Только то, что осталось» until the switch is turned:
  // they vanish on the next visit, never under the eye (and the columns do not jump after the show).
  const [kept, setKept] = useState<ReadonlySet<string>>(NO_KEYS);
  const [ticks, setTicks] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [awaitingClick, setAwaitingClick] = useState(false);
  const clickResolver = useRef<(() => void) | null>(null);
  const [zoom, setZoom] = useState({ scale: 1, height: 0 });
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

  useLayoutEffect(() => {
    const element = paperRef.current;
    if (!element) return undefined;
    const measure = () => setWidth((previous) => (previous === element.clientWidth ? previous : element.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => paperGeometry(width), [width]);

  // Section titles and notes, then the split into columns by the blocks' height in grid rows.
  const laid = useMemo(() => {
    let previous: number | null = null;
    const items = blocks.map((block) => {
      const section = block.section;
      const heading = section !== null && section !== previous ? sectionTitles[section - 1]?.trim() || `Раздел ${section}` : null;
      if (section !== null) previous = section;
      const note = writeNotes.get(block.questionId) ?? blockNote(block, lectureCount);
      return { block, heading, note };
    });
    const metrics = rowMetrics(geometry.column);
    const rows = items.map((item) => blockRows(item.block, metrics, { hideErased: mode.onlyLeft, keep: kept, note: item.note, heading: Boolean(item.heading) }));
    return splitColumns(items, rows, geometry.columns);
  }, [blocks, sectionTitles, writeNotes, lectureCount, geometry.column, geometry.columns, mode.onlyLeft, kept]);

  // «Весь лист»: the paper scaled to the window's height; its layout stays the same.
  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!mode.zoom || !paper) {
      setZoom((previous) => (previous.scale === 1 && previous.height === 0 ? previous : { scale: 1, height: 0 }));
      return undefined;
    }
    const measure = () => {
      const top = Math.max(0, (wrapRef.current ?? paper).getBoundingClientRect().top);
      const available = Math.max(320, (window.innerHeight || 800) - Math.min(top, 240) - 24);
      const natural = paper.offsetHeight;
      const scale = natural > 0 ? Math.min(1, Math.max(0.3, available / natural)) : 1;
      setZoom({ scale, height: Math.ceil(natural * scale) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [mode.zoom, laid, width]);

  // Turning the switch shows (or hides) every erased line alike. Declared before the replay, which
  // sets its own lines in the same commit when both change at once.
  useEffect(() => {
    setKept(NO_KEYS);
  }, [mode.onlyLeft]);

  // ── The replay of an answer (spec 4.2): into view → marker → lines one by one → the column. ──
  useEffect(() => {
    if (!replay) return undefined;
    setKept(replay.changes.length > 0 ? new Set(replay.changes.map((change) => change.key)) : NO_KEYS);
    const signal: Signal = { cancelled: false };
    const factor = replay.slow ? 2 : 1;
    const focus = replay.focusQuestionId ?? replay.changes[0]?.questionId ?? null;
    const before = new Map<string, LineState>();
    for (const change of replay.changes) before.set(change.key, change.from);
    setFocusId(focus);
    setOverrides(before);
    setMotions(new Map());
    setTicks(new Map());
    setPhase('before');

    const finish = () => {
      if (signal.cancelled) return;
      signal.cancelled = true;
      clickResolver.current = null;
      setAwaitingClick(false);
      setOverrides(new Map());
      setMotions(new Map());
      setTicks(new Map());
      setPhase('idle');
      onReplayEnd(replay.token);
    };

    const run = async () => {
      await loadSheetFont();
      if (signal.cancelled) return;
      const target = focus ? document.getElementById(`cs-q-${focus}`) : null;
      if (target) await bringIntoView(target, !reduced, signal);
      if (signal.cancelled) return;
      if (replay.waitForClick) {
        setAwaitingClick(true);
        await new Promise<void>((resolve) => {
          clickResolver.current = resolve;
        });
        clickResolver.current = null;
        setAwaitingClick(false);
        if (signal.cancelled) return;
      }
      if (reduced || replay.changes.length === 0) {
        finish();
        return;
      }
      await sleep(250 * factor, signal);
      if (signal.cancelled) return;
      setPhase('marker');
      await sleep(MARKER_MS * factor, signal);
      if (signal.cancelled) return;
      // Line by line in the sheet's order; past the twelfth the rest changes at once.
      const next = new Map<string, Motion>();
      const ends = new Map<string, number>();
      let at = 0;
      replay.changes.forEach((change, index) => {
        const anim = animFor(change.from, change.to);
        if (!anim || index >= MAX_ANIMATED) return;
        const ms = DURATION[anim] * factor;
        next.set(change.key, { anim, delay: at, ms, from: change.from });
        ends.set(change.key, at + ms);
        at += NEXT_AFTER[anim] * factor;
      });
      // A question whose last essential line goes now gets its tick 150 ms after that line.
      const tickAt = new Map<string, number>();
      for (const block of blocks) {
        const essentials = block.lines.filter((line) => line.essential);
        const deciding = essentials.length > 0 ? essentials : block.lines;
        if (deciding.length === 0 || !deciding.every((line) => GONE.has(line.status.state))) continue;
        if (deciding.every((line) => GONE.has(before.get(line.key) ?? line.status.state))) continue;
        tickAt.set(block.questionId, Math.max(0, ...deciding.map((line) => ends.get(line.key) ?? 0)) + TICK_AFTER_MS * factor);
      }
      setOverrides(new Map());
      setMotions(next);
      setTicks(tickAt);
      setPhase('lines');
      const longest = Math.max(0, ...ends.values(), ...[...tickAt.values()].map((value) => value + 250));
      await sleep(longest + 120, signal);
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
      signal.cancelled = true;
      const resolve = clickResolver.current;
      clickResolver.current = null;
      resolve?.();
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('wheel', onInput);
      window.removeEventListener('touchmove', onInput);
    };
    // One replay per token; its inputs are read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay?.token]);

  const showNow = useCallback(() => {
    const resolve = clickResolver.current;
    clickResolver.current = null;
    resolve?.();
  }, []);

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

  const scaled = mode.zoom && zoom.scale < 1;
  const paperStyle = { '--cs-col': `${geometry.column}px`, ...(scaled ? { transform: `scale(${zoom.scale})` } : null) } as CSSProperties;
  const markerOf = (questionId: string): 'none' | 'still' | 'draw' => {
    if (phase === 'idle') return questionId === markedQuestionId ? 'still' : 'none';
    if (questionId !== focusId) return 'none';
    return phase === 'before' ? 'none' : 'draw';
  };

  return (
    <section
      className="cs-wrap"
      aria-label="Шпаргалка"
      data-zoom={mode.zoom ? '' : undefined}
      data-slow={replay?.slow && phase !== 'idle' ? '' : undefined}
      ref={wrapRef}
      style={scaled ? { height: zoom.height } : undefined}
    >
      <div
        ref={paperRef}
        className="cs-paper"
        data-columns={geometry.columns}
        data-narrow={geometry.narrow ? '' : undefined}
        data-font={fontReady ? 'ready' : 'waiting'}
        style={paperStyle}
        onClickCapture={onPickCapture}
      >
        {laid.map((column, index) => (
          <div className="cs-col" key={index}>
            {column.map(({ block, heading, note }) => (
              <BlockView
                key={block.questionId}
                block={block}
                heading={heading}
                note={note}
                addMaterial={block.kind === 'gap' && block.coverage === 'none' ? `/exams/${examId}/edit#lectures` : null}
                states={overrides}
                motions={motions}
                kept={kept}
                tickDelay={ticks.get(block.questionId) ?? null}
                marker={markerOf(block.questionId)}
                mode={mode}
                fresh={freshIds.has(block.questionId) && !reduced}
                selectedKey={selectedKey}
                peeked={peeked}
                opened={opened}
                now={now}
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
            Показать, что стёрлось
          </button>
        </div>
      )}
    </section>
  );
}
