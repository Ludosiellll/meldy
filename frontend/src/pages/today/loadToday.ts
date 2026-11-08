import { supabase } from '../../lib/supabase';
import { countDueCards, getDueCards, type DueCard } from '../../api/flashcards';
import { fetchQuestionEvents, type LearningEvent } from '../../api/learning';
import { normalizeExam, type ExamKind, type ExamRow, type TicketLayout } from '../../api/exams';
import { daysUntil } from '../../lib/exams/format';
import type { SheetCoverage } from '../../components/exams/marks';
import { isDateKey } from '../../utils/streak';
import { pickExam } from '../../lib/exams/leading';
import type { StudySession } from '../../types';
import { layerKey, type ContainerLayer } from '../containerLayer';

/**
 * What «Сегодня» reads (pages/Dashboard.tsx shows it): the lectures, the due cards and the days of review, the leading
 * oral exam with its questions and answers, and «Первые шаги». Moved out of the page as it was, line for line (the
 * code audit of 07.11, CODE-5: the page's 2 500 lines mixed the reads with the screen, and it is the most edited file);
 * nothing here draws, and the page's tests still read through it.
 */

export const RECENT_LECTURES = 4;
/** Due cards read for the stack and the lecture names (the count itself is exact). */
const DUE_SAMPLE = 60;

export interface LectureRow {
  id: string;
  title: string;
  created_at: string;
}

export interface LectureDetail extends LectureRow {
  summary_json?: unknown;
  flashcards_json?: unknown;
  quiz_json?: unknown;
}

/** One question of the exam as «Сегодня» needs it: its place, number, section, hash and coverage. */
export interface TodayQuestion {
  id: string;
  position: number;
  label: string;
  section: number | null;
  hash: string | null;
  coverage: SheetCoverage;
}

export interface TodayExam {
  id: string;
  title: string;
  kind: ExamKind;
  /** 'yyyy-MM-dd', or null for an exam without a date. */
  examDate: string | null;
  /** Calendar days to the exam (0 today), null without a date. */
  daysLeft: number | null;
  layout: TicketLayout;
  questions: TodayQuestion[];
  /** exam_answer events of the questions; null when the history could not be read. */
  events: LearningEvent[] | null;
  /** exams.created_at: the newer of two exams on one day leads (as in pickExam). */
  createdAt?: string;
}

/** The three first steps of a student (the first run around the core). */
export interface FirstSteps {
  /** At least one lecture has text (a scan without text cannot be checked against a list). */
  lecture: boolean;
  /** At least one exam has questions. */
  list: boolean;
  /** At least one answer to a ticket is in the journal (spoken or typed; a self-rating is not an answer). */
  answer: boolean;
  /** The exam «Тянуть билет» draws from: the leading exam when it has questions, else one that has; null without one. */
  drawExamId: string | null;
  /**
   * The exam container is in the database (spec decision 25): step 1 is neutral («Добавьте вопросы к экзамену» into
   * /exams/import) and the steps for lectures and the ticket are there only with oral questions (`oral`). Absent: today's
   * three steps.
   */
  neutral?: boolean;
  /** The account has oral questions (an exam with questions): the lecture and ticket steps apply. */
  oral?: boolean;
}

export interface DashboardData {
  lectures: LectureRow[];
  recent: LectureDetail[];
  dueCount: number;
  dueCards: DueCard[];
  sessions: StudySession[];
  /** Recent lectures that have at least one review card; null when that could not be read. */
  materialsWithCards: Set<string> | null;
  exam: TodayExam | null;
  /** The account has exams (any date, also ones «Сегодня» does not lead with). */
  hasExams: boolean;
  examFailed: boolean;
  /** «Первые шаги»; null when they are remembered as done or could not be read (then nothing is claimed). */
  steps: FirstSteps | null;
  /** The container layer the page was read under (containerLayer.layerKey): another answer reads it again. */
  layerKey: string;
}

const COVERAGES = new Set(['full', 'partial', 'none', 'unverified']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toQuestion(raw: unknown): TodayQuestion | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const position = Number(raw.position);
  const section = raw.section === null || raw.section === undefined ? null : Number(raw.section);
  return {
    id: raw.id,
    position: Number.isFinite(position) ? position : 0,
    label: typeof raw.label === 'string' ? raw.label : '',
    section: section !== null && Number.isInteger(section) ? section : null,
    hash: typeof raw.question_hash === 'string' && raw.question_hash !== '' ? raw.question_hash : null,
    coverage: typeof raw.coverage === 'string' && COVERAGES.has(raw.coverage) ? (raw.coverage as SheetCoverage) : 'unmapped',
  };
}

