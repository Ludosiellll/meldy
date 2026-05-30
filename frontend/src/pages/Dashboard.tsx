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

      {/* ── ШАПКА: приветствие + XP ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Привет, {name}! 👋</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm capitalize mt-0.5">
            {format(new Date(), 'EEEE, d MMMM', { locale: ru })}
          </p>
        </div>
        <motion.button
          onClick={() => navigate('/analytics')}
          whileHover={{ scale: 1.02 }}
          className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-indigo-300 transition-shadow tour-step-desktop-xp tour-step-mobile-xp"
        >
          <div>
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-1">Ур. {levelInfo.level} · {levelInfo.name}</p>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-black/20 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-white/80 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${levelInfo.progress}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>
              <span className="text-xs font-black whitespace-nowrap">{xp} XP</span>
            </div>
          </div>
          <BarChart2 className="w-5 h-5 text-indigo-200 shrink-0 hidden sm:block" />
        </motion.button>
      </div>

      {/* ── РЕЖИМ СЕССИИ: Умный наставник ── */}
      {(() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const completedToday = sessions.some(s => s.date === todayStr && s.cards_reviewed > 0);
        
        if (materials.length === 0) {
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
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
            <div className="relative flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md text-xl animate-pulse">
                🔮
              </div>
              <div>
                <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
                  Твой личный наставник подготовил сессию обучения! ✨
                </h4>
                <p className="text-xs text-indigo-100 max-w-xl mt-0.5 leading-relaxed">
                  Сегодня в плане: повторение {cardsCount} карточек + разбор лекции "{activeMaterialName}". Пройди сессию и получи <span className="font-extrabold text-amber-300 animate-pulse">+50 XP</span>!
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Due cards — главный CTA */}
        <motion.button
          onClick={() => navigate('/review')}
          whileHover={{ scale: 1.01 }}
          className={`p-5 rounded-2xl text-left transition-all ${
            dueCards.length > 0
              ? 'bg-gradient-to-br from-indigo-600 to-purple-700 text-white shadow-xl shadow-indigo-200 dark:shadow-indigo-900/40'
              : 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${dueCards.length > 0 ? 'bg-white/20' : 'bg-emerald-500'}`}>
              <Brain className="w-5 h-5 text-white" />
            </div>
            {dueCards.length > 0 && <span className="text-3xl font-black text-white">{dueCards.length}</span>}
          </div>
          <p className={`text-sm font-bold mb-0.5 ${dueCards.length > 0 ? 'text-white' : 'text-emerald-800 dark:text-emerald-300'}`}>
            {dueCards.length > 0 ? 'Карточек на повторение' : 'Все карточки повторены!'}
          </p>
          <p className={`text-xs ${dueCards.length > 0 ? 'text-indigo-200' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {dueCards.length > 0 ? 'Нажми, чтобы начать →' : 'Отличная работа сегодня ✓'}
          </p>
        </motion.button>

        {/* Стрик */}
        <motion.div
          whileHover={{ scale: 1.01 }}
          className={`p-5 rounded-2xl flex items-center gap-4 ${
            streak >= 3
              ? 'bg-gradient-to-br from-orange-500 to-rose-600 shadow-xl shadow-orange-200 dark:shadow-orange-900/40'
              : 'bg-white/60 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${streak >= 3 ? 'bg-white/20' : 'bg-rose-50 dark:bg-rose-950/30'}`}>
            <Flame className={`w-7 h-7 ${streak >= 3 ? 'text-white animate-pulse' : 'text-rose-500'}`} />
          </div>
          <div>
            <p className={`text-4xl font-black leading-none ${streak >= 3 ? 'text-white' : 'text-slate-900 dark:text-slate-100'}`}>{streak}</p>
            <p className={`text-sm font-bold mt-1 ${streak >= 3 ? 'text-orange-100' : 'text-slate-500 dark:text-slate-400'}`}>
              {streak >= 3 ? '🔥 дней подряд!' : 'дней подряд'}
            </p>
          </div>
        </motion.div>

        {/* Быстрый повтор / Добавить материал */}
        {materials.length > 0 ? (
          <motion.button
            onClick={() => navigate('/quick-prep')}
            whileHover={{ scale: 1.01 }}
            className="p-5 rounded-2xl text-left bg-gradient-to-br from-amber-400 to-orange-500 shadow-xl shadow-amber-200 dark:shadow-amber-900/40 transition-all"
          >
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center mb-3">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <p className="text-sm font-bold text-white mb-0.5">Быстрый повтор</p>
            <p className="text-xs text-amber-100">5 минут — и материал свеж →</p>
          </motion.button>
        ) : (
          <motion.button
            onClick={() => navigate('/analyze')}
            whileHover={{ scale: 1.01 }}
            className="p-5 rounded-2xl text-left border-2 border-dashed border-indigo-300 dark:border-indigo-800 hover:border-indigo-500 dark:hover:border-indigo-600 transition-all group tour-step-mobile-upload"
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center mb-3 group-hover:bg-indigo-100 transition">
              <Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-0.5">Добавить первый материал</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Загрузи лекцию или конспект →</p>
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
          <div className="card p-5 border-l-4 border-l-purple-500">
            <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-purple-500" /> Еженедельные
            </h2>
            <div className="space-y-4">
              {quests.filter(q => q.type === 'weekly').map(q => (
                <div key={q.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${q.is_completed ? 'text-emerald-600 line-through dark:text-emerald-400/80' : 'text-slate-700 dark:text-slate-200'}`}>{q.title}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5 leading-snug">{q.description}</p>
                    </div>
                    <span className="text-[10px] font-black text-purple-500 shrink-0">+{q.xp_reward} XP</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-500 ${q.is_completed ? 'bg-emerald-500' : 'bg-purple-500'}`} style={{ width: `${Math.min(100, (q.current_count / q.target_count) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">{q.current_count}/{q.target_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Правая колонка: материалы + график */}
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
          <div className="card p-4 md:p-5 overflow-x-auto custom-scrollbar">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">Активность за 2 недели</h2>
            <div style={{ height: 200, minWidth: 500 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke={isDark ? '#475569' : '#94a3b8'} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={isDark ? '#475569' : '#94a3b8'} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: isDark ? '1px solid #334155' : '1px solid #e2e8f0', backgroundColor: isDark ? '#1e293b' : '#ffffff', color: isDark ? '#f1f5f9' : '#0f172a', fontSize: 13 }}
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
    </div>
  );
}
