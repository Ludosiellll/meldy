import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import type { Flashcard, StudySession } from '../types';
import '../styles/paper.css';
import './Dashboard.css';

/**
 * «Сегодня» on the paper desk (redesign spec 5.15, frame today--1280x720-light, Jury_Check items
 * 5, 6 and 10). The first screen after signing in and after registration.
 *
 * - The desk: the nearest exam on the left (its list in miniature as a paper ribbon of pencil marks,
 *   «9 вопросов без материала» first, the share of tickets for the exam's own layout, a dated note
 *   about the last two days) and today's review cards on the right as a stack of index cards.
 * - Without an exam the cards lead; an empty account is sent to the question list first.
 * - Below the desk: the four latest lectures and two weeks of reviews as plain ink columns.
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
}

const COVERAGES = new Set(['full', 'partial', 'none', 'unverified']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function analysisCards(flashcardsJson: unknown): Flashcard[] {
  const items: unknown[] = Array.isArray(flashcardsJson)
    ? flashcardsJson
    : Array.isArray((flashcardsJson as { flashcards?: unknown } | null)?.flashcards)
      ? (flashcardsJson as { flashcards: unknown[] }).flashcards
      : [];
  return items.filter((card): card is Flashcard => {
    const c = card as Partial<Flashcard> | null;
    return typeof c?.question === 'string' && c.question.trim() !== '' && typeof c?.answer === 'string' && c.answer.trim() !== '';
  });
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

async function loadExam(userId: string): Promise<{ exam: TodayExam | null; hasExams: boolean }> {
  const { data, error } = await supabase
    .from('exams')
    .select('id, title, kind, exam_date, mapped_at, ticket_layout, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const exams = (Array.isArray(data) ? data : []).map(normalizeExam).filter((row): row is ExamRow => row !== null);
  const id = pickExam(exams);
  const row = exams.find((exam) => exam.id === id);
  if (!row) return { exam: null, hasExams: exams.length > 0 };

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
  return {
    hasExams: true,
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

async function loadDashboard(userId: string): Promise<DashboardData> {
  const examPromise = loadExam(userId).then(
    (result) => ({ ...result, failed: false }),
    (error) => {
      console.error('Loading the exam of «Сегодня» failed:', error);
      return { exam: null, hasExams: false, failed: true };
    },
  );
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
  const [materialsWithCards, exam, dueCards] = await Promise.all([
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
  ]);
  return {
    lectures: (lecturesResult.data || []) as LectureRow[],
    recent,
    dueCount,
    dueCards,
    sessions: (sessionsResult.data || []) as StudySession[],
    materialsWithCards,
    exam: exam.exam,
    hasExams: exam.hasExams,
    examFailed: exam.failed,
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

export function examWhen(daysLeft: number): string {
  if (daysLeft <= 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  return `через ${daysLeft} ${pluralRu(daysLeft, ['день', 'дня', 'дней'])}`;
}

/**
 * «Микроэкономика — экзамен через 12 дней»: the subject (a leading «Экзамен:» is dropped, the title
 * is never declined) and the kind once. «Экзамен по микроэкономике — через 12 дней» when the kind is
 * already in the name. Without a date, the sheet's own header: «Микроэкономика: вопросы к экзамену».
 * No period at the end.
 */
