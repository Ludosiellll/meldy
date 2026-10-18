import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { countDueCards, getDueCards, syncFlashcards, type DueCard } from '../api/flashcards';
import { fetchQuestionEvents, type LearningEvent } from '../api/learning';
import { normalizeExam, type ExamKind, type ExamRow, type TicketLayout } from '../api/exams';
import { compareEventTime, examSummary, statesByHash } from '../lib/learning/readiness';
import { KIND_WORDS, daysUntil, formatDay, sheetHeader, subjectOf } from '../lib/exams/format';
import { allQuestionsWord, coverageShares, glue, layoutPhrase, numberOf, perTicketOf, shareText } from '../components/exams/sheetModel';
import { COVERAGE_MARK, markSeed, type CoverageMarkKind, type SheetCoverage } from '../components/exams/marks';
import { Mark } from '../components/marks';
import { useFrame } from '../components/exams/useFrame';
import { currentStreak, isDateKey, localDateKey, shiftDateKey } from '../utils/streak';
import { EXAM_HORIZON_DAYS, pickExam } from '../lib/exams/leading';
import { pluralRu } from '../components/conversation/visuals';
import type { StudySession } from '../types';
import '../styles/paper.css';
import './Dashboard.css';
import { displayMaterialTitle } from '../utils/materialTitle';
import { analysisCards } from '../utils/lectureCards';
import { countBucket, track } from '../lib/telemetry';
import { useSheetToday } from '../components/exams/sheet/sheetCount';
import { mostlyNone } from '../components/exams/examStatus';
import { counterLabel, erasableLine, nextErasableLine } from '../components/exams/sheet/copy';
import type { ErasableNow } from '../lib/exams/cheatSheet';
import DailyReminder from '../components/reminders/DailyReminder';
import QuestionOfDay from '../components/exams/share/QuestionOfDay';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { usePhone } from '../lib/usePhone';
import { useContainerData } from '../lib/containers/hooks';
import { planDay } from '../lib/containers/plan';
import { glue as glueCount, shownMinutes } from '../lib/containers/words';
import TodayExamCard from '../components/containers/TodayExamCard';
import MoveExamDialog from '../components/containers/MoveExamDialog';
import { MOVE_SHORT, moved as movedWords } from '../components/containers/copy';
import { isDayOff } from '../components/containers/planLines';
import { examQuestions, overviewQuestions } from '../components/containers/model';
import type { DayPlan, OverviewContainer } from '../types/container';
import { containerDays, layerKey, QuietBoundary, useContainerLayer, type ContainerLayer } from './containerLayer';
import './containerScreens.css';

/**
 * «Сегодня» in the Meldy language (prototype Today.dc.html, approved 2026-10-04; notes:
 * 10_Project/Design_Language_2026-10-04). The first screen after signing in and after registration.
 *
 * - The greeting with the date and one hand-drawn yellow line under «повторим».
 * - One main card of what to do now: the nearest exam (a flag with the days left, the subject, the
 *   meta line, then at once the next step — «Тянуть билет», or «Тянуть билет из них» when an answer can
 *   erase lines of the cheat sheet today — so it is on the first screen at every size (audit of
 *   2026-10-08: below the readiness it stood at y 1053 in a 734 px window); then «9 вопросов без
 *   материала», the share of tickets for the exam's own layout as the large figure, the list in
 *   miniature as status dots with the pencil marks, the answers line and a dated note about the last
 *   two days). Without an exam the cards lead.
 * - Beside it the task cards: today's review cards (a coloured panel with the first due question)
 *   and two weeks of cards; below, the four latest lectures as cards.
 * - «Первые шаги» above it all until they are done, in the order of «Новый экзамен»: a question list,
 *   lectures with text, a ticket answered — the first run around the core (owner, 2026-10-04). A new
 *   account sees only them. They can be folded (remembered per account on this device) and are gone
 *   once all three are done.
 * Every number on the page is read from the account; nothing is invented (no ticket numbers, no zeros
 * on an empty account).
 *
 * A phone (usePhone, max-width 639px; 10_Project/Phone_Declutter_2026-10-08) gets the same page cut to its core: the
 * exam card is the flag, the subject, a one-line meta, one line about today's step, the one blue pill and «Лист экзамена»
 * as a quiet link, then the share in one line, «2 вопроса без материала» and the cheat sheet's count as quiet links. The
 * dots, the legend, the answers and the note stay on the exam's sheet, «Напоминать каждый день» in «Профиль». Today's
 * cards are «Повторение», «26 карточек · около 13 минут» and «Начать повторение» (a quiet link while another card holds
 * the blue pill), without the picture or the lectures; two weeks of cards only when there were reviews; the lectures
 * are rows with «+ Лекция» (the top line has no «+ Лекция» on a phone). Every action but the one blue pill is a quiet
 * link on a phone.
 */

/** The leading exam (lib/exams/leading.ts): «Профиль» names the same one for the daily reminder. */
export { EXAM_HORIZON_DAYS, pickExam };
const CHART_DAYS = 14;
const RECENT_LECTURES = 4;
/** Due cards read for the stack and the lecture names (the count itself is exact). */
const DUE_SAMPLE = 60;
/** Seconds per review card in the time estimate. */
const SECONDS_PER_CARD = 30;
const LOADING_LINE_MS = 300;

/** «Первые шаги» per account on this device: 'collapsed' while folded, 'done' once all three were done. */
export const FIRST_STEPS_PREFIX = 'meldy_first_steps_';

