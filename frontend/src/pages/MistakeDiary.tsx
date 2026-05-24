import { useState, useEffect } from 'react';
import { BookMarked, CheckCircle2, AlertCircle, RefreshCw, Trash2, Filter, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

interface Mistake {
  id: string;
  question: string;
  correct_answer: string;
  student_answer: string;
  topic: string;
  is_resolved: boolean;
  created_at: string;
  material_id: string | null;
}

export default function MistakeDiary() {
  const { user } = useAuth();
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMistakes = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('mistake_diary')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) setMistakes(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchMistakes();
  }, [user?.id]);

  const markResolved = async (id: string) => {
    await supabase
      .from('mistake_diary')
      .update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', id);
    setMistakes(prev => prev.map(m => m.id === id ? { ...m, is_resolved: true } : m));
  };

  const deleteMistake = async (id: string) => {
    await supabase.from('mistake_diary').delete().eq('id', id);
    setMistakes(prev => prev.filter(m => m.id !== id));
  };

  const filtered = mistakes.filter(m => {
    if (filter === 'open') return !m.is_resolved;
    if (filter === 'resolved') return m.is_resolved;
    return true;
  });

  const openCount = mistakes.filter(m => !m.is_resolved).length;
  const resolvedCount = mistakes.filter(m => m.is_resolved).length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Заголовок */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
          <BookMarked className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Дневник ошибок</h1>
          <p className="text-xs text-slate-500">Все слабые места после AI-Экзаменатора</p>
        </div>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-slate-900">{mistakes.length}</p>
          <p className="text-xs text-slate-500 mt-1">Всего ошибок</p>
        </div>
        <div className="card p-4 text-center border-l-4 border-l-rose-400">
          <p className="text-2xl font-black text-rose-600">{openCount}</p>
          <p className="text-xs text-slate-500 mt-1">Требуют внимания</p>
        </div>
        <div className="card p-4 text-center border-l-4 border-l-emerald-400">
          <p className="text-2xl font-black text-emerald-600">{resolvedCount}</p>
          <p className="text-xs text-slate-500 mt-1">Исправлено</p>
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-slate-400" />
        {(['all', 'open', 'resolved'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f === 'all' ? 'Все' : f === 'open' ? '🔴 Открытые' : '✅ Исправленные'}
          </button>
        ))}
        <button
          onClick={fetchMistakes}
          className="ml-auto p-1.5 text-slate-400 hover:text-slate-700 transition"
          title="Обновить"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Список ошибок */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-7 h-7 text-emerald-500" />
          </div>
          <h3 className="font-bold text-slate-700 mb-1">
            {filter === 'open' ? 'Отличная работа!' : 'Пока пусто'}
          </h3>
          <p className="text-sm text-slate-400">
            {filter === 'open'
              ? 'Все ошибки исправлены. Продолжайте в том же духе!'
              : 'Пройдите AI-Экзамен, и ваши ошибки появятся здесь.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map(mistake => (
              <motion.div
                key={mistake.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, margin: 0 }}
                className={`card overflow-hidden ${
                  mistake.is_resolved ? 'opacity-60' : ''
                }`}
              >
                {/* Заголовок карточки */}
                <div
                  className="p-4 cursor-pointer flex items-start gap-3"
                  onClick={() => setExpandedId(expandedId === mistake.id ? null : mistake.id)}
                >
                  <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                    mistake.is_resolved ? 'bg-emerald-100' : 'bg-rose-100'
                  }`}>
                    {mistake.is_resolved
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      : <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">
                      {mistake.question}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {mistake.topic && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
                          {mistake.topic}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">
                        {new Date(mistake.created_at).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                    expandedId === mistake.id ? 'rotate-180' : ''
                  }`} />
                </div>

                {/* Раскрытое содержимое */}
                <AnimatePresence>
                  {expandedId === mistake.id && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
                        {/* Ответ студента */}
                        <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl">
                          <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-1">
                            Мой ответ
                          </p>
                          <p className="text-sm text-slate-700 leading-relaxed">
                            {mistake.student_answer || '— (пусто)'}
                          </p>
                        </div>

                        {/* Правильный ответ */}
                        <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">
                            Правильный ответ
                          </p>
                          <p className="text-sm text-slate-700 leading-relaxed">
                            {mistake.correct_answer}
                          </p>
                        </div>

                        {/* Действия */}
                        <div className="flex gap-2 pt-1">
                          {!mistake.is_resolved && (
                            <button
                              onClick={() => markResolved(mistake.id)}
                              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Отметить как исправленную
                            </button>
                          )}
                          <button
                            onClick={() => deleteMistake(mistake.id)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 text-xs font-bold rounded-lg transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Удалить
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
