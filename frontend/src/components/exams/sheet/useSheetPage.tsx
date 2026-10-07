import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { daysUntil, formatShortDay } from '../../../lib/exams/format';
import {
  buildSheet,
  changeSummary,
  lastAnswerSession,
  quietReason,
  sheetChanges,
  sheetHistory,
  sheetWithout,
  type HistoryFrame,
  type LineState,
  type Sheet,
  type SheetBlock,
  type SheetLine,
} from '../../../lib/exams/cheatSheet';
import { countBucket, track } from '../../../lib/telemetry';
import type { PeakFlag } from '../peak';
import type { FrameBox } from '../useFrame';
import CheatSheet, { writeDuration, type SheetReplay, type SheetViewMode } from './CheatSheet';
import { LinePanel, SheetSummaryCard, SheetWriteCard, useUnitsLeft } from './SheetColumn';
import { changeNote, changeSentence, counterLabel } from './copy';
import { isSheetFontSettled, loadSheetFont } from './sheetFont';
import { useCheatSheet, type CheatSheetData } from './useCheatSheet';

/**
 * The cheat sheet on the exam page (spec 4.1–4.2, 6.6, 7): one hook that owns the sheet's state and
 * hands the page its parts — the paper for the left column, Meldy's column (or, on a phone, the block
 * above the paper and the bottom sheet of a line). It also is the one controller of the after-answer
 * flag in this view: the page's own show of «Вопросы» does not run while the sheet is on screen.
 */

const PEEK_MS = 6000;
const HISTORY_MS = 7000;
const HISTORY_MIN_STEP = 140;
/** After a question's lines have been written in. */
const FRESH_SETTLE_MARGIN_MS = 400;
/** Questions one run writes at most (the server's own limit). */
const MAX_RUN_QUESTIONS = 60;
/** A phone: the end of the after-answer show stays on screen this long over the bottom bar. */
const CHIP_MS = 4500;

/** The phone's card above the paper (the count and «После ответа…») is at least half on screen, under the top line. */
function topCardInView(): boolean {
  if (typeof document === 'undefined') return false;
  const card = document.querySelector<HTMLElement>('.cs-sum[data-variant="top"]');
  if (!card) return false;
  const box = card.getBoundingClientRect();
  if (box.height <= 0) return false;
  const bar = document.querySelector('.sf-bar');
  const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, top);
  return visible >= box.height / 2;
}
/** A phone: where the line of an open bottom sheet stands, px from the top of the window. */
const LINE_TOP_ON_PHONE = 96;

/** Where the sheet's links lead: a real exam's pages, or the example's (/try). */
export interface SheetLinks {
  /** «Ответить на этот вопрос». */
  answer: (questionId: string) => string;
  /** An answer in a line's history: its protocol, or null for no link. */
  session: (sessionId: string) => string | null;
  /** Words after an answer of the history («ответ примера»), or null. */
  sessionNote?: (sessionId: string) => string | null;
  /** «Добавить лекцию» under a question that is in no lecture; null for none. */
  addMaterial: string | null;
}

export function examSheetLinks(examId: string): SheetLinks {
  return {
    answer: (questionId) => `/exams/${examId}/ticket?q=${encodeURIComponent(questionId)}`,
    session: (sessionId) => `/exams/${examId}/ticket?session=${encodeURIComponent(sessionId)}`,
    addMaterial: `/exams/${examId}/edit#lectures`,
  };
}

export interface SheetPageInput {
  examId: string;
  userId: string | null;
  examDate: string | null;
  sectionTitles: readonly string[];
  lectureCount: number;
  /** The sheet is the page's view now. */
  active: boolean;
  side: boolean;
  frameBox: FrameBox;
  /** The page's after-answer flags (taken once per visit): consumed here when the sheet is the view. */
  peakFlags: MutableRefObject<PeakFlag[] | null>;
  /** «35 % билетов, где оба вопроса есть в лекциях», or null. */
  shareLine: string | null;
  mappingRunning: boolean;
  /** No question is checked against the lectures yet. */
  unmapped: boolean;
  /** A tap on a printed question: «почему» of «Вопросы». */
  onQuestion: (questionId: string) => void;
  /** A line's details open: the page closes its own «почему», which would stand in the column first. */
  onLineOpen?: () => void;
  /** The exam's pages by default. */
  links?: SheetLinks;
}

