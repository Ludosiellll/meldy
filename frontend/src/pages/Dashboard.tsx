import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { ArrowRight, BarChart3, BookOpen, CalendarDays, CheckCircle2, FileText, Flame, Plus, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';
import { getDueCards } from '../api/flashcards';
import type { StudySession } from '../types';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<any[]>([]);
  const [dueCards, setDueCards] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      getMaterials(user.id),
      getDueCards(user.id),
      supabase.from('subjects').select('*').eq('user_id', user.id),
      supabase.from('study_sessions').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(30),
    ])
      .then(([materialsData, cardsData, subjectsResult, sessionsResult]) => {
        setMaterials(materialsData);
        setDueCards(cardsData);
        setSubjects(subjectsResult.data || []);
        setSessions(sessionsResult.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id]);

  const streak = useMemo(() => {
    const dates = new Set(sessions.map(session => session.date));
    let count = 0;
    let cursor = new Date();
    while (dates.has(format(cursor, 'yyyy-MM-dd'))) {
      count += 1;
      cursor = subDays(cursor, 1);
    }
    return count;
  }, [sessions]);

  const chartData = useMemo(() => {
    const reviewedByDate: Record<string, number> = {};
    sessions.forEach(session => {
      reviewedByDate[session.date] = session.cards_reviewed || 0;
    });
    return Array.from({ length: 14 }, (_, index) => {
      const date = subDays(new Date(), 13 - index);
      const key = format(date, 'yyyy-MM-dd');
      return { day: format(date, 'dd.MM'), reviewed: reviewedByDate[key] || 0 };
    });
  }, [sessions]);

  const nextExam = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return subjects
      .filter(subject => subject.exam_date && subject.exam_date >= today)
      .sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0] || null;
  }, [subjects]);

  const reviewedToday = sessions.find(session => session.date === format(new Date(), 'yyyy-MM-dd'))?.cards_reviewed || 0;
  const name = user?.user_metadata?.full_name?.split(' ')[0] || 'Студент';
  const primaryAction = materials.length === 0
    ? {
        eyebrow: 'Первый шаг',
        title: 'Добавьте учебный материал',
        description: 'Загрузите лекцию, конспект или запись. StudyForge подготовит конспект, карточки и тест.',
        label: 'Добавить материал',
        route: '/analyze',
        icon: Plus,
      }
    : dueCards.length > 0
      ? {
          eyebrow: 'На сегодня',
          title: `Повторить ${dueCards.length} ${pluralizeCards(dueCards.length)}`,
          description: 'Начните с карточек, срок которых уже наступил. Это займёт несколько минут.',
          label: 'Начать повторение',
          route: '/review',
          icon: RotateCcw,
        }
      : {
          eyebrow: 'На сегодня всё',
          title: 'Карточки повторены',
          description: 'Можно открыть последний материал или добавить новую лекцию.',
          label: 'Открыть библиотеку',
          route: '/library',
          icon: CheckCircle2,
        };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Загрузка">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
      </div>
    );
  }

  const PrimaryIcon = primaryAction.icon;
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:py-10">
      <header className="flex flex-col gap-5 border-b border-slate-200 pb-7 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sf-accent)]">Сегодня</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 md:text-4xl">{name}, что повторим?</h1>
          <p className="mt-2 text-sm capitalize text-slate-500 dark:text-slate-400">{format(new Date(), 'EEEE, d MMMM', { locale: ru })}</p>
        </div>
        <button type="button" onClick={() => navigate('/analyze')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <Plus className="h-4 w-4" /> Добавить материал
        </button>
      </header>

      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]">
        <button type="button" onClick={() => navigate(primaryAction.route)} className="group relative min-h-64 overflow-hidden rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-6 text-left text-[var(--sf-ink)] transition-colors hover:border-[var(--sf-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] sm:p-8">
          <div className="relative flex h-full min-h-48 flex-col justify-between gap-8">
            <div>
              <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-md border border-[var(--sf-line)] bg-[var(--sf-accent-soft)]"><PrimaryIcon className="h-5 w-5 text-[var(--sf-accent)]" /></div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sf-accent)]">{primaryAction.eyebrow}</p>
              <h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">{primaryAction.title}</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--sf-muted)] sm:text-base">{primaryAction.description}</p>
            </div>
            <span className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white shadow-[0_3px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] transition group-hover:-translate-y-px group-hover:bg-[var(--sf-accent-hover)] group-active:translate-y-px group-active:shadow-none">{primaryAction.label}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
          </div>
        </button>

        <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          <Metric label="Карточек на сегодня" value={dueCards.length} icon={RotateCcw} />
          <Metric label="Повторено сегодня" value={reviewedToday} icon={CheckCircle2} />
          <Metric label="Дней подряд" value={streak} icon={Flame} />
          <Metric label="Материалов" value={materials.length} icon={BookOpen} />
        </div>
      </section>

      {nextExam && (
        <button type="button" onClick={() => navigate('/courses')} className="mb-8 flex w-full items-center gap-4 border-y border-amber-300/40 bg-amber-50/60 px-1 py-4 text-left transition-colors hover:bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/15 dark:hover:bg-amber-950/25">
          <CalendarDays className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-400">Ближайший экзамен</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{nextExam.name}</p>
          </div>
          <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{format(new Date(nextExam.exam_date), 'd MMMM', { locale: ru })}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      )}

      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <div>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Библиотека</p><h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">Последние материалы</h2></div>
            <button type="button" onClick={() => navigate('/library')} className="text-sm font-medium text-[var(--sf-accent)] hover:opacity-80">Открыть все</button>
          </div>
          {materials.length === 0 ? (
            <div className="border-y border-dashed border-slate-300 py-10 text-center dark:border-slate-700"><FileText className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">В библиотеке пока нет материалов.</p></div>
          ) : (
            <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {materials.slice(0, 5).map(material => (
                <button type="button" key={material.id} onClick={() => navigate(`/library/${material.id}`)} className="group flex w-full items-center gap-3 py-4 text-left">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 group-hover:text-cyan-700 dark:text-slate-200 dark:group-hover:text-cyan-300">{material.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">{format(new Date(material.created_at), 'dd.MM.yy')}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-1 dark:text-slate-600" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">14 дней</p><h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">Повторённые карточки</h2></div>
            <button type="button" onClick={() => navigate('/analytics')} aria-label="Открыть прогресс" className="text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300"><BarChart3 className="h-5 w-5" /></button>
          </div>
          <div className="h-60 border-y border-slate-200 py-5 dark:border-slate-800">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} interval={3} tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'rgba(34,211,238,.06)' }} contentStyle={{ background: '#091827', border: '1px solid rgba(103,232,249,.25)', borderRadius: 8, color: '#fff', fontSize: 12 }} formatter={(value: number) => [value, 'Карточек']} labelFormatter={label => `Дата: ${label}`} />
                <Bar dataKey="reviewed" fill="#67e8f9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return <div className="flex items-center gap-3 py-4 first:pt-0 last:pb-0 lg:first:pt-4 lg:last:pb-4"><Icon className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-300" /><span className="min-w-0 flex-1 text-sm text-slate-500 dark:text-slate-400">{label}</span><strong className="text-xl font-semibold tabular-nums text-slate-950 dark:text-slate-50">{value}</strong></div>;
}

function pluralizeCards(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'карточку';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'карточки';
  return 'карточек';
}
