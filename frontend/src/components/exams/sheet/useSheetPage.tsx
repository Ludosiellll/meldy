import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { daysUntil, formatShortDay } from '../../../lib/exams/format';
import {
  buildSheet,
  changeSummary,
  lastAnswerSession,
  localDayOf,
  quietReason,
  sheetChanges,
  sheetHistory,
  sheetsAround,
  type HistoryFrame,
  type LineState,
  type Sheet,
  type SheetBlock,
  type SheetCounts,
  type SheetLine,
} from '../../../lib/exams/cheatSheet';
import { countBucket, track } from '../../../lib/telemetry';
import { glue } from '../sheetModel';
import type { PeakFlag } from '../peak';
import type { FrameBox } from '../useFrame';
import CheatSheet, { isCoverable, topLineBottom, writeDuration, type SheetReplay, type SheetViewMode } from './CheatSheet';
import { historyResult, LinePanel, SheetSummaryCard, SheetWriteCard, unwritableLine, useUnitsLeft } from './SheetColumn';
import { changeNote, changeSentence, counterLabel } from './copy';
import { createDrawnStore, SheetMap } from './SheetMap';
import { useCheatSheet, type CheatSheetData } from './useCheatSheet';

/**
 * The cheat sheet on the exam page (spec 4.1–4.2, 6.6, 7): one hook that owns the sheet's state and
 * hands the page its parts — the sheet's card for the left column, Meldy's column with the count and the
 * map of lines (or, on a phone, the count and the map at the top of the card, and the bottom sheet of a
 * line). It also is the one controller of the after-answer flag in this view: the page's own show of
 * «Вопросы» does not run while the sheet is on screen.
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

/** A phone: the paper's top under the top line (the history and the pen play there, not below the fold). */
function paperTopIntoView(): void {
  const paper = document.querySelector<HTMLElement>('.cs-paper');
  if (!paper) return;
  const target = paper.getBoundingClientRect().top - topLineBottom() - 8;
  if (Math.abs(target) > 4) window.scrollTo({ top: Math.max(0, window.scrollY + target), behavior: 'auto' });
}

/** Moves the keyboard to `element` when it was lost (on the page's body) or stood inside `within`. */
function keepFocus(element: HTMLElement | null, within: HTMLElement | null = null): void {
  if (!element) return;
  const active = document.activeElement;
  if (!active || active === document.body || (within && within.contains(active))) element.focus({ preventScroll: true });
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
  /** The question whose «почему» is open now, and the id of that panel (its printed line says it is expanded). */
  openQuestionId?: string | null;
  questionPanelId?: string;
  /** The exam's pages by default. */
  links?: SheetLinks;
  /**
   * The page's status block offers «Написать шпаргалку» (components/exams/examStatus.ts): the column's card keeps
   * what the sheet is and drops its own button, so the page has one blue pill.
   */
  writeFromStatus?: boolean;
  /**
   * The units left today as the page read them (it names the price in its status block): then the sheet does not
   * read them a second time. Absent: the sheet reads them itself while it is on screen.
   */
  unitsLeft?: number | null;
  /** (Almost) every question is in no lecture: the paper does not repeat that under each one (the status says it once). */
  quietGaps?: boolean;
  /** The page's next step in the column's card, under what the last answer changed (the example: an exam of one's own). */
  next?: ReactNode;
  /** What «Скрыть строки, стёртые совсем» says while nothing is erased (the example names the answer that erases). */
  onlyLeftNone?: string | null;
  /**
   * A phone on the exam page (10_Project/Phone_Declutter_2026-10-08): one summary — the count and the map at the top of
   * the sheet's card with the rest behind «Как стираются строки», the switches, the last answer and the history right
   * under the card — instead of the count above the card and three cards under it.
   */
  oneBlock?: boolean;
}

