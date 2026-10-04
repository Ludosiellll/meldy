import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import {
  EXAM_MESSAGES,
  applyCoverage,
  examErrorMessage,
  isMappingLocked,
  loadExamBundle,
  markQuestionManual,
  MANUAL_REASON,
  type CoverageItem,
  type ExamBundle,
  type ExamQuestion,
} from '../api/exams';
import { fetchQuestionEvents, fetchSessionPoints, localDate, recordSelfRating, type LearningEvent, type SelfRating as Rating } from '../api/learning';
import { useAuth } from '../hooks/useAuth';
import { checkAILimit, FREE_DAILY_LIMIT, nextLimitReset } from '../api/limits';
import { pluralRu } from '../components/conversation/visuals';
import { useConfirm } from '../contexts/ConfirmContext';
import { confidenceVsConfirmed, examSummary, statesByHash, type QuestionState, type Readiness } from '../lib/learning/readiness';
import { percent } from '../lib/exams/ticketMath';
import type { DrawMode } from '../lib/exams/draw';
import { daysUntil, formatClock, formatDay, formatMappedAt, KIND_LABELS, relativeDays, sheetHeader, subjectOf } from '../lib/exams/format';
import { usePrefersReducedMotion } from '../components/landing/usePrefersReducedMotion';
import { Mark } from '../components/marks';
import ExamSheet, { type SheetPeak, type SheetRowView } from '../components/exams/ExamSheet';
import WhyPanel from '../components/exams/WhyPanel';
import { CoverageSummary, PeakSummary, peakCountLine, RateSummary, ReadinessBlock, type PeakView } from '../components/exams/SheetSummary';
import { checkedCount, getMapJob, interruptedMessage, MAPPING_COST, startMapping, useMapJob, watchMapping, type MapPhase } from '../components/exams/mapJobs';
import { COVERAGE_MARK, COVERAGE_MARK_SIZE, PILL_MARK_SCALE, type SheetCoverage } from '../components/exams/marks';
import {
  growthSentence,
  peakChange,
  peakText,
  secondAnswerAfterReview,
  secondAnswerSentence,
  secondAnswerSessions,
  staleSentence,
  takePeakFlags,
  type PeakFlag,
} from '../components/exams/peak';
import { preloadDrawScreen, preloadTicketScreen, whenIdle } from '../components/exams/preload';
import {
  closedPartialShares,
  confidenceSentence,
  confirmedShares,
  coverageCounts,
  coverageShares,
  footnoteOf,
  glue,
  layoutPhrase,
  lecturesPhrase,
  matchesFilter,
  numberOf,
  ratingCounts,
  readinessWords,
  sheetCoverage,
  sheetFilterOf,
  unmappedSentence,
  withRatingOverrides,
  type SheetFilter,
} from '../components/exams/sheetModel';
import { useFrame } from '../components/exams/useFrame';
import DrawModeMenu, { DRAW_CAPTIONS } from '../components/exams/DrawModeMenu';
import '../styles/paper.css';
import '../components/exams/exams.css';

const DIM_MS = 3000;
const SCROLL_PAUSE_MS = 700;

export { DRAW_CAPTIONS };

interface PeakRun {
  questionId: string;
  hash: string;
  before: Readiness;
  phase: 'scroll' | 'draw' | 'still';
  dim: boolean;
  view: PeakView;
  because: string;
  draws: boolean;
}

function hashKey(question: ExamQuestion): string {
  return question.question_hash ?? `row:${question.id}`;
}

/** Phases of a run started in this tab (a wait for another tab's run is 'waiting', then 'idle'). */
const OWN_RUN_PHASES: ReadonlySet<MapPhase> = new Set<MapPhase>(['running', 'done', 'interrupted', 'failed']);
const ENDED_PHASES: ReadonlySet<MapPhase> = new Set<MapPhase>(['done', 'interrupted', 'failed']);
const NO_MANUAL_MARKS: ReadonlyMap<string, CoverageItem | undefined> = new Map();

/** What «Это есть в лекции…» writes (api markQuestionManual), as the row shows it. */
const MANUAL_COVERAGE: Pick<ExamQuestion, 'coverage' | 'coverage_method' | 'coverage_reason' | 'missing_note'> = {
  coverage: 'full',
  coverage_method: 'manual',
  coverage_reason: MANUAL_REASON,
  missing_note: '',
};

/** The live mark of a run, unless the student marked the row by hand after it arrived. */
function liveItem(
  items: ReadonlyMap<string, CoverageItem>,
  manual: ReadonlyMap<string, CoverageItem | undefined>,
  questionId: string,
): CoverageItem | undefined {
  const item = items.get(questionId);
  if (!item || (manual.has(questionId) && manual.get(questionId) === item)) return undefined;
  return item;
}

function examWhen(kind: keyof typeof KIND_LABELS, examDate: string | null): string {
  const day = formatDay(examDate);
  if (!day) return KIND_LABELS[kind];
  const days = daysUntil(examDate);
  if (days !== null && days < 0) return `${KIND_LABELS[kind]} прошёл ${day}`;
  return `${KIND_LABELS[kind]} ${day}${days === null ? '' : `, ${relativeDays(days)}`}`;
}

/** What the header says when the daily limit does not cover a mapping run (no dialog: spec 4.6, 5.11). */
export interface MappingLimit {
  remaining: number;
  resetAt: number;
}

