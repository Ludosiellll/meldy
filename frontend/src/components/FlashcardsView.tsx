import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, GraduationCap, ArrowLeft, Check, X, Copy } from 'lucide-react';

export default function FlashcardsView({ data }: { data: any }) {
  const cards = data?.flashcards;

  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [studyMode, setStudyMode] = useState(false);
  const [studyIdx, setStudyIdx] = useState(0);
  const [studyRevealed, setStudyRevealed] = useState(false);
  const [studyResults, setStudyResults] = useState<Record<number, boolean>>({});
  const [studyDone, setStudyDone] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(-1);

  const toggle = (i: number) => setRevealed({ ...revealed, [i]: !revealed[i] });
  const revealAll = () => {
    if (!cards || !Array.isArray(cards)) return;
    const r: Record<number, boolean> = {};
    cards.forEach((_: any, i: number) => { r[i] = true; });
    setRevealed(r);
  };
  const hideAll = () => setRevealed({});

  const startStudy = () => {
    setStudyMode(true);
    setStudyIdx(0);
    setStudyRevealed(false);
    setStudyResults({});
    setStudyDone(false);
  };

  const exitStudy = () => setStudyMode(false);

  const markCard = (known: boolean) => {
    if (!cards) return;
    const next = { ...studyResults, [studyIdx]: known };
    if (studyIdx + 1 < cards.length) {
      setStudyResults(next);
      setStudyIdx(studyIdx + 1);
      setStudyRevealed(false);
    } else {
      setStudyResults(next);
      setStudyDone(true);
    }
  };

  if (!cards || !Array.isArray(cards)) return <p className="text-slate-400">Нет данных</p>;

  // Study mode
  if (studyMode) {
    const knownCount = Object.values(studyResults).filter(Boolean).length;

    if (studyDone) {
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="card p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2">
            Результат: {knownCount} из {cards.length}
          </h3>
          <p className="text-slate-500 mb-6">
            {knownCount === cards.length ? 'Отлично! Вы знаете все карточки!' :
             knownCount >= cards.length / 2 ? 'Неплохо, но есть что подтянуть.' :
             'Стоит повторить материал ещё раз.'}
          </p>
          <div className="flex justify-center gap-3">
            <button onClick={startStudy}
              className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium transition">
              Пройти снова
            </button>
            <button onClick={exitStudy}
              className="px-5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium transition">
              К списку
            </button>
          </div>
        </motion.div>
      );
    }

    const card = cards[studyIdx];
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={exitStudy}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition">
            <ArrowLeft className="w-4 h-4" />К списку
          </button>
          <span className="text-sm text-slate-400">{studyIdx + 1} / {cards.length}</span>
        </div>

        <div className="card p-8 min-h-[260px] flex flex-col justify-center">
          <p className="text-lg font-semibold text-slate-900 text-center mb-6">{card.question}</p>
          <AnimatePresence mode="wait">
            {studyRevealed ? (
              <motion.p key="answer" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="text-slate-700 text-center border-t border-slate-100 pt-4">
                {card.answer}
              </motion.p>
            ) : (
              <motion.button key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                onClick={() => setStudyRevealed(true)}
                className="mx-auto px-5 py-2 text-sm text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 transition">
                Показать ответ
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {studyRevealed && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 mt-4">
            <button onClick={() => markCard(true)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium hover:bg-emerald-100 transition">
              <Check className="w-5 h-5" />Знаю
            </button>
            <button onClick={() => markCard(false)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-medium hover:bg-rose-100 transition">
              <X className="w-5 h-5" />Ещё раз
            </button>
          </motion.div>
        )}
      </motion.div>
    );
  }

  // Normal mode
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={revealAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition border border-slate-200">
          <Eye className="w-3.5 h-3.5" />Показать все
        </button>
        <button onClick={hideAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition border border-slate-200">
          <EyeOff className="w-3.5 h-3.5" />Скрыть все
        </button>
        <button onClick={startStudy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 transition border border-brand-200">
          <GraduationCap className="w-3.5 h-3.5" />Начать обучение
        </button>
      </div>

      <div className="space-y-3">
        {cards.map((c: any, i: number) => (
          <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            className="card p-4 cursor-pointer hover:border-slate-300 transition group"
            onClick={() => toggle(i)}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-slate-900 mb-2">Q{i+1}: {c.question}</p>
              <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(`Q: ${c.question}\nA: ${c.answer}`); setCopiedIdx(i); setTimeout(() => setCopiedIdx(-1), 1500); }}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition p-1 text-slate-300 hover:text-slate-500">
                {copiedIdx === i ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {revealed[i] ? (
              <p className="text-slate-700 text-sm border-t border-slate-100 pt-2">{c.answer}</p>
            ) : (
              <p className="text-slate-400 text-sm border-t border-slate-100 pt-2 italic">Нажмите, чтобы увидеть ответ</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