export interface SheetPage {
  data: CheatSheetData;
  paper: ReactNode;
  /** Meldy's column (≥ 1024 px). */
  column: ReactNode;
  /** Phones and tablets: the counter and the one switch above the paper, and writing. */
  top: ReactNode;
  /** Phones and tablets: the share, the self-test, the last answer and the history, under the paper. */
  after: ReactNode;
  /** Phones and tablets: the bottom sheet of a line, and the end of the after-answer show. */
  overlay: ReactNode;
  /** The column holds the one filled pill now («Написать шпаргалку», «Ответить на этот вопрос»). */
  primaryInColumn: boolean;
  /** A line's details are open. */
  lineOpen: boolean;
  /** An answer is being replayed or the history plays: nothing else should ask for the eye. */
  playing: boolean;
  closeLine: () => void;
}

interface ReplayState extends SheetReplay {
  beforeLeft: number;
  /** «После ответа: …» — and, smaller under it, why named lines stayed as they were (or null). */
  sentence: string;
  note: string | null;
}

interface HistoryRun {
  frames: HistoryFrame[];
  index: number;
  running: boolean;
}

/** One question being written in: when it arrived, when its lines start (one pen) and end. */
interface PenSlot {
  seen: number;
  start: number;
  end: number;
}

function isStage(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-stage');
}

/** Is the question's block on screen now (a block written in out of sight does not hold the pen). */
function blockInView(questionId: string): boolean {
  if (typeof document === 'undefined') return true;
  const element = document.getElementById(`cs-q-${questionId}`);
  if (!element) return true;
  const box = element.getBoundingClientRect();
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  return box.bottom > 0 && box.top < viewport;
}

/** The newest answer session of each of these questions (two questions of a ticket may have two). */
function sessionsOf(sheet: Sheet, questionIds: ReadonlySet<string>): Set<string> {
  const sessions = new Set<string>();
  for (const id of questionIds) {
    const session = lastAnswerSession(sheet, new Set([id]));
    if (session) sessions.add(session);
  }
  return sessions;
}

/** The question whose line holds this session (the first in the sheet's order). */
function questionOfSession(blocks: readonly SheetBlock[], session: string): string | null {
  for (const block of blocks) {
    if (block.lines.some((line) => line.status.history.some((event) => event.sessionId === session))) return block.questionId;
  }
  return null;
}

/** The sheet of a real exam: read from the server and its journal (useCheatSheet). */
export function useSheetPage(input: SheetPageInput): SheetPage {
  const data = useCheatSheet(input.examId, { examDate: input.examDate, enabled: Boolean(input.userId) });
  return useSheetView(input, data);
}

