import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import Gradebook from '../components/Gradebook';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { fetchMaterialEvents, fetchQuestionEvents, type LearningEvent } from '../api/learning';
import { normalizeLayout, type ExamKind, type TicketLayout } from '../api/exams';
import { confidenceVsConfirmed, examSummary, statesByHash, type QuestionState } from '../lib/learning/readiness';
import { materialMetrics, MIN_MEASURED, type MaterialMetrics, type ProgressCard } from '../utils/progressMetrics';
import { currentStreak, isDateKey, localDateKey, shiftDateKey } from '../utils/streak';
import { pluralRu } from '../components/conversation/visuals';
import { confirmedShares } from '../components/exams/sheetModel';
import { percent } from '../lib/exams/ticketMath';
import { daysUntil, formatDay, KIND_WORDS, relativeDays, subjectOf } from '../lib/exams/format';
import { READINESS_LABELS } from '../lib/learning/readiness';
import '../styles/paper.css';

/**
 * «Прогресс» (redesign spec 5.17): measured counters, dated, in the order a student preparing for an
 * exam needs them — the exams first (confirmed by answers and what it means for tickets), then every
 * lecture as a row of a table, the answers per day, and the topics with open mistakes.
 *
 * Every block reads its own source and fails on its own: a failed query shows a plain line with
 * «Повторить», never zeros. Card numbers come from flashcard_progress, test numbers from the
 * journal (the first attempt of a test, never a retake), exam numbers from exam_questions and the
 * answers aloud in the journal. Old-format oral exams are only the exam_sessions rows of kind
 * 'professor'; answers to exam tickets are counted in «Экзамены», not twice. No tabs, no spinner.
 */

const PAGE_SIZE = 1000;
const ACTIVITY_DAYS = 30;
const LOADING_LINE_MS = 300;

type Source<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error' };

interface MaterialRow {
  id: string;
  title: string;
  subject: string | null;
  created_at: string;
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
  /** Answers aloud to this exam's questions (every attempt counts). */
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
    const { data, error } = await supabase
      .from('materials')
      .select('id, title, subject, created_at')
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
      .select('topic')
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

/** «по 1 ответу», «по 46 ответам»: the dative after «по». */
function dative(n: number, one: string, many: string): string {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : many}`;
}

/** Ends a sentence with one period: «… 4 окт.» already has it. */
function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/**
 * The line under «Прогресс»: what the numbers on this page are made of and since when, e.g. «По 46
 * ответам на билеты и 212 повторениям карточек с 27 сентября.»
 */
export function progressLede(input: { ticketAnswers: number; testAnswers?: number; cardReviews: number; since: string | null }): string {
  const parts: string[] = [];
  if (input.ticketAnswers > 0) parts.push(`${dative(input.ticketAnswers, 'ответу', 'ответам')} на билеты`);
  // Test answers are named too: the table shows first tests, so the line must not say there were no answers.
  const tests = input.testAnswers ?? 0;
  if (tests > 0) parts.push(`${dative(tests, 'ответу', 'ответам')} в тестах`);
  if (input.cardReviews > 0) parts.push(`${dative(input.cardReviews, 'повторению', 'повторениям')} карточек`);
  if (parts.length === 0) return 'Ответов на билеты, тестов и повторений карточек пока нет.';
  const since = input.since ? ` с ${formatDay(input.since)}` : '';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}` : parts[0];
  return `По ${list}${since}.`;
}

export interface Cell {
  main: string;
  sub: string | null;
  quiet: boolean;
}

/**
 * «Вспомнили» counts only cards that were reviewed: a new card or an examiner's follow-up card
 * waiting for its first review is not forgotten, so it is named apart, never put in the «из».
 */
