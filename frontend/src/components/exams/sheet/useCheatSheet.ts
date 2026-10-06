import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { fetchSheetEvents, localDate, recordSheetPeek, type LearningEvent } from '../../../api/learning';
import {
  fetchSheet,
  getSheetWrite,
  SHEET_LOAD_MESSAGE,
  startSheetWrite,
  stopSheetWrite,
  subscribeSheetWrites,
  type SheetJobInfo,
  type SheetWriteState,
} from '../../../api/cheatSheet';
import { formatLimitReset, nextLimitReset } from '../../../api/limits';
import { buildSheet, sheetHashes, type Sheet, type SheetLine, type SheetQuestion } from '../../../lib/exams/cheatSheet';
import { countBucket, track } from '../../../lib/telemetry';
import { writeStatusNote } from './copy';

/**
 * The cheat sheet of one exam on the exam page: the questions with their rubrics from the server,
 * the journal's events of those questions (oral_point, sheet_peek), the writing job (which lives
 * outside React and outlives the page, api/cheatSheet.ts) and the sheet built from all of it.
 * Nothing here costs AI units except `write()`, which the student starts with «Написать шпаргалку».
 */
export interface CheatSheetData {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  questions: SheetQuestion[];
  events: LearningEvent[];
  eventsState: 'loading' | 'ready' | 'error';
  eventsError: string | null;
  /**
   * The journal has been read once for this exam: until then the lines' states are unknown, and the
   * paper and the counter wait (a sheet in full ink that then loses 8 lines would be false).
   */
  journalRead: boolean;
  /** Questions that can be written and are not, and their price in AI units. */
  toWrite: number;
  units: number;
  /** A writing job the server reported when the sheet was read. */
  serverJob: SheetJobInfo | null;
  write: SheetWriteState;
  sheet: Sheet;
  /** The moment the sheet is built for (ms). */
  now: number;
  /** Questions that arrived from the writer during this visit, still to be drawn in. */
  freshIds: ReadonlySet<string>;
  /** What went wrong with questions that were not written, by question id. */
  writeNotes: ReadonlyMap<string, string>;
  /** Questions with a rubric (written, or found to have nothing to write). */
  written: number;
  reload: () => void;
  startWrite: (questionIds?: string[]) => void;
  stopWrite: () => Promise<number>;
  /** «Подсмотреть»: written to the journal (a naming today will not count) and shown at once. */
  peek: (line: SheetLine) => void;
  /** The lines of these questions were drawn in. */
  settleFresh: (questionIds: readonly string[]) => void;
}

const NO_FRESH: ReadonlySet<string> = new Set();

/** The same rubric with the same lines: nothing to merge. */
function sameRubric(current: SheetQuestion['rubric'], next: NonNullable<SheetQuestion['rubric']>): boolean {
  if (!current || current.rubric_id !== next.rubric_id || current.points.length !== next.points.length) return false;
  return current.points.every((point, index) => point.id === next.points[index].id && point.short === next.points[index].short);
}
const PEEK_RETRY_MS = 1500;

/** The next local midnight after `ms`: the sheet changes its day there (peeks, due lines, «сегодня»). */
function nextMidnight(ms: number): number {
  const day = new Date(ms);
  day.setHours(24, 0, 0, 0);
  return day.getTime();
}

