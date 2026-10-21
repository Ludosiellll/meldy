import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
  type TicketLayout,
} from '../api/exams';
import { fetchQuestionEvents, fetchSessionPoints, recordSelfRating, type LearningEvent, type SelfRating as Rating } from '../api/learning';
import { useAuth } from '../hooks/useAuth';
import { checkAILimit, FREE_DAILY_LIMIT, formatLimitReset, nextLimitReset } from '../api/limits';
import { examMappingCost } from '../lib/plans';
import { useConfirm } from '../contexts/ConfirmContext';
import { confidenceVsConfirmed, examSummary, statesByHash, type QuestionState, type Readiness } from '../lib/learning/readiness';
import { percent } from '../lib/exams/ticketMath';
import type { DrawMode } from '../lib/exams/draw';
import { daysUntil, formatClock, formatDay, formatMappedAt, KIND_LABELS, relativeDays, sheetHeader, subjectOf } from '../lib/exams/format';
import { usePrefersReducedMotion } from '../components/landing/usePrefersReducedMotion';
import { Mark } from '../components/marks';
import ExamSheet, { type SheetPeak, type SheetRowView } from '../components/exams/ExamSheet';
import ExamStatusCard, { type StatusNote } from '../components/exams/ExamStatus';
import { allDrawLabel, examStatus, isNothingFound, mappingLimitLine, nextReadyWhen } from '../components/exams/examStatus';
import { useExamLectureFit } from '../components/exams/examLectureFit';
import WhyPanel from '../components/exams/WhyPanel';
import { warmGenericReason } from '../lib/exams/genericReason';
import {
  CoverageSummary,
  PeakSummary,
  PhoneSummary,
  peakCountLine,
  RateSummary,
  ReadinessLegend,
  useShownAfter,
  type PeakView,
} from '../components/exams/SheetSummary';
import { checkedCount, getMapJob, MAPPING_COST, mappingTargets, startMapping, useMapJob, watchMapping, type MapPhase } from '../components/exams/mapJobs';
import { COVERAGE_MARK, COVERAGE_MARK_SIZE, PILL_MARK_SCALE, type SheetCoverage } from '../components/exams/marks';
import {
  peakChange,
  peakText,
  secondAnswerAfterReview,
  secondAnswerSentence,
  secondAnswerSessions,
  takePeakFlags,
  type PeakFlag,
} from '../components/exams/peak';
import { preloadDrawScreen, preloadTicketScreen, whenIdle } from '../components/exams/preload';
import {
  closedPartialShares,
  closePartialLine,
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
  perTicketOf,
  allQuestionsWord,
  shareText,
  questionShareText,
  ratingCounts,
  readinessWords,
  sheetCoverage,
  sheetFilterOf,
  withRatingOverrides,
  type SheetFilter,
} from '../components/exams/sheetModel';
import { useFrame } from '../components/exams/useFrame';
import DrawModeMenu, { DRAW_CAPTIONS } from '../components/exams/DrawModeMenu';
import LearnLeft from '../components/learnLeft/LearnLeft';
import PrepareLine from '../components/learnLeft/PrepareLine';
import { useLearnLeft } from '../api/learnLeft';
import { buildTopics, nextReady, ORAL_IN_PLAN, oralQuestion, oralStateLine, readyNow, type LearnLeftQuestion } from '../lib/containers/topics';
import AnswerTextConsent from '../components/exams/AnswerTextConsent';
import InviteGroup, { InviteGroupDialog } from '../components/exams/share/InviteGroup';
import MoreMenu, { type MoreMenuItem } from '../components/ui/MoreMenu';
import { containerOfExam, containerTitle, onContainerTitles, type AttachedExam } from '../lib/containers/titleCache';
import { usePhone } from '../lib/usePhone';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { setAddressParams } from '../lib/urlState';
import '../styles/paper.css';
import '../components/exams/exams.css';

const DIM_MS = 3000;
const SCROLL_PAUSE_MS = 700;
/** How long the bar at the bottom waits for the first status before it shows «Тянуть билет» anyway (a slow read). */
export const BAR_WAIT_MS = 2000;

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

/**
 * The list's dots follow «Осталось выучить» (decision 2026-10-21, the points rule of the plan and the bot): learned —
 * the ring, started (main points named, waiting for another day) — the line, a miss in the last answer — the wave.
 */
export const LEARN_LABELS: Record<Readiness, string> = {
  confirmed: 'выучен',
  once: 'начат',
  not_passed: 'в прошлый раз ответ был неполным',
  untested: 'ещё не отвечали',
};

