import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BarChart2, GraduationCap } from 'lucide-react';
import Gradebook from '../components/Gradebook';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { fetchMaterialEvents, fetchQuestionEvents, type LearningEvent } from '../api/learning';
import { confidenceVsConfirmed, examSummary, statesByHash } from '../lib/learning/readiness';
import { materialMetrics, MIN_MEASURED, type MaterialMetrics, type ProgressCard } from '../utils/progressMetrics';
import { currentStreak, isDateKey, localDateKey, shiftDateKey } from '../utils/streak';
import { pluralRu } from '../components/conversation/visuals';

/**
 * «Прогресс»: measured counters with their formula and the time they were counted.
 *
 * Every block reads its own source and fails on its own: a failed query shows a plain line with
 * «Повторить», never zeros. Card numbers come from flashcard_progress, test numbers from the
 * journal (the first attempt of a test, never a retake), exam numbers from exam_questions and the
 * answers aloud in the journal. Old-format oral exams are only the exam_sessions rows of kind
 * 'professor'; answers to exam tickets are counted in «Экзамены», not twice.
 */

const PAGE_SIZE = 1000;
const ACTIVITY_DAYS = 30;

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
  examDate: string | null;
  /** exams.mapped_at: the oldest mark of the current mapping, null before the first run. */
  mappedAt: string | null;
  total: number;
  coverage: { full: number; partial: number; none: number; unverified: number; unmapped: number };
  summary: ReturnType<typeof examSummary>;
  confidence: ReturnType<typeof confidenceVsConfirmed>;
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
      .select('id, title, exam_date, mapped_at')
      .eq('user_id', userId)
      .order('exam_date', { ascending: true, nullsFirst: false });
    if (error) throw error;
    const exams = (data || []) as Array<{ id: string; title: string; exam_date: string | null; mapped_at?: string | null }>;
    if (exams.length === 0) return [];
    const questions = await readAll<{ exam_id: string; question_hash: string | null; coverage: string | null }>((from, to) =>
      supabase
        .from('exam_questions')
        .select('id, exam_id, question_hash, coverage')
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
      return {
        id: exam.id,
        title: exam.title,
        examDate: exam.exam_date,
        mappedAt: exam.mapped_at ?? null,
        total: rows.length,
        coverage,
        summary: examSummary(examHashes, states),
        confidence: confidenceVsConfirmed(examHashes, states),
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

/** Ends a sentence with one period: «… 4 окт.» already has it. */
function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/**
 * «Вспомнили» counts only cards that were reviewed: a new card or an examiner's follow-up card
 * waiting for its first review is not forgotten, so it is named apart, never put in the «из».
 */
export function cardsLine(cards: MaterialMetrics['cards']): string | null {
  if (cards.total === 0) return null;
  if (cards.reviewed === 0) return `Карточки: ${cards.total}, ещё не ${pluralRu(cards.total, ['повторялась', 'повторялись', 'повторялись'])}.`;
  const waiting = cards.total - cards.reviewed;
  const rest = waiting > 0 ? `, ещё ${waiting} ${pluralRu(waiting, ['не повторялась', 'не повторялись', 'не повторялись'])}` : '';
  const next = cards.nextCheck ? `, следующая проверка ${dayLabel(cards.nextCheck)}` : '';
  return sentence(
    `Карточки: вспомнили ${cards.recalled} из ${cards.reviewed} при последнем повторе${rest}. Закреплено ${cards.consolidated} из ${cards.total}${next}`,
  );
}

/** Names what the share is made of: the reviewed cards, the first test, or both. */
export function accuracyLabel(metrics: Pick<MaterialMetrics, 'cards' | 'quiz'>): string {
  if (!metrics.quiz) return 'Верно по карточкам';
  if (metrics.cards.reviewed === 0) return 'Верно в первом тесте';
  return 'Верно по карточкам и первому тесту';
}

/** The date of the mapping in the words of the exam sheet: «Разметка от 21 января, 9:40.» */
export function mappingDateText(mappedAt: string | null | undefined): string | null {
  if (!mappedAt) return null;
  const date = new Date(mappedAt);
  return Number.isNaN(date.getTime()) ? null : `Разметка от ${format(date, 'd MMMM, H:mm', { locale: ru })}.`;
}

function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <p role="alert" className="text-sm text-[var(--sf-ink)]">
      {text}{' '}
      <button type="button" onClick={onRetry} className="min-h-[44px] font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">
        Повторить
      </button>
    </p>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-xl font-semibold text-[var(--sf-ink)]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'gradebook' ? 'gradebook' : 'platform';
  const setActiveTab = (tab: string) => setSearchParams({ tab });
  const [sources, setSources] = useState<Sources>(LOADING);
  const [computedAt, setComputedAt] = useState<Date | null>(null);

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
      setComputedAt(new Date());
    },
    [user?.id],
  );

  useEffect(() => {
    if (!user?.id) return;
    setSources(LOADING);
    void Promise.all(SOURCE_KEYS.map((key) => loadSource(key)));
  }, [user?.id, loadSource]);

  const initialLoading = SOURCE_KEYS.every((key) => sources[key].status === 'loading');

  const tabs = (
    <div className="flex w-full select-none rounded-lg border border-[var(--sf-line)] p-1 md:w-auto" role="tablist">
      {([
        ['platform', 'Обучение', BarChart2],
        ['gradebook', 'Оценки', GraduationCap],
      ] as const).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeTab === id}
          onClick={() => setActiveTab(id)}
          className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold transition-colors md:flex-none ${
            activeTab === id ? 'bg-[var(--sf-accent)] text-white' : 'text-[var(--sf-muted)] hover:text-[var(--sf-ink)]'
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 md:py-10">
      <div className="flex flex-col gap-5 border-b border-[var(--sf-line)] pb-7 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--sf-ink)] md:text-4xl">Прогресс</h1>
          <p className="mt-2 text-sm text-[var(--sf-muted)]">
            {activeTab === 'gradebook'
              ? 'Оценки из вашей зачётки.'
              : computedAt
                ? `Посчитано ${format(computedAt, 'd MMM, HH:mm', { locale: ru })} по вашим ответам.`
                : 'Считаем по вашим ответам…'}
          </p>
        </div>
        {tabs}
      </div>

      {activeTab === 'gradebook' ? (
        <Gradebook />
      ) : initialLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Загрузка">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--sf-accent-fg)] border-t-transparent motion-reduce:animate-none" />
        </div>
      ) : (
        <ProgressBody sources={sources} reload={loadSource} />
      )}
    </main>
  );
}