/** «Дневной лимит исчерпан: разметка расходует 10 единиц, сегодня осталось 0. Обновится в 3:00.» */
export function mappingLimitSentence(limit: MappingLimit): string {
  const head = limit.remaining === 0 ? 'Дневной лимит исчерпан' : 'Не хватает дневного лимита';
  const at = formatClock(new Date(limit.resetAt).toISOString());
  return `${head}: разметка расходует ${MAPPING_COST} ${pluralRu(MAPPING_COST, ['единицу', 'единицы', 'единиц'])}, сегодня осталось ${limit.remaining}. Обновится в ${at}.`;
}

/** One page state per exam: opening another exam's sheet starts from scratch. */
export default function ExamDetail() {
  const { id: examId = '' } = useParams();
  return <ExamSheetPage key={examId} examId={examId} />;
}

function ExamSheetPage({ examId }: { examId: string }) {
  const { user } = useAuth();
  // /exams/:id?filter=cov:none opens the sheet filtered (the «Сегодня» link «9 вопросов без материала»);
  // anything that is not a known filter shows every question.
  const [searchParams] = useSearchParams();
  const [openedFilter] = useState<SheetFilter>(() => sheetFilterOf(searchParams.get('filter')));
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const reduced = usePrefersReducedMotion();
  const frame = useFrame<HTMLDivElement>();
  const job = useMapJob(examId);

  const [bundle, setBundle] = useState<ExamBundle | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SheetFilter>(openedFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A self-rating filter is pressed in the self-rating column: that mode opens with it.
  const [rateMode, setRateMode] = useState(() => openedFilter.startsWith('sr:'));
  const [howOpen, setHowOpen] = useState(false);
  const [ratingOverrides, setRatingOverrides] = useState<Record<string, Rating>>({});
  const [ratingPending, setRatingPending] = useState<Set<string>>(() => new Set());
  const [ratingErrors, setRatingErrors] = useState<Record<string, string>>({});
  const [manualPending, setManualPending] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('exam');
  const [limit, setLimit] = useState<MappingLimit | null>(null);
  // «Разметить по лекциям» had the focus when its run started: the focus goes to the pill that replaces it.
  const mapPillFocused = useRef(false);
  const drawPillRef = useRef<HTMLAnchorElement>(null);
  const [peak, setPeak] = useState<PeakRun | null>(null);
  // Rubric points of the first two answers of each question: «Второй ответ после разбора».
  const [points, setPoints] = useState<{ events: LearningEvent[]; state: 'idle' | 'ready' | 'error' }>({ events: [], state: 'idle' });
  const pointsSeq = useRef(0);
  const peakFlags = useRef<PeakFlag[] | null>(null);
  const lastSeq = useRef(job.finishedSeq);
  const watching = useRef(false);
  const loadSeq = useRef(0);
  const shownLoad = useRef(0);
  const eventsSeq = useRef(0);

  /*
   * The mapping registry outlives this page and keeps the marks of its last run. They are shown
   * over the rows only while a run of this tab is going on (and for the one render after it ends,
   * until they are taken into the rows); a run that ended before the page opened is history — the
   * server wrote every mark before sending it, so the rows read now already hold them.
   */
  // finishedSeq when the page opened: a run's outcome (interrupted, failed, partly reused) is news
  // only on the visit it ran in.
  const [openedSeq] = useState(job.finishedSeq);
  // finishedSeq of the last run whose marks were taken into `bundle`.
  const [takenSeq, setTakenSeq] = useState(job.finishedSeq);
  // finishedSeq of the newest run that ended before the rows on screen were read.
  const [readSeq, setReadSeq] = useState(job.finishedSeq);
  // finishedSeq whose strike over the question share was drawn in already: a saved mapping shows it
  // still; only a run that finishes on this page draws it in, once (Jury_Check item 9).
  const [strikeSeen, setStrikeSeen] = useState(job.finishedSeq);
  // Rows marked by hand during a run, with the live mark they replace (a newer mark wins again).
  const [manualMarks, setManualMarks] = useState<ReadonlyMap<string, CoverageItem | undefined>>(NO_MANUAL_MARKS);

  // ------------------------------------------------------------------ loading
  const loadEvents = useCallback(async (questions: ExamQuestion[]) => {
    const seq = ++eventsSeq.current;
    const hashes = questions.map((question) => question.question_hash).filter((hash): hash is string => Boolean(hash));
    setEventsState('loading');
    try {
      const next = await fetchQuestionEvents(hashes);
      if (seq !== eventsSeq.current) return;
      setEvents(next);
      setEventsState('ready');
      setEventsError(null);
      // The points of the first and the second answer of each question answered twice; a failed read
      // only hides «Второй ответ после разбора».
      const sessions = secondAnswerSessions(next);
      const pointSeq = ++pointsSeq.current;
      if (sessions.length === 0) {
        setPoints({ events: [], state: 'ready' });
        return;
      }
      fetchSessionPoints(sessions)
        .then((rows) => {
          if (pointSeq === pointsSeq.current) setPoints({ events: rows, state: 'ready' });
        })
        .catch(() => {
          if (pointSeq === pointsSeq.current) setPoints({ events: [], state: 'error' });
        });
    } catch (error) {
      if (seq !== eventsSeq.current) return;
      setEventsState('error');
      setEventsError(error instanceof Error && error.message ? error.message : 'Не удалось загрузить историю ответов.');
    }
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!examId) return;
      const seq = ++loadSeq.current;
      // Runs that ended before this read started are in the rows it returns.
      const runSeq = getMapJob(examId).finishedSeq;
      if (!quiet) setStatus('loading');
      // The answer history is read as soon as the questions are known, next to the lecture titles.
      let eventsStarted = quiet;
      const startEvents = (questions: ExamQuestion[]) => {
        if (eventsStarted) return;
        eventsStarted = true;
        void loadEvents(questions);
      };
      try {
        const next = await loadExamBundle(examId, { onQuestions: startEvents });
        if (seq < shownLoad.current) return; // a newer read is already on screen
        shownLoad.current = seq;
        if (!next) {
          setStatus('missing');
          return;
        }
        setBundle(next);
        setReadSeq((current) => Math.max(current, runSeq));
        setManualMarks(NO_MANUAL_MARKS);
        setStatus('ready');
        startEvents(next.questions);
      } catch (error) {
        if (seq < shownLoad.current) return;
        setLoadError(examErrorMessage(error, EXAM_MESSAGES.load));
        // A quiet re-read that fails keeps the sheet on screen.
        setStatus((current) => (quiet && current === 'ready' ? current : 'error'));
      }
    },
    [examId, loadEvents],
  );

  const flagsTaken = useRef(false);
  useEffect(() => {
    // Read once per page: React's development double run of effects must not take the flag away.
    if (!flagsTaken.current) {
      flagsTaken.current = true;
      peakFlags.current = takePeakFlags(examId);
    }
    void load();
  }, [examId, load]);

  // A mapping run ended (done, interrupted, waited out): its marks go into the rows (the server
  // wrote them before sending), then the rows are read again.
  useEffect(() => {
    if (job.finishedSeq === lastSeq.current) return;
    lastSeq.current = job.finishedSeq;
    if (ENDED_PHASES.has(job.phase) && job.items.size > 0) {
      const items = job.items;
      setBundle((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((question) => {
                const item = liveItem(items, manualMarks, question.id);
                return item ? applyCoverage(question, item) : question;
              }),
            }
          : current,
      );
    }
    setTakenSeq(job.finishedSeq);
    setManualMarks(NO_MANUAL_MARKS);
    void load(true);
  }, [job.finishedSeq, job.phase, job.items, manualMarks, load]);

  const running = job.phase === 'running';
  const live = running || job.phase === 'waiting' || job.starting;
  // The exam row on screen was read after the last run ended: its lock and dates can be trusted.
  const examFresh = readSeq === job.finishedSeq;

  // A run started elsewhere still holds the lock: wait for it instead of starting another.
  useEffect(() => {
    if (!bundle || watching.current || live || !examFresh) return;
    if (bundle.exam.mapping_state === 'running' && isMappingLocked(bundle.exam)) {
      watching.current = true;
      void watchMapping(examId).finally(() => {
        watching.current = false;
      });
    }
  }, [bundle, examId, live, examFresh]);

  useEffect(() => {
    const cancel = whenIdle(() => {
      preloadDrawScreen();
      preloadTicketScreen();
    });
    return cancel;
  }, []);

  // ------------------------------------------------------------------ rows
  // This tab's run is going on, or ended during this visit.
  const ownRun = OWN_RUN_PHASES.has(job.phase) && (running || job.finishedSeq !== openedSeq);
  const overlay = running || (ENDED_PHASES.has(job.phase) && job.finishedSeq !== takenSeq);
  const questions = useMemo(() => {
    if (!bundle) return [];
    if (!overlay) return bundle.questions;
    return bundle.questions.map((question) => {
      const item = liveItem(job.items, manualMarks, question.id);
      return item ? applyCoverage(question, item) : question;
    });
  }, [bundle, overlay, job.items, manualMarks]);

  const checkingIds = useMemo(() => {
    if (!running) return new Set<string>();
    const targets = job.requested
      ? job.requested
      : questions.filter((question) => question.coverage === null || question.coverage === 'unverified').map((question) => question.id);
    return new Set(targets.filter((id) => !job.items.has(id)));
  }, [running, job.requested, job.items, questions]);

  // «Пора проверить» and «ждут подтверждения» depend on the moment: taken when the journal is read.
  const now = useMemo(() => new Date(), [events]);
  const states = useMemo(() => withRatingOverrides(statesByHash(events, now), ratingOverrides), [events, ratingOverrides, now]);
  const answersByHash = useMemo(() => {
    const map = new Map<string, LearningEvent[]>();
    for (const event of events) {
      if (event.kind !== 'exam_answer' || !event.item_key.startsWith('q:')) continue;
      const hash = event.item_key.slice(2);
      map.set(hash, [...(map.get(hash) ?? []), event]);
    }
    return map;
  }, [events]);

  const peakReadiness = (question: ExamQuestion, state: QuestionState | undefined): Readiness => {
    if (peak && peak.questionId === question.id && peak.phase === 'scroll') return peak.before;
    return state?.readiness ?? 'untested';
  };

  const allRows: SheetRowView[] = useMemo(
    () =>
      questions.map((question) => {
        const state = states.get(hashKey(question));
        const coverage = sheetCoverage(question, checkingIds.has(question.id));
        const readiness = peakReadiness(question, state);
        return {
          question,
          number: numberOf(question),
          coverage,
          readiness,
          // «подтверждено 2 дня назад» for a screen reader, the age the 14-day rule counts.
          readinessWords: state && state.readiness === readiness ? readinessWords(state, now) : undefined,
          selfRating: state?.selfRating ?? null,
          footnote: footnoteOf(question),
          // Only a judgement arriving now is drawn in; marks of a finished or earlier run are simply there.
          appearance: running ? job.marks.get(question.id) ?? null : null,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, states, checkingIds, job.marks, peak, running, now],
  );
  const rows = useMemo(
    () => allRows.filter((row) => matchesFilter(filter, { coverage: row.coverage, readiness: row.readiness, selfRating: row.selfRating })),
    [allRows, filter],
  );

  const layout = bundle?.exam.ticket_layout ?? { mode: 'random' as const, per_ticket: 2 };
  const counts = useMemo(() => coverageCounts(allRows), [allRows]);
  const shareSubjects = useMemo(
    () => allRows.map((row) => ({ id: row.question.id, section: row.question.section, coverage: row.coverage })),
    [allRows],
  );
  const shares = useMemo(() => coverageShares(shareSubjects, layout), [shareSubjects, layout]);
  // The same layout with every «частично» closed: «Закройте 7 вопросов «частично» — …».
  const closed = useMemo(() => closedPartialShares(shareSubjects, layout), [shareSubjects, layout]);
  const hashes = useMemo(() => questions.map(hashKey), [questions]);
  const summary = useMemo(() => examSummary(hashes, states), [hashes, states]);
  const today = localDate(now);
  // Confirmed by the same rule before today: «+1 сегодня» is the net change of the day.
  const confirmedBeforeToday = useMemo(
    () => examSummary(hashes, statesByHash(events.filter((event) => event.local_date && event.local_date < today), now)).confirmed,
    [hashes, events, today, now],
  );
  const examAnswers = useMemo(() => {
    const own = new Set(hashes.map((hash) => `q:${hash}`));
    return events.filter((event) => event.kind === 'exam_answer' && own.has(event.item_key));
  }, [events, hashes]);
  const secondAnswer = useMemo(() => {
    if (points.state !== 'ready') return null;
    const value = secondAnswerAfterReview(examAnswers, points.events);
    return value ? secondAnswerSentence(value) : null;
  }, [examAnswers, points]);
  const confidence = useMemo(() => confidenceVsConfirmed(hashes, states), [hashes, states]);
  const confirmed = useMemo(
    () =>
      confirmedShares(
        allRows.map((row) => ({ id: row.question.id, section: row.question.section, readiness: states.get(hashKey(row.question))?.readiness ?? 'untested' })),
        layout,
      ),
    [allRows, layout, states],
  );
  const ratings = useMemo(() => ratingCounts(allRows), [allRows]);

  // ------------------------------------------------------------------ peak 3
  useEffect(() => {
    const flags = peakFlags.current;
    if (!flags || flags.length === 0 || eventsState !== 'ready' || !bundle) return;
    peakFlags.current = null;
    for (const flag of flags) {
      const question = bundle.questions.find(
        (item) => (flag.hash && item.question_hash === flag.hash) || (flag.questionId && item.id === flag.questionId),
      );
      if (!question || !question.question_hash) continue;
      const answers = answersByHash.get(question.question_hash) ?? [];
      const ratingsOf = events.filter((event) => event.kind === 'self_rating' && event.item_key === `q:${question.question_hash}`);
      const change = peakChange(answers, ratingsOf, flag.before);
      if (!change) continue;
      const text = peakText({
        change,
        answers,
        number: numberOf(question),
        counts: {
          total: summary.total,
          confirmed: summary.confirmed,
          once: summary.once,
          notPassed: summary.notPassed,
          since: summary.since,
          confirmedBeforeToday,
        },
        confirmedTicketsPct: confirmed.low.ok && confirmed.low.mode !== 'fixed' && layout.per_ticket === 2 ? percent(confirmed.low.all) : null,
        now,
      });
      setFilter('all');
      setPeak({
        questionId: question.id,
        hash: question.question_hash,
        before: change.before.readiness,
        phase: text.draws ? 'scroll' : 'still',
        dim: true,
        view: {
          title: text.title,
          before: text.before,
          after: text.after,
          total: text.total,
          statement: text.statement,
          fine: text.fine,
          growth: text.growth,
        },
        because: text.because,
        draws: text.draws,
      });
      break;
    }
  }, [eventsState, bundle, answersByHash, events, summary, confirmed, layout.per_ticket, confirmedBeforeToday, now]);

  // A mapping run that finished on this page draws the strike over the question share in, once.
  const strikeLive = job.phase === 'done' && job.finishedSeq !== openedSeq && job.finishedSeq !== strikeSeen;
  useEffect(() => {
    if (!strikeLive) return;
    const timer = window.setTimeout(() => setStrikeSeen(job.finishedSeq), 1200);
    return () => window.clearTimeout(timer);
  }, [strikeLive, job.finishedSeq]);

  useEffect(() => {
    if (!peak || peak.phase !== 'scroll') return;
    const row = document.getElementById(`exam-q-${peak.questionId}`);
    row?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    const timer = window.setTimeout(() => setPeak((current) => (current ? { ...current, phase: 'draw' } : current)), reduced ? 0 : SCROLL_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [peak, reduced]);

  useEffect(() => {
    if (!peak?.dim) return;
    const undim = () => setPeak((current) => (current ? { ...current, dim: false } : current));
    const timer = window.setTimeout(undim, DIM_MS);
    const events: Array<keyof WindowEventMap> = ['keydown', 'pointerdown', 'wheel', 'touchmove'];
    // Give the automatic scroll a moment before the first user action may end the dimming.
    const arm = window.setTimeout(() => events.forEach((name) => window.addEventListener(name, undim, { once: true })), 900);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(arm);
      events.forEach((name) => window.removeEventListener(name, undim));
    };
  }, [peak?.dim]);

  // ------------------------------------------------------------------ actions
  /*
   * The daily limit is checked before a run. When it does not cover the run, the header says so and
   * every mapping action stays where it is but unavailable — no dialog, and the focus is not lost
   * (redesign spec 4.6 and 5.11, stage QA round 2). An unreadable limit never blocks the work.
   */
  const verifyMappingLimit = useCallback(async (uid: string, cost: number): Promise<boolean> => {
    const status = await checkAILimit(uid, cost);
    if (status.isPro || !status.ok || status.allowed) {
      setLimit(null);
      return true;
    }
    setLimit({ remaining: Math.max(0, FREE_DAILY_LIMIT - (Number(status.count) || 0)), resetAt: nextLimitReset().getTime() });
    return false;
  }, []);

  // The limit is renewed at 00:00 UTC: the actions come back by themselves.
  useEffect(() => {
    if (!limit) return;
    const timer = window.setTimeout(() => setLimit(null), Math.max(0, Math.min(limit.resetAt - Date.now() + 1000, 2_147_000_000)));
    return () => window.clearTimeout(timer);
  }, [limit]);

  const mappingBlocked = Boolean(limit) || job.starting;
  // When «Разметить по лекциям» leaves the page with the focus on it (its run started), the focus goes to
  // «Тянуть билет», which takes its place — never to the page's body.
  const mapPillRef = useCallback((element: HTMLButtonElement | null) => {
    if (element || !mapPillFocused.current) return;
    mapPillFocused.current = false;
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) drawPillRef.current?.focus();
    }, 0);
  }, []);
  const startRun = useCallback(
    (questionIds: string[] | null = null) => {
      if (!userId || limit || getMapJob(examId).starting) return;
      void startMapping({ examId, userId, questionIds, verifyEnergy: verifyMappingLimit });
    },
    [examId, userId, limit, verifyMappingLimit],
  );

  const unverifiedIds = useMemo(() => allRows.filter((row) => row.coverage === 'unverified').map((row) => row.question.id), [allRows]);
  const recheck = !running && job.phase !== 'waiting' && !limit && unverifiedIds.length > 0 ? () => startRun(unverifiedIds) : null;

  const onRate = async (row: SheetRowView, rating: Rating) => {
    const hash = row.question.question_hash;
    const id = row.question.id;
    if (!hash) {
      setRatingErrors((current) => ({ ...current, [id]: 'Отметка не сохранена: обновите страницу и повторите.' }));
      return;
    }
    const previous = ratingOverrides[hash];
    setRatingOverrides((current) => ({ ...current, [hash]: rating }));
    setRatingErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setRatingPending((current) => new Set(current).add(id));
    try {
      await recordSelfRating({
        questionHash: hash,
        rating,
        examId,
        examQuestionId: id,
        materialId: row.question.evidence[0]?.material_id || null,
      });
    } catch (error) {
      setRatingOverrides((current) => {
        const next = { ...current };
        if (previous) next[hash] = previous;
        else delete next[hash];
        return next;
      });
      setRatingErrors((current) => ({
        ...current,
        [id]: error instanceof Error && error.message ? error.message : 'Отметка не сохранена. Повторите.',
      }));
    } finally {
      setRatingPending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const selectedRow = selectedId ? allRows.find((row) => row.question.id === selectedId) ?? null : null;

  const closeWhy = useCallback(() => {
    const id = selectedId;
    setSelectedId(null);
    setManualError(null);
    if (id) window.setTimeout(() => document.getElementById(`exam-q-${id}`)?.querySelector<HTMLButtonElement>('.ex-open')?.focus(), 0);
  }, [selectedId]);

  const onManualMark = async () => {
    if (!selectedRow) return;
    const question = selectedRow.question;
    const ok = await confirm({
      title: 'Отметить вручную?',
      message: `Вопрос ${selectedRow.number} будет отмечен как «есть в лекции». Meldy это не проверял: на листе будет подпись «отмечено вами».`,
      confirmText: 'Отметить',
      cancelText: 'Отмена',
      type: 'info',
    });
    if (!ok) return;
    setManualPending(true);
    setManualError(null);
    try {
      await markQuestionManual(question.id);
      setBundle((current) =>
        current
          ? { ...current, questions: current.questions.map((item) => (item.id === question.id ? { ...item, ...MANUAL_COVERAGE, evidence: [], nearest: [] } : item)) }
          : current,
      );
      // The hand mark is newer than the live mark this row may have from a run going on now.
      const replaced = getMapJob(examId).items.get(question.id);
      setManualMarks((current) => new Map(current).set(question.id, replaced));
    } catch (error) {
      setManualError(examErrorMessage(error, EXAM_MESSAGES.manual));
    } finally {
      setManualPending(false);
    }
  };

  // ------------------------------------------------------------------ render
  if (status === 'loading') {
    return (
      <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
        <p className="ex-loading" role="status">
          Загружаем лист экзамена…
        </p>
      </div>
    );
  }
  if (status === 'missing' || status === 'error' || !bundle) {
    return (
      <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
        <div className="ex-error" role="alert">
          <h2>{status === 'missing' ? 'Экзамен не найден' : 'Не удалось открыть лист экзамена'}</h2>
          <p>{status === 'missing' ? 'Его удалили, или он принадлежит другому аккаунту.' : loadError}</p>
          {status === 'error' ? (
            <button type="button" className="sf-link" onClick={() => void load()}>
              Повторить
            </button>
          ) : (
            <Link className="sf-link" to="/exams">
              Экзамены
            </Link>
          )}
        </div>
      </div>
    );
  }

  const { exam } = bundle;
  const perTicket = exam.ticket_layout.per_ticket;
  const drawLabel = perTicket <= 1 && exam.ticket_layout.mode !== 'fixed' ? 'Тянуть вопрос' : 'Тянуть билет';
  const drawHref = `/exams/${exam.id}/draw${drawMode === 'exam' ? '' : `?mode=${drawMode}`}`;
  const progress = checkedCount(job);
  // A run of this tab or another one is going on (the short limit check before a run is not: the
  // action that asked for it stays where it is, so the focus is not lost).
  const busy = running || job.phase === 'waiting';
  const staleRun = examFresh && !busy && exam.mapping_state === 'running' && !isMappingLocked(exam);
  const mappedCount = questions.filter((question) => question.coverage !== null).length;
  // Marks a mapping run wrote (a mark made by hand is not a run).
  const runMarks = questions.filter((question) => question.coverage !== null && question.coverage_method !== 'manual').length;
  const neverMapped = mappedCount === 0 && !busy && questions.length > 0;
  // What happened to this tab's run on this visit (the database says the rest).
  const outcome = ownRun && !running ? job.phase : null;
  const outcomeNote = outcome === 'interrupted' || (outcome === 'failed' && Boolean(job.message));
  // Until the exam row is read again after a run, its date is the one the run reported.
  const mappedAt = !examFresh && ownRun && job.done?.mappedAt ? job.done.mappedAt : exam.mapped_at;

  let mappingMeta: string;
  if (running) mappingMeta = progress ? `проверено ${progress.checked} из ${progress.total}` : 'сверка идёт';
  else if (job.phase === 'waiting') mappingMeta = 'сверка ещё идёт';
  else if (mappedAt) mappingMeta = `сверка от ${formatMappedAt(mappedAt)}`;
  // A run that stopped half-way left marks but no date: say how far it got, never «разметки ещё нет».
  else if (runMarks > 0) mappingMeta = `проверено ${runMarks} из ${questions.length}, сверка прервалась`;
  else mappingMeta = 'сверки ещё нет';

  const metaParts = [
    examWhen(exam.kind, exam.exam_date),
    layoutPhrase(questions.length, exam.ticket_layout),
    lecturesPhrase(bundle.materials.length),
    mappingMeta,
  ];

  const mapped = new Set(exam.mapped_material_ids);
  const current = new Set(bundle.materialIds);
  const added = exam.mapped_at ? bundle.materialIds.filter((id) => !mapped.has(id)).length : 0;
  const removed = exam.mapped_at ? exam.mapped_material_ids.filter((id) => !current.has(id)).length : 0;
  const reusedPart =
    outcome === 'done' && job.done && job.done.reused > 0 && job.received > job.done.reused && job.done.oldestMappedAt
      ? `Часть сверки от ${formatClock(job.done.oldestMappedAt)}, остальное сейчас.`
      : null;
  const skippedLectures = ownRun ? job.start?.skipped.filter((item) => item.reason === 'no_text').length ?? 0 : 0;

  const notes: Array<{ key: string; text: string; action?: { label: string; run: () => void; maps?: boolean }; quiet?: boolean; status?: boolean }> = [];
  if (limit) notes.push({ key: 'limit', text: mappingLimitSentence(limit), status: true });
  if (outcome === 'interrupted') notes.push({ key: 'int', text: job.message ?? interruptedMessage(job), action: { label: 'Продолжить', run: () => startRun(null), maps: true } });
  if (staleRun) notes.push({ key: 'stale', text: `Сверка прервалась: проверено ${runMarks} из ${questions.length}.`, action: { label: 'Продолжить', run: () => startRun(null), maps: true } });
  if (job.phase === 'waiting') notes.push({ key: 'wait', text: 'Сверка ещё идёт. Лист обновится, когда она закончится.', quiet: true });
  if (outcome === 'failed' && job.message) notes.push({ key: 'fail', text: job.message, action: { label: 'Повторить', run: () => startRun(null), maps: true } });
  if (job.failedMessage && running) notes.push({ key: 'batch', text: `${job.failedMessage}.`, quiet: true });
  if (reusedPart) notes.push({ key: 'reused', text: reusedPart, quiet: true });
  if (bundle.materials.length === 0)
    notes.push({ key: 'nolect', text: 'Без лекций Meldy не сможет отметить покрытие. Список сохранится.', action: { label: 'Добавить лекции', run: () => navigate(`/exams/${exam.id}/edit#lectures`) } });
  // Before the first run the filled pill of the header is «Разметить по лекциям» (redesign critique 7).
  else if (neverMapped && !staleRun && !outcomeNote) notes.push({ key: 'unmapped', text: 'Вопросы ещё не сверены с лекциями.' });
  else if (!busy && !staleRun && !outcomeNote && mappedCount > 0 && mappedCount < questions.length)
    notes.push({
      key: 'some-unmapped',
      text: unmappedSentence(questions.length - mappedCount, shares),
      action: { label: 'Сверить', run: () => startRun(null), maps: true },
    });
  if (!running && examFresh && (added > 0 || removed > 0)) {
    const parts: string[] = [];
    if (added > 0) parts.push(`добавлено ${lecturesPhrase(added)}`);
    if (removed > 0) parts.push(`убрано ${lecturesPhrase(removed)}`);
    notes.push({ key: 'changed', text: `После сверки ${parts.join(', ')}.`, action: { label: 'Сверить заново', run: () => startRun(null), maps: true } });
  }
  if (skippedLectures > 0) notes.push({ key: 'notext', text: `${lecturesPhrase(skippedLectures)} без текста не ${skippedLectures === 1 ? 'учтена' : 'учтены'}.`, quiet: true });
  if (eventsState === 'error' && eventsError) notes.push({ key: 'events', text: eventsError, action: { label: 'Повторить', run: () => void loadEvents(bundle.questions) }, quiet: true });

  const editLocked = running || job.phase === 'waiting' || (examFresh && exam.mapping_state === 'running' && isMappingLocked(exam));
  // Before the first run the one filled pill is «Разметить по лекциям»; «Тянуть билет» is a link under it.
  const preMapping = neverMapped && bundle.materials.length > 0 && !staleRun && !outcomeNote;
  // Only «Все 40» until something is mapped: three filters showing 0 said nothing (redesign critique 7).
  const showCoverageFilters = mappedCount > 0 || running;
  const mapPill = (
    <button
      ref={mapPillRef}
      type="button"
      className="sf-primary"
      aria-disabled={mappingBlocked || undefined}
      aria-busy={job.starting || undefined}
      onClick={() => startRun(null)}
      onFocus={() => {
        mapPillFocused.current = true;
      }}
      onBlur={() => {
        mapPillFocused.current = false;
      }}
    >
      Сверить с лекциями
    </button>
  );
  const whyId = `exam-why-${exam.id}`;
  const showPeak = Boolean(peak) && !rateMode && !selectedRow;
  // The open «почему» has its own filled pill «Ответить на этот вопрос» (not for a question missing from
  // the lectures or being checked): then the sheet's «Тянуть билет» steps down to an outlined pill.
  const whyAnswers = Boolean(selectedRow && selectedRow.coverage !== 'none' && selectedRow.coverage !== 'checking');

  const readiness = (part: 'all' | 'head' | 'rest') => (
    <ReadinessBlock
      part={part}
      summary={summary}
      confirmedShares={confirmed}
      perTicket={perTicket}
      confidence={confidence}
      answers={eventsState}
      answersError={eventsState === 'error' ? eventsError : null}
      filter={filter}
      onFilter={setFilter}
      onRateMode={() => {
        setSelectedId(null);
        setRateMode(true);
      }}
      growth={growthSentence(summary, now)}
      staleLine={staleSentence(summary.stale)}
      secondAnswer={secondAnswer}
    />
  );
  const coverage = (part: 'all' | 'head' | 'rest') => (
    <CoverageSummary
      part={part}
      counts={counts}
      checking={running ? progress ?? { checked: 0, total: questions.length } : null}
      shares={shares}
      closed={closed}
      layout={exam.ticket_layout}
      howOpen={howOpen}
      onHow={() => setHowOpen((open) => !open)}
      howId={`${whyId}-how`}
      onRecheck={recheck}
      filter={filter}
      onFilter={(next) => {
        setRateMode(false);
        setFilter(next);
      }}
      strikeLive={strikeLive}
      seedKey={exam.id}
    />
  );
  const summaryColumn = (
    <>
      {coverage('all')}
      {readiness('all')}
    </>
  );
  // Phones and tablets: only (a) and (b), the short caveat and «Подтверждено ответами» above the
  // sheet, so the paper starts on the first screen; line (c), the action line, the legend and the
  // confidence line go under it.
  const compactColumn = (
    <>
      {coverage('head')}
      {readiness('head')}
    </>
  );
  const rateColumn = (
    <RateSummary
      counts={ratings}
      confidence={confidence}
      answers={eventsState}
      answersError={eventsState === 'error' ? eventsError : null}
      filter={filter}
      onFilter={setFilter}
      onDone={() => {
        setRateMode(false);
        setFilter('all');
      }}
    />
  );
  const peakColumn = peak ? (
    <PeakSummary
      peak={{ ...peak.view, second: secondAnswer }}
      confidence={eventsState === 'ready' && confidence.enoughData ? confidenceSentence(confidence) : null}
      onClose={() => setPeak(null)}
    />
  ) : null;
  const whyPanel = (variant: 'column' | 'sheet') =>
    selectedRow ? (
      <WhyPanel
        key={selectedRow.question.id}
        examId={exam.id}
        question={selectedRow.question}
        number={selectedRow.number}
        coverage={selectedRow.coverage}
        lectureCount={bundle.materials.length}
        examMaterialIds={current}
        answers={answersByHash.get(selectedRow.question.question_hash ?? '') ?? []}
        answersError={eventsState === 'error' ? eventsError : null}
        now={now}
        variant={variant}
        frameBox={frame.box}
        headingId={`${whyId}-title`}
        onClose={closeWhy}
        onManualMark={() => void onManualMark()}
        manualPending={manualPending}
        manualError={manualError}
        onRecheck={recheck}
      />
    ) : null;

  const coverageFilters: Array<{ value: SheetFilter; coverage: SheetCoverage; word: string; count: number }> = [
    { value: 'cov:full', coverage: 'full', word: 'есть в лекциях', count: counts.full },
    { value: 'cov:partial', coverage: 'partial', word: 'частично', count: counts.partial },
    { value: 'cov:none', coverage: 'none', word: 'нет ни в одной', count: counts.none },
    { value: 'cov:unverified', coverage: 'unverified', word: 'только по словам', count: counts.unverified },
    { value: 'cov:unmapped', coverage: 'unmapped', word: 'не сверено', count: counts.unmapped + counts.checking },
  ];
  const sheetTitle = sheetHeader(exam.title, exam.kind);
  const column = selectedRow ? whyPanel('column') : rateMode ? rateColumn : showPeak ? peakColumn : summaryColumn;

  return (
    <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head">
        <div style={{ minWidth: 0 }}>
          <p className="ex-crumb">
            <Link to="/exams">Экзамены</Link>
          </p>
          <h1 className="ex-h1" title={exam.title}>
            {subjectOf(exam.title)}
          </h1>
          <p className="ex-meta">{glue(metaParts.join(' · '))}</p>
          <div className="ex-links">
            {editLocked ? (
              <span className="sf-link" aria-disabled="true" title="Список можно изменить, когда сверка закончится">
                Изменить список
              </span>
            ) : (
              <Link className="sf-link" to={`/exams/${exam.id}/edit`}>
                Изменить список
              </Link>
            )}
            <Link className="sf-link" to={`/exams/${exam.id}/edit#lectures`}>
              Лекции
            </Link>
            <button
              type="button"
              className="sf-link"
              aria-pressed={rateMode}
              onClick={() => {
                setSelectedId(null);
                setRateMode((value) => !value);
                setFilter('all');
              }}
            >
              Самооценка
            </button>
          </div>
        </div>
        {frame.side &&
          (preMapping ? (
            <div className="ex-draw" data-premap="">
              {mapPill}
              <Link className="sf-link ex-draw-alt" to={drawHref} onMouseEnter={preloadTicketScreen} onFocus={preloadTicketScreen}>
                {drawLabel}
              </Link>
            </div>
          ) : (
            <div className="ex-draw">
              {/* While «почему» offers «Ответить на этот вопрос», that is the one filled pill (redesign critique 6). */}
              <Link
                ref={drawPillRef}
                className={whyAnswers ? 'ex-secondary' : 'sf-primary'}
                to={drawHref}
                onMouseEnter={preloadTicketScreen}
                onFocus={preloadTicketScreen}
              >
                {drawLabel}
              </Link>
              <DrawModeMenu variant="popover" mode={drawMode} onChange={setDrawMode} />
            </div>
          ))}
      </header>

      {notes.length > 0 && (
        <div className="ex-notes">
          {notes.map((note) => (
            <p
              key={note.key}
              className="ex-note"
              data-quiet={note.quiet ? '' : undefined}
              role={note.key === 'fail' ? 'alert' : note.status ? 'status' : undefined}
            >
              {glue(note.text)}
              {note.action && (
                <button
                  type="button"
                  className="sf-link"
                  aria-disabled={(note.action.maps && mappingBlocked) || undefined}
                  onClick={note.action.run}
                >
                  {note.action.label}
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      {!frame.side && <section className="ex-col" aria-label="Сводка">{rateMode ? rateColumn : showPeak ? peakColumn : compactColumn}</section>}

      <div className="ex-body">
        <div style={{ minWidth: 0 }}>
          <ul className="ex-filter" aria-label="Показать вопросы">
            <li>
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                <span className="ex-filter-word">Все</span> <span className="ex-count">{counts.total}</span>
              </button>
            </li>
            {coverageFilters
              .filter((item) => showCoverageFilters && (item.count > 0 || item.value === 'cov:full' || item.value === 'cov:partial' || item.value === 'cov:none'))
              .map((item) => {
                const kind = COVERAGE_MARK[item.coverage];
                const size = kind ? COVERAGE_MARK_SIZE[kind] : null;
                const active = filter === item.value;
                return (
                  <li key={item.value}>
                    {/* A status pill in its colour, with the same pencil mark as the rows' pills. */}
                    <button type="button" data-cov={item.coverage} aria-pressed={active} onClick={() => setFilter(active ? 'all' : item.value)}>
                      {kind && size && (
                        <span className="ex-filter-mark" aria-hidden="true">
                          <Mark
                            kind={kind}
                            seed={301 + item.value.length}
                            width={Math.round(size.width * PILL_MARK_SCALE)}
                            height={Math.round(size.height * PILL_MARK_SCALE)}
                            weight={size.weight}
                          />
                        </span>
                      )}
                      <span className="ex-filter-word">{item.word}</span> <span className="ex-count">{item.count}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
          <ExamSheet
            examId={exam.id}
            title={sheetTitle}
            rows={rows}
            sectionTitles={exam.ticket_layout.section_titles ?? []}
            selectedId={selectedId}
            rateMode={rateMode}
            frame={frame.size}
            whyId={whyId}
            onOpen={(id) => {
              setManualError(null);
              setSelectedId((currentId) => (currentId === id ? null : id));
            }}
            onRate={(row, rating) => void onRate(row, rating)}
            onRateDone={() => {
              setRateMode(false);
              setFilter('all');
            }}
            ratingPending={ratingPending}
            ratingErrors={ratingErrors}
            peak={
              peak
                ? ({
                    questionId: peak.questionId,
                    animate: peak.phase === 'draw' && peak.draws,
                    because: peak.because,
                    count: frame.side ? undefined : peakCountLine(peak.view),
                  } satisfies SheetPeak)
                : null
            }
            dim={Boolean(peak?.dim)}
            emptyText={rows.length === 0 ? 'В этом фильтре вопросов нет.' : null}
          />
        </div>
        {frame.side && (
          <aside className="ex-col" aria-label="Что это значит для билетов" id={selectedRow ? whyId : undefined}>
            {column}
          </aside>
        )}
      </div>

      {!frame.side && !rateMode && !showPeak && (
        <section className="ex-col ex-col-after" aria-label="Ответы по билетам">
          {coverage('rest')}
          {readiness('rest')}
        </section>
      )}

      {!frame.side && selectedRow && <div id={whyId}>{whyPanel('sheet')}</div>}

      {!frame.side && (
        <div className="ex-cta">
          {preMapping ? (
            <>
              {mapPill}
              <p className="ex-cta-alt">
                <Link className="sf-link" to={drawHref} onTouchStart={preloadTicketScreen} onFocus={preloadTicketScreen}>
                  {drawLabel}
                </Link>
              </p>
            </>
          ) : (
            <>
              <Link ref={drawPillRef} className="sf-primary" to={drawHref} onTouchStart={preloadTicketScreen} onFocus={preloadTicketScreen}>
                {drawLabel}
              </Link>
              {/* Phones and tablets choose the way of drawing here too (stage QA round 2): a bottom sheet. */}
              <DrawModeMenu
                className="ex-cta-mode"
                variant="sheet"
                mode={drawMode}
                onChange={setDrawMode}
                sheetHost={frame.ref.current}
                frameBox={frame.box}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