/** The sheet's view over any data of the same shape: a real exam's, or the example's on the device. */
export function useSheetView(input: SheetPageInput, data: CheatSheetData): SheetPage {
  const { examId, examDate, active } = input;
  const links = useMemo(() => input.links ?? examSheetLinks(examId), [input.links, examId]);
  // The price line needs the units left today, only while the sheet is on screen.
  const unitsLeft = useUnitsLeft(active ? input.userId : null);
  const [mode, setMode] = useState<SheetViewMode>({ onlyLeft: false, cover: false, zoom: false });
  const modeTouched = useRef(false);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [peeked, setPeeked] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [replayLive, setReplayLive] = useState(false);
  const [chip, setChip] = useState(false);
  const [history, setHistory] = useState<HistoryRun | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const replaySeq = useRef(0);
  const viewTracked = useRef(false);

  // The lines' states are known once the journal has been read: until then no paper, no counter.
  const ready = data.status === 'ready' && data.eventsState === 'ready';
  const shown = data.status === 'ready' && data.journalRead;
  // The paper is laid out once, in its own handwriting: with a fallback font first its lines would
  // wrap anew when the handwriting comes, and every question below would jump (layout shift). The
  // font loads while the sheet and the journal are read; its wait is at most 1.5 s.
  const [fontReady, setFontReady] = useState(isSheetFontSettled);
  useEffect(() => {
    if (!active || fontReady) return undefined;
    let alive = true;
    void loadSheetFont().then(() => {
      if (alive) setFontReady(true);
    });
    return () => {
      alive = false;
    };
  }, [active, fontReady]);
  const paperShown = shown && fontReady;
  const sheet = data.sheet;

  // «Только то, что осталось» turns on by itself when half the lines are erased or the exam is today or
  // tomorrow. Decided once a visit, when the sheet is first there: an answer that crosses the half
  // does not make the erased lines vanish in the middle of its show.
  const modeDecided = useRef(false);
  useEffect(() => {
    if (!ready || modeTouched.current || modeDecided.current || sheet.counts.total === 0) return;
    modeDecided.current = true;
    const days = daysUntil(examDate);
    const auto = sheet.counts.erased * 2 >= sheet.counts.total || (days !== null && days >= 0 && days <= 1);
    if (auto) setMode((current) => (current.onlyLeft ? current : { ...current, onlyLeft: true }));
  }, [ready, sheet.counts.erased, sheet.counts.total, examDate]);

  const onMode = useCallback((next: SheetViewMode) => {
    modeTouched.current = true;
    setMode(next);
    if (!next.cover) setOpened(new Set());
  }, []);

  useEffect(() => {
    if (!active || !ready || viewTracked.current) return;
    viewTracked.current = true;
    track('sheet_view', { left: countBucket(sheet.counts.left), total: countBucket(sheet.counts.total) });
  }, [active, ready, sheet.counts.left, sheet.counts.total]);

  // Uncovered lines close by themselves after 6 s; the column follows the paper.
  useEffect(() => {
    const ends = [...peeked.values()].filter((until) => until > Date.now());
    if (ends.length === 0) return undefined;
    const timer = window.setTimeout(() => setTick(Date.now()), Math.min(...ends) - Date.now() + 30);
    return () => window.clearTimeout(timer);
  }, [peeked, tick]);

  // ── Writing in: one pen ────────────────────────────────────────────────────────────────
  // Questions that arrive together are written one after another, as one hand writes; a question out
  // of sight is written at once and does not keep the next one waiting. Each one settles after its
  // own lines (a later arrival does not keep the others «fresh», to be written in again on a remount).
  const { freshIds, settleFresh } = data;
  const pen = useRef(new Map<string, PenSlot>());
  const penFree = useRef(0);
  const writeDelays = useMemo(() => {
    const now = Date.now();
    const delays = new Map<string, number>();
    for (const id of [...pen.current.keys()]) if (!freshIds.has(id)) pen.current.delete(id);
    for (const block of sheet.blocks) {
      if (!freshIds.has(block.questionId)) continue;
      let slot = pen.current.get(block.questionId);
      if (!slot) {
        const duration = writeDuration(block.lines);
        if (blockInView(block.questionId)) {
          const start = Math.max(now, penFree.current);
          slot = { seen: now, start, end: start + duration };
          penFree.current = slot.end;
        } else {
          slot = { seen: now, start: now, end: now + duration };
        }
        pen.current.set(block.questionId, slot);
      }
      delays.set(block.questionId, slot.start - slot.seen);
    }
    return delays;
  }, [freshIds, sheet.blocks]);
  useEffect(() => {
    if (freshIds.size === 0) return undefined;
    const ends = [...freshIds].map((id) => [id, (pen.current.get(id)?.end ?? Date.now()) + FRESH_SETTLE_MARGIN_MS] as const);
    const next = Math.min(...ends.map(([, end]) => end));
    const timer = window.setTimeout(() => {
      const time = Date.now() + 20;
      settleFresh(ends.filter(([, end]) => end <= time).map(([id]) => id));
    }, Math.max(0, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [freshIds, settleFresh, writeDelays]);

  // ── The replay of an answer ────────────────────────────────────────────────────────────
  const startReplay = useCallback(
    (sessions: ReadonlySet<string>, focusQuestionId: string | null) => {
      if (sessions.size === 0) return false;
      const before = sheetWithout(data.questions, data.events, sessions, data.now, { examDate });
      const changes = sheetChanges(before, sheet);
      const summary = changeSummary(changes);
      const stage = isStage();
      replaySeq.current += 1;
      setHistory(null);
      setLineKey(null);
      setChip(false);
      setReplay({
        token: replaySeq.current,
        changes,
        focusQuestionId,
        slow: stage,
        waitForClick: stage,
        beforeLeft: before.counts.left,
        sentence: changeSentence(summary),
        note: changeNote(summary, quietReason(sheet, sessions, new Set(changes.map((change) => change.key))), data.now),
      });
      setReplayLive(true);
      track('sheet_replay', {
        erased: countBucket(summary.erased),
        rubbed: countBucket(summary.rubbed),
        checked: countBucket(summary.checked),
        returned: countBucket(summary.returned),
        stayed: countBucket(summary.stayed),
      });
      return true;
    },
    [data.questions, data.events, data.now, examDate, sheet],
  );

  // The after-answer flag: the sheet's show instead of the one of «Вопросы» (one controller).
  useEffect(() => {
    if (!active || !ready) return;
    const flags = input.peakFlags.current;
    if (!flags || flags.length === 0) return;
    input.peakFlags.current = null;
    const byHash = new Map(data.questions.map((question) => [question.question_hash, question.question_id]));
    const ids = new Set<string>();
    for (const flag of flags) {
      const id = (flag.questionId && data.questions.some((question) => question.question_id === flag.questionId) ? flag.questionId : null) ?? (flag.hash ? byHash.get(flag.hash) ?? null : null);
      if (id) ids.add(id);
    }
    if (ids.size === 0) return;
    const focus = sheet.blocks.find((block) => ids.has(block.questionId))?.questionId ?? null;
    startReplay(sessionsOf(sheet, ids), focus);
  }, [active, ready, data.questions, sheet, input.peakFlags, startReplay]);

  const lastSession = useMemo(() => lastAnswerSession(sheet), [sheet]);
  const lastQuestion = useMemo(() => (lastSession ? questionOfSession(sheet.blocks, lastSession) : null), [lastSession, sheet.blocks]);
  const onReplayLast = useCallback(() => {
    if (!lastSession) return;
    startReplay(new Set([lastSession]), lastQuestion);
  }, [lastSession, lastQuestion, startReplay]);

  const side = input.side;
  const onReplayEnd = useCallback(
    (token: number) => {
      if (token !== replaySeq.current) return;
      setReplayLive(false);
      // A phone: the column with the count and «После ответа…» is above the paper, out of sight — unless
      // the page did not scroll and the card is still there (then the chip would only repeat it).
      if (!side && !topCardInView()) setChip(true);
    },
    [side],
  );
  useEffect(() => {
    if (!chip) return undefined;
    const timer = window.setTimeout(() => setChip(false), CHIP_MS);
    return () => window.clearTimeout(timer);
  }, [chip]);

  // ── «История листа» (spec 6.6) ─────────────────────────────────────────────────────────
  const onHistory = useCallback(() => {
    const frames = sheetHistory(data.questions, data.events, data.now, { examDate });
    if (frames.length === 0) return;
    // The history replaces a show still running (or waiting for «Показать»): that show is over.
    setReplay(null);
    setReplayLive(false);
    setChip(false);
    setLineKey(null);
    setHistory({ frames, index: 0, running: true });
    track('sheet_history', { days: countBucket(frames.length) });
  }, [data.questions, data.events, data.now, examDate]);
  useEffect(() => {
    if (!history?.running) return undefined;
    const step = Math.max(HISTORY_MIN_STEP, Math.round(HISTORY_MS / Math.max(1, history.frames.length)));
    const timer = window.setTimeout(() => {
      setHistory((current) => {
        if (!current) return current;
        const index = current.index + 1;
        return index >= current.frames.length ? { ...current, running: false } : { ...current, index };
      });
    }, step);
    return () => window.clearTimeout(timer);
  }, [history]);
  const historyBlocks = useMemo(() => {
    if (!history) return null;
    const frame = history.frames[history.index];
    const events = data.events.filter((event) => Date.parse(event.created_at) <= frame.at);
    return buildSheet(data.questions, events, frame.at, { examDate }).blocks;
  }, [history, data.questions, data.events, examDate]);
  const stopHistory = useCallback(() => {
    setHistory((current) => (current?.running ? { ...current, index: current.frames.length - 1, running: false } : null));
  }, []);

  // ── Lines ──────────────────────────────────────────────────────────────────────────────
  const blocks = historyBlocks ?? sheet.blocks;
  const lineOf = useMemo(() => {
    const map = new Map<string, { line: SheetLine; block: SheetBlock }>();
    for (const block of sheet.blocks) for (const line of block.lines) map.set(line.key, { line, block });
    return map;
  }, [sheet.blocks]);
  const selected = lineKey ? lineOf.get(lineKey) ?? null : null;
  const peekedNow = useCallback((key: string) => (peeked.get(key) ?? 0) > Date.now(), [peeked]);

  const recordPeek = data.peek;
  const peek = useCallback(
    (line: SheetLine) => {
      recordPeek(line);
      setPeeked((current) => new Map(current).set(line.key, Date.now() + PEEK_MS));
    },
    [recordPeek],
  );

  const lineOpenHandler = useRef(input.onLineOpen);
  lineOpenHandler.current = input.onLineOpen;
  const onLine = useCallback(
    (line: SheetLine) => {
      if (history) setHistory(null);
      const readable: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'missed', 'returned']);
      // The self-test: a tap opens a covered line. Its words were readable anyway (the switch only hid
      // them), so opening one is not a peek and does not keep it from erasing; a rubbed line is never covered.
      if (mode.cover && readable.has(line.status.state) && !opened.has(line.key)) {
        setOpened((current) => new Set(current).add(line.key));
        return;
      }
      const opening = lineKey !== line.key;
      if (opening) {
        lineOpenHandler.current?.();
        // A phone: the bottom sheet covers the lower part of the screen; the line stands above it.
        if (!side) {
          const element = [...document.querySelectorAll<HTMLElement>('.cs-line')].find((item) => item.dataset.key === line.key);
          if (element) {
            const top = element.getBoundingClientRect().top;
            if (Math.abs(top - LINE_TOP_ON_PHONE) > 4) window.scrollTo({ top: Math.max(0, window.scrollY + top - LINE_TOP_ON_PHONE), behavior: 'auto' });
          }
        }
      }
      setLineKey(opening ? line.key : null);
    },
    [history, mode.cover, opened, lineKey, side],
  );
  const questionHandler = useRef(input.onQuestion);
  questionHandler.current = input.onQuestion;
  const onQuestion = useCallback((block: SheetBlock) => {
    setLineKey(null);
    questionHandler.current(block.questionId);
  }, []);
  const onZoomPick = useCallback((questionId: string) => {
    setMode((current) => ({ ...current, zoom: false }));
    window.setTimeout(() => document.getElementById(`cs-q-${questionId}`)?.scrollIntoView?.({ block: 'center' }), 60);
  }, []);
  const closeLine = useCallback(() => {
    const key = lineKey;
    setLineKey(null);
    if (key) {
      window.setTimeout(() => {
        const target = [...document.querySelectorAll<HTMLElement>('.cs-line')].find((element) => element.dataset.key === key);
        target?.querySelector<HTMLButtonElement>('.cs-lbtn')?.focus();
      }, 0);
    }
  }, [lineKey]);

  // ── Writing ────────────────────────────────────────────────────────────────────────────
  const writable = useMemo(
    () =>
      data.questions
        .filter((question) => !question.rubric && (question.coverage === 'full' || question.coverage === 'partial'))
        .sort((a, b) => a.position - b.position)
        .map((question) => question.question_id),
    [data.questions],
  );
  const startWrite = data.startWrite;
  const onWrite = useCallback(
    (count?: number) => {
      // One run writes at most 60 questions (the server's limit); the rest is the next «Дописать».
      const limit = Math.min(count ?? writable.length, MAX_RUN_QUESTIONS);
      startWrite(limit < writable.length ? writable.slice(0, limit) : undefined);
    },
    [startWrite, writable],
  );

  // ── Parts ──────────────────────────────────────────────────────────────────────────────
  const counts = sheet.counts;
  const left = replay && replayLive ? replay.beforeLeft : counts.left;
  const historyView = history ? { frame: history.frames[history.index], first: history.frames[0], running: history.running } : null;
  const writing = data.write.phase === 'running';
  const showWrite = writing || data.toWrite > 0 || data.write.phase !== 'idle';
  const firstWrite = data.written === 0 && data.toWrite > 0 && !input.mappingRunning;
  const lineOpen = Boolean(selected);
  const primaryInColumn = active && (lineOpen || (firstWrite && !writing));
  const historyPlaying = Boolean(history?.running);

  const summary = (variant: 'full' | 'top' | 'after') => (
    <SheetSummaryCard
      counts={counts}
      left={left}
      roll={Boolean(replay) && !replayLive}
      writing={writing}
      shareLine={input.shareLine}
      changeLine={replay && !replayLive ? replay.sentence : null}
      changeNote={replay && !replayLive ? replay.note : null}
      mode={mode}
      onMode={onMode}
      onReplay={lastSession && !history ? onReplayLast : null}
      onHistory={lastSession && !history ? onHistory : null}
      history={historyView}
      onHistoryStop={() => (history?.running ? stopHistory() : setHistory(null))}
      variant={variant}
    />
  );
  const writeCard = (compact: boolean) =>
    historyPlaying ? null : input.unmapped && data.written === 0 ? (
      <div className="ex-blk cs-write">
        <p className="ex-stmt">Шпаргалка пишется по сверке с лекциями. Сначала нажмите «Сверить с лекциями».</p>
      </div>
    ) : showWrite ? (
      <SheetWriteCard
        written={data.written}
        toWrite={data.toWrite}
        units={data.units}
        unitsLeft={unitsLeft}
        write={data.write}
        onWrite={onWrite}
        onStop={() => void data.stopWrite()}
        mappingRunning={input.mappingRunning}
        unmapped={input.unmapped}
        compact={compact}
      />
    ) : null;

  // The journal could not be read the first time: the lines' states are unknown, and a sheet in full
  // ink would be false. Said plainly, with «Повторить».
  const journalFailed = data.status === 'ready' && !data.journalRead && data.eventsState === 'error';
  const journalError = (
    <div className="ex-blk cs-write" role="alert">
      <p className="ex-stmt">{`${data.eventsError ?? 'Не удалось загрузить ответы.'} Без них не видно, какие строки стёрты.`}</p>
      <button type="button" className="sf-link" onClick={data.reload}>
        Повторить
      </button>
    </div>
  );

  let column: ReactNode;
  if (data.status === 'loading' || (data.status === 'ready' && !data.journalRead && !journalFailed)) {
    column = (
      <p className="ex-loading cs-loading" role="status">
        Загружаем шпаргалку…
      </p>
    );
  } else if (data.status === 'error') {
    column = (
      <div className="ex-blk cs-write" role="alert">
        <p className="ex-stmt">{data.error}</p>
        <button type="button" className="sf-link" onClick={data.reload}>
          Повторить
        </button>
      </div>
    );
  } else if (journalFailed) {
    // Said once, where the paper would be (below): the column does not repeat it.
    column = null;
  } else if (selected) {
    column = (
      <LinePanel
        key={selected.line.key}
        links={links}
        line={selected.line}
        block={selected.block}
        state={selected.line.status.state}
        peeked={peekedNow(selected.line.key)}
        onPeek={() => peek(selected.line)}
        onClose={closeLine}
        variant="column"
        headingId={`cs-lp-${examId}`}
      />
    );
  } else {
    column = (
      <>
        {firstWrite ? writeCard(false) : summary('full')}
        {firstWrite ? null : writeCard(false)}
        {data.eventsState === 'error' && data.eventsError && (
          <p className="ex-fine cs-events-error">
            {data.eventsError}{' '}
            <button type="button" className="sf-link" onClick={data.reload}>
              Повторить
            </button>
          </p>
        )}
      </>
    );
  }

  // A phone shows the paper on the first screen: above it the count and the first write (spec 3.1, «на
  // телефоне — над листом»); writing what is left, the self-test and the rest come under it.
  const top = shown ? (
    <>
      {counts.total > 0 && summary('top')}
      {(firstWrite || writing || input.unmapped) && writeCard(true)}
    </>
  ) : (
    column
  );
  // Under the paper: shown with the paper, so the paper's arrival does not push it down under the eye.
  const after =
    paperShown && (counts.total > 0 || !firstWrite) ? (
      <>
        {!(firstWrite || writing || input.unmapped) && writeCard(true)}
        {counts.total > 0 && summary('after')}
      </>
    ) : null;

  const overlay = !side ? (
    <>
      {selected ? (
        <LinePanel
          key={selected.line.key}
          links={links}
          line={selected.line}
          block={selected.block}
          state={selected.line.status.state}
          peeked={peekedNow(selected.line.key)}
          onPeek={() => peek(selected.line)}
          onClose={closeLine}
          variant="sheet"
          frameBox={input.frameBox}
          headingId={`cs-lp-${examId}`}
        />
      ) : null}
      {chip && replay && !selected ? (
        <button
          type="button"
          className="cs-chip"
          onClick={() => setChip(false)}
          style={{ left: input.frameBox?.left ?? 0, right: input.frameBox?.right ?? 0 }}
        >
          <span className="cs-chip-t" role="status">
            {replay.sentence}
          </span>
          <span className="cs-chip-n">{`${counts.left} ${counterLabel({ left: counts.left, total: counts.total })}`}</span>
        </button>
      ) : null}
    </>
  ) : null;

  const historyDay = historyView ? formatShortDay(historyView.frame.day) : null;
  const paper = paperShown ? (
    <CheatSheet
      examId={examId}
      addMaterialHref={links.addMaterial}
      blocks={blocks}
      sectionTitles={input.sectionTitles}
      lectureCount={input.lectureCount}
      writeNotes={data.writeNotes}
      mode={historyPlaying ? { ...mode, cover: false } : mode}
      freshIds={data.freshIds}
      writeDelays={writeDelays}
      holdColumns={writing || Boolean(history)}
      selectedKey={lineKey}
      peeked={peeked}
      opened={opened}
      markedQuestionId={history ? null : lastQuestion}
      replay={replay}
      stamp={historyDay}
      onLine={onLine}
      onQuestion={onQuestion}
      onZoomPick={onZoomPick}
      onReplayEnd={onReplayEnd}
    />
  ) : journalFailed ? (
    journalError
  ) : data.status === 'ready' ? (
    <p className="ex-loading cs-loading" role="status">
      Загружаем шпаргалку…
    </p>
  ) : null;

  const playing = replayLive || historyPlaying;
  return { data, paper, column, top, after, overlay, primaryInColumn, lineOpen, playing, closeLine };
}
