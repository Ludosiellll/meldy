import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, XCircle, Loader2, Trophy, Sparkles, BookOpen } from 'lucide-react';
import { getDiagnosticTest, DiagnosticQuestion } from '../api/career';
import toast from 'react-hot-toast';

interface DiagnosticTestModalProps {
  moduleTitle: string;
  moduleTheory: string;
  profession: string;
  onClose: () => void;
  onComplete: (canSkip: boolean, xpGained: number) => void;
}

export default function DiagnosticTestModal({
  moduleTitle,
  moduleTheory,
  profession,
  onClose,
  onComplete,
}: DiagnosticTestModalProps) {
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<DiagnosticQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOpt, setSelectedOpt] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [scores, setScores] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  useEffect(() => {
    loadTest();
  }, []);

  const loadTest = async () => {
    setLoading(true);
    try {
      const data = await getDiagnosticTest(moduleTitle, moduleTheory, profession);
      setQuestions(data.questions || []);
    } catch (e) {
      console.error(e);
      toast.error('Не удалось загрузить диагностический тест. Пожалуйста, попробуйте позже.');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (opt: string) => {
    if (answered) return;
    setSelectedOpt(opt);
    setAnswered(true);
    
    const q = questions[currentIdx];
    const letter = opt.split(')')[0].trim();
    const isCorrect = letter === q.correct;
    
    setScores(prev => [...prev, isCorrect]);
  };

  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(prev => prev + 1);
      setSelectedOpt(null);
      setAnswered(false);
    } else {
      // Finished
      const correct = scores.filter(Boolean).length;
      const pct = Math.round((correct / questions.length) * 100);
      setFinalScore(pct);
      setDone(true);
    }
  };

  const handleFinish = () => {
    const passed = finalScore >= 80;
    const xpGained = passed ? 40 : 0;
    onComplete(passed, xpGained);
  };

  const q = questions[currentIdx];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col h-[90vh] sm:h-auto"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-indigo-50 dark:bg-indigo-650/20 rounded-xl flex items-center justify-center border border-indigo-100 dark:border-indigo-900/30">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block">Входное ИИ-тестирование</span>
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate pr-4">{moduleTitle}</h3>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-150 dark:hover:bg-slate-800 rounded-full transition text-slate-400 hover:text-slate-650 dark:hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col justify-center min-h-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin text-indigo-600 dark:text-indigo-400" />
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">ИИ составляет индивидуальные вопросы для вас...</p>
              </div>
            ) : done ? (
              /* Done Screen */
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-5 py-4 text-center"
              >
                <div className={`w-20 h-20 rounded-full flex flex-col items-center justify-center font-black text-2xl border-4
                  ${finalScore >= 80 
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                    : 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border-indigo-500/40'}`}>
                  {finalScore}%
                </div>
                
                <div>
                  <h4 className="text-base font-black text-slate-800 dark:text-slate-100">
                    {finalScore >= 80 ? '🔥 Теория пройдена экстерном!' : '📚 Рекомендуем изучить теорию'}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm leading-relaxed">
                    {finalScore >= 80 
                      ? 'Поздравляем! Вы правильно ответили на 4+ вопроса. Вы получили бонусные +40 XP и можете сразу приступить к Expert-заданию в песочнице!'
                      : 'Вам немного не хватило до проходного балла (80%). Не переживайте! Изучите теорию модуля — это займет всего 15 минут.'}
                  </p>
                </div>

                <button
                  onClick={handleFinish}
                  className="w-full mt-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-extrabold transition shadow-md shadow-indigo-100 dark:shadow-none"
                >
                  {finalScore >= 80 ? 'Получить +40 XP и начать Практику' : 'Перейти к теории модуля'}
                </button>
              </motion.div>
            ) : (
              /* Quiz View */
              <div className="space-y-5">
                {/* Progress dot indicators */}
                <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-550 font-bold uppercase">
                  <span>Вопрос {currentIdx + 1} из {questions.length}</span>
                  <div className="flex gap-1">
                    {questions.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${
                          i < currentIdx
                            ? (scores[i] ? 'bg-emerald-500' : 'bg-rose-500')
                            : i === currentIdx ? 'bg-indigo-500 w-6' : 'bg-slate-200 dark:bg-slate-800'
                        } w-3`}
                      />
                    ))}
                  </div>
                </div>

                {/* Question title */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-2xl">
                  <p className="text-xs font-extrabold text-slate-800 dark:text-slate-100 leading-relaxed">
                    {q?.question}
                  </p>
                </div>

                {/* Options List */}
                <div className="space-y-2">
                  {q?.options.map((opt, oi) => {
                    const letter = opt.split(')')[0].trim();
                    const isCorrect = q.correct === letter;
                    const isSelected = selectedOpt === opt;
                    
                    let btnStyle = 'bg-slate-50/50 hover:bg-slate-50 dark:bg-slate-800/40 border-slate-250 dark:border-slate-800 hover:border-indigo-600 dark:hover:border-indigo-500 hover:bg-indigo-50/10 dark:hover:bg-indigo-950/20 text-slate-700 dark:text-slate-200';
                    
                    if (answered) {
                      if (isCorrect) {
                        btnStyle = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-400 font-extrabold';
                      } else if (isSelected && !isCorrect) {
                        btnStyle = 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-700 dark:text-rose-450 font-extrabold';
                      } else {
                        btnStyle = 'bg-slate-100/40 dark:bg-slate-800/20 border-slate-200 dark:border-slate-850 opacity-40 text-slate-400 dark:text-slate-550';
                      }
                    }

                    return (
                      <button
                        key={oi}
                        disabled={answered}
                        onClick={() => handleSelect(opt)}
                        className={`w-full text-left p-3.5 rounded-xl border text-xs font-semibold transition-all flex items-center justify-between ${btnStyle}`}
                      >
                        <span className="flex items-center gap-2 truncate pr-4">
                          {answered && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                          {answered && isSelected && !isCorrect && <XCircle className="w-4 h-4 text-rose-500 shrink-0" />}
                          <span className="truncate">{opt}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Explanation text */}
                {answered && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-indigo-50/50 dark:bg-indigo-950/10 border border-indigo-100/50 dark:border-indigo-900/20 rounded-xl text-[10px] text-slate-600 dark:text-slate-350 leading-relaxed italic"
                  >
                    <span className="font-extrabold text-indigo-650 dark:text-indigo-400 not-italic block mb-0.5">Разбор ответа:</span>
                    {q?.explanation}
                  </motion.div>
                )}

                {/* Action button */}
                {answered && (
                  <button
                    onClick={handleNext}
                    className="w-full py-2.5 bg-indigo-650 hover:bg-indigo-500 text-white rounded-xl text-xs font-extrabold transition shadow-sm"
                  >
                    {currentIdx < questions.length - 1 ? 'Следующий вопрос →' : 'Посмотреть результаты'}
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
