import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function QuizView({ data }: { data: any }) {
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
    const score = quiz.filter((q: any, i: number) => answers[i]?.startsWith(q.correct)).length;
    if (score === quiz.length) {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ['#4F46E5', '#10b981', '#f59e0b'] });
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

  const correct = quiz.filter((q: any, i: number) => answers[i]?.startsWith(q.correct)).length;
  const total = quiz.length;
  const pct = Math.round((correct / total) * 100);

  const gradeInfo = pct >= 90 ? { label: 'Отлично', color: 'text-emerald-600', bg: 'bg-emerald-50' }
    : pct >= 70 ? { label: 'Хорошо', color: 'text-brand-600', bg: 'bg-brand-50' }
    : pct >= 50 ? { label: 'Удовлетворительно', color: 'text-amber-600', bg: 'bg-amber-50' }
    : { label: 'Нужно подтянуть', color: 'text-rose-600', bg: 'bg-rose-50' };

  // Fullscreen mode
  if (fsOpen && quiz) {
    const fsQ = quiz[fsIdx];
    const fsTotal = quiz.length;
    const fsCorrect = quiz.filter((q: any, i: number) => fsAnswers[i]?.startsWith(q.correct)).length;

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
      <div className="fixed inset-0 z-50 bg-slate-900 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-slate-700">
          <span className="text-white font-semibold text-lg">StudyForge — Тест для аудитории</span>
          <button onClick={fsExit} className="flex items-center gap-1.5 text-white/70 hover:text-white transition text-sm">
            <Minimize2 className="w-4 h-4" />Выйти
          </button>
        </div>

        {!fsSubmitted ? (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-8 py-12">
            <p className="text-slate-400 text-2xl mb-6">Вопрос {fsIdx + 1} / {fsTotal}</p>
            <p className="text-white text-3xl font-bold text-center max-w-3xl mx-auto mb-12">{fsQ.question}</p>
            <div className="grid grid-cols-2 gap-4 max-w-3xl w-full">
              {fsQ.options?.map((opt: string, j: number) => {
                const selected = fsAnswers[fsIdx] === opt;
                return (
                  <div key={j} onClick={() => fsSelect(opt)}
                    className={'rounded-2xl p-6 text-xl cursor-pointer transition border ' +
                      (selected ? 'bg-brand-600 border-brand-500 text-white' : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700 hover:border-brand-500')}>
                    {opt}
                  </div>
                );
              })}
            </div>
            {fsAnswers[fsIdx] && (
              <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                onClick={fsNext}
                className="mt-10 px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-lg font-medium transition">
                {fsIdx + 1 < fsTotal ? 'Следующий вопрос →' : 'Завершить тест'}
              </motion.button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center px-8 py-12">
            <p className="text-4xl font-bold text-white mb-2">Правильных ответов: {fsCorrect} из {fsTotal}</p>
            <p className="text-slate-400 text-lg mb-10">{Math.round((fsCorrect / fsTotal) * 100)}%</p>
            <div className="max-w-3xl w-full space-y-4">
              {quiz.map((q: any, i: number) => {
                const isCorrect = fsAnswers[i]?.startsWith(q.correct);
                return (
                  <div key={i} className={'rounded-xl p-5 border ' + (isCorrect ? 'bg-emerald-900/30 border-emerald-700' : 'bg-rose-900/20 border-rose-800')}>
                    <p className="text-white font-medium mb-2">{i + 1}. {q.question}</p>
                    <p className={isCorrect ? 'text-emerald-400 text-sm' : 'text-rose-400 text-sm'}>
                      {isCorrect ? '✓ Верно' : `✗ Правильный ответ: ${q.correct}) ${q.options?.find((o: string) => o.startsWith(q.correct))?.replace(/^[A-D]\)\s*/, '') || q.correct}`}
                    </p>
                  </div>
                );
              })}
            </div>
            <button onClick={fsExit}
              className="mt-8 px-6 py-2.5 bg-white text-slate-900 rounded-lg font-medium hover:bg-slate-100 transition">
              Закрыть
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      {!submitted && (
        <button onClick={() => setFsOpen(true)}
          className="absolute top-0 right-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-brand-600 border border-brand-200 hover:bg-brand-50 transition">
          <Maximize2 className="w-3.5 h-3.5" />Показать аудитории
        </button>
      )}

      {submitted && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className={'card p-5 mb-6 flex items-center justify-between ' + gradeInfo.bg}>
          <div>
            <p className={'font-bold text-lg ' + gradeInfo.color}>{correct} из {total} — {gradeInfo.label}</p>
            <p className="text-slate-500 text-sm">{pct}% правильных ответов</p>
          </div>
          <button onClick={handleRetry}
            className="flex items-center gap-1.5 px-4 py-2 bg-white rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition border border-slate-200">
            <RotateCcw className="w-3.5 h-3.5" />Пройти снова
          </button>
        </motion.div>
      )}

      <div className="space-y-4">
        {quiz.map((q: any, i: number) => {
          const selected = answers[i];
          const isCorrect = selected?.startsWith(q.correct);
          const isWrong = submitted && selected && !isCorrect;

          return (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="card p-5">
              <p className="font-medium text-slate-900 mb-3">{i+1}. {q.question}</p>
              <div className="space-y-2">
                {q.options?.map((opt: string, j: number) => {
                  const isSelected = selected === opt;
                  const isCorrectOpt = submitted && opt.startsWith(q.correct);
                  const isWrongOpt = submitted && isSelected && !isCorrect;

                  let cls = 'p-3 rounded-lg text-sm cursor-pointer transition border ';
                  if (!submitted) {
                    cls += isSelected ? 'bg-brand-50 border-brand-300 text-slate-900' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300';
                  } else if (isCorrectOpt) {
                    cls += 'bg-emerald-50 border-emerald-300 text-emerald-800';
                  } else if (isWrongOpt) {
                    cls += 'bg-rose-50 border-rose-300 text-rose-800 line-through';
                  } else {
                    cls += 'bg-slate-50 border-slate-100 text-slate-400';
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
                <p className="mt-3 text-sm text-slate-500 italic border-t border-slate-100 pt-3">💡 {q.explanation}</p>
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
