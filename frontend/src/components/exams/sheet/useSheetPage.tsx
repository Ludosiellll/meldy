import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { daysUntil } from '../../../lib/exams/format';
import {
  buildSheet,
  changeSummary,
  lastAnswerSession,
  sheetChanges,
  sheetHistory,
  sheetWithout,
  type HistoryFrame,
  type LineState,
  type Sheet,
  type SheetBlock,
  type SheetLine,
} from '../../../lib/exams/cheatSheet';
import { track } from '../../../lib/telemetry';
import type { PeakFlag } from '../peak';
import type { FrameBox } from '../useFrame';
import CheatSheet, { writeDuration, type SheetReplay, type SheetViewMode } from './CheatSheet';
import { LinePanel, SheetSummaryCard, SheetWriteCard, useUnitsLeft } from './SheetColumn';
import { changeSentence } from './copy';
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
/** After the longest of the questions being written in has finished. */
const FRESH_SETTLE_MARGIN_MS = 400;

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
  /** Phones and tablets: the bottom sheet of a line. */
  overlay: ReactNode;
  /** The column holds the one filled pill now («Написать шпаргалку», «Ответить на этот вопрос»). */
  primaryInColumn: boolean;
  /** A line's details are open. */
  lineOpen: boolean;
  closeLine: () => void;
}

interface ReplayState extends SheetReplay {
  beforeLeft: number;
  sentence: string | null;
}

interface HistoryRun {
  frames: HistoryFrame[];
  index: number;
  running: boolean;
}

function isStage(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-stage');
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

export function useSheetPage(input: SheetPageInput): SheetPage {
  const { examId, examDate, active } = input;
  const data = useCheatSheet(examId, { examDate, enabled: Boolean(input.userId) });
  // The price line needs the units left today, only while the sheet is on screen.
  const unitsLeft = useUnitsLeft(active ? input.userId : null);
  const [mode, setMode] = useState<SheetViewMode>({ onlyLeft: false, cover: false, zoom: false });
  const modeTouched = useRef(false);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [peeked, setPeeked] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [replayLive, setReplayLive] = useState(false);
  const [history, setHistory] = useState<HistoryRun | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const replaySeq = useRef(0);
  const viewTracked = useRef(false);

  const ready = data.status === 'ready' && data.eventsState === 'ready';
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
    track('sheet_view', { left: sheet.counts.left, total: sheet.counts.total });
  }, [active, ready, sheet.counts.left, sheet.counts.total]);

  // Uncovered lines close by themselves after 6 s; the column follows the paper.
  useEffect(() => {
    const ends = [...peeked.values()].filter((until) => until > Date.now());
    if (ends.length === 0) return undefined;
    const timer = window.setTimeout(() => setTick(Date.now()), Math.min(...ends) - Date.now() + 30);
    return () => window.clearTimeout(timer);
  }, [peeked, tick]);

  // Lines written in once; a later remount must not write them again.
  const { freshIds, settleFresh } = data;
  useEffect(() => {
    if (freshIds.size === 0) return undefined;
    const ids = [...freshIds];
    const longest = Math.max(0, ...sheet.blocks.filter((block) => freshIds.has(block.questionId)).map((block) => writeDuration(block.lines)));
    const timer = window.setTimeout(() => settleFresh(ids), longest + FRESH_SETTLE_MARGIN_MS);
    return () => window.clearTimeout(timer);
  }, [freshIds, settleFresh, sheet.blocks]);

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
      setReplay({
        token: replaySeq.current,
        changes,
        focusQuestionId,
        slow: stage,
        waitForClick: stage,
        beforeLeft: before.counts.left,
        sentence: changeSentence(summary) ?? 'После ответа строки не изменились: стирает только пункт, названный в другой день.',
      });
      setReplayLive(true);
      track('sheet_replay', { erased: summary.erased, rubbed: summary.rubbed, returned: summary.returned });
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

  const onReplayEnd = useCallback((token: number) => {
    if (token === replaySeq.current) setReplayLive(false);
  }, []);

  // ── «История листа» (spec 6.6) ─────────────────────────────────────────────────────────
  const onHistory = useCallback(() => {
    const frames = sheetHistory(data.questions, data.events, data.now, { examDate });
    if (frames.length === 0) return;
    setReplay(null);
    setLineKey(null);
    setHistory({ frames, index: 0, running: true });
    track('sheet_history', { days: frames.length });
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

  const onLine = useCallback(
    (line: SheetLine) => {
      if (history) setHistory(null);
      const readable: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'missed', 'returned']);
      // The self-test: a tap opens a covered line, and that is a peek (it will not erase today).
      if (mode.cover && readable.has(line.status.state) && !opened.has(line.key)) {
        setOpened((current) => new Set(current).add(line.key));
        recordPeek(line);
        return;
      }
      setLineKey((current) => (current === line.key ? null : line.key));
    },
    [history, mode.cover, opened, recordPeek],
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
      startWrite(count && count < writable.length ? writable.slice(0, count) : undefined);
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

  const summary = (variant: 'full' | 'top' | 'after') => (
    <SheetSummaryCard
      counts={counts}
      left={left}
      roll={Boolean(replay) && !replayLive}
      shareLine={input.shareLine}
      changeLine={replay && !replayLive ? replay.sentence : null}
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
    input.unmapped && data.written === 0 ? (
      <div className="ex-blk cs-write">
        <p className="ex-stmt">Шпаргалка пишется по сверке с лекциями: сначала Meldy отметит, какие вопросы в них есть.</p>
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

  let column: ReactNode;
  if (data.status === 'loading') {
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
  } else if (selected) {
    column = (
      <LinePanel
        key={selected.line.key}
        examId={examId}
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
  const top =
    data.status === 'ready' ? (
      <>
        {counts.total > 0 && summary('top')}
        {(firstWrite || writing || input.unmapped) && writeCard(true)}
      </>
    ) : (
      column
    );
  const after =
    data.status === 'ready' && (counts.total > 0 || !firstWrite) ? (
      <>
        {!(firstWrite || writing || input.unmapped) && writeCard(true)}
        {counts.total > 0 && summary('after')}
      </>
    ) : null;

  const overlay =
    !input.side && selected ? (
      <LinePanel
        key={selected.line.key}
        examId={examId}
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
    ) : null;

  const paper =
    data.status === 'ready' ? (
      <CheatSheet
        examId={examId}
        blocks={blocks}
        sectionTitles={input.sectionTitles}
        lectureCount={input.lectureCount}
        writeNotes={data.writeNotes}
        mode={history ? { ...mode, cover: false } : mode}
        freshIds={data.freshIds}
        writing={data.write.phase === 'running'}
        selectedKey={lineKey}
        peeked={peeked}
        opened={opened}
        markedQuestionId={history ? null : lastQuestion}
        replay={replay}
        onLine={onLine}
        onQuestion={onQuestion}
        onZoomPick={onZoomPick}
        onReplayEnd={onReplayEnd}
      />
    ) : null;

  return { data, paper, column, top, after, overlay, primaryInColumn, lineOpen, closeLine };
}
