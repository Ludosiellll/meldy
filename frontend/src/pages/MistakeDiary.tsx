import { useState, useEffect } from 'react';
import { BookMarked, CheckCircle2, AlertCircle, RefreshCw, Trash2, Filter, ChevronDown, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { addXP } from '../api/quests';
import confetti from 'canvas-confetti';

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
  const { confirm, alert } = useConfirm();
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Состояния для AI-Работы над ошибками
  const [isPracticing, setIsPracticing] = useState(false);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceQuestions, setPracticeQuestions] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [practiceFinished, setPracticeFinished] = useState(false);

  const startPractice = async () => {
    const openMistakes = mistakes.filter(m => !m.is_resolved);
    if (openMistakes.length === 0) return;
    
    // Берём до 5 неисправленных ошибок
    const toPractice = openMistakes.slice(0, 5);
    
    setPracticeLoading(true);
    try {
      const res = await fetch('/api/mistakes/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mistakes: toPractice }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPracticeQuestions(data.practice || []);
      setIsPracticing(true);
      setCurrentQIndex(0);
      setSelectedOption(null);
      setShowExplanation(false);
      setCorrectCount(0);
      setPracticeFinished(false);
    } catch (e) {
      await alert({ title: 'Ошибка', message: 'Не удалось запустить работу над ошибками. Попробуйте еще раз.', type: 'danger' });
    } finally {
      setPracticeLoading(false);
    }
  };

  const checkAnswer = (opt: string) => {
    if (selectedOption) return; // Запрещаем повторный выбор
    setSelectedOption(opt);
    setShowExplanation(true);
    const q = practiceQuestions[currentQIndex];
    if (opt.startsWith(q.correct)) {
      setCorrectCount(prev => prev + 1);
    }
  };

  const nextQuestion = async () => {
    if (currentQIndex + 1 < practiceQuestions.length) {
      setCurrentQIndex(prev => prev + 1);
      setSelectedOption(null);
      setShowExplanation(false);
    } else {
      setPracticeFinished(true);
      
      const openMistakes = mistakes.filter(m => !m.is_resolved);
      const toPractice = openMistakes.slice(0, 5);
      const successRate = (correctCount + (selectedOption?.startsWith(practiceQuestions[currentQIndex]?.correct) ? 1 : 0)) / practiceQuestions.length;
      
      // Считаем финальный correctCount с учётом последнего вопроса, если он правильный
      const finalCorrect = correctCount + (selectedOption?.startsWith(practiceQuestions[currentQIndex]?.correct) ? 1 : 0);
      const finalRate = finalCorrect / practiceQuestions.length;

      if (finalRate >= 0.6) {
        const ids = toPractice.map(m => m.id);
        const resolvedAt = new Date().toISOString();
        
        await supabase
          .from('mistake_diary')
          .update({ is_resolved: true, resolved_at: resolvedAt })
          .in('id', ids);
          
        setMistakes(prev => prev.map(m => ids.includes(m.id) ? { ...m, is_resolved: true } : m));
        
        if (user) {
          await addXP(user.id, 50);
        }
        
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    }
  };

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
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      {/* ═══ РЕЖИМ ПРАКТИКИ ════════════════════════════════════════════════════ */}
      {isPracticing ? (
        <div className="max-w-2xl mx-auto py-8">
          <AnimatePresence mode="wait">
            {!practiceFinished ? (
              <motion.div
                key={`q-${currentQIndex}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Хедер прогресса */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-lg">
                      Вопрос {currentQIndex + 1} из {practiceQuestions.length}
                    </span>
                    <span className="text-xs text-slate-400">
                      Верных ответов: {correctCount}
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      if (await confirm({ title: 'Прервать', message: 'Вы уверены, что хотите прервать работу над ошибками? Прогресс не сохранится.', type: 'warning' })) {
                        setIsPracticing(false);
                      }
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition"
                  >
                    Прервать
                  </button>
                </div>

                {/* Карточка вопроса */}
                <div className="card p-4 md:p-8 space-y-4 md:space-y-6">
                  <h3 className="text-lg font-bold text-slate-800 leading-relaxed">
                    {practiceQuestions[currentQIndex]?.question}
                  </h3>

                  {/* Опции */}
                  <div className="space-y-3">
                    {practiceQuestions[currentQIndex]?.options.map((opt: string) => {
                      const isSelected = selectedOption === opt;
                      const isCorrect = opt.startsWith(practiceQuestions[currentQIndex]?.correct);
                      const hasAnswered = selectedOption !== null;

                      let btnStyle = 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700';
                      if (hasAnswered) {
                        if (isCorrect) {
                          btnStyle = 'bg-emerald-50 border-emerald-300 text-emerald-800';
                        } else if (isSelected) {
                          btnStyle = 'bg-rose-50 border-rose-300 text-rose-800';
                        } else {
                          btnStyle = 'border-slate-100 text-slate-400 opacity-60';
                        }
                      }

                      return (
                        <button
                          key={opt}
                          disabled={hasAnswered}
                          onClick={() => checkAnswer(opt)}
                          className={`w-full p-3 md:p-4 text-left text-sm font-semibold rounded-xl border-2 transition-all duration-200 ${btnStyle} flex justify-between items-center`}
                        >
                          <span>{opt}</span>
                          {hasAnswered && isCorrect && (
                            <span className="text-[10px] uppercase font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-md shrink-0">Верно</span>
                          )}
                          {hasAnswered && isSelected && !isCorrect && (
                            <span className="text-[10px] uppercase font-bold bg-rose-600 text-white px-2 py-0.5 rounded-md shrink-0">Ошибка</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Объяснение */}
                  {showExplanation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      style={{ overflow: 'hidden' }}
                      className="p-4 bg-amber-50/50 border border-amber-100 rounded-xl space-y-1"
                    >
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Разбор и пояснение</h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {practiceQuestions[currentQIndex]?.explanation}
                      </p>
                    </motion.div>
                  )}

                  {/* Кнопка далее */}
                  {selectedOption && (
                    <motion.button
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={nextQuestion}
                      className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-100"
                    >
                      {currentQIndex + 1 < practiceQuestions.length ? 'Следующий вопрос' : 'Завершить практику'}
                    </motion.button>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="finished"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card p-8 md:p-10 text-center space-y-6"
              >
                {/* Иконка */}
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto bg-gradient-to-br from-amber-100 to-rose-100">
                  <Zap className="w-8 h-8 text-amber-500 animate-bounce" />
                </div>

                {/* Тексты результатов */}
                {correctCount / practiceQuestions.length >= 0.6 ? (
                  <div className="space-y-2">
                    <h2 className="text-2xl font-black text-slate-800">Отличная работа! 🎉</h2>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                      Вы ответили верно на {correctCount} из {practiceQuestions.length} вопросов. AI подтверждает: ваши слабые места усвоены!
                    </p>
                    <div className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-full px-4 py-2 mt-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                      Ошибки исправлены &amp; Получено +50 XP
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-slate-800">Попробуйте еще раз 💔</h2>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                      Вы ответили верно на {correctCount} из {practiceQuestions.length} вопросов. Нужно хотя бы 2 правильных ответа, чтобы исправить ошибки в дневнике.
                    </p>
                  </div>
                )}

                {/* Кнопка выхода */}
                <button
                  onClick={() => {
                    setIsPracticing(false);
                    setPracticeFinished(false);
                    fetchMistakes();
                  }}
                  className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black rounded-xl transition"
                >
                  Вернуться в дневник
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* ═══ ОБЫЧНЫЙ РЕЖИМ ДНЕВНИКА ═══════════════════════════════════════════ */
        <>
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

          {/* Кнопка работы над ошибками */}
          {openCount > 0 && (
            <button
              onClick={startPractice}
              disabled={practiceLoading}
              className="w-full mb-6 py-4 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white rounded-2xl font-black text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-rose-100"
            >
              {practiceLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  AI анализирует ошибки и готовит тест...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-amber-200 animate-pulse" />
                  ⚡ Запустить AI-работу над ошибками (+50 XP)
                </>
              )}
            </button>
          )}

          {/* Статистика */}
          <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
            <div className="card p-2 md:p-4 text-center">
              <p className="text-xl md:text-2xl font-black text-slate-900">{mistakes.length}</p>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Всего ошибок</p>
            </div>
            <div className="card p-2 md:p-4 text-center border-l-4 border-l-rose-400">
              <p className="text-xl md:text-2xl font-black text-rose-600">{openCount}</p>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Внимания</p>
            </div>
            <div className="card p-2 md:p-4 text-center border-l-4 border-l-emerald-400">
              <p className="text-xl md:text-2xl font-black text-emerald-600">{resolvedCount}</p>
              <p className="text-[10px] md:text-xs text-slate-500 mt-1">Исправлено</p>
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
                        <p className="text-sm font-semibold text-slate-800 leading-snug">
                          {mistake.question.length > 80 ? mistake.question.slice(0, 80) + '...' : mistake.question}
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
        </>
      )}
    </div>
  );
}