function learnReadiness(q: Pick<LearnLeftQuestion, 'state' | 'missed'>): Readiness {
  if (q.state === 3) return 'confirmed';
  if (q.state > 0) return 'once';
  return q.missed ? 'not_passed' : 'untested';
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

/**
 * A phone's meta line (10_Project/Phone_Declutter_2026-10-08): the day, the number of questions and the ticket's size,
 * «21 октября, через 13 дней · 20 вопросов, в билете два» (two lines at 360 px). The kind is named only when it is not
 * an exam; the lectures and the mapping are in «Как считается».
 */
export function phoneMetaLine(kind: keyof typeof KIND_LABELS, examDate: string | null, total: number, layout: TicketLayout, now: Date = new Date()): string {
  const questions = layoutPhrase(total, layout);
  const day = formatDay(examDate, now);
  if (!day) return `${KIND_LABELS[kind]} · ${questions}`;
  const days = daysUntil(examDate, now);
  if (days !== null && days < 0) return `${KIND_LABELS[kind]} прошёл ${day} · ${questions}`;
  const when = `${day}${days === null ? '' : `, ${relativeDays(days)}`}`;
  return `${kind === 'exam' ? when : `${KIND_LABELS[kind]} ${when}`} · ${questions}`;
}

/**
 * A phone's list has no line of lecture and fragment under each question: this line says where they are — once the list
 * is checked against the lectures and something was found there (before, a tap shows no lecture at all).
 */
export const ROW_HINT = 'Нажмите на вопрос — увидите, где он в лекциях';

/** A filter's words: a phone shows `keep` («есть», «нет»), the rest of `word` stays for screen readers. */
function FilterWord({ word, keep }: { word: string; keep: string }) {
  const at = word.indexOf(keep);
  if (keep === word || at < 0) return <span className="ex-filter-word">{word}</span>;
  // The spaces stay outside the hidden words: the accessible name trims a hidden word's own edges («нетни в одной»).
  const before = word.slice(0, at).trim();
  const after = word.slice(at + keep.length).trim();
  return (
    <span className="ex-filter-word">
      {before ? (
        <>
          <span className="ex-filter-long">{before}</span>{' '}
        </>
      ) : null}
      {keep}
      {after ? (
        <>
          {' '}
          <span className="ex-filter-long">{after}</span>
        </>
      ) : null}
    </span>
  );
}

/** What the header says when the daily limit does not cover a mapping run (no dialog: spec 4.6, 5.11). */
export interface MappingLimit {
  remaining: number;
  resetAt: number;
}

/**
 * The exam container this oral exam lives in, as this device knows it (lib/containers/titleCache: the attached exams of
 * the last containers_overview), kept up to date when it arrives later; null for every other exam (spec decision 29).
 */
function useAttachedContainer(examId: string): AttachedExam | null {
  const [attached, setAttached] = useState<AttachedExam | null>(() => containerOfExam(examId));
  useEffect(() => {
    const read = () => {
      const next = containerOfExam(examId);
      setAttached((current) => (current?.containerId === next?.containerId && current?.title === next?.title ? current : next));
    };
    read();
    return onContainerTitles(read);
  }, [examId]);
  return attached;
}

/** One page state per exam: opening another exam's sheet starts from scratch. */
export default function ExamDetail() {
  const { id: examId = '' } = useParams();
  return <ExamSheetPage key={examId} examId={examId} />;
}

function ExamSheetPage({ examId }: { examId: string }) {
  const { user } = useAuth();
  // /exams/:id?filter=cov:none opens the sheet filtered (the «Сегодня» link «9 вопросов без материала»);
  // anything that is not a known filter shows every question. The sheet keeps its filter and the question open in
  // its panel in the address as they change (?filter=, ?open=; written quietly), so a reload and «Назад» find them.
  const [searchParams] = useSearchParams();
  const [openedFilter] = useState<SheetFilter>(() => sheetFilterOf(searchParams.get('filter')));
  const userId = user?.id ?? null;
  const { confirm } = useConfirm();
  const reduced = usePrefersReducedMotion();
  // Inside an exam container (decision 29б, 38): the crumb leads to it, and its own group link covers this exam.
  const attached = useAttachedContainer(examId);
  const frame = useFrame<HTMLDivElement>();
  // A phone (max-width 639px): the page keeps one line of each thing and moves the rest behind «Как считается» and
  // «Ещё» (10_Project/Phone_Declutter_2026-10-08). Tablets and computers are as they were.
  const phone = usePhone();
  const job = useMapJob(examId);

  const [bundle, setBundle] = useState<ExamBundle | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  // The tab is named as the page's heading: the subject («Базы данных»).
  useDocumentTitle(bundle ? subjectOf(bundle.exam.title) : null);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SheetFilter>(openedFilter);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('open'));
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
  // «Ответить на этот вопрос» of the open «почему» is in the window (WhyPanel watches it): only then the status's pill
  // steps down to white — with the panel's pill out of view the page had no blue pill at all (audit 2026-10-08).
  const [whyGoVisible, setWhyGoVisible] = useState(true);
  // «Пригласить группу» opened from a phone's «⋯»; the focus goes back to «⋯» when it closes.
  const [inviteOpen, setInviteOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // A phone: «Обозначения» over the list opens the key to the number circles (the readiness legend).
  const [keysOpen, setKeysOpen] = useState(false);
  // «Сверить с лекциями» had the focus when its run started: the focus goes to the status that replaces it.
  const mapPillFocused = useRef(false);
  const drawPillRef = useRef<HTMLAnchorElement>(null);
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
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

  // The expressions that hide a generic reason in the why panel are built while the sheet stands idle, not on the
  // first tap on a question (smoothness audit 20.10).
  useEffect(() => whenIdle(warmGenericReason), []);

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

  // ------------------------------------------------------------------ what is left to learn
  // One read (public.learn_left), with the page's other reads: the topics card, the dots of the list and the status's
  // «Сегодня можно выучить 3 вопроса». A mapping run that ended, or points written, change it: it is read again.
  const learn = useLearnLeft(userId ? [examId] : [], Boolean(userId));
  const learnExam = learn.exams.find((item) => item.examId === examId) ?? null;
  const topicList = useMemo(() => (learnExam ? buildTopics({ oral: learnExam }) : null), [learnExam]);
  const learnReload = learn.reload;
  const learnRunSeq = useRef(job.finishedSeq);
  useEffect(() => {
    if (job.finishedSeq === learnRunSeq.current) return;
    learnRunSeq.current = job.finishedSeq;
    learnReload();
  }, [job.finishedSeq, learnReload]);
  const learnNow = useMemo(() => Date.now(), [learnExam]);
  const learnFacts = useMemo(() => {
    if (!learnExam) return null;
    const inPlan = learnExam.questions.filter((q) => ORAL_IN_PLAN.has(q.kind));
    return {
      byId: new Map(learnExam.questions.map((q) => [q.id, q])),
      ready: readyNow(learnExam, learnNow),
      next: nextReady(learnExam, learnNow),
      learned: inPlan.filter((q) => q.state === 3).length,
      inPlan: inPlan.length,
    };
  }, [learnExam, learnNow]);

  // «почему» says where the question stands by the same rule as its dot (nothing for a question not counted).
  const whyStateLine = (id: string): string | null | undefined => {
    const fact = learnFacts?.byId.get(id);
    if (!fact) return undefined;
    return ORAL_IN_PLAN.has(fact.kind) ? oralStateLine(oralQuestion(fact), learnNow) || null : null;
  };

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
        // The dots follow «Осталось выучить» (decision 2026-10-21): learned, started, a miss last time, not yet.
        const fact = learnFacts?.byId.get(question.id);
        const readiness = fact ? learnReadiness(fact) : 'untested';
        return {
          question,
          number: numberOf(question),
          coverage,
          readiness,
          readinessWords: readiness === 'untested' ? undefined : LEARN_LABELS[readiness],
          selfRating: state?.selfRating ?? null,
          footnote: footnoteOf(question),
          // Only a judgement arriving now is drawn in; marks of a finished or earlier run are simply there.
          appearance: running ? job.marks.get(question.id) ?? null : null,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, states, checkingIds, job.marks, running, learnFacts],
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
  // The same layout with every «частично» closed: «7 вопросов «частично»: добавьте к ним материал — …».
  const closed = useMemo(() => closedPartialShares(shareSubjects, layout), [shareSubjects, layout]);
  const hashes = useMemo(() => questions.map(hashKey), [questions]);
  const summary = useMemo(() => examSummary(hashes, states), [hashes, states]);
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

  // ------------------------------------------------------------------ after an answer
  // The flags a saved answer left are taken, so they never replay later; what the answer changed is in the topics card
  // («Осталось выучить») and the answer's own protocol.
  useEffect(() => {
    peakFlags.current = null;
  }, []);

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

  // ------------------------------------------------------------------ the mapping, as the status says it
  // A run of this tab or another one is going on (the short limit check before a run is not: the
  // action that asked for it stays where it is, so the focus is not lost).
  const busy = running || job.phase === 'waiting';
  const examRow = bundle?.exam ?? null;
  const progress = checkedCount(job);
  const staleRun = Boolean(examRow && examFresh && !busy && examRow.mapping_state === 'running' && !isMappingLocked(examRow));
  const mappedCount = questions.filter((question) => question.coverage !== null).length;
  // Marks a mapping run wrote (a mark made by hand is not a run).
  const runMarks = questions.filter((question) => question.coverage !== null && question.coverage_method !== 'manual').length;
  // What happened to this tab's run on this visit (the database says the rest).
  const outcome = ownRun && !running ? job.phase : null;
  const outcomeNote = outcome === 'interrupted' || (outcome === 'failed' && Boolean(job.message));
  // Until the exam row is read again after a run, its date is the one the run reported.
  const mappedAt = !examFresh && ownRun && job.done?.mappedAt ? job.done.mappedAt : examRow?.mapped_at ?? null;
  // A first run that stopped half-way on an earlier visit: marks, but no date of a finished mapping.
  const stoppedEarlier = Boolean(examRow) && !busy && !outcomeNote && !staleRun && !mappedAt && runMarks > 0 && mappedCount < questions.length;
  const interrupted = (outcome === 'interrupted' && mappedCount < questions.length) || staleRun || stoppedEarlier;
  const mappingPhase = running
    ? 'running'
    : job.phase === 'waiting'
      ? 'waiting'
      : outcome === 'failed' && job.message
        ? 'failed'
        : interrupted
          ? 'interrupted'
          : 'idle';
  const mappingProgress = running || outcome === 'interrupted' ? progress : interrupted ? { checked: runMarks, total: questions.length } : null;
  // Lectures added to the exam or taken out of it since the last finished run (the run's own visit excepted).
  const lecturesChange = useMemo(() => {
    if (!bundle || !bundle.exam.mapped_at || running || !examFresh) return { added: 0, removed: 0 };
    const mapped = new Set(bundle.exam.mapped_material_ids);
    const current = new Set(bundle.materialIds);
    return {
      added: bundle.materialIds.filter((id) => !mapped.has(id)).length,
      removed: bundle.exam.mapped_material_ids.filter((id) => !current.has(id)).length,
    };
  }, [bundle, running, examFresh]);
  // What the next run costs: 10 units for every started 40 questions that go to the model (the rest is free).
  const nextRunCost = bundle
    ? examMappingCost(mappingTargets({ questions: bundle.questions, materialIds: bundle.materialIds, mappedMaterialIds: bundle.exam.mapped_material_ids }))
    : 0;

  // ------------------------------------------------------------------ the status at the top (owner, 2026-10-07)
  // What Meldy did with this exam, what it found and the one thing to do next (components/exams/examStatus.ts).
  const drawLabel = bundle && bundle.exam.ticket_layout.per_ticket <= 1 && bundle.exam.ticket_layout.mode !== 'fixed' ? 'Тянуть вопрос' : 'Тянуть билет';
  const nothingFound = Boolean(bundle) && isNothingFound({ total: questions.length, lectures: bundle?.materials ?? [], coverage: counts });
  const fitQuestionTexts = useMemo(() => (bundle?.questions ?? []).map((question) => question.text), [bundle?.questions]);
  const lectureFit = useExamLectureFit({ userId, wanted: nothingFound, questions: fitQuestionTexts, own: bundle?.materialIds ?? [] });
  const answered = summary.confirmed + summary.once + summary.notPassed;
  const pageStatus = bundle
    ? examStatus({
        total: questions.length,
        lectures: bundle.materials,
        copy: bundle.copy === true,
        coverage: counts,
        mapping: {
          phase: mappingPhase,
          progress: mappingProgress,
          message: job.message,
          added: lecturesChange.added,
          removed: lecturesChange.removed,
          cost: nextRunCost,
          limit: limit ? { remaining: limit.remaining, resetAt: formatClock(new Date(limit.resetAt).toISOString()) } : null,
        },
        learn: {
          state: learn.status === 'error' ? 'error' : learnFacts || learn.status === 'ready' ? 'ready' : 'loading',
          ready: learnFacts?.ready.length ?? 0,
          nextReady: learnFacts ? nextReadyWhen(learnFacts.next, learnNow) : null,
          learned: learnFacts?.learned ?? 0,
          inPlan: learnFacts?.inPlan ?? 0,
        },
        answers: { state: eventsState, answered, untested: summary.untested, confirmed: summary.confirmed },
        drawLabel,
        lectureFit,
      })
    : null;
  const hideShare = pageStatus?.hideCoverage ?? false;
  // The bar at the bottom of a phone or a tablet waits for the first status while what is left and the answers are
  // read: it stood as «Тянуть билет» with «Как на экзамене · изменить» and turned into «Тянуть билет из 4 вопросов»
  // or another action half a second later. The bar keeps its room (nothing moves); a slow read shows it after
  // BAR_WAIT_MS as before; a later read (after a run, a retry) leaves it in place.
  const statusLoading = pageStatus?.key === 'loading';
  const statusKnown = pageStatus !== null && !statusLoading;
  const [statusSeen, setStatusSeen] = useState(false);
  useEffect(() => {
    if (statusKnown) setStatusSeen(true);
  }, [statusKnown]);
  const firstRead = statusLoading && !statusSeen;
  const barLate = useShownAfter(firstRead, BAR_WAIT_MS);
  const barWaits = firstRead && !barLate;


  // ------------------------------------------------------------------ actions
  /*
   * The daily limit is checked before a run. When it does not cover the run, the header says so and
   * every mapping action stays where it is but unavailable — no dialog, and the focus is not lost
   * (redesign spec 4.6 and 5.11, stage QA round 2). An unreadable limit never blocks the work.
   */
  const verifyMappingLimit = useCallback(async (uid: string, cost: number): Promise<boolean> => {
    const status = await checkAILimit(uid, cost);
    // PRO is limited too (1000 units a day); the server decides in the end and refuses with ai_limit.
    if (!status.ok || status.allowed) {
      setLimit(null);
      return true;
    }
    const dayLimit = Number(status.limit) || FREE_DAILY_LIMIT;
    const resetAt = status.resetsAt instanceof Date ? status.resetsAt : nextLimitReset();
    setLimit({ remaining: Math.max(0, dayLimit - (Number(status.count) || 0)), resetAt: resetAt.getTime() });
    return false;
  }, []);

  // The limit is renewed at 00:00 UTC: the actions come back by themselves.
  useEffect(() => {
    if (!limit) return;
    const timer = window.setTimeout(() => setLimit(null), Math.max(0, Math.min(limit.resetAt - Date.now() + 1000, 2_147_000_000)));
    return () => window.clearTimeout(timer);
  }, [limit]);

  const mappingBlocked = Boolean(limit) || job.starting;
  // When «Сверить с лекциями» leaves the page with the focus on it (its run started), the focus goes to the
  // status's headline, which now says «Meldy сверяет вопросы с лекциями» — never to the page's body.
  const mapPillRef = useCallback((element: HTMLButtonElement | null) => {
    if (element || !mapPillFocused.current) return;
    mapPillFocused.current = false;
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) (statusHeadingRef.current ?? drawPillRef.current)?.focus();
    }, 0);
  }, []);
  const startRun = useCallback(
    (questionIds: string[] | null = null) => {
      if (!userId || limit || getMapJob(examId).starting) return;
      // The units are checked only when questions will go to the model: a group link's copy, all checked already,
      // was held back by «10 единиц» for a run the server did for free (live run of 2026-10-07).
      const needsModel = bundle
        ? mappingTargets({ questions: bundle.questions, materialIds: bundle.materialIds, mappedMaterialIds: bundle.exam.mapped_material_ids }, questionIds) > 0
        : true;
      void startMapping({ examId, userId, questionIds, verifyEnergy: verifyMappingLimit, cost: needsModel ? MAPPING_COST : 0 });
    },
    [examId, userId, limit, verifyMappingLimit, bundle],
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

  useEffect(() => {
    setAddressParams({ filter: filter === 'all' ? null : filter });
  }, [filter]);
  // The question named by the address opens once the sheet has it; one the exam no longer has is left out.
  const sheetReady = status === 'ready';
  useEffect(() => {
    if (!sheetReady) return;
    if (selectedId && !selectedRow) {
      setSelectedId(null);
      return;
    }
    setAddressParams({ open: selectedId });
  }, [sheetReady, selectedId, selectedRow]);

  const closeWhy = useCallback(() => {
    const id = selectedId;
    setSelectedId(null);
    setManualError(null);
    if (id) {
      window.setTimeout(() => {
        const row = document.getElementById(`exam-q-${id}`)?.querySelector<HTMLButtonElement>('.ex-open');
        (row ?? document.getElementById(`cs-q-${id}`)?.querySelector<HTMLButtonElement>('.cs-qbtn'))?.focus();
      }, 0);
    }
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
  if (status === 'missing' || status === 'error' || !bundle || !pageStatus) {
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
  const copy = bundle.copy === true;
  const perTicket = exam.ticket_layout.per_ticket;
  const drawHref = `/exams/${exam.id}/draw${drawMode === 'exam' ? '' : `?mode=${drawMode}`}`;

  let mappingMeta: string;
  if (running) mappingMeta = progress ? `проверено ${progress.checked} из ${progress.total}` : 'сверка идёт';
  else if (job.phase === 'waiting') mappingMeta = 'сверка ещё идёт';
  // A copy from a group link: the author checked it; the member's own page does not speak of a mapping.
  else if (copy && mappingPhase === 'idle' && lecturesChange.added + lecturesChange.removed === 0) mappingMeta = 'копия из ссылки группы';
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

  const current = new Set(bundle.materialIds);
  const reusedPart =
    outcome === 'done' && job.done && job.done.reused > 0 && job.received > job.done.reused && job.done.oldestMappedAt
      ? `Часть сверки от ${formatClock(job.done.oldestMappedAt)}, остальное сейчас.`
      : null;
  const skippedLectures = ownRun ? job.start?.skipped.filter((item) => item.reason === 'no_text').length ?? 0 : 0;

  // Quiet lines under the status: what a run left behind, a journal that did not load.
  const statusNotes: StatusNote[] = [];
  if (job.failedMessage && running) statusNotes.push({ key: 'batch', text: `${job.failedMessage}.` });
  if (reusedPart) statusNotes.push({ key: 'reused', text: reusedPart });
  if (skippedLectures > 0) statusNotes.push({ key: 'notext', text: `${lecturesPhrase(skippedLectures)} без текста не ${skippedLectures === 1 ? 'учтена' : 'учтены'}.` });
  if (limit && !pageStatus.blocked) statusNotes.push({ key: 'limit', text: mappingLimitLine({ remaining: limit.remaining, resetAt: formatClock(new Date(limit.resetAt).toISOString()) }, nextRunCost), live: true });
  if (eventsState === 'error' && eventsError) statusNotes.push({ key: 'events', text: eventsError, action: { label: 'Повторить', run: () => void loadEvents(bundle.questions) } });

  const editLocked = running || job.phase === 'waiting' || (examFresh && exam.mapping_state === 'running' && isMappingLocked(exam));
  // Only «Все 40» until something is mapped: three filters showing 0 said nothing (redesign critique 7). A phone shows no
  // filter with 0 at all (its row is one line; the chosen one stays).
  const showCoverageFilters = mappedCount > 0 || running;
  // A phone with an empty list: the heading, the status and its button — nothing that would only say «0».
  const phoneEmpty = phone && questions.length === 0;
  const whyId = `exam-why-${exam.id}`;
  const showPeak = Boolean(peak) && !rateMode && !selectedRow;
  // The open «почему» has its own filled pill «Ответить на этот вопрос» (not for a question missing from
  // the lectures or being checked): while it is in the window the status's action steps down to an outlined pill.
  const whyAnswers = Boolean(selectedRow && selectedRow.coverage !== 'none' && selectedRow.coverage !== 'checking' && whyGoVisible);

  // The column: nothing that says nothing (owner, 2026-10-07). The ticket share only once something is found; the
  // answers only once there are answers; confidence vs answers only after «Самооценка».
  const showCoverage = !pageStatus.hideCoverage;
  // The key to the dots counts them as the list shows them («Осталось выучить»'s rule).
  const dotCounts: Record<Readiness, number> = { confirmed: 0, once: 0, not_passed: 0, untested: 0 };
  for (const row of allRows) dotCounts[row.readiness] += 1;
  const dotsShown = allRows.some((row) => row.readiness !== 'untested');
  const selfRated = ratings.know + ratings.unsure + ratings.dont_know > 0;
  const closeLine = showCoverage ? closePartialLine(counts.partial, shares, closed) : null;

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
      filter={filter}
      onFilter={(next) => {
        setRateMode(false);
        setFilter(next);
      }}
    />
  );
  // «Осталось выучить» heads the column (it took the place of «Подтверждено ответами»); the ticket share under it. Not while
  // the list is empty, unchecked or in no lecture: the status says that, and the card would say nothing more.
  const textById = new Map(bundle.questions.map((question) => [question.id, question.text]));
  let zone = 'Europe/Minsk';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone;
  } catch {
    // The plan's default zone.
  }
  const learnShown = Boolean(topicList) ? topicList!.topics.length > 0 || topicList!.noLectures : learn.status !== 'ready' && mappedCount > 0;
  const learnCard =
    questions.length > 0 && !pageStatus.quietGaps && learnShown ? (
      <LearnLeft
        list={topicList}
        status={learn.status}
        now={learnNow}
        tz={zone}
        phone={phone}
        answerHref={(q) => `/exams/${exam.id}/ticket?q=${encodeURIComponent(q.id)}`}
        questionText={(q) => textById.get(q.id) ?? ''}
        lecturesHref={`/exams/${exam.id}/edit#lectures`}
        prepare={
          learnExam && learnExam.toWrite > 0 && !copy ? (
            <PrepareLine examId={exam.id} toWrite={learnExam.toWrite} units={learnExam.units} onDone={learnReload} />
          ) : null
        }
        onRetry={learnReload}
      />
    ) : null;
  // The key to the dots, once answers marked them: its rows filter the list. After «Самооценка», how sure you were
  // against your answers. A phone opens the key from «Обозначения» over the list instead.
  const dotsBlock =
    !phone && (dotsShown || (eventsState === 'ready' && selfRated)) ? (
      <div className="ex-blk ex-dots">
        {dotsShown && (
          <ReadinessLegend
            counts={dotCounts}
            labels={LEARN_LABELS}
            filter={filter}
            onFilter={(next) => {
              setRateMode(false);
              setFilter(next);
            }}
          />
        )}
        {eventsState === 'ready' && selfRated && (
          <p className="ex-fine ex-dots-sure">
            {glue(confidenceSentence(confidence))}{' '}
            <button
              type="button"
              className="sf-link"
              data-stage-hide=""
              onClick={() => {
                setSelectedId(null);
                setRateMode(true);
              }}
            >
              Самооценка
            </button>
          </p>
        )}
      </div>
    ) : null;
  const summaryColumn =
    learnCard || showCoverage || dotsBlock ? (
      <>
        {learnCard}
        {showCoverage && coverage('all')}
        {dotsBlock}
      </>
    ) : null;
  // Phones and tablets: the figure with «Как считается» and «Подтверждено ответами» above the sheet, so the
  // paper starts on the first screen; the action line and the readiness legend go under it. A phone: the figure and
  // the answers' count as two lines; everything else — the lectures and the mapping of the meta line, the action
  // line, the formulas, what «подтверждено» means and the legend — behind «Как считается».
  const compactColumn =
    showCoverage ? (
      phone ? (
        <PhoneSummary
          coverage={showCoverage ? { counts, shares, closed, layout: exam.ticket_layout } : null}
          readiness={null}
          facts={`${lecturesPhrase(bundle.materials.length)} · ${mappingMeta}`}
          filter={filter}
          onFilter={(next) => {
            setRateMode(false);
            setFilter(next);
          }}
          open={howOpen}
          onToggle={() => setHowOpen((open) => !open)}
          id={`${whyId}-how`}
        />
      ) : (
        <>{showCoverage && coverage('head')}</>
      )
    ) : null;
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
        stateLine={whyStateLine(selectedRow.question.id)}
        now={now}
        variant={variant}
        frameBox={frame.box}
        headingId={`${whyId}-title`}
        onClose={closeWhy}
        onManualMark={() => void onManualMark()}
        manualPending={manualPending}
        manualError={manualError}
        onRecheck={recheck}
        onAnswerVisible={setWhyGoVisible}
      />
    ) : null;

  // `keep`: the words a phone shows, so the filter is one line (the rest stays for screen readers); its pencil marks are
  // the key to the marks at the rows' ends.
  const coverageFilters: Array<{ value: SheetFilter; coverage: SheetCoverage; word: string; keep: string; count: number }> = [
    { value: 'cov:full', coverage: 'full', word: 'есть в лекциях', keep: 'есть', count: counts.full },
    { value: 'cov:partial', coverage: 'partial', word: 'частично', keep: 'частично', count: counts.partial },
    { value: 'cov:none', coverage: 'none', word: 'нет ни в одной', keep: 'нет', count: counts.none },
    { value: 'cov:unverified', coverage: 'unverified', word: 'только по словам', keep: 'по словам', count: counts.unverified },
    { value: 'cov:unmapped', coverage: 'unmapped', word: 'не сверено', keep: 'не сверено', count: counts.unmapped + counts.checking },
  ];
  const sheetTitle = sheetHeader(exam.title, exam.kind);
  const column = selectedRow ? whyPanel('column') : rateMode ? rateColumn : showPeak ? peakColumn : summaryColumn;

  // The column offers its own filled pill («Ответить на этот вопрос»): the status's action steps down to the white pill.
  const drawSteps = whyAnswers;
  const sideColumn = column;

  // ------------------------------------------------------------------ the status's action
  // The one filled pill of the page: in the status block beside its words (1024 px and wider), in the bar at the
  // bottom on phones and tablets. «Тянуть билет» is that pill only when answering is the next step; otherwise a
  // quiet link beside the action.
  const action = pageStatus.action;
  const pillClass = drawSteps ? 'ex-secondary' : 'sf-primary';
  const mapsBlocked = mappingBlocked || Boolean(pageStatus.blocked);
  let primary: ReactNode = null;
  if (action) {
    switch (action.kind) {
      case 'map':
      case 'recheck':
        primary = (
          <button
            ref={mapPillRef}
            type="button"
            className={pillClass}
            aria-disabled={mapsBlocked || undefined}
            aria-busy={job.starting || undefined}
            onClick={() => startRun(action.kind === 'recheck' ? unverifiedIds : null)}
            onFocus={() => {
              mapPillFocused.current = true;
            }}
            onBlur={() => {
              mapPillFocused.current = false;
            }}
          >
            {action.label}
          </button>
        );
        break;
      case 'lectures':
        primary = (
          <Link className={pillClass} to={`/exams/${exam.id}/edit#lectures`}>
            {action.label}
          </Link>
        );
        break;
      case 'list':
        primary = (
          <Link className={pillClass} to={`/exams/${exam.id}/edit`}>
            {action.label}
          </Link>
        );
        break;
      case 'awaiting':
        primary = (
          <Link className={pillClass} to={`/exams/${exam.id}/draw?mode=awaiting`} onMouseEnter={preloadTicketScreen} onFocus={preloadTicketScreen} onTouchStart={preloadTicketScreen}>
            {action.label}
          </Link>
        );
        break;
      case 'draw':
        primary = (
          <Link ref={drawPillRef} className={pillClass} to={drawHref} onMouseEnter={preloadTicketScreen} onFocus={preloadTicketScreen} onTouchStart={preloadTicketScreen}>
            {action.label}
          </Link>
        );
        break;
    }
  }
  const drawsFirst = action?.kind === 'draw';
  // «Тянуть билет» stepped down: answering is possible, just not the next step.
  const quietDraw =
    pageStatus.draw && !drawsFirst ? (
      <Link className="sf-link ex-st-alt" to={drawHref} onMouseEnter={preloadTicketScreen} onFocus={preloadTicketScreen} onTouchStart={preloadTicketScreen}>
        {drawLabel}
      </Link>
    ) : null;
  // A phone whose bar at the bottom draws already («Тянуть билет из них»): no second «Тянуть билет» in the status
  // (10_Project/Phone_Declutter_2026-10-08); the plain draw is the first item of «Ещё».
  const drawInMore = phone && quietDraw !== null && action?.kind === 'awaiting';
  const statusActions = frame.side ? (
    primary || quietDraw ? (
      <div className="ex-draw">
        {primary}
        {drawsFirst && <DrawModeMenu variant="popover" mode={drawMode} onChange={setDrawMode} />}
        {quietDraw}
      </div>
    ) : null
  ) : drawInMore ? null : (
    quietDraw
  );

  // Tablets: «Изменить список · Лекции · Самооценка · Пригласить группу · Отчёт для преподавателя» took three or four
  // rows above the status (audit 2026-10-08); they go under the list, as under the paper on «Шпаргалка». A phone has
  // them in the «⋯» of the heading.
  const linksBelow = !frame.side && !phone && frame.size === 's';
  const startRate = () => {
    setSelectedId(null);
    setFilter('all');
    // From the links under the list, or a phone's «⋯» at the top: the list's top, with its «Отметьте…» line, comes into view.
    if ((linksBelow || phone) && !rateMode) {
      window.setTimeout(() => document.querySelector('.ex-sheet')?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }), 0);
    }
    setRateMode((value) => !value);
  };
  // A phone: the five links as one round «⋯» on the heading's row, as on a lecture (10_Project/Phone_Declutter_2026-10-08;
  // under the list a newcomer did not find «Изменить список» or «Пригласить группу»). «Изменить список» is left out for a
  // group link's copy and while a mapping holds the list (the status says it is running).
  const moreItems: MoreMenuItem[] = [
    ...(drawInMore ? [{ key: 'draw', label: allDrawLabel(drawLabel), to: drawHref }] : []),
    ...(copy || editLocked ? [] : [{ key: 'edit', label: 'Изменить список', to: `/exams/${exam.id}/edit` }]),
    { key: 'lectures', label: 'Лекции', to: `/exams/${exam.id}/edit#lectures` },
    { key: 'rate', label: rateMode ? 'Закончить самооценку' : 'Самооценка', onSelect: startRate },
    ...(copy || attached ? [] : [{ key: 'invite', label: 'Пригласить группу', onSelect: () => setInviteOpen(true) }]),
    { key: 'report', label: 'Отчёт для преподавателя', to: `/exams/${exam.id}/report` },
  ];
  const moreMenu = (
    <div className="ex-more" ref={moreRef}>
      <MoreMenu items={moreItems} label="Ещё: лист экзамена" variant="round" />
    </div>
  );
  const examLinks = (
    <div className="ex-links">
      {/* A copy from a group link: its list is the author's (the member keeps «Лекции» to add their own). */}
      {copy ? null : editLocked ? (
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
      <button type="button" className="sf-link" aria-pressed={rateMode} onClick={startRate}>
        Самооценка
      </button>
      {/* «Группа по ссылке»: the author's link for the group (components/exams/share/InviteGroup); a copy is not
          shared on (the server refuses it: is_copy), and an exam inside a container is shared by the container's link
          (decision 38: never two links). */}
      {copy || attached ? null : <InviteGroup examId={exam.id} examTitle={exam.title} />}
      {/* The mapping as a page to print for the department, and a CSV (pages/ExamReport.tsx). */}
      <Link className="sf-link" to={`/exams/${exam.id}/report`}>
        Отчёт для преподавателя
      </Link>
    </div>
  );

  // Phones and tablets under the sheet: the action line of the share and the readiness legend, when there are any.
  // A phone has them behind «Как считается» (PhoneSummary) and «Обозначения».
  const answersBelow = !frame.side && !phone && !rateMode && !showPeak && (Boolean(closeLine) || Boolean(dotsBlock));
  // Phones and tablets: the topics card (rows folded on a phone) over the list, then the share.
  const topColumn = rateMode ? rateColumn : showPeak ? peakColumn : learnCard || compactColumn ? (
    <>
      {learnCard}
      {compactColumn}
    </>
  ) : null;

  // A phone: the line over the list says that a question opens its place in the lectures — once something was found
  // there (before a mapping, or for a list in no lecture, a tap shows none). «Обозначения» at its end opens the key to
  // the number circles, once answers have marked them; its rows still filter the list.
  const foundInLectures = counts.full + counts.partial + counts.unverified > 0;
  const rowHint = phone && !rateMode && rows.length > 0 && foundInLectures ? ROW_HINT : null;
  const keysShown = phone && !rateMode && dotsShown;
  const keysId = `${whyId}-keys`;
  const keysLink = keysShown ? (
    <button
      type="button"
      className="sf-link ex-keys-link"
      data-muted=""
      aria-expanded={keysOpen}
      aria-controls={keysOpen ? keysId : undefined}
      onClick={() => setKeysOpen((open) => !open)}
    >
      Обозначения
    </button>
  ) : null;
  const keysPanel =
    keysShown && keysOpen ? (
      <div className="ex-keys" id={keysId}>
        <ReadinessLegend counts={dotCounts} labels={LEARN_LABELS} filter={filter} onFilter={setFilter} />
      </div>
    ) : null;

  const subject = subjectOf(exam.title);
  // A phone sizes the heading to its longest word, which must fit beside the «⋯» (exams.css, .ex-titlerow).
  const longestWord = Math.max(1, ...subject.split(/\s+/).map((word) => word.length));
  const heading = (
    <h1 className="ex-h1" title={exam.title} style={phone ? ({ '--ex-h1-word': longestWord } as CSSProperties) : undefined}>
      {subject}
    </h1>
  );

  return (
    <div className="sf-page ex-detail" ref={frame.ref} data-frame={frame.size} data-view="questions">
      <header className="ex-head">
        <div style={{ minWidth: 0 }}>
          <p className="ex-crumb">
            {/* An exam inside a container: the way back is to that exam (decision 29б); every other exam, «Экзамены». */}
            {attached ? (
              <Link to={`/exams/c/${encodeURIComponent(attached.containerId)}`}>{containerTitle(attached.containerId) ?? attached.title}</Link>
            ) : (
              <Link to="/exams">Экзамены</Link>
            )}
          </p>
          {/* A phone: the heading and the round «⋯» of the page's other links on one row, as on a lecture. */}
          {phone && !phoneEmpty ? (
            <div className="ex-titlerow">
              {heading}
              {moreMenu}
            </div>
          ) : (
            heading
          )}
          {/* A phone: the day, the number of questions and the ticket's size, on both views (an empty list: none of it). A
              tablet's sheet: the day of the exam only, so the paper's lines are on the first screen («Вопросы» says the rest). */}
          {phoneEmpty ? null : (
            <p className="ex-meta">
              {glue(
                phone
                  ? phoneMetaLine(exam.kind, exam.exam_date, questions.length, exam.ticket_layout)
                  : metaParts.join(' · '),
              )}
            </p>
          )}
          {/* A tablet's sheet: the status and the list on the first screen; these links go under them. */}
          {!linksBelow && !phone && examLinks}
        </div>
      </header>

      {/* What Meldy did, what it found, the one thing to do next — above everything that details it. */}
      <ExamStatusCard ref={statusHeadingRef} id={`ex-st-${exam.id}`} status={pageStatus} actions={statusActions} notes={statusNotes} brief={phone} />

      {!frame.side && !phoneEmpty && topColumn && (
        <section className="ex-col" aria-label="Сводка">
          {topColumn}
        </section>
      )}

      {phoneEmpty ? null : (
        <div className="ex-body" data-solo={frame.side && !sideColumn ? '' : undefined}>
          <div style={{ minWidth: 0 }}>
            <div className="ex-viewbar">
              {(
                <ul className="ex-filter" aria-label="Показать вопросы">
                  <li>
                    <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                      <span className="ex-filter-word">Все</span> <span className="ex-count">{counts.total}</span>
                    </button>
                  </li>
                  {coverageFilters
                    .filter(
                      (item) =>
                        showCoverageFilters &&
                        (phone
                          ? item.count > 0 || filter === item.value
                          : item.count > 0 || item.value === 'cov:full' || item.value === 'cov:partial' || item.value === 'cov:none'),
                    )
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
                            <FilterWord word={item.word} keep={item.keep} /> <span className="ex-count">{item.count}</span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
            <div>
              {(
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
                  emptyText={rows.length === 0 ? (questions.length === 0 ? 'В списке пока нет вопросов.' : 'В этом фильтре вопросов нет.') : null}
                  hint={rowHint && keysLink ? `${rowHint}.` : rowHint}
                  hintAction={keysLink}
                  hintPanel={keysPanel}
                />
              )}
            </div>
          </div>
          {frame.side && sideColumn && (
            <aside className="ex-col" aria-label="Что осталось выучить и что это значит для билетов" id={selectedRow ? whyId : undefined}>
              {sideColumn}
            </aside>
          )}
        </div>
      )}

      {answersBelow && (
        <section className="ex-col ex-col-after" aria-label="Ответы по билетам">
          {closeLine && coverage('rest')}
          {dotsBlock}
        </section>
      )}

      {linksBelow && <div className="ex-col-after ex-links-after">{examLinks}</div>}

      {!frame.side && selectedRow && <div id={whyId}>{whyPanel('sheet')}</div>}

      {phoneEmpty ? null : <AnswerTextConsent ready short={phone} />}

      {inviteOpen && (
        <InviteGroupDialog
          examId={exam.id}
          examTitle={exam.title}
          onClose={() => {
            setInviteOpen(false);
            window.setTimeout(() => moreRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
          }}
        />
      )}

      {!frame.side && primary && (
        <div className="ex-cta" data-wait={barWaits ? '' : undefined}>
          {primary}
          {/* Phones and tablets choose the way of drawing here too (stage QA round 2): a bottom sheet. */}
          {drawsFirst && (
            <DrawModeMenu className="ex-cta-mode" variant="sheet" mode={drawMode} onChange={setDrawMode} sheetHost={frame.ref.current} frameBox={frame.box} />
          )}
        </div>
      )}
    </div>
  );
}
