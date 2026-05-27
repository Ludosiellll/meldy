import { SummaryInfo } from '../types';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Play, Pause, Square, Headphones, FileText, Sparkles, Volume2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { updateQuestProgress } from '../api/quests';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { playTTS, pauseTTS, resumeTTS, stopTTS } from '../utils/tts';
import { supabase } from '../lib/supabase';

interface PodcastLine {
  speaker: 'Макс' | 'Софья' | string;
  text: string;
}

export default function ExpressPrepView({ 
  summaryJson, 
  materialId, 
  originalText, 
  onUpdate 
}: { 
  summaryJson: any; 
  materialId?: string; 
  originalText?: string; 
  onUpdate?: (updatedFields: any) => void; 
}) {
  const { user } = useAuth();
  const { alert } = useConfirm();
  const [searchParams] = useSearchParams();

  // Вытаскиваем данные из составного JSON
  const cheatsheet = summaryJson?.cheatsheet || '';
  const podcastLines: PodcastLine[] = summaryJson?.podcast || [];

  const [tab, setTab] = useState<'cheatsheet' | 'podcast'>(
    summaryJson?._startTab === 'podcast' || searchParams.get('tab') === 'podcast' 
      ? 'podcast' 
      : 'cheatsheet'
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSpeakingIndex, setCurrentSpeakingIndex] = useState(-1);
  const currentIndexRef = useRef(0);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCreateCheatsheet = async () => {
    if (!materialId) return;
    setIsGenerating(true);

    const context = (originalText || summaryJson?.content || '').slice(0, 15000);
    if (!context.trim()) {
      await alert({ title: 'Ошибка', message: 'Недостаточно контента для создания шпаргалки.', type: 'danger' });
      setIsGenerating(false);
      return;
    }

    try {
      const res = await fetch('/api/quick-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();

      if (!d.cheatsheet) throw new Error();

      // Сохраняем в Supabase
      const { error } = await supabase
        .from('materials')
        .update({
          summary_json: {
            ...summaryJson,
            cheatsheet: d.cheatsheet
          }
        })
        .eq('id', materialId);

      if (error) throw error;

      // Обновляем состояние родительского компонента
      if (onUpdate) {
        onUpdate({
          summary_json: {
            ...summaryJson,
            cheatsheet: d.cheatsheet
          }
        });
      }
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка', message: 'Не удалось сгенерировать шпаргалку. Попробуйте еще раз.', type: 'danger' });
    } finally {
      setIsGenerating(false);
    }
  };

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      stopTTS();
    };
  }, []);

  // Синхронизация паузы при блокировке экрана / сворачивании вкладки
  useEffect(() => {
    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        // Если в стейте мы «играем», но под капотом синтез прерван/остановлен, переводим в паузу
        if (isPlaying && !isPaused) {
          if (window.speechSynthesis && !window.speechSynthesis.speaking) {
            setIsPaused(true);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilitySync);
    window.addEventListener('focus', handleVisibilitySync);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilitySync);
      window.removeEventListener('focus', handleVisibilitySync);
    };
  }, [isPlaying, isPaused]);

  const stopPodcast = () => {
    stopTTS();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentSpeakingIndex(-1);
    currentIndexRef.current = 0;
  };

  const playPodcast = async () => {
    if (!window.speechSynthesis) {
      await alert({ title: 'Ошибка', message: 'Синтез речи не поддерживается вашим браузером.', type: 'danger' });
      return;
    }

    if (isPlaying && !isPaused) {
      // Пауза
      pauseTTS();
      setIsPaused(true);
      return;
    }

    if (isPlaying && isPaused) {
      // Возобновление
      resumeTTS();
      setIsPaused(false);
      return;
    }

    // Запуск с начала или с текущего индекса
    stopTTS();
    setIsPaused(false);
    
    const speakNext = () => {
      if (currentIndexRef.current >= podcastLines.length) {
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentSpeakingIndex(-1);
        currentIndexRef.current = 0;
        return;
      }

      const line = podcastLines[currentIndexRef.current];
      setCurrentSpeakingIndex(currentIndexRef.current);

      const role = line.speaker === 'Макс' ? 'male' : 'female';

      playTTS(
        line.text,
        role,
        () => {
          currentIndexRef.current++;
          speakNext();
        },
        (e) => {
          console.error('Speech synthesis error:', e);
          setIsPlaying(false);
          setIsPaused(false);
          setCurrentSpeakingIndex(-1);
        }
      );
    };

    setIsPlaying(true);
    speakNext();
    if (user?.id) updateQuestProgress(user.id, 'podcast', 1);
  };

  return (
    <div className="space-y-6">
      {/* Переключатель вкладок экспресс-подготовки */}
      <div className="flex gap-1.5 bg-slate-100/80 dark:bg-slate-900/80 p-1.5 rounded-2xl w-full max-w-sm mx-auto sm:mx-0 border border-slate-200 dark:border-slate-800/80">
        <button
          onClick={() => setTab('cheatsheet')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            tab === 'cheatsheet'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-800/50'
          }`}
        >
          <FileText className="w-4 h-4" /> ⚡ Шпаргалка за 5 минут
        </button>
        <button
          onClick={() => setTab('podcast')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            tab === 'podcast'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-800/50'
          }`}
        >
          <Headphones className="w-4 h-4" /> 🎙️ AI-Подкаст
        </button>
      </div>

      <AnimatePresence mode="wait">
        {/* ВКЛАДКА 1: Шпаргалка */}
        {tab === 'cheatsheet' && (
          <motion.div
            key="cheatsheet"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {!cheatsheet ? (
              <div className="card p-8 text-center space-y-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
                <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/40 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <FileText className="w-8 h-8 text-amber-500 dark:text-amber-400" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base">Шпаргалка еще не создана</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md mx-auto">
                    Выжмите самое главное из этой лекции! ИИ мгновенно подготовит краткую экспресс-шпаргалку для быстрого повторения перед парой.
                  </p>
                </div>
                {materialId ? (
                  <button
                    onClick={handleCreateCheatsheet}
                    disabled={isGenerating}
                    className="px-6 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-sm font-black transition flex items-center gap-2 mx-auto shadow-lg shadow-rose-600/25 active:translate-y-0 hover:-translate-y-0.5 duration-200"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Анализируем лекцию...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
                        Создать шпаргалку за 5 минут
                      </>
                    )}
                  </button>
                ) : (
                  <p className="text-slate-400 dark:text-slate-500 italic text-xs">
                    Перезапустите анализ файла, чтобы сгенерировать дополнительные материалы.
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-slate-900 dark:bg-slate-800/80 text-white rounded-2xl p-6 md:p-8 shadow-xl border border-slate-200/10 dark:border-slate-800 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full blur-3xl pointer-events-none" />
                <p className="text-[10px] font-extrabold text-indigo-300 dark:text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                  ⚡ Экспресс-шпаргалка за 5 минут
                </p>
                <div className="prose prose-invert max-w-none text-sm text-slate-300 leading-relaxed cheatsheet-style">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{cheatsheet}</ReactMarkdown>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ВКЛАДКА 2: Аудио-подкаст */}
        {tab === 'podcast' && (
          <motion.div
            key="podcast"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {podcastLines.length === 0 ? (
              <div className="card p-6 text-center text-slate-400 italic text-sm">
                Для этой лекции аудио-подкаст еще не создан. Перезапустите анализ файла.
              </div>
            ) : (
              <>
                {/* Аудио-плеер */}
                <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white rounded-3xl p-5 md:p-6 shadow-xl shadow-indigo-200/50 dark:shadow-none border border-indigo-500/20 dark:border-indigo-500/10 flex flex-col md:flex-row items-center justify-between gap-5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none -mt-10 -mr-10" />
                  
                  <div className="flex items-center gap-4 relative z-10 w-full md:w-auto">
                    <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center shrink-0 border border-white/20 shadow-inner">
                      <Headphones className="w-7 h-7 text-white" />
                    </div>
                    <div className="text-left flex-1">
                      <h4 className="font-extrabold text-sm sm:text-base text-white flex items-center gap-1.5">
                        AI-Подкаст: {summaryJson?.title || 'Разбор лекции'}
                        <Sparkles className="w-4 h-4 text-amber-300" />
                      </h4>
                      <p className="text-xs text-indigo-200 mt-0.5">Слушайте простое объяснение темы</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 relative z-10 w-full md:w-auto">
                    <button
                      onClick={playPodcast}
                      className="flex-1 md:flex-none justify-center px-6 py-3.5 bg-white hover:bg-indigo-50 text-indigo-600 font-black rounded-xl text-sm transition flex items-center gap-2 shadow-lg hover:-translate-y-0.5"
                    >
                      {isPlaying && !isPaused ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                      {isPlaying && !isPaused ? 'Пауза' : currentSpeakingIndex !== -1 ? 'Продолжить' : 'Слушать'}
                    </button>
                    {currentSpeakingIndex !== -1 && (
                      <button
                        onClick={stopPodcast}
                        className="p-3.5 bg-indigo-900/50 hover:bg-indigo-900 text-indigo-200 hover:text-white rounded-xl transition border border-indigo-400/30"
                        title="Остановить"
                      >
                        <Square className="w-5 h-5 fill-current" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Бегущий диалог подкаста */}
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {podcastLines.map((line, idx) => {
                    const isSpeaking = currentSpeakingIndex === idx;
                    const isMax = line.speaker === 'Макс';

                    return (
                      <div
                        key={idx}
                        className={`flex ${isMax ? 'justify-start' : 'justify-end'} transition-all duration-300 mb-2`}
                      >
                        <div
                          className={`relative max-w-[85%] sm:max-w-[70%] px-5 py-3.5 rounded-2xl shadow-sm transition-all duration-300 ${
                            isMax
                              ? `bg-white dark:bg-slate-900 border text-slate-800 dark:text-slate-100 rounded-bl-sm ${
                                  isSpeaking
                                    ? 'border-indigo-500 dark:border-indigo-500 ring-4 ring-indigo-500/20 shadow-md'
                                    : 'border-slate-105 dark:border-slate-800/80 border-slate-100'
                                }`
                              : `bg-indigo-600 dark:bg-indigo-700 border text-white rounded-br-sm ${
                                  isSpeaking
                                    ? 'border-indigo-400 dark:border-indigo-400 ring-4 ring-indigo-500/30 shadow-md'
                                    : 'border-indigo-500 dark:border-indigo-600'
                                }`
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5 opacity-90">
                            <span className={`text-[10px] font-black uppercase tracking-wider ${isMax ? 'text-slate-500 dark:text-slate-400' : 'text-indigo-200'}`}>
                              {line.speaker}
                            </span>
                            {isSpeaking && (
                              <Volume2 className={`w-3.5 h-3.5 ${isMax ? 'text-indigo-500 dark:text-indigo-400' : 'text-white'} animate-pulse`} />
                            )}
                          </div>
                          <p className={`text-[13px] sm:text-sm leading-relaxed font-medium ${isMax ? 'text-slate-700 dark:text-slate-200' : 'text-white'}`}>
                            {line.text}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
