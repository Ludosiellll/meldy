import { Material, StudySession, Flashcard } from '../types';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Brain, GraduationCap, Flame, ChevronRight, FileText, Zap, Calendar, Award, Gamepad2, Heart, Trophy, Sparkles, BarChart2, Clock, Bot, Layers, Users, MessageSquare, CheckCircle2, Backpack } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';
import { getDueCards } from '../api/flashcards';
import { getQuestsWithProgress, getUserXP, calcLevel } from '../api/quests';
import { getProfile } from '../api/social';
import { useTheme } from '../contexts/ThemeProvider';

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  const bgMap: Record<string, string> = { 
    indigo: 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/50', 
    emerald: 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/50', 
    amber: 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/50', 
    rose: 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/50' 
  };
  const textMap: Record<string, string> = { 
    indigo: 'text-indigo-600 dark:text-indigo-400', 
    emerald: 'text-emerald-600 dark:text-emerald-400', 
    amber: 'text-amber-600 dark:text-amber-400', 
    rose: 'text-rose-600 dark:text-rose-400' 
  };
  return (
    <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div className={`w-10 h-10 ${bgMap[color]} border rounded-xl flex items-center justify-center shrink-0`}>
        <Icon className={`w-5 h-5 ${textMap[color]}`} />
      </div>
      <div>
        <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{value}</p>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
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
  const [profile, setProfile] = useState<any>(null);

  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const handleToggleRole = async () => {
    if (!user || !profile) return;
    const newRole = profile.role === 'teacher' ? 'student' : 'teacher';
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', user.id);
    if (!error) {
      setProfile({ ...profile, role: newRole });
      window.dispatchEvent(new Event('profile_updated'));
      // Если переключаемся на преподавателя, перенаправляем на /teacher
      if (newRole === 'teacher') {
        navigate('/teacher');
      }
    }
  };

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
      getProfile(user.id),
    ]).then(([mats, cards, subRes, sessRes, moodRes, questsData, xpVal, prof]) => {
      setMaterials(mats);
      setDueCards(cards);
      const fetchedSubjects = subRes.data || [];
      setSubjects(fetchedSubjects);
      setSessions(sessRes.data || []);
      setMood(moodRes.data);
      setQuests(questsData);
      const lvl = calcLevel(xpVal);
      setXp(xpVal);
      setLevelInfo(lvl);
      setProfile(prof);
      // Ближайший экзамен
      if (fetchedSubjects.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const upcoming = fetchedSubjects
          .filter(s => s.exam_date && s.exam_date >= today)
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
    if (mode.includes('анти-стресс')) return 'courses';
    return null;
  };

  const recTool = getRecommendedTool();

  return (
    <div className="p-3 md:p-6 max-w-5xl mx-auto">
      {/* Role switching banner */}
      {profile && profile.role !== 'teacher' ? (
        <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-indigo-100/50 dark:from-slate-900 dark:to-indigo-950/20 border border-indigo-100 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm tour-step-role-toggle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm">Вы вошли как Студент 🎒</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mt-0.5 leading-relaxed">
                Хотите создавать свои классы, приглашать студентов по коду приглашения и ставить им дедлайны? Переключитесь в режим преподавателя!
              </p>
            </div>
          </div>
          <button 
            onClick={handleToggleRole}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 dark:shadow-none transition shrink-0"
          >
            Стать Преподавателем <GraduationCap className="w-4 h-4 ml-1 inline text-indigo-500" />
          </button>
        </div>
      ) : profile && (
        <div className="mb-6 p-4 bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-slate-900 dark:to-emerald-950/20 border border-emerald-100 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm tour-step-role-toggle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-1.5">Вы вошли как Преподаватель <GraduationCap className="w-4 h-4 text-indigo-500" /></h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mt-0.5 leading-relaxed">
                Вам доступно управление группами и назначение заданий. Чтобы проходить курсы, играть в миссии и сдавать экзамены, переключитесь обратно в режим студента.
              </p>
            </div>
          </div>
          <button 
            onClick={handleToggleRole}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-200 dark:shadow-none transition shrink-0"
          >
            Режим Студента 🎒
          </button>
        </div>
      )}

      {/* Greeting + XP */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-0.5">Привет, {name}! 👋</h1>
          <p className="text-slate-500 dark:text-slate-400 capitalize">{format(new Date(), 'EEEE, d MMMM', { locale: ru })}</p>
        </div>
        {/* XP / Level mini-badge */}
        <motion.button
          onClick={() => navigate('/analytics')}
          whileHover={{ scale: 1.02 }}
          className="flex w-full md:w-auto items-center gap-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-3 rounded-2xl shadow-xl shadow-indigo-200 dark:shadow-none hover:shadow-indigo-300 transition-shadow tour-step-desktop-xp tour-step-mobile-xp"
        >
          <div className="flex-1 text-left md:text-right">
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-1.5">Уровень {levelInfo.level} · {levelInfo.name}</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 md:w-32 h-2 bg-black/20 rounded-full overflow-hidden backdrop-blur-sm shadow-inner">
                <motion.div
                  className="h-full bg-gradient-to-r from-white/80 to-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${levelInfo.progress}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>
              <span className="text-sm font-black whitespace-nowrap">{xp} XP</span>
            </div>
          </div>
          <BarChart2 className="w-6 h-6 text-indigo-100 shrink-0 hidden sm:block" />
        </motion.button>
      </div>

      {/* Виджет ближайшего экзамена */}
      {nextExam && (() => {
        const daysLeft = Math.ceil((new Date(nextExam.exam_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        const urgency = daysLeft <= 3 ? 'rose' : daysLeft <= 7 ? 'amber' : 'indigo';
        const urgencyBg = urgency === 'rose' 
          ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40' 
          : urgency === 'amber' 
            ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40' 
            : 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/40';
        const urgencyText = urgency === 'rose' 
          ? 'text-rose-700 dark:text-rose-400' 
          : urgency === 'amber' 
            ? 'text-amber-700 dark:text-amber-400' 
            : 'text-indigo-700 dark:text-indigo-400';
        return (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => navigate('/courses')}
            className={`mb-6 p-4 border rounded-2xl cursor-pointer flex items-center gap-4 ${urgencyBg} hover:shadow-md transition`}
          >
            <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center font-black ${urgency === 'rose' ? 'bg-rose-500' : urgency === 'amber' ? 'bg-amber-500' : 'bg-indigo-500'} text-white shrink-0`}>
              <span className="text-lg leading-none">{daysLeft}</span>
              <span className="text-[8px] font-bold uppercase">дн.</span>
            </div>
            <div className="flex-1">
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${urgencyText}`}>
                {daysLeft <= 3 ? <span className="flex items-center gap-1"><Flame className="w-3.5 h-3.5" /> Срочно!</span> : daysLeft <= 7 ? <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> Скоро экзамен</span> : <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Ближайший экзамен</span>}
              </p>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{nextExam.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(nextExam.exam_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600" />
          </motion.div>
        );
      })()}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard icon={BookOpen} label="Материалов" value={materials.length} color="indigo" />
        <StatCard icon={Brain} label="Карточек сегодня" value={dueCards.length} color="emerald" />
        <StatCard icon={GraduationCap} label="Предметов" value={subjects.length} color="amber" />
        {/* Стрик с анимацией огня */}
        <motion.div
          className="card p-4 flex items-center gap-3 cursor-default"
          whileHover={{ scale: 1.02 }}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${streak >= 3 ? 'bg-rose-500' : 'bg-rose-50 dark:bg-rose-950/30'}`}>
            <Flame className={`w-5 h-5 ${streak >= 3 ? 'text-white' : 'text-rose-400 dark:text-rose-500'} ${streak >= 3 ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{streak}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">{streak >= 3 ? <><Flame className="w-3 h-3 text-orange-500" /> Дней подряд!</> : 'Дней подряд'}</p>
          </div>
        </motion.div>
      </div>

      {/* Mood Recommendation */}
      {mood && (
        <div
          onClick={() => navigate('/mood')}
          className="mt-6 p-4 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition flex items-center gap-4"
        >
          <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl flex items-center justify-center shrink-0">
            <Heart className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest mb-0.5">Твое состояние & Режим дня</p>
            <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">{mood.recommended_mode}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-650" />
        </div>
      )}

      {/* Быстрый повтор за 5 минут */}
      {materials.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => navigate('/quick-prep')}
          className="mt-3 p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-slate-900 dark:to-orange-950/20 border border-amber-200 dark:border-slate-800 rounded-2xl cursor-pointer hover:shadow-md transition flex items-center gap-4"
        >
          <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-0.5">⚡ Экспресс-режим</p>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Повторить материал за 5 минут</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Шпаргалка + 2 разогревочных вопроса</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-650" />
        </motion.div>
      )}

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mt-4 md:mt-6">
        {/* Left Col: Quests */}
        <div className="lg:col-span-1 space-y-6">
          {materials.length === 0 && (
            <div className="card p-5 border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Bot className="w-5 h-5 text-emerald-500" />
                  Первые шаги
                </h2>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center shrink-0">
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">1</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Загрузи первый материал</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">+50 XP</p>
                  </div>
                  <button onClick={() => navigate('/analyze')} className="px-3 py-1 bg-emerald-500 text-white rounded-lg text-xs font-bold hover:bg-emerald-600 transition">Вперед!</button>
                </div>
              </div>
            </div>
          )}

          <div className="card p-5 border-l-4 border-l-indigo-500">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Квесты дня
              </h2>
            </div>
            <div className="space-y-4">
              {quests.filter(q => q.type === 'daily').map(q => (
                <div key={q.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${q.is_completed ? 'text-emerald-600 line-through dark:text-emerald-400/80' : 'text-slate-700 dark:text-slate-200'}`}>
                        {q.title}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5 leading-snug">
                        {q.description}
                      </p>
                    </div>
                    <span className="text-[10px] font-black text-indigo-500 shrink-0">+{q.xp_reward} XP</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${q.is_completed ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                        style={{ width: `${Math.min(100, (q.current_count / q.target_count) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">{q.current_count}/{q.target_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 border-l-4 border-l-purple-500">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                Еженедельные
              </h2>
            </div>
            <div className="space-y-4">
              {quests.filter(q => q.type === 'weekly').map(q => (
                <div key={q.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${q.is_completed ? 'text-emerald-600 line-through dark:text-emerald-400/80' : 'text-slate-700 dark:text-slate-200'}`}>
                        {q.title}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5 leading-snug">
                        {q.description}
                      </p>
                    </div>
                    <span className="text-[10px] font-black text-purple-500 shrink-0">+{q.xp_reward} XP</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${q.is_completed ? 'bg-emerald-500' : 'bg-purple-500'}`}
                        style={{ width: `${Math.min(100, (q.current_count / q.target_count) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">{q.current_count}/{q.target_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Due and Recent */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
            {/* Due cards */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">На повторение сегодня</h2>
                <button onClick={() => navigate('/review')} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">Начать →</button>
              </div>
              {dueCards.length === 0 ? (
                <p className="text-emerald-600 text-sm flex items-center gap-1.5 justify-center">Все карточки повторены! <CheckCircle2 className="w-4 h-4" /></p>
              ) : (
                <div className="space-y-2">
                  {dueCards.slice(0, 3).map((c: any) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate">{c.question}</span>
                    </div>
                  ))}
                  {dueCards.length > 3 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">+ ещё {dueCards.length - 3}</p>
                  )}
                </div>
              )}
            </div>

            {/* Recent materials */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">Последние материалы</h2>
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
                      className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200 transition"
                    >
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate flex-1">{m.title}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{format(new Date(m.created_at), 'dd.MM.yy')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Activity chart */}
          <div className="card p-4 md:p-5 overflow-x-auto custom-scrollbar">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">Активность за 2 недели</h2>
            <div style={{ height: 200, minWidth: 500 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke={isDark ? '#475569' : '#94a3b8'} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={isDark ? '#475569' : '#94a3b8'} />
                  <Tooltip
                    contentStyle={{ 
                      borderRadius: 8, 
                      border: isDark ? '1px solid #334155' : '1px solid #e2e8f0', 
                      backgroundColor: isDark ? '#1e293b' : '#ffffff',
                      color: isDark ? '#f1f5f9' : '#0f172a',
                      fontSize: 13 
                    }}
                    itemStyle={{ color: isDark ? '#f1f5f9' : '#0f172a' }}
                    labelStyle={{ color: isDark ? '#94a3b8' : '#64748b' }}
                    labelFormatter={(l: string) => l}
                    formatter={(v: number) => [v, 'Карточек']}
                  />
                  <Bar dataKey="cards_reviewed" fill={isDark ? '#6366f1' : '#4F46E5'} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mt-4 md:mt-6">
        <button
          onClick={() => navigate('/analyze')}
          className="card p-5 text-center hover:shadow-md transition group tour-step-mobile-upload"
        >
          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition">
            <Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Загрузить лекцию</p>
        </button>
        
        <button
          onClick={() => navigate('/review')}
          className={`card p-5 text-center transition group relative overflow-hidden ${
            recTool === 'review' ? 'ring-2 ring-emerald-500 dark:ring-emerald-600 shadow-lg shadow-emerald-100 dark:shadow-emerald-950/30' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'review' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'review' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50'
          }`}>
            <Brain className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'review' ? 'text-emerald-900 dark:text-emerald-100 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
            Повторить карточки
          </p>
        </button>

        <button
          onClick={() => navigate('/play')}
          className={`card p-5 text-center transition group relative overflow-hidden ${
            recTool === 'play' ? 'ring-2 ring-emerald-500 dark:ring-emerald-600 shadow-lg shadow-emerald-100 dark:shadow-emerald-950/30' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'play' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'play' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50'
          }`}>
            <Gamepad2 className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'play' ? 'text-emerald-900 dark:text-emerald-100 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
            Микро-миссии
          </p>
        </button>

        <button
          onClick={() => navigate('/chat')}
          className={`card p-5 text-center transition group relative overflow-hidden tour-step-mobile-chat ${
            recTool === 'chat' ? 'ring-2 ring-indigo-500 dark:ring-indigo-600 shadow-lg shadow-indigo-100 dark:shadow-indigo-950/30' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'chat' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'chat' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50'
          }`}>
            <MessageSquare className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'chat' ? 'text-indigo-900 dark:text-indigo-100 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
            Чат-помощник
          </p>
        </button>

        <button
          onClick={() => navigate('/exam')}
          className={`card p-5 text-center transition group relative overflow-hidden tour-step-mobile-exam ${
            recTool === 'exam' ? 'ring-2 ring-rose-500 dark:ring-rose-600 shadow-lg shadow-rose-100 dark:shadow-rose-950/30' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'exam' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'exam' ? 'bg-rose-600 text-white' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 group-hover:bg-rose-100 dark:group-hover:bg-rose-900/50'
          }`}>
            <Award className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'exam' ? 'text-rose-900 dark:text-rose-100 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
            Устный экзамен
          </p>
        </button>

        <button
          onClick={() => navigate('/courses')}
          className={`card p-5 text-center transition group relative overflow-hidden ${
            recTool === 'courses' ? 'ring-2 ring-amber-500 dark:ring-amber-600 shadow-lg shadow-amber-100 dark:shadow-amber-950/30' : 'hover:shadow-md'
          }`}
        >
          {recTool === 'courses' && (
            <div className="absolute top-0 right-0 p-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition ${
            recTool === 'courses' ? 'bg-amber-600 text-white' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 group-hover:bg-amber-100 dark:group-hover:bg-indigo-900/50'
          }`}>
            <Layers className="w-5 h-5" />
          </div>
          <p className={`text-sm font-medium ${recTool === 'courses' ? 'text-amber-900 dark:text-amber-100 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
            Мои курсы
          </p>
        </button>
      </div>
    </div>
  );
}