import { Material, StudySession, Flashcard } from '../types';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Brain, GraduationCap, Flame, ChevronRight, FileText, Zap, Calendar, Award, Gamepad2, Heart, Trophy, Sparkles, BarChart2, Clock } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';
import { getDueCards } from '../api/flashcards';
import { getQuestsWithProgress, getUserXP, calcLevel } from '../api/quests';

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  const bgMap: Record<string, string> = { indigo: 'bg-indigo-50', emerald: 'bg-emerald-50', amber: 'bg-amber-50', rose: 'bg-rose-50' };
  const textMap: Record<string, string> = { indigo: 'text-indigo-600', emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-600' };
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 ${bgMap[color]} rounded-xl flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${textMap[color]}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<any[]>([]);
  const [dueCards, setDueCards] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [mood, setMood] = useState<any>(null);
  const [quests, setQuests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [xp, setXp] = useState(0);
  const [levelInfo, setLevelInfo] = useState(calcLevel(0));
  const [nextExam, setNextExam] = useState<any>(null);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      getMaterials(user.id),
      getDueCards(user.id),
      supabase.from('subjects').select('*').eq('user_id', user.id),
      supabase.from('study_sessions').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(30),
      supabase.from('mood_log').select('*').eq('user_id', user.id).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
      getQuestsWithProgress(user.id),
      getUserXP(user.id),
      supabase.from('study_plans').select('subjects').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([mats, cards, subRes, sessRes, moodRes, questsData, xpVal, planRes]) => {
      setMaterials(mats);
      setDueCards(cards);
      setSubjects(subRes.data || []);
      setSessions(sessRes.data || []);
      setMood(moodRes.data);
      setQuests(questsData);
      const lvl = calcLevel(xpVal);
      setXp(xpVal);
      setLevelInfo(lvl);
      // Ближайший экзамен из плана
      if (planRes.data?.subjects) {
        const today = new Date().toISOString().split('T')[0];
        const upcoming = (planRes.data.subjects as any[])
          .filter(s => s.exam_date >= today)
          .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
        if (upcoming.length > 0) setNextExam(upcoming[0]);
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [user?.id]);

  const streak = (() => {
    const dates = new Set(sessions.map((s: StudySession) => s.date));
    let count = 0;
    let d = new Date();
    while (dates.has(format(d, 'yyyy-MM-dd'))) {
      count++;
      d = subDays(d, 1);
    }
    return count;
  })();

  const chartData = (() => {
    const map: Record<string, number> = {};
    sessions.forEach((s: StudySession) => { map[s.date] = s.cards_reviewed || 0; });
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const key = format(d, 'yyyy-MM-dd');
      days.push({ day: format(d, 'dd.MM'), cards_reviewed: map[key] || 0 });
    }
    return days;
  })();

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const name = user?.user_metadata?.full_name || 'Студент';

  const getRecommendedTool = () => {
    if (!mood) return null;
    const mode = mood.recommended_mode.toLowerCase();
    if (mode.includes('глубокое погружение')) return 'exam';
    if (mode.includes('активное обучение')) return 'play';
    if (mode.includes('повторение')) return 'review';
    if (mode.includes('лёгкий просмотр')) return 'chat';
    if (mode.includes('анти-стресс')) return 'planner';
    return null;
  };

  const recTool = getRecommendedTool();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Greeting + XP */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-0.5">Привет, {name}! 👋</h1>
          <p className="text-slate-500 capitalize">{format(new Date(), 'EEEE, d MMMM', { locale: ru })}</p>
        </div>
        {/* XP / Level mini-badge */}
        <motion.button
          onClick={() => navigate('/analytics')}
          whileHover={{ scale: 1.02 }}
          className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-shadow"
        >
          <div className="text-right">
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest">Уровень {levelInfo.level} · {levelInfo.name}</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-white rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${levelInfo.progress}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>
              <span className="text-xs font-black">{xp} XP</span>
            </div>
          </div>
          <BarChart2 className="w-5 h-5 text-indigo-200" />
        </motion.button>
      </div>

      {/* Виджет ближайшего экзамена */}
      {nextExam && (() => {
        const daysLeft = Math.ceil((new Date(nextExam.exam_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        const urgency = daysLeft <= 3 ? 'rose' : daysLeft <= 7 ? 'amber' : 'indigo';
        const urgencyBg = urgency === 'rose' ? 'bg-rose-50 border-rose-200' : urgency === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-indigo-50 border-indigo-200';
        const urgencyText = urgency === 'rose' ? 'text-rose-700' : urgency === 'amber' ? 'text-amber-700' : 'text-indigo-700';
        return (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => navigate('/planner')}
            className={`mb-6 p-4 border rounded-2xl cursor-pointer flex items-center gap-4 ${urgencyBg} hover:shadow-md transition`}
          >
            <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center font-black ${urgency === 'rose' ? 'bg-rose-500' : urgency === 'amber' ? 'bg-amber-500' : 'bg-indigo-500'} text-white shrink-0`}>
              <span className="text-lg leading-none">{daysLeft}</span>
              <span className="text-[8px] font-bold uppercase">дн.</span>
            </div>
            <div className="flex-1">
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${urgencyText}`}>
                {daysLeft <= 3 ? '🔥 Срочно!' : daysLeft <= 7 ? '⚡ Скоро экзамен' : '📅 Ближайший экзамен'}
              </p>
              <p className="text-sm font-bold text-slate-800">{nextExam.name}</p>
              <p className="text-xs text-slate-500">{new Date(nextExam.exam_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-300" />
          </motion.div>
        );
      })()}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Материалов" value={materials.length} color="indigo" />
        <StatCard icon={Brain} label="Карточек сегодня" value={dueCards.length} color="emerald" />
        <StatCard icon={GraduationCap} label="Предметов" value={subjects.length} color="amber" />
        {/* Стрик с анимацией огня */}
        <motion.div
          className="card p-4 flex items-center gap-3 cursor-default"
          whileHover={{ scale: 1.02 }}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${streak >= 3 ? 'bg-rose-500' : 'bg-rose-50'}`}>
            <Flame className={`w-5 h-5 ${streak >= 3 ? 'text-white' : 'text-rose-400'} ${streak >= 3 ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{streak}</p>
            <p className="text-xs text-slate-500">{streak >= 3 ? '🔥 Дней подряд!' : 'Дней подряд'}</p>
          </div>
        </motion.div>
      </div>

      {/* Mood Recommendation */}
      {mood && (
        <div
          onClick={() => navigate('/mood')}
          className="mt-6 p-4 bg-white border border-indigo-100 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition flex items-center gap-4"
        >
          <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <Heart className="w-6 h-6 text-indigo-600" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-0.5">Твое состояние & Режим дня</p>
            <p className="text-sm text-slate-700 font-medium leading-relaxed">{mood.recommended_mode}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300" />
        </div>
      )}

      {/* Быстрый повтор за 5 минут */}
      {materials.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => navigate('/quick-prep')}
          className="mt-3 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl cursor-pointer hover:shadow-md transition flex items-center gap-4"
        >
          <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-0.5">⚡ Экспресс-режим</p>
            <p className="text-sm font-bold text-slate-800">Повторить материал за 5 минут</p>
            <p className="text-xs text-slate-500">Шпаргалка + 2 разогревочных вопроса</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300" />
        </motion.div>
      )}

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Left Col: Quests */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-5 border-l-4 border-l-indigo-500">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Квесты дня
              </h2>
            </div>
            <div className="space-y-4">
              {quests.filter(q => q.type === 'daily').map(q => (
                <div key={q.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${q.is_completed ? 'text-emerald-600 line-through' : 'text-slate-700'}`}>
                        {q.title}
                      </p>
                      <p className="text-[10px] text-slate-400 font-normal mt-0.5 leading-snug">
                        {q.description}
                      </p>
                    </div>
                    <span className="text-[10px] font-black text-indigo-500 shrink-0">+{q.xp_reward} XP</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${q.is_completed ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                        style={{ width: `${Math.min(100, (q.current_count / q.target_count) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 shrink-0">{q.current_count}/{q.target_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 border-l-4 border-l-purple-500">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                Еженедельные
              </h2>
            </div>
            <div className="space-y-4">
              {quests.filter(q => q.type === 'weekly').map(q => (
                <div key={q.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${q.is_completed ? 'text-emerald-600 line-through' : 'text-slate-700'}`}>
                        {q.title}
                      </p>
                      <p className="text-[10px] text-slate-400 font-normal mt-0.5 leading-snug">
                        {q.description}
                      </p>
                    </div>
                    <span className="text-[10px] font-black text-purple-500 shrink-0">+{q.xp_reward} XP</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${q.is_completed ? 'bg-emerald-500' : 'bg-purple-500'}`}
                        style={{ width: `${Math.min(100, (q.current_count / q.target_count) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 shrink-0">{q.current_count}/{q.target_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Due and Recent */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Due cards */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900">На повторение сегодня</h2>
                <button onClick={() => navigate('/review')} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">Начать →</button>
              </div>
              {dueCards.length === 0 ? (
                <p className="text-emerald-600 text-sm">Все карточки повторены! ✅</p>
              ) : (
                <div className="space-y-2">
                  {dueCards.slice(0, 3).map((c: any) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm text-slate-600">
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate">{c.question}</span>
                    </div>
                  ))}
                  {dueCards.length > 3 && (
                    <p className="text-xs text-slate-400">+ ещё {dueCards.length - 3}</p>
                  )}
                </div>
              )}
            </div>

            {/* Recent materials */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900">Последние материалы</h2>
                <button onClick={() => navigate('/library')} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">Все →</button>
              </div>
              {materials.length === 0 ? (
                <button onClick={() => navigate('/analyze')} className="text-sm text-indigo-600 hover:text-indigo-700">Загрузи первую лекцию →</button>
              ) : (
                <div className="space-y-2">
                  {materials.slice(0, 3).map((m: Material) => (
                    <div
                      key={m.id}
                      onClick={() => navigate('/library/' + m.id)}
                      className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer hover:text-slate-900 transition"
                    >
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate flex-1">{m.title}</span>
                      <span className="text-xs text-slate-400 shrink-0">{format(new Date(m.created_at), 'dd.MM.yy')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Activity chart */}
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-4">Активность за 2 недели</h2>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
                    labelFormatter={(l: string) => l}
                    formatter={(v: number) => [v, 'Карточек']}
                  />
                  <Bar dataKey="cards_reviewed" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-6">
        <button
          onClick={() => navigate('/analyze')}
          className="card p-5 text-center hover:shadow-md transition group"
        >
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:bg-indigo-100 transition">
            <Zap className="w-5 h-5 text-indigo-600" />
          </div>
          <p className="text-sm font-medium text-slate-700">Загрузить лекцию</p>
        </button>
        
        <button
          onClick={() => navigate('/review')}
          className={`card p-5 text-center transition group relative overflow-hidden ${
            recTool === 'review' ? 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-100' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'review' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'review' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100'
          }`}>
            <Brain className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'review' ? 'text-emerald-900 font-bold' : 'text-slate-700'}`}>
            Повторить карточки
          </p>
        </button>

        <button
          onClick={() => navigate('/play')}
          className={`card p-5 text-center transition group relative overflow-hidden ${
            recTool === 'play' ? 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-100' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'play' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'play' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100'
          }`}>
            <Gamepad2 className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'play' ? 'text-emerald-900 font-bold' : 'text-slate-700'}`}>
            Микро-миссии
          </p>
        </button>

        <button
          onClick={() => navigate('/exam')}
          className={`card p-5 text-center transition group relative overflow-hidden ${
            recTool === 'exam' ? 'ring-2 ring-rose-500 shadow-lg shadow-rose-100' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'exam' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'exam' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-600 group-hover:bg-rose-100'
          }`}>
            <Award className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'exam' ? 'text-rose-900 font-bold' : 'text-slate-700'}`}>
            Устный экзамен
          </p>
        </button>

        <button
          onClick={() => navigate('/planner')}
          className={`card p-5 text-center transition group relative overflow-hidden ${
            recTool === 'planner' ? 'ring-2 ring-amber-500 shadow-lg shadow-amber-100' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'planner' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'planner' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-600 group-hover:bg-amber-100'
          }`}>
            <Calendar className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'planner' ? 'text-amber-900 font-bold' : 'text-slate-700'}`}>
            Планировщик
          </p>
        </button>
      </div>
    </div>
  );
}