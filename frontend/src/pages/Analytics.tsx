import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import Gradebook from '../components/Gradebook';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { fetchMaterialEvents, fetchQuestionEvents, type LearningEvent } from '../api/learning';
import { syncFlashcards } from '../api/flashcards';
import { normalizeLayout, type ExamKind, type TicketLayout } from '../api/exams';
import { confidenceVsConfirmed, examSummary, statesByHash, type QuestionState } from '../lib/learning/readiness';
import type { ProgressCard } from '../utils/progressMetrics';
import {
  cardStates,
  dueCount,
  forecast,
  lectureRows,
  recallShare,
  recallTally,
  recallWindow,
  todoItems,
  weekLede,
  JOURNAL_START,
  LECTURE_RECALL_MIN,
  RECALL_MIN_ANSWERS,
  RECALL_WINDOW_DAYS,
  type CardStates,
  type ForecastDay,
  type LectureRow,
  type MaterialInput,
  type RecallWindow,
  type TodoItem,
} from '../utils/progressModel';
import { analysisCards } from '../utils/lectureCards';
import { isDateKey, localDateKey, shiftDateKey } from '../utils/streak';
import { pluralRu } from '../components/conversation/visuals';
import { confirmedShares } from '../components/exams/sheetModel';
import { percent } from '../lib/exams/ticketMath';
import { daysUntil, formatDay, KIND_WORDS, relativeDays, subjectOf } from '../lib/exams/format';
import { READINESS_LABELS } from '../lib/learning/readiness';
import { displayMaterialTitle } from '../utils/materialTitle';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { dueToday, laterTodayWords, originPhrase, originSplit, waitingNowWords, FOLLOW_UP_ORIGIN } from '../lib/learning/cardCounts';
import { answersByDay, studyStreak, type DayAnswers } from '../lib/learning/studyDays';
import SectionCrumb from '../components/SectionCrumb';
import { ty } from '../components/landing/typo';
import '../styles/paper.css';
import './Analytics.css';

/**
 * «Прогресс», reworked on 2026-10-04 (the owner: the old ledger of counters was hard to read and
 * «как-будто бессмысленна»). The page answers three questions and gives each a way to act:
 * - what you already know — the cards by state (закреплены, учатся, новые);
 * - how your memory works — the share of cards recalled in 30 days, from the journal (which starts
 *   on 2026-10-03: until 30 days fit after it, the period is «с 3 октября», said in every place);
 * - what comes next — the reviews of the coming week by the cards' schedule, and «Что подтянуть»:
 *   the gaps the data shows, each with one button.
 * Then the exams (confirmed by answers), every lecture with its state and next step, and the days
 * of study. The numbers come from utils/progressModel.ts (pure, tested); every block reads its own
 * source and fails on its own with «Повторить», never with zeros. No mastery percentage, no
 * invented scores: «Как считается» at the end says how each number is made.
 */

const PAGE_SIZE = 1000;
const ACTIVITY_DAYS = 30;
/** Card answers of the journal: the 30 days of the share, with a margin for the time zone. */
const JOURNAL_DAYS = 32;
const LOADING_LINE_MS = 300;

type Source<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error' };

interface MaterialRow extends MaterialInput {
  subject: string | null;
}

interface CardRow extends ProgressCard {
  material_id: string | null;
}

interface SessionRow {
  date: string;
  cards_reviewed: number | null;
}

interface LegacyExamRow {
  id: string;
  score: number | null;
  subject: string | null;
  completed_at: string | null;
  kind?: string | null;
}

interface MistakeRow {
  topic: string | null;
  material_id: string | null;
}

interface ExamBlock {
  id: string;
  title: string;
  kind: ExamKind;
  examDate: string | null;
  /** exams.mapped_at: the oldest mark of the current mapping, null before the first run. */
  mappedAt: string | null;
  total: number;
  coverage: { full: number; partial: number; none: number; unverified: number; unmapped: number };
  summary: ReturnType<typeof examSummary>;
  confidence: ReturnType<typeof confidenceVsConfirmed>;
  /** Answers to this exam's tickets, spoken or typed (every attempt counts). */
  answers: number;
  /** Share of tickets whose every question is confirmed, in percent; null when it says nothing new. */
  confirmedTickets: number | null;
  perTicket: number;
}

type PageResult = { data: unknown[] | null; error: unknown };

async function readAll<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const part = (data || []) as T[];
    rows.push(...part);
    if (part.length < PAGE_SIZE) return rows;
  }
}

/** The ticket share of confirmed questions: what «подтверждено» means for tickets of this exam. */
function confirmedTicketShare(
  rows: Array<{ id: string; section: number | null; question_hash: string | null }>,
  states: Map<string, QuestionState>,
  layout: TicketLayout,
): { pct: number | null; perTicket: number } {
  if (rows.length === 0 || layout.per_ticket <= 1) return { pct: null, perTicket: layout.per_ticket };
  const shares = confirmedShares(
    rows.map((row) => ({ id: row.id, section: row.section, readiness: (row.question_hash && states.get(row.question_hash)?.readiness) || 'untested' })),
    layout,
  );
  return { pct: shares.low.ok ? percent(shares.low.all) : null, perTicket: layout.per_ticket };
}

