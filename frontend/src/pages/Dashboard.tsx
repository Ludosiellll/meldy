import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ArrowRight, FileText, Plus } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';
import { countDueCards, syncFlashcards } from '../api/flashcards';
import { fetchQuestionEvents } from '../api/learning';
import { examSummary, statesByHash } from '../lib/learning/readiness';
import { currentStreak, isDateKey, localDateKey, shiftDateKey } from '../utils/streak';
import { pluralRu } from '../components/conversation/visuals';
import type { Flashcard, StudySession } from '../types';

/** Exams dated from today up to this many days ahead appear on «Сегодня». */
const EXAM_HORIZON_DAYS = 21;
const CHART_DAYS = 14;

interface MaterialRow {
  id: string;
  title: string;
  created_at: string;
  flashcards_json?: unknown;
}

interface NearExam {
  id: string;
  title: string;
  daysLeft: number;
  total: number;
  /** Questions marked «есть в лекциях» (coverage 'full'). */
  inLectures: number;
  /** Checked only by words (coverage 'unverified'): neither «есть» nor «нет». */
  unverified: number;
  /** Never mapped (coverage null): a new list, an edited question, an interrupted run. */
  unmapped: number;
  /** exams.mapped_at: the oldest mark of the current mapping, null before the first run. */
  mappedAt: string | null;
  confirmed: number;
  /** Questions with at least one answer aloud. */
  answered: number;
}

export type ExamCoverageCounts = Pick<NearExam, 'total' | 'inLectures' | 'unverified' | 'unmapped'>;

const COVERAGE_VALUES = new Set(['full', 'partial', 'none', 'unverified']);

interface DashboardData {
  materials: MaterialRow[];
  dueCount: number;
  sessions: StudySession[];
  /** Recent materials that have at least one review card; null when that could not be read. */
  materialsWithCards: Set<string> | null;
  exam: NearExam | null;
  examFailed: boolean;
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
export function cardsMissingFromReview(material: MaterialRow, materialsWithCards: Set<string> | null): boolean {
  if (!materialsWithCards || materialsWithCards.has(material.id)) return false;
  return analysisCards(material.flashcards_json).length > 0;
}

/**
 * The coverage sentence of an exam. A list that was never mapped says so instead of «0 из N»;
 * questions checked only by words and questions not mapped yet are named, never counted as «нет».
 */
export function examCoverageText(exam: ExamCoverageCounts): string {
  if (exam.unmapped >= exam.total) return 'Разметки по лекциям ещё нет.';
  let text = `Есть в ваших лекциях: ${exam.inLectures} из ${exam.total}.`;
  if (exam.unverified > 0) text += ` Проверено только по словам: ${exam.unverified}.`;
  if (exam.unmapped > 0) text += ` Не размечено: ${exam.unmapped}.`;
  return text;
}

/** Answers aloud: «Подтверждено ответами: N из M.», or plainly that there were none yet. */
export function examAnswersText(exam: Pick<NearExam, 'total' | 'confirmed' | 'answered'>): string {
  return exam.answered > 0 ? `Подтверждено ответами: ${exam.confirmed} из ${exam.total}.` : 'Ответов по билетам ещё не было.';
}

/** The date of the mapping in the words of the exam sheet: «Разметка от 21 января, 9:40.» */
export function mappingDateText(mappedAt: string | null | undefined): string | null {
  if (!mappedAt) return null;
  const date = new Date(mappedAt);
  return Number.isNaN(date.getTime()) ? null : `Разметка от ${format(date, 'd MMMM, H:mm', { locale: ru })}.`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'dd.MM.yy');
}

