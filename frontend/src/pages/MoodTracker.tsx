import { useState, useEffect } from 'react';
import { Heart, Zap, Brain, Coffee, Frown, Smile, Meh, SmilePlus, CheckCircle2, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

type MoodType = 'great' | 'good' | 'okay' | 'tired' | 'stressed';

interface MoodEntry {
  id: string;
  mood: MoodType;
  energy_level: number;
  notes: string;
  recommended_mode: string;
  logged_at: string;
}

interface MoodConfig {
  label: string;
  emoji: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ComponentType<{ className?: string }>;
}

const MOODS: Record<MoodType, MoodConfig> = {
  great: { label: 'Отлично!', emoji: '🚀', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: SmilePlus },
  good: { label: 'Хорошо', emoji: '😊', color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-300', icon: Smile },
  okay: { label: 'Нормально', emoji: '😐', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', icon: Meh },
  tired: { label: 'Устал(а)', emoji: '😴', color: 'text-slate-700', bg: 'bg-slate-100', border: 'border-slate-300', icon: Coffee },
  stressed: { label: 'Стресс', emoji: '😰', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-300', icon: Frown },
};

const ENERGY_LABELS: Record<number, string> = {
  1: 'Совсем нет сил',
  2: 'Слабая энергия',
  3: 'Средняя',
  4: 'Бодрый(ая)',
  5: 'Полон(на) сил!'
};

function getRecommendation(mood: MoodType, energy: number): string {
  if (mood === 'great' && energy >= 4) {
    return '🔥 Режим «Глубокое погружение» — идеальный день для изучения сложных тем и AI-Экзаменатора!';
  }
  if ((mood === 'good' || mood === 'great') && energy >= 3) {
    return '📚 Режим «Активное обучение» — хорошо зайдёт изучение новых материалов и интерактивные миссии.';
  }
  if (mood === 'okay' || energy === 3) {
    return '🔄 Режим «Повторение» — самое время для спейсд-репетишн и флэш-карточек. Никаких подвигов!';
  }
  if (mood === 'tired' || energy <= 2) {
    return '🌙 Режим «Лёгкий просмотр» — просто перечитай конспект или послушай AI-чат. Мозг сегодня заслужил отдых.';
  }
  if (mood === 'stressed') {
    return '🧘 Режим «Анти-стресс» — начни с планировщика, разбей задачи на мелкие шаги и сделай только одно дело.';
  }
  return '📖 Выбери любой режим учёбы, который кажется тебе комфортным сегодня.';
}

export default function MoodTracker() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<'check' | 'form' | 'done'>('check');
  const [todayEntry, setTodayEntry] = useState<MoodEntry | null>(null);
  const [history, setHistory] = useState<MoodEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [selectedMood, setSelectedMood] = useState<MoodType | null>(null);
  const [energy, setEnergy] = useState(3);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('mood_log')
      .select('*')
      .eq('user_id', user!.id)
      .order('logged_at', { ascending: false })
      .limit(14);

    if (data) {
      const todayLog = data.find(d => d.logged_at === today);
      if (todayLog) {
        setTodayEntry(todayLog);
        setPhase('done');
      } else {
        setPhase('form');
      }
      setHistory(data.filter(d => d.logged_at !== today));
    }
    setLoading(false);
  };

  const saveMood = async () => {
    if (!selectedMood || !user) return;
    setSaving(true);

    const rec = getRecommendation(selectedMood, energy);

    const { data, error } = await supabase
      .from('mood_log')
      .insert({
        user_id: user.id,
        mood: selectedMood,
        energy_level: energy,
        notes: notes.trim(),
        recommended_mode: rec,
        logged_at: today,
      })
      .select()
      .single();

    if (!error && data) {
      setTodayEntry(data);
      setPhase('done');
    }
    setSaving(false);
  };

  const moodToEmoji = (m: MoodType) => MOODS[m]?.emoji ?? '•';
  const energyToBar = (e: number) => Math.round((e / 5) * 100);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Заголовок */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-pink-100 rounded-xl flex items-center justify-center">
          <Heart className="w-5 h-5 text-pink-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Трекер состояния</h1>
          <p className="text-xs text-slate-500">Как ты себя чувствуешь? ИИ подберёт режим учёбы</p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ФОРМА ВВОДА НАСТРОЕНИЯ */}
        {phase === 'form' && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-5"
          >
            <div className="card p-6">
              <h2 className="font-bold text-slate-900 mb-1">Как ты сегодня?</h2>
              <p className="text-xs text-slate-400 mb-5">Выбери своё состояние прямо сейчас</p>

              <div className="grid grid-cols-5 gap-2 mb-6">
                {(Object.entries(MOODS) as [MoodType, MoodConfig][]).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  const isSelected = selectedMood === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedMood(key)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                        isSelected
                          ? `${cfg.bg} ${cfg.border} scale-105 shadow-md`
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-2xl">{cfg.emoji}</span>
                      <span className={`text-[10px] font-bold ${isSelected ? cfg.color : 'text-slate-500'}`}>
                        {cfg.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Уровень энергии */}
              <div className="mb-5">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Уровень энергии
                  </label>
                  <span className="text-xs font-semibold text-indigo-600">
                    {ENERGY_LABELS[energy]}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-slate-300" />
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={energy}
                    onChange={e => setEnergy(Number(e.target.value))}
                    className="flex-1 accent-indigo-600 h-2 rounded-full cursor-pointer"
                  />
                  <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex justify-between mt-1">
                  {[1,2,3,4,5].map(n => (
                    <span key={n} className={`text-[10px] font-bold ${energy === n ? 'text-indigo-600' : 'text-slate-300'}`}>{n}</span>
                  ))}
                </div>
              </div>

              {/* Заметка */}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                  Заметка (необязательно)
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Что беспокоит? Есть дедлайн? Хочется конкретного?"
                  className="w-full h-20 px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition resize-none bg-slate-50/50"
                />
              </div>

              {/* Превью рекомендации */}
              {selectedMood && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4 p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl"
                >
                  <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Brain className="w-3 h-3" /> Рекомендация ИИ:
                  </p>
                  <p className="text-sm text-indigo-800 font-medium leading-snug">
                    {getRecommendation(selectedMood, energy)}
                  </p>
                </motion.div>
              )}

              <button
                disabled={!selectedMood || saving}
                onClick={saveMood}
                className="mt-5 w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-100"
              >
                <ChevronRight className="w-4 h-4" />
                {saving ? 'Сохраняем...' : 'Получить план на сегодня'}
              </button>
            </div>
          </motion.div>
        )}

        {/* РЕЗУЛЬТАТ ДНЯ */}
        {phase === 'done' && todayEntry && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
          >
            {/* Сегодняшний результат */}
            <div className={`card p-6 border-l-4 ${MOODS[todayEntry.mood]?.border ?? 'border-l-indigo-400'}`}>
              <div className="flex items-center gap-4 mb-4">
                <span className="text-4xl">{moodToEmoji(todayEntry.mood)}</span>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Сегодня ты сказал(а)</p>
                  <h2 className={`text-lg font-black ${MOODS[todayEntry.mood]?.color ?? 'text-slate-900'}`}>
                    {MOODS[todayEntry.mood]?.label}
                  </h2>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-slate-400">Энергия:</span>
                    <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all"
                        style={{ width: `${energyToBar(todayEntry.energy_level)}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-indigo-600">{todayEntry.energy_level}/5</span>
                  </div>
                </div>
              </div>

              {/* Рекомендация */}
              <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl">
                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Brain className="w-3 h-3" /> Рекомендованный режим учёбы:
                </p>
                <p className="text-sm text-slate-800 font-medium leading-relaxed">
                  {todayEntry.recommended_mode}
                </p>
              </div>

              {todayEntry.notes && (
                <div className="mt-3 p-3 bg-slate-50 rounded-xl">
                  <p className="text-xs text-slate-500 italic">«{todayEntry.notes}»</p>
                </div>
              )}

              <button
                onClick={() => { setSelectedMood(null); setEnergy(3); setNotes(''); setPhase('form'); }}
                className="mt-4 text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition"
              >
                Изменить состояние на сегодня
              </button>
            </div>

            {/* История последних 14 дней */}
            {history.length > 0 && (
              <div className="card p-5">
                <h3 className="font-bold text-slate-900 text-sm mb-4">История настроений (последние 14 дней)</h3>
                <div className="space-y-2">
                  {history.slice(0, 7).map(entry => (
                    <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                      <span className="text-lg w-8 text-center">{moodToEmoji(entry.mood)}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-700">
                            {MOODS[entry.mood]?.label}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(entry.logged_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <div className="w-full h-1 bg-slate-100 rounded-full mt-1">
                          <div
                            className="h-full bg-indigo-400 rounded-full"
                            style={{ width: `${energyToBar(entry.energy_level)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
