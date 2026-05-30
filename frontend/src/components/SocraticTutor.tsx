import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, HelpCircle, Loader2, Sparkles } from 'lucide-react';
import { sendSocraticChat } from '../api/career';
import toast from 'react-hot-toast';

interface SocraticTutorProps {
  paragraphText: string;
  profession: string;
  onClose: () => void;
}

export default function SocraticTutor({ paragraphText, profession, onClose }: SocraticTutorProps) {
  const [chatMessages, setChatMessages] = useState<{ role: 'assistant' | 'user'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [turnsLeft, setTurnsLeft] = useState(5);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial friendly question from Socrates
    setChatMessages([
      {
        role: 'assistant',
        content: `Приветствую тебя, искатель знаний! 🏛️\n\nЯ Сократ, твой ИИ-проводник. Я внимательно прочитал этот фрагмент теории и не собираюсь давать тебе готовых ответов. Вместо этого я хочу помочь тебе дойти до сути самому.\n\nКакая мысль в этом абзаце кажется тебе наиболее туманной или спорной?`
      }
    ]);
  }, [paragraphText]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = async () => {
    if (!input.trim() || sending || turnsLeft <= 0) return;

    const userText = input;
    setInput('');
    const nextMsgs = [...chatMessages, { role: 'user' as const, content: userText }];
    setChatMessages(nextMsgs);
    setSending(true);
    setTurnsLeft(t => t - 1);

    try {
      const reply = await sendSocraticChat(
        paragraphText,
        profession,
        userText,
        nextMsgs
      );
      setChatMessages(prev => [...prev, { role: 'assistant' as const, content: reply }]);
    } catch (e) {
      console.error(e);
      toast.error('Ошибка связи с Сократом.');
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/20">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-violet-650/10 dark:bg-violet-600/20 rounded-xl flex items-center justify-center border border-violet-500/20">
            <HelpCircle className="w-4.5 h-4.5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <span className="text-[9px] font-black text-violet-600 dark:text-violet-400 uppercase tracking-widest block">Socratic Micro-Tutor</span>
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">Диалог с Сократом</h3>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-400 hover:text-slate-650 dark:hover:text-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Paragraph context overview */}
      <div className="p-4 bg-slate-100/50 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-850 text-[10px] text-slate-500 dark:text-slate-400 italic leading-relaxed line-clamp-3">
        <span className="font-bold text-slate-700 dark:text-slate-300 not-italic block mb-0.5">Разбираемый фрагмент теории:</span>
        "{paragraphText}"
      </div>

      {/* Chat pane */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50 dark:bg-slate-900">
        {chatMessages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-2.5 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-6.5 h-6.5 bg-violet-50 dark:bg-violet-950/50 border border-violet-100 dark:border-violet-500/20 rounded-lg flex items-center justify-center shrink-0 text-xs shadow-sm">
                🏛️
              </div>
            )}
            <div className={`p-3 rounded-2xl text-[11px] leading-relaxed border ${
              msg.role === 'user'
                ? 'bg-violet-600 border-violet-500 text-white rounded-tr-none shadow-sm'
                : 'bg-white dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-tl-none whitespace-pre-line shadow-sm'
            }`}>
              {msg.content}
            </div>
          </motion.div>
        ))}

        {sending && (
          <div className="flex gap-2.5 max-w-[85%]">
            <div className="w-6.5 h-6.5 bg-violet-50 dark:bg-violet-950/50 border border-violet-100 dark:border-violet-500/20 rounded-lg flex items-center justify-center shrink-0 text-xs shadow-sm">
              🏛️
            </div>
            <div className="p-3 bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 rounded-2xl rounded-tl-none flex items-center gap-1.5 shadow-sm">
              <Loader2 className="w-3 h-3 animate-spin text-violet-650 dark:text-violet-400" />
              <span className="text-[9px]">Сократ подбирает аналогию...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Footer input */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-950/20">
        {turnsLeft <= 0 ? (
          <p className="text-center text-[10px] text-slate-450 dark:text-slate-500 italic py-2">
            🏛️ «Мудрость начинается с удивления». Наш диалог по этому вопросу завершен. Пора продолжить изучение курса!
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between items-center px-1 text-[9px] text-slate-450 dark:text-slate-500 font-semibold">
              <span>Сократовский метод ведения мысли</span>
              <span>Осталось реплик: {turnsLeft}</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                disabled={sending}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                placeholder="Задайте вопрос или изложите свое сомнение..."
                className="flex-1 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-550 focus:outline-none focus:border-violet-500/40"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="p-2 bg-violet-650 dark:bg-violet-600 hover:bg-violet-750 text-white rounded-xl transition flex items-center justify-center shrink-0 shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