function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function examWhen(daysLeft: number): string {
  if (daysLeft <= 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  return `через ${daysLeft} ${pluralRu(daysLeft, ['день', 'дня', 'дней'])}`;
}

async function loadNearestExam(userId: string): Promise<NearExam | null> {
  const today = localDateKey();
  const { data, error } = await supabase
    .from('exams')
    .select('id, title, exam_date, mapped_at')
    .eq('user_id', userId)
    .gte('exam_date', today)
    .lte('exam_date', shiftDateKey(today, EXAM_HORIZON_DAYS))
    .order('exam_date', { ascending: true })
    .limit(1);
  if (error) throw error;
  const exam = (data || [])[0] as { id: string; title: string; exam_date: string; mapped_at?: string | null } | undefined;
  if (!exam || !isDateKey(exam.exam_date)) return null;

  const { data: questions, error: questionsError } = await supabase
    .from('exam_questions')
    .select('id, question_hash, coverage')
    .eq('exam_id', exam.id);
  if (questionsError) throw questionsError;
  const rows = (questions || []) as Array<{ question_hash: string | null; coverage: string | null }>;
  const hashes = rows.map((row) => row.question_hash).filter((hash): hash is string => typeof hash === 'string' && hash !== '');
  const events = hashes.length > 0 ? await fetchQuestionEvents(hashes, ['exam_answer']) : [];
  const summary = examSummary(hashes, statesByHash(events));
  return {
    id: exam.id,
    title: exam.title,
    daysLeft: daysBetween(today, exam.exam_date),
    total: rows.length,
    inLectures: rows.filter((row) => row.coverage === 'full').length,
    unverified: rows.filter((row) => row.coverage === 'unverified').length,
    unmapped: rows.filter((row) => !COVERAGE_VALUES.has(row.coverage ?? '')).length,
    mappedAt: exam.mapped_at ?? null,
    confirmed: summary.confirmed,
    answered: summary.confirmed + summary.once + summary.notPassed,
  };
}

async function loadMaterialsWithCards(userId: string, materialIds: string[]): Promise<Set<string>> {
  if (materialIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('flashcard_progress')
    .select('material_id')
    .eq('user_id', userId)
    .in('material_id', materialIds);
  if (error) throw error;
  return new Set(((data || []) as Array<{ material_id: string | null }>).map((row) => row.material_id ?? '').filter(Boolean));
}

async function loadDashboard(userId: string): Promise<DashboardData> {
  const examPromise = loadNearestExam(userId).then(
    (exam) => ({ exam, failed: false }),
    (error) => {
      console.error('Loading the nearest exam failed:', error);
      return { exam: null, failed: true };
    },
  );
  const [materials, dueCount, sessionsResult] = await Promise.all([
    getMaterials(userId) as Promise<MaterialRow[]>,
    countDueCards(userId),
    supabase.from('study_sessions').select('date, cards_reviewed').eq('user_id', userId).order('date', { ascending: false }).limit(60),
  ]);
  if (sessionsResult.error) throw sessionsResult.error;
  const recent = materials.slice(0, 5);
  const [materialsWithCards, exam] = await Promise.all([
    // Only the «не добавлены в повторение» notes depend on this read: without it they are left out.
    loadMaterialsWithCards(userId, recent.map((material) => material.id)).catch((error) => {
      console.error('Reading review cards of recent materials failed:', error);
      return null;
    }),
    examPromise,
  ]);
  return {
    materials,
    dueCount,
    sessions: (sessionsResult.data || []) as StudySession[],
    materialsWithCards,
    exam: exam.exam,
    examFailed: exam.failed,
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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

  const sessions = data?.sessions ?? [];
  const streak = useMemo(() => currentStreak(sessions.map((session) => session.date)), [sessions]);

  const chartData = useMemo(() => {
    const reviewedByDate = new Map<string, number>();
    for (const session of sessions) {
      const key = typeof session.date === 'string' ? session.date.slice(0, 10) : '';
      reviewedByDate.set(key, (reviewedByDate.get(key) ?? 0) + (Number(session.cards_reviewed) || 0));
    }
    const today = localDateKey();
    return Array.from({ length: CHART_DAYS }, (_, index) => {
      const key = shiftDateKey(today, index - (CHART_DAYS - 1));
      return { key, value: reviewedByDate.get(key) ?? 0 };
    });
  }, [sessions]);

  const addCardsToReview = async (material: MaterialRow) => {
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

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Загрузка">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--sf-accent-fg)] border-t-transparent motion-reduce:animate-none" />
      </div>
    );
  }

  const name = user?.user_metadata?.full_name?.split(' ')[0] || 'Студент';
  const header = (
    <header className="flex flex-col gap-5 border-b border-[var(--sf-line)] pb-7 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="mb-2 text-sm text-[var(--sf-muted)]">Сегодня, {format(new Date(), 'EEEE, d MMMM', { locale: ru })}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--sf-ink)] md:text-4xl">{name}, что повторим?</h1>
      </div>
      <button
        type="button"
        onClick={() => navigate('/analyze')}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--sf-line)] bg-[var(--sf-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--sf-ink)] transition-colors hover:bg-[var(--sf-surface-soft)]"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Добавить материал
      </button>
    </header>
  );

  if (loadError || !data) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:py-10">
        {header}
        <section className="py-10">
          <h2 className="text-xl font-semibold text-[var(--sf-ink)]">Не удалось загрузить данные</h2>
          <p role="alert" className="mt-2 text-sm text-[var(--sf-muted)]">
            Проверьте соединение. Материалы и карточки никуда не делись, их просто не получилось прочитать.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--sf-accent-hover)] active:translate-y-px"
          >
            Повторить
          </button>
        </section>
      </main>
    );
  }

  const { materials, dueCount, exam } = data;
  const todayKey = localDateKey();
  const reviewedToday = sessions
    .filter((session) => typeof session.date === 'string' && session.date.slice(0, 10) === todayKey)
    .reduce((sum, session) => sum + (Number(session.cards_reviewed) || 0), 0);
  const dueTitle = `Повторить ${dueCount} ${pluralRu(dueCount, ['карточку', 'карточки', 'карточек'])}`;
  const mappingDate = exam ? mappingDateText(exam.mappedAt) : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:py-10">
      {header}

      <section className="grid grid-cols-[minmax(0,1fr)] gap-8 py-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]">
        <div className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-6 text-[var(--sf-ink)] sm:p-8">
          {materials.length === 0 ? (
            <PrimaryCard
              eyebrow="Первый шаг"
              title="Добавьте учебный материал"
              description="Загрузите лекцию, конспект или запись. Meldy подготовит конспект, карточки и тест."
              action={{ label: 'Добавить материал', to: '/analyze' }}
            />
          ) : exam ? (
            <div>
              <p className="text-sm text-[var(--sf-muted)]">Ближайший экзамен</p>
              <h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
                {exam.title} — {examWhen(exam.daysLeft)}.
              </h2>
              {exam.total > 0 ? (
                <>
                  <p className="mt-3 max-w-xl text-base leading-7 text-[var(--sf-ink)]">
                    {examCoverageText(exam)} {examAnswersText(exam)}
                  </p>
                  {exam.unmapped < exam.total && mappingDate && (
                    <p className="mt-1 text-sm text-[var(--sf-muted)]">{mappingDate}</p>
                  )}
                </>
              ) : (
                <p className="mt-3 max-w-xl text-base leading-7 text-[var(--sf-muted)]">Вопросов в списке пока нет.</p>
              )}
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                {exam.total > 0 && (
                  <Link
                    to={`/exams/${exam.id}/draw`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white shadow-[0_3px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] transition hover:bg-[var(--sf-accent-hover)] active:translate-y-px active:shadow-none"
                  >
                    Тянуть билет <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
                <Link
                  to={`/exams/${exam.id}`}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
                >
                  Лист экзамена
                </Link>
                {dueCount > 0 && (
                  <Link
                    to="/review"
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
                  >
                    {dueTitle}
                  </Link>
                )}
              </div>
            </div>
          ) : dueCount > 0 ? (
            <PrimaryCard
              eyebrow="На сегодня"
              title={dueTitle}
              description="Начните с карточек, срок которых уже наступил. Это займёт несколько минут."
              action={{ label: 'Начать повторение', to: '/review' }}
            />
          ) : (
            <PrimaryCard
              eyebrow="На сегодня"
              title="Карточек к повторению сейчас нет"
              description="Срок следующего повторения ещё не наступил. Можно открыть последний материал или добавить новую лекцию."
              action={{ label: 'Открыть библиотеку', to: '/library' }}
            />
          )}
          {data.examFailed && (
            <p className="mt-6 text-sm text-[var(--sf-muted)]">
              Экзамены не загрузились.{' '}
              <button type="button" onClick={() => void load()} className="min-h-11 font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">
                Повторить
              </button>
            </p>
          )}
        </div>

        <dl className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
          <Metric label="Карточек к повторению" value={dueCount} />
          <Metric label="Ответов на карточки сегодня" value={reviewedToday} />
          <Metric label="Дней подряд" value={streak} />
          <Metric label="Материалов" value={materials.length} />
        </dl>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-[var(--sf-ink)]">Последние материалы</h2>
            <Link to="/library" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">
              Открыть все
            </Link>
          </div>
          {materials.length === 0 ? (
            <div className="border-y border-dashed border-[var(--sf-line)] py-10 text-center">
              <FileText className="mx-auto h-6 w-6 text-[var(--sf-muted)]" aria-hidden="true" />
              <p className="mt-3 text-sm text-[var(--sf-muted)]">В библиотеке пока нет материалов.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
              {materials.slice(0, 5).map((material) => {
                const missing = cardsMissingFromReview(material, data.materialsWithCards);
                return (
                  <li key={material.id} className="py-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/library/${material.id}`)}
                      className="group flex min-h-11 w-full items-center gap-3 text-left"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--sf-ink)] group-hover:text-[var(--sf-accent-fg)]">{material.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--sf-muted)]">{shortDate(material.created_at)}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--sf-muted)] transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </button>
                    {missing && (
                      <p className="ml-7 text-sm text-[var(--sf-muted)]">
                        Карточки этой лекции не добавлены в повторение.{' '}
                        <button
                          type="button"
                          disabled={syncing !== null}
                          onClick={() => void addCardsToReview(material)}
                          className="min-h-11 font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline disabled:opacity-60"
                        >
                          {syncing === material.id ? 'Добавляем…' : 'Добавить'}
                        </button>
                        {syncError === material.id && <span role="alert"> Не получилось, попробуйте ещё раз.</span>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-[var(--sf-ink)]">Ответов на карточки по дням</h2>
            <Link to="/analytics" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">
              Прогресс
            </Link>
          </div>
          <DayBars data={chartData} caption={`${CHART_DAYS} дней`} />
        </div>
      </section>
    </main>
  );
}

function PrimaryCard({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action: { label: string; to: string } }) {
  return (
    <div>
      <p className="text-sm text-[var(--sf-muted)]">{eyebrow}</p>
      <h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--sf-muted)] sm:text-base">{description}</p>
      <Link
        to={action.to}
        className="mt-8 inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white shadow-[0_3px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] transition hover:bg-[var(--sf-accent-hover)] active:translate-y-px active:shadow-none"
      >
        {action.label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-3 py-4">
      <dt className="min-w-0 flex-1 text-sm text-[var(--sf-muted)]">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums text-[var(--sf-ink)]">{value}</dd>
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
  const peakDay = shortDay(peak.key);
  return (
    <figure className="border-y border-[var(--sf-line)] py-5">
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
          : `За ${caption}: ${total} ${pluralRu(total, ['ответ', 'ответа', 'ответов'])}, больше всего ${peak.value} — ${peakDay}${peakDay.endsWith('.') ? '' : '.'}`}
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
