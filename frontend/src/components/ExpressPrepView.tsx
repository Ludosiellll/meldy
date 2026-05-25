import { SummaryInfo } from '../types';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Play, Pause, Square, Headphones, FileText, Sparkles, Volume2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { updateQuestProgress } from '../api/quests';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';

interface PodcastLine {
  speaker: 'Макс' | 'Софья' | string;
  text: string;
}

export default function ExpressPrepView({ summaryJson }: { summaryJson: any }) {
  const { user } = useAuth();
  const { alert } = useConfirm();
  const [searchParams] = useSearchParams();

  // Вытаскиваем данные из составного JSON
  const cheatsheet = summaryJson?.cheatsheet || '';
  const podcastLines: PodcastLine[] = summaryJson?.podcast || [];

  const [tab, setTab] = useState<'cheatsheet' | 'podcast'>(searchParams.get('tab') === 'podcast' ? 'podcast' : 'cheatsheet');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSpeakingIndex, setCurrentSpeakingIndex] = useState(-1);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentIndexRef = useRef(0);

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stopPodcast = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setCurrentSpeakingIndex(-1);
    currentIndexRef.current = 0;
  };

  const playPodcast = async () => {
    if (!window.speechSynthesis) {
      await alert({ title: 'Ошибка', message: 'Синтез речи не поддерживается вашим браузером.', type: 'danger' });
      return;
    }

    if (isPlaying) {
      // Пауза
      window.speechSynthesis.pause();
      setIsPlaying(false);
      return;
    }

    if (window.speechSynthesis.paused && currentSpeakingIndex !== -1) {
      // Возобновление
      window.speechSynthesis.resume();
      setIsPlaying(true);
      return;
    }

    // Запуск с начала или с текущего индекса
    window.speechSynthesis.cancel();
    
    const speakNext = () => {
      if (currentIndexRef.current >= podcastLines.length) {
        setIsPlaying(false);
        setCurrentSpeakingIndex(-1);
        currentIndexRef.current = 0;
        return;
      }

      const line = podcastLines[currentIndexRef.current];
      setCurrentSpeakingIndex(currentIndexRef.current);

      const utterance = new SpeechSynthesisUtterance(line.text);
      utterance.lang = 'ru-RU';
      utteranceRef.current = utterance;

      // Настройка голосов и тембра
      const voices = window.speechSynthesis.getVoices();
      const ruVoices = voices.filter(v => v.lang.startsWith('ru'));

      if (line.speaker === 'Макс') {
        const maleVoice = ruVoices.find(v => 
          v.name.toLowerCase().includes('male') || 
          v.name.toLowerCase().includes('dmitry') || 
          v.name.toLowerCase().includes('pavel')
        );
        if (maleVoice) utterance.voice = maleVoice;
        utterance.pitch = 0.95; // Более низкий тембр для Макса
        utterance.rate = 1.0;
      } else {
        const femaleVoice = ruVoices.find(v => 
          v.name.toLowerCase().includes('female') || 
          v.name.toLowerCase().includes('milena') || 
          v.name.toLowerCase().includes('katya')
        );
        if (femaleVoice) utterance.voice = femaleVoice;
        utterance.pitch = 1.22; // Более высокий и звонкий для Софьи
        utterance.rate = 1.05;  // Чуть быстрее
      }

      utterance.onend = () => {
        currentIndexRef.current++;
        speakNext();
      };

      utterance.onerror = (e) => {
        console.error('Speech synthesis error:', e);
        setIsPlaying(false);
        setCurrentSpeakingIndex(-1);
      };

      window.speechSynthesis.speak(utterance);
    };

    setIsPlaying(true);
    speakNext();
    if (user?.id) updateQuestProgress(user.id, 'podcast', 1);
  };

  return (
    <div className="space-y-6">
      {/* Переключатель вкладок экспресс-подготовки */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-full max-w-sm mx-auto sm:mx-0">
        <button
          onClick={() => setTab('cheatsheet')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold transition ${
            tab === 'cheatsheet'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 hover:bg-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> ⚡ Шпаргалка за 5 минут
        </button>
        <button
          onClick={() => setTab('podcast')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold transition ${
            tab === 'podcast'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 hover:bg-white'
          }`}
        >
          <Headphones className="w-3.5 h-3.5" /> 🎙️ AI-Подкаст
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
              <div className="card p-6 text-center text-slate-400 italic text-sm">
                Для этой лекции шпаргалка еще не создана. Перезапустите анализ файла.
              </div>
            ) : (
              <div className="card p-6 md:p-8 bg-gradient-to-br from-amber-50/30 to-rose-50/10 border-amber-100 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="prose prose-slate max-w-none text-slate-700 prose-sm cheatsheet-style">
                  <ReactMarkdown>{cheatsheet}</ReactMarkdown>
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
                <div className="bg-slate-900 text-white rounded-2xl p-5 md:p-6 shadow-xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-rose-500/20 rounded-xl flex items-center justify-center shrink-0 border border-rose-500/30">
                      <Headphones className="w-6 h-6 text-rose-400" />
                    </div>
                    <div className="text-center md:text-left">
                      <h4 className="font-bold text-sm text-slate-200 flex items-center gap-1.5 justify-center md:justify-start">
                        AI-Подкаст: {summaryJson?.title || 'Разбор лекции'}
                        <Sparkles className="w-4 h-4 text-amber-400" />
                      </h4>
                      <p className="text-xs text-slate-400">Слушайте простое объяснение темы по пути на экзамен</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={playPodcast}
                      className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-lg shadow-rose-950"
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      {isPlaying ? 'Пауза' : currentSpeakingIndex !== -1 ? 'Продолжить' : 'Слушать подкаст'}
                    </button>
                    {currentSpeakingIndex !== -1 && (
                      <button
                        onClick={stopPodcast}
                        className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition border border-slate-700"
                        title="Остановить"
                      >
                        <Square className="w-4 h-4" />
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
                        className={`flex ${isMax ? 'justify-start' : 'justify-end'} transition-all duration-300`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] p-4 rounded-2xl shadow-sm border transition-all duration-300 ${
                            isSpeaking
                              ? 'bg-rose-50 border-rose-200 ring-2 ring-rose-500/20 scale-[1.01]'
                              : isMax
                              ? 'bg-white border-slate-100 text-slate-800 rounded-tl-none'
                              : 'bg-slate-50 border-slate-200 text-slate-700 rounded-tr-none'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-black uppercase tracking-wider ${isMax ? 'text-rose-600' : 'text-indigo-600'}`}>
                              {line.speaker}
                            </span>
                            {isSpeaking && (
                              <Volume2 className="w-3.5 h-3.5 text-rose-500 animate-bounce" />
                            )}
                          </div>
                          <p className="text-xs sm:text-sm leading-relaxed font-medium">{line.text}</p>
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