export function examHeading(exam: { title: string; kind: ExamKind; daysLeft: number | null }): string {
  if (exam.daysLeft === null) return sheetHeader(exam.title, exam.kind);
  const subject = subjectOf(exam.title);
  const when = examWhen(exam.daysLeft);
  return KIND_IN_NAME.test(subject) ? `${subject} — ${when}` : `${subject} — ${KIND_WORDS[exam.kind]} ${when}`;
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
        ? 'Добавьте к нему материал — после переразметки он вернётся в тренировку.'
        : 'Добавьте к ним материал — после переразметки они вернутся в тренировку.',
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

/**
 * The share of tickets whose questions are all in the lectures, for the exam's own layout (random
 * pairs, one per section, or the department's tickets): «Билетов, где оба вопроса есть в ваших
 * лекциях, — 35 %.» A range while some questions were checked only by words or not mapped yet; «Разметки
 * по лекциям ещё нет.» before the first mapping; '' when no share can be counted.
 */
export function shareSentence(questions: TodayQuestion[], layout: TicketLayout): string {
  if (questions.length === 0) return '';
  if (questions.every((question) => question.coverage === 'unmapped')) return 'Разметки по лекциям ещё нет.';
  const shares = coverageShares(
    questions.map((question) => ({ id: question.id, section: question.section, coverage: question.coverage })),
    layout,
  );
  const value = shareText(shares, 'all');
  if (!value || !shares.low.ok) return '';
  if (shares.low.mode === 'fixed') {
    const low = shares.low.allCount;
    const high = shares.isRange && shares.high.ok && shares.high.mode === 'fixed' ? shares.high.allCount : low;
    const count = high !== low ? `${low}–${high}` : String(low);
    return `Билетов кафедры, где ${fixedTicketWord(questions, layout)} есть в ваших лекциях, — ${count} из ${shares.low.tickets}.`;
  }
  const q = perTicketOf(shares.low, layout.per_ticket);
  if (q <= 1) return `Вопросов, которые есть в ваших лекциях, — ${value}.`;
  return `Билетов, где ${allQuestionsWord(q)} есть в ваших лекциях, — ${value}.`;
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

/** Mark sizes in the ribbon (prototype today.html): 17×15, a flatter cup and dash; a little larger on a phone. */
const RIBBON_MARKS: Record<'desk' | 'phone', Record<CoverageMarkKind, { width: number; height: number }>> = {
  desk: { tick: { width: 17, height: 15 }, dtick: { width: 17, height: 15 }, cup: { width: 16, height: 10 }, dash: { width: 17, height: 7 }, dot: { width: 8, height: 8 } },
  phone: { tick: { width: 19, height: 17 }, dtick: { width: 19, height: 17 }, cup: { width: 18, height: 11 }, dash: { width: 19, height: 8 }, dot: { width: 9, height: 9 } },
};
const LEGEND_MARKS: Record<CoverageMarkKind, { width: number; height: number }> = {
  tick: { width: 19, height: 16 },
  dtick: { width: 19, height: 16 },
  cup: { width: 18, height: 11 },
  dash: { width: 19, height: 8 },
  dot: { width: 9, height: 9 },
};

/** The list in miniature: one pencil mark per question in list order, an empty slot for a question not mapped yet. */
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
    >
      {rows.map((row, index) => {
        const first = index * perRow + 1;
        return (
          <div key={first} className="td-strip-row" style={{ ['--td-n' as string]: row.length }}>
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

/** The legend line under the ribbon: the same marks on the desk, each with its count. */
function Tally({ tally, examId }: { tally: CoverageTally; examId: string }) {
  const items = TALLY.filter((item) => tally[item.key] > 0);
  return (
    <p className="td-tally">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? ' ' : null}
          <span data-coverage={item.key}>
            {item.mark ? (
              <Mark
                kind={item.mark}
                seed={markSeed(`${examId}:legend`, index)}
                width={LEGEND_MARKS[item.mark].width}
                height={LEGEND_MARKS[item.mark].height}
              />
            ) : null}
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

/** Today's review cards as the landing's index card, three deep, with the first due question. */
function CardStack({ question }: { question: string }) {
  const long = question.trim().length > 64;
  return (
    <div className="td-stack" aria-hidden="true">
      <div className="sf-index-card" data-n="3" />
      <div className="sf-index-card" data-n="2" />
      <div className="sf-index-card" data-n="1">
        <p className="td-stack-q" data-long={long ? '' : undefined}>
          {question.trim()}
        </p>
      </div>
    </div>
  );
}

/** Reviews per day as plain ink columns with the value above each, and a table for screen readers. */
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

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(false);
    try {
      setData(await loadDashboard(user.id));
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

  const head = (
    <header className="td-head">
      <p className="td-date">{todayLine()}</p>
      <h1 className="sf-h1">{greeting(user?.user_metadata?.full_name)}</h1>
    </header>
  );

  let content: ReactNode;
  /** The empty account is one object in the middle of the page (spec 3.4), not on the desk's left edge. */
  let centered = false;
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
        <section className="td-error">
          <h2 className="sf-h2">Не удалось загрузить данные</h2>
          <p className="td-error-text" role="alert">
            Лекции и карточки на месте. Повторите через минуту.
          </p>
          <button type="button" className="sf-link" onClick={() => void load()}>
            Повторить
          </button>
        </section>
      </>
    );
  } else if (data.lectures.length === 0 && !data.hasExams && !data.examFailed && data.dueCount === 0 && !data.exam) {
    // A new account: the question list first (Jury_Check item 6), a lecture when there is no list yet.
    centered = true;
    content = (
      <section className="td-empty" aria-labelledby="td-empty-h">
        <h1 className="sf-h1" id="td-empty-h">
          Начните со списка вопросов
        </h1>
        <p className="td-empty-text">
          {glue('Вставьте вопросы к экзамену и загрузите лекции — Meldy отметит, какие вопросы есть в ваших лекциях и какую долю билетов они закрывают.')}
        </p>
        <Link className="sf-primary td-empty-go" to="/exams/new">
          Вставить список вопросов
        </Link>
        <p className="td-empty-alt">
          <Link className="sf-link" data-muted="" to="/analyze">
            Списка пока нет — добавить лекцию
          </Link>
        </p>
      </section>
    );
  } else {
    content = (
      <>
        {head}
        <Desk data={data} phone={frame.size === 's'} onRetry={() => void load()} />
        <section className="td-lower">
          <Lectures data={data} syncing={syncing} syncError={syncError} onAdd={(material) => void addCardsToReview(material)} />
          <section className="td-activity" aria-labelledby="td-activity-h">
            <div className="td-sec-head">
              <h2 className="td-h3" id="td-activity-h">
                Повторения за две недели
              </h2>
            </div>
            {days.some((day) => day.value > 0) ? (
              <>
                <p className="td-meta">{glue(activityLine(streak, days[days.length - 1].value))}</p>
                <DayBars days={days} />
              </>
            ) : (
              <p className="td-meta">За две недели повторений не было.</p>
            )}
          </section>
        </section>
      </>
    );
  }

  return (
    <div className="sf-page td" ref={frame.ref} data-frame={frame.size}>
      <div className={centered ? 'td-in td-in-centered' : 'td-in'}>{content}</div>
    </div>
  );
}

/** The desk: the exam (or today's cards when there is no exam) on the left, the card stack on the right. */
function Desk({ data, phone, onRetry }: { data: DashboardData; phone: boolean; onRetry: () => void }) {
  const { exam, dueCount, dueCards } = data;
  const titles = useMemo(() => new Map(data.lectures.map((lecture) => [lecture.id, lecture.title])), [data.lectures]);
  const firstQuestion = dueCards.find((card) => typeof card.question === 'string' && card.question.trim() !== '')?.question ?? '';
  const lecturesText = dueLecturesText(dueCards, titles, dueCount);
  const examPrimary = Boolean(exam && exam.questions.length > 0);

  const cards =
    dueCount > 0 ? (
      <article className="td-due" {...(exam ? { 'aria-labelledby': 'td-due-h' } : { 'aria-label': dueTitle(dueCount) })}>
        {firstQuestion ? <CardStack question={firstQuestion} /> : null}
        {exam ? (
          <>
            <h2 className="td-h3" id="td-due-h">
              {dueTitle(dueCount)}
            </h2>
            <p className="td-meta">{glue([reviewTime(dueCount), lecturesText].filter(Boolean).join(' '))}</p>
            <Link className={examPrimary ? 'sf-secondary' : 'sf-primary'} to="/review">
              Начать повторение
            </Link>
          </>
        ) : lecturesText ? (
          <p className="td-meta td-due-from">{glue(lecturesText)}</p>
        ) : null}
      </article>
    ) : exam ? (
      <article className="td-due" aria-label="Карточки на сегодня">
        <p className="td-body td-quiet">Карточек к повторению на сегодня нет.</p>
      </article>
    ) : null;

  return (
    <section className="td-desk" data-cards={dueCount > 0 ? '' : undefined}>
      {exam ? <ExamBlock exam={exam} phone={phone} /> : <NoExam data={data} onRetry={onRetry} />}
      {cards}
    </section>
  );
}

function ExamBlock({ exam, phone }: { exam: TodayExam; phone: boolean }) {
  const tally = coverageTally(exam.questions);
  const total = tally.total;
  const mapped = total > 0 && tally.unmapped < total;
  const gap = mapped && tally.none > 0 ? withoutMaterialLine(tally.none) : null;
  const sentence = [shareSentence(exam.questions, exam.layout), answersSentence(exam.questions, exam.events)].filter(Boolean).join(' ');
  const note = recentNote(exam.questions, exam.events);
  const meta = examMeta({ examDate: exam.examDate, layout: exam.layout, total });
  const drawWord = exam.layout.mode !== 'fixed' && exam.layout.per_ticket === 1 ? 'Тянуть вопрос' : 'Тянуть билет';
  return (
    <article className="td-exam" aria-labelledby="td-exam-h">
      <h2 className="sf-h2" id="td-exam-h">
        {glue(examHeading({ title: exam.title, kind: exam.kind, daysLeft: exam.daysLeft }))}
      </h2>
      {meta ? <p className="td-meta">{glue(meta)}</p> : null}
      {total === 0 ? <p className="td-body">Вопросов в списке пока нет.</p> : null}
      {gap ? (
        <div className="td-gap">
          <Link className="sf-link td-gap-link" to={`/exams/${exam.id}?filter=cov:none`}>
            {glue(gap.link)}
          </Link>
          <p className="td-gap-note">{glue(gap.note)}</p>
        </div>
      ) : null}
      {mapped ? (
        <>
          <Ribbon examId={exam.id} questions={exam.questions} perRow={phone ? 10 : 20} phone={phone} />
          <Tally tally={tally} examId={exam.id} />
        </>
      ) : null}
      {sentence ? <p className="td-body">{glue(sentence)}</p> : null}
      {note ? <p className="td-note">{glue(note)}</p> : null}
      <div className="td-actions">
        {total > 0 ? (
          <Link className="sf-primary" to={`/exams/${exam.id}/draw`}>
            {drawWord}
          </Link>
        ) : null}
        <Link className="sf-link" to={`/exams/${exam.id}`}>
          Лист экзамена
        </Link>
      </div>
    </article>
  );
}

/** Without an exam to lead with: today's cards first, the question list one step away. */
function NoExam({ data, onRetry }: { data: DashboardData; onRetry: () => void }) {
  const { dueCount, hasExams, examFailed } = data;
  const examsLink = examFailed ? (
    <p className="td-meta td-retry">
      Экзамены не загрузились.{' '}
      <button type="button" className="sf-link" onClick={onRetry}>
        Повторить
      </button>
    </p>
  ) : hasExams ? (
    <Link className="sf-link" to="/exams">
      Экзамены
    </Link>
  ) : (
    <Link className="sf-link" to="/exams/new">
      Вставить список вопросов к экзамену
    </Link>
  );
  if (dueCount > 0) {
    const lead = dueLead(dueCount);
    return (
      <article className="td-exam" aria-label="На сегодня">
        <p className="td-big">
          {glue(lead.count)} <span className="td-big-time">{lead.time}</span>
        </p>
        <div className="td-actions">
          <Link className="sf-primary" to="/review">
            Начать повторение
          </Link>
          {examsLink}
        </div>
      </article>
    );
  }
  return (
    <article className="td-exam" aria-label="На сегодня">
      <p className="td-big">Карточек к повторению на сегодня нет.</p>
      {!hasExams && !examFailed ? (
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
      ) : (
        <div className="td-actions">{examsLink}</div>
      )}
    </article>
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
    <section className="td-lectures" aria-labelledby="td-lectures-h">
      <div className="td-sec-head">
        <h2 className="td-h3" id="td-lectures-h">
          Лекции
        </h2>
        {count > 0 ? (
          <Link className="sf-link" data-muted="" to="/library">
            {count > RECENT_LECTURES ? `Все ${count}` : 'Библиотека'}
          </Link>
        ) : null}
      </div>
      {count === 0 ? (
        <p className="td-meta">
          Лекций пока нет.{' '}
          <Link className="sf-link td-inline-link" to="/analyze">
            Добавить лекцию
          </Link>
        </p>
      ) : (
        <ol className="td-rows">
          {data.recent.map((material) => {
            const meta = lectureMeta(material);
            const missing = cardsMissingFromReview(material, data.materialsWithCards);
            return (
              <li key={material.id}>
                <Link className="td-row" to={`/library/${material.id}`}>
                  <span className="td-row-title">{material.title || 'Без названия'}</span>
                  {meta ? <span className="td-row-meta">{glue(meta)}</span> : null}
                  <span className="td-row-date">{shortDate(material.created_at)}</span>
                </Link>
                {missing ? (
                  <p className="td-row-note">
                    Карточки этой лекции не добавлены в повторение.{' '}
                    <button type="button" className="sf-link" disabled={syncing !== null} onClick={() => onAdd(material)}>
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