export function cardsCell(cards: MaterialMetrics['cards']): Cell | null {
  if (cards.total === 0) return null;
  if (cards.reviewed === 0) {
    return { main: `${count(cards.total, ['карточка', 'карточки', 'карточек'])}, ещё не ${pluralRu(cards.total, ['повторялась', 'повторялись', 'повторялись'])}`, sub: null, quiet: true };
  }
  const waiting = cards.total - cards.reviewed;
  const sub = [
    waiting > 0 ? `ещё ${waiting} ${pluralRu(waiting, ['не повторялась', 'не повторялись', 'не повторялись'])}` : '',
    cards.consolidated > 0 ? `${cards.consolidated} ${pluralRu(cards.consolidated, ['закреплена', 'закреплены', 'закреплены'])}` : 'закреплённых пока нет',
    cards.nextCheck ? `следующая проверка ${dayLabel(cards.nextCheck)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return { main: `${cards.recalled} из ${cards.reviewed} вспомнили`, sub, quiet: false };
}

/** «4 из 5, 2 окт.» and, under it, «повторно 3 окт.: 5 из 5» (a retake never replaces the first). */
export function quizCell(metrics: Pick<MaterialMetrics, 'quiz' | 'quizRepeat'>): Cell {
  if (!metrics.quiz) return { main: 'теста не было', sub: null, quiet: true };
  return {
    main: `${metrics.quiz.correct} из ${metrics.quiz.total}, ${dayLabel(metrics.quiz.date)}`,
    sub: metrics.quizRepeat ? `повторно ${dayLabel(metrics.quizRepeat.date)}: ${metrics.quizRepeat.correct} из ${metrics.quizRepeat.total}` : null,
    quiet: false,
  };
}

/** Names what the share is made of: the reviewed cards, the first test, or both. */
export function accuracyLabel(metrics: Pick<MaterialMetrics, 'cards' | 'quiz'>): string {
  if (!metrics.quiz) return 'Верно по карточкам';
  if (metrics.cards.reviewed === 0) return 'Верно в первом тесте';
  return 'Верно по карточкам и первому тесту';
}

/** «10 из 13» and «77 %», or «мало данных» / «не проверялось» in this cell only. */
export function accuracyCell(metrics: MaterialMetrics): Cell {
  if (metrics.status === 'measured' && metrics.accuracy) {
    return { main: `${metrics.accuracy.numerator} из ${metrics.accuracy.denominator}`, sub: `${Math.round(metrics.accuracy.value * 100)} %`, quiet: false };
  }
  if (metrics.status === 'few_data') return { main: 'мало данных', sub: null, quiet: true };
  return { main: 'не проверялось', sub: null, quiet: true };
}

/** The date of the mapping in the words of the exam sheet: «Разметка от 21 января, 9:40.» */
export function mappingDateText(mappedAt: string | null | undefined): string | null {
  if (!mappedAt) return null;
  const date = new Date(mappedAt);
  return Number.isNaN(date.getTime()) ? null : `Разметка от ${format(date, 'd MMMM, H:mm', { locale: ru })}.`;
}

/** «экзамен 15 октября, через 12 дней · ответы на билеты с 27 сентября». */
function examLine(exam: ExamBlock): string {
  const day = formatDay(exam.examDate);
  const days = daysUntil(exam.examDate);
  const when = day ? `${KIND_WORDS[exam.kind]} ${day}${days === null ? '' : days < 0 ? ', прошёл' : `, ${relativeDays(days)}`}` : KIND_WORDS[exam.kind];
  const answers = exam.summary.since ? `ответы на билеты с ${formatDay(exam.summary.since)}` : 'ответов на билеты ещё не было';
  return `${when} · ${answers}`;
}

/** «Есть в лекциях: 24 из 40 · частично 7 · нет 9», or that the list was not mapped yet. */
function coverageLine(exam: ExamBlock): string {
  if (exam.total === 0) return 'Вопросов в списке пока нет.';
  if (exam.coverage.unmapped >= exam.total) return 'Разметки по лекциям ещё нет.';
  const parts = [`Есть в ваших лекциях: ${exam.coverage.full} из ${exam.total}`, `частично ${exam.coverage.partial}`, `нет ${exam.coverage.none}`];
  if (exam.coverage.unverified > 0) parts.push(`только по словам ${exam.coverage.unverified}`);
  if (exam.coverage.unmapped > 0) parts.push(`не размечено ${exam.coverage.unmapped}`);
  const date = mappingDateText(exam.mappedAt);
  return `${parts.join(' · ')}.${date ? ` ${date}` : ''}`;
}

function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <p role="alert" className="text-[15px] leading-[22px] text-[var(--sf-ink)]">
      {text}{' '}
      <button type="button" onClick={onRetry} className="sf-link" style={{ minHeight: 0, fontSize: 15 }}>
        Повторить
      </button>
    </p>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="mt-12" style={{ maxWidth: 1040 }}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="sf-h2">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-[22px] text-[var(--sf-muted)]">{children}</p>;
}

export default function Analytics() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const gradebook = searchParams.get('tab') === 'gradebook';
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
      <div className="sf-page">
        <header className="sf-head">
          <div>
            <h1 className="sf-h1">Оценки из зачётки</h1>
            <p className="sf-lede">
              <button type="button" className="sf-link" data-muted="" style={{ minHeight: 0 }} onClick={() => setSearchParams({})}>
                Прогресс
              </button>
            </p>
          </div>
        </header>
        <div className="mt-8">
          <Gradebook />
        </div>
      </div>
    );
  }

  return (
    <div className="sf-page">
      <header className="sf-head">
        <div>
          <h1 className="sf-h1">Прогресс</h1>
          <p className="sf-lede">{initialLoading ? (loadingLine ? 'Загружаем страницу…' : ' ') : ledeOf(sources)}</p>
        </div>
      </header>
      {initialLoading ? null : <ProgressBody sources={sources} reload={loadSource} />}
      <p className="mt-12">
        <Link className="sf-link" data-muted="" to="/analytics?tab=gradebook">
          Оценки из зачётки
        </Link>
      </p>
    </div>
  );
}

/** The lede from the sources that loaded: ticket answers, test answers, card reviews and the earliest day. */
function ledeOf(sources: Sources): string {
  const { exams, activity, quiz } = sources;
  if (exams.status !== 'ok' && activity.status !== 'ok' && quiz.status !== 'ok') return 'Считаем по вашим ответам…';
  let ticketAnswers = 0;
  let since: string | null = null;
  const consider = (key: string | null | undefined) => {
    const day = key ? key.slice(0, 10) : '';
    if (isDateKey(day) && (since === null || day < since)) since = day;
  };
  if (exams.status === 'ok') {
    for (const exam of exams.data) {
      ticketAnswers += exam.answers;
      consider(exam.summary.since);
    }
  }
  let cardReviews = 0;
  if (activity.status === 'ok') {
    for (const row of activity.data) {
      const value = Number(row.cards_reviewed) || 0;
      if (value <= 0) continue;
      cardReviews += value;
      consider(row.date);
    }
  }
  let testAnswers = 0;
  if (quiz.status === 'ok') {
    for (const event of quiz.data) {
      testAnswers += 1;
      consider(event.local_date);
    }
  }
  return progressLede({ ticketAnswers, testAnswers, cardReviews, since });
}

function ProgressBody({ sources, reload }: { sources: Sources; reload: (key: SourceKey) => void }) {
  const { materials, cards, quiz, activity, legacyExams, mistakes, exams } = sources;
  const [howOpen, setHowOpen] = useState(false);

  const cardsByMaterial = useMemo(() => {
    const map = new Map<string, CardRow[]>();
    if (cards.status === 'ok') {
      for (const card of cards.data) {
        if (!card.material_id) continue;
        const list = map.get(card.material_id);
        if (list) list.push(card);
        else map.set(card.material_id, [card]);
      }
    }
    return map;
  }, [cards]);

  const quizByMaterial = useMemo(() => {
    const map = new Map<string, LearningEvent[]>();
    if (quiz.status === 'ok') {
      for (const event of quiz.data) {
        if (!event.material_id) continue;
        const list = map.get(event.material_id);
        if (list) list.push(event);
        else map.set(event.material_id, [event]);
      }
    }
    return map;
  }, [quiz]);

  const today = localDateKey();
  const firstDay = shiftDateKey(today, -(ACTIVITY_DAYS - 1));
  const chartData = useMemo(() => {
    const byDate = new Map<string, number>();
    if (activity.status === 'ok') {
      for (const row of activity.data) {
        const key = typeof row.date === 'string' ? row.date.slice(0, 10) : '';
        byDate.set(key, (byDate.get(key) ?? 0) + (Number(row.cards_reviewed) || 0));
      }
    }
    return Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
      const key = shiftDateKey(today, i - (ACTIVITY_DAYS - 1));
      return { key, value: byDate.get(key) ?? 0 };
    });
  }, [activity, today]);

  // One sentence about the last 30 days, from the sources that loaded. Only what happened is named:
  // no «0 ответов», no «0 дней подряд»; a day with a test counts as a day of study too.
  const cardAnswers = chartData.reduce((sum, day) => sum + day.value, 0);
  const summaryParts: string[] = [];
  if (activity.status === 'ok') {
    const recentQuiz = quiz.status === 'ok' ? quiz.data.filter((e) => e.local_date >= firstDay && e.local_date <= today) : [];
    const studyDays = new Set([
      ...activity.data
        .filter((row) => (Number(row.cards_reviewed) || 0) > 0)
        .map((row) => row.date.slice(0, 10))
        .filter((key) => key >= firstDay && key <= today),
      ...recentQuiz.map((e) => e.local_date),
    ]).size;
    const tests = new Set(recentQuiz.filter((e) => e.session_id).map((e) => e.session_id)).size;
    if (cardAnswers > 0) summaryParts.push(`${count(cardAnswers, ['ответ', 'ответа', 'ответов'])} на карточки`);
    if (tests > 0) summaryParts.push(count(tests, ['тест', 'теста', 'тестов']));
    if (studyDays > 0) summaryParts.push(`занятия в ${studyDays} из ${ACTIVITY_DAYS} дней`);
    const streak = currentStreak(activity.data.filter((row) => (Number(row.cards_reviewed) || 0) > 0).map((row) => row.date));
    if (streak > 0) summaryParts.push(`сейчас ${count(streak, ['день', 'дня', 'дней'])} подряд`);
  }

  return (
    <>
      <Section title="Экзамены" aside={<Link to="/exams" className="sf-link" data-muted="">Все экзамены</Link>}>
        {exams.status === 'error' ? (
          <ErrorLine text="Экзамены не загрузились." onRetry={() => reload('exams')} />
        ) : exams.status === 'loading' ? (
          <Quiet>Загружаем…</Quiet>
        ) : exams.data.length === 0 ? (
          <Quiet>Экзаменов пока нет. Добавьте список вопросов, и здесь появится, что из него подтверждено ответами.</Quiet>
        ) : (
          <ul className="sf-ledger">
            {exams.data.map((exam) => {
              const answered = exam.summary.confirmed + exam.summary.once + exam.summary.notPassed > 0;
              const ticketWord = exam.perTicket === 2 ? 'оба вопроса' : exam.perTicket === 3 ? 'все три вопроса' : 'все четыре вопроса';
              return (
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
                        {exam.confirmedTickets !== null ? (
                          <span>
                            <span className="sf-ledger-fig">{`${exam.confirmedTickets} %`}</span>
                            <span className="sf-ledger-cap">{`билетов, где подтверждены ${ticketWord}`}</span>
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {exam.total > 0 ? (
                      <span className="sf-ledger-foot">
                        {answered
                          ? `${READINESS_LABELS.once[0].toUpperCase()}${READINESS_LABELS.once.slice(1)} — ${exam.summary.once}, ${READINESS_LABELS.not_passed} — ${exam.summary.notPassed}.`
                          : 'Ответов по билетам ещё не было.'}{' '}
                        {exam.confidence.enoughData
                          ? `Вы отметили «знаю» у ${count(exam.confidence.ratedKnow, ['вопроса', 'вопросов', 'вопросов'])}; из ${exam.confidence.ratedKnowAnswered} таких, на которые вы ответили вслух, зачтено ${exam.confidence.ratedKnowPassed}.`
                          : 'Самооценка против ответов вслух: мало данных.'}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="По лекциям">
        {materials.status === 'error' ? (
          <ErrorLine text="Материалы не загрузились." onRetry={() => reload('materials')} />
        ) : materials.status === 'loading' ? (
          <Quiet>Загружаем…</Quiet>
        ) : materials.data.length === 0 ? (
          <Quiet>
            Лекций пока нет.{' '}
            <Link to="/analyze" className="sf-link" style={{ minHeight: 0, fontSize: 15 }}>
              Добавить лекцию
            </Link>
          </Quiet>
        ) : (
          <>
            {cards.status === 'error' && <ErrorLine text="Карточки не загрузились, их счётчики не показаны." onRetry={() => reload('cards')} />}
            {quiz.status === 'error' && <ErrorLine text="Результаты тестов не загрузились." onRetry={() => reload('quiz')} />}
            <table className="sf-table mt-2">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '34%' }}>Лекция</th>
                  <th scope="col">Карточки</th>
                  <th scope="col">Тест, первая попытка</th>
                  <th scope="col">Верно при последней проверке</th>
                </tr>
              </thead>
              <tbody>
                {materials.data.map((material) => {
                  const metrics = materialMetrics(cardsByMaterial.get(material.id) ?? [], quizByMaterial.get(material.id) ?? []);
                  const cardCell = cards.status === 'ok' ? cardsCell(metrics.cards) : null;
                  const testCell = quiz.status === 'ok' ? quizCell(metrics) : null;
                  const bothLoaded = cards.status === 'ok' && quiz.status === 'ok';
                  const share = bothLoaded ? accuracyCell(metrics) : null;
                  return (
                    <tr key={material.id} data-material={material.id}>
                      <td>
                        <Link to={`/library/${material.id}`} className="sf-cell-title">
                          {material.title || 'Без названия'}
                        </Link>
                      </td>
                      <td data-label="Карточки">
                        {cardCell ? (
                          <>
                            <span className={cardCell.quiet ? 'sf-cell-quiet' : undefined}>{cardCell.main}</span>
                            {cardCell.sub ? <span className="sf-cell-sub">{cardCell.sub}</span> : null}
                          </>
                        ) : cards.status === 'ok' ? (
                          <span className="sf-cell-quiet">карточек нет</span>
                        ) : null}
                      </td>
                      <td data-label="Тест, первая попытка">
                        {testCell ? (
                          <>
                            <span className={testCell.quiet ? 'sf-cell-quiet' : undefined}>{testCell.main}</span>
                            {testCell.sub ? <span className="sf-cell-sub">{testCell.sub}</span> : null}
                          </>
                        ) : null}
                      </td>
                      <td data-label="Верно при последней проверке" title={share && !share.quiet ? accuracyLabel(metrics) : undefined}>
                        {share ? (
                          <>
                            <span className={share.quiet ? 'sf-cell-quiet' : undefined}>{share.main}</span>
                            {share.sub ? <span className="sf-cell-sub">{share.sub}</span> : null}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3">
              <button type="button" className="sf-link" data-muted="" aria-expanded={howOpen} aria-controls="progress-how" onClick={() => setHowOpen((open) => !open)}>
                Как считается
              </button>
            </p>
            {howOpen ? (
              <p id="progress-how" className="max-w-[44em] text-[15px] leading-[22px] text-[var(--sf-muted)]">
                «Вспомнили» — повторённые карточки, на которые при последнем повторе вы ответили «Помню» или «С трудом»;
                карточки, которые ещё не повторялись, в счёт не идут. «Закреплены» — карточки с двумя успешными ответами в
                разные дни. «Тест» — первая попытка теста, повторные показаны отдельно и в счёт не идут. «Верно при последней
                проверке» = (вспомнили + верных ответов первого теста) ÷ (повторённых карточек + вопросов первого теста); если
                чего-то одного нет, считаем по другому. Число показываем от {MIN_MEASURED} ответов, меньше — «мало данных».
              </p>
            ) : null}
          </>
        )}
      </Section>

      <Section title="Ответы по дням">
        {activity.status === 'error' ? (
          <ErrorLine text="Активность по дням не загрузилась." onRetry={() => reload('activity')} />
        ) : activity.status === 'loading' ? (
          <Quiet>Загружаем…</Quiet>
        ) : (
          <>
            <Quiet>
              {summaryParts.length > 0
                ? `За ${ACTIVITY_DAYS} дней: ${summaryParts.join(', ')}.`
                : `За ${ACTIVITY_DAYS} дней ответов на карточки и тестов не было.`}
            </Quiet>
            {/* Bars only when there is something to draw: no empty axis (spec 4.6). */}
            {cardAnswers > 0 && <DayBars data={chartData} />}
          </>
        )}
      </Section>

      <Section title="Темы с открытыми ошибками" aside={<Link to="/mistakes" className="sf-link" data-muted="">Дневник ошибок</Link>}>
        {mistakes.status === 'error' ? (
          <ErrorLine text="Дневник ошибок не загрузился." onRetry={() => reload('mistakes')} />
        ) : mistakes.status === 'loading' ? (
          <Quiet>Загружаем…</Quiet>
        ) : (
          <MistakeTopics rows={mistakes.data} />
        )}
      </Section>

      {(legacyExams.status === 'error' || (legacyExams.status === 'ok' && legacyExams.data.length > 0)) && (
        <Section title="Устные экзамены (прежний формат)">
          {legacyExams.status === 'error' ? (
            <ErrorLine text="Прежние устные экзамены не загрузились." onRetry={() => reload('legacyExams')} />
          ) : legacyExams.status === 'ok' ? (
            <LegacyExams rows={legacyExams.data} />
          ) : null}
        </Section>
      )}
    </>
  );
}

function MistakeTopics({ rows }: { rows: MistakeRow[] }) {
  if (rows.length === 0) return <Quiet>Открытых ошибок нет.</Quiet>;
  const byTopic = new Map<string, number>();
  let withoutTopic = 0;
  for (const row of rows) {
    const topic = typeof row.topic === 'string' ? row.topic.trim() : '';
    if (topic) byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1);
    else withoutTopic += 1;
  }
  const top = Array.from(byTopic.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className="space-y-2">
      <p className="text-[16px] leading-[24px] text-[var(--sf-ink)]">Открытых ошибок: {rows.length}.</p>
      {top.length > 0 && (
        <ul className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
          {top.map(([topic, n]) => (
            <li key={topic} className="flex items-baseline justify-between gap-4 py-3 text-[16px] leading-[22px]">
              <span className="min-w-0 truncate text-[var(--sf-ink)]">{topic}</span>
              <span className="shrink-0 tabular-nums text-[var(--sf-muted)]">{count(n, ['ошибка', 'ошибки', 'ошибок'])}</span>
            </li>
          ))}
        </ul>
      )}
      {withoutTopic > 0 && <Quiet>Без темы: {withoutTopic}.</Quiet>}
    </div>
  );
}

function LegacyExams({ rows }: { rows: LegacyExamRow[] }) {
  const last = rows[0];
  return (
    <div className="space-y-2 text-[16px] leading-[24px] text-[var(--sf-ink)]">
      <p>
        Пройдено: {rows.length}. Последний {dayLabel(last.completed_at)}: {count(Number(last.score) || 0, ['балл', 'балла', 'баллов'])} из 100.
      </p>
      <ul className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
        {rows.slice(0, 5).map((row) => (
          <li key={row.id} className="flex items-baseline justify-between gap-4 py-3">
            <span className="min-w-0 truncate">
              {dayLabel(row.completed_at)}
              {row.subject ? ` · ${row.subject}` : ''}
            </span>
            <span className="shrink-0 tabular-nums text-[var(--sf-muted)]">{Number(row.score) || 0} из 100</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shortDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'd MMM', { locale: ru });
}

/**
 * Answers per day as plain columns (spec 5.17): ink at 55 %, square tops, the value over a non-zero
 * day, a 2 px stub on a zero day, an axis from the first day to «сегодня». No hover; a table for
 * screen readers.
 */
function DayBars({ data }: { data: Array<{ key: string; value: number }> }) {
  const max = Math.max(1, ...data.map((day) => day.value));
  const peak = data.reduce((best, day) => (day.value > best.value ? day : best), data[0]);
  return (
    <figure className="sf-bars mt-4">
      <div className="sf-bars-plot" aria-hidden="true">
        {data.map((day) => (
          <div key={day.key} className="sf-bars-day">
            {day.value > 0 ? (
              <>
                <span className="sf-bars-val">{day.value}</span>
                <span className="sf-bars-bar" style={{ height: `${Math.max(3, (day.value / max) * 100)}px` }} />
              </>
            ) : (
              <span className="sf-bars-bar" data-zero="" />
            )}
          </div>
        ))}
      </div>
      <div className="sf-bars-axis" aria-hidden="true">
        <span>{shortDay(data[0].key)}</span>
        <span>сегодня</span>
      </div>
      <figcaption className="mt-3 text-[15px] leading-[22px] text-[var(--sf-muted)]">
        {sentence(`Ответы на карточки по дням; больше всего ${peak.value} — ${shortDay(peak.key)}`)}
      </figcaption>
      <table className="sr-only">
        <caption>Ответов на карточки по дням</caption>
        <thead>
          <tr>
            <th scope="col">День</th>
            <th scope="col">Ответов</th>
          </tr>
        </thead>
        <tbody>
          {data.map((day) => (
            <tr key={day.key}>
              <td>{shortDay(day.key)}</td>
              <td>{day.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