export interface SheetPage {
  data: CheatSheetData;
  /** The sheet's card (on phones and tablets with the count and the map of lines at its top). */
  paper: ReactNode;
  /** Meldy's column (≥ 1024 px). */
  column: ReactNode;
  /** Phones and tablets: writing, above the card (and the loading word before the card is there). */
  top: ReactNode;
  /** Phones and tablets: the share, the self-test, the last answer and the history, under the card. */
  after: ReactNode;
  /** Phones and tablets: the bottom sheet of a line, and the end of the after-answer show. */
  overlay: ReactNode;
  /** One region a screen reader hears what an answer, the history or a write changed (rendered once, always). */
  status: ReactNode;
  /**
   * The paper is drawn, or will not be (the sheet or its journal could not be read): what goes under it
   * may appear now — before, the paper's arrival would push it down under the eye.
   */
  settled: boolean;
  /** The column holds the one filled pill now («Написать шпаргалку», «Ответить на этот вопрос»). */
  primaryInColumn: boolean;
  /** A line's details are open. */
  lineOpen: boolean;
  /** «Написать шпаргалку» from outside the column: `count` questions (the units left), or every one that can be written. */
  write: (count?: number | null) => void;
  /** Units left today (null: unknown or not read). */
  unitsLeft: number | null;
  /** An answer is being replayed or the history plays: nothing else should ask for the eye. */
  playing: boolean;
  closeLine: () => void;
}

