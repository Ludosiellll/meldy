import { SummaryInfo } from '../types';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Play, Pause, Square, Headphones, FileText, Sparkles, Volume2, AlertCircle, Share2, Info, Monitor, Smartphone, HelpCircle, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { updateQuestProgress } from '../api/quests';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { playTTS, stopTTS, pauseTTS, resumeTTS, getTTSPlaybackRate, setTTSPlaybackRate } from '../utils/tts';
import { supabase } from '../lib/supabase';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import toast from 'react-hot-toast';
import FormulaWidget from './FormulaWidget';

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
  const navigate = useNavigate();
  const { verifyEnergy } = useEnergyConfirm();
  const [searchParams] = useSearchParams();

  // Вытаскиваем данные из составного JSON
  const cheatsheet = summaryJson?.cheatsheet || '';
  const podcastLines: PodcastLine[] = summaryJson?.podcast || [];
  const terms = summaryJson?.terms || [];
  const flashcards = summaryJson?.flashcards?.flashcards || [];

  const [tab, setTab] = useState<'cheatsheet' | 'podcast'>(
    summaryJson?._startTab === 'podcast' ? 'podcast' : 'cheatsheet'
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSpeakingIndex, setCurrentSpeakingIndex] = useState(-1);
  const currentIndexRef = useRef(0);
  const [isGenerating, setIsGenerating] = useState(false);

  // Состояние синхро-слайдов для подкаста
  const [activeSlide, setActiveSlide] = useState<{
    type: 'default' | 'term' | 'flashcard' | 'formula' | 'ohm' | 'compound_interest' | 'pythagoras' | 'kinetic_energy' | 'quadratic' | 'gravity';
    title: string;
    description?: string;
    formulaKey?: string;
    extraData?: any;
  }>({ type: 'default', title: summaryJson?.title || 'Разбор лекции' });

  // Состояние мобильного экрана тьютора
  const [showMobileScreen, setShowMobileScreen] = useState(false);

  // Спектральный анализатор формул в тексте для Шпаргалки
  const [activeCheatsheetFormula, setActiveCheatsheetFormula] = useState<string | null>(null);

  // Автоматический поиск и маппинг ключевых фраз при воспроизведении подкаста
  useEffect(() => {
    if (currentSpeakingIndex === -1) {
      setActiveSlide({ type: 'default', title: summaryJson?.title || 'Разбор лекции' });
      return;
    }

    const currentLine = podcastLines[currentSpeakingIndex];
    if (!currentLine) return;

    const txt = currentLine.text.toLowerCase();

    // 1. Поиск bespoke формул по ключевым словам
    if (txt.includes('ом') || txt.includes('напряжен') || txt.includes('сопротивлен') || txt.includes('ток')) {
      setActiveSlide({ type: 'ohm', title: '🔌 Симуляция: Закон Ома', formulaKey: 'ohm' });
      return;
    }
    if (txt.includes('сложн') || txt.includes('процент') || txt.includes('капитал') || txt.includes('инвестици') || txt.includes('накопл')) {
      setActiveSlide({ type: 'compound_interest', title: '📈 Сложные проценты', formulaKey: 'compound_interest' });
      return;
    }
    if (txt.includes('пифагор') || txt.includes('катет') || txt.includes('гипотенуз') || txt.includes('треугольник')) {
      setActiveSlide({ type: 'pythagoras', title: '📐 Теорема Пифагора', formulaKey: 'pythagoras' });
      return;
    }
    if (txt.includes('кинетическ') || txt.includes('энергия') || txt.includes('удар') || txt.includes('скорость') || txt.includes('масс')) {
      setActiveSlide({ type: 'kinetic_energy', title: '💥 Кинетическая энергия', formulaKey: 'kinetic_energy' });
      return;
    }
    if (txt.includes('уравнение') || txt.includes('дискриминант') || txt.includes('корен') || txt.includes('квадратн')) {
      setActiveSlide({ type: 'quadratic', title: '📊 Квадратное уравнение', formulaKey: 'quadratic' });
      return;
    }
    if (txt.includes('тяготен') || txt.includes('гравитац') || txt.includes('притяжен') || txt.includes('планет') || txt.includes('ньютон')) {
      setActiveSlide({ type: 'gravity', title: '🌌 Закон всемирного тяготения', formulaKey: 'gravity' });
      return;
    }

    // 2. Поиск по терминам лекции
    for (const t of terms) {
      if (txt.includes(t.term.toLowerCase())) {
        setActiveSlide({
          type: 'term',
          title: `📖 Термин: ${t.term}`,
          description: t.definition
        });
        return;
      }
    }

    // 3. Поиск по флеш-картам лекции
    for (const card of flashcards) {
      const qWords = card.question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
      const matches = qWords.filter((w: string) => txt.includes(w)).length;
      if (matches >= 2) {
        setActiveSlide({
          type: 'flashcard',
          title: '⚡ Блиц-Карточка',
          description: `Вопрос: ${card.question}\n\nОтвет: ${card.answer}`,
          extraData: card
        });
        return;
      }
    }

    // Дефолтный слайд
    setActiveSlide({
      type: 'default',
      title: summaryJson?.title || 'Разбор лекции',
      description: 'Аудиоразбор от Meldy: Макс и Софья помогают разобраться в сложных терминах.'
    });

  }, [currentSpeakingIndex, podcastLines, terms, flashcards]);

  const handleCreateCheatsheet = async () => {
    if (!materialId) return;
    setIsGenerating(true);

    const context = (originalText || summaryJson?.content || '').slice(0, 15000);
    if (!context.trim()) {
      await alert({ title: 'Ошибка', message: 'Недостаточно контента для создания шпаргалки.', type: 'danger' });
      setIsGenerating(false);
      return;
    }

    if (user?.id) {
      const ok = await verifyEnergy(user.id, 5, 'Создание шпаргалки');
      if (!ok) {
        setIsGenerating(false);
        return;
      }
      await incrementAIUsage(user.id, 5);
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

  const stopPodcast = () => {
    stopTTS();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentSpeakingIndex(-1);
    currentIndexRef.current = 0;
  };

  const playPodcast = async () => {
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

  const handleShare = async () => {
    if (!materialId) return;
    try {
      const { error } = await supabase
        .from('materials')
        .update({ is_public: true })
        .eq('id', materialId);
      
      if (error) throw error;
      
      const shareUrl = `${window.location.origin}/shared/${materialId}`;
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Ссылка скопирована! Теперь вы можете отправить её друзьям.');
    } catch (err) {
      console.error(err);
      toast.error('Не удалось создать ссылку');
    }
  };

  // Автоматический поиск формул в конспекте шпаргалки для вывода виджетов
  const renderFormulaButtons = () => {
    const formulas: { key: string; title: string; latex: string }[] = [];
    const lowSheet = cheatsheet.toLowerCase();
    
    if (lowSheet.includes('i = u') || lowSheet.includes('ома')) {
      formulas.push({ key: 'ohm', title: 'Закон Ома', latex: 'I = \\frac{U}{R}' });
    }
    if (lowSheet.includes('a = p') || lowSheet.includes('процент')) {
      formulas.push({ key: 'compound_interest', title: 'Сложные проценты', latex: 'A = P(1+\\frac{r}{n})^{nt}' });
    }
    if (lowSheet.includes('a^2') || lowSheet.includes('пифагор')) {
      formulas.push({ key: 'pythagoras', title: 'Теорема Пифагора', latex: 'a^2 + b^2 = c^2' });
    }
    if (lowSheet.includes('e_k') || lowSheet.includes('кинетическ')) {
      formulas.push({ key: 'kinetic_energy', title: 'Кинетическая энергия', latex: 'E_k = \\frac{mv^2}{2}' });
    }
    if (lowSheet.includes('ax^2') || lowSheet.includes('квадратн')) {
      formulas.push({ key: 'quadratic', title: 'Квадратное уравнение', latex: 'ax^2 + bx + c = 0' });
    }
    if (lowSheet.includes('f = g') || lowSheet.includes('притяжен') || lowSheet.includes('тяготен')) {
      formulas.push({ key: 'gravity', title: 'Закон тяготения', latex: 'F = G\\frac{m_1 m_2}{r^2}' });
    }

    if (formulas.length === 0) return null;

    return (
      <div className="space-y-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500" />
          <h4 className="font-extrabold text-sm text-slate-800 dark:text-slate-200">🧪 Лаборатория интерактивных формул</h4>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Мы нашли в шпаргалке математические законы. Запустите визуальную симуляцию, чтобы увидеть их в действии!
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {formulas.map(f => (
            <button
              key={f.key}
              onClick={() => setActiveCheatsheetFormula(activeCheatsheetFormula === f.key ? null : f.key)}
              className={`px-4 py-2 border rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                activeCheatsheetFormula === f.key
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                  : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-750'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {f.title}
            </button>
          ))}
        </div>

        {/* Dynamic simulation container inline inside cheatsheet */}
        <AnimatePresence>
          {activeCheatsheetFormula && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="pt-2"
            >
              <FormulaWidget 
                formulaKey={activeCheatsheetFormula} 
                onClose={() => setActiveCheatsheetFormula(null)} 
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header and navigation buttons */}
      <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-900/30 p-2.5 rounded-2xl border border-slate-100 dark:border-slate-850">
        <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
          <button
            onClick={() => { setTab('cheatsheet'); stopPodcast(); }}
            className={`py-1.5 px-4 rounded-lg text-xs font-black transition ${tab === 'cheatsheet' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
          >
            ⚡ Шпаргалка
          </button>
          <button
            onClick={() => setTab('podcast')}
            className={`py-1.5 px-4 rounded-lg text-xs font-black transition ${tab === 'podcast' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
          >
            🎙️ Подкаст
          </button>
        </div>
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-xs hover:bg-indigo-100 transition border border-indigo-100/30"
        >
          <Share2 className="w-3.5 h-3.5" />
          Поделиться
        </button>
      </div>

      <AnimatePresence mode="wait">
        {/* ВКЛАДКА 1: Шпаргалка с Формульной Песочницей */}
        {tab === 'cheatsheet' && (
          <motion.div
            key="cheatsheet"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-5"
          >
            {!cheatsheet ? (
              <div className="card p-8 text-center space-y-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm">
                <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/20 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <FileText className="w-8 h-8 text-amber-500 dark:text-amber-400" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-extrabold text-slate-800 dark:text-slate-200 text-base">Шпаргалка еще не создана</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-xs max-w-sm mx-auto leading-relaxed">
                    Выжмите самое главное из этой лекции! ИИ мгновенно подготовит краткую экспресс-шпаргалку для быстрого повторения перед парой.
                  </p>
                </div>
                {materialId ? (
                  <button
                    onClick={handleCreateCheatsheet}
                    disabled={isGenerating}
                    className="px-6 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-black transition flex items-center gap-2 mx-auto shadow-lg shadow-rose-600/25 active:translate-y-0 hover:-translate-y-0.5 duration-200"
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
                  <p className="text-slate-400 dark:text-slate-500 italic text-[10px]">
                    Перезапустите анализ файла, чтобы сгенерировать дополнительные материалы.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {/* Интерактивная песочница формул */}
                {renderFormulaButtons()}

                {/* Текст Шпаргалки */}
                <div className="bg-slate-900 dark:bg-slate-800/80 text-white rounded-3xl p-6 md:p-8 shadow-xl border border-slate-250/10 dark:border-slate-800 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full blur-3xl pointer-events-none" />
                  <p className="text-[9px] font-extrabold text-indigo-300 dark:text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                    ⚡ Экспресс-шпаргалка за 5 минут
                  </p>
                  <div className="prose prose-invert max-w-none text-xs text-slate-300 leading-relaxed cheatsheet-style">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{cheatsheet}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ВКЛАДКА 2: Аудио-подкаст с синхро-слайдами (TikTok-Тьютор) */}
        {tab === 'podcast' && (
          <motion.div
            key="podcast"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-5"
          >
            {podcastLines.length === 0 ? (
              <div className="card p-6 text-center text-slate-400 italic text-xs">
                Для этой лекции аудио-подкаст еще не создан. Перезапустите анализ файла.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Аудио-плеер */}
                <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white rounded-3xl p-5 shadow-xl shadow-indigo-200/50 dark:shadow-none border border-indigo-500/20 dark:border-indigo-500/10 flex flex-col md:flex-row items-center justify-between gap-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none -mt-10 -mr-10" />
                  
                  <div className="flex items-center gap-3 relative z-10 w-full md:w-auto">
                    <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center shrink-0 border border-white/20 shadow-inner">
                      <Headphones className="w-6 h-6 text-white" />
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <h4 className="font-extrabold text-xs sm:text-sm text-white flex items-center gap-1.5 truncate">
                        AI-Подкаст: {summaryJson?.title || 'Разбор лекции'}
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      </h4>
                      <p className="text-[10px] text-indigo-200 mt-0.5">Макс и Софья объясняют теорию просто</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 relative z-10 w-full md:w-auto">
                    {/* Mobile Screen Trigger */}
                    <button
                      onClick={() => setShowMobileScreen(!showMobileScreen)}
                      className={`md:hidden p-3 rounded-xl transition border flex items-center gap-1 font-bold ${
                        showMobileScreen 
                          ? 'bg-rose-500 text-white border-rose-400' 
                          : 'bg-indigo-900/50 text-indigo-200 border-indigo-400/30'
                      }`}
                      title="Экран Тьютора"
                    >
                      <Monitor className="w-4 h-4" />
                      <span className="text-[10px]">Визуальный Экран</span>
                      {isPlaying && <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping" />}
                    </button>

                    <button
                      onClick={() => {
                        const current = getTTSPlaybackRate();
                        const next = current === 1.0 ? 1.25 : current === 1.25 ? 1.5 : current === 1.5 ? 2.0 : 1.0;
                        setTTSPlaybackRate(next);
                        setTab(tab); 
                      }}
                      className="px-2.5 py-3 bg-indigo-900/50 hover:bg-indigo-900 text-indigo-200 hover:text-white rounded-xl transition border border-indigo-400/30 font-extrabold text-xs"
                    >
                      {getTTSPlaybackRate()}x
                    </button>
                    <button
                      onClick={playPodcast}
                      className="flex-1 md:flex-none justify-center px-5 py-3 bg-white hover:bg-indigo-50 text-indigo-600 font-black rounded-xl text-xs transition flex items-center gap-1.5 shadow-lg active:translate-y-0"
                    >
                      {isPlaying && !isPaused ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                      {isPlaying && !isPaused ? 'Пауза' : currentSpeakingIndex !== -1 ? 'Продолжить' : 'Слушать'}
                    </button>
                    {currentSpeakingIndex !== -1 && (
                      <button
                        onClick={stopPodcast}
                        className="p-3 bg-indigo-900/50 hover:bg-indigo-900 text-indigo-200 hover:text-white rounded-xl transition border border-indigo-400/30"
                      >
                        <Square className="w-4 h-4 fill-current" />
                      </button>
                    )}
                  </div>
                </div>

                {/* ДВУХКОЛОННЫЙ SPLIT-VIEW (Десктоп) / РЕАКТИВНЫЙ СКРИН (Мобилки) */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                  
                  {/* Левая колонка (60%): Бегущий диалог Макса и Софьи */}
                  <div className="md:col-span-3 space-y-3 max-h-[480px] overflow-y-auto pr-2 custom-scrollbar bg-slate-50/50 dark:bg-slate-900/10 p-3 rounded-2xl border border-slate-100 dark:border-slate-850">
                    {podcastLines.map((line, idx) => {
                      const isSpeaking = currentSpeakingIndex === idx;
                      const isMax = line.speaker === 'Макс';

                      return (
                        <div
                          key={idx}
                          className={`flex ${isMax ? 'justify-start' : 'justify-end'} transition-all duration-300`}
                        >
                          <div
                            className={`relative max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-2xl shadow-sm transition-all duration-300 ${
                              isMax
                                ? `bg-white dark:bg-slate-900 border text-slate-800 dark:text-slate-100 rounded-bl-sm ${
                                    isSpeaking
                                      ? 'border-indigo-500 dark:border-indigo-500 ring-4 ring-indigo-500/15 shadow-md scale-[1.01]'
                                      : 'border-slate-150 dark:border-slate-800'
                                  }`
                                : `bg-indigo-600 dark:bg-indigo-750 border text-white rounded-br-sm ${
                                    isSpeaking
                                      ? 'border-indigo-400 dark:border-indigo-400 ring-4 ring-indigo-500/25 shadow-md scale-[1.01]'
                                      : 'border-indigo-500 dark:border-indigo-650'
                                  }`
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5 opacity-90">
                              <span className={`text-[9px] font-black uppercase tracking-wider ${isMax ? 'text-slate-400 dark:text-slate-500' : 'text-indigo-200'}`}>
                                {line.speaker}
                              </span>
                              {isSpeaking && (
                                <Volume2 className={`w-3.5 h-3.5 ${isMax ? 'text-indigo-500 dark:text-indigo-400' : 'text-white'} animate-pulse`} />
                              )}
                            </div>
                            <p className={`text-[11px] sm:text-xs leading-relaxed font-semibold ${isMax ? 'text-slate-700 dark:text-slate-200' : 'text-white'}`}>
                              {line.text}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Правая колонка (40%): Интерактивный экран тьютора */}
                  <div className="hidden md:block md:col-span-2">
                    <div className="sticky top-4 space-y-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-black uppercase tracking-wider mb-2">
                        <Monitor className="w-4 h-4 text-indigo-500 animate-pulse" />
                        <span>Экран Тьютора (Sync)</span>
                      </div>
                      
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={activeSlide.type + activeSlide.title}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          transition={{ type: "spring", stiffness: 300, damping: 25 }}
                          className="w-full"
                        >
                          {/* 1. Bespoke Formula Sandbox Slide */}
                          {activeSlide.formulaKey ? (
                            <FormulaWidget formulaKey={activeSlide.formulaKey} />
                          ) : activeSlide.type === 'term' ? (
                            <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-lg relative overflow-hidden min-h-[260px]">
                              <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full blur-2xl pointer-events-none" />
                              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                                <span className="text-xl">📖</span>
                                <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-200">{activeSlide.title}</h4>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                                {activeSlide.description}
                              </p>
                            </div>
                          ) : activeSlide.type === 'flashcard' ? (
                            <div className="card p-5 bg-gradient-to-br from-indigo-900 to-indigo-950 text-white border border-slate-800 rounded-3xl shadow-lg relative overflow-hidden min-h-[260px]">
                              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl pointer-events-none" />
                              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
                                <span className="text-xl">⚡</span>
                                <h4 className="font-extrabold text-xs text-indigo-300">{activeSlide.title}</h4>
                              </div>
                              <div className="space-y-3">
                                <div className="text-[11px] font-black text-indigo-200 uppercase tracking-widest block">ВОПРОС:</div>
                                <p className="text-xs text-white leading-relaxed font-bold italic">
                                  {activeSlide.extraData?.question}
                                </p>
                                <div className="h-px bg-white/10 my-2" />
                                <div className="text-[11px] font-black text-indigo-200 uppercase tracking-widest block">ОТВЕТ НАСТАВНИКА:</div>
                                <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
                                  {activeSlide.extraData?.answer}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-md flex flex-col items-center justify-center text-center min-h-[260px] relative overflow-hidden">
                              <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl flex items-center justify-center mb-4">
                                <Headphones className="w-6 h-6 text-indigo-500 animate-bounce" />
                              </div>
                              <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-200 mb-1">{activeSlide.title}</h4>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 max-w-[200px] leading-relaxed">
                                Расслабьтесь и слушайте! Экран тьютора автоматически покажет графики и формулы, как только ведущие заговорят о них.
                              </p>
                              
                              {/* Glowing Equalizer Simulation */}
                              {isPlaying && !isPaused && (
                                <div className="flex gap-1 items-end h-8 mt-4">
                                  {Array.from({ length: 6 }).map((_, i) => (
                                    <motion.div
                                      key={i}
                                      className="w-1 bg-indigo-500 rounded-full"
                                      animate={{
                                        height: [8, 28, 8]
                                      }}
                                      transition={{
                                        duration: 0.5 + i * 0.1,
                                        repeat: Infinity,
                                        ease: "easeInOut"
                                      }}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>

                </div>

                {/* МОБИЛЬНАЯ ШТОРКА (Флоатинг слайдер для смартфонов) */}
                <AnimatePresence>
                  {showMobileScreen && (
                    <motion.div
                      initial={{ opacity: 0, y: 100 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 100 }}
                      className="fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 rounded-t-3xl p-5 shadow-2xl block md:hidden max-h-[85vh] overflow-y-auto"
                    >
                      <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100 dark:border-slate-850">
                        <div className="flex items-center gap-1.5">
                          <Smartphone className="w-4 h-4 text-rose-500" />
                          <span className="font-extrabold text-xs text-slate-800 dark:text-slate-200">Визуальный экран тьютора</span>
                        </div>
                        <button
                          onClick={() => setShowMobileScreen(false)}
                          className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg text-xs font-bold"
                        >
                          Закрыть
                        </button>
                      </div>

                      {/* Content representation exact match to desktop screen */}
                      <div className="w-full">
                        {activeSlide.formulaKey ? (
                          <FormulaWidget formulaKey={activeSlide.formulaKey} />
                        ) : activeSlide.type === 'term' ? (
                          <div className="card p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl min-h-[200px]">
                            <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-200 mb-2">{activeSlide.title}</h4>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">{activeSlide.description}</p>
                          </div>
                        ) : activeSlide.type === 'flashcard' ? (
                          <div className="card p-5 bg-gradient-to-br from-indigo-900 to-indigo-950 text-white rounded-3xl min-h-[200px] text-left">
                            <h4 className="font-extrabold text-xs text-indigo-300 mb-2">{activeSlide.title}</h4>
                            <div className="text-[9px] font-black text-indigo-200 uppercase tracking-widest block">ВОПРОС:</div>
                            <p className="text-xs text-white leading-relaxed font-bold mb-2">{activeSlide.extraData?.question}</p>
                            <div className="h-px bg-white/10 my-2" />
                            <div className="text-[9px] font-black text-indigo-200 uppercase tracking-widest block">ОТВЕТ:</div>
                            <p className="text-[10px] text-slate-350 leading-relaxed">{activeSlide.extraData?.answer}</p>
                          </div>
                        ) : (
                          <div className="card p-5 bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded-3xl text-center min-h-[200px] flex flex-col items-center justify-center">
                            <Headphones className="w-6 h-6 text-indigo-500 animate-bounce mb-3" />
                            <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-200 mb-1">{activeSlide.title}</h4>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 max-w-[200px] leading-relaxed">
                              Слушайте подкаст! Экран автоматически покажет графики и формулы при упоминании в речи.
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