export function useCheatSheet(examId: string, options: { examDate?: string | null; enabled?: boolean } = {}): CheatSheetData {
  const enabled = options.enabled !== false;
  const write = useSyncExternalStore(subscribeSheetWrites, () => getSheetWrite(examId));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<SheetQuestion[]>([]);
  const [toWrite, setToWrite] = useState(0);
  const [units, setUnits] = useState(0);
  const [serverJob, setServerJob] = useState<SheetJobInfo | null>(null);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [journalRead, setJournalRead] = useState(false);
  // «Повторить» reads the journal again even when the questions did not change.
  const [eventsRound, setEventsRound] = useState(0);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(NO_FRESH);
  const [now, setNow] = useState(() => Date.now());
  const loadSeq = useRef(0);
  const eventsSeq = useRef(0);
  const mergedSeq = useRef(write.seq);
  const lastPhase = useRef(write.phase);
  // The server's job followed already (by its start): a follow that fails fast must not loop with the reload.
  const followedJob = useRef<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      const seq = ++loadSeq.current;
      if (!quiet) setStatus('loading');
      try {
        const response = await fetchSheet(examId);
        if (seq !== loadSeq.current) return;
        setQuestions(response.questions);
        setToWrite(response.toWrite);
        setUnits(response.units);
        setServerJob(response.job);
        setStatus('ready');
        setError(null);
        setNow(Date.now());
        // The server is writing this exam (another tab, or a page that was left): follow it. Only
        // follow: a job that has ended meanwhile must not become a new run nobody pressed. Once per
        // job: a follow that fails (429, 5xx) ends the run, the run's end reads the sheet again, and
        // that read must not follow the same job again.
        const job = response.job;
        const jobId = job ? job.startedAt ?? 'job' : null;
        if (job && jobId !== followedJob.current && getSheetWrite(examId).phase !== 'running') {
          followedJob.current = jobId;
          void startSheetWrite(examId, undefined, { follow: true, stopping: job.state === 'stopping' });
        }
      } catch (failure) {
        if (seq !== loadSeq.current) return;
        setError(failure instanceof Error && failure.message ? failure.message : SHEET_LOAD_MESSAGE);
        setStatus((current) => (quiet && current === 'ready' ? current : 'error'));
      }
    },
    [examId],
  );

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  // The journal of the written questions; read again when new questions get their lines.
  const hashKey = useMemo(() => sheetHashes(questions).sort().join(','), [questions]);
  const loadEvents = useCallback(async (hashes: string[]) => {
    const seq = ++eventsSeq.current;
    setEventsState('loading');
    try {
      const rows = await fetchSheetEvents(hashes);
      if (seq !== eventsSeq.current) return;
      // Peeks written a moment ago may not be in the read yet: keep them.
      setEvents((current) => {
        const local = current.filter((event) => event.id.startsWith('local-peek-') && !rows.some((row) => row.item_key === event.item_key && row.local_date === event.local_date));
        return [...rows, ...local];
      });
      setEventsState('ready');
      setEventsError(null);
      setJournalRead(true);
      setNow(Date.now());
    } catch (failure) {
      if (seq !== eventsSeq.current) return;
      setEventsState('error');
      setEventsError(failure instanceof Error && failure.message ? failure.message : 'Не удалось загрузить ответы.');
    }
  }, []);
  useEffect(() => {
    if (!enabled || status !== 'ready') return;
    void loadEvents(hashKey ? hashKey.split(',') : []);
  }, [enabled, status, hashKey, loadEvents, eventsRound]);

  // Questions arriving from the writer: their rubric goes into the sheet, and the lines of a question
  // written now are written in. A question written before comes again (status cached) when its short
  // lines are ready: the same rubric with `short` filled in, the lines' states stay.
  // Results that come while the sheet is still being read wait for it: they are merged into what it read.
  useEffect(() => {
    if (status !== 'ready' || write.seq === mergedSeq.current) return;
    mergedSeq.current = write.seq;
    const arrived = Object.entries(write.results).filter(([, result]) => result.rubric);
    if (arrived.length === 0) return;
    // Decided on the sheet as it is now, outside the updater: React may run an updater later, or twice.
    const fresh = questions
      .filter((question) => {
        const rubric = write.results[question.question_id]?.rubric;
        return !question.rubric && rubric != null && rubric.points.length > 0;
      })
      .map((question) => question.question_id);
    setQuestions((current) =>
      current.map((question) => {
        const result = write.results[question.question_id];
        if (!result?.rubric || sameRubric(question.rubric, result.rubric)) return question;
        return { ...question, rubric: result.rubric, rebuilt: false };
      }),
    );
    if (fresh.length > 0) setFreshIds((current) => new Set([...current, ...fresh]));
  }, [status, write.seq, write.results, questions]);

  // A run that ended: the sheet is read again (prices, what is left to write, the server's state).
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = write.phase;
    if (previous === 'running' && write.phase !== 'running') {
      if (write.phase !== 'idle') track('sheet_write_done', { written: countBucket(write.written), failed: countBucket(write.failed), limit: write.limit, phase: write.phase });
      void load(true);
    }
  }, [write.phase, write.written, write.failed, write.limit, load]);

  // The day turns at midnight, and a tab coming back may be hours later.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(1000, nextMidnight(now) - Date.now() + 1000));
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, now]);

  const sheet = useMemo(() => buildSheet(questions, events, now, { examDate: options.examDate ?? null }), [questions, events, now, options.examDate]);

  const writeNotes = useMemo(() => {
    const notes = new Map<string, string>();
    for (const [questionId, result] of Object.entries(write.results)) {
      const question = questions.find((item) => item.question_id === questionId);
      if (question?.rubric) continue;
      const note = result.status === 'none' ? 'В лекциях не нашлось пунктов ответа' : writeStatusNote(result.status, formatLimitReset(nextLimitReset()));
      if (note) notes.set(questionId, note);
    }
    return notes;
  }, [write.results, questions]);

  const startWrite = useCallback(
    (questionIds?: string[]) => {
      track('sheet_write_started', { questions: countBucket(questionIds?.length ?? toWrite), units: countBucket(units) });
      void startSheetWrite(examId, questionIds);
    },
    [examId, toWrite, units],
  );
  const stopWrite = useCallback(() => stopSheetWrite(examId), [examId]);

  const peek = useCallback(
    (line: SheetLine) => {
      const at = new Date();
      const local: LearningEvent = {
        id: `local-peek-${at.getTime()}-${line.key}`,
        created_at: at.toISOString(),
        local_date: localDate(at),
        material_id: null,
        kind: 'sheet_peek',
        item_key: `peek:${line.rubricId}:${line.pointId}`,
        correct: null,
        score: null,
        confidence: null,
        source_ids: [],
        session_id: null,
        payload: { v: 1, question_hash: line.questionHash, rubric_id: line.rubricId, point_id: line.pointId, title: line.title, exam_id: examId },
      };
      setEvents((current) => [...current, local]);
      setNow(at.getTime());
      track('sheet_peek', { state: line.status.state });
      const input = { questionHash: line.questionHash, rubricId: line.rubricId, pointId: line.pointId, title: line.title, examId };
      recordSheetPeek(input).catch(() => {
        window.setTimeout(() => {
          recordSheetPeek(input).catch(() => undefined);
        }, PEEK_RETRY_MS);
      });
    },
    [examId],
  );

  const settleFresh = useCallback((questionIds: readonly string[]) => {
    setFreshIds((current) => {
      if (!questionIds.some((id) => current.has(id))) return current;
      const next = new Set(current);
      questionIds.forEach((id) => next.delete(id));
      return next.size === 0 ? NO_FRESH : next;
    });
  }, []);

  const written = useMemo(() => questions.filter((question) => question.rubric).length, [questions]);
  const reload = useCallback(() => {
    setEventsRound((round) => round + 1);
    void load(true);
  }, [load]);

  return {
    status,
    error,
    questions,
    events,
    eventsState,
    eventsError,
    journalRead,
    toWrite,
    units,
    serverJob,
    write,
    sheet,
    now,
    freshIds,
    writeNotes,
    written,
    reload,
    startWrite,
    stopWrite,
    peek,
    settleFresh,
  };
}
