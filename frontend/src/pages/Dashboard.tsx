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
import { GRADE_WORDS, KIND_WORDS, daysUntil, formatDay, sheetHeader, subjectOf } from '../lib/exams/format';
import { allQuestionsWord, coverageShares, glue, layoutPhrase, numberOf, perTicketOf, shareText } from '../components/exams/sheetModel';
import { COVERAGE_MARK, markSeed, type CoverageMarkKind, type SheetCoverage } from '../components/exams/marks';
import { Mark } from '../components/marks';
import { useFrame } from '../components/exams/useFrame';
import { currentStreak, isDateKey, localDateKey, shiftDateKey } from '../utils/streak';
import { pluralRu } from '../components/conversation/visuals';
import type { StudySession } from '../types';
import '../styles/paper.css';
import './Dashboard.css';
import { displayMaterialTitle } from '../utils/materialTitle';
import { analysisCards } from '../utils/lectureCards';
import { track } from '../lib/telemetry';
import { useSheetCount } from '../components/exams/sheet/sheetCount';
import { counterLabel } from '../components/exams/sheet/copy';

/**
 * «Сегодня» in the Meldy language (prototype Today.dc.html, approved 2026-10-04; notes:
 * 10_Project/Design_Language_2026-10-04). The first screen after signing in and after registration.
 *
 * - The greeting with the date and one hand-drawn yellow line under «повторим».
 * - One main card of what to do now: the nearest exam (a flag with the days left, the subject, the
 *   meta line, «9 вопросов без материала» first, the share of tickets for the exam's own layout as
 *   the large figure, the list in miniature as status dots with the pencil marks, the answers line
 *   and a dated note about the last two days, «Тянуть билет»). Without an exam the cards lead.
 * - Beside it the task cards: today's review cards (a coloured panel with the first due question)
 *   and two weeks of reviews; below, the four latest lectures as cards.
 * - «Первые шаги» above it all until they are done: a lecture with text, a question list, a ticket
 *   answered — the first run around the core (owner, 2026-10-04). A new account sees only them. They
 *   can be folded (remembered per account on this device) and are gone once all three are done.
 * Every number on the page is read from the account; nothing is invented (no ticket numbers, no zeros
 * on an empty account).
 */

/** Exams dated from today up to this many days ahead lead «Сегодня». */
export const EXAM_HORIZON_DAYS = 21;
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

/** How many of the three steps are done. */
export function firstStepsDone(steps: FirstSteps): number {
  return Number(steps.lecture) + Number(steps.list) + Number(steps.answer);
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

/** «конспект · 8 карточек · тест · разговор» (only what exists) or «только текст, конспекта нет», as in the Library. */
export function lectureMeta(material: Pick<LectureDetail, 'summary_json' | 'flashcards_json' | 'quiz_json'>): string {
  const summary = isRecord(material.summary_json) ? material.summary_json : {};
  if (summary.text_only === true) return 'только текст, конспекта нет';
  const parts: string[] = [];
  if (typeof summary.content === 'string' && summary.content.trim() !== '') parts.push('конспект');
  const cards = analysisCards(material.flashcards_json).length;
  if (cards > 0) parts.push(`${cards} ${pluralRu(cards, CARD_FORMS)}`);
  const quiz = isRecord(material.quiz_json) && Array.isArray(material.quiz_json.quiz) ? material.quiz_json.quiz.length : 0;
  if (quiz > 0) parts.push('тест');
  if (Array.isArray(summary.podcast) && summary.podcast.length > 0) parts.push('разговор');
  return parts.join(' · ');
}

/** «2 окт.», with the year when it is not this year. */
function shortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale: ru });
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

/**
 * The exam «Сегодня» leads with: the nearest one dated from today up to three weeks ahead; without
 * one, the newest exam that has no date (a list pasted without a date is still the student's exam).
 */
export function pickExam(exams: Array<Pick<ExamRow, 'id' | 'exam_date' | 'created_at'>>, today: string = localDateKey()): string | null {
  const horizon = shiftDateKey(today, EXAM_HORIZON_DAYS);
  const near = exams
    .filter((exam) => isDateKey(exam.exam_date) && exam.exam_date >= today && exam.exam_date <= horizon)
    .sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : a.exam_date! > b.exam_date! ? 1 : a.created_at > b.created_at ? -1 : 1));
  if (near.length > 0) return near[0].id;
  const undated = exams.filter((exam) => !exam.exam_date).sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  return undated.length > 0 ? undated[0].id : null;
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

