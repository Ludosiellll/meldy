import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, XCircle, Clock, Zap, RotateCcw, Trophy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { ReviewQuestion } from '../api/career';
import { generateReviewTest, updateModuleReview } from '../api/career';

interface ReviewTestModalProps {
  moduleId: string;
  moduleTitle: string;
  moduleTheory: string;
  practiceType: string;
  courseProfession: string;
  token: string;
  onClose: () => void;
  onComplete: (score: number) => void;
  numQuestions?: number;
}

const TIMER_SECONDS = 90; // 90 sec per question

export default function ReviewTestModal({
  moduleId, moduleTitle, moduleTheory, practiceType,
  courseProfession, token, onClose, onComplete, numQuestions = 3,
}: ReviewTestModalProps) {
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [scores, setScores] = useState<boolean[]>([]);
  const [timer, setTimer] = useState(TIMER_SECONDS);
  const [done, setDone] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadTest();
  }, []);

  useEffect(() => {
    if (!loading && !done && !answered) {
      timerRef.current = setInterval(() => {
        setTimer(t => Math.max(0, t - 1));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading, done, answered, currentIdx]);

  // Time out = wrong answer. Handled here, not inside the setTimer updater, which must stay pure.
  useEffect(() => {
    if (timer === 0 && !loading && !done && !answered) handleAnswer(null);
  }, [timer, loading, done, answered]);

  async function loadTest() {
    setLoading(true);
    try {
      const data = await generateReviewTest(moduleId, moduleTitle, moduleTheory, practiceType, numQuestions);
      setQuestions(data.questions || []);
    } catch {
      // fallback empty
    }
    setLoading(false);
  }

  function handleAnswer(choice: string | null) {
    if (answered) return;
    clearInterval(timerRef.current!);
    setSelected(choice);
    setAnswered(true);
    const q = questions[currentIdx];
    const isCorrect = choice !== null && choice.startsWith(q.correct);
    // One result per question, so a repeated call cannot add an extra answer.
    setScores(s => {
      const next = [...s];
      next[currentIdx] = isCorrect;
      return next;
    });
  }

  async function handleNext() {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelected(null);
      setAnswered(false);
      setTimer(TIMER_SECONDS);
    } else {
      // finish: handleAnswer has already recorded the last answer in scores
      const correct = scores.filter(Boolean).length;
      const total = questions.length;
      const pct = Math.round((correct / total) * 100);
      setFinalScore(pct);
      setDone(true);
      setSaving(true);
      try {
        await updateModuleReview(moduleId, courseProfession, pct, token);
      } catch { /* silent */ }
      setSaving(false);
      onComplete(pct);
    }
  }

  const q = questions[currentIdx];
  const timerPct = (timer / TIMER_SECONDS) * 100;
  const timerColor = timer > 45 ? '#22c55e' : timer > 20 ? '#f59e0b' : '#ef4444';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-indigo-600/10 dark:bg-indigo-600/30 rounded-xl flex items-center justify-center">
                <RotateCcw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">🔁 Spaced Repetition</p>
                <h3 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 truncate max-w-[260px]">{moduleTitle}</h3>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
              <X className="w-4 h-4 text-slate-400 dark:text-slate-400" />
            </button>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Генерируем вопросы...</p>
              </div>
            ) : done ? (
              /* Results screen */
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-5 py-4"
              >
                <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black
                  ${finalScore >= 70 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-2 border-emerald-500/40' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border-2 border-rose-500/40'}`}>
                  {finalScore}%
                </div>
                <div className="text-center">
                  <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                    {finalScore >= 70 ? '🎉 Отлично! Материал усвоен!' : '📚 Нужно ещё поработать'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {finalScore >= 70
                      ? `Следующее повторение запланировано автоматически`
                      : 'Рекомендуем перечитать теорию и повторить через 1 день'}
                  </p>
                </div>
                {saving && <p className="text-xs text-indigo-600 dark:text-indigo-400 animate-pulse">Сохраняем прогресс...</p>}
                <div className="flex gap-3 w-full mt-2">
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-650 dark:text-slate-300 rounded-2xl text-xs font-bold transition"
                  >
                    Закрыть
                  </button>
                </div>
              </motion.div>
            ) : (
              <>
                {/* Progress & Timer */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-wrap gap-1">
                    {questions.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${
                          i < currentIdx
                            ? (scores[i] ? 'bg-emerald-500' : 'bg-rose-500')
                            : i === currentIdx ? 'bg-indigo-500 w-4' : 'bg-slate-200 dark:bg-slate-700'
                        } ${questions.length > 10 ? 'w-2.5' : 'w-5'}`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" style={{ color: timerColor }} />
                    <span className="text-xs font-bold tabular-nums" style={{ color: timerColor }}>{timer}с</span>
                  </div>
                </div>

                {/* Timer bar */}
                <div className="h-1 bg-slate-100 dark:bg-slate-800 rounded-full mb-5 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: timerColor }}
                    animate={{ width: `${timerPct}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>

                {/* Question */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentIdx}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    className="space-y-4"
                  >
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-relaxed">
                      <span className="text-indigo-600 dark:text-indigo-400 font-black">Q{currentIdx + 1}.</span> {q?.question}
                    </p>

                    {/* Options */}
                    <div className="space-y-2">
                      {q?.options.map((opt, oi) => {
                        const letter = opt.split(')')[0].trim();
                        const isCorrect = q.correct === letter;
                        const isSelected = selected?.startsWith(letter);
                        let bg = 'bg-slate-50/50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-indigo-600 dark:hover:border-indigo-500 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/30';
                        if (answered) {
                          if (isCorrect) bg = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-300';
                          else if (isSelected && !isCorrect) bg = 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-700 dark:text-rose-300';
                          else bg = 'bg-slate-100/40 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-50 text-slate-400 dark:text-slate-400';
                        }
                        return (
                          <button
                            key={oi}
                            disabled={answered}
                            onClick={() => handleAnswer(opt)}
                            className={`w-full text-left p-3 rounded-xl border text-xs font-semibold transition-all ${bg}`}
                          >
                            <span className="flex items-center gap-2">
                              {answered && isCorrect && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />}
                              {answered && isSelected && !isCorrect && <XCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />}
                              <span className="text-slate-855 dark:text-slate-200">{opt}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Explanation */}
                    {answered && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
                      >
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">Объяснение: </span>
                        <ReactMarkdown>{q?.explanation}</ReactMarkdown>
                      </motion.div>
                    )}

                    {answered && (
                      <motion.button
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        onClick={handleNext}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2"
                      >
                        {currentIdx < questions.length - 1 ? 'Следующий вопрос →' : (
                          <><Trophy className="w-4 h-4" /> Завершить тест</>
                        )}
                      </motion.button>
                    )}
                  </motion.div>
                </AnimatePresence>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
