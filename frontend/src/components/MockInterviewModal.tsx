import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Award, CheckCircle2, AlertTriangle, MessageSquare, Loader2, Sparkles, Trophy } from 'lucide-react';
import { 
  startMockInterview, respondMockInterview, evaluateMockInterview, 
  MockInterviewEvaluation, saveXPToProfile, CareerProfile 
} from '../api/career';
import confetti from 'canvas-confetti';
import toast from 'react-hot-toast';

interface MockInterviewModalProps {
  userId: string;
  profile: CareerProfile;
  profession: string;
  vacancyTitle: string;
  vacancyCompany: string;
  vacancyRequirements: string;
  completedModulesTitles: string[];
  onClose: () => void;
  onComplete: (score: number) => void;
}

export default function MockInterviewModal({
  userId,
  profile,
  profession,
  vacancyTitle,
  vacancyCompany,
  vacancyRequirements,
  completedModulesTitles,
  onClose,
  onComplete,
}: MockInterviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [chatMessages, setChatMessages] = useState<{ role: 'assistant' | 'user'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [evaluation, setEvaluation] = useState<MockInterviewEvaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initInterview();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const initInterview = async () => {
    setLoading(true);
    try {
      const data = await startMockInterview(
        profession,
        vacancyTitle,
        vacancyCompany,
        vacancyRequirements,
        completedModulesTitles
      );
      setChatMessages([
        { role: 'assistant', content: data.initial_question }
      ]);
    } catch (e) {
      console.error(e);
      toast.error('Не удалось начать собеседование. Попробуйте позже.');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || sending || finished) return;

    const userText = input;
    setInput('');
    const nextMsgs = [...chatMessages, { role: 'user' as const, content: userText }];
    setChatMessages(nextMsgs);
    setSending(true);

    try {
      const data = await respondMockInterview(
        profession,
        vacancyTitle,
        vacancyCompany,
        nextMsgs,
        userText
      );

      setChatMessages(prev => [...prev, { role: 'assistant' as const, content: data.next_question }]);
      if (data.is_finished) {
        setFinished(true);
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка отправки ответа.');
    } finally {
      setSending(false);
    }
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const result = await evaluateMockInterview(
        profession,
        vacancyTitle,
        vacancyCompany,
        chatMessages
      );
      setEvaluation(result);

      // Award XP for completing interview
      const xpReward = result.score >= 80 ? 100 : 50;
      
      // Save results to user profile
      const today = new Date().toISOString().split('T')[0];
      const newInterviews = [...(profile.mock_interviews ?? [])];
      newInterviews.push({
        date: today,
        vacancy: `${vacancyTitle} в ${vacancyCompany}`,
        score: result.score,
        grade: result.grade,
        verdict: result.verdict,
      });

      const updatedProfile = {
        ...profile,
        mock_interviews: newInterviews,
      };

      await saveXPToProfile(userId, updatedProfile, xpReward, 'roleplay');
      
      toast.success(`🎉 Собеседование завершено! Получено +${xpReward} XP!`);
      
      if (result.score >= 80) {
        confetti({ particleCount: 160, spread: 80 });
      }
      onComplete(result.score);
    } catch (e) {
      console.error(e);
      toast.error('Ошибка анализа собеседования.');
    } finally {
      setEvaluating(false);
    }
  };

  const getQuestionNumber = () => {
    const userTurns = chatMessages.filter(m => m.role === 'user').length;
    return Math.min(5, userTurns + 1);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 dark:bg-slate-950/90 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-4xl h-[92vh] sm:h-[88vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-gradient-to-r dark:from-indigo-950/40 dark:to-slate-900">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-600/10 dark:bg-indigo-600/20 rounded-xl flex items-center justify-center border border-indigo-500/20">
                <Award className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block">ИИ-Мок-Собеседование</span>
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-800 dark:text-slate-100 truncate pr-4">{vacancyTitle} в {vacancyCompany}</h3>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Main content split */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left chat panel */}
            <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 min-w-0">
              {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">Связываемся с рекрутером компании {vacancyCompany}...</p>
                </div>
              ) : evaluation ? (
                /* Report Screen */
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center text-center max-w-2xl mx-auto gap-4"
                  >
                    <div className="relative">
                      <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full flex flex-col items-center justify-center font-black text-xl sm:text-2xl border-4
                        ${evaluation.score >= 80 
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                          : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/40'}`}>
                        {evaluation.score}
                        <span className="text-[8px] sm:text-[9px] uppercase tracking-wider font-semibold opacity-60">из 100</span>
                      </div>
                      {evaluation.score >= 80 && (
                        <div className="absolute -bottom-1 -right-1 bg-amber-500 text-slate-950 p-1.5 rounded-full border-2 border-white dark:border-slate-900 animate-bounce">
                          <Trophy className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <h4 className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100">Грейд: {evaluation.grade}</h4>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 font-extrabold uppercase mt-0.5">
                        {evaluation.interview_ready ? '🔥 Рекомендован к найму!' : '📚 Требуется подготовка'}
                      </p>
                    </div>

                    <div className="p-4 sm:p-5 bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/80 rounded-2xl text-xs text-slate-600 dark:text-slate-300 leading-relaxed text-left w-full shadow-sm">
                      <span className="font-extrabold text-indigo-600 dark:text-indigo-400 block mb-1">💬 Вердикт HR-комиссии:</span>
                      {evaluation.verdict}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full text-left mt-2">
                      <div className="p-4 bg-emerald-50 dark:bg-emerald-950/15 border border-emerald-100 dark:border-emerald-500/20 rounded-2xl space-y-2">
                        <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Сильные стороны
                        </span>
                        <ul className="space-y-1.5">
                          {evaluation.strengths.map((s, idx) => (
                            <li key={idx} className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">• {s}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-4 bg-rose-50 dark:bg-rose-950/15 border border-rose-100 dark:border-rose-500/20 rounded-2xl space-y-2">
                        <span className="text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" /> Что нужно подтянуть
                        </span>
                        <ul className="space-y-1.5">
                          {evaluation.weaknesses.map((w, idx) => (
                            <li key={idx} className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">• {w}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <button
                      onClick={onClose}
                      className="mt-4 sm:mt-6 px-8 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-extrabold text-xs rounded-2xl transition-all shadow-lg hover:shadow-indigo-500/20 hover:scale-[1.02] w-full sm:w-auto"
                    >
                      Завершить и закрыть
                    </button>
                  </motion.div>
                </div>
              ) : (
                /* Chat view */
                <>
                  <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                    {chatMessages.map((msg, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 max-w-[85%] sm:max-w-[80%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="w-7 h-7 bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-500/20 rounded-lg flex items-center justify-center shrink-0">
                            <MessageSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          </div>
                        )}
                        <div className={`p-3 sm:p-4 rounded-2xl text-xs leading-relaxed border ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 border-indigo-500 text-white rounded-tr-none'
                            : 'bg-white dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-tl-none shadow-sm'
                        }`}>
                          {msg.content}
                        </div>
                      </motion.div>
                    ))}
                    {sending && (
                      <div className="flex gap-3 max-w-[80%]">
                        <div className="w-7 h-7 bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <MessageSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div className="p-3 sm:p-4 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 rounded-2xl rounded-tl-none flex items-center gap-2 shadow-sm">
                          <Loader2 className="w-3 h-3 animate-spin text-indigo-600 dark:text-indigo-400" />
                          <span className="text-[10px]">Рекрутер формулирует ответ...</span>
                        </div>
                      </div>
                    )}
                    {finished && !evaluating && !evaluation && (
                      <motion.div 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 sm:p-5 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-500/20 rounded-2xl flex flex-col items-center gap-3 text-center max-w-md mx-auto"
                      >
                        <Sparkles className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                        <div>
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Все вопросы успешно пройдены!</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Рекрутер готов подвести итоги и дать развернутую техническую оценку.</p>
                        </div>
                        <button
                          onClick={handleEvaluate}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold rounded-xl transition"
                        >
                          Получить результаты
                        </button>
                      </motion.div>
                    )}
                    {evaluating && (
                      <div className="flex flex-col items-center justify-center py-10 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 dark:text-indigo-400" />
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Собираем отчет комиссии...</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">ИИ анализирует ваши технические и коммуникационные навыки.</p>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input form */}
                  {!finished && (
                    <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-950/30 flex gap-2 items-center">
                      <div className="text-[9px] sm:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase px-1 sm:px-2 whitespace-nowrap">
                        Вопрос {getQuestionNumber()}/5
                      </div>
                      <input
                        type="text"
                        disabled={sending}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                        placeholder="Напишите ваш ответ..."
                        className="flex-1 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-850 rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!input.trim() || sending}
                        className="p-2 sm:p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl transition flex items-center justify-center shrink-0 shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right details panel */}
            {!evaluation && (
              <div className="w-72 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/20 p-6 hidden lg:block space-y-5 overflow-y-auto">
                <div>
                  <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Вакансия</span>
                  <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">{vacancyTitle}</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{vacancyCompany}</p>
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-800/60 space-y-2">
                  <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Проверяемый стек</span>
                  <div className="flex flex-wrap gap-1">
                    {completedModulesTitles.map((t, i) => (
                      <span key={i} className="text-[9px] font-bold px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-950 rounded">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-800/60">
                  <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-1">Требования вакансии</span>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-[12]">
                    {vacancyRequirements}
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