async function loadExam(userId: string, findList: boolean = false): Promise<ExamLoad> {
  const { data, error } = await supabase
    .from('exams')
    .select('id, title, kind, exam_date, mapped_at, ticket_layout, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const exams = (Array.isArray(data) ? data : []).map(normalizeExam).filter((row): row is ExamRow => row !== null);
  const id = pickExam(exams);
  const row = exams.find((exam) => exam.id === id);
  if (!row) {
    const listExamId = findList ? await examWithQuestions(exams.map((exam) => exam.id)) : undefined;
    return { exam: null, hasExams: exams.length > 0, listExamId };
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
async function loadDashboard(userId: string, withSteps: boolean): Promise<DashboardData> {
  const examPromise: Promise<ExamLoad & { failed: boolean }> = loadExam(userId, withSteps).then(
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
  const steps: FirstSteps | null =
    withSteps && !exam.failed && lectureText !== null && answered !== null && exam.listExamId !== undefined
      ? { lecture: lectureText, list: exam.listExamId !== null, answer: answered, drawExamId: exam.listExamId }
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

function gradeOf(event: LearningEvent): number | null {
  const raw = isRecord(event.payload) ? event.payload.grade : null;
  const grade = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(grade) && GRADE_WORDS[grade] ? grade : null;
}

function joinNumbers(numbers: string[]): string {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} и ${numbers[numbers.length - 1]}`;
}

/**
 * The dated note about the last two days (today and yesterday, local dates): the latest answer by
 * its question number and grade word, and the questions that became confirmed in these two days —
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
  const grade = gradeOf(latest);
  const head = grade ? `${day}: вопрос ${numberOf(answered)} — «${GRADE_WORDS[grade]}».` : `${day}: ответ на вопрос ${numberOf(answered)}.`;

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

/** «Около 6 минут.» at 30 seconds a card; «Около минуты.» for one or two cards. */
export function reviewTime(count: number): string {
  const minutes = Math.max(1, Math.ceil((count * SECONDS_PER_CARD) / 60));
  if (minutes === 1) return 'Около минуты.';
  const word = minutes % 10 === 1 && minutes % 100 !== 11 ? 'минуты' : 'минут';
  return `Около ${minutes} ${word}.`;
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
  parts.push(today > 0 ? `Сегодня — ${today} ${pluralRu(today, CARD_FORMS)}.` : 'Сегодня повторений ещё не было.');
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

/** Reviews per day as columns with the value above each, and a table for screen readers. */
function DayBars({ days }: { days: Array<{ key: string; value: number }> }) {
  const max = Math.max(1, ...days.map((day) => day.value));
  const last = days.length - 1;
  return (
    <>
      <div className="td-bars" aria-hidden="true">
        {days.map((day, index) => (
          <div key={day.key} className="td-bar" data-zero={day.value === 0 ? '' : undefined} data-today={index === last ? '' : undefined}>
            <span className="td-bar-v">{day.value}</span>
            <span className="td-bar-b" style={day.value > 0 ? { height: `${Math.max(3, Math.round((day.value / max) * 100))}px` } : undefined} />
          </div>
        ))}
      </div>
      <div className="td-axis" aria-hidden="true">
        <span>{shortDay(days[0].key)}</span>
        <span>сегодня</span>
      </div>
      <table className="sr-only">
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
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The page

export default function Dashboard() {
  const { user } = useAuth();
  const frame = useFrame<HTMLDivElement>();
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
      setData(await loadDashboard(user.id, readFirstStepsMemory(user.id) !== 'done'));
    } catch (error) {
      console.error('Loading «Сегодня» failed:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Once all three steps are done they are not read again on this device.
  const steps = data?.steps ?? null;
  const stepsFinished = steps !== null && firstStepsDone(steps) === 3;
  useEffect(() => {
    if (user?.id && stepsFinished) writeFirstStepsMemory(user.id, 'done');
    if (user?.id && stepsFinished) track('first_steps_done');
  }, [user?.id, stepsFinished]);

  const toggleSteps = () => {
    const next = !stepsFolded;
    setStepsFolded(next);
    if (user?.id) writeFirstStepsMemory(user.id, next ? 'collapsed' : null);
  };

  // Nothing for the first 300 ms, then one quiet line (spec 4.6): no spinner.
  useEffect(() => {
    if (!loading || data) {
      setLoadingLine(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadingLine(true), LOADING_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [loading, data]);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const todayKey = localDateKey();
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
  /** Unfolded, the steps hold the page's one blue button; the desk's actions step back to white pills. */
  const stepsLead = stepsShown && !stepsFolded;

  const head = (
    <header className="td-head">
      <p className="td-date td-rise">{todayLine()}</p>
      <h1 className="sf-h1 td-h1 td-rise" data-d="1">
        <Greeting text={newAccount ? startGreeting(user?.user_metadata?.full_name) : greeting(user?.user_metadata?.full_name)} />
      </h1>
    </header>
  );

  let content: ReactNode;
  if (loading && !data) {
    content = (
      <div className="td-head" role="status" aria-label="Загружаем «Сегодня»">
        {loadingLine ? <p className="td-loading">Загружаем страницу…</p> : null}
      </div>
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
            phone={frame.size === 's'}
            lead={!stepsLead}
            onRetry={() => void load()}
            activity={<Activity days={days} streak={streak} />}
            lectures={<Lectures data={data} syncing={syncing} syncError={syncError} onAdd={(material) => void addCardsToReview(material)} />}
          />
        )}
      </>
    );
  }

  return (
    <div className="sf-page td" ref={frame.ref} data-frame={frame.size}>
      <div className="td-in">{content}</div>
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

/** The three steps in their order, with what each one does next. */
export function firstStepViews(steps: FirstSteps): StepView[] {
  return [
    {
      key: 'lecture',
      title: 'Добавьте лекцию',
      text: 'Файл лекции с текстом: PDF, DOCX, PPTX, TXT или MD. Meldy возьмёт текст без расхода лимита и сверит с ним вопросы экзамена.',
      done: steps.lecture,
      // Free and straight to the core: «Новый экзамен» with its text-only import of lectures, not the
      // analysis (/analyze: 20 units a lecture, live run of 07.10 — three answers left on FREE after it).
      action: { to: '/exams/new#lectures', label: 'Добавить лекцию' },
    },
    {
      key: 'list',
      title: 'Вставьте список вопросов к экзамену',
      text: 'Meldy сверит каждый вопрос с вашими лекциями: есть, частично или нет.',
      done: steps.list,
      action: { to: '/exams/new', label: 'Создать экзамен' },
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
 * action is the page's blue pill while the card is unfolded. Without lectures, «Попробовать на
 * примере» opens the sample course. The card folds to one line (remembered on this device).
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
        <p className="td-fs-progress">
          <span className="td-fs-count">{`Сделано ${done} из ${views.length}`}</span>
          <span className="td-fs-meter" aria-hidden="true">
            {views.map((view) => (
              <i key={view.key} data-done={view.done ? '' : undefined} />
            ))}
          </span>
        </p>
        <button type="button" className="td-fs-toggle" aria-expanded={!folded} aria-controls={listId} onClick={onToggle}>
          {folded ? 'Развернуть' : 'Свернуть'}
        </button>
      </div>
      {folded ? null : (
        <ol className="td-fs-list" id={listId}>
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
                    {view.key === 'lecture' && !view.done ? (
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

/** A link as the page's one blue pill, or as the white pill with the dark circle when something else leads. */
function ActionLink({ to, blue, size, children }: { to: string; blue: boolean; size?: 's'; children: ReactNode }) {
  return (
    <Link className={blue ? 'sf-primary' : 'sf-secondary td-pill'} data-size={size} to={to}>
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
  phone,
  lead,
  onRetry,
  activity,
  lectures,
}: {
  data: DashboardData;
  phone: boolean;
  lead: boolean;
  onRetry: () => void;
  activity: ReactNode;
  lectures: ReactNode;
}) {
  const { exam, dueCount, dueCards } = data;
  const grid = useRef<HTMLDivElement>(null);
  useLecturePlace(grid);
  const titles = useMemo(() => new Map(data.lectures.map((lecture) => [lecture.id, displayMaterialTitle(lecture.title)])), [data.lectures]);
  const firstQuestion = dueCards.find((card) => typeof card.question === 'string' && card.question.trim() !== '')?.question ?? '';
  const lecturesText = dueLecturesText(dueCards, titles, dueCount);
  const examPrimary = Boolean(exam && exam.questions.length > 0);

  let cards: ReactNode = null;
  if (dueCount > 0 && exam) {
    const [count, ...words] = dueTitle(dueCount).split(' ');
    cards = (
      <article className="td-card td-due td-rise" data-d="3" aria-labelledby="td-due-h">
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
  } else if (exam) {
    cards = (
      <article className="td-card td-due td-due-none td-rise" data-d="3" aria-label="Карточки на сегодня">
        <span className="td-flag" data-tone="b">
          Повторение
        </span>
        <p className="td-body td-quiet">Карточек к повторению на сегодня нет.</p>
      </article>
    );
  }

  return (
    <div className="td-grid" ref={grid}>
      {exam ? (
        <ExamBlock exam={exam} phone={phone} lead={lead} />
      ) : (
        <NoExam data={data} lead={lead} onRetry={onRetry} firstQuestion={firstQuestion} lecturesText={lecturesText} />
      )}
      <div className="td-side">
        {cards}
        {activity}
      </div>
      {lectures}
    </div>
  );
}

function ExamBlock({ exam, phone, lead }: { exam: TodayExam; phone: boolean; lead: boolean }) {
  const tally = coverageTally(exam.questions);
  const total = tally.total;
  const mapped = total > 0 && tally.unmapped < total;
  const gap = mapped && tally.none > 0 ? withoutMaterialLine(tally.none) : null;
  const figure = shareFigure(exam.questions, exam.layout);
  const answers = answersSentence(exam.questions, exam.events);
  // With the large figure the share is said by it; otherwise («Сверки с лекциями ещё не было.») by the sentence.
  const sentence = (figure ? [answers] : [shareSentence(exam.questions, exam.layout), answers]).filter(Boolean).join(' ');
  const note = recentNote(exam.questions, exam.events);
  const meta = examMeta({ examDate: exam.examDate, layout: exam.layout, total });
  const heading = examHeadingParts({ title: exam.title, kind: exam.kind, daysLeft: exam.daysLeft });
  const soon = exam.daysLeft !== null && exam.daysLeft <= 3;
  const drawWord = exam.layout.mode !== 'fixed' && exam.layout.per_ticket === 1 ? 'Тянуть вопрос' : 'Тянуть билет';
  // «Шпаргалка: 39 строк осталось из 47» once the exam's cheat sheet has lines (sheet spec 4.4).
  const sheetCounts = useSheetCount(mapped ? exam.id : null, exam.examDate);
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
  const ready = Boolean(figure) || mapped || Boolean(sentence) || Boolean(note);
  return (
    <article className="td-card td-main td-exam td-rise" data-d="2" aria-labelledby="td-exam-h">
      {heading.when ? (
        // The flag repeats the end of the heading, which screen readers already read in it.
        <span className="td-flag" data-tone={soon ? 'y' : 'g'} aria-hidden="true">
          {examFlag(heading.when)}
        </span>
      ) : null}
      <h2 className="td-h2" id="td-exam-h">
        {glue(heading.subject)}
        {/* The space stays outside the hidden part, so the name reads «… — экзамен через 12 дней». */}
        {heading.when ? ' ' : null}
        {heading.when ? <span className="sr-only">{glue(`— ${heading.when}`)}</span> : null}
      </h2>
      {meta ? <p className="td-meta">{glue(meta)}</p> : null}
      {total === 0 ? <p className="td-body">Вопросов в списке пока нет.</p> : null}
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
              <Ribbon examId={exam.id} questions={exam.questions} perRow={phone ? 10 : 20} phone={phone} />
              <Tally tally={tally} examId={exam.id} />
            </>
          ) : null}
          {sentence || note ? (
            <div className="td-answers">
              {sentence ? <p className="td-body">{glue(sentence)}</p> : null}
              {note ? <p className="td-note">{glue(note)}</p> : null}
            </div>
          ) : null}
          {sheetLine}
        </div>
      ) : (
        sheetLine
      )}
      <div className="td-actions">
        {total > 0 ? (
          <ActionLink to={`/exams/${exam.id}/draw`} blue={lead}>
            {drawWord}
          </ActionLink>
        ) : null}
        <Link className="sf-secondary td-pill" to={`/exams/${exam.id}`}>
          Лист экзамена
          <PillDot />
        </Link>
      </div>
    </article>
  );
}

/**
 * Without an exam to lead with: today's cards first (the count, their lectures and the stack with the
 * first due question in one card), the question list one step away.
 */
function NoExam({
  data,
  lead,
  onRetry,
  firstQuestion,
  lecturesText,
}: {
  data: DashboardData;
  lead: boolean;
  onRetry: () => void;
  firstQuestion: string;
  lecturesText: string;
}) {
  const { dueCount, hasExams, examFailed } = data;
  // While «Первые шаги» lead (lead false), their step 2 offers the question list: it is not repeated here.
  const examsLink = examFailed ? (
    <p className="td-meta td-retry">
      Экзамены не загрузились.{' '}
      <button type="button" className="sf-link" onClick={onRetry}>
        Повторить
      </button>
    </p>
  ) : hasExams ? (
    <Link className="sf-secondary td-pill" to="/exams">
      Экзамены
      <PillDot />
    </Link>
  ) : lead ? (
    <Link className="sf-secondary td-pill" to="/exams/new">
      Вставить список вопросов к экзамену
      <PillDot />
    </Link>
  ) : null;
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

/** Two weeks of reviews: a task card beside the main one. */
function Activity({ days, streak }: { days: Array<{ key: string; value: number }>; streak: number }) {
  const any = days.some((day) => day.value > 0);
  return (
    <section className="td-card td-activity td-rise" data-d="4" aria-labelledby="td-activity-h">
      <h2 className="td-h3" id="td-activity-h">
        Повторения за две недели
      </h2>
      {any ? (
        <>
          <p className="td-meta">{glue(activityLine(streak, days[days.length - 1].value))}</p>
          <DayBars days={days} />
        </>
      ) : (
        <p className="td-meta">За две недели повторений не было.</p>
      )}
    </section>
  );
}

function Lectures({
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
            <span className="td-add-t">Добавить лекцию</span>
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