interface ReplayState extends SheetReplay {
  /** The counter while the show plays: the sheet before the answer. */
  beforeCounts: SheetCounts;
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

/** The questions whose lines hold this session, in the sheet's order (a ticket's two). */
function questionsOfSession(blocks: readonly SheetBlock[], session: string): string[] {
  return blocks.filter((block) => block.lines.some((line) => line.status.history.some((event) => event.sessionId === session))).map((block) => block.questionId);
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
  const ownUnits = useUnitsLeft(active && input.unitsLeft === undefined ? input.userId : null);
  const unitsLeft = input.unitsLeft === undefined ? ownUnits : input.unitsLeft;
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
  // «Показ на проекторе»: «Показать, что изменилось», shown where the eye is while the paper waits.
  const [waitingShow, setWaitingShow] = useState<(() => void) | null>(null);
  // What a screen reader hears when a show, the history or a write ends (one region, rendered always).
  const [announcement, setAnnouncement] = useState('');
  const replaySeq = useRef(0);
  const viewTracked = useRef(false);

  // The lines' states are known once the journal has been read: until then no card, no counter. The card is in
  // the app's own font (Onest, there with the page): it is laid out at once, with nothing to wait for.
  const ready = data.status === 'ready' && data.eventsState === 'ready';
  const shown = data.status === 'ready' && data.journalRead;
  const paperShown = shown;
  const sheet = data.sheet;
  const side = input.side;
  // What the card draws during a show, for the map of lines (it follows square by square).
  const [drawn] = useState(createDrawnStore);

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

  // Uncovered lines close by themselves after 6 s — not while their details are open: the words and the
  // lecture's quote stay there to be read at any pace; the line covers again when the details close.
  useEffect(() => {
    const ends = [...peeked.values()].filter((until) => until > Date.now());
    if (ends.length === 0) return undefined;
    const timer = window.setTimeout(() => setTick(Date.now()), Math.min(...ends) - Date.now() + 30);
    return () => window.clearTimeout(timer);
  }, [peeked, tick]);
  const shownPeeks = useMemo(
    () => (lineKey && peeked.has(lineKey) ? new Map(peeked).set(lineKey, Number.POSITIVE_INFINITY) : peeked),
    [peeked, lineKey],
  );

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
  // What the answer did is told as of its own moment (a check passed weeks ago stays a passed check);
  // the paper plays from each line as it was then to the line as it is now.
  const startReplay = useCallback(
    (sessions: ReadonlySet<string>, focusQuestionIds: readonly string[]) => {
      if (sessions.size === 0) return false;
      const around = sheetsAround(data.questions, data.events, sessions, { examDate });
      if (!around) return false;
      const changes = sheetChanges(around.before, around.after);
      const summary = changeSummary(changes);
      const nowStates = new Map<string, LineState>();
      for (const block of sheet.blocks) for (const line of block.lines) nowStates.set(line.key, line.status.state);
      const paperChanges = changes.map((change) => ({ ...change, to: nowStates.get(change.key) ?? change.to })).filter((change) => change.from !== change.to);
      const day = localDayOf(around.at);
      const stage = isStage();
      replaySeq.current += 1;
      setHistory(null);
      setLineKey(null);
      setChip(false);
      setReplay({
        token: replaySeq.current,
        changes: paperChanges,
        focusQuestionIds,
        slow: stage,
        waitForClick: stage,
        beforeCounts: around.before.counts,
        sentence: changeSentence(summary, day !== localDayOf(data.now) ? day : null),
        note: changeNote(summary, quietReason(around.after, sessions, new Set(changes.map((change) => change.key))), data.now),
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
    // Both questions of a ticket are played, each in its place, in the sheet's order.
    const order = sheet.blocks.filter((block) => ids.has(block.questionId)).map((block) => block.questionId);
    startReplay(sessionsOf(sheet, ids), order);
  }, [active, ready, data.questions, sheet, input.peakFlags, startReplay]);

  const lastSession = useMemo(() => lastAnswerSession(sheet), [sheet]);
  const lastQuestions = useMemo(() => (lastSession ? questionsOfSession(sheet.blocks, lastSession) : []), [lastSession, sheet.blocks]);
  const markedQuestionIds = useMemo(() => new Set(lastQuestions), [lastQuestions]);
  const onReplayLast = useCallback(() => {
    if (!lastSession) return;
    startReplay(new Set([lastSession]), lastQuestions);
  }, [lastSession, lastQuestions, startReplay]);

  const counts = sheet.counts;
  const onReplayEnd = useCallback(
    (token: number) => {
      if (token !== replaySeq.current) return;
      setReplayLive(false);
      // A phone: the column with the count and «После ответа…» is under the paper, out of sight.
      if (!side) setChip(true);
    },
    [side],
  );
  // Heard once the show is over: what changed, why some named lines stayed, and the count.
  useEffect(() => {
    if (!replay || replayLive) return;
    setAnnouncement([replay.sentence, replay.note, `${counts.left} ${counterLabel({ left: counts.left, total: counts.total })}.`].filter(Boolean).join(' '));
  }, [replay, replayLive, counts.left, counts.total]);
  useEffect(() => {
    if (!chip) return undefined;
    const timer = window.setTimeout(() => setChip(false), CHIP_MS);
    return () => window.clearTimeout(timer);
  }, [chip]);
  const onWaiting = useCallback((show: (() => void) | null) => setWaitingShow(() => show), []);

  // ── «История шпаргалки» (spec 6.6) ─────────────────────────────────────────────────────
  const onHistory = useCallback(() => {
    const frames = sheetHistory(data.questions, data.events, data.now, { examDate });
    if (frames.length === 0) return;
    // The history replaces a show still running (or waiting for «Показать»): that show is over.
    setReplay(null);
    setReplayLive(false);
    setChip(false);
    setLineKey(null);
    setHistory({ frames, index: 0, running: true });
    // A phone: the paper's top under the top line, where the date is written; the day and the count ride over the bottom bar.
    if (!side) window.setTimeout(paperTopIntoView, 0);
    track('sheet_history', { days: countBucket(frames.length) });
  }, [data.questions, data.events, data.now, examDate, side]);
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
  // The lowest count the history passed: «1 → 0 → 1», not «nothing erased», when lines went and came back.
  const historyView = useMemo(() => {
    if (!history) return null;
    const seen = history.frames.slice(0, history.index + 1);
    return { frame: history.frames[history.index], first: history.frames[0], lowest: Math.min(...seen.map((frame) => frame.left)), running: history.running };
  }, [history]);
  const historyEnded = history && !history.running;
  useEffect(() => {
    if (!historyEnded || !historyView) return;
    setAnnouncement(`История шпаргалки: ${historyResult(historyView.first, historyView.frame, historyView.lowest)}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyEnded]);

  // ── Lines ──────────────────────────────────────────────────────────────────────────────
  const blocks = historyBlocks ?? sheet.blocks;
  const lineOf = useMemo(() => {
    const map = new Map<string, { line: SheetLine; block: SheetBlock }>();
    for (const block of sheet.blocks) for (const line of block.lines) map.set(line.key, { line, block });
    return map;
  }, [sheet.blocks]);
  const selected = lineKey ? lineOf.get(lineKey) ?? null : null;
  const peekedNow = useCallback((key: string) => (shownPeeks.get(key) ?? 0) > Date.now(), [shownPeeks]);

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
      // The self-test: a tap opens a covered line. Its words were on the card anyway (the switch only hid
      // them), so opening one is not a peek and does not keep it from erasing; an erased line is never covered.
      if (mode.cover && isCoverable(line.status.state) && !opened.has(line.key)) {
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
  // «Вся шпаргалка»: a question picked leaves the overview there, with the keyboard on its printed line.
  const onZoomPick = useCallback((questionId: string) => {
    setMode((current) => ({ ...current, zoom: false }));
    window.setTimeout(() => {
      const block = document.getElementById(`cs-q-${questionId}`);
      block?.scrollIntoView?.({ block: 'center' });
      block?.querySelector<HTMLElement>('.cs-qbtn')?.focus({ preventScroll: true });
    }, 60);
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
        .filter((question) => !question.rubric && !question.unwritable && (question.coverage === 'full' || question.coverage === 'partial'))
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
      // A phone: the pen writes on the paper — its top comes under the top line, not the cards above it.
      if (!side) window.setTimeout(paperTopIntoView, 0);
    },
    [startWrite, writable, side],
  );

  // ── Parts ──────────────────────────────────────────────────────────────────────────────
  // While an answer is shown the counter (and its details) are the sheet's before the answer.
  const shownCounts = replay && replayLive ? replay.beforeCounts : counts;
  const writing = data.write.phase === 'running';
  const showWrite = writing || data.toWrite > 0 || data.unwritable > 0 || data.write.phase !== 'idle';
  const firstWrite = data.written === 0 && data.toWrite > 0 && !input.mappingRunning;
  const lineOpen = Boolean(selected);
  const primaryInColumn = active && (lineOpen || (firstWrite && !writing && !input.writeFromStatus));
  const historyPlaying = Boolean(history?.running);
  const skipTarget = useCallback(() => document.getElementById(`cs-sum-${examId}`) ?? document.getElementById(`cs-lp-${examId}`), [examId]);
  const skip = useMemo(() => ({ label: 'К счётчику и переключателям', target: skipTarget }), [skipTarget]);

  const oneBlock = Boolean(input.oneBlock) && !side;
  // The phone's block says the questions whose points could not be written behind «Подробнее» (not a card of their own).
  const unwritableMore = oneBlock && data.unwritable > 0 ? <p className="ex-fine cs-unwritable">{glue(unwritableLine(data.unwritable))}</p> : null;
  const summary = (variant: 'full' | 'top' | 'after' | 'phone') => (
    <SheetSummaryCard
      map={variant === 'full' || variant === 'top' || variant === 'phone' ? <SheetMap blocks={blocks} drawn={drawn} compact={variant !== 'full'} /> : undefined}
      id={variant === 'top' || variant === 'phone' ? undefined : `cs-sum-${examId}`}
      counts={shownCounts}
      left={shownCounts.left}
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
      onShow={side ? waitingShow : null}
      notice={data.peekSaveFailed ? <PeekNotice onRetry={data.retryPeeks} /> : null}
      next={input.next}
      onlyLeftNone={input.onlyLeftNone}
      variant={variant}
      more={variant === 'phone' ? unwritableMore : undefined}
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
        // The phone's one block says it behind «Как стираются строки» — only when there is a block: a sheet of no lines
        // has none, and the note stays here.
        unwritable={oneBlock && counts.total > 0 ? 0 : data.unwritable}
        unitsLeft={unitsLeft}
        write={data.write}
        onWrite={onWrite}
        onStop={() => void data.stopWrite()}
        mappingRunning={input.mappingRunning}
        unmapped={input.unmapped}
        compact={compact}
        hideAction={input.writeFromStatus}
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

  const panelNotice = data.peekSaveFailed ? <PeekNotice onRetry={data.retryPeeks} /> : null;
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
        notice={panelNotice}
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

  // A phone shows the list on the first screen: the count and the map of lines stand at the top of the card, compact;
  // above the card only the first write. On /try «Скрыть строки, стёртые совсем» is beside the count and the rest comes
  // under the card (a short sheet); on the exam page «Как стираются строки», the last answer's change and the «⋯» with
  // the switches, the last answer and the history are at the top (a sheet of many screens), and nothing of it under the
  // card. Nothing to count and nothing to write (every question in no lecture): no empty block between the tabs and the card.
  const topWrites = firstWrite || writing || input.unmapped;
  const head = !side && counts.total > 0 ? summary(oneBlock ? 'phone' : 'top') : null;
  const top = shown ? (topWrites ? writeCard(true) : null) : column;
  // Under the card: shown with the card, so the card's arrival does not push it down under the eye.
  const after =
    paperShown && (counts.total > 0 || !firstWrite) ? (
      <>
        {!(firstWrite || writing || input.unmapped) && writeCard(true)}
        {counts.total > 0 && !oneBlock && summary('after')}
      </>
    ) : null;

  const historyDay = historyView ? formatShortDay(historyView.frame.day) : null;
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
          notice={panelNotice}
        />
      ) : null}
      {/* «Показ на проекторе» on a phone: over the bottom bar, not on «Тянуть билет». */}
      {waitingShow && !selected ? (
        <div className="cs-chip cs-chip-show" style={{ left: input.frameBox?.left ?? 0, right: input.frameBox?.right ?? 0 }}>
          <button type="button" className="sf-primary" onClick={waitingShow} autoFocus>
            Показать, что изменилось
          </button>
        </div>
      ) : null}
      {/* The history on a phone: its day and count over the bottom bar while it plays, its result after. */}
      {historyView && !selected && (historyView.running || chip) ? (
        <div className="cs-chip" data-history="" style={{ left: input.frameBox?.left ?? 0, right: input.frameBox?.right ?? 0 }}>
          <span className="cs-chip-t" aria-hidden="true">
            {historyView.running
              ? `${historyDay}: ${historyView.frame.left} ${counterLabel({ left: historyView.frame.left, total: historyView.frame.total })}`
              : historyResult(historyView.first, historyView.frame, historyView.lowest)}
          </span>
          {historyView.running ? (
            // The keyboard comes here from «История шпаргалки» (gone under the paper while it plays).
            <button type="button" className="cs-chip-act" onClick={stopHistory} autoFocus>
              Остановить
            </button>
          ) : null}
        </div>
      ) : null}
      {/* The end of a show: for the eye only (the status region tells a screen reader); a tap hides it. */}
      {chip && replay && !history && !selected ? (
        <div className="cs-chip" aria-hidden="true" onClick={() => setChip(false)} style={{ left: input.frameBox?.left ?? 0, right: input.frameBox?.right ?? 0 }}>
          <span className="cs-chip-t">{replay.sentence}</span>
          <span className="cs-chip-n">{`${counts.left} ${counterLabel({ left: counts.left, total: counts.total })}`}</span>
        </div>
      ) : null}
    </>
  ) : null;
  // The history's result on a phone stays a while, like the end of a show.
  useEffect(() => {
    if (!side && historyEnded) setChip(true);
  }, [side, historyEnded]);

  const paper = paperShown ? (
    <CheatSheet
      examId={examId}
      addMaterialHref={links.addMaterial}
      blocks={blocks}
      sectionTitles={input.sectionTitles}
      lectureCount={input.lectureCount}
      writeNotes={data.writeNotes}
      quietGaps={input.quietGaps}
      mode={historyPlaying ? { ...mode, cover: false } : mode}
      freshIds={data.freshIds}
      writeDelays={writeDelays}
      holdColumns={writing || Boolean(history)}
      selectedKey={lineKey}
      peeked={shownPeeks}
      opened={opened}
      markedQuestionIds={history ? NO_QUESTIONS : markedQuestionIds}
      replay={replay}
      stamp={historyDay}
      writing={writing}
      openQuestionId={input.openQuestionId ?? null}
      questionPanelId={input.questionPanelId}
      onWaiting={onWaiting}
      skip={counts.total > 0 && !oneBlock ? skip : null}
      head={head}
      drawn={drawn}
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

  const status = (
    <p className="sr-only" role="status" aria-live="polite">
      {announcement}
    </p>
  );

  const playing = replayLive || historyPlaying;
  const settled = paperShown || data.status === 'error' || journalFailed;
  const write = useCallback((count?: number | null) => onWrite(count ?? undefined), [onWrite]);
  return { data, paper, column, top, after, overlay, status, settled, primaryInColumn, lineOpen, playing, closeLine, write, unitsLeft };
}

const NO_QUESTIONS: ReadonlySet<string> = new Set();

/** A peek that could not be saved: today's answer may erase the line all the same. */
function PeekNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="ex-fine cs-peek-failed" role="alert">
      Подсмотр не сохранился: сегодняшний ответ может стереть эту строку.{' '}
      <button type="button" className="sf-link" onClick={onRetry}>
        Повторить
      </button>
    </p>
  );
}
