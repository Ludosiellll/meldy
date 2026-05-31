import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Send, HelpCircle, Loader2, BookOpen, MessageCircle } from 'lucide-react';
import { sendSocraticChat } from '../api/career';
import ReactMarkdown from 'react-markdown';
import toast from 'react-hot-toast';

interface SocraticTutorProps {
  paragraphText: string;
  profession: string;
  isBeginnerLevel?: boolean;
  onClose: () => void;
}

export default function SocraticTutor({
  paragraphText,
  profession,
  isBeginnerLevel = false,
  onClose,
}: SocraticTutorProps) {
  const [chatMessages, setChatMessages] = useState<{ role: 'assistant' | 'user'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingExplanation, setLoadingExplanation] = useState(true);
  const [turnsLeft, setTurnsLeft] = useState(7);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Notify ForgeyAssistant to hide when we open
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('socratic_chat_open'));
    return () => {
      window.dispatchEvent(new CustomEvent('socratic_chat_close'));
    };
  }, []);

  // Load initial explanation on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingExplanation(true);
    setChatMessages([]);

    sendSocraticChat(paragraphText, profession, '', [], 'explain', isBeginnerLevel)
      .then((reply) => {
        if (cancelled) return;
        setChatMessages([{ role: 'assistant', content: reply }]);
      })
      .catch(() => {
        if (cancelled) return;
        setChatMessages([{
          role: 'assistant',
          content: `📖 **Тема: ${profession}**\n\nЯ загрузил этот фрагмент теории и готов разобрать его вместе с тобой!\n\nЗадавай любые вопросы — объясню простыми словами, с примерами и аналогиями.`,
        }]);
      })
      .finally(() => {
        if (!cancelled) setLoadingExplanation(false);
      });

    return () => { cancelled = true; };
  }, [paragraphText, profession, isBeginnerLevel]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, loadingExplanation]);

  const handleSend = async () => {
    if (!input.trim() || sending || turnsLeft <= 0 || loadingExplanation) return;

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
        nextMsgs,
        'socratic',
        isBeginnerLevel
      );
      setChatMessages(prev => [...prev, { role: 'assistant' as const, content: reply }]);
    } catch (e) {
      console.error(e);
      toast.error('Ошибка связи с наставником.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    window.dispatchEvent(new CustomEvent('socratic_chat_close'));
    onClose();
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
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/20 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-violet-600/10 dark:bg-violet-600/20 rounded-xl flex items-center justify-center border border-violet-500/20">
            <HelpCircle className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <span className="text-[9px] font-black text-violet-600 dark:text-violet-400 uppercase tracking-widest block">
              {isBeginnerLevel ? 'ИИ-Наставник для новичков' : 'Socratic Micro-Tutor'}
            </span>
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
              {isBeginnerLevel ? 'Персональный объяснятор' : 'Диалог с наставником'}
            </h3>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Paragraph context */}
      <div className="px-4 py-3 bg-violet-50/60 dark:bg-violet-950/20 border-b border-violet-100 dark:border-violet-900/30 text-[10px] text-slate-500 dark:text-slate-400 italic leading-relaxed max-h-20 overflow-y-auto shrink-0">
        <span className="font-bold text-violet-700 dark:text-violet-300 not-italic">📖 Разбираемый фрагмент: </span>
        "{paragraphText}"
      </div>

      {/* Chat pane */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50 dark:bg-slate-900">

        {/* Loading initial explanation */}
        {loadingExplanation && (
          <div className="flex gap-2.5 max-w-[90%]">
            <div className="w-7 h-7 bg-violet-50 dark:bg-violet-950/50 border border-violet-100 dark:border-violet-500/20 rounded-lg flex items-center justify-center shrink-0 text-sm">
              📖
            </div>
            <div className="p-3.5 bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl rounded-tl-none shadow-sm flex flex-col gap-2 flex-1">
              <div className="flex items-center gap-2 text-[11px] text-violet-600 dark:text-violet-400 font-semibold">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Наставник изучает тему и готовит объяснение...
              </div>
              <div className="space-y-1.5">
                <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse w-full" />
                <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse w-4/5" />
                <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse w-3/4" />
              </div>
            </div>
          </div>
        )}

        {/* Chat messages */}
        {chatMessages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-2.5 ${msg.role === 'user' ? 'ml-auto flex-row-reverse max-w-[85%]' : 'max-w-[92%]'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 bg-violet-50 dark:bg-violet-950/50 border border-violet-100 dark:border-violet-500/20 rounded-lg flex items-center justify-center shrink-0 text-sm mt-0.5">
                {isBeginnerLevel ? '🎓' : '🏛️'}
              </div>
            )}
            <div className={`p-3.5 rounded-2xl text-[11px] leading-relaxed border shadow-sm ${
              msg.role === 'user'
                ? 'bg-violet-600 border-violet-500 text-white rounded-tr-none'
                : 'bg-white dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-tl-none prose prose-[11px] dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-strong:text-slate-900 dark:prose-strong:text-white'
            }`}>
              {msg.role === 'user'
                ? msg.content
                : <ReactMarkdown>{msg.content}</ReactMarkdown>
              }
            </div>
          </motion.div>
        ))}

        {sending && (
          <div className="flex gap-2.5 max-w-[85%]">
            <div className="w-7 h-7 bg-violet-50 dark:bg-violet-950/50 border border-violet-100 dark:border-violet-500/20 rounded-lg flex items-center justify-center shrink-0 text-sm">
              {isBeginnerLevel ? '🎓' : '🏛️'}
            </div>
            <div className="p-3 bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 rounded-2xl rounded-tl-none flex items-center gap-1.5 shadow-sm">
              <Loader2 className="w-3 h-3 animate-spin text-violet-600 dark:text-violet-400" />
              <span className="text-[9px]">
                {isBeginnerLevel ? 'Наставник подбирает простое объяснение...' : 'Сократ подбирает аналогию...'}
              </span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Footer input */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-950/20 shrink-0">
        {turnsLeft <= 0 ? (
          <p className="text-center text-[10px] text-slate-400 dark:text-slate-500 italic py-2">
            {isBeginnerLevel
              ? '🎓 Отличная работа! Ты задал много вопросов. Возвращайся к теории и продолжай!'
              : '🏛️ «Мудрость начинается с удивления». Наш диалог завершён. Пора продолжить курс!'}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between items-center px-1 text-[9px] text-slate-400 dark:text-slate-500 font-semibold">
              <span className="flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                {isBeginnerLevel ? 'Задай любой вопрос по теме' : 'Сократовский метод ведения мысли'}
              </span>
              <span>Реплик: {turnsLeft}</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                disabled={sending || loadingExplanation}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                placeholder={loadingExplanation
                  ? 'Подождите, загружается объяснение...'
                  : isBeginnerLevel
                    ? 'Что непонятно? Задавай любой вопрос...'
                    : 'Задайте вопрос или изложите сомнение...'}
                className="flex-1 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-violet-500/60 transition disabled:opacity-60"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending || loadingExplanation}
                className="p-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition flex items-center justify-center shrink-0 shadow-sm disabled:opacity-40"
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
