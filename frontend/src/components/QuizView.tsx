import { QuizQuestion, QuizInfo } from '../types';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function QuizView({ data, onComplete }: { data: any, onComplete?: (scorePct: number) => void }) {
  const quiz = data?.quiz;

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Fullscreen mode state (separate from normal)
  const [fsOpen, setFsOpen] = useState(false);
  const [fsIdx, setFsIdx] = useState(0);
  const [fsAnswers, setFsAnswers] = useState<Record<number, string>>({});
  const [fsSubmitted, setFsSubmitted] = useState(false);

  const handleSelect = (qi: number, option: string) => {
    if (submitted) return;
    setAnswers({ ...answers, [qi]: option });
  };

  const handleSubmit = () => {
    setSubmitted(true);
    const score = quiz.filter((q: QuizQuestion, i: number) => answers[i]?.startsWith(q.correct)).length;
    const pct = Math.round((score / quiz.length) * 100);
    
    if (score === quiz.length) {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ['#4F46E5', '#10b981', '#f59e0b'] });
    }
    
    if (onComplete) {
      onComplete(pct);
    }
  };
  const handleRetry = () => { setAnswers({}); setSubmitted(false); };

  if (!quiz || !Array.isArray(quiz)) {
    return (
      <div className="card p-6 bg-slate-50 border-slate-200">
        <p className="text-slate-500 mb-2 font-medium">Тест не удалось сгенерировать корректно</p>
        {data?.error && <p className="text-rose-500 text-xs mb-3">Ошибка: {data.error}</p>}
        {data?.raw && (
          <details className="text-xs">
            <summary className="text-indigo-600 cursor-pointer hover:underline mb-2">Показать сырой ответ AI</summary>
            <pre className="p-3 bg-slate-900 text-slate-300 rounded overflow-x-auto whitespace-pre-wrap max-h-64">
              {data.raw}
            </pre>
          </details>
        )}
        {!data?.raw && !data?.error && <p className="text-slate-400 text-sm">Нет данных для отображения</p>}
      </div>
    );
  }

  const correct = quiz.filter((q: QuizQuestion, i: number) => answers[i]?.startsWith(q.correct)).length;
  const total = quiz.length;
  const pct = Math.round((correct / total) * 100);

  const gradeInfo = pct >= 90 ? { label: 'Отлично', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30' }
    : pct >= 70 ? { label: 'Хорошо', color: 'text-brand-600 dark:text-indigo-400', bg: 'bg-brand-50 dark:bg-indigo-950/20 border-brand-200 dark:border-indigo-900/30' }
    : pct >= 50 ? { label: 'Удовлетворительно', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30' }
    : { label: 'Нужно подтянуть', color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30' };

  // Fullscreen mode
  if (fsOpen && quiz) {
    const fsQ = quiz[fsIdx];
    const fsTotal = quiz.length;
    const fsCorrect = quiz.filter((q: QuizQuestion, i: number) => fsAnswers[i]?.startsWith(q.correct)).length;

    const fsSelect = (opt: string) => {
      if (fsSubmitted) return;
      setFsAnswers({ ...fsAnswers, [fsIdx]: opt });
    };

    const fsNext = () => {
      if (fsIdx + 1 < fsTotal) setFsIdx(fsIdx + 1);
      else setFsSubmitted(true);
    };

    const fsExit = () => { setFsOpen(false); setFsIdx(0); setFsAnswers({}); setFsSubmitted(false); };

    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 bg-slate-900/40 backdrop-blur-md border-b border-slate-800/80">
          <span className="text-indigo-400 font-extrabold text-base tracking-widest uppercase flex items-center gap-2">
            StudyForge
            <span className="text-slate-400 text-xs font-medium uppercase tracking-normal">| Режим презентации</span>
          </span>
          <button
            onClick={fsExit}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-800/50 hover:bg-rose-600 hover:text-white text-slate-300 transition duration-200 rounded-xl text-xs font-black border border-slate-700/50 cursor-pointer shadow-sm"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>Выйти</span>
          </button>
        </div>

        {!fsSubmitted ? (
          <div className="flex flex-col items-center justify-center flex-1 px-8 py-12">
            <div className="w-full max-w-4xl text-center mb-10 bg-slate-900/40 p-8 sm:p-10 rounded-3xl border border-slate-800/60 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
              <p className="text-indigo-400 text-xs font-black uppercase tracking-widest mb-3">Вопрос {fsIdx + 1} из {fsTotal}</p>
              <h2 className="text-white text-2xl sm:text-3xl font-extrabold leading-snug">{fsQ.question}</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl w-full mx-auto">
              {fsQ.options?.map((opt: string, j: number) => {
                const selected = fsAnswers[fsIdx] === opt;
                return (
                  <div
                    key={j}
                    onClick={() => fsSelect(opt)}
                    className={`rounded-2xl p-5 sm:p-6 text-base sm:text-lg font-bold cursor-pointer transition-all duration-200 border flex items-center justify-between select-none ${
                      selected
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/10'
                        : 'bg-slate-900/50 border-slate-850 text-slate-300 hover:bg-slate-800/60 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    <span className="pr-4 leading-normal">{opt.replace(/^[A-D]\)\s*/, '')}</span>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                      selected
                        ? 'bg-white text-indigo-600 shadow'
                        : 'bg-slate-800 border border-slate-700 text-slate-400'
                    }`}>
                      {['A', 'B', 'C', 'D'][j]}
                    </span>
                  </div>
                );
              })}
            </div>

            {fsAnswers[fsIdx] && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={fsNext}
                className="mt-10 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-base font-black transition shadow-lg shadow-indigo-600/20 duration-150 active:scale-[0.98] cursor-pointer"
              >
                {fsIdx + 1 < fsTotal ? 'Следующий вопрос →' : 'Завершить тест 🎯'}
              </motion.button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 px-8 py-12">
            <div className="w-full max-w-2xl text-center bg-slate-900/40 p-8 sm:p-10 rounded-3xl border border-slate-800/60 shadow-xl mb-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
              <p className="text-5xl font-black text-white mb-2 tabular-nums">{fsCorrect} из {fsTotal}</p>
              <p className="text-indigo-400 font-extrabold text-xs uppercase tracking-wider mb-4">Верных ответов</p>
              
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden mb-6 p-[2px]">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                  style={{ width: `${Math.round((fsCorrect / fsTotal) * 100)}%` }}
                />
              </div>
              <p className="text-slate-400 text-sm font-medium">Тест успешно завершен аудиторией! {Math.round((fsCorrect / fsTotal) * 100)}% правильных ответов.</p>
            </div>

            <div className="max-w-2xl w-full mx-auto space-y-4 pr-1">
              {quiz.map((q: QuizQuestion, i: number) => {
                const isCorrect = fsAnswers[i]?.startsWith(q.correct);
                return (
                  <div key={i} className={`rounded-2xl p-5 border flex items-start gap-4 transition-all ${
                    isCorrect 
                      ? 'bg-emerald-950/20 border-emerald-900/60 text-slate-200' 
                      : 'bg-rose-950/15 border-rose-900/60 text-slate-200'
                  }`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                      isCorrect ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white mb-1.5 leading-snug break-words">{q.question}</p>
                      <p className={`text-sm font-bold flex items-center gap-1.5 ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isCorrect
                          ? '✓ Верно'
                          : `✗ Правильный ответ: ${q.correct}) ${q.options?.find((o: string) => o.startsWith(q.correct))?.replace(/^[A-D]\)\s*/, '') || q.correct}`
                        }
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={fsExit}
              className="mt-8 px-8 py-3.5 bg-white hover:bg-slate-100 text-slate-900 rounded-2xl font-black text-sm active:scale-[0.98] transition shadow-md cursor-pointer"
            >
              Закрыть презентацию
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80">
        <div>
          <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Проверочное тестирование</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">Ответьте на {total} вопросов для проверки знаний по материалу</p>
        </div>
        {!submitted && (
          <button
            onClick={() => setFsOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 hover:bg-indigo-100/70 dark:bg-indigo-950/30 dark:hover:bg-indigo-900/40 border border-indigo-250 dark:border-indigo-850/40 shadow-sm transition active:scale-[0.98] duration-150 cursor-pointer shrink-0"
          >
            <Maximize2 className="w-4 h-4" />
            <span>Режим презентации для аудитории</span>
          </button>
        )}
      </div>

      {submitted && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className={'card p-5 mb-6 flex items-center justify-between border ' + gradeInfo.bg}>
          <div>
            <p className={'font-bold text-lg ' + gradeInfo.color}>{correct} из {total} — {gradeInfo.label}</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{pct}% правильных ответов</p>
          </div>
          <button onClick={handleRetry}
            className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-slate-800 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition border border-slate-200 dark:border-slate-700">
            <RotateCcw className="w-3.5 h-3.5" />Пройти снова
          </button>
        </motion.div>
      )}

      <div className="space-y-4">
        {quiz.map((q: QuizQuestion, i: number) => {
          const selected = answers[i];
          const isCorrect = selected?.startsWith(q.correct);
          const isWrong = submitted && selected && !isCorrect;

          return (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="card p-5">
              <p className="font-medium text-slate-900 dark:text-slate-100 mb-3">{i+1}. {q.question}</p>
              <div className="space-y-2">
                {q.options?.map((opt: string, j: number) => {
                  const isSelected = selected === opt;
                  const isCorrectOpt = submitted && opt.startsWith(q.correct);
                  const isWrongOpt = submitted && isSelected && !isCorrect;

                  let cls = 'p-3 rounded-lg text-sm cursor-pointer transition border ';
                  if (!submitted) {
                    cls += isSelected ? 'bg-brand-50 dark:bg-indigo-950/30 border-brand-300 dark:border-indigo-800 text-slate-900 dark:text-indigo-200' : 'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800/60 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700';
                  } else if (isCorrectOpt) {
                    cls += 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300';
                  } else if (isWrongOpt) {
                    cls += 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-900/50 text-rose-800 dark:text-rose-300 line-through';
                  } else {
                    cls += 'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800/60 text-slate-400 dark:text-slate-500';
                  }

                  return (
                    <div key={j} className={'flex items-center gap-2 ' + cls}
                      onClick={() => handleSelect(i, opt)}>
                      {isCorrectOpt && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                      {isWrongOpt && <XCircle className="w-4 h-4 text-rose-500 shrink-0" />}
                      <span>{opt}</span>
                    </div>
                  );
                })}
              </div>
              {submitted && q.explanation && (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 italic border-t border-slate-100 dark:border-slate-800/80 pt-3">💡 {q.explanation}</p>
              )}
            </motion.div>
          );
        })}
      </div>

      {!submitted && (
        <div className="mt-6 text-center">
          <p className="text-sm text-slate-400 mb-2">
            Отвечено {Object.keys(answers).length} из {total} вопросов
          </p>
          {Object.keys(answers).length === total && (
            <button onClick={handleSubmit}
              className="px-8 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium transition">
              Проверить ответы
            </button>
          )}
        </div>
      )}
    </div>
  );
}
