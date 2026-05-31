import { useState } from 'react';
import { FlashcardsInfo, Flashcard } from '../types/index';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, GraduationCap, ArrowLeft, Check, X, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function FlashcardsView({ data }: { data: FlashcardsInfo }) {
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
    cards.forEach((_: Flashcard, i: number) => { r[i] = true; });
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
          <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-center mx-auto mb-4 border border-emerald-100 dark:border-emerald-900/30">
            <GraduationCap className="w-8 h-8 text-emerald-500 dark:text-emerald-400" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Результат: {knownCount} из {cards.length}
          </h3>
          <p className="text-slate-500 dark:text-slate-400 mb-6">
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
              className="px-5 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium transition">
              К списку
            </button>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 mb-2">
          <span>Карточка {studyIdx + 1} из {cards.length}</span>
          <button onClick={exitStudy} className="hover:text-slate-800 dark:hover:text-slate-200 transition">Выйти</button>
        </div>

        <motion.div key={studyIdx} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card p-8 min-h-[300px] flex flex-col justify-center items-center text-center">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-8">{cards[studyIdx].question}</p>
          
          <AnimatePresence mode="wait">
            {!studyRevealed ? (
              <motion.button 
                key="reveal" 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                onClick={() => setStudyRevealed(true)}
                className="mx-auto px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-medium transition"
              >
                Показать ответ
              </motion.button>
            ) : (
              <motion.div 
                key="answer" 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0 }}
                className="w-full mt-4 pt-6 border-t border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-left markdown-content"
              >
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {cards[studyIdx].answer}
                </ReactMarkdown>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {studyRevealed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <button onClick={() => markCard(true)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition">
              <Check className="w-5 h-5" />Знаю
            </button>
            <button onClick={() => markCard(false)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 text-rose-700 dark:text-rose-400 font-medium hover:bg-rose-100 dark:hover:bg-rose-950/40 transition">
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
        <button onClick={revealAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700">
          <Eye className="w-3.5 h-3.5" />Показать все
        </button>
        <button onClick={hideAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition border border-slate-200 dark:border-slate-700">
          <EyeOff className="w-3.5 h-3.5" />Скрыть все
        </button>
        <button onClick={startStudy}
          className="flex items-center gap-1.5 px-4.5 py-1.5 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-sm ml-auto">
          <GraduationCap className="w-4 h-4" />Начать обучение
        </button>
      </div>

      <div className="space-y-3">
        {cards.map((c: Flashcard, i: number) => (
          <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            className="card p-4 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition group"
            onClick={() => toggle(i)}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Q{i+1}: {c.question}</p>
                <AnimatePresence>
                  {revealed[i] && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }} 
                      animate={{ height: 'auto', opacity: 1 }} 
                      exit={{ height: 0, opacity: 0 }}
                      className="text-slate-700 dark:text-slate-300 text-sm border-t border-slate-100 dark:border-slate-850 pt-3 mt-2 markdown-content text-left"
                    >
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {c.answer}
                      </ReactMarkdown>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  navigator.clipboard.writeText(`Q: ${c.question}\nA: ${c.answer}`); 
                  setCopiedIdx(i); 
                  setTimeout(() => setCopiedIdx(-1), 1500); 
                }} 
                className="shrink-0 opacity-0 group-hover:opacity-100 transition p-1 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400"
              >
                {copiedIdx === i ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {!revealed[i] && (
              <p className="text-slate-400 dark:text-slate-500 text-[13px] border-t border-slate-100 dark:border-slate-800/80 pt-2 italic">Нажмите, чтобы увидеть ответ</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
