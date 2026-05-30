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
    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
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
    <div className="p-3 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Role switching banner */}
      {profile && profile.role !== 'teacher' ? (
        <div className="p-4 bg-gradient-to-r from-indigo-50 to-indigo-100/50 dark:from-slate-900 dark:to-indigo-950/20 border border-indigo-100 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm tour-step-role-toggle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm">Вы вошли как Студент 🎒</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mt-0.5 leading-relaxed">
                Хотите создавать свои классы и ставить дедлайны? Переключитесь в режим преподавателя!
              </p>
            </div>
          </div>
          <button onClick={handleToggleRole} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition shrink-0">
            Стать Преподавателем
          </button>
        </div>
      ) : profile && (
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-slate-900 dark:to-emerald-950/20 border border-emerald-100 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm tour-step-role-toggle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm">Вы вошли как Преподаватель 👨‍🏫</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mt-0.5">
                Чтобы учиться и сдавать экзамены — переключитесь обратно в студента.
              </p>
            </div>
          </div>
          <button onClick={handleToggleRole} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition shrink-0">
            Режим Студента 🎒
          </button>
        </div>
      )}

      {/* ── ШАПКА: приветствие ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight">Привет, {name}! 👋</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold mt-1 capitalize">
            {format(new Date(), 'EEEE, d MMMM', { locale: ru })}
          </p>
        </div>
      </div>

      {/* ── НОВЫЙ СУПЕР-КРАСИВЫЙ БЛОК УРОВНЯ И ПРОГРЕССА (Full Width / Premium Card) ── */}
      <motion.div
        onClick={() => navigate('/analytics')}
        whileHover={{ y: -2 }}
        className="w-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white rounded-3xl p-5 md:p-6 shadow-xl shadow-indigo-100 dark:shadow-none hover:shadow-indigo-200 transition-all duration-300 cursor-pointer relative overflow-hidden group tour-step-desktop-xp tour-step-mobile-xp"
      >
        <div className="absolute right-0 top-0 w-80 h-80 bg-white/5 rounded-full -translate-y-1/3 translate-x-1/4 pointer-events-none group-hover:scale-105 transition-transform duration-500" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl md:text-3xl shadow-inner border border-white/20 shrink-0">
              🏆
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] md:text-xs font-extrabold uppercase tracking-wider text-indigo-200">Текущий ранг</span>
                {profile?.role === 'student' && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-400 text-amber-950 uppercase tracking-widest animate-pulse">PRO</span>
                )}
              </div>
              <h2 className="text-lg md:text-xl font-black text-white tracking-tight mt-0.5">Уровень {levelInfo.level} · {levelInfo.name}</h2>
            </div>
          </div>

          <div className="flex-1 md:max-w-md w-full">
            <div className="flex justify-between items-end text-xs font-bold text-indigo-100 mb-1.5">
              <span>До следующего уровня</span>
              <span className="text-white font-black text-sm">{levelInfo.currentXP} <span className="text-xs font-bold text-indigo-200">/ {levelInfo.nextXP} XP</span></span>
            </div>
            
            <div className="h-3 bg-black/20 rounded-full overflow-hidden border border-white/10 relative">
              <motion.div
                className="h-full bg-gradient-to-r from-amber-300 to-amber-500 rounded-full shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                initial={{ width: 0 }}
                animate={{ width: `${levelInfo.progress}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </div>
            
            <p className="text-[11px] text-indigo-100 mt-2 font-medium">
              Осталось набрать <span className="text-white font-black">{levelInfo.nextXP - levelInfo.currentXP} XP</span> для перехода на новый уровень. Давай поднажмем! 🚀
            </p>
          </div>
        </div>
      </motion.div>

      {/* ── РЕЖИМ СЕССИИ: Умный наставник ── */}
      {(() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const completedToday = sessions.some(s => s.date === todayStr && s.cards_reviewed > 0);
        
        if (materials.length === 0) {
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-400 shrink-0 border border-slate-200/40 dark:border-slate-700/40 text-xl">
                  🔒
                </div>
                <div>
                  <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
                    Сессия обучения заблокирована
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mt-0.5 leading-relaxed">
                    Загрузи свой первый конспект или лекцию в библиотеку, и ИИ-наставник Forgey автоматически составит твой первый интерактивный план!
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('/analyze')}
                className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition shrink-0"
              >
                Загрузить материал 🚀
              </button>
            </motion.div>
          );
        }

        if (completedToday) {
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-transparent dark:from-emerald-950/20 dark:to-teal-950/20 border border-emerald-500/20 dark:border-emerald-900/40 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md text-xl">
                  ✓
                </div>
                <div>
                  <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-1.5">
                    Дневной план выполнен! 🎉
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mt-0.5 leading-relaxed">
                    Ты сегодня отлично потрудился, стрик дней в безопасности. Возвращайся завтра или начни свободное изучение лекций и тренировки!
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('/study-session')}
                className="w-full sm:w-auto px-5 py-2.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition shrink-0"
              >
                Повторить сессию ⚡
              </button>
            </motion.div>
          );
        }

        const cardsCount = dueCards.length > 0 ? Math.min(10, dueCards.length) : 5;
        const activeMaterialName = materials[0]?.title || 'учебному материалу';

        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-5 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl text-white relative overflow-hidden"
          >
            <div className="absolute right-0 top-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 pointer-events-none" />
            <div className="relative flex items-start sm:items-center gap-3 w-full min-w-0">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md text-xl animate-pulse">
                🔮
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
                  Твой личный наставник подготовил сессию обучения! ✨
                </h4>
                <p className="text-xs text-indigo-100 max-w-xl mt-0.5 leading-relaxed break-words">
                  Сегодня в плане: повторение {cardsCount} карточек + разбор лекции <span className="font-bold break-all">"{activeMaterialName}"</span>. Пройди сессию и получи <span className="font-extrabold text-amber-300 animate-pulse">+50 XP</span>!
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate('/study-session')}
              className="w-full sm:w-auto px-6 py-3 bg-white hover:bg-indigo-50 text-indigo-600 font-black text-xs rounded-xl shadow-lg hover:shadow-indigo-500/20 transition-all duration-300 shrink-0 relative z-10 scale-102 active:scale-98"
            >
              Начать учёбу 🚀
            </button>
          </motion.div>
        );
      })()}

      {/* ── СЕГОДНЯ: три главных карточки ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Due cards — главный CTA */}
        <motion.button
          onClick={() => navigate('/review')}
          whileHover={{ scale: 1.015, y: -2 }}
          className={`p-5 rounded-3xl text-left transition-all duration-300 flex flex-col justify-between h-44 shadow-lg ${
            dueCards.length > 0
              ? 'bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-xl shadow-indigo-200 dark:shadow-none border border-indigo-500/30 dark:border-indigo-500/20'
              : 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-400'
          }`}
        >
          <div className="flex items-center justify-between w-full">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${dueCards.length > 0 ? 'bg-white/20' : 'bg-emerald-500 text-white'}`}>
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${dueCards.length > 0 ? 'bg-white/10 text-indigo-100' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
              {dueCards.length > 0 ? 'Активно' : 'Готово'}
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-4xl sm:text-5xl font-black tracking-tight">{dueCards.length}</span>
              <span className="text-xs font-bold opacity-80">карточек</span>
            </div>
            <p className="text-xs font-black leading-none tracking-tight opacity-90">Карточки на повторение</p>
            <p className="text-[11px] mt-1 opacity-75">{dueCards.length > 0 ? 'Нажми, чтобы начать →' : 'Отличная работа сегодня ✓'}</p>
          </div>
        </motion.button>

        {/* Стрик */}
        <motion.div
          whileHover={{ scale: 1.015, y: -2 }}
          onClick={() => navigate('/analytics')}
          className={`p-5 rounded-3xl text-left transition-all duration-300 flex flex-col justify-between h-44 cursor-pointer shadow-lg ${
            streak >= 3
              ? 'bg-gradient-to-br from-orange-500 via-red-500 to-rose-600 text-white shadow-xl shadow-orange-200 dark:shadow-none border border-orange-500/30 dark:border-orange-500/20'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between w-full">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${streak >= 3 ? 'bg-white/20' : 'bg-rose-50 dark:bg-rose-950/30'}`}>
              <Flame className={`w-6 h-6 ${streak >= 3 ? 'text-white animate-pulse' : 'text-rose-500'}`} />
            </div>
            <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${streak >= 3 ? 'bg-white/10 text-orange-100' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
              {streak >= 3 ? 'В огне!' : 'Стрик'}
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-4xl sm:text-5xl font-black tracking-tight">{streak}</span>
              <span className="text-xs font-bold opacity-80">дн. подряд</span>
            </div>
            <p className="text-xs font-black leading-none tracking-tight opacity-90">Ударный темп обучения</p>
            <p className="text-[11px] mt-1 opacity-75">{streak >= 3 ? 'Твой темп на высоте! 🔥' : 'Занимайся ежедневно ✓'}</p>
          </div>
        </motion.div>

        {/* Быстрый повтор / Добавить материал */}
        {materials.length > 0 ? (
          <motion.button
            onClick={() => navigate('/quick-prep')}
            whileHover={{ scale: 1.015, y: -2 }}
            className="p-5 rounded-3xl text-left transition-all duration-300 flex flex-col justify-between h-44 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 text-white shadow-xl shadow-amber-200 dark:shadow-none border border-amber-500/30 dark:border-amber-500/20"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center">
                <Clock className="w-6 h-6 text-white" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/10 text-amber-100">
                5 минут
              </span>
            </div>
            <div>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-4xl sm:text-5xl font-black tracking-tight">Быстрый</span>
              </div>
              <p className="text-xs font-black leading-none tracking-tight opacity-90">Повтор лекций</p>
              <p className="text-[11px] mt-1 opacity-75">5 минут — и материал свеж →</p>
            </div>
          </motion.button>
        ) : (
          <motion.button
            onClick={() => navigate('/analyze')}
            whileHover={{ scale: 1.015, y: -2 }}
            className="p-5 rounded-3xl text-left border-2 border-dashed border-indigo-300 dark:border-indigo-800 hover:border-indigo-500 dark:hover:border-indigo-600 transition-all group flex flex-col justify-between h-44 bg-white/40 dark:bg-slate-900/40"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center group-hover:bg-indigo-100 group-hover:dark:bg-indigo-900 transition">
                <Zap className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                ИИ
              </span>
            </div>
            <div>
              <p className="text-sm font-black tracking-tight leading-none mb-1 text-slate-700 dark:text-slate-300">Добавить материал</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Загрузи лекцию или конспект →</p>
            </div>
          </motion.button>
        )}
      </div>

      {/* ── КОМПАКТНАЯ СТРОКА СТАТИСТИКИ ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/60 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl p-4 text-center shadow-sm">
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{materials.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Материалов</p>
        </div>
        <div className="bg-white/60 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl p-4 text-center shadow-sm">
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{subjects.length}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Предметов</p>
        </div>
        <button
          onClick={() => navigate('/knowledge-map')}
          className="bg-indigo-600/8 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-900/40 rounded-2xl p-4 text-center hover:bg-indigo-600/15 transition group shadow-sm"
        >
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform inline-block">🗺</p>
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5 font-semibold">Карта знаний</p>
        </button>
      </div>

      {/* ── БЛИЖАЙШИЙ ЭКЗАМЕН ── */}
      {nextExam && (() => {
        const daysLeft = Math.ceil((new Date(nextExam.exam_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        const urgency = daysLeft <= 3 ? 'rose' : daysLeft <= 7 ? 'amber' : 'indigo';
        const urgencyBg = urgency === 'rose'
          ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40'
          : urgency === 'amber'
          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40'
          : 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/40';
        const urgencyText = urgency === 'rose' ? 'text-rose-700 dark:text-rose-400' : urgency === 'amber' ? 'text-amber-700 dark:text-amber-400' : 'text-indigo-700 dark:text-indigo-400';
        return (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => navigate('/courses')}
            className={`p-4 border rounded-2xl cursor-pointer flex items-center gap-4 ${urgencyBg} hover:shadow-md transition`}
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

      {/* ── РЕКОМЕНДАЦИЯ ПО НАСТРОЕНИЮ ── */}
      {mood && (
        <div
          onClick={() => navigate('/mood')}
          className="p-4 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition flex items-center gap-4"
        >
          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl flex items-center justify-center shrink-0">
            <Heart className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest mb-0.5">Рекомендованный режим</p>
            <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">{mood.recommended_mode}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600" />
        </div>
      )}

      {/* ── НИЖНИЙ БЛОК: Квесты + Материалы + График ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Квесты */}
        <div className="lg:col-span-1 space-y-4">
          {materials.length === 0 && (
            <div className="card p-5 border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20">
              <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-emerald-500" /> Первые шаги
              </h2>
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
          )}
          <div className="card p-5 border-l-4 border-l-indigo-500">
            <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-amber-500" /> Квесты дня
            </h2>
            <div className="space-y-4">
              {quests.filter(q => q.type === 'daily').map(q => (
                <div key={q.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${q.is_completed ? 'text-emerald-600 line-through dark:text-emerald-400/80' : 'text-slate-700 dark:text-slate-200'}`}>{q.title}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5 leading-snug">{q.description}</p>
                    </div>
                    <span className="text-[10px] font-black text-indigo-500 shrink-0">+{q.xp_reward} XP</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-500 ${q.is_completed ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, (q.current_count / q.target_count) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">{q.current_count}/{q.target_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Правая колонка: материалы + еженедельные квесты */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">На повторение сегодня</h2>
                <button onClick={() => navigate('/review')} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">Начать →</button>
              </div>
              {dueCards.length === 0 ? (
                <p className="text-emerald-600 text-sm flex items-center gap-1.5 justify-center"><CheckCircle2 className="w-4 h-4" /> Все повторены!</p>
              ) : (
                <div className="space-y-2">
                  {dueCards.slice(0, 3).map((c: any) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate">{c.question}</span>
                    </div>
                  ))}
                  {dueCards.length > 3 && <p className="text-xs text-slate-400 dark:text-slate-500">+ ещё {dueCards.length - 3}</p>}
                </div>
              )}
            </div>
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
                    <div key={m.id} onClick={() => navigate('/library/' + m.id)} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200 transition">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate flex-1">{m.title}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{format(new Date(m.created_at), 'dd.MM.yy')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Еженедельные задания (Expanded) */}
          <div className="card p-5 border-l-4 border-l-purple-500 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500 animate-pulse" />
                <h2 className="font-extrabold text-slate-900 dark:text-slate-100 text-base">Еженедельные испытания</h2>
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">Обновляются каждый понедельник</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {quests.filter(q => q.type === 'weekly').map(q => (
                <div key={q.id} className="p-4 bg-slate-50/50 dark:bg-slate-900/20 border border-slate-200/50 dark:border-slate-800 rounded-2xl flex flex-col justify-between space-y-4 hover:shadow-md hover:border-purple-500/20 transition group">
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-black leading-snug ${q.is_completed ? 'text-emerald-600 line-through dark:text-emerald-400/80' : 'text-slate-800 dark:text-slate-200'}`}>
                        {q.title}
                      </p>
                      <span className="text-[10px] font-black text-purple-500 shrink-0">+{q.xp_reward} XP</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-normal mt-1">{q.description}</p>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">
                      <span>Прогресс</span>
                      <span>{q.current_count} / {q.target_count}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-700 ${q.is_completed ? 'bg-emerald-500' : 'bg-purple-500'}`} style={{ width: `${Math.min(100, (q.current_count / q.target_count) * 100)}%` }} />
                      </div>
                    </div>
                    {q.is_completed && (
                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1.5">
                        ✓ Выполнено!
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
