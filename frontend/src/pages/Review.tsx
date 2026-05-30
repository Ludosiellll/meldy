import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import { CheckCircle2, Zap } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSound } from '../hooks/useSound';
import { getDueCards, updateCardProgress } from '../api/flashcards';
import { updateQuestProgress, recordStudyActivity } from '../api/quests';

function CircularProgress({ value, size = 100, strokeWidth = 8, isDark = false }: { value: number; size?: number; strokeWidth?: number; isDark?: boolean }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={isDark ? '#334155' : '#e2e8f0'} strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
    </svg>
  );
}

export default function Review() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isDark } = (window as any).__useTheme?.() ?? { isDark: document.documentElement.classList.contains('dark') };
  const { playFlipSound, playSuccessSound } = useSound();
  const [cards, setCards] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0 });
  const [done, setDone] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadCards = () => {
    if (!user?.id) return;
    setLoading(true);
    getDueCards(user.id)
      .then(data => { setCards(data); setIdx(0); setRevealed(false); setSessionStats({ correct: 0, wrong: 0 }); setDone(false); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadCards(); }, [user?.id]);

  const handleReveal = () => {
    if (!revealed) {
      playFlipSound();
      setRevealed(true);
    }
  };

  const handleAnswer = (quality: number) => {
    if (!cards[idx]) return;
    
    const currentCard = cards[idx];

    // 1. Сразу (синхронно) обновляем UI
    if (quality >= 3) {
      setSessionStats(p => ({ ...p, correct: p.correct + 1 }));
    } else {
      setSessionStats(p => ({ ...p, wrong: p.wrong + 1 }));
    }

    if (idx + 1 >= cards.length) {
      playSuccessSound();
      setDone(true);
    } else {
      setIdx(p => p + 1);
      setRevealed(false);
    }

    // 2. Фоновые (асинхронные) запросы в Supabase, не блокирующие поток UI
    if (currentCard.id) {
      updateCardProgress(currentCard.id, quality).catch(err => console.error("Error updating card progress:", err));
    }
    if (user?.id) {
      updateQuestProgress(user.id, 'review', 1).catch(err => console.error("Error updating quest progress:", err));
      recordStudyActivity(user.id, 1, 0).catch(err => console.error("Error recording study activity:", err));
    }
  };

  if (loading) return (
    <div className="p-4 md:p-6 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // No cards due
  if (cards.length === 0) return (
    <div className="p-4 md:p-6 text-center py-10 md:py-20">
      <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Отличная работа!</h2>
      <p className="text-slate-500 dark:text-slate-400 mb-6">На сегодня карточек нет. Приходите завтра!</p>
      <div className="flex justify-center gap-3 flex-wrap">
        <button onClick={() => navigate('/library')} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition">
          В библиотеку
        </button>
        <button onClick={() => navigate('/analyze')} className="px-5 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium transition">
          Новый анализ
        </button>
      </div>
    </div>
  );

  // Session done
  if (done) {
    const total = sessionStats.correct + sessionStats.wrong;
    const pct = total > 0 ? Math.round((sessionStats.correct / total) * 100) : 0;
    const darkMode = document.documentElement.classList.contains('dark');
    return (
      <div className="p-4 md:p-6 text-center py-10 md:py-16">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Сессия завершена! 🎉</h2>
        <div className="relative inline-block mb-4">
          <CircularProgress value={pct} size={120} strokeWidth={10} isDark={darkMode} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">{pct}%</span>
          </div>
        </div>
        <p className="text-slate-500 dark:text-slate-400 mb-1">Правильно: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{sessionStats.correct}</span> из {total}</p>
        <p className="text-slate-400 dark:text-slate-500 text-sm mb-8">Карточки будут показаны снова по расписанию spaced repetition</p>
        <div className="flex justify-center gap-3 flex-wrap">
          <button onClick={loadCards} className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition">
            <Zap className="w-4 h-4" />Повторить ещё
          </button>
          <button onClick={() => navigate('/dashboard')} className="px-5 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium transition">
            На дашборд
          </button>
        </div>
      </div>
    );
  }

  const card = cards[idx];

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 mb-2">
          <span>{idx + 1} / {cards.length} карточек</span>
          <span>{sessionStats.correct} ✓ · {sessionStats.wrong} ✗</span>
        </div>
        <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${((idx) / cards.length) * 100}%` }} />
        </div>
      </div>

      {/* Card */}
      <motion.div
        key={idx}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="card min-h-[280px] p-6 md:p-10 flex flex-col items-center justify-center cursor-pointer relative active:scale-[0.99] transition-all shadow-lg hover:shadow-xl border border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-900/80 backdrop-blur-md"
        onClick={handleReveal}
      >
        <span className="text-xs sm:text-sm font-black uppercase text-indigo-500 dark:text-indigo-400 tracking-wider mb-4">Вопрос</span>
        <div className="text-lg sm:text-xl md:text-2xl font-black text-slate-900 dark:text-slate-100 text-center leading-snug max-w-xl px-2 mb-6 markdown-content">
          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{card.question}</ReactMarkdown>
        </div>

        {revealed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
            className="w-full border-t border-slate-100 dark:border-slate-800/80 pt-6 mt-2"
          >
            <span className="text-xs sm:text-sm font-black uppercase text-emerald-500 tracking-wider mb-3 block text-center">Ответ</span>
            <div className="text-slate-800 dark:text-slate-200 text-sm sm:text-base md:text-lg font-semibold text-center leading-relaxed max-w-xl mx-auto px-2 whitespace-pre-line markdown-content">
              <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{card.answer}</ReactMarkdown>
            </div>
          </motion.div>
        )}

        {!revealed && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 animate-pulse font-medium">Нажмите, чтобы открыть ответ</p>
        )}
      </motion.div>

      {/* Actions */}
      <div className="mt-6">
        {!revealed ? (
          <button
            onClick={handleReveal}
            className="w-full h-14 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl font-semibold transition text-base"
          >
            Показать ответ
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            <button
              onClick={() => handleAnswer(1)}
              className="h-14 md:h-12 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 rounded-xl font-medium transition text-sm"
            >
              Не знал 😕
            </button>
            <button
              onClick={() => handleAnswer(3)}
              className="h-14 md:h-12 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 border border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 rounded-xl font-medium transition text-sm"
            >
              Затруднялся 🤔
            </button>
            <button
              onClick={() => handleAnswer(5)}
              className="h-14 md:h-12 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 rounded-xl font-medium transition text-sm"
            >
              Знал! 😎
            </button>
          </div>
        )}
      </div>
    </div>
  );
}