/** Whether the account has a lecture with text: one id at most, no text is transferred. */
async function hasLectureText(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('materials').select('id').eq('user_id', userId).neq('original_text', '').limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Whether the journal has an answer to a ticket: one id at most. */
async function hasTicketAnswer(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('learning_events').select('id').eq('user_id', userId).eq('kind', 'exam_answer').limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** For «Первые шаги»: one of these exams that has questions (a single exam_id is read); undefined when unreadable. */
async function examWithQuestions(examIds: string[]): Promise<string | null | undefined> {
  if (examIds.length === 0) return null;
  try {
    const { data, error } = await supabase.from('exam_questions').select('exam_id').in('exam_id', examIds).limit(1);
    if (error) throw error;
    const row = Array.isArray(data) ? (data[0] as { exam_id?: unknown } | undefined) : undefined;
    return row && typeof row.exam_id === 'string' ? row.exam_id : null;
  } catch (error) {
    console.error('Reading the questions of the exams for the first steps failed:', error);
    return undefined;
  }
}

interface ExamLoad {
  exam: TodayExam | null;
  hasExams: boolean;
  /**
   * For «Первые шаги» (only when asked for): an exam with questions — the leading one when it has
   * them — or null when no exam has any; undefined when not asked for or not readable.
   */
  listExamId?: string | null;
}

export type SettledLayer = Exclude<ContainerLayer, { mode: 'loading' }>;

/**
 * The leading oral exam. The exam containers' answer is awaited only at the pick (it comes while the exams are read):
 * an exam that lives inside a container is never picked (attached_exam_ids, Concept 3 §2.3); with the layer off, today's
 * pick over every exam.
 */
async function loadExam(userId: string, findList: boolean, layerPromise: Promise<SettledLayer>): Promise<ExamLoad> {
  const [{ data, error }, layer] = await Promise.all([
    supabase.from('exams').select('id, title, kind, exam_date, mapped_at, ticket_layout, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    layerPromise,
  ]);
  if (error) throw error;
  const exams = (Array.isArray(data) ? data : []).map(normalizeExam).filter((row): row is ExamRow => row !== null);
  const attached = layer.mode === 'on' ? new Set(layer.overview.attached_exam_ids) : null;
  const id = pickExam(attached ? exams.filter((exam) => !attached.has(exam.id)) : exams);
  const row = exams.find((exam) => exam.id === id);
  // A container is an exam of the account too («Экзамены» link, no «new account» page).
  const hasContainers = layer.mode === 'on' && layer.overview.containers.length > 0;
  if (!row) {
    const listExamId = findList ? await examWithQuestions(exams.map((exam) => exam.id)) : undefined;
    return { exam: null, hasExams: exams.length > 0 || hasContainers, listExamId };
  }

  const { data: rows, error: questionsError } = await supabase
    .from('exam_questions')
    .select('id, position, label, section, question_hash, coverage')
    .eq('exam_id', row.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (questionsError) throw questionsError;
  const questions = (Array.isArray(rows) ? rows : []).map(toQuestion).filter((question): question is TodayQuestion => question !== null);
  const hashes = Array.from(new Set(questions.map((question) => question.hash).filter((hash): hash is string => hash !== null)));
  let events: LearningEvent[] | null = [];
  if (hashes.length > 0) {
    try {
      events = await fetchQuestionEvents(hashes, ['exam_answer']);
    } catch (eventsError) {
      console.error('Reading the answers of the exam failed:', eventsError);
      events = null;
    }
  }
  const examDate = isDateKey(row.exam_date) ? row.exam_date : null;
  const listExamId =
    questions.length > 0
      ? row.id
      : findList
        ? await examWithQuestions(exams.filter((exam) => exam.id !== row.id).map((exam) => exam.id))
        : undefined;
  return {
    hasExams: true,
    listExamId,
    exam: {
      id: row.id,
      title: row.title,
      kind: row.kind,
      examDate,
      daysLeft: examDate ? daysUntil(examDate) : null,
      layout: row.ticket_layout,
      questions,
      events,
      createdAt: row.created_at,
    },
  };
}

async function loadMaterialsWithCards(userId: string, materialIds: string[]): Promise<Set<string>> {
  if (materialIds.length === 0) return new Set();
  const { data, error } = await supabase.from('flashcard_progress').select('material_id').eq('user_id', userId).in('material_id', materialIds);
  if (error) throw error;
  return new Set(((data || []) as Array<{ material_id: string | null }>).map((row) => row.material_id ?? '').filter(Boolean));
}

/**
 * Everything «Сегодня» shows. `withSteps` adds «Первые шаги» from what the page reads anyway (the
 * lectures, the leading exam's questions and answers) and, only where that says nothing, one id at
 * most per step: a lecture with text, an exam with questions, an answer in the journal.
 */
export async function loadDashboard(userId: string, withSteps: boolean, settledLayer: () => Promise<SettledLayer>): Promise<DashboardData> {
  const layerPromise = settledLayer();
  const examPromise: Promise<ExamLoad & { failed: boolean }> = loadExam(userId, withSteps, layerPromise).then(
    (result) => ({ ...result, failed: false }),
    (error) => {
      console.error('Loading the exam of «Сегодня» failed:', error);
      return { exam: null, hasExams: false, failed: true };
    },
  );
  // Step 3 from the leading exam's answers when they show one; the journal is asked only otherwise.
  const answerPromise: Promise<boolean | null> = withSteps
    ? examPromise.then((result) => {
        if (result.failed || result.listExamId === undefined) return null;
        if (result.exam?.events?.some((event) => event.kind === 'exam_answer')) return true;
        if (result.listExamId === null) return false;
        return hasTicketAnswer(userId).catch((error) => {
          console.error('Reading the journal for the first steps failed:', error);
          return null;
        });
      })
    : Promise.resolve(null);
  // The stack and the lecture names depend on this read; without it the count still leads.
  const duePromise = getDueCards(userId, { limit: DUE_SAMPLE }).catch((error) => {
    console.error('Reading the due cards failed:', error);
    return [] as DueCard[];
  });
  const [lecturesResult, recentResult, dueCount, sessionsResult] = await Promise.all([
    supabase.from('materials').select('id, title, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase
      .from('materials')
      .select('id, title, created_at, summary_json, flashcards_json, quiz_json')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(RECENT_LECTURES),
    countDueCards(userId),
    supabase.from('study_sessions').select('date, cards_reviewed').eq('user_id', userId).order('date', { ascending: false }).limit(60),
  ]);
  if (lecturesResult.error) throw lecturesResult.error;
  if (recentResult.error) throw recentResult.error;
  if (sessionsResult.error) throw sessionsResult.error;
  const recent = ((recentResult.data || []) as LectureDetail[]).slice(0, RECENT_LECTURES);
  const lectures = (lecturesResult.data || []) as LectureRow[];
  const [materialsWithCards, exam, dueCards, lectureText, answered] = await Promise.all([
    // Only the «не добавлены в повторение» notes depend on this read: without it they are left out.
    loadMaterialsWithCards(
      userId,
      recent.map((material) => material.id),
    ).catch((error) => {
      console.error('Reading review cards of recent materials failed:', error);
      return null;
    }),
    examPromise,
    duePromise,
    // Step 1: without lectures there is nothing to ask.
    withSteps && lectures.length > 0
      ? hasLectureText(userId).catch((error) => {
          console.error('Reading the lectures for the first steps failed:', error);
          return null;
        })
      : Promise.resolve(false),
    answerPromise,
  ]);
  const layer = await layerPromise;
  // With the exam container (decision 25): a container with questions is step 1 done too; lectures and the ticket only
  // with oral questions, which examWithQuestions finds among the oral exams (every row of «exams» is oral).
  const containerItems = layer.mode === 'on' ? layer.overview.containers.reduce((sum, container) => sum + container.items, 0) : 0;
  const steps: FirstSteps | null =
    withSteps && !exam.failed && lectureText !== null && answered !== null && exam.listExamId !== undefined
      ? layer.mode === 'on'
        ? {
            lecture: lectureText,
            list: exam.listExamId !== null || containerItems > 0,
            answer: answered,
            drawExamId: exam.listExamId,
            neutral: true,
            oral: exam.listExamId !== null,
          }
        : { lecture: lectureText, list: exam.listExamId !== null, answer: answered, drawExamId: exam.listExamId }
      : null;
  return {
    lectures,
    recent,
    dueCount,
    dueCards,
    sessions: (sessionsResult.data || []) as StudySession[],
    materialsWithCards,
    exam: exam.exam,
    hasExams: exam.hasExams,
    examFailed: exam.failed,
    steps,
    layerKey: layerKey(layer),
  };
}
