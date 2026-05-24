import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Zap } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getDueCards, updateCardProgress } from '../api/flashcards';
import { updateQuestProgress, recordStudyActivity } from '../api/quests';

function CircularProgress({ value, size = 100, strokeWidth = 8 }: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
    </svg>
  );
}

export default function Review() {
  const { user } = useAuth();
  const navigate = useNavigate();
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

  const handleAnswer = async (quality: number) => {
    if (processing || !cards[idx]) return;
    setProcessing(true);
    try {
      await updateCardProgress(cards[idx].id, quality);
      if (user?.id) {
        await updateQuestProgress(user.id, 'review', 1);
        await recordStudyActivity(user.id, 1, 0);
      }
      if (quality >= 3) setSessionStats(p => ({ ...p, correct: p.correct + 1 }));
      else setSessionStats(p => ({ ...p, wrong: p.wrong + 1 }));

      if (idx + 1 >= cards.length) setDone(true);
      else { setIdx(p => p + 1); setRevealed(false); }
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // No cards due
  if (cards.length === 0) return (
    <div className="p-6 text-center py-20">
      <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
      <h2 className="text-xl font-bold text-slate-900 mb-2">Отличная работа!</h2>
      <p className="text-slate-500 mb-6">На сегодня карточек нет. Приходите завтра!</p>
      <div className="flex justify-center gap-3">
        <button onClick={() => navigate('/library')} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition">
          В библиотеку
        </button>
        <button onClick={() => navigate('/analyze')} className="px-5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium transition">
          Новый анализ
        </button>
      </div>
    </div>
  );

  // Session done
  if (done) {
    const total = sessionStats.correct + sessionStats.wrong;
    const pct = total > 0 ? Math.round((sessionStats.correct / total) * 100) : 0;
    return (
      <div className="p-6 text-center py-16">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Сессия завершена! 🎉</h2>
        <div className="relative inline-block mb-4">
          <CircularProgress value={pct} size={120} strokeWidth={10} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold text-slate-800">{pct}%</span>
          </div>
        </div>
        <p className="text-slate-500 mb-1">Правильно: <span className="font-semibold text-emerald-600">{sessionStats.correct}</span> из {total}</p>
        <p className="text-slate-400 text-sm mb-8">Карточки будут показаны снова по расписанию spaced repetition</p>
        <div className="flex justify-center gap-3">
          <button onClick={loadCards} className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition">
            <Zap className="w-4 h-4" />Повторить ещё
          </button>
          <button onClick={() => navigate('/dashboard')} className="px-5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium transition">
            На дашборд
          </button>
        </div>
      </div>
    );
  }

  const card = cards[idx];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
          <span>{idx + 1} / {cards.length} карточек</span>
          <span>{sessionStats.correct} ✓ · {sessionStats.wrong} ✗</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${((idx) / cards.length) * 100}%` }} />
        </div>
      </div>

      {/* Card */}
      <motion.div
        key={idx}
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        className="card min-h-48 p-8 flex flex-col items-center justify-center cursor-pointer"
        onClick={() => !revealed && setRevealed(true)}
      >
        <span className="text-xs uppercase text-slate-400 tracking-wider mb-3">Вопрос</span>
        <p className="text-xl font-medium text-slate-900 text-center mb-6">{card.question}</p>

        {revealed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full border-t border-slate-100 pt-6">
            <span className="text-xs uppercase text-emerald-500 tracking-wider mb-2 block text-center">Ответ</span>
            <p className="text-slate-700 text-center">{card.answer}</p>
          </motion.div>
        )}
      </motion.div>

      {/* Actions */}
      <div className="mt-6">
        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition"
          >
            Показать ответ
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => handleAnswer(1)}
              className="h-12 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl font-medium transition"
            >
              Не знал 😕
            </button>
            <button
              onClick={() => handleAnswer(3)}
              className="h-12 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 rounded-xl font-medium transition"
            >
              Затруднялся 🤔
            </button>
            <button
              onClick={() => handleAnswer(5)}
              className="h-12 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl font-medium transition"
            >
              Знал! 😎
            </button>
          </div>
        )}
      </div>
    </div>
  );
}