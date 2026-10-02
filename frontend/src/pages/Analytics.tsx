import { ExamResult, StudySession, Mistake } from '../types';
import { useState, useEffect } from 'react';
import Gradebook from '../components/Gradebook';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart2, Flame, Trophy, BookMarked, Brain,
  Zap, TrendingUp, Calendar, Target, Award, Star,
  ChevronRight, GraduationCap, Layers
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeProvider';

export default function Analytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const activeTab = searchParams.get('tab') === 'gradebook' ? 'gradebook' : 'platform';
  const setActiveTab = (tab: string) => setSearchParams({ tab });
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [mistakes, setMistakes] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [cardProgress, setCardProgress] = useState<any[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      supabase.from('study_sessions').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(60),
      supabase.from('exam_sessions').select('*').eq('user_id', user.id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(30),
      supabase.from('mistake_diary').select('*').eq('user_id', user.id),
      supabase.from('materials').select('id, title, subject, created_at').eq('user_id', user.id),
      supabase.from('flashcard_progress').select('material_id, repetitions').eq('user_id', user.id),
    ]).then(([sessRes, examsRes, mistakesRes, matsRes, cardsRes]) => {
      setSessions(sessRes.data ?? []);
      setExams(examsRes.data ?? []);
      setMistakes(mistakesRes.data ?? []);
      setMaterials(matsRes.data ?? []);
      setCardProgress(cardsRes.data ?? []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [user?.id]);

  // Расчет владения темами
  const knowledgeHeatmap = (() => {
    const cardsByMaterial: Record<string, { total: number; mastered: number }> = {};
    cardProgress.forEach(c => {
      if (!c.material_id) return;
      if (!cardsByMaterial[c.material_id]) {
        cardsByMaterial[c.material_id] = { total: 0, mastered: 0 };
      }
      cardsByMaterial[c.material_id].total += 1;
      if (c.repetitions >= 3) {
        cardsByMaterial[c.material_id].mastered += 1;
      }
    });

    const examsByMaterial: Record<string, { totalScore: number; count: number }> = {};
    exams.forEach(e => {
      if (!e.material_id) return;
      if (!examsByMaterial[e.material_id]) {
        examsByMaterial[e.material_id] = { totalScore: 0, count: 0 };
      }
      examsByMaterial[e.material_id].totalScore += e.score || 0;
      examsByMaterial[e.material_id].count += 1;
    });

    return materials.map(m => {
      const cards = cardsByMaterial[m.id];
      const exam = examsByMaterial[m.id];
      
      let cardScore = -1;
      let examScore = -1;

      if (cards && cards.total > 0) {
        cardScore = (cards.mastered / cards.total) * 100;
      }
      if (exam && exam.count > 0) {
        examScore = exam.totalScore / exam.count;
      }

      let score = 0;
      let status: 'not_started' | 'started' | 'mastering' | 'mastered' = 'not_started';

      if (cardScore !== -1 && examScore !== -1) {
        score = Math.round(0.6 * cardScore + 0.4 * examScore);
        status = score >= 80 ? 'mastered' : score >= 40 ? 'mastering' : 'started';
      } else if (cardScore !== -1) {
        score = Math.round(cardScore);
        status = score >= 80 ? 'mastered' : score >= 40 ? 'mastering' : 'started';
      } else if (examScore !== -1) {
        score = Math.round(examScore);
        status = score >= 80 ? 'mastered' : score >= 40 ? 'mastering' : 'started';
      }

      return {
        id: m.id,
        title: m.title,
        subject: m.subject || 'Другое',
        score,
        status,
        cardScore: cardScore !== -1 ? Math.round(cardScore) : null,
        examScore: examScore !== -1 ? Math.round(examScore) : null,
      };
    }).sort((a, b) => b.score - a.score);
  })();

  const getProficiencyColor = (score: number, status: string) => {
    if (status === 'not_started') return 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500';
    if (score < 40) return 'bg-rose-100 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400';
    if (score < 70) return 'bg-amber-100 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400';
    if (score < 85) return 'bg-indigo-100 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-400';
    return 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400';
  };

  // Активность за 30 дней
  const activityData = (() => {
    const map: Record<string, number> = {};
    sessions.forEach((s: StudySession) => { map[s.date] = (map[s.date] ?? 0) + (s.cards_reviewed ?? 0); });
    return Array.from({ length: 30 }, (_, i) => {
      const d = subDays(new Date(), 29 - i);
      const key = format(d, 'yyyy-MM-dd');
      return { day: format(d, 'dd.MM'), value: map[key] ?? 0, full: key };
    });
  })();

  // Оценки на экзаменах
  const examScoreData = exams.slice(0, 10).reverse().map((e: ExamResult, i: number) => ({
    name: `#${i + 1}`,
    score: e.score ?? 0,
    subject: (e as any).subject ?? '',
  }));

  // Топ тем с ошибками
  const mistakeTopics = (() => {
    const map: Record<string, number> = {};
    mistakes.forEach((m: Mistake) => { if (m.topic) map[m.topic] = (map[m.topic] ?? 0) + 1; });
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 5);
  })();

  // Streak
  const streak = (() => {
    const dates = new Set(sessions.map((s: StudySession) => s.date));
    let count = 0;
    let d = new Date();
    while (dates.has(format(d, 'yyyy-MM-dd'))) { count++; d = subDays(d, 1); }
    return count;
  })();

  // Radar-данные для профиля навыков
  const totalCards = sessions.reduce((a: number, s: StudySession) => a + (s.cards_reviewed ?? 0), 0);
  const avgExamScore = exams.length > 0 ? Math.round(exams.reduce((a, e) => a + (e.score ?? 0), 0) / exams.length) : 0;
  const resolvedMistakes = mistakes.filter(m => m.is_resolved).length;
  const radarData = [
    { subject: 'Экзамены', A: Math.min(100, (exams.length / 10) * 100) },
    { subject: 'Карточки', A: Math.min(100, (totalCards / 100) * 100) },
    { subject: 'Точность', A: avgExamScore },
    { subject: 'Активность', A: Math.min(100, (streak / 7) * 100) },
    { subject: 'Ошибки→Знания', A: mistakes.length > 0 ? Math.round((resolvedMistakes / mistakes.length) * 100) : 0 },
    { subject: 'Материалы', A: Math.min(100, (materials.length / 10) * 100) },
  ];

  // Тепловая карта (последние 12 недель)
  const heatmapData = (() => {
    const map: Record<string, number> = {};
    sessions.forEach((s: StudySession) => { map[s.date] = (map[s.date] ?? 0) + (s.cards_reviewed ?? 0); });
    const weeks: { date: string; value: number }[][] = [];
    let week: { date: string; value: number }[] = [];
    for (let i = 83; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const key = format(d, 'yyyy-MM-dd');
      week.push({ date: key, value: map[key] ?? 0 });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) weeks.push(week);
    return weeks;
  })();

  const heatColor = (v: number) => {
    if (v === 0) return 'bg-slate-100 dark:bg-slate-800';
    if (v < 3) return 'bg-cyan-200 dark:bg-cyan-900';
    if (v < 7) return 'bg-cyan-400 dark:bg-cyan-700';
    if (v < 15) return 'bg-cyan-600 dark:bg-cyan-500';
    return 'bg-cyan-800 dark:bg-cyan-300';
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-6 md:py-10">
      {/* Заголовок и табы */}
      <div className="flex flex-col gap-5 border-b border-slate-200 pb-7 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sf-accent)]">Результаты</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 md:text-4xl">Прогресс</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Повторения, экзамены и активность по дням.</p>
        </div>

        <div className="flex border border-slate-200 dark:border-slate-800 p-1 rounded-lg w-full md:w-auto select-none">
          <button
            onClick={() => setActiveTab('platform')}
            className={`relative flex-1 md:px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold transition-colors duration-200 flex items-center justify-center gap-2 select-none ${
              activeTab === 'platform' 
                ? 'text-white'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {activeTab === 'platform' && (
              <motion.span
                layoutId="activeAnalyticsTab"
                className="absolute inset-0 bg-[var(--sf-accent)] rounded-md -z-10"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 shrink-0" />
              <span>Обучение</span>
            </span>
          </button>
          <button
            onClick={() => setActiveTab('gradebook')}
            className={`relative flex-1 md:px-5 py-2.5 rounded-md text-xs sm:text-sm font-semibold transition-colors duration-200 flex items-center justify-center gap-2 select-none ${
              activeTab === 'gradebook' 
                ? 'text-white'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {activeTab === 'gradebook' && (
              <motion.span
                layoutId="activeAnalyticsTab"
                className="absolute inset-0 bg-[var(--sf-accent)] rounded-md -z-10"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <GraduationCap className="w-4 h-4 shrink-0" />
              <span>Оценки</span>
            </span>
          </button>
        </div>
      </div>

      {activeTab === 'gradebook' ? (
        <Gradebook />
      ) : (
        <div className="space-y-6 md:space-y-8">
      {/* Ключевые метрики */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {[
          { icon: Flame, label: 'Стрик', value: `${streak} дн.`, colorBg: 'bg-rose-50 dark:bg-rose-950/40', colorIcon: 'text-rose-600 dark:text-rose-400', sub: 'дней подряд' },
          { icon: Trophy, label: 'Экзаменов', value: exams.length, colorBg: 'bg-amber-50 dark:bg-amber-950/40', colorIcon: 'text-amber-600 dark:text-amber-400', sub: 'сдано' },
          { icon: Brain, label: 'Карточек', value: totalCards, colorBg: 'bg-emerald-50 dark:bg-emerald-950/40', colorIcon: 'text-emerald-600 dark:text-emerald-400', sub: 'повторено' },
          { icon: Target, label: 'Средний балл', value: `${avgExamScore}%`, colorBg: 'bg-cyan-50 dark:bg-cyan-950/40', colorIcon: 'text-cyan-700 dark:text-cyan-300', sub: 'на экзаменах' },
        ].map(({ icon: Icon, label, value, colorBg, colorIcon, sub }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-y border-slate-200 p-3 dark:border-slate-800 md:p-4"
          >
            <div className={`w-9 h-9 ${colorBg} rounded-lg flex items-center justify-center mb-3`}>
              <Icon className={`w-5 h-5 ${colorIcon}`} />
            </div>
            <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Два столбца: график активности + radar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* График активности */}
        <div className="border-y border-slate-200 p-4 dark:border-slate-800 md:p-5 overflow-x-auto custom-scrollbar">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
            Активность за 30 дней
          </h3>
          <div style={{ height: 180, minWidth: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} stroke={isDark ? '#334155' : '#e2e8f0'} interval={4} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} stroke={isDark ? '#334155' : '#e2e8f0'} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: isDark ? '1px solid #334155' : '1px solid #e2e8f0', fontSize: 12, backgroundColor: isDark ? '#1e293b' : '#ffffff', color: isDark ? '#f1f5f9' : '#0f172a' }}
                  formatter={(v: number) => [v, 'Карточек']}
                />
                <Area type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2} fill="url(#actGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Профиль навыков */}
        <div className="border-y border-slate-200 p-4 dark:border-slate-800 md:p-5">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            Профиль навыков
          </h3>
          <div style={{ height: 180, minWidth: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke={isDark ? '#334155' : '#e2e8f0'} />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} />
                <Radar name="Навыки" dataKey="A" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.16} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Оценки на экзаменах */}
      <div className="border-y border-slate-200 p-4 dark:border-slate-800 md:p-5 overflow-x-auto custom-scrollbar">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Award className="w-4 h-4 text-rose-500" />
          Динамика оценок на устном экзамене
        </h3>
        {examScoreData.length < 3 ? (
          <div className="h-[160px] flex flex-col items-center justify-center text-center">
            <Award className="w-10 h-10 text-slate-200 dark:text-slate-700 mb-2" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Недостаточно данных</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">Сдайте еще {3 - examScoreData.length} экзамен(а), чтобы увидеть график</p>
          </div>
        ) : (
          <div style={{ height: 160, minWidth: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={examScoreData}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }} stroke={isDark ? '#334155' : '#e2e8f0'} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }} stroke={isDark ? '#334155' : '#e2e8f0'} />
                <Tooltip
                  cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
                  contentStyle={{ borderRadius: 8, border: isDark ? '1px solid #334155' : '1px solid #e2e8f0', fontSize: 12, backgroundColor: isDark ? '#1e293b' : '#ffffff', color: isDark ? '#f1f5f9' : '#0f172a' }}
                  formatter={(v: number, _: unknown, props: unknown) => [
                    `${v}% — ${(props as any).payload.subject || 'Без предмета'}`, 'Балл'
                  ]}
                />
                <Bar
                  dataKey="score"
                  radius={[4, 4, 0, 0]}
                  fill="#22d3ee"
                  label={{ position: 'top', fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b', formatter: (v: number) => `${v}%` }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Тепловая карта */}
      <div className="border-y border-slate-200 p-4 dark:border-slate-800 md:p-5">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-500" />
          Карта активности (12 недель)
        </h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Интенсивность повторения карточек по дням</p>
        <div className="flex gap-1 overflow-x-auto pb-2">
          {heatmapData.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${day.value} карточек`}
                  className={`w-3 h-3 rounded-sm ${heatColor(day.value)} transition-all hover:scale-125`}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-slate-400 dark:text-slate-500">Меньше</span>
          {[
            'bg-slate-100 dark:bg-slate-800',
            'bg-cyan-200 dark:bg-cyan-900',
            'bg-cyan-400 dark:bg-cyan-700',
            'bg-cyan-600 dark:bg-cyan-500',
            'bg-cyan-800 dark:bg-cyan-300'
          ].map(c => (
            <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span className="text-xs text-slate-400 dark:text-slate-500">Больше</span>
        </div>
      </div>

      {/* Тепловая карта владения знаниями */}
      <div className="border-y border-slate-200 p-4 dark:border-slate-800 md:p-5">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
          <Brain className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
          Карта владения знаниями по темам
        </h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
          Уровень освоения материала на основе устных экзаменов (40%) и повторения карточек (60%)
        </p>

        {knowledgeHeatmap.length === 0 ? (
          <p className="text-center text-slate-400 text-xs py-8">Темы не найдены. Загрузите материалы в библиотеку.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {knowledgeHeatmap.map(item => (
              <div
                key={item.id}
                onClick={() => navigate(`/library/${item.id}`)}
                className={`p-3 rounded-xl border cursor-pointer hover:shadow-md transition-all flex flex-col justify-between ${getProficiencyColor(item.score, item.status)}`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-75 truncate max-w-[120px]">
                      {item.subject}
                    </span>
                    <span className="text-xs font-black shrink-0">
                      {item.status === 'not_started' ? '0%' : `${item.score}%`}
                    </span>
                  </div>
                  <h4 className="font-bold text-xs line-clamp-2 leading-snug">
                    {item.title}
                  </h4>
                </div>

                <div className="mt-3 flex items-center justify-between text-[10px] opacity-80 pt-1.5 border-t border-black/5">
                  <span>
                    {item.status === 'not_started' ? 'Не изучалось' : item.score >= 85 ? 'Освоено' : 'В процессе'}
                  </span>
                  <div className="flex gap-2 font-semibold">
                    {item.cardScore !== null && <span className="flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-amber-500" /> {item.cardScore}%</span>}
                    {item.examScore !== null && <span className="flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5 text-indigo-500" /> {item.examScore}%</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Слабые темы */}
      {mistakeTopics.length > 0 && (
        <div className="card p-4 md:p-5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-amber-500" />
            Топ тем с ошибками
          </h3>
          <div className="space-y-3">
            {mistakeTopics.map(([topic, count], i) => (
              <div key={topic} className="flex items-center gap-3">
                <span className="text-xs font-black text-slate-400 dark:text-slate-500 w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{topic}</span>
                    <span className="text-xs font-bold text-rose-500 ml-2">{count} ошибок</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-400 rounded-full"
                      style={{ width: `${Math.min(100, (count / (mistakeTopics[0][1])) * 100)}%` }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => navigate('/mistakes')}
                  className="text-slate-300 dark:text-slate-600 hover:text-indigo-500 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

        </div>
      )}
    </main>
  );
}
