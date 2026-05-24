import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Brain, GraduationCap, Flame, ChevronRight, FileText, Zap, Calendar, Award, Gamepad2, Heart } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';
import { getDueCards } from '../api/flashcards';

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getMaterials(user.id),
      getDueCards(user.id),
      supabase.from('subjects').select('*').eq('user_id', user.id),
      supabase.from('study_sessions').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(30),
      supabase.from('mood_log').select('*').eq('user_id', user.id).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([mats, cards, subRes, sessRes, moodRes]) => {
      setMaterials(mats);
      setDueCards(cards);
      setSubjects(subRes.data || []);
      setSessions(sessRes.data || []);
      setMood(moodRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [user?.id]);

  const streak = (() => {
    const dates = new Set(sessions.map((s: any) => s.date));
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
    sessions.forEach((s: any) => { map[s.date] = s.cards_reviewed; });
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
      {/* Greeting */}
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Привет, {name}! 👋</h1>
      <p className="text-slate-500 mb-6 capitalize">{format(new Date(), 'EEEE, d MMMM', { locale: ru })}</p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Материалов" value={materials.length} color="indigo" />
        <StatCard icon={Brain} label="Карточек сегодня" value={dueCards.length} color="emerald" />
        <StatCard icon={GraduationCap} label="Предметов" value={subjects.length} color="amber" />
        <StatCard icon={Flame} label="Дней подряд" value={streak} color="rose" />
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

      {/* Two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
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
              {materials.slice(0, 3).map((m: any) => (
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
      <div className="card p-5 mt-6">
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