function ProgressBody({ sources, reload }: { sources: Sources; reload: (key: SourceKey) => void }) {
  const { materials, cards, quiz, activity, legacyExams, mistakes, exams } = sources;

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

  // One-sentence summary from the sources that loaded.
  const summaryParts: string[] = [];
  if (activity.status === 'ok') {
    const answers = chartData.reduce((sum, day) => sum + day.value, 0);
    const activeDays = new Set(activity.data.map((row) => row.date.slice(0, 10)).filter((key) => key >= firstDay && key <= today)).size;
    summaryParts.push(`${count(answers, ['ответ', 'ответа', 'ответов'])} на карточки`);
    if (quiz.status === 'ok') {
      const tests = new Set(quiz.data.filter((e) => e.local_date >= firstDay && e.session_id).map((e) => e.session_id)).size;
      summaryParts.push(count(tests, ['тест', 'теста', 'тестов']));
    }
    summaryParts.push(`занятия в ${activeDays} из ${ACTIVITY_DAYS} дней`);
    const streak = currentStreak(activity.data.map((row) => row.date));
    summaryParts.push(`сейчас ${count(streak, ['день', 'дня', 'дней'])} подряд`);
  }

  return (
    <div className="space-y-10">
      {activity.status === 'ok' ? (
        <p className="max-w-3xl text-lg leading-8 text-[var(--sf-ink)]">За {ACTIVITY_DAYS} дней: {summaryParts.join(', ')}.</p>
      ) : activity.status === 'error' ? (
        <ErrorLine text="Активность по дням не загрузилась." onRetry={() => reload('activity')} />
      ) : null}

      <Section title="Материалы">
        {materials.status === 'error' ? (
          <ErrorLine text="Материалы не загрузились." onRetry={() => reload('materials')} />
        ) : materials.status === 'loading' ? (
          <p role="status" className="text-sm text-[var(--sf-muted)]">Загружаем…</p>
        ) : materials.data.length === 0 ? (
          <p className="text-sm text-[var(--sf-muted)]">
            Материалов пока нет. <Link to="/analyze" className="font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">Добавить материал</Link>
          </p>
        ) : (
          <>
            {cards.status === 'error' && <ErrorLine text="Карточки не загрузились, их счётчики не показаны." onRetry={() => reload('cards')} />}
            {quiz.status === 'error' && <ErrorLine text="Результаты тестов не загрузились." onRetry={() => reload('quiz')} />}
            <ul className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
              {materials.data.map((material) => {
                const metrics = materialMetrics(cardsByMaterial.get(material.id) ?? [], quizByMaterial.get(material.id) ?? []);
                const cardText = cards.status === 'ok' ? cardsLine(metrics.cards) : null;
                const bothLoaded = cards.status === 'ok' && quiz.status === 'ok';
                return (
                  <li key={material.id} className="py-4">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Link to={`/library/${material.id}`} className="font-medium text-[var(--sf-ink)] underline-offset-4 hover:underline">
                        {material.title || 'Без названия'}
                      </Link>
                      {material.subject && <span className="text-sm text-[var(--sf-muted)]">{material.subject}</span>}
                    </div>
                    <div className="mt-1 space-y-0.5 text-sm leading-6 text-[var(--sf-ink)]">
                      {cardText && <p>{cardText}</p>}
                      {quiz.status === 'ok' && metrics.quiz && (
                        <p>Тест {dayLabel(metrics.quiz.date)}: {metrics.quiz.correct} из {metrics.quiz.total}.</p>
                      )}
                      {quiz.status === 'ok' && metrics.quizRepeat && (
                        <p className="text-[var(--sf-muted)]">Повторно {dayLabel(metrics.quizRepeat.date)}: {metrics.quizRepeat.correct} из {metrics.quizRepeat.total}.</p>
                      )}
                      {bothLoaded && metrics.status === 'measured' && metrics.accuracy && (
                        <p>
                          {accuracyLabel(metrics)}: {Math.round(metrics.accuracy.value * 100)}% ({metrics.accuracy.numerator} из {metrics.accuracy.denominator}).
                        </p>
                      )}
                      {bothLoaded && metrics.status === 'few_data' && <p className="text-[var(--sf-muted)]">{accuracyLabel(metrics)}: мало данных.</p>}
                      {bothLoaded && metrics.status === 'untested' && <p className="text-[var(--sf-muted)]">Не проверялось</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--sf-muted)]">
              Как считается. «Вспомнили» — повторённые карточки, на которые при последнем повторе вы ответили «Знаю» или
              «С трудом»; карточки, которые ещё не повторялись, в счёт не идут. «Закреплено» — карточки с двумя успешными
              ответами в разные дни. «Тест» — первая попытка теста, повторные показаны отдельно и в счёт не идут. «Верно по
              карточкам и первому тесту» = (вспомнили + верных ответов первого теста) ÷ (повторённых карточек + вопросов первого
              теста); если чего-то одного нет, считаем по другому. Число показываем от {MIN_MEASURED} ответов, меньше — «мало данных».
            </p>
          </>
        )}
      </Section>

      <Section title="Экзамены" aside={<Link to="/exams" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">Все экзамены</Link>}>
        {exams.status === 'error' ? (
          <ErrorLine text="Экзамены не загрузились." onRetry={() => reload('exams')} />
        ) : exams.status === 'loading' ? (
          <p role="status" className="text-sm text-[var(--sf-muted)]">Загружаем…</p>
        ) : exams.data.length === 0 ? (
          <p className="text-sm text-[var(--sf-muted)]">Экзаменов пока нет. Добавьте список вопросов, и здесь появится, что из него есть в ваших лекциях.</p>
        ) : (
          <ul className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
            {exams.data.map((exam) => (
              <li key={exam.id} className="py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link to={`/exams/${exam.id}`} className="font-medium text-[var(--sf-ink)] underline-offset-4 hover:underline">
                    {exam.title}
                  </Link>
                  {exam.examDate && <span className="text-sm text-[var(--sf-muted)]">экзамен {dayLabel(exam.examDate)}</span>}
                </div>
                <div className="mt-1 space-y-0.5 text-sm leading-6 text-[var(--sf-ink)]">
                  {exam.total === 0 ? (
                    <p className="text-[var(--sf-muted)]">Вопросов в списке пока нет.</p>
                  ) : (
                    <>
                      {exam.coverage.unmapped >= exam.total ? (
                        // A list that was never mapped says so instead of «0 из N».
                        <p>Разметки по лекциям ещё нет.</p>
                      ) : (
                        <>
                          <p>
                            Есть в ваших лекциях: {exam.coverage.full} из {exam.total}. Частично: {exam.coverage.partial}. Нет: {exam.coverage.none}.
                            {exam.coverage.unverified > 0 && ` Проверено только по словам: ${exam.coverage.unverified}.`}
                            {exam.coverage.unmapped > 0 && ` Не размечено: ${exam.coverage.unmapped}.`}
                          </p>
                          {mappingDateText(exam.mappedAt) && <p className="text-[var(--sf-muted)]">{mappingDateText(exam.mappedAt)}</p>}
                        </>
                      )}
                      <p>
                        {exam.summary.confirmed + exam.summary.once + exam.summary.notPassed > 0
                          ? sentence(`Подтверждено ответами: ${exam.summary.confirmed} из ${exam.total}${exam.summary.since ? `, с ${dayLabel(exam.summary.since)}` : ''}`)
                          : 'Ответов по билетам ещё не было.'}
                      </p>
                      {exam.confidence.enoughData ? (
                        <p>
                          Вы отметили «знаю» у {count(exam.confidence.ratedKnow, ['вопроса', 'вопросов', 'вопросов'])}. Из{' '}
                          {exam.confidence.ratedKnowAnswered} таких, на которые вы ответили вслух, зачтено {exam.confidence.ratedKnowPassed}.
                        </p>
                      ) : (
                        <p className="text-[var(--sf-muted)]">Самооценка против ответов вслух: мало данных.</p>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Ответов на карточки по дням, ${ACTIVITY_DAYS} дней`}>
        {activity.status === 'error' ? (
          <ErrorLine text="Активность по дням не загрузилась." onRetry={() => reload('activity')} />
        ) : activity.status === 'loading' ? (
          <p role="status" className="text-sm text-[var(--sf-muted)]">Загружаем…</p>
        ) : (
          <DayBars data={chartData} caption={`${ACTIVITY_DAYS} дней`} />
        )}
      </Section>

      <Section title="Темы с открытыми ошибками" aside={<Link to="/mistakes" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">Дневник ошибок</Link>}>
        {mistakes.status === 'error' ? (
          <ErrorLine text="Дневник ошибок не загрузился." onRetry={() => reload('mistakes')} />
        ) : mistakes.status === 'loading' ? (
          <p role="status" className="text-sm text-[var(--sf-muted)]">Загружаем…</p>
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
    </div>
  );
}

function MistakeTopics({ rows }: { rows: MistakeRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--sf-muted)]">Открытых ошибок нет.</p>;
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
      <p className="text-sm text-[var(--sf-ink)]">Открытых ошибок: {rows.length}.</p>
      {top.length > 0 && (
        <ul className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
          {top.map(([topic, n]) => (
            <li key={topic} className="flex items-baseline justify-between gap-4 py-3 text-sm">
              <span className="min-w-0 truncate text-[var(--sf-ink)]">{topic}</span>
              <span className="shrink-0 tabular-nums text-[var(--sf-muted)]">{count(n, ['ошибка', 'ошибки', 'ошибок'])}</span>
            </li>
          ))}
        </ul>
      )}
      {withoutTopic > 0 && <p className="text-sm text-[var(--sf-muted)]">Без темы: {withoutTopic}.</p>}
    </div>
  );
}

function LegacyExams({ rows }: { rows: LegacyExamRow[] }) {
  const last = rows[0];
  return (
    <div className="space-y-2 text-sm text-[var(--sf-ink)]">
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

/** Answers per day as plain columns on the paper surface, with a table for screen readers. */
function DayBars({ data, caption }: { data: Array<{ key: string; value: number }>; caption: string }) {
  const max = Math.max(1, ...data.map((day) => day.value));
  const total = data.reduce((sum, day) => sum + day.value, 0);
  const peak = data.reduce((best, day) => (day.value > best.value ? day : best), data[0]);
  return (
    <figure>
      <div className="flex h-40 items-end gap-[2px] border-b border-[var(--sf-line)]" aria-hidden="true">
        {data.map((day) => (
          <div key={day.key} className="group relative flex h-full flex-1 items-end justify-center">
            {day.value > 0 && (
              <div
                className="w-full max-w-6 rounded-t-[4px] bg-[var(--sf-accent-fg)] transition-opacity group-hover:opacity-80"
                style={{ height: `${Math.max(4, (day.value / max) * 100)}%` }}
              />
            )}
            <span className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded bg-[var(--sf-ink)] px-1.5 py-0.5 text-xs text-[var(--sf-canvas)] group-hover:block">
              {shortDay(day.key)}: {day.value}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-[var(--sf-muted)]" aria-hidden="true">
        <span>{shortDay(data[0].key)}</span>
        <span>{shortDay(data[data.length - 1].key)}</span>
      </div>
      <figcaption className="mt-3 text-sm text-[var(--sf-muted)]">
        {total === 0
          ? `За ${caption} ответов на карточки нет.`
          : sentence(`За ${caption}: ${count(total, ['ответ', 'ответа', 'ответов'])}, больше всего ${peak.value} — ${shortDay(peak.key)}`)}
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