const loaders = {
  materials: async (userId: string): Promise<MaterialRow[]> => {
    // Only the small parts of the JSON columns: whether it is text-only, the cards, the test questions.
    const { data, error } = await supabase
      .from('materials')
      .select('id, title, subject, created_at, text_only:summary_json->text_only, flashcards_json, quiz:quiz_json->quiz')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as MaterialRow[];
  },
  cards: (userId: string): Promise<CardRow[]> =>
    readAll<CardRow>((from, to) =>
      supabase
        .from('flashcard_progress')
        .select('id, material_id, repetitions, next_review, last_reviewed_at, origin')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  quiz: (): Promise<LearningEvent[]> => fetchMaterialEvents({ kinds: ['quiz_answer'] }),
  journal: (): Promise<LearningEvent[]> => fetchMaterialEvents({ kinds: ['card_review', 'exam_answer'], sinceDays: JOURNAL_DAYS }),
  activity: async (userId: string): Promise<SessionRow[]> => {
    const { data, error } = await supabase
      .from('study_sessions')
      .select('date, cards_reviewed')
      .eq('user_id', userId)
      .gte('date', shiftDateKey(localDateKey(), -(2 * ACTIVITY_DAYS)))
      .order('date', { ascending: false });
    if (error) throw error;
    return (data || []) as SessionRow[];
  },
  legacyExams: async (userId: string): Promise<LegacyExamRow[]> => {
    const { data, error } = await supabase
      .from('exam_sessions')
      .select('id, score, subject, completed_at, kind')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .eq('kind', 'professor')
      .order('completed_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    // Answers to exam tickets are 'oral_ticket' rows: never part of the old statistics.
    return ((data || []) as LegacyExamRow[]).filter((row) => !row.kind || row.kind === 'professor');
  },
  mistakes: async (userId: string): Promise<MistakeRow[]> => {
    const { data, error } = await supabase
      .from('mistake_diary')
      .select('topic, material_id')
      .eq('user_id', userId)
      .eq('is_resolved', false);
    if (error) throw error;
    return (data || []) as MistakeRow[];
  },
  exams: async (userId: string): Promise<ExamBlock[]> => {
    const { data, error } = await supabase
      .from('exams')
      .select('id, title, kind, exam_date, mapped_at, ticket_layout')
      .eq('user_id', userId)
      .order('exam_date', { ascending: true, nullsFirst: false });
    if (error) throw error;
    const exams = (data || []) as Array<{ id: string; title: string; kind?: string | null; exam_date: string | null; mapped_at?: string | null; ticket_layout?: unknown }>;
    if (exams.length === 0) return [];
    const questions = await readAll<{ id: string; exam_id: string; section: number | null; question_hash: string | null; coverage: string | null }>((from, to) =>
      supabase
        .from('exam_questions')
        .select('id, exam_id, section, question_hash, coverage')
        .eq('user_id', userId)
        .in('exam_id', exams.map((exam) => exam.id))
        .order('id', { ascending: true })
        .range(from, to),
    );
    const hashes = Array.from(new Set(questions.map((q) => q.question_hash).filter((h): h is string => !!h)));
    const states = statesByHash(hashes.length > 0 ? await fetchQuestionEvents(hashes) : []);
    return exams.map((exam) => {
      const rows = questions.filter((q) => q.exam_id === exam.id);
      const examHashes = rows.map((q) => q.question_hash).filter((h): h is string => !!h);
      const coverage = { full: 0, partial: 0, none: 0, unverified: 0, unmapped: 0 };
      for (const row of rows) {
        if (row.coverage === 'full' || row.coverage === 'partial' || row.coverage === 'none' || row.coverage === 'unverified') {
          coverage[row.coverage] += 1;
        } else coverage.unmapped += 1;
      }
      const layout = normalizeLayout(exam.ticket_layout);
      const tickets = confirmedTicketShare(rows, states, layout);
      return {
        id: exam.id,
        title: exam.title,
        kind: exam.kind === 'credit' || exam.kind === 'colloquium' ? exam.kind : 'exam',
        examDate: exam.exam_date,
        mappedAt: exam.mapped_at ?? null,
        total: rows.length,
        coverage,
        summary: examSummary(examHashes, states),
        confidence: confidenceVsConfirmed(examHashes, states),
        answers: Array.from(new Set(examHashes)).reduce((sum, hash) => sum + (states.get(hash)?.attempts ?? 0), 0),
        confirmedTickets: tickets.pct,
        perTicket: tickets.perTicket,
      };
    });
  },
};

type SourceKey = keyof typeof loaders;
type SourceData = { [K in SourceKey]: Awaited<ReturnType<(typeof loaders)[K]>> };
type Sources = { [K in SourceKey]: Source<SourceData[K]> };

const SOURCE_KEYS = Object.keys(loaders) as SourceKey[];
const LOADING: Sources = Object.fromEntries(SOURCE_KEYS.map((key) => [key, { status: 'loading' }])) as Sources;

function dayLabel(value: string | null | undefined): string {
  if (!value) return '';
  const key = value.slice(0, 10);
  if (isDateKey(key) && value.length === 10) {
    const [y, m, d] = key.split('-').map(Number);
    return format(new Date(y, m - 1, d), 'd MMM', { locale: ru });
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMM', { locale: ru });
}

function count(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${pluralRu(n, forms)}`;
}

/** ty() plus a number kept with the word after it: «с 3 октября» never breaks after «3». */
function typeset(text: string): string {
  return ty(text).replace(/(\d) (?=[а-яё])/gi, '$1\u00a0');
}

/** Ends a sentence with one period: «… 4 окт.» already has it. */
function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

const CARD_FORMS = ['карточка', 'карточки', 'карточек'] as const;
const ANSWER_FORMS = ['ответ', 'ответа', 'ответов'] as const;
/** After «Повторить»: «1 карточку», «2 карточки», «5 карточек». */
const CARD_ACC = ['карточку', 'карточки', 'карточек'] as const;

/** The date of the check of the list against the lectures: «Сверка с лекциями от 21 января, 9:40.» */
export function mappingDateText(mappedAt: string | null | undefined): string | null {
  if (!mappedAt) return null;
  const date = new Date(mappedAt);
  return Number.isNaN(date.getTime()) ? null : `Сверка с лекциями от ${format(date, 'd MMMM, H:mm', { locale: ru })}.`;
}

/** «экзамен 15 октября, через 12 дней · ответы на билеты с 27 сентября». */
function examLine(exam: ExamBlock): string {
  const day = formatDay(exam.examDate);
  const days = daysUntil(exam.examDate);
  const when = day ? `${KIND_WORDS[exam.kind]} ${day}${days === null ? '' : days < 0 ? ', прошёл' : `, ${relativeDays(days)}`}` : KIND_WORDS[exam.kind];
  const answers = exam.summary.since ? `ответы на билеты с ${formatDay(exam.summary.since)}` : 'ответов на билеты ещё не было';
  return `${when} · ${answers}`;
}

/**
 * The ledger foot of an exam (Jury_Check items 4 and 11): «Названо достаточно, не подтверждено — 2,
 * названо недостаточно — 1.» (no «засчитано» since Ф1), then the share of tickets with every question confirmed as a small line
 * («Билетов, где подтверждены оба вопроса, — 3 %.»), then self-assessment against answers.
 */
export function ledgerFoot(exam: Pick<ExamBlock, 'summary' | 'confidence' | 'confirmedTickets' | 'perTicket'>): string {
  const { summary, confidence } = exam;
  const answered = summary.confirmed + summary.once + summary.notPassed > 0;
  const parts: string[] = [];
  if (answered) {
    const once = READINESS_LABELS.once;
    parts.push(`${once[0].toUpperCase()}${once.slice(1)} — ${summary.once}, ${READINESS_LABELS.not_passed} — ${summary.notPassed}.`);
  } else {
    parts.push('Ответов по билетам ещё не было.');
  }
  if (summary.confirmed > 0 && exam.confirmedTickets !== null && exam.perTicket > 1) {
    const word = exam.perTicket === 2 ? 'оба вопроса' : exam.perTicket === 3 ? 'все три вопроса' : 'все четыре вопроса';
    parts.push(`Билетов, где подтверждены ${word}, — ${exam.confirmedTickets} %.`);
  }
  parts.push(
    confidence.enoughData
      ? `Вы отметили «знаю» у ${count(confidence.ratedKnow, ['вопроса', 'вопросов', 'вопросов'])}; из ${confidence.ratedKnowAnswered} таких, на которые вы ответили, в ${confidence.ratedKnowPassed} названо достаточно.`
      : 'Самооценка против ответов: мало данных.',
  );
  return parts.join(' ');
}

/** «Есть в лекциях: 24 из 40 · частично 7 · нет 9», or that the list was not checked against the lectures yet. */
function coverageLine(exam: ExamBlock): string {
  if (exam.total === 0) return 'Вопросов в списке пока нет.';
  if (exam.coverage.unmapped >= exam.total) return 'Сверки с лекциями ещё не было.';
  const parts = [`Есть в ваших лекциях: ${exam.coverage.full} из ${exam.total}`, `частично ${exam.coverage.partial}`, `нет ${exam.coverage.none}`];
  if (exam.coverage.unverified > 0) parts.push(`только по словам ${exam.coverage.unverified}`);
  if (exam.coverage.unmapped > 0) parts.push(`не сверено ${exam.coverage.unmapped}`);
  const date = mappingDateText(exam.mappedAt);
  return `${parts.join(' · ')}.${date ? ` ${date}` : ''}`;
}

function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <p role="alert" className="pg-error">
      {text}{' '}
      <button type="button" onClick={onRetry} className="sf-link" style={{ minHeight: 0, fontSize: 15 }}>
        Повторить
      </button>
    </p>
  );
}

function Section({ title, children, aside, id }: { title: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="pg-sec" aria-labelledby={id}>
      <div className="pg-sec-head">
        <h2 className="sf-h2" id={id}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="pg-quiet">{children}</p>;
}

/**
 * The way into the knowledge map, which lives in «Прогресс» (the exam sheet links to it too): what
 * the map shows, in words, and one button. The picture is decoration: two concepts over three lectures.
 */
function KnowledgeMapCard() {
  return (
    <div className="pg-card pg-map">
      <div className="pg-map-art" aria-hidden="true">
        <svg className="pg-map-lines" viewBox="0 0 240 172" preserveAspectRatio="none">
          <path d="M80 52 C 80 78, 40 74, 40 100" />
          <path d="M80 52 C 80 78, 120 74, 120 100" />
          <path d="M160 52 C 160 78, 120 74, 120 100" />
          <path d="M160 52 C 160 78, 200 74, 200 100" />
        </svg>
        <i className="pg-map-pill" style={{ left: '33.3%' }} />
        <i className="pg-map-pill" style={{ left: '66.7%' }} />
        <b className="pg-map-lec" style={{ left: '16.7%' }} />
        <b className="pg-map-lec" style={{ left: '50%' }} />
        <b className="pg-map-lec" style={{ left: '83.3%' }} />
      </div>
      <div className="pg-map-body">
        <p className="pg-map-text">
          Ваши лекции по порядку, а между ними — понятия, которые встречаются в нескольких лекциях. На каждой лекции видно, какие
          вопросы экзамена в ней есть и как вы на них отвечали.
        </p>
        <Link className="sf-secondary pg-map-go" to="/knowledge-map">
          Открыть карту знаний
        </Link>
      </div>
    </div>
  );
}

/** The exam's questions as dots, as on «Сегодня»: confirmed, once, not passed, then the untested ones. */
function ReadinessDots({ exam }: { exam: ExamBlock }) {
  const { confirmed, once, notPassed } = exam.summary;
  const untested = Math.max(0, exam.total - confirmed - once - notPassed);
  const dots: Array<'confirmed' | 'once' | 'not_passed' | 'untested'> = [
    ...Array.from({ length: confirmed }, () => 'confirmed' as const),
    ...Array.from({ length: once }, () => 'once' as const),
    ...Array.from({ length: notPassed }, () => 'not_passed' as const),
    ...Array.from({ length: untested }, () => 'untested' as const),
  ];
  return (
    <span className="pg-ready" aria-hidden="true">
      <span className="pg-dots" data-many={exam.total > 40 ? '' : undefined}>
        {dots.map((kind, index) => (
          <i key={index} data-r={kind} />
        ))}
      </span>
      <span className="pg-legend">
        {(['confirmed', 'once', 'not_passed', 'untested'] as const).map((kind) => (
          <span key={kind}>
            <i data-r={kind} />
            {READINESS_LABELS[kind]}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const gradebook = searchParams.get('tab') === 'gradebook';
  // The gradebook is a page of its own inside «Прогресс», with its own title.
  useDocumentTitle(gradebook ? 'Оценки из зачётки' : 'Прогресс');
  const [sources, setSources] = useState<Sources>(LOADING);
  const [loadingLine, setLoadingLine] = useState(false);

  const loadSource = useCallback(
    async (key: SourceKey) => {
      if (!user?.id) return;
      setSources((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      try {
        const data = await loaders[key](user.id);
        setSources((prev) => ({ ...prev, [key]: { status: 'ok', data } }));
      } catch (error) {
        console.error(`Progress: loading ${key} failed`, error);
        setSources((prev) => ({ ...prev, [key]: { status: 'error' } }));
      }
    },
    [user?.id],
  );

  useEffect(() => {
    if (!user?.id) return;
    setSources(LOADING);
    void Promise.all(SOURCE_KEYS.map((key) => loadSource(key)));
  }, [user?.id, loadSource]);

  const initialLoading = SOURCE_KEYS.every((key) => sources[key].status === 'loading');
  useEffect(() => {
    if (!initialLoading) {
      setLoadingLine(false);
      return;
    }
    const timer = setTimeout(() => setLoadingLine(true), LOADING_LINE_MS);
    return () => clearTimeout(timer);
  }, [initialLoading]);

  if (gradebook) {
    return (
      <div className="sf-page pg pg-gb">
        <header className="sf-head">
          <div className="min-w-0">
            {/* «‹ Прогресс» as on the other pages inside a section (the map, the diary). The top line of a
                phone cannot show it here (it reads the path, not ?tab), so this crumb stays on phones too. */}
            <SectionCrumb to="/analytics" label="Прогресс" />
            <h1 className="sf-h1">Оценки из зачётки</h1>
            <p className="sf-lede">{ty('Оценки по предметам и средний балл. Их можно ввести вручную или распознать по фото зачётки.')}</p>
          </div>
        </header>
        <div className="pg-gradebook">
          <Gradebook />
        </div>
      </div>
    );
  }

  return (
    <div className="sf-page pg">
      <header className="sf-head pg-head">
        <div>
          <h1 className="sf-h1">Прогресс</h1>
          <p className="sf-lede">{initialLoading ? (loadingLine ? 'Загружаем страницу…' : ' ') : typeset(ledeOf(sources))}</p>
        </div>
        <Link className="sf-secondary pg-head-link" to="/analytics?tab=gradebook">
          Оценки из зачётки
        </Link>
      </header>
      {initialLoading ? null : <ProgressBody sources={sources} reload={loadSource} userId={user?.id ?? null} />}
    </div>
  );
}

/** «За 7 дней: …» from the sources that loaded, or the day of the last study. */
function ledeOf(sources: Sources): string {
  const { activity, quiz, journal } = sources;
  if (activity.status !== 'ok' && quiz.status !== 'ok' && journal.status !== 'ok') return 'Считаем по вашим ответам…';
  const today = localDateKey();
  const weekFrom = shiftDateKey(today, -6);
  let lastDay: string | null = null;
  const consider = (value: string | null | undefined) => {
    const day = value ? value.slice(0, 10) : '';
    if (isDateKey(day) && day <= today && (lastDay === null || day > lastDay)) lastDay = day;
  };
  let cardAnswers = 0;
  if (activity.status === 'ok') {
    for (const row of activity.data) {
      const value = Number(row.cards_reviewed) || 0;
      if (value <= 0) continue;
      consider(row.date);
      const day = row.date.slice(0, 10);
      if (day >= weekFrom && day <= today) cardAnswers += value;
    }
  }
  const tests = new Set<string>();
  if (quiz.status === 'ok') {
    for (const event of quiz.data) {
      consider(event.local_date);
      if (event.local_date >= weekFrom && event.local_date <= today && event.session_id) tests.add(event.session_id);
    }
  }
  let tickets = 0;
  if (journal.status === 'ok') {
    for (const event of journal.data) {
      consider(event.local_date);
      if (event.kind === 'exam_answer' && event.local_date >= weekFrom && event.local_date <= today) tickets += 1;
    }
  }
  // A student without a single card or answer starts with a lecture: «повторение карточек» needs cards.
  if (lastDay === null && sources.cards.status === 'ok' && sources.cards.data.length === 0) {
    return 'Здесь будет видно, как вы запоминаете лекции. Начните с разбора первой лекции.';
  }
  return weekLede({ cardAnswers, tests: tests.size, tickets, lastDay: lastDay ? formatDay(lastDay) : null });
}

function ProgressBody({ sources, reload, userId }: { sources: Sources; reload: (key: SourceKey) => void; userId: string | null }) {
  const { materials, cards, quiz, journal, activity, legacyExams, mistakes, exams } = sources;
  const [howOpen, setHowOpen] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState<string | null>(null);

  const now = useMemo(() => new Date(), [cards, journal, materials]);
  const today = localDateKey(now);
  const span = recallWindow(today);
  const windowFrom = span.from;
  const allCards = cards.status === 'ok' ? cards.data : [];
  const journalEvents = journal.status === 'ok' ? journal.data : [];

  const states = useMemo(() => cardStates(allCards, now), [allCards, now]);
  const due = useMemo(() => dueCount(allCards, now), [allCards, now]);
  // Decision 4: what waits now and what comes later today are named apart («24 ждут сейчас · ещё 2 — позже сегодня»).
  const laterToday = useMemo(() => dueToday(allCards, now).later, [allCards, now]);
  const week = useMemo(() => forecast(allCards, now), [allCards, now]);
  // Cards from answers to tickets, in all and per lecture: «18 из лекций, 8 из ответов на билеты».
  const origins = useMemo(() => originSplit(allCards), [allCards]);
  const answersByLecture = useMemo(() => {
    const byLecture = new Map<string, number>();
    for (const card of allCards) {
      if (card.origin === FOLLOW_UP_ORIGIN && card.material_id) byLecture.set(card.material_id, (byLecture.get(card.material_id) ?? 0) + 1);
    }
    return byLecture;
  }, [allCards]);
  const recall = useMemo(() => recallTally(journalEvents, windowFrom, today), [journalEvents, windowFrom, today]);

  const rows = useMemo(
    () =>
      materials.status === 'ok'
        ? lectureRows({
            materials: materials.data,
            cards: allCards,
            quizEvents: quiz.status === 'ok' ? quiz.data : [],
            reviewEvents: journalEvents,
            mistakes: mistakes.status === 'ok' ? mistakes.data : [],
            now,
            windowFrom,
            windowTo: today,
          })
        : [],
    [materials, allCards, quiz, journalEvents, mistakes, now, windowFrom, today],
  );

  const todo = useMemo(
    () =>
      todoItems({
        // A lecture's next step needs its cards and tests: without them the rows say nothing new.
        rows: cards.status === 'ok' && quiz.status === 'ok' ? rows : [],
        mistakes: mistakes.status === 'ok' ? mistakes.data : null,
        exams: exams.status === 'ok' ? exams.data.map((exam) => ({ id: exam.id, title: subjectOf(exam.title), none: exam.coverage.none })) : null,
      }),
    [rows, cards.status, quiz.status, mistakes, exams],
  );
  const everythingRead = SOURCE_KEYS.every((key) => key === 'legacyExams' || key === 'activity' || sources[key].status === 'ok');

  const materialById = useMemo(() => new Map((materials.status === 'ok' ? materials.data : []).map((m) => [m.id, m])), [materials]);
  const addToReview = async (lecture: LectureRow) => {
    const material = materialById.get(lecture.id);
    if (!userId || !material || syncing) return;
    setSyncing(lecture.id);
    setSyncFailed(null);
    try {
      await syncFlashcards(userId, lecture.id, analysisCards(material.flashcards_json));
      reload('cards');
    } catch (error) {
      console.error('Adding cards to review failed', error);
      setSyncFailed(lecture.id);
    } finally {
      setSyncing(null);
    }
  };

  const active = rows.filter((row) => !row.textOnly);
  const textOnly = rows.filter((row) => row.textOnly);
  // Nothing to look at yet: no lecture with cards or a test. «Пробелов не видно» would be false comfort.
  const nothingYet = materials.status === 'ok' && active.length === 0;

  return (
    <>
      <section className="pg-tiles" aria-label="Сводка">
        <KnowledgeTile cards={cards} states={states} origins={origins} onRetry={() => reload('cards')} />
        {/* Unknown cards (still loading or failed) read as «there are cards»: the neutral sentence. */}
        <MemoryTile journal={journal} recall={recall} span={span} hasCards={cards.status !== 'ok' || states.total > 0} onRetry={() => reload('journal')} />
        <AheadTile cards={cards} due={due} laterToday={laterToday} hasCards={states.total > 0} week={week} onRetry={() => reload('cards')} />
      </section>

      <Section title="Что подтянуть" id="pg-todo">
        <div className="pg-card pg-todo">
          {todo.items.length > 0 ? (
            <ul className="pg-todo-list">
              {todo.items.map((item) => (
                <TodoLine
                  key={todoKey(item)}
                  item={item}
                  span={span}
                  syncing={syncing}
                  failed={syncFailed}
                  onAdd={(lecture) => void addToReview(lecture)}
                />
              ))}
            </ul>
          ) : everythingRead && nothingYet ? (
            <div className="pg-todo-empty">
              <Quiet>
                {materials.status === 'ok' && materials.data.length > 0
                  ? 'Пока нечего подтягивать: у лекций, загруженных только текстом, нет карточек и теста. Разберите лекцию, и здесь появятся её пробелы.'
                  : 'Пока нечего подтягивать — разберите первую лекцию, и здесь появятся её пробелы.'}
              </Quiet>
              <Link className="sf-secondary" to="/analyze">
                Разобрать лекцию
              </Link>
            </div>
          ) : everythingRead ? (
            <Quiet>Пробелов не видно: карточки в повторении, тесты пройдены, открытых ошибок нет.</Quiet>
          ) : (
            <Quiet>Часть данных не загрузилась, поэтому список может быть неполным.</Quiet>
          )}
          {todo.more > 0 ? <Quiet>Ещё {todo.more} — в списке лекций ниже.</Quiet> : null}
        </div>
      </Section>

      <Section title="Экзамены" id="pg-exams" aside={<Link to="/exams" className="sf-link" data-muted="">Все экзамены</Link>}>
        {exams.status === 'error' ? (
          <ErrorLine text="Экзамены не загрузились." onRetry={() => reload('exams')} />
        ) : exams.status === 'loading' ? (
          <Quiet>Загружаем…</Quiet>
        ) : exams.data.length === 0 ? (
          <div className="pg-card pg-exam-empty">
            <p>Добавьте список вопросов к экзамену — здесь будет видно, какие из них уже подтверждены ответами.</p>
            <Link className="sf-secondary" to="/exams/new">
              Новый экзамен
            </Link>
          </div>
        ) : (
          <ul className="sf-ledger">
            {exams.data.map((exam) => (
              <li key={exam.id}>
                <div className="sf-ledger-row">
                  <span className="min-w-0">
                    {/* The name is the link; the whole row answers to it (::after covers the row). */}
                    <Link className="sf-ledger-name sf-stretch" to={`/exams/${exam.id}`}>
                      {subjectOf(exam.title)}
                    </Link>
                    <span className="sf-ledger-meta">{examLine(exam)}</span>
                    <span className="sf-ledger-meta">{coverageLine(exam)}</span>
                  </span>
                  {exam.total > 0 ? (
                    <span className="sf-ledger-figs">
                      <span>
                        <span className="sf-ledger-fig">
                          {exam.summary.confirmed} <span className="sf-of">из {exam.total}</span>
                        </span>
                        <span className="sf-ledger-cap">вопросов подтверждено ответами</span>
                      </span>
                    </span>
                  ) : null}
                  {exam.total > 0 ? <ReadinessDots exam={exam} /> : null}
                  {/* The share of tickets is a small line of the foot, never a big «0 %» (Jury_Check 4). */}
                  {exam.total > 0 ? <span className="sf-ledger-foot">{ledgerFoot(exam)}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Карта знаний" id="pg-map">
        <KnowledgeMapCard />
      </Section>

      <Section title="Лекции" id="pg-lectures" aside={<Link to="/library" className="sf-link" data-muted="">Все лекции</Link>}>
        {materials.status === 'error' ? (
          <ErrorLine text="Лекции не загрузились." onRetry={() => reload('materials')} />
        ) : materials.status === 'loading' ? (
          <Quiet>Загружаем…</Quiet>
        ) : materials.data.length === 0 ? (
          <Quiet>
            Лекций пока нет.{' '}
            <Link to="/analyze" className="sf-link" style={{ minHeight: 0, fontSize: 15 }}>
              Разобрать лекцию
            </Link>
          </Quiet>
        ) : (
          <>
            {cards.status === 'error' && <ErrorLine text="Карточки не загрузились, их счётчики не показаны." onRetry={() => reload('cards')} />}
            {quiz.status === 'error' && <ErrorLine text="Результаты тестов не загрузились." onRetry={() => reload('quiz')} />}
            {active.length > 0 ? (
              <ul className="pg-card pg-lectures">
                {active.map((row) => (
                  <LectureLine
                    key={row.id}
                    row={row}
                    span={span}
                    now={now}
                    cardsKnown={cards.status === 'ok'}
                    quizKnown={quiz.status === 'ok'}
                    fromAnswers={answersByLecture.get(row.id) ?? 0}
                    syncing={syncing}
                    failed={syncFailed}
                    onAdd={(lecture) => void addToReview(lecture)}
                  />
                ))}
              </ul>
            ) : null}
            {textOnly.length > 0 ? (
              <details className="pg-textonly">
                <summary>
                  Только текст — {count(textOnly.length, ['лекция', 'лекции', 'лекций'])}
                </summary>
                <p className="pg-quiet">Загружены для сверки с вопросами экзаменов: конспекта, карточек и теста у них нет.</p>
                <ul>
                  {textOnly.map((row) => (
                    <li key={row.id}>
                      <Link to={`/library/${row.id}`} className="sf-link" data-muted="">
                        {displayMaterialTitle(row.title)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </Section>

      <ActivitySection activity={activity} quiz={quiz} journal={journal} onRetry={() => reload('activity')} onRetryJournal={() => reload('journal')} />

      {(legacyExams.status === 'error' || (legacyExams.status === 'ok' && legacyExams.data.length > 0)) && (
        <Section title="Устные экзамены (прежний формат)" id="pg-legacy">
          {legacyExams.status === 'error' ? (
            <ErrorLine text="Прежние устные экзамены не загрузились." onRetry={() => reload('legacyExams')} />
          ) : legacyExams.status === 'ok' ? (
            <LegacyExams rows={legacyExams.data} />
          ) : null}
        </Section>
      )}

      <p className="pg-how">
        <button
          type="button"
          className="sf-link"
          data-muted=""
          aria-expanded={howOpen}
          aria-controls={howOpen ? 'progress-how' : undefined}
          onClick={() => setHowOpen((open) => !open)}
        >
          Как считается
        </button>
      </p>
      {howOpen ? (
        <div id="progress-how" className="pg-how-text">
          <p>
            «Закреплены» — карточки, которые вы вспомнили два раза подряд в разные дни: после этого следующий показ — через неделю и
            позже; ответ «Не помню» возвращает карточку в «учатся». «Учатся» — карточки, которые уже повторялись, но ещё не закреплены.
            «Новые» — ещё ни разу не повторялись.
          </p>
          <p>
            «Вспомнили» — доля ответов «Помню» и «С трудом» среди ответов на карточки за {RECALL_WINDOW_DAYS} дней. Ответы записываются с{' '}
            {formatDay(JOURNAL_START)}: пока с этого дня не прошло {RECALL_WINDOW_DAYS} дней, доля считается с него, а повторения раньше
            видны только в «Занятиях по дням». Долю показываем от {RECALL_MIN_ANSWERS} ответов, у лекции — от {LECTURE_RECALL_MIN}; лекция,
            где вспомнили меньше 70 %, попадает в «Что подтянуть».
          </p>
          <p>
            «Повторения на неделю» — сколько карточек придёт на повторение в каждый из ближайших дней по их расписанию; в «сегодня»
            входят и пропущенные, и те, что придут позже сегодня. Карточки из ответов на билеты — вопросы экзаменатора, на которые вы
            не ответили; они считаются вместе с карточками лекций. «Тест» — первая попытка теста лекции, повторные показаны отдельно.
            Вопрос экзамена «подтверждён», когда дважды, в разные дни, в ответе на него названо достаточно пунктов.
          </p>
          <p>
            «Занятия по дням» — ответы на карточки и на билеты за каждый день; день, когда вы проходили тест, тоже считается днём
            занятий.
          </p>
        </div>
      ) : null}
    </>
  );
}

/** A thin bar of the cards by state: закреплены (green), учатся (blue), новые (grey). */
function StateBar({ states }: { states: CardStates }) {
  if (states.total === 0) return null;
  const width = (n: number) => `${(n / states.total) * 100}%`;
  return (
    <span className="pg-state" aria-hidden="true">
      {states.solid > 0 ? <i data-s="solid" style={{ width: width(states.solid) }} /> : null}
      {states.learning > 0 ? <i data-s="learning" style={{ width: width(states.learning) }} /> : null}
      {states.fresh > 0 ? <i data-s="fresh" style={{ width: width(states.fresh) }} /> : null}
    </span>
  );
}

function KnowledgeTile({ cards, states, origins, onRetry }: { cards: Source<CardRow[]>; states: CardStates; origins: ReturnType<typeof originSplit>; onRetry: () => void }) {
  const fromWhere = originPhrase(origins, 'many');
  return (
    <article className="pg-tile" data-tile="cards" aria-labelledby="pg-k-cards">
      <h2 className="pg-k" id="pg-k-cards">
        Карточки
      </h2>
      {cards.status === 'error' ? (
        <ErrorLine text="Карточки не загрузились." onRetry={onRetry} />
      ) : cards.status === 'loading' ? (
        <Quiet>Загружаем…</Quiet>
      ) : states.total === 0 ? (
        <>
          <p className="pg-note">{ty('Карточек в повторении пока нет. Они появятся после разбора лекции и после ответов на билеты.')}</p>
          <Link className="sf-link pg-tile-link" to="/analyze">
            Разобрать лекцию
          </Link>
        </>
      ) : (
        <>
          <p className="pg-big">
            {states.solid}
            <span className="pg-of"> из {states.total}</span>
          </p>
          <p className="pg-cap">{pluralRu(states.solid, ['закреплена', 'закреплены', 'закреплены'])}</p>
          <StateBar states={states} />
          <ul className="pg-keys">
            <li>
              <i data-s="solid" />
              закреплены {states.solid}
            </li>
            <li>
              <i data-s="learning" />
              учатся {states.learning}
            </li>
            <li>
              <i data-s="fresh" />
              новые {states.fresh}
            </li>
          </ul>
          {/* «Лекции» counts a lecture's own cards; here the cards from ticket answers are in the total too. */}
          {fromWhere ? <p className="pg-note pg-note--small">{`Всего ${states.total}: ${fromWhere}.`}</p> : null}
        </>
      )}
    </article>
  );
}

/** «за 30 дней», or «с 3 октября» while the journal is younger than the window. */
function periodText(span: RecallWindow, short = false): string {
  if (!span.sinceJournal) return `за ${RECALL_WINDOW_DAYS} дней`;
  return `с ${short ? dayLabel(span.from) : formatDay(span.from)}`;
}

function MemoryTile({
  journal,
  recall,
  span,
  hasCards,
  onRetry,
}: {
  journal: Source<LearningEvent[]>;
  recall: { answers: number; recalled: number };
  span: RecallWindow;
  hasCards: boolean;
  onRetry: () => void;
}) {
  const share = recallShare(recall, RECALL_MIN_ANSWERS);
  const forgot = recall.answers - recall.recalled;
  return (
    <article className="pg-tile pg-tile--blue" data-tile="memory" data-empty={share === null ? '' : undefined} aria-labelledby="pg-k-memory">
      <h2 className="pg-k" id="pg-k-memory">
        Вспомнили {periodText(span)}
      </h2>
      {journal.status === 'error' ? (
        <ErrorLine text="Журнал ответов не загрузился." onRetry={onRetry} />
      ) : journal.status === 'loading' ? (
        <Quiet>Загружаем…</Quiet>
      ) : share !== null ? (
        <>
          <p className="pg-big">{Math.round(share * 100)}&nbsp;%</p>
          <p className="pg-cap">
            {recall.recalled} из {count(recall.answers, ANSWER_FORMS)} на карточки
          </p>
          <span className="pg-state" aria-hidden="true">
            {recall.recalled > 0 ? <i data-s="hit" style={{ width: `${(recall.recalled / recall.answers) * 100}%` }} /> : null}
            {forgot > 0 ? <i data-s="miss" style={{ width: `${(forgot / recall.answers) * 100}%` }} /> : null}
          </span>
          <ul className="pg-keys">
            <li>
              <i data-s="hit" />
              вспомнили {recall.recalled}
            </li>
            <li>
              <i data-s="miss" />
              не вспомнили {forgot}
            </li>
          </ul>
        </>
      ) : (
        <>
          <p className="pg-note">
            {typeset(
              recall.answers === 0
                ? `Ответов на карточки ${periodText(span)} пока нет.`
                : `Пока ${count(recall.answers, ANSWER_FORMS)} на карточки — долю покажем с ${RECALL_MIN_ANSWERS}, осталось ${RECALL_MIN_ANSWERS - recall.answers}.`,
            )}
          </p>
          <p className="pg-note pg-note--small">
            {typeset(
              hasCards
                ? 'Здесь будет доля карточек, которые вы вспомнили при повторении: ответы «Помню» и «С трудом».'
                : 'Карточки появятся после разбора лекции, а здесь — доля тех, что вы вспомнили при повторении.',
            )}
          </p>
        </>
      )}
    </article>
  );
}

function AheadTile({
  cards,
  due,
  laterToday,
  hasCards,
  week,
  onRetry,
}: {
  cards: Source<CardRow[]>;
  due: number;
  laterToday: number;
  hasCards: boolean;
  week: ForecastDay[];
  onRetry: () => void;
}) {
  const later = week.slice(1).reduce((sum, day) => sum + day.count, 0);
  const total = later + (week[0]?.count ?? 0);
  const tomorrow = week[1]?.count ?? 0;
  const rest = laterTodayWords(laterToday, due > 0);
  return (
    // With cards to repeat now, this tile leads on a phone: «Повторить» is the page's next step.
    <article className="pg-tile" data-tile="ahead" data-lead={cards.status === 'ok' && due > 0 ? '' : undefined} aria-labelledby="pg-k-ahead">
      <h2 className="pg-k" id="pg-k-ahead">
        Повторения на неделю
      </h2>
      {cards.status === 'error' ? (
        <ErrorLine text="Расписание карточек не загрузилось." onRetry={onRetry} />
      ) : cards.status === 'loading' ? (
        <Quiet>Загружаем…</Quiet>
      ) : !hasCards ? (
        // No cards at all: no big «0» and no empty week.
        <p className="pg-note">{ty('Повторять пока нечего. Расписание на неделю появится вместе с карточками.')}</p>
      ) : (
        <>
          {/* The number and the one action side by side: on a phone «Повторить» is on the first screen. */}
          <div className="pg-ahead-head">
            <p className="pg-big">{due}</p>
            {due > 0 ? (
              <Link className="sf-primary pg-tile-cta" to="/review">
                Повторить
              </Link>
            ) : null}
          </div>
          {/* Decision 4: what waits now, then what comes later today («ещё 2 — позже сегодня»). */}
          <p className="pg-cap">{waitingNowWords(due)}</p>
          {rest ? <p className="pg-cap pg-cap-later">{rest}</p> : null}
          {week.some((day) => day.count > 0) ? <ForecastBars days={week} /> : null}
          <p className="pg-note pg-note--small">
            {later > 0 ? `${tomorrow > 0 ? `Завтра — ${tomorrow}` : 'Завтра повторений нет'}, всего на неделю — ${total}.` : 'На следующие 6 дней повторений нет.'}
          </p>
        </>
      )}
    </article>
  );
}

function shortDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'd MMM', { locale: ru });
}

function weekdayOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'EEEEEE', { locale: ru });
}

/** The reviews of the coming 7 days by the cards' schedule: today first (with what was missed). */
function ForecastBars({ days }: { days: ForecastDay[] }) {
  const max = Math.max(1, ...days.map((day) => day.count));
  return (
    <figure className="pg-mini">
      <div className="pg-mini-plot" aria-hidden="true">
        {days.map((day, index) => (
          <div key={day.key} className="pg-mini-col">
            {day.count > 0 ? <span className="pg-mini-val">{day.count}</span> : null}
            <span
              className="pg-mini-bar"
              data-today={index === 0 ? '' : undefined}
              data-zero={day.count === 0 ? '' : undefined}
              style={{ height: day.count > 0 ? `${Math.max(6, (day.count / max) * 72)}px` : '3px' }}
            />
          </div>
        ))}
      </div>
      <div className="pg-mini-axis" aria-hidden="true">
        {days.map((day, index) => (
          <span key={day.key}>{index === 0 ? 'сег.' : index === 1 ? 'завт.' : weekdayOf(day.key)}</span>
        ))}
      </div>
      <figcaption className="sr-only">
        {days
          .map((day, index) => `${index === 0 ? 'Сегодня' : index === 1 ? 'Завтра' : shortDay(day.key)}: ${day.count > 0 ? count(day.count, CARD_FORMS) : 'повторений нет'}.`)
          .join(' ')}
      </figcaption>
    </figure>
  );
}

function todoKey(item: TodoItem): string {
  if (item.kind === 'mistakes' || item.kind === 'quiz') return item.kind;
  if (item.kind === 'exam') return `exam:${item.examId}`;
  return `${item.kind}:${item.lecture.id}`;
}

function title(row: LectureRow): string {
  return `«${displayMaterialTitle(row.title)}»`;
}

function TodoLine({
  item,
  span,
  syncing,
  failed,
  onAdd,
}: {
  item: TodoItem;
  span: RecallWindow;
  syncing: string | null;
  failed: string | null;
  onAdd: (lecture: LectureRow) => void;
}) {
  let tone: 'pink' | 'yellow' | 'blue';
  let text: ReactNode;
  let action: ReactNode;
  switch (item.kind) {
    case 'weak':
      tone = 'pink';
      text = (
        <>
          {title(item.lecture)}: вспомнили {item.lecture.recall.recalled} из {count(item.lecture.recall.answers, ANSWER_FORMS)} {periodText(span)}
        </>
      );
      action =
        item.lecture.due > 0 ? (
          <Link className="pg-act" data-blue="" to={`/review?material=${item.lecture.id}`}>
            Повторить
          </Link>
        ) : (
          <Link className="pg-act" to={`/library/${item.lecture.id}`}>
            Перечитать конспект
          </Link>
        );
      break;
    case 'mistakes': {
      tone = 'pink';
      const shown = item.topics.slice(0, 3);
      const rest = item.topics.length - shown.length;
      text = (
        <>
          {count(item.count, ['открытая ошибка', 'открытые ошибки', 'открытых ошибок'])}
          {shown.length > 0 ? `: ${shown.join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}` : ''}
        </>
      );
      action = (
        <Link className="pg-act" to="/mistakes">
          Разобрать
        </Link>
      );
      break;
    }
    case 'add':
      tone = 'yellow';
      text = (
        <>
          {title(item.lecture)}: {count(item.lecture.notInReview, CARD_FORMS)} не{' '}
          {pluralRu(item.lecture.notInReview, ['добавлена', 'добавлены', 'добавлены'])} в повторение
          {failed === item.lecture.id ? <span className="pg-todo-err"> Не получилось добавить, попробуйте ещё раз.</span> : null}
        </>
      );
      action = (
        <button type="button" className="pg-act" disabled={syncing !== null} onClick={() => onAdd(item.lecture)}>
          {syncing === item.lecture.id ? 'Добавляем…' : 'Добавить'}
        </button>
      );
      break;
    case 'exam':
      tone = 'blue';
      text = (
        <>
          «{item.title}»: {count(item.none, ['вопрос', 'вопроса', 'вопросов'])} нет ни в одной лекции
        </>
      );
      action = (
        <Link className="pg-act" to={`/exams/${item.examId}`}>
          Лист экзамена
        </Link>
      );
      break;
    case 'quiz':
    default: {
      tone = 'yellow';
      const [first] = item.lectures;
      text =
        item.lectures.length === 1 ? (
          <>{title(first)}: тест ещё не пройден</>
        ) : (
          <>
            Тесты не пройдены в {item.lectures.length} {pluralRu(item.lectures.length, ['лекции', 'лекциях', 'лекциях'])}. Начните с {title(first)}
          </>
        );
      action = (
        <Link className="pg-act" to={`/library/${first.id}?section=quiz`} aria-label={`Пройти тест: ${displayMaterialTitle(first.title)}`}>
          Пройти тест
        </Link>
      );
      break;
    }
  }
  return (
    <li className="pg-todo-row">
      <i className="pg-todo-dot" data-tone={tone} aria-hidden="true" />
      <span className="pg-todo-t">{text}</span>
      {action}
    </li>
  );
}

/** «повторение завтра», «повторение 9 окт.»: when the lecture's next card comes back. */
function nextReviewText(iso: string, now: Date): string {
  const date = new Date(iso);
  const key = localDateKey(date);
  if (key === localDateKey(now)) return 'повторение сегодня';
  if (key === shiftDateKey(localDateKey(now), 1)) return 'повторение завтра';
  return `повторение ${format(date, 'd MMM', { locale: ru })}`;
}

/** «тест 4 из 5, 2 окт. · повторно 5 из 5 · 1 ошибка» — only what exists. */
function lectureMeta(row: LectureRow, quizKnown: boolean): string {
  const parts: string[] = [];
  if (quizKnown) {
    if (row.metrics.quiz) {
      parts.push(`тест ${row.metrics.quiz.correct} из ${row.metrics.quiz.total}, ${dayLabel(row.metrics.quiz.date)}`);
      if (row.metrics.quizRepeat) parts.push(`повторно ${row.metrics.quizRepeat.correct} из ${row.metrics.quizRepeat.total}`);
    } else if (row.hasQuiz) parts.push('тест не пройден');
  }
  if (row.mistakes > 0) parts.push(count(row.mistakes, ['открытая ошибка', 'открытые ошибки', 'открытых ошибок']));
  return parts.join(' · ');
}

function LectureLine({
  row,
  span,
  now,
  cardsKnown,
  quizKnown,
  fromAnswers,
  syncing,
  failed,
  onAdd,
}: {
  row: LectureRow;
  span: RecallWindow;
  now: Date;
  cardsKnown: boolean;
  quizKnown: boolean;
  /** The lecture's cards that came from answers to tickets (decision 4). */
  fromAnswers: number;
  syncing: string | null;
  failed: string | null;
  onAdd: (lecture: LectureRow) => void;
}) {
  const share = recallShare(row.recall, LECTURE_RECALL_MIN);
  const meta = lectureMeta(row, quizKnown);
  const name = displayMaterialTitle(row.title);
  const answers = Math.min(fromAnswers, row.states.total);
  const fromWhere = originPhrase({ total: row.states.total, lecture: row.states.total - answers, answers }, 'one');
  let action: ReactNode = null;
  if (cardsKnown && row.action?.kind === 'review') {
    action = (
      <Link className="pg-act" data-blue="" to={`/review?material=${row.id}`} aria-label={`Повторить ${count(row.action.count, CARD_ACC)}: ${name}`}>
        Повторить {row.action.count}
      </Link>
    );
  } else if (cardsKnown && row.action?.kind === 'add') {
    action = (
      <button type="button" className="pg-act" disabled={syncing !== null} onClick={() => onAdd(row)} aria-label={`Добавить карточки в повторение: ${name}`}>
        {syncing === row.id ? 'Добавляем…' : 'В повторение'}
      </button>
    );
  } else if (quizKnown && row.action?.kind === 'quiz') {
    action = (
      <Link className="pg-act" to={`/library/${row.id}?section=quiz`} aria-label={`Пройти тест: ${name}`}>
        Пройти тест
      </Link>
    );
  } else if (cardsKnown && row.states.total > 0 && row.states.solid === row.states.total) {
    action = <span className="pg-done">Всё закреплено</span>;
  } else if (cardsKnown && row.nextReview) {
    action = <span className="pg-lec-next">{nextReviewText(row.nextReview, now)}</span>;
  }
  return (
    <li className="pg-lec" data-material={row.id}>
      <div className="pg-lec-main">
        <Link className="pg-lec-t" to={`/library/${row.id}`}>
          {name}
        </Link>
        {meta ? <span className="pg-lec-meta">{meta}</span> : null}
        {failed === row.id ? <span className="pg-todo-err">Не получилось добавить карточки, попробуйте ещё раз.</span> : null}
      </div>
      <div className="pg-lec-cards">
        {!cardsKnown ? null : row.states.total > 0 ? (
          <>
            <StateBar states={row.states} />
            <span className="pg-lec-cap">
              закреплено {row.states.solid} из {row.states.total}
              {row.states.fresh > 0 ? ` · новых ${row.states.fresh}` : ''}
            </span>
            {/* «Лекции» shows the lecture's own cards; the rest came from answers to its tickets. */}
            {fromWhere ? <span className="pg-lec-cap pg-lec-origin">{fromWhere}</span> : null}
          </>
        ) : (
          <span className="pg-lec-cap">{row.notInReview > 0 ? `${count(row.notInReview, CARD_FORMS)} не в повторении` : 'карточек нет'}</span>
        )}
      </div>
      <div className="pg-lec-recall">
        {share !== null ? (
          <>
            <span className="pg-lec-share">вспомнили {Math.round(share * 100)}&nbsp;%</span>
            <span className="pg-lec-cap">
              {row.recall.recalled} из {row.recall.answers} {periodText(span, true)}
            </span>
          </>
        ) : row.recall.answers > 0 ? (
          <span className="pg-lec-cap">
            {count(row.recall.answers, ANSWER_FORMS)} {periodText(span, true)}
          </span>
        ) : null}
      </div>
      <div className="pg-lec-act">{action}</div>
    </li>
  );
}

/**
 * «Занятия по дням» (LIB-12): the answers of the last 30 days — to cards (the daily counters) and to
 * exam tickets (the journal) — as columns, and one sentence. A day with a test counts as a day of
 * study too. The header of the page counts ticket answers, so this section does as well.
 */
function ActivitySection({
  activity,
  quiz,
  journal,
  onRetry,
  onRetryJournal,
}: {
  activity: Source<SessionRow[]>;
  quiz: Source<LearningEvent[]>;
  journal: Source<LearningEvent[]>;
  onRetry: () => void;
  onRetryJournal: () => void;
}) {
  const today = localDateKey();
  const firstDay = shiftDateKey(today, -(ACTIVITY_DAYS - 1));
  // Ticket answers from the journal (its card answers are the same as the daily counters) and the tests.
  const events = useMemo(
    () => [...(journal.status === 'ok' ? journal.data.filter((event) => event.kind === 'exam_answer') : []), ...(quiz.status === 'ok' ? quiz.data : [])],
    [journal, quiz],
  );
  const sessions = useMemo(() => (activity.status === 'ok' ? activity.data : []), [activity]);
  const days = useMemo(() => answersByDay({ sessions, events, from: firstDay, to: today }), [sessions, events, firstDay, today]);

  // One sentence about the last 30 days. Only what happened is named: no «0 ответов», no «0 дней подряд».
  const cardAnswers = days.reduce((sum, day) => sum + day.cards, 0);
  const ticketAnswers = days.reduce((sum, day) => sum + day.tickets, 0);
  const summaryParts: string[] = [];
  if (activity.status === 'ok') {
    const recentQuiz = quiz.status === 'ok' ? quiz.data.filter((e) => e.local_date >= firstDay && e.local_date <= today) : [];
    const studyDays = days.filter((day) => day.cards + day.tickets + day.tests > 0).length;
    const tests = new Set(recentQuiz.filter((e) => e.session_id).map((e) => e.session_id)).size;
    if (cardAnswers > 0) summaryParts.push(`${count(cardAnswers, ANSWER_FORMS)} на карточки`);
    if (ticketAnswers > 0) summaryParts.push(`${count(ticketAnswers, ANSWER_FORMS)} на билеты`);
    if (tests > 0) summaryParts.push(count(tests, ['тест', 'теста', 'тестов']));
    if (studyDays > 0) summaryParts.push(`занятия в ${studyDays} из ${ACTIVITY_DAYS} дней`);
    const streak = studyStreak({ sessions: activity.data, events });
    if (streak > 0) summaryParts.push(`сейчас ${count(streak, ['день', 'дня', 'дней'])} подряд`);
  }

  return (
    <Section title="Занятия по дням" id="pg-days">
      {activity.status === 'error' ? (
        <ErrorLine text="Активность по дням не загрузилась." onRetry={onRetry} />
      ) : activity.status === 'loading' ? (
        <Quiet>Загружаем…</Quiet>
      ) : (
        <div className="pg-card pg-activity">
          <Quiet>{summaryParts.length > 0 ? `За ${ACTIVITY_DAYS} дней: ${summaryParts.join(', ')}.` : `За ${ACTIVITY_DAYS} дней занятий не было.`}</Quiet>
          {journal.status === 'error' ? (
            <ErrorLine text="Ответы на билеты не загрузились, их дни здесь не учтены." onRetry={onRetryJournal} />
          ) : null}
          {/* Bars only when there is something to draw: no empty axis. */}
          {cardAnswers + ticketAnswers > 0 ? <DayBars data={days} /> : null}
        </div>
      )}
    </Section>
  );
}

function LegacyExams({ rows }: { rows: LegacyExamRow[] }) {
  const last = rows[0];
  return (
    <div className="pg-card pg-list-card">
      <p className="pg-list-lead">
        Пройдено: {rows.length}. Последний {dayLabel(last.completed_at)}: {count(Number(last.score) || 0, ['балл', 'балла', 'баллов'])} из 100.
      </p>
      <ul className="pg-rows">
        {rows.slice(0, 5).map((row) => (
          <li key={row.id} className="pg-row">
            <span className="pg-row-t">
              {dayLabel(row.completed_at)}
              {row.subject ? ` · ${row.subject}` : ''}
            </span>
            <span className="pg-row-n">{Number(row.score) || 0} из 100</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Answers per day as plain columns: card answers in the blue, answers to tickets in the ink on top of
 * them (a hairline between), the total over a non-zero day, a stub on a zero day, an axis from the
 * first day to «сегодня». No hover; a key when both kinds are there; a table for screen readers.
 */
function DayBars({ data }: { data: DayAnswers[] }) {
  const totalOf = (day: DayAnswers) => day.cards + day.tickets;
  const max = Math.max(1, ...data.map(totalOf));
  const peak = data.reduce((best, day) => (totalOf(day) > totalOf(best) ? day : best), data[0]);
  const hasCards = data.some((day) => day.cards > 0);
  const hasTickets = data.some((day) => day.tickets > 0);
  const what = hasCards && hasTickets ? 'Ответы на карточки и билеты' : hasTickets ? 'Ответы на билеты' : 'Ответы на карточки';
  return (
    <figure className="sf-bars pg-bars">
      <div className="sf-bars-plot" aria-hidden="true">
        {data.map((day) => {
          const total = totalOf(day);
          return (
            <div key={day.key} className="sf-bars-day">
              {total > 0 ? (
                <>
                  <span className="sf-bars-val">{total}</span>
                  <span className="pg-bar-stack" style={{ height: `${Math.max(3, (total / max) * 100)}px` }}>
                    {day.tickets > 0 ? <span className="pg-bar-part" data-kind="tickets" style={{ flexGrow: day.tickets }} /> : null}
                    {day.cards > 0 ? <span className="pg-bar-part" data-kind="cards" style={{ flexGrow: day.cards }} /> : null}
                  </span>
                </>
              ) : (
                <span className="sf-bars-bar" data-zero="" />
              )}
            </div>
          );
        })}
      </div>
      <div className="sf-bars-axis" aria-hidden="true">
        <span>{shortDay(data[0].key)}</span>
        <span>сегодня</span>
      </div>
      {hasCards && hasTickets ? (
        <ul className="pg-bar-keys" aria-hidden="true">
          <li>
            <i data-kind="cards" />
            на карточки
          </li>
          <li>
            <i data-kind="tickets" />
            на билеты
          </li>
        </ul>
      ) : null}
      <figcaption className="pg-figcap">{sentence(`${what} по дням; больше всего ${totalOf(peak)} — ${shortDay(peak.key)}`)}</figcaption>
      <table className="sr-only">
        <caption>Ответов по дням</caption>
        <thead>
          <tr>
            <th scope="col">День</th>
            <th scope="col">На карточки</th>
            <th scope="col">На билеты</th>
          </tr>
        </thead>
        <tbody>
          {data.map((day) => (
            <tr key={day.key}>
              <td>{shortDay(day.key)}</td>
              <td>{day.cards}</td>
              <td>{day.tickets}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