const QUESTION_FORMS = ['вопрос', 'вопроса', 'вопросов'] as const;
const CARD_FORMS = ['карточка', 'карточки', 'карточек'] as const;
/** A kind word still inside the subject («Экзамен по микроэкономике»): the heading then does not repeat it. */
const KIND_IN_NAME = /(^|[\s«(])(экзамен|зач[её]т|коллоквиум)/i;

// ---------------------------------------------------------------------------------------------
// Data

interface LectureRow {
  id: string;
  title: string;
  created_at: string;
}

interface LectureDetail extends LectureRow {
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

interface DashboardData {
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

type FirstStepsMemory = 'collapsed' | 'done' | null;

function readFirstStepsMemory(userId: string | undefined): FirstStepsMemory {
  if (!userId) return null;
  try {
    const value = window.localStorage.getItem(FIRST_STEPS_PREFIX + userId);
    return value === 'collapsed' || value === 'done' ? value : null;
  } catch {
    return null;
  }
}

function writeFirstStepsMemory(userId: string, value: FirstStepsMemory) {
  try {
    if (value) window.localStorage.setItem(FIRST_STEPS_PREFIX + userId, value);
    else window.localStorage.removeItem(FIRST_STEPS_PREFIX + userId);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** How many of the steps shown are done (three, or one or three with the exam container). */
export function firstStepsDone(steps: FirstSteps): number {
  return firstStepViews(steps).filter((view) => view.done).length;
}

const COVERAGES = new Set(['full', 'partial', 'none', 'unverified']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The material has cards but none of them reached review. A text-only import is saved without
 * cards (flashcards_json {flashcards: []}), so it never gets this note; if cards are made for it
 * later and do not reach review, the note is as true for it as for any other lecture.
 */
export function cardsMissingFromReview(material: { id: string; flashcards_json?: unknown }, materialsWithCards: Set<string> | null): boolean {
  if (!materialsWithCards || materialsWithCards.has(material.id)) return false;
  return analysisCards(material.flashcards_json).length > 0;
}

/** «конспект · 8 карточек · тест · выжимка · подкаст» (only what exists) or «только текст, конспекта нет», as in the Library. */
export function lectureMeta(material: Pick<LectureDetail, 'summary_json' | 'flashcards_json' | 'quiz_json'>): string {
  const summary = isRecord(material.summary_json) ? material.summary_json : {};
  if (summary.text_only === true) return 'только текст, конспекта нет';
  const parts: string[] = [];
  if (typeof summary.content === 'string' && summary.content.trim() !== '') parts.push('конспект');
  const cards = analysisCards(material.flashcards_json).length;
  if (cards > 0) parts.push(`${cards} ${pluralRu(cards, CARD_FORMS)}`);
  const quiz = isRecord(material.quiz_json) && Array.isArray(material.quiz_json.quiz) ? material.quiz_json.quiz.length : 0;
  if (quiz > 0) parts.push('тест');
  if (hasCheatsheet(summary)) parts.push('выжимка');
  if (Array.isArray(summary.podcast) && summary.podcast.length > 0) parts.push('подкаст');
  return parts.join(' · ');
}

/** The lecture has its «Выжимка»: «Лекции» and «Сегодня» name it in the row as the lecture's tab does. */
function hasCheatsheet(summary: Record<string, unknown>): boolean {
  return typeof summary.cheatsheet === 'string' && summary.cheatsheet.trim() !== '';
}

/** «2 окт.», with the year when it is not this year. */
function shortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale: ru });
}

/**
 * «8 карточек · тест · выжимка · подкаст · 2 окт.»: a lecture row on a phone, one short line with its date. «конспект» only
 * when it is all the lecture has (every analysed lecture has one); «только текст» for a lecture kept as text.
 */
export function lectureMetaShort(
  material: Pick<LectureDetail, 'summary_json' | 'flashcards_json' | 'quiz_json' | 'created_at'>,
  now: Date = new Date(),
): string {
  const summary = isRecord(material.summary_json) ? material.summary_json : {};
  const parts: string[] = [];
  if (summary.text_only === true) parts.push('только текст');
  else {
    const cards = analysisCards(material.flashcards_json).length;
    if (cards > 0) parts.push(`${cards} ${pluralRu(cards, CARD_FORMS)}`);
    const quiz = isRecord(material.quiz_json) && Array.isArray(material.quiz_json.quiz) ? material.quiz_json.quiz.length : 0;
    if (quiz > 0) parts.push('тест');
    if (hasCheatsheet(summary)) parts.push('выжимка');
    if (Array.isArray(summary.podcast) && summary.podcast.length > 0) parts.push('подкаст');
    if (parts.length === 0 && typeof summary.content === 'string' && summary.content.trim() !== '') parts.push('конспект');
  }
  const date = shortDate(material.created_at, now);
  if (date) parts.push(date);
  return parts.join(' · ');
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

type SettledLayer = Exclude<ContainerLayer, { mode: 'loading' }>;

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
async function loadDashboard(userId: string, withSteps: boolean, settledLayer: () => Promise<SettledLayer>): Promise<DashboardData> {
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

// ---------------------------------------------------------------------------------------------
// Words

/** «Суббота, 3 октября»: the first letter is made capital here, never by CSS. */
export function todayLine(now: Date = new Date()): string {
  const text = format(now, 'EEEE, d MMMM', { locale: ru });
  return text ? text[0].toLocaleUpperCase('ru-RU') + text.slice(1) : text;
}

/** The first word of the account's full name, or null. */
export function firstName(fullName: unknown): string | null {
  if (typeof fullName !== 'string') return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function greeting(fullName: unknown): string {
  const name = firstName(fullName);
  return name ? `${name}, что повторим?` : 'Что повторим сегодня?';
}

/** A new account has nothing to repeat yet: «Алина, с чего начнём?». */
export function startGreeting(fullName: unknown): string {
  const name = firstName(fullName);
  return name ? `${name}, с чего начнём?` : 'С чего начнём?';
}

export function examWhen(daysLeft: number): string {
  if (daysLeft <= 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  return `через ${daysLeft} ${pluralRu(daysLeft, ['день', 'дня', 'дней'])}`;
}

/**
 * The heading of the exam card in its two parts: the subject the card sets large («Цифровая
 * экономика», a leading «Экзамен:» dropped, the title never declined) and the time to the exam with
 * the kind once («экзамен через 12 дней»; only «сегодня» when the kind is already in the name), which
 * the card's flag shows. Without a date: the sheet's own header and no time.
 */
export function examHeadingParts(exam: { title: string; kind: ExamKind; daysLeft: number | null }): { subject: string; when: string | null } {
  if (exam.daysLeft === null) return { subject: sheetHeader(exam.title, exam.kind), when: null };
  const subject = subjectOf(exam.title);
  const when = examWhen(exam.daysLeft);
  return { subject, when: KIND_IN_NAME.test(subject) ? when : `${KIND_WORDS[exam.kind]} ${when}` };
}

/**
 * «Микроэкономика — экзамен через 12 дней»: the subject (a leading «Экзамен:» is dropped, the title
 * is never declined) and the kind once. «Экзамен по микроэкономике — через 12 дней» when the kind is
 * already in the name. Without a date, the sheet's own header: «Микроэкономика: вопросы к экзамену».
 * No period at the end.
 */
export function examHeading(exam: { title: string; kind: ExamKind; daysLeft: number | null }): string {
  const { subject, when } = examHeadingParts(exam);
  return when ? `${subject} — ${when}` : subject;
}

/** «Экзамен через 12 дней», «Сегодня»: the flag of the exam card (the first letter made capital in code). */
export function examFlag(when: string): string {
  return when ? when[0].toLocaleUpperCase('ru-RU') + when.slice(1) : when;
}

/** «15 октября · 40 вопросов, в билете два». */
export function examMeta(exam: Pick<TodayExam, 'examDate' | 'layout'> & { total: number }): string {
  const parts: string[] = [];
  const day = formatDay(exam.examDate);
  if (day) parts.push(day);
  if (exam.total > 0) parts.push(layoutPhrase(exam.total, exam.layout));
  return parts.join(' · ');
}

/** «15 октября · 40 вопросов»: the meta of a phone, one line (the tickets' layout is on the exam's sheet). */
export function examMetaShort(exam: Pick<TodayExam, 'examDate'> & { total: number }): string {
  const parts: string[] = [];
  const day = formatDay(exam.examDate);
  if (day) parts.push(day);
  if (exam.total > 0) parts.push(`${exam.total} ${pluralRu(exam.total, QUESTION_FORMS)}`);
  return parts.join(' · ');
}

/**
 * «Можно стереть строки шпаргалки у 4 вопросов.»: the exam card's next step on a phone, over «Тянуть билет из них»
 * (the computer says it in full: erasableLine). «шпаргалки» stays even if it takes two lines at 360 px: without it a
 * newcomer read «стереть строки у 4 вопросов» as deleting questions (audit 2026-10-08, critics of release 34).
 */
export function erasableShort(count: number): string {
  return glue(`Можно стереть строки шпаргалки у ${count} ${pluralRu(count, ['вопроса', 'вопросов', 'вопросов'])}.`);
}

export interface CoverageTally {
  total: number;
  full: number;
  partial: number;
  none: number;
  unverified: number;
  unmapped: number;
}

export function coverageTally(questions: Array<Pick<TodayQuestion, 'coverage'>>): CoverageTally {
  const tally: CoverageTally = { total: questions.length, full: 0, partial: 0, none: 0, unverified: 0, unmapped: 0 };
  for (const question of questions) {
    if (question.coverage === 'checking') tally.unmapped += 1;
    else tally[question.coverage] += 1;
  }
  return tally;
}

/** «9 вопросов без материала» and what to do about them (one question: «к нему… он вернётся»). */
export function withoutMaterialLine(none: number): { link: string; note: string } {
  return {
    link: `${none} ${pluralRu(none, QUESTION_FORMS)} без материала`,
    note:
      none === 1
        ? 'Добавьте к нему лекцию — после новой сверки он вернётся в тренировку.'
        : 'Добавьте к ним лекции — после новой сверки они вернутся в тренировку.',
  };
}

/** «оба вопроса» for the department's tickets when every ticket has the same size, otherwise «все вопросы». */
function fixedTicketWord(questions: TodayQuestion[], layout: TicketLayout): string {
  const ids = new Set(questions.map((question) => question.id));
  const sizes = new Set(
    (layout.tickets ?? []).map((ticket) => ticket.question_ids.filter((id) => ids.has(id)).length).filter((size) => size > 0),
  );
  return sizes.size === 1 ? allQuestionsWord(Array.from(sizes)[0]) : 'все вопросы';
}

type ShareCount =
  | { kind: 'unmapped' }
  | { kind: 'fixed'; count: string; tickets: number; word: string }
  | { kind: 'percent'; value: string; perTicket: number };

/** The share of tickets whose questions are all in the lectures, counted once for the sentence and the figure. */
function shareCount(questions: TodayQuestion[], layout: TicketLayout): ShareCount | null {
  if (questions.length === 0) return null;
  if (questions.every((question) => question.coverage === 'unmapped')) return { kind: 'unmapped' };
  const shares = coverageShares(
    questions.map((question) => ({ id: question.id, section: question.section, coverage: question.coverage })),
    layout,
  );
  const value = shareText(shares, 'all');
  if (!value || !shares.low.ok) return null;
  if (shares.low.mode === 'fixed') {
    const low = shares.low.allCount;
    const high = shares.isRange && shares.high.ok && shares.high.mode === 'fixed' ? shares.high.allCount : low;
    return { kind: 'fixed', count: high !== low ? `${low}–${high}` : String(low), tickets: shares.low.tickets, word: fixedTicketWord(questions, layout) };
  }
  return { kind: 'percent', value, perTicket: perTicketOf(shares.low, layout.per_ticket) };
}

/**
 * The share of tickets whose questions are all in the lectures, for the exam's own layout (random
 * pairs, one per section, or the department's tickets): «Билетов, где оба вопроса есть в ваших
 * лекциях, — 35 %.» A range while some questions were checked only by words or not mapped yet; «Сверки
 * с лекциями ещё не было.» before the first check; '' when no share can be counted.
 */
export function shareSentence(questions: TodayQuestion[], layout: TicketLayout): string {
  const share = shareCount(questions, layout);
  if (!share) return '';
  if (share.kind === 'unmapped') return 'Сверки с лекциями ещё не было.';
  if (share.kind === 'fixed') return `Билетов кафедры, где ${share.word} есть в ваших лекциях, — ${share.count} из ${share.tickets}.`;
  if (share.perTicket <= 1) return `Вопросов, которые есть в ваших лекциях, — ${share.value}.`;
  return `Билетов, где ${allQuestionsWord(share.perTicket)} есть в ваших лекциях, — ${share.value}.`;
}

/**
 * The same share as the card sets it in large type: «35 %» with «билетов, где оба вопроса есть в
 * ваших лекциях» («35 % билетов, где…» read together), «1 из 2» for the department's tickets, «60 %»
 * of the questions for single-question tickets. Null before the first mapping and when no share can
 * be counted (the sentence says why).
 */
export function shareFigure(questions: TodayQuestion[], layout: TicketLayout): { figure: string; caption: string } | null {
  const share = shareCount(questions, layout);
  if (!share || share.kind === 'unmapped') return null;
  if (share.kind === 'fixed') return { figure: `${share.count} из ${share.tickets}`, caption: `билетов кафедры, где ${share.word} есть в ваших лекциях` };
  if (share.perTicket <= 1) return { figure: share.value, caption: 'вопросов есть в ваших лекциях' };
  return { figure: share.value, caption: `билетов, где ${allQuestionsWord(share.perTicket)} есть в ваших лекциях` };
}

/** «Подтверждено ответами — 6 вопросов из 40.», or that there were no answers yet. */
export function answersSentence(questions: TodayQuestion[], events: LearningEvent[] | null): string {
  if (questions.length === 0) return '';
  if (events === null) return 'История ответов не загрузилась.';
  const hashes = questions.map((question) => question.hash).filter((hash): hash is string => hash !== null);
  const summary = examSummary(hashes, statesByHash(events));
  if (summary.confirmed + summary.once + summary.notPassed === 0) return 'Ответов по билетам ещё не было.';
  return `Подтверждено ответами — ${summary.confirmed} ${pluralRu(summary.confirmed, QUESTION_FORMS)} из ${questions.length}.`;
}

function joinNumbers(numbers: string[]): string {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} и ${numbers[numbers.length - 1]}`;
}

/**
 * The dated note about the last two days (today and yesterday, local dates): the latest answer by
 * its question number (no grade word since Ф1), and the questions that became confirmed in these two days —
 * confirmed by all the answers now, not confirmed by the answers before yesterday. Question numbers
 * only: a ticket number exists only for the department's tickets and is never made up. Null when
 * nothing was answered in these two days.
 */
export function recentNote(questions: TodayQuestion[], events: LearningEvent[] | null, today: string = localDateKey()): string | null {
  if (!events || events.length === 0) return null;
  const from = shiftDateKey(today, -1);
  const answers = events
    .filter((event) => event.kind === 'exam_answer' && typeof event.local_date === 'string' && event.local_date >= from)
    .sort(compareEventTime);
  const latest = answers[answers.length - 1];
  if (!latest) return null;
  const byHash = new Map<string, TodayQuestion>();
  for (const question of questions) if (question.hash && !byHash.has(question.hash)) byHash.set(question.hash, question);
  const answered = byHash.get(latest.item_key.slice(2));
  if (!answered) return null;

  const day = latest.local_date >= today ? 'Сегодня' : 'Вчера';
  const head = `${day}: ответ на вопрос ${numberOf(answered)}.`;

  const before = statesByHash(events.filter((event) => typeof event.local_date === 'string' && event.local_date < from));
  const now = statesByHash(events);
  const confirmed: string[] = [];
  for (const [hash, question] of byHash) {
    if (now.get(hash)?.readiness === 'confirmed' && before.get(hash)?.readiness !== 'confirmed') confirmed.push(numberOf(question));
  }
  if (confirmed.length === 0) return head;
  return confirmed.length === 1
    ? `${head} Вопрос ${confirmed[0]} подтверждён.`
    : `${head} Вопросы ${joinNumbers(confirmed)} подтверждены.`;
}

/** «около 6 минут» at 30 seconds a card; «около минуты» for one or two cards. */
function reviewMinutes(count: number): string {
  const minutes = Math.max(1, Math.ceil((count * SECONDS_PER_CARD) / 60));
  if (minutes === 1) return 'около минуты';
  const word = minutes % 10 === 1 && minutes % 100 !== 11 ? 'минуты' : 'минут';
  return `около ${minutes} ${word}`;
}

/** «Около 6 минут.» at 30 seconds a card; «Около минуты.» for one or two cards. */
export function reviewTime(count: number): string {
  const words = reviewMinutes(count);
  return `${words[0].toLocaleUpperCase('ru-RU')}${words.slice(1)}.`;
}

/** «26 карточек · около 13 минут»: today's cards on a phone, one line (the lectures they come from are in «Повторение»). */
export function dueLine(count: number): string {
  return `${count} ${pluralRu(count, CARD_FORMS)} · ${reviewMinutes(count)}`;
}

/**
 * «Из лекций «Эластичность спроса», «Спрос и предложение» и «Издержки производства».» — the lectures
 * of the due cards, at most three by name; «… и других» when more lectures (or cards whose lecture is
 * unknown) are due. Cards from answers to tickets without a lecture: «Из ответов на билеты.» '' when
 * nothing can be named.
 */
export function dueLecturesText(cards: DueCard[], titles: Map<string, string>, total: number): string {
  const names: string[] = [];
  let unnamed = 0;
  let followups = 0;
  for (const card of cards) {
    const title = card.material_id ? titles.get(card.material_id)?.trim() : '';
    if (!title) {
      unnamed += 1;
      if (card.origin === 'oral_followup') followups += 1;
      continue;
    }
    if (!names.includes(title)) names.push(title);
  }
  if (names.length === 0) return cards.length > 0 && followups === cards.length && total <= cards.length ? 'Из ответов на билеты.' : '';
  const more = names.length > 3 || unnamed > 0 || total > cards.length;
  const shown = names.slice(0, 3).map((title) => `«${title}»`);
  const lead = shown.length === 1 && !more ? 'Из лекции' : 'Из лекций';
  if (more) return `${lead} ${shown.join(', ')} и других.`;
  return `${lead} ${joinNumbers(shown)}.`;
}

/** «11 карточек на сегодня». */
export function dueTitle(count: number): string {
  return `${count} ${pluralRu(count, CARD_FORMS)} на сегодня`;
}

/** «11 карточек ждут повторения.» and «Около 6 минут.» (two sentences, set on two lines). */
export function dueLead(count: number): { count: string; time: string } {
  return { count: `${count} ${pluralRu(count, CARD_FORMS)} ${pluralRu(count, ['ждёт', 'ждут', 'ждут'])} повторения.`, time: reviewTime(count) };
}

/** «6 дней подряд. Сегодня — 4 карточки.» (a streak of one day is not called a streak). */
export function activityLine(streak: number, today: number): string {
  const parts: string[] = [];
  if (streak >= 2) parts.push(`${streak} ${pluralRu(streak, ['день', 'дня', 'дней'])} подряд.`);
  parts.push(today > 0 ? `Сегодня — ${today} ${pluralRu(today, CARD_FORMS)}.` : 'Сегодня карточки ещё не повторялись.');
  return parts.join(' ');
}

function shortDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'd MMM', { locale: ru });
}

// ---------------------------------------------------------------------------------------------
// Pieces

/** The arrow of the pills and the quiet links (aria-hidden: the words say where the link goes). */
function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** The circle with the arrow at the end of a white pill (the blue one draws its own). */
function PillDot() {
  return (
    <span className="td-dot" aria-hidden="true">
      <ArrowIcon />
    </span>
  );
}

/** The greeting with one hand-drawn yellow line under «повторим» or «начнём» (drawn in once; already there under reduced motion). */
function Greeting({ text }: { text: string }) {
  const word = text.includes('повторим') ? 'повторим' : 'начнём';
  const at = text.indexOf(word);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="td-mark">
        {word}
        <svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path pathLength={1} d="M4 14 C 90 6, 190 6, 280 10 S 370 15, 396 9" />
        </svg>
      </span>
      {text.slice(at + word.length)}
    </>
  );
}

/** Marks inside the status dots of the list in miniature: 12 px on a computer, a little larger on a phone. */
const RIBBON_MARKS: Record<'desk' | 'phone', Record<CoverageMarkKind, { width: number; height: number }>> = {
  desk: { tick: { width: 12, height: 10 }, dtick: { width: 12, height: 10 }, cup: { width: 11, height: 7 }, dash: { width: 11, height: 5 }, dot: { width: 6, height: 6 } },
  phone: { tick: { width: 11, height: 9 }, dtick: { width: 11, height: 9 }, cup: { width: 10, height: 6 }, dash: { width: 10, height: 5 }, dot: { width: 6, height: 6 } },
};
const LEGEND_MARKS: Record<CoverageMarkKind, { width: number; height: number }> = {
  tick: { width: 10, height: 8 },
  dtick: { width: 10, height: 8 },
  cup: { width: 9, height: 6 },
  dash: { width: 9, height: 4 },
  dot: { width: 5, height: 5 },
};

/**
 * The list in miniature: one status dot per question in list order (green «есть», yellow «частично»,
 * grey «нет», a ring for «только по словам»), each with its pencil mark, so the meaning is not in the
 * colour alone; an empty ring for a question not mapped yet.
 */
function Ribbon({ examId, questions, perRow, phone }: { examId: string; questions: TodayQuestion[]; perRow: number; phone: boolean }) {
  const rows: TodayQuestion[][] = [];
  for (let i = 0; i < questions.length; i += perRow) rows.push(questions.slice(i, i + perRow));
  const sizes = RIBBON_MARKS[phone ? 'phone' : 'desk'];
  return (
    <figure
      className="sf-sheet td-strip"
      role="img"
      aria-label={`Пометки у ${questions.length} ${pluralRu(questions.length, QUESTION_FORMS)} списка, по порядку`}
      data-per-row={perRow}
      style={{ '--td-cols': perRow } as CSSProperties}
    >
      {rows.map((row, index) => {
        const first = index * perRow + 1;
        return (
          <div key={first} className="td-strip-row" style={{ '--td-n': row.length } as CSSProperties}>
            <span className="td-strip-n">{first}</span>
            {row.map((question) => {
              const kind = COVERAGE_MARK[question.coverage];
              return (
                <span key={question.id} className="td-strip-cell" data-coverage={question.coverage}>
                  {kind ? <Mark kind={kind} seed={markSeed(examId, question.position)} width={sizes[kind].width} height={sizes[kind].height} /> : null}
                </span>
              );
            })}
            <span className="td-strip-n" data-end="">
              {first + row.length - 1}
            </span>
          </div>
        );
      })}
    </figure>
  );
}

const TALLY: Array<{ key: keyof Omit<CoverageTally, 'total'>; mark: CoverageMarkKind | null; label: (n: number) => string }> = [
  { key: 'full', mark: 'tick', label: () => 'есть в лекциях' },
  { key: 'partial', mark: 'cup', label: () => 'частично' },
  { key: 'none', mark: 'dash', label: () => 'нет ни в одной' },
  { key: 'unverified', mark: 'dtick', label: () => 'только по словам' },
  { key: 'unmapped', mark: null, label: (n) => pluralRu(n, ['ещё не сверен', 'ещё не сверены', 'ещё не сверены']) },
];

/** The legend under the dots: the same dots and marks, each with its count. */
function Tally({ tally, examId }: { tally: CoverageTally; examId: string }) {
  const items = TALLY.filter((item) => tally[item.key] > 0);
  return (
    <p className="td-tally">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? ' ' : null}
          <span data-coverage={item.key}>
            <span className="td-tally-dot" data-coverage={item.key} aria-hidden="true">
              {item.mark ? (
                <Mark
                  kind={item.mark}
                  seed={markSeed(`${examId}:legend`, index)}
                  width={LEGEND_MARKS[item.mark].width}
                  height={LEGEND_MARKS[item.mark].height}
                />
              ) : null}
            </span>
            <b>{tally[item.key]}</b>
            {/* Spaces and commas keep the line readable as text; on screen the flex gaps draw them. */}
            {` ${glue(item.label(tally[item.key]))}`}
            {index < items.length - 1 ? <span className="sr-only">,</span> : null}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/** Today's review cards on a coloured panel: three index cards, the first due question on top. */
function CardStack({ question }: { question: string }) {
  const long = question.trim().length > 64;
  return (
    <div className="td-panel td-stack-panel" aria-hidden="true">
      <div className="td-stack">
        <div className="sf-index-card" data-n="3" />
        <div className="sf-index-card" data-n="2" />
        <div className="sf-index-card" data-n="1">
          <p className="td-stack-q" data-long={long ? '' : undefined}>
            {question.trim()}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Reviews per day as columns with the value above each, and a table for screen readers. `tallest` is the highest
 * column in px: 100, or 48 on a phone, where the columns are low and carry no values (the table has them).
 */
function DayBars({ days, tallest = 100 }: { days: Array<{ key: string; value: number }>; tallest?: number }) {
  const max = Math.max(1, ...days.map((day) => day.value));
  const last = days.length - 1;
  return (
    <>
      <div className="td-bars" aria-hidden="true">
        {days.map((day, index) => (
          <div key={day.key} className="td-bar" data-zero={day.value === 0 ? '' : undefined} data-today={index === last ? '' : undefined}>
            <span className="td-bar-v">{day.value}</span>
            <span className="td-bar-b" style={day.value > 0 ? { height: `${Math.max(3, Math.round((day.value / max) * tallest))}px` } : undefined} />
          </div>
        ))}
      </div>
      <div className="td-axis" aria-hidden="true">
        <span>{shortDay(days[0].key)}</span>
        <span>сегодня</span>
      </div>
      {/* The box that hides it is a div: under .sr-only a table keeps the height of its rows and adds blank scroll
          under the page (found on «Прогресс»). */}
      <div className="sr-only">
        <table>
          <caption>Повторения карточек по дням</caption>
          <thead>
            <tr>
              <th scope="col">День</th>
              <th scope="col">Карточек</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day, index) => (
              <tr key={day.key}>
                <td>{index === last ? 'сегодня' : shortDay(day.key)}</td>
                <td>{day.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The page

export default function Dashboard() {
  useDocumentTitle('Сегодня');
  const { user } = useAuth();
  const frame = useFrame<HTMLDivElement>();
  const phone = usePhone();
  const { layer, probe, settled, reload: reloadLayer } = useContainerLayer();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingLine, setLoadingLine] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [stepsFolded, setStepsFolded] = useState(() => readFirstStepsMemory(user?.id) === 'collapsed');

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(false);
    try {
      setData(await loadDashboard(user.id, readFirstStepsMemory(user.id) !== 'done', settled));
    } catch (error) {
      console.error('Loading «Сегодня» failed:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id, settled]);

  useEffect(() => {
    void load();
  }, [load]);

  // The exam containers came with another answer than the page was read under (a late overview): read it again, so an
  // exam inside a container never leads as an exam of its own.
  const liveKey = layer.mode === 'loading' ? null : layerKey(layer);
  useEffect(() => {
    if (!data || loading || liveKey === null || data.layerKey === liveKey) return;
    void load();
  }, [data, loading, liveKey, load]);

  // The plans of the containers with a date ahead or none (package D1's data, package D2's planDay), read beside the page.
  const on = layer.mode === 'on' ? layer : null;
  const dayKey = localDateKey();
  const planned = useMemo(() => (on ? on.overview.containers.filter((container) => !containerDays(container, dayKey).past) : NO_CONTAINERS), [on, dayKey]);
  // An exam passed in the last 14 days stays as a quiet row with «Перенести» (release 47), instead of leaving the page.
  const passed = useMemo(() => (on ? recentlyPassed(on.overview.containers, dayKey) : NO_CONTAINERS), [on, dayKey]);
  // «Перенести экзамен» from a passed row or the exam-day card: the overview and the plans are read again after it.
  const [moving, setMoving] = useState<OverviewContainer | null>(null);
  const [moved, setMoved] = useState<{ text: string; at: number } | null>(null);
  const [planRound, setPlanRound] = useState(0);
  const movedRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (moved) movedRef.current?.focus();
  }, [moved]);
  const [plans, setPlans] = useState<Record<string, PlanResult>>({});
  const onPlan = useCallback((id: string, result: PlanResult) => setPlans((current) => (samePlanResult(current[id], result) ? current : { ...current, [id]: result })), []);
  // A card that crashed (package D3b's component): its container becomes a quiet row.
  const [brokenCards, setBrokenCards] = useState<ReadonlySet<string>>(() => new Set());
  const plannedKey = planned.map((container) => container.id).join(',');
  const [planWaitOver, setPlanWaitOver] = useState(false);
  useEffect(() => {
    setPlanWaitOver(false);
    if (!plannedKey) return undefined;
    const timer = window.setTimeout(() => setPlanWaitOver(true), PLAN_WAIT.ms);
    return () => window.clearTimeout(timer);
  }, [plannedKey]);
  const plansSettled = planWaitOver || planned.every((container) => plans[container.id] && plans[container.id].status !== 'loading');
  const planSources = planned.map((container) => (
    <QuietBoundary key={container.id} onError={() => onPlan(container.id, PLAN_FAILED)}>
      <PlanSource id={container.id} onPlan={onPlan} round={planRound} />
    </QuietBoundary>
  ));
  const todayOf = (oral: TodayExam | null) =>
    todayLayout({
      oral: oral ? { examDate: oral.examDate, createdAt: oral.createdAt ?? '' } : null,
      containers: planned.map((container) => ({ container, plan: brokenCards.has(container.id) ? PLAN_FAILED : plans[container.id] ?? PLAN_LOADING })),
      today: dayKey,
    });
  // The page as read under the layer it shows: the containers' part only when the pick knew about them.
  const containerView = on && data && data.layerKey === liveKey && (planned.length > 0 || passed.length > 0) ? on : null;
  // After a move the page stays: a plan read again (or a moved exam's first) fills its card in when it comes.
  const containerWait = Boolean(containerView && !plansSettled && !moved);
  const layout = containerView && !containerWait ? todayOf(data?.exam ?? null) : null;

  // Once all the steps are done they are not read again on this device.
  const steps = data?.steps ?? null;
  const stepsFinished = steps !== null && firstStepsDone(steps) === firstStepViews(steps).length;
  useEffect(() => {
    if (user?.id && stepsFinished) writeFirstStepsMemory(user.id, 'done');
    if (user?.id && stepsFinished) track('first_steps_done');
  }, [user?.id, stepsFinished]);

  const toggleSteps = () => {
    const next = !stepsFolded;
    setStepsFolded(next);
    if (user?.id) writeFirstStepsMemory(user.id, next ? 'collapsed' : null);
  };

  // Without network the exam containers come from the device's copy (spec decision 31): their card leads at once, the
  // rest of the page follows when its reads give up (their retries take about 7 s, usability check m5).
  const fromDevice = Boolean(on?.offline) && planned.length > 0 && !data && plansSettled;
  // Nothing for the first 300 ms, then one quiet line (spec 4.6): no spinner. An account with exam containers also waits
  // (at most PLAN_WAIT) for their plans, so the leading card does not change places once they come.
  const waiting = ((loading && !data) || containerWait) && !fromDevice;
  useEffect(() => {
    if (!waiting) {
      setLoadingLine(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadingLine(true), LOADING_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const todayKey = dayKey;
  const days = useMemo(() => {
    const reviewed = new Map<string, number>();
    for (const session of sessions) {
      const key = typeof session.date === 'string' ? session.date.slice(0, 10) : '';
      reviewed.set(key, (reviewed.get(key) ?? 0) + (Number(session.cards_reviewed) || 0));
    }
    return Array.from({ length: CHART_DAYS }, (_, index) => {
      const key = shiftDateKey(todayKey, index - (CHART_DAYS - 1));
      return { key, value: reviewed.get(key) ?? 0 };
    });
  }, [sessions, todayKey]);
  const streak = useMemo(() => currentStreak(sessions.map((session) => session.date)), [sessions]);

  const addCardsToReview = async (material: LectureDetail) => {
    if (!user?.id || syncing) return;
    setSyncing(material.id);
    setSyncError(null);
    try {
      await syncFlashcards(user.id, material.id, analysisCards(material.flashcards_json));
      await load();
    } catch (error) {
      console.error(error);
      setSyncError(material.id);
    } finally {
      setSyncing(null);
    }
  };

  /** Nothing in the account yet: no lectures, exams or cards. */
  const newAccount = Boolean(data && data.lectures.length === 0 && !data.hasExams && !data.examFailed && data.dueCount === 0 && !data.exam);
  const stepsShown = steps !== null && !stepsFinished;
  /**
   * Unfolded, the steps hold the page's one blue button; the desk's actions step back to white pills. With exam
   * containers the steps never take it from an exam card that holds it (spec decision 33).
   */
  const stepsLead = stepsShown && !stepsFolded && !(layout?.main && layout.mainLeads);
  const containerSlots: ContainerSlots | undefined = layout && data
    ? {
        main: layout.main?.kind ?? 'none',
        mainLeads: layout.mainLeads,
        card:
          layout.main?.kind === 'container' ? (
            <QuietBoundary
              key={layout.main.item.container.id}
              onError={() => {
                const id = layout.main?.kind === 'container' ? layout.main.item.container.id : '';
                setBrokenCards((current) => new Set([...current, id]));
              }}
            >
              <TodayExamCard
                container={layout.main.item.container}
                plan={layout.main.item.plan.status === 'ready' ? layout.main.item.plan.plan : null}
                questions={layout.main.item.plan.status === 'ready' ? layout.main.item.plan.questions ?? null : null}
                offline={(on?.offline ?? false) || (layout.main.item.plan.status === 'ready' && layout.main.item.plan.offline)}
                lead={layout.mainLeads}
                onMove={() => {
                  if (layout.main?.kind === 'container') setMoving(layout.main.item.container);
                }}
              />
            </QuietBoundary>
          ) : null,
        rows:
          layout.rows.length > 0 || passed.length > 0 || moved ? (
            <>
              {moved ? (
                <p key={`moved-${moved.at}`} ref={movedRef} className="td-note tdc-moved" role="status" tabIndex={-1}>
                  {moved.text}
                </p>
              ) : null}
              {layout.rows.length > 0 || passed.length > 0 ? (
                <TodayRows rows={layout.rows} exam={data.exam} today={dayKey} passed={passed} onMove={setMoving} />
              ) : null}
            </>
          ) : null,
      }
    : undefined;
  const moveDialog = moving ? (
    <MoveExamDialog
      containerId={moving.id}
      role={moving.role}
      today={dayKey}
      onClose={() => setMoving(null)}
      onMoved={(day) => {
        setMoving(null);
        setMoved((current) => ({ text: movedWords(formatDay(day)), at: (current?.at ?? 0) + 1 }));
        reloadLayer();
        setPlanRound((round) => round + 1);
      }}
    />
  ) : null;

  const head = (
    <header className="td-head">
      <p className="td-date td-rise">{todayLine()}</p>
      <h1 className="sf-h1 td-h1 td-rise" data-d="1">
        <Greeting text={newAccount ? startGreeting(user?.user_metadata?.full_name) : greeting(user?.user_metadata?.full_name)} />
      </h1>
    </header>
  );

  let content: ReactNode;
  if (waiting) {
    content = (
      <div className="td-head" role="status" aria-label="Загружаем «Сегодня»">
        {loadingLine ? <p className="td-loading">Загружаем страницу…</p> : null}
      </div>
    );
  } else if ((loadError || !data) && on && planned.length > 0) {
    // Without network (or any failed read of the page) the exam containers still come from the device's copy: their
    // card leads, and the rest of the page says it did not load, with a quiet «Повторить» (spec decision 31) — once
    // its reads gave up; while they still try, the card stands alone.
    const alone = todayOf(null);
    content = (
      <>
        {head}
        <div className="tdc-alone td-grid">
          <div className="td-main tdc-main">
            {alone.main?.kind === 'container' ? (
              <QuietBoundary key={alone.main.item.container.id}>
                <TodayExamCard
                  container={alone.main.item.container}
                  plan={alone.main.item.plan.status === 'ready' ? alone.main.item.plan.plan : null}
                  questions={alone.main.item.plan.status === 'ready' ? alone.main.item.plan.questions ?? null : null}
                  offline={on.offline || (alone.main.item.plan.status === 'ready' && alone.main.item.plan.offline)}
                  lead={alone.mainLeads}
                />
              </QuietBoundary>
            ) : null}
            {alone.rows.length > 0 ? <TodayRows rows={alone.rows} exam={null} today={dayKey} /> : null}
          </div>
          {loadError || !loading ? (
            <section className="td-card td-error td-rise" data-d="3">
              <h2 className="td-h3">Не удалось загрузить данные</h2>
              <p className="td-error-text" role="alert">
                Лекции и карточки на месте. Повторите через минуту.
              </p>
              <button type="button" className={alone.mainLeads ? 'sf-link' : 'sf-primary'} onClick={() => void load()}>
                Повторить
              </button>
            </section>
          ) : null}
        </div>
      </>
    );
  } else if (loadError || !data) {
    content = (
      <>
        {head}
        <section className="td-card td-error td-rise" data-d="2">
          <h2 className="td-h2">Не удалось загрузить данные</h2>
          <p className="td-error-text" role="alert">
            Лекции и карточки на месте. Повторите через минуту.
          </p>
          <button type="button" className="sf-primary" onClick={() => void load()}>
            Повторить
          </button>
        </section>
      </>
    );
  } else {
    content = (
      <>
        {head}
        {stepsShown ? <FirstStepsCard steps={steps} folded={stepsFolded} lead={stepsLead} onToggle={toggleSteps} /> : null}
        {/* A new account has only the steps: the desk would be empty cards and zeros. */}
        {newAccount && stepsLead ? null : (
          <Desk
            data={data}
            narrow={frame.size === 's'}
            phone={phone}
            lead={!stepsLead}
            onRetry={() => void load()}
            activity={<Activity days={days} streak={streak} phone={phone} />}
            lectures={<Lectures data={data} phone={phone} syncing={syncing} syncError={syncError} onAdd={(material) => void addCardsToReview(material)} />}
            containers={containerSlots}
          />
        )}
      </>
    );
  }

  return (
    <div className="sf-page td" ref={frame.ref} data-frame={frame.size}>
      {/* The exam containers' reads: they draw nothing (containerLayer.tsx). */}
      {probe}
      {planSources}
      <div className="td-in">{content}</div>
      {moveDialog}
    </div>
  );
}

/** The tick of a done step (aria-hidden: «Сделано» says it in words). */
function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

interface StepView {
  key: 'lecture' | 'list' | 'answer';
  title: string;
  text: string;
  done: boolean;
  /** The step's one action; null when it cannot be taken yet (with `wait` saying why). */
  action: { to: string; label: string } | null;
  wait?: string;
}

/**
 * The three steps in the order of «Новый экзамен» (1 the list, 2 the lectures, then the answers), with what each
 * one does next (audit of 2026-10-08: «Добавить лекцию» as step 1 led to /exams/new#lectures, whose first step asks
 * for the list and has no lectures block).
 */
export function firstStepViews(steps: FirstSteps): StepView[] {
  const today = todaysStepViews(steps);
  if (!steps.neutral) return today;
  // Spec decision 25 (Concept 1 §3.10, the design critique's words): one door for every file, and the lecture and
  // ticket steps only for an account with oral questions.
  const list: StepView = {
    key: 'list',
    title: 'Добавьте вопросы к экзамену',
    text: 'Один общий файл или по файлу на предмет. Если у вопросов есть варианты, ключ Meldy возьмёт из файла.',
    done: steps.list,
    action: { to: '/exams/import', label: 'Новый экзамен' },
  };
  return steps.oral ? [list, today[1], today[2]] : [list];
}

function todaysStepViews(steps: FirstSteps): StepView[] {
  return [
    {
      key: 'list',
      title: 'Вставьте список вопросов к экзамену',
      text: 'Скопируйте его из файла кафедры или выберите сам файл. Meldy найдёт вопросы, разделы и билеты.',
      done: steps.list,
      action: { to: '/exams/new', label: 'Создать экзамен' },
    },
    {
      key: 'lecture',
      title: 'Добавьте лекции',
      text: 'Файлы лекций с текстом: PDF, DOCX, PPTX, TXT или MD. Meldy возьмёт текст без расхода лимита и сверит с ним каждый вопрос: есть, частично или нет.',
      done: steps.lecture,
      // Free and straight to the core: the lectures of the exam in its editor, with their text-only import — not
      // the analysis (/analyze: 20 units a lecture, live run of 07.10 — three answers left on FREE after it).
      // Without an exam the lectures come in the new exam itself, right after its list.
      action: steps.drawExamId ? { to: `/exams/${steps.drawExamId}/edit#lectures`, label: 'Добавить лекции' } : null,
      wait: 'Их добавляют в новом экзамене — сразу после списка вопросов.',
    },
    {
      key: 'answer',
      title: 'Вытяните билет и ответьте',
      text: 'Голосом или текстом, как на экзамене. Экзаменатор задаст дополнительный вопрос по тому, что вы пропустили.',
      done: steps.answer,
      action: steps.drawExamId ? { to: `/exams/${steps.drawExamId}/draw`, label: 'Тянуть билет' } : null,
      wait: 'Станет доступно, когда появится список вопросов.',
    },
  ];
}

/**
 * «Первые шаги»: the three steps of the core with their state and one action each — the next step's
 * action is the page's blue pill while the card is unfolded. Without a list, «Попробовать на примере»
 * opens the sample exam. The card folds to one line (remembered on this device).
 */
function FirstStepsCard({ steps, folded, lead, onToggle }: { steps: FirstSteps; folded: boolean; lead: boolean; onToggle: () => void }) {
  const listId = useId();
  const views = firstStepViews(steps);
  const done = firstStepsDone(steps);
  const next = views.findIndex((view) => !view.done);
  return (
    <section className="td-card td-fs td-rise" data-d="2" data-folded={folded ? '' : undefined} aria-labelledby="td-fs-h">
      <div className="td-fs-head">
        <h2 className="td-fs-h" id="td-fs-h">
          Первые шаги
        </h2>
        {/* One step has no «Сделано 0 из 1» (design critique I15). */}
        {views.length > 1 ? (
          <p className="td-fs-progress">
            <span className="td-fs-count">{`Сделано ${done} из ${views.length}`}</span>
            <span className="td-fs-meter" aria-hidden="true">
              {views.map((view) => (
                <i key={view.key} data-done={view.done ? '' : undefined} />
              ))}
            </span>
          </p>
        ) : null}
        <button type="button" className="td-fs-toggle" aria-expanded={!folded} aria-controls={folded ? undefined : listId} onClick={onToggle}>
          {folded ? 'Развернуть' : 'Свернуть'}
        </button>
      </div>
      {folded ? null : (
        <ol className="td-fs-list" id={listId} data-steps={views.length === 3 ? undefined : views.length}>
          {views.map((view, index) => {
            const state = view.done ? 'done' : index === next ? 'next' : 'later';
            const primary = lead && state === 'next';
            return (
              <li key={view.key} className="td-fs-step" data-state={state}>
                <span className="td-fs-n" aria-hidden="true">
                  {view.done ? <TickIcon /> : index + 1}
                </span>
                <div className="td-fs-body">
                  <h3 className="td-fs-step-h">
                    {glue(view.title)}
                    <span className="sr-only">{view.done ? ' — сделано' : ' — ещё не сделано'}</span>
                  </h3>
                  <p className="td-fs-p">{glue(view.text)}</p>
                  <div className="td-fs-acts">
                    {view.done ? (
                      <span className="td-fs-done" aria-hidden="true">
                        Сделано
                      </span>
                    ) : view.action ? (
                      <Link className={primary ? 'sf-primary' : 'sf-secondary td-pill'} data-size="s" to={view.action.to}>
                        {view.action.label}
                        {primary ? null : <PillDot />}
                      </Link>
                    ) : (
                      <p className="td-fs-wait">{glue(view.wait ?? '')}</p>
                    )}
                    {/* No list at hand yet: the sample exam shows the whole way first. */}
                    {view.key === 'list' && !view.done ? (
                      <Link className="sf-link td-fs-try" data-muted="" to="/try">
                        Попробовать на примере
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * A link as the page's one blue pill, or as the white pill with the dark circle when something else leads — on a phone
 * (`quiet`) as a quiet underlined link then: one pill on the screen.
 */
function ActionLink({
  to,
  blue,
  quiet = false,
  size,
  describedBy,
  onClick,
  children,
}: {
  to: string;
  blue: boolean;
  quiet?: boolean;
  size?: 's';
  describedBy?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  if (quiet && !blue) {
    return (
      <Link className="sf-link td-alt" to={to} aria-describedby={describedBy} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <Link className={blue ? 'sf-primary' : 'sf-secondary td-pill'} data-size={size} to={to} aria-describedby={describedBy} onClick={onClick}>
      {children}
      {blue ? null : <PillDot />}
    </Link>
  );
}

export type LecturePlace = 'main' | 'below';

/** A difference in holes smaller than this keeps the lectures where they are, so they do not jump back and forth. */
const PLACE_SLACK_PX = 32;
/** The two-column layout of Dashboard.css; narrower screens show the exam, the side and the lectures one under another. */
const WIDE_QUERY = '(min-width: 1200px)';

/**
 * Where the lectures go on a wide screen, from the bottoms of the blocks measured with the lectures under the exam:
 * under the exam (the main column) or across the page under both columns, whichever leaves the smaller hole beside
 * the shorter column. A short exam card beside a tall side gets the lectures under it; a tall one keeps them below.
 */
export function lecturePlace(bottoms: { main: number; side: number; column: number }, was: LecturePlace = 'main'): LecturePlace {
  const underExam = Math.abs(bottoms.column - bottoms.side);
  const across = Math.abs(bottoms.side - bottoms.main);
  if (was === 'below') return across <= underExam + PLACE_SLACK_PX ? 'below' : 'main';
  return across + PLACE_SLACK_PX < underExam ? 'below' : 'main';
}

/** Some browsers have no matchMedia or throw from it (see themeInit): then the layout is taken as narrow. */
function wideScreen(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Sets data-lectures on the grid before the paint: measured after every render, on a resize and once the fonts are in.
 * The attribute is read only by the wide layout (Dashboard.css), so narrow screens keep the page order.
 */
function useLecturePlace(grid: RefObject<HTMLDivElement | null>) {
  const place = useCallback(() => {
    const el = grid.current;
    if (!el || !wideScreen()) return;
    const block = (name: string) => Array.from(el.children).find((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains(name));
    const main = block('td-main');
    const side = block('td-side');
    const lectures = block('td-lectures');
    if (!main || !side || !lectures) return;
    const was: LecturePlace = el.dataset.lectures === 'below' ? 'below' : 'main';
    el.dataset.lectures = 'main';
    const bottom = (node: HTMLElement) => node.offsetTop + node.offsetHeight;
    el.dataset.lectures = lecturePlace({ main: bottom(main), side: bottom(side), column: bottom(lectures) }, was);
  }, [grid]);

  useLayoutEffect(place);

  useEffect(() => {
    const el = grid.current;
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) place();
    });
    const observer = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
    if (el) observer?.observe(el);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [grid, place]);
}

/**
 * The main card (the exam, or today's cards when there is no exam) and beside it the task cards; the lectures under
 * the main card or across the page, wherever they leave the smaller hole (owner, 2026-10-05: «нормально что снизу
 * пустое место?»). The order in the page is the main card, the task cards, the lectures, also on narrow screens.
 * `lead` false: «Первые шаги» hold the page's blue pill, so the desk's actions are white pills.
 */
function Desk({
  data,
  narrow,
  phone,
  lead,
  onRetry,
  activity,
  lectures,
  containers,
}: {
  data: DashboardData;
  /** The page frame is narrower than 640 px: the ribbon goes in rows of 10. */
  narrow: boolean;
  /** A phone (usePhone): every card cut to its core. */
  phone: boolean;
  lead: boolean;
  onRetry: () => void;
  activity: ReactNode;
  lectures: ReactNode;
  /** The account has exam containers with something today: what leads the main column, and the quiet rows under it. */
  containers?: ContainerSlots;
}) {
  const { exam, dueCount, dueCards } = data;
  const grid = useRef<HTMLDivElement>(null);
  useLecturePlace(grid);
  const titles = useMemo(() => new Map(data.lectures.map((lecture) => [lecture.id, displayMaterialTitle(lecture.title)])), [data.lectures]);
  const firstQuestion = dueCards.find((card) => typeof card.question === 'string' && card.question.trim() !== '')?.question ?? '';
  const lecturesText = dueLecturesText(dueCards, titles, dueCount);
  // Without containers: today's page. With them the main column leads with the exam of either kind (or nothing).
  const mainKind = containers ? containers.main : exam ? 'oral' : 'none';
  const withMain = mainKind === 'oral' ? Boolean(exam) : mainKind === 'container';
  const examPrimary = mainKind === 'container' ? Boolean(containers?.mainLeads) : Boolean(exam && exam.questions.length > 0);

  let cards: ReactNode = null;
  if (dueCount > 0 && withMain && phone) {
    // A phone: the count and the time in one line; no picture, no lectures (they are in «Повторение»). The action is a
    // quiet link unless it is the page's one blue pill (an exam without questions): one pill on the first screen.
    cards = (
      <article className="td-card td-due td-rise" data-d="3" data-phone="" aria-labelledby="td-due-h">
        <h2 className="td-h3" id="td-due-h">
          Повторение
        </h2>
        <p className="td-meta">{glue(dueLine(dueCount))}</p>
        <ActionLink to="/review" blue={lead && !examPrimary} quiet size="s">
          Начать повторение
        </ActionLink>
      </article>
    );
  } else if (withMain && phone) {
    // Nothing due: one line instead of a card with a flag.
    cards = (
      <p className="td-card td-due td-due-none td-rise" data-d="3" data-phone="">
        Карточек к повторению на сегодня нет.
      </p>
    );
  } else if (dueCount > 0 && withMain) {
    const [count, ...words] = dueTitle(dueCount).split(' ');
    cards = (
      <article className="td-card td-due td-rise" data-d="3" data-split={firstQuestion ? '' : undefined} aria-labelledby="td-due-h">
        {firstQuestion ? <CardStack question={firstQuestion} /> : null}
        <div className="td-due-body">
          <span className="td-flag" data-tone="b">
            Повторение
          </span>
          <h2 className="td-count" id="td-due-h">
            <span className="td-count-n">{count}</span> {words.join(' ')}
          </h2>
          <p className="td-meta">{glue([reviewTime(dueCount), lecturesText].filter(Boolean).join(' '))}</p>
          <ActionLink to="/review" blue={lead && !examPrimary} size="s">
            Начать повторение
          </ActionLink>
        </div>
      </article>
    );
  } else if (withMain) {
    cards = (
      <article className="td-card td-due td-due-none td-rise" data-d="3" aria-label="Карточки на сегодня">
        <span className="td-flag" data-tone="b">
          Повторение
        </span>
        <p className="td-body td-quiet">Карточек к повторению на сегодня нет.</p>
      </article>
    );
  }

  const noExam = <NoExam data={data} phone={phone} lead={lead} onRetry={onRetry} firstQuestion={firstQuestion} lecturesText={lecturesText} />;
  let main: ReactNode = exam ? <ExamBlock exam={exam} narrow={narrow} phone={phone} lead={lead} /> : noExam;
  if (containers) {
    const leading = mainKind === 'container' ? containers.card : mainKind === 'oral' && exam ? main : noExam;
    // The leading card and the quiet rows share the main column (the grid places its first child there).
    main =
      (mainKind === 'oral' && exam && !containers.rows) || (mainKind === 'none' && !containers.rows) ? (
        mainKind === 'none' ? noExam : main
      ) : (
        <div className="td-main tdc-main">
          {leading}
          {containers.rows}
        </div>
      );
  }

  return (
    <div className="td-grid" ref={grid}>
      {main}
      <div className="td-side">
        {cards}
        {activity}
      </div>
      {lectures}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Exam containers on «Сегодня» (spec decisions 2, 31, 33, 47; Concept 1 §3.10, design critique I3)

/** How long the page waits for the containers' plans before it draws them without (the card then shows its own wait). */
export const PLAN_WAIT = { ms: 3000 };

/** A container's plan for today; with it, the exam's size as its page says it (`questions`, oral questions included). */
export type PlanResult = { status: 'loading' } | { status: 'ready'; plan: DayPlan; offline: boolean; questions?: number } | { status: 'failed' };
const PLAN_LOADING: PlanResult = { status: 'loading' };
const PLAN_FAILED: PlanResult = { status: 'failed' };
const NO_CONTAINERS: OverviewContainer[] = [];
const PLAN_STATES = new Set(['study', 'done', 'nothing', 'exam_today', 'after', 'empty']);

/**
 * The same plan as before, by content: a hook that hands over a new plan input on every render must not make the page
 * render again and again (each new input gives an equal plan, and nothing changes).
 */
function samePlanResult(a: PlanResult | undefined, b: PlanResult): boolean {
  if (!a || a.status !== b.status) return false;
  if (a.status === 'ready' && b.status === 'ready') {
    return a.offline === b.offline && a.questions === b.questions && (a.plan === b.plan || JSON.stringify(a.plan) === JSON.stringify(b.plan));
  }
  return true;
}

/**
 * One container's plan for today: package D1's data (from the device's copy without network), package D2's planDay.
 * A new `round` (an exam moved on «Сегодня») reads it again; the plan in hand stays until the new one comes.
 */
function PlanSource({ id, onPlan, round = 0 }: { id: string; onPlan: (id: string, result: PlanResult) => void; round?: number }) {
  const loadable = useContainerData(id);
  const { data, loading, offline, unavailable } = loadable ?? { data: null, loading: false, offline: false, unavailable: true };
  const reload = loadable?.reload;
  const readAt = useRef(round);
  useEffect(() => {
    if (readAt.current === round) return;
    readAt.current = round;
    reload?.();
  }, [round, reload]);
  const planInput = data?.planInput;
  const summary = data?.summary;
  useEffect(() => {
    if (!planInput) {
      onPlan(id, loading && !unavailable ? PLAN_LOADING : PLAN_FAILED);
      return;
    }
    let plan: DayPlan | null = null;
    try {
      plan = planDay(planInput);
    } catch (error) {
      console.error('The plan of an exam container failed; «Сегодня» goes on without it:', error);
    }
    // The exam's size as its page says it (oral questions included: the overview has no oral counts).
    let questions: number | undefined;
    try {
      questions = summary ? examQuestions(summary) : undefined;
    } catch {
      questions = undefined;
    }
    onPlan(
      id,
      plan && typeof plan === 'object' && PLAN_STATES.has(plan.state)
        ? { status: 'ready', plan, offline: Boolean(offline), ...(questions === undefined ? {} : { questions }) }
        : PLAN_FAILED,
    );
  }, [id, planInput, summary, loading, offline, unavailable, onPlan]);
  return null;
}

export interface TodayContainer {
  container: OverviewContainer;
  plan: PlanResult;
}
export type TodayEntry = { kind: 'oral' } | { kind: 'container'; item: TodayContainer };
export interface TodayLayout {
  /** The card at the top: the oral exam (today's ExamBlock), a container (TodayExamCard), or none (today's NoExam). */
  main: TodayEntry | null;
  /** The main card holds the page's one blue button. */
  mainLeads: boolean;
  /** The other exams with something today, nearest date first: one quiet row each. */
  rows: TodayEntry[];
}

type ContainerState = DayPlan['state'] | 'failed';

/** A container's state today: its plan's; before the plan, the overview's guess (questions with a key: work today). */
function containerState(item: TodayContainer, today: string): ContainerState {
  if (item.plan.status === 'ready') return item.plan.plan.state;
  if (item.plan.status === 'failed') return 'failed';
  if (containerDays(item.container, today).past) return 'after';
  return item.container.subjects.some((subject) => subject.keyed > 0) ? 'study' : 'empty';
}

/** How long a passed exam stays on «Сегодня» as a quiet row with «Перенести» (release 47). */
export const PASSED_DAYS = 14;

/**
 * The exams whose dates have all passed within the last 14 days (owner, 2026-10-18: «Я зашел, а мне нельзя было
 * проходить, оказывается потому что уже 17 число»): the latest first. Older ones are in «Экзамены» only.
 */
export function recentlyPassed(containers: readonly OverviewContainer[], today: string): OverviewContainer[] {
  let from: string;
  try {
    from = shiftDateKey(today, -PASSED_DAYS);
  } catch {
    return [];
  }
  return containers
    .map((container) => ({ container, days: containerDays(container, today) }))
    .filter(({ days }) => days.past && days.day !== null && days.day >= from)
    .sort((a, b) => ((a.days.day ?? '') < (b.days.day ?? '') ? 1 : (a.days.day ?? '') > (b.days.day ?? '') ? -1 : 0))
    .map(({ container }) => container);
}

/**
 * Who leads «Сегодня» (Concept 1 §3.10, engineer I3): the nearest date among the exams that have something to do
 * today — the oral exam today's pick leads with (pickExam, exams inside containers left out), and every container
 * whose plan has work (or whose exam is today). It holds the one blue button, except on an exam's own day (no plan
 * then). With nothing to do anywhere, the nearest container whose day is done (or has nothing) still leads, without
 * the blue. The others with something today, a finished day, a day with nothing to do, or an unread plan are quiet
 * rows (containerRowMeta: a day off says «сегодня выходной» — usability check 2026-10-11, D1: on its day off an exam
 * left the page while another one had work); a container after its date, or without a question, is not on «Сегодня».
 * Ties: the newer exam first, as in pickExam.
 */
export function todayLayout(input: { oral: { examDate: string | null; createdAt: string } | null; containers: TodayContainer[]; today: string }): TodayLayout {
  interface Candidate {
    entry: TodayEntry;
    date: string | null;
    created: string;
    leads: boolean;
    state: ContainerState | 'oral';
  }
  const byDate = (a: Candidate, b: Candidate) => {
    const left = a.date ?? '9999-12-31';
    const right = b.date ?? '9999-12-31';
    if (left !== right) return left < right ? -1 : 1;
    return a.created > b.created ? -1 : a.created < b.created ? 1 : 0;
  };
  const all: Candidate[] = input.containers
    .map((item): Candidate => {
      const state = containerState(item, input.today);
      return { entry: { kind: 'container', item }, date: containerDays(item.container, input.today).day, created: item.container.created_at, leads: state === 'study', state };
    })
    .filter((candidate) => candidate.state !== 'after');
  const oral: Candidate | null = input.oral ? { entry: { kind: 'oral' }, date: input.oral.examDate, created: input.oral.createdAt, leads: true, state: 'oral' } : null;

  const today = [...(oral ? [oral] : []), ...all.filter((candidate) => candidate.state === 'study' || candidate.state === 'exam_today')].sort(byDate);
  const quietMain = all.filter((candidate) => candidate.state === 'done' || candidate.state === 'nothing' || candidate.state === 'empty').sort(byDate);
  const main = today[0] ?? quietMain[0] ?? null;
  const rows = [...today, ...all.filter((candidate) => candidate.state === 'done' || candidate.state === 'nothing' || candidate.state === 'failed')]
    .filter((candidate, index, list) => candidate !== main && list.indexOf(candidate) === index)
    .sort(byDate);
  return { main: main?.entry ?? null, mainLeads: Boolean(main && main.leads && today[0] === main), rows: rows.map((row) => row.entry) };
}

/** What a page with containers puts in its main column (Desk). */
interface ContainerSlots {
  main: 'oral' | 'container' | 'none';
  mainLeads: boolean;
  card: ReactNode;
  rows: ReactNode;
}

/** «около 20 минут», rounded as every plan line rounds its minutes (lib/containers/words.shownMinutes). */
export function aboutMinutes(seconds: number): string {
  return `около ${glueCount(Math.max(1, shownMinutes(seconds)), 'минуты', 'минут', 'минут')}`;
}

/**
 * «12 января · сегодня около 20 минут», «… · на сегодня всё», «… · сегодня выходной» (a day off with nothing answered;
 * answered anyway, the day is done), «… · сегодня экзамен», or the size: before a plan, and on a study day with nothing
 * to do and nothing done.
 */
export function containerRowMeta(item: TodayContainer, today: string, now: Date = new Date()): string {
  const { day } = containerDays(item.container, today);
  const parts = [formatDay(day, now)];
  const plan = item.plan.status === 'ready' ? item.plan.plan : null;
  if (plan?.state === 'study') parts.push(`сегодня ${aboutMinutes(plan.counts.leftSec > 0 ? plan.counts.leftSec : plan.counts.estSec)}`);
  else if (plan?.state === 'done') parts.push('на сегодня всё');
  else if (plan?.state === 'nothing' && isDayOff(plan)) parts.push('сегодня выходной');
  else if (plan?.state === 'exam_today') parts.push('сегодня экзамен');
  else {
    // The exam's one size, as its page says it (oral questions included); none until it is known.
    const size = overviewQuestions(item.container, item.plan.status === 'ready' ? item.plan.questions : null);
    if (size !== null && size > 0) parts.push(`${size} ${pluralRu(size, QUESTION_FORMS)}`);
  }
  return parts.filter(Boolean).join(' · ');
}

/** The oral exam as a quiet row: its day and today's step («можно стереть строки у 4 вопросов»), else its size. */
function OralTodayRow({ exam }: { exam: TodayExam }) {
  const tally = coverageTally(exam.questions);
  const mapped = tally.total > 0 && tally.unmapped < tally.total;
  const sheet = useSheetToday(mapped ? exam.id : null, exam.examDate);
  const erasable = sheet?.erasable.questions.length ?? 0;
  const step =
    erasable > 0
      ? `можно стереть строки у ${erasable} ${pluralRu(erasable, ['вопроса', 'вопросов', 'вопросов'])}`
      : tally.total > 0
        ? `${tally.total} ${pluralRu(tally.total, QUESTION_FORMS)}`
        : '';
  const meta = [formatDay(exam.examDate), step].filter(Boolean).join(' · ');
  return (
    <li className="tdc-row">
      <Link className="tdc-link" to={`/exams/${exam.id}`}>
        <span className="tdc-t">{glue(subjectOf(exam.title))}</span>
        {meta ? <span className="tdc-m">{glue(meta)}</span> : null}
        <ArrowIcon className="td-arrow tdc-go" />
      </Link>
    </li>
  );
}

/**
 * A passed exam as a quiet row: «Экзамен «Осенняя сессия» прошёл 17 октября · Перенести» — the words lead to its page,
 * «Перенести» opens «Перенести экзамен» (release 47).
 */
function PassedRow({ container, today, onMove }: { container: OverviewContainer; today: string; onMove: (container: OverviewContainer) => void }) {
  const textId = useId();
  const { day } = containerDays(container, today);
  return (
    <li className="tdc-row tdc-passed">
      <p className="tdc-passed-line">
        <Link className="tdc-passed-link" id={textId} to={`/exams/c/${encodeURIComponent(container.id)}`}>
          {glue(`Экзамен «${container.title}» прошёл ${formatDay(day)}`)}
        </Link>
        <span aria-hidden="true">{' · '}</span>
        <button type="button" className="sf-link tdc-passed-move" aria-haspopup="dialog" aria-describedby={textId} onClick={() => onMove(container)}>
          {MOVE_SHORT}
        </button>
      </p>
    </li>
  );
}

/** The other exams with something today: rows of one card, no pill (the page's blue button is the leading card's). */
function TodayRows({
  rows,
  exam,
  today,
  passed = [],
  onMove,
}: {
  rows: TodayEntry[];
  exam: TodayExam | null;
  today: string;
  /** Exams passed in the last 14 days, under the others (recentlyPassed). */
  passed?: readonly OverviewContainer[];
  onMove?: (container: OverviewContainer) => void;
}) {
  return (
    <section className="td-card tdc-rows td-rise" data-d="3" aria-label="Другие экзамены">
      <ul className="tdc-list">
        {rows.map((row) =>
          row.kind === 'oral' ? (
            exam ? <OralTodayRow key={`o:${exam.id}`} exam={exam} /> : null
          ) : (
            <li key={`c:${row.item.container.id}`} className="tdc-row">
              <Link className="tdc-link" to={`/exams/c/${encodeURIComponent(row.item.container.id)}`}>
                <span className="tdc-t">{glue(row.item.container.title)}</span>
                <span className="tdc-m">{glue(containerRowMeta(row.item, today))}</span>
                <ArrowIcon className="td-arrow tdc-go" />
              </Link>
            </li>
          ),
        )}
        {onMove ? passed.map((container) => <PassedRow key={`p:${container.id}`} container={container} today={today} onMove={onMove} />) : null}
      </ul>
    </section>
  );
}

/**
 * «Сегодня-lite» (2026-10-07) with nothing to erase now: when the next lines can be erased, if any line waits for
 * that — a quiet line under the cheat sheet's count. When an answer can erase lines now (lib/exams/cheatSheet.
 * erasableNow: a rubbed line named on another day and 20 hours ago, or a line due for its check), the card's next
 * step says it itself (ExamBlock): «Сегодня можно стереть строки шпаргалки у 4 вопросов…» with the one main action
 * «Тянуть билет из них» into the draw «Ждут подтверждения» — audit of 2026-10-08: «Можно стереть: 4 вопроса ·
 * Ответить» beside «Тянуть билет» read as «удалить 4 вопроса» and gave two look-alike buttons.
 */
function NextEraseLine({ erasable }: { erasable: ErasableNow }) {
  if (erasable.questions.length > 0) return null;
  const next = nextErasableLine(erasable.next);
  return next ? <p className="td-note td-erase-next">{glue(next)}</p> : null;
}

function ExamBlock({ exam, narrow, phone, lead }: { exam: TodayExam; narrow: boolean; phone: boolean; lead: boolean }) {
  const eraseId = useId();
  const tally = coverageTally(exam.questions);
  const total = tally.total;
  const mapped = total > 0 && tally.unmapped < total;
  // The exam page's status leads the same way (components/exams/examStatus.ts): before the first mapping its sheet
  // offers «Сверить с лекциями», and when (almost) every question is in no lecture — the exam's lectures; answering
  // is not the next step then, and a «0 %» says nothing.
  const nothingFound = mostlyNone(tally);
  const neverMapped = total > 0 && !mapped;
  const gap = mapped && tally.none > 0 ? withoutMaterialLine(tally.none) : null;
  const figure = nothingFound ? null : shareFigure(exam.questions, exam.layout);
  const answers = answersSentence(exam.questions, exam.events);
  // With the large figure the share is said by it; otherwise («Сверки с лекциями ещё не было.») by the sentence.
  const sentence = (figure || nothingFound ? [answers] : [shareSentence(exam.questions, exam.layout), answers]).filter(Boolean).join(' ');
  const note = recentNote(exam.questions, exam.events);
  const meta = examMeta({ examDate: exam.examDate, layout: exam.layout, total });
  const heading = examHeadingParts({ title: exam.title, kind: exam.kind, daysLeft: exam.daysLeft });
  const soon = exam.daysLeft !== null && exam.daysLeft <= 3;
  const drawWord = exam.layout.mode !== 'fixed' && exam.layout.per_ticket === 1 ? 'Тянуть вопрос' : 'Тянуть билет';
  // «Шпаргалка: 39 строк осталось из 47» once the exam's cheat sheet has lines (sheet spec 4.4), under it when the next
  // lines can be erased (Сегодня-lite), then the two ways back on another day: the student's own calendar
  // («Напоминать каждый день») and, for the author of an open group link, «Скопировать вопрос дня».
  const sheet = useSheetToday(mapped ? exam.id : null, exam.examDate);
  const sheetCounts = sheet?.counts ?? null;
  // Questions whose cheat-sheet lines an answer erases now: then the draw from exactly them is the next step.
  const canDraw = total > 0 && !neverMapped && !nothingFound;
  const erasable = canDraw ? sheet?.erasable.questions.length ?? 0 : 0;
  const sheetLine = sheetCounts ? (
    <p className="td-sheet">
      <Link className="td-sheet-link" to={`/exams/${exam.id}?view=sheet`}>
        {/* The count holds together: a narrow card breaks after «Шпаргалка:», not inside «осталось из 47». */}
        <span>
          Шпаргалка: <span className="td-nowrap">{glue(`${sheetCounts.left} ${counterLabel(sheetCounts)}`)}</span>
        </span>
        <ArrowIcon className="td-arrow" />
      </Link>
    </p>
  ) : null;
  const sheetLines = sheet ? (
    <>
      {sheetLine}
      <NextEraseLine erasable={sheet.erasable} />
      <div className="td-back">
        <DailyReminder variant="today" examId={exam.id} />
        <QuestionOfDay examId={exam.id} examTitle={exam.title} questions={sheet.questions} from="today" />
      </div>
    </>
  ) : null;
  const ready = Boolean(figure) || mapped || Boolean(sentence) || Boolean(note);

  // The next step, right under the exam's name and date, so it is on the first screen at every size; the page's
  // one blue pill (white while «Первые шаги» lead). The exam page's status leads the same way (examStatus.ts).
  let primary: ReactNode = null;
  if (nothingFound) {
    primary = (
      <ActionLink to={`/exams/${exam.id}/edit#lectures`} blue={lead} quiet={phone}>
        Выбрать или добавить лекции
      </ActionLink>
    );
  } else if (total === 0) {
    primary = (
      <ActionLink to={`/exams/${exam.id}/edit`} blue={lead} quiet={phone}>
        Добавить вопросы
      </ActionLink>
    );
  } else if (erasable > 0) {
    primary = (
      <ActionLink
        to={`/exams/${exam.id}/draw?mode=awaiting`}
        blue={lead}
        quiet={phone}
        describedBy={eraseId}
        onClick={() => track('today_erase_open', { questions: countBucket(erasable) })}
      >
        {`${drawWord} из них`}
      </ActionLink>
    );
  } else if (canDraw) {
    primary = (
      <ActionLink to={`/exams/${exam.id}/draw`} blue={lead} quiet={phone}>
        {drawWord}
      </ActionLink>
    );
  }
  const flag = heading.when ? (
    // The flag repeats the end of the heading, which screen readers already read in it.
    <span className="td-flag" data-tone={soon ? 'y' : 'g'} aria-hidden="true">
      {examFlag(heading.when)}
    </span>
  ) : null;
  const title = (
    <h2 className="td-h2" id="td-exam-h">
      {glue(heading.subject)}
      {/* The space stays outside the hidden part, so the name reads «… — экзамен через 12 дней». */}
      {heading.when ? ' ' : null}
      {heading.when ? <span className="sr-only">{glue(`— ${heading.when}`)}</span> : null}
    </h2>
  );

  if (phone) {
    // A phone: one line about today's step over the one action, «Лист экзамена» under it as a quiet link (before the
    // first mapping the sheet is the action itself), then the share, the questions without material and the cheat
    // sheet's count as lines. The dots, the legend, the answers and the note are on the exam's sheet; the next erase
    // time in its status; «Напоминать каждый день» in «Профиль».
    const metaShort = examMetaShort({ examDate: exam.examDate, total });
    const today = erasable > 0 ? erasableShort(erasable) : neverMapped ? shareSentence(exam.questions, exam.layout) : '';
    const rows = figure || gap || sheetCounts;
    // The arrow holds on to the count, so a line that has to wrap breaks after «Шпаргалка:» with the arrow at its end.
    const sheetRow = sheetCounts ? (
      <p className="td-sheet">
        <Link className="td-sheet-link" to={`/exams/${exam.id}?view=sheet`}>
          Шпаргалка:{' '}
          <span className="td-nowrap">
            {glue(`${sheetCounts.left} ${counterLabel(sheetCounts)}`)}
            <ArrowIcon className="td-arrow" />
          </span>
        </Link>
      </p>
    ) : null;
    return (
      <article className="td-card td-main td-exam td-rise" data-d="2" data-phone="" aria-labelledby="td-exam-h">
        {flag}
        {title}
        {metaShort ? <p className="td-meta">{glue(metaShort)}</p> : null}
        {total === 0 ? <p className="td-body">Вопросов в списке пока нет.</p> : null}
        <div className="td-next">
          {today ? (
            <p className="td-erase-t" id={erasable > 0 ? eraseId : undefined}>
              {glue(today)}
            </p>
          ) : null}
          <div className="td-actions">
            {primary ?? (
              <ActionLink to={`/exams/${exam.id}`} blue={lead} quiet>
                Лист экзамена
              </ActionLink>
            )}
            {primary ? (
              <Link className="sf-link td-alt" to={`/exams/${exam.id}`}>
                Лист экзамена
              </Link>
            ) : null}
          </div>
        </div>
        {rows ? (
          <div className="td-ready">
            {figure ? (
              <p className="td-share">
                <span className="td-share-fig">{figure.figure}</span> <span className="td-share-cap">{glue(figure.caption)}</span>
              </p>
            ) : null}
            {gap ? (
              <p className="td-gap">
                <Link className="td-gap-link" to={`/exams/${exam.id}?filter=cov:none`}>
                  {glue(gap.link)}
                  <ArrowIcon className="td-arrow" />
                </Link>
              </p>
            ) : null}
            {sheetRow}
          </div>
        ) : null}
        {/* The author of an open group link keeps «Скопировать вопрос дня» (nothing at all for anyone else). */}
        {sheet ? <QuestionOfDay examId={exam.id} examTitle={exam.title} questions={sheet.questions} from="today" /> : null}
      </article>
    );
  }

  const next = (
    <div className="td-next">
      {erasable > 0 ? (
        <p className="td-erase-t" id={eraseId}>
          {glue(erasableLine(erasable))}
        </p>
      ) : null}
      <div className="td-actions">
        {primary}
        <ActionLink to={`/exams/${exam.id}`} blue={lead && neverMapped}>
          Лист экзамена
        </ActionLink>
        {/* «Тянуть билет из них» leads; any ticket stays one quiet click away, as on the exam page. */}
        {erasable > 0 ? (
          <Link className="sf-link td-alt" to={`/exams/${exam.id}/draw`}>
            {drawWord}
          </Link>
        ) : null}
      </div>
    </div>
  );
  return (
    <article className="td-card td-main td-exam td-rise" data-d="2" aria-labelledby="td-exam-h">
      {flag}
      {title}
      {meta ? <p className="td-meta">{glue(meta)}</p> : null}
      {total === 0 ? <p className="td-body">Вопросов в списке пока нет.</p> : null}
      {next}
      {gap ? (
        <div className="td-gap">
          <Link className="td-gap-link" to={`/exams/${exam.id}?filter=cov:none`}>
            <span className="td-gap-dot" aria-hidden="true" />
            {glue(gap.link)}
            <ArrowIcon className="td-arrow" />
          </Link>
          <p className="td-gap-note">{glue(gap.note)}</p>
        </div>
      ) : null}
      {ready ? (
        <div className="td-ready">
          {figure ? (
            <p className="td-share">
              <span className="td-share-fig">{figure.figure}</span> <span className="td-share-cap">{glue(figure.caption)}</span>
            </p>
          ) : null}
          {mapped ? (
            <>
              <Ribbon examId={exam.id} questions={exam.questions} perRow={narrow ? 10 : 20} phone={narrow} />
              <Tally tally={tally} examId={exam.id} />
            </>
          ) : null}
          {sentence || note ? (
            <div className="td-answers">
              {sentence ? <p className="td-body">{glue(sentence)}</p> : null}
              {note ? <p className="td-note">{glue(note)}</p> : null}
            </div>
          ) : null}
          {sheetLines}
        </div>
      ) : (
        sheetLines
      )}
    </article>
  );
}

/**
 * Without an exam to lead with: today's cards first (the count, their lectures and the stack with the
 * first due question in one card), the question list one step away.
 */
function NoExam({
  data,
  phone,
  lead,
  onRetry,
  firstQuestion,
  lecturesText,
}: {
  data: DashboardData;
  phone: boolean;
  lead: boolean;
  onRetry: () => void;
  firstQuestion: string;
  lecturesText: string;
}) {
  const { dueCount, hasExams, examFailed } = data;
  // While «Первые шаги» lead (lead false), their step 2 offers the question list: it is not repeated here. On a phone
  // the way to the exams is a quiet link under the card's pill, not a second pill.
  const examsLink = examFailed ? (
    <p className="td-meta td-retry">
      Экзамены не загрузились.{' '}
      <button type="button" className="sf-link" onClick={onRetry}>
        Повторить
      </button>
    </p>
  ) : hasExams ? (
    phone ? (
      <Link className="sf-link td-alt" to="/exams">
        Экзамены
      </Link>
    ) : (
      <Link className="sf-secondary td-pill" to="/exams">
        Экзамены
        <PillDot />
      </Link>
    )
  ) : lead ? (
    phone ? (
      <Link className="sf-link td-alt" to="/exams/new">
        Вставить список вопросов к экзамену
      </Link>
    ) : (
      <Link className="sf-secondary td-pill" to="/exams/new">
        Вставить список вопросов к экзамену
        <PillDot />
      </Link>
    )
  ) : null;
  if (dueCount > 0 && phone) {
    // A phone: the same card as beside an exam — «Повторение», the count and the time in one line, the action (the blue
    // pill unless «Первые шаги» lead), the exams as a quiet link; no picture, no lectures.
    return (
      <article className="td-card td-main td-lead td-due td-rise" data-d="2" data-phone="" aria-labelledby="td-due-h">
        <h2 className="td-h3" id="td-due-h">
          Повторение
        </h2>
        <p className="td-meta">{glue(dueLine(dueCount))}</p>
        <div className="td-actions">
          <ActionLink to="/review" blue={lead} quiet size="s">
            Начать повторение
          </ActionLink>
          {examsLink}
        </div>
      </article>
    );
  }
  if (dueCount > 0) {
    const words = dueLead(dueCount);
    return (
      <article className="td-card td-main td-lead td-rise" data-d="2" data-split={firstQuestion ? '' : undefined} aria-label="На сегодня">
        <div className="td-lead-body">
          <span className="td-flag" data-tone="b" aria-hidden="true">
            На сегодня
          </span>
          <p className="td-big">
            {glue(words.count)} <span className="td-big-time">{words.time}</span>
          </p>
          {lecturesText ? <p className="td-meta td-due-from">{glue(lecturesText)}</p> : null}
          <div className="td-actions">
            <ActionLink to="/review" blue={lead}>
              Начать повторение
            </ActionLink>
            {examsLink}
          </div>
        </div>
        {firstQuestion ? <CardStack question={firstQuestion} /> : null}
      </article>
    );
  }
  return (
    <article className="td-card td-main td-lead td-rise" data-d="2" aria-label="На сегодня">
      <span className="td-flag" data-tone="b" aria-hidden="true">
        На сегодня
      </span>
      <p className="td-big">Карточек к повторению на сегодня нет.</p>
      {!hasExams && !examFailed ? (
        lead ? (
          <>
            <p className="td-body td-quiet">
              {glue('Вставьте вопросы к экзамену — Meldy отметит, какие из них есть в ваших лекциях.')}
            </p>
            <div className="td-actions">
              <Link className="sf-primary" to="/exams/new">
                Вставить список вопросов
              </Link>
            </div>
          </>
        ) : null
      ) : (
        <div className="td-actions">{examsLink}</div>
      )}
    </article>
  );
}

/**
 * Two weeks of review cards: a task card beside the main one. It counts cards only (study_sessions.cards_reviewed),
 * and says so: «Повторения… не было» beside «Сегодня: ответ на вопрос 1» read as if the answer had not counted (audit
 * of 2026-10-08); the answers to tickets are on the exam card.
 */
function Activity({ days, streak, phone }: { days: Array<{ key: string; value: number }>; streak: number; phone: boolean }) {
  const any = days.some((day) => day.value > 0);
  // A phone shows the two weeks only when there were reviews (an empty block is not shown there).
  if (phone && !any) return null;
  return (
    <section className="td-card td-activity td-rise" data-d="4" aria-labelledby="td-activity-h">
      <h2 className="td-h3" id="td-activity-h">
        Карточки за две недели
      </h2>
      {any ? (
        <>
          <p className="td-meta">{glue(activityLine(streak, days[days.length - 1].value))}</p>
          <DayBars days={days} tallest={phone ? 48 : 100} />
        </>
      ) : (
        <p className="td-meta">За две недели карточки не повторялись.</p>
      )}
    </section>
  );
}

function Lectures({
  data,
  phone,
  syncing,
  syncError,
  onAdd,
}: {
  data: DashboardData;
  phone: boolean;
  syncing: string | null;
  syncError: string | null;
  onAdd: (material: LectureDetail) => void;
}) {
  const count = data.lectures.length;
  if (phone) return <PhoneLectures data={data} syncing={syncing} syncError={syncError} onAdd={onAdd} />;
  return (
    <section className="td-sec td-lectures td-rise" data-d="5" aria-labelledby="td-lectures-h">
      <div className="td-sec-head">
        <h2 className="td-h2 td-sec-h" id="td-lectures-h">
          Лекции
        </h2>
        {count > 0 ? (
          <Link className="td-more" to="/library">
            {count > RECENT_LECTURES ? `Все ${count}` : 'Все лекции'}
            <ArrowIcon className="td-arrow" />
          </Link>
        ) : null}
      </div>
      {count === 0 ? (
        <div className="td-lecs-empty">
          <p className="td-meta">Лекций пока нет.</p>
          <Link className="td-add" to="/analyze">
            <span className="td-add-plus" aria-hidden="true">
              +
            </span>
            <span className="td-add-t">Разобрать лекцию</span>
            <span className="td-add-f">PDF, DOCX, PPTX, TXT, MD или аудио</span>
          </Link>
        </div>
      ) : (
        <ol className="td-lecs">
          {data.recent.map((material, index) => {
            const meta = lectureMeta(material);
            const missing = cardsMissingFromReview(material, data.materialsWithCards);
            const date = shortDate(material.created_at);
            return (
              <li key={material.id} className="td-lec" data-tone={index % 4}>
                <Link className="td-lec-link" to={`/library/${material.id}`}>
                  <span className="td-thumb" aria-hidden="true">
                    <span className="td-thumb-page" />
                  </span>
                  <span className="td-lec-title">{displayMaterialTitle(material.title)}</span>
                  {meta ? <span className="td-lec-meta">{glue(meta)}</span> : null}
                  {date ? <span className="td-lec-date">{date}</span> : null}
                </Link>
                {missing ? (
                  <p className="td-lec-note">
                    Карточки этой лекции не добавлены в повторение.{' '}
                    <button type="button" className="td-chip" disabled={syncing !== null} onClick={() => onAdd(material)}>
                      {syncing === material.id ? 'Добавляем…' : 'Добавить'}
                    </button>
                    {syncError === material.id ? <span role="alert"> Не получилось, попробуйте ещё раз.</span> : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * The lectures on a phone: rows in one card — the title and «8 карточек · тест · 2 окт.» — without the pictures; in the
 * head «Разобрать лекцию» (/analyze, the same words as at the top of «Лекции»: the top line has no «+ Лекция» on a phone)
 * and «Все 9» only when the page does not list them all (the «Лекции» tab is one tap away).
 */
function PhoneLectures({
  data,
  syncing,
  syncError,
  onAdd,
}: {
  data: DashboardData;
  syncing: string | null;
  syncError: string | null;
  onAdd: (material: LectureDetail) => void;
}) {
  const count = data.lectures.length;
  return (
    <section className="td-sec td-lectures td-rise" data-d="5" data-phone="" aria-labelledby="td-lectures-h">
      <div className="td-sec-head">
        <h2 className="td-h2 td-sec-h" id="td-lectures-h">
          Лекции
        </h2>
        <span className="td-sec-acts">
          <Link className="td-more td-new" to="/analyze">
            Разобрать лекцию
          </Link>
          {count > data.recent.length ? (
            <Link className="td-more" to="/library">
              {`Все ${count}`}
              <ArrowIcon className="td-arrow" />
            </Link>
          ) : null}
        </span>
      </div>
      {count === 0 ? (
        <p className="td-meta td-lecs-none">Лекций пока нет.</p>
      ) : (
        <ol className="td-lecs">
          {data.recent.map((material) => {
            const meta = lectureMetaShort(material);
            const missing = cardsMissingFromReview(material, data.materialsWithCards);
            return (
              <li key={material.id} className="td-lec">
                <Link className="td-lec-link" to={`/library/${material.id}`}>
                  <span className="td-lec-title">{displayMaterialTitle(material.title)}</span>
                  {meta ? <span className="td-lec-meta">{glue(meta)}</span> : null}
                </Link>
                {/* The cards not in review: one quiet action that says what it does (the computer has a note and «Добавить»). */}
                {missing ? (
                  <p className="td-lec-note">
                    <button type="button" className="sf-link" data-muted="" disabled={syncing !== null} onClick={() => onAdd(material)}>
                      {syncing === material.id ? 'Добавляем…' : 'Добавить карточки в повторение'}
                    </button>
                    {syncError === material.id ? <span role="alert">Не получилось, попробуйте ещё раз.</span> : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

