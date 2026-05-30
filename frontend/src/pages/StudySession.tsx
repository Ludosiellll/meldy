import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import {
  Brain, BookOpen, GraduationCap, Flame, ChevronRight, Zap, Play, Trophy,
  Sparkles, X, Heart, HelpCircle, CheckCircle2, AlertCircle, RefreshCw, Send,
  ArrowRight, MessageSquare, Layers, Award
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSound } from '../hooks/useSound';
import { getDueCards, updateCardProgress } from '../api/flashcards';
import { getMaterials, updateMaterialMissions } from '../api/materials';
import { addXP, recordStudyActivity, updateQuestProgress, checkAndAwardAchievements } from '../api/quests';
import { incrementAIUsage } from '../api/limits';
import ConfettiCelebration from '../components/ConfettiCelebration';
import AchievementToast from '../components/AchievementToast';
import type { Achievement } from '../components/AchievementToast';

interface Flashcard {
  id?: string;
  question: string;
  answer: string;
  isMock?: boolean;
}

interface TestQuestion {
  id: number;
  title: string;
  explanation: string;
  question: string;
  options: string[];
  correct: string;
  hint: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function StudySession() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { playFlipSound, playSuccessSound, playErrorSound, playXpSound } = useSound();

  const formatMessageContent = (content: string) => {
    // Автоматически форматирует английские ключевые слова в одинарных кавычках (например, 'GROUP BY') в маркдаун-бэктэки для красивого кода
    return content.replace(/'([A-Z0-9_ ]+)'/g, '`$1`');
  };

  // Состояния загрузки
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<any[]>([]);
  const [activeMaterial, setActiveMaterial] = useState<any | null>(null);
  
  // Текущая фаза: 'setup' | 'cards' | 'read' | 'quiz' | 'completed'
  const [phase, setPhase] = useState<'setup' | 'cards' | 'read' | 'quiz' | 'completed'>('setup');
  
  // Шаг 1: Карточки
  const [sessionCards, setSessionCards] = useState<Flashcard[]>([]);
  const [cardIdx, setCardIdx] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);
  const [cardStats, setCardStats] = useState({ correct: 0, wrong: 0 });

  // Шаг 2: Чтение + Чат
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Шаг 3: Тест
  const [testQuestions, setTestQuestions] = useState<TestQuestion[]>([]);
  const [quizIdx, setQuizIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [shake, setShake] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  // Награды и финал
  const [showConfetti, setShowConfetti] = useState(false);
  const [achievement, setAchievement] = useState<Achievement | null>(null);
  const [xpGained, setXpGained] = useState(0);

  // Скролл чата
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Первоначальная загрузка
  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    
    Promise.all([
      getMaterials(user.id),
      getDueCards(user.id)
    ]).then(([mats, cards]) => {
      setMaterials(mats);
      
      if (mats.length === 0) {
        setLoading(false);
        return;
      }

      // Проверяем наличие незавершенной сохраненной сессии в localStorage
      const saved = localStorage.getItem(`study_session_${user.id}`);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          const matExists = mats.some(m => m.id === data.activeMaterial?.id);
          if (matExists && data.phase !== 'completed') {
            setPhase(data.phase);
            setCardIdx(data.cardIdx);
            setCardStats(data.cardStats);
            setChatMessages(data.chatMessages);
            setQuizIdx(data.quizIdx);
            setQuizScore(data.quizScore);
            setActiveMaterial(data.activeMaterial);
            setSessionCards(data.sessionCards);
            setTestQuestions(data.testQuestions);
            setXpGained(data.xpGained);
            setSelectedOption(data.selectedOption);
            setIsCorrect(data.isCorrect);
            setShowHint(data.showHint);
            setLoading(false);
            return; // Восстанавливаем состояние и прерываем стандартную инициализацию
          }
        } catch (e) {
          console.error("Ошибка при восстановлении сессии:", e);
        }
      }

      // Выбираем активный материал
      const mat = mats[0];
      setActiveMaterial(mat);

      // Готовим карточки для сессии (Шаг 1)
      let preparedCards: Flashcard[] = [];
      const relatedDueCards = cards.filter(c => c.material_id === mat.id);
      
      if (relatedDueCards.length > 0) {
        // Берем просроченные карточки именно по этой лекции
        preparedCards = relatedDueCards.slice(0, 10);
      } else if (cards.length > 0) {
        // Если по ней нет, берем любые просроченные
        preparedCards = cards.slice(0, 10);
      } else if (mat.flashcards_json && mat.flashcards_json.length > 0) {
        // Если просроченных карточек 0 вообще, берем из кэша лекции (как тренировку)
        preparedCards = mat.flashcards_json.slice(0, 5).map((c: any) => ({
          question: c.question,
          answer: c.answer,
          isMock: true
        }));
      }

      setSessionCards(preparedCards);
      
      // Инициализируем сообщения чата (Шаг 2)
      setChatMessages([
        {
          role: 'assistant',
          content: `Привет, ${user?.user_metadata?.full_name || 'друг'}! Я Форджи 🤖, твой персональный наставник.

Я подготовил сессию по теме **«${mat.title}»**. 

Мы начнем с тренировки ${preparedCards.length} карточек для укрепления памяти, затем разберем выжимку теории, а в конце проверим знания коротким квестом из 3-х вопросов. 

За прохождение ты получишь **+50 XP** и продвинешь свой стрик дней 🔥. Начнем?`
        }
      ]);

      // Подгружаем квесты/миссии для теста (Шаг 3)
      if (mat.missions_json?.missions && mat.missions_json.missions.length > 0) {
        setTestQuestions(mat.missions_json.missions.slice(0, 3));
      } else {
        // Сгенерируем позже, если кэша нет
      }
    })
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [user?.id]);

  // Автоматическое сохранение состояния сессии в localStorage при изменениях
  useEffect(() => {
    if (!user?.id || loading || phase === 'completed') return;
    
    const sessionData = {
      phase,
      cardIdx,
      cardStats,
      chatMessages,
      quizIdx,
      quizScore,
      activeMaterial,
      sessionCards,
      testQuestions,
      xpGained,
      selectedOption,
      isCorrect,
      showHint
    };
    
    localStorage.setItem(`study_session_${user.id}`, JSON.stringify(sessionData));
  }, [
    user?.id, phase, cardIdx, cardStats, chatMessages, quizIdx, 
    quizScore, activeMaterial, sessionCards, testQuestions, 
    xpGained, selectedOption, isCorrect, showHint, loading
  ]);

  // Генерация миссий на лету (если не кэшировано)
  const ensureQuizLoaded = async (mat: any) => {
    if (testQuestions.length > 0) return true;
    
    try {
      const summary = typeof mat.summary_json === 'string'
        ? mat.summary_json
        : (mat.summary_json?.content || '');
      const context = (mat.original_text || summary || '').slice(0, 15000);

      const res = await fetch('/api/missions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context })
      });

      if (!res.ok) throw new Error('Ошибка генерации');
      const data = await res.json();
      
      if (data.missions && data.missions.length > 0) {
        const sliced = data.missions.slice(0, 3);
        setTestQuestions(sliced);
        updateMaterialMissions(mat.id, data.missions);
        if (user?.id) {
          await incrementAIUsage(user.id, 2);
        }
        return true;
      }
    } catch (e) {
      console.error('Ошибка генерации викторины:', e);
    }
    return false;
  };

  const handleStart = () => {
    if (sessionCards.length > 0) {
      setPhase('cards');
    } else {
      setPhase('read');
    }
  };

  // ── ШАГ 1: КАРТОЧКИ ────────────────────────────────────────────────────────

  const handleRevealCard = () => {
    if (!cardRevealed) {
      playFlipSound();
      setCardRevealed(true);
    }
  };

  const handleCardAnswer = (quality: number) => {
    if (!sessionCards[cardIdx]) return;
    
    const card = sessionCards[cardIdx];
    
    // 1. Сразу (синхронно) обновляем UI, чтобы отклик был 0мс
    if (quality >= 3) {
      setCardStats(p => ({ ...p, correct: p.correct + 1 }));
    } else {
      setCardStats(p => ({ ...p, wrong: p.wrong + 1 }));
    }

    if (cardIdx + 1 >= sessionCards.length) {
      playSuccessSound();
      setPhase('read');
    } else {
      setCardIdx(p => p + 1);
      setCardRevealed(false);
    }

    // 2. Фоновые (асинхронные) запросы в Supabase, не блокирующие переключение карточек в UI
    if (card.id && !card.isMock) {
      updateCardProgress(card.id, quality).catch(err => console.error("Error updating card progress:", err));
    }
    
    if (user?.id) {
      updateQuestProgress(user.id, 'review', 1).catch(err => console.error("Error updating quest progress:", err));
      recordStudyActivity(user.id, 1, 0).catch(err => console.error("Error recording study activity:", err));
    }
  };

  // ── ШАГ 2: ЧАТ С AI ────────────────────────────────────────────────────────

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputMessage).trim();
    if (!textToSend || chatLoading || !activeMaterial) return;

    setInputMessage('');
    setChatLoading(true);

    const newUserMessage: ChatMessage = { role: 'user', content: textToSend };
    setChatMessages(prev => [...prev, newUserMessage]);

    const summary = typeof activeMaterial.summary_json === 'string'
      ? activeMaterial.summary_json
      : (activeMaterial.summary_json?.content || '');
    const context = (activeMaterial.original_text || summary || '').slice(0, 15000);

    try {
      if (user?.id) {
        await incrementAIUsage(user.id, 1);
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          context,
          history: chatMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
        })
      });

      if (!res.ok) throw new Error('Ошибка чата');
      const data = await res.json();
      
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Ой, что-то пошло не так с сервером ИИ. Давай я подготовлю квест!' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleGoToQuiz = async () => {
    if (!activeMaterial) return;
    setLoading(true);
    const ok = await ensureQuizLoaded(activeMaterial);
    setLoading(false);

    if (ok || testQuestions.length > 0) {
      setPhase('quiz');
      setSelectedOption(null);
      setIsCorrect(null);
      setShowHint(false);
      setQuizIdx(0);
      setQuizScore(0);
    } else {
      // Если генерация теста полностью упала, завершаем сессию
      handleFinishSession();
    }
  };

  // ── ШАГ 3: ВИКТОРИНА ────────────────────────────────────────────────────────

  const handleOptionClick = (option: string) => {
    if (isCorrect) return;

    setSelectedOption(option);
    const currentQ = testQuestions[quizIdx];
    const correctLetter = currentQ.correct;
    const isCorrectAnswer = option.startsWith(correctLetter);

    if (isCorrectAnswer) {
      setIsCorrect(true);
      setShowHint(false);
      setQuizScore(s => s + 1);
    } else {
      setIsCorrect(false);
      setShowHint(true);
      setShake(true);
      playErrorSound();
      setTimeout(() => setShake(false), 500);
    }
  };

  const handleNextQuiz = () => {
    setSelectedOption(null);
    setIsCorrect(null);
    setShowHint(false);

    if (quizIdx + 1 >= testQuestions.length) {
      handleFinishSession();
    } else {
      setQuizIdx(prev => prev + 1);
    }
  };

  // ── ФИНАЛ: ЗАВЕРШЕНИЕ СЕССИИ ───────────────────────────────────────────────

  const handleFinishSession = async () => {
    setPhase('completed');
    setShowConfetti(true);
    playSuccessSound();

    if (user?.id) {
      localStorage.removeItem(`study_session_${user.id}`);
      try {
        // Начисляем XP (+50 за всю сессию + по 10 за каждый верный ответ)
        const earnedXP = 50 + quizScore * 10;
        setXpGained(earnedXP);
        await addXP(user.id, earnedXP);
        playXpSound();

        // Записываем завершение квестов/активности
        await updateQuestProgress(user.id, 'quiz', 1);
        await recordStudyActivity(user.id, sessionCards.length, 0);

        // Проверяем новые достижения
        const newAchs = await checkAndAwardAchievements(user.id);
        if (newAchs.length > 0) {
          setAchievement({
            id: newAchs[0].id,
            title: newAchs[0].title,
            description: newAchs[0].description,
            icon: newAchs[0].icon,
            xp: newAchs[0].xp
          });
        }
      } catch (err) {
        console.error(err);
      }
    }
    setTimeout(() => setShowConfetti(false), 3000);
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (materials.length === 0) {
    return (
      <div className="p-4 md:p-6 text-center py-20 max-w-md mx-auto space-y-4">
        <AlertCircle className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Библиотека пуста</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Загрузи свой первый конспект или лекцию, и ИИ-наставник Forgey построит индивидуальный план сессии.
        </p>
        <button
          onClick={() => navigate('/analyze')}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition"
        >
          Загрузить первый материал 🚀
        </button>
      </div>
    );
  }

  const summaryText = typeof activeMaterial?.summary_json === 'string'
    ? activeMaterial.summary_json
    : (activeMaterial?.summary_json?.content || '');

  return (
    <div className="p-3 md:p-6 max-w-6xl mx-auto min-h-[90vh] flex flex-col justify-center relative w-full">
      <ConfettiCelebration trigger={showConfetti} type="quest" />
      <AchievementToast achievement={achievement} onClose={() => setAchievement(null)} />

      {/* ── КНОПКА ЗАКРЫТИЯ ── */}
      {phase !== 'completed' && (
        <button
          onClick={() => {
            if (confirm('Вы уверены, что хотите выйти из сессии обучения? Прогресс будет утерян.')) {
              localStorage.removeItem(`study_session_${user?.id}`);
              navigate('/dashboard');
            }
          }}
          className="absolute top-4 right-4 p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-400 transition z-40"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <AnimatePresence mode="wait">
        
        {/* ═══ ФАЗА: SETUP ═══ */}
        {phase === 'setup' && (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="card p-6 md:p-10 text-center relative z-20 space-y-8 max-w-2xl mx-auto shadow-xl"
          >
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center mx-auto shadow-lg text-white text-3xl animate-pulse">
              🔮
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-slate-100 tracking-tight leading-tight">Персональная сессия готовит тебя к победам!</h2>
              <p className="text-base md:text-lg text-slate-600 dark:text-slate-300 max-w-lg mx-auto leading-relaxed">
                Давай закрепим тему <strong className="font-black text-indigo-600 dark:text-indigo-400">«{activeMaterial?.title}»</strong> по методу глубокого погружения.
              </p>
            </div>

            {/* Карточка планов */}
            <div className="max-w-xl mx-auto text-left bg-slate-50 dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl p-7 space-y-6 shadow-inner">
              <h3 className="font-black text-sm md:text-base text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">План урока сегодня:</h3>
              <div className="space-y-5">
                {sessionCards.length > 0 && (
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm md:text-base shrink-0">1</div>
                    <div>
                      <p className="text-base md:text-lg font-black text-slate-800 dark:text-slate-100">Разминка с карточками ({sessionCards.length} шт)</p>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium">Интервальное повторение по алгоритму SM-2</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm md:text-base shrink-0">{sessionCards.length > 0 ? '2' : '1'}</div>
                  <div>
                    <p className="text-base md:text-lg font-black text-slate-800 dark:text-slate-100">Изучение выжимки лекции с AI</p>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium">Краткий конспект и свободные вопросы наставнику</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm md:text-base shrink-0">{sessionCards.length > 0 ? '3' : '2'}</div>
                  <div>
                    <p className="text-base md:text-lg font-black text-slate-800 dark:text-slate-100">Проверочный мини-квест</p>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium">3 вопроса на усвоение с разбором ошибок</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="max-w-md mx-auto pt-2">
              <button
                onClick={handleStart}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-extrabold hover:shadow-lg shadow-indigo-500/20 tracking-wider flex items-center justify-center gap-2 transition active:scale-[0.99] text-base"
              >
                Поехали! 🚀
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ ФАЗА: КАРТОЧКИ (Шаг 1) ═══ */}
        {phase === 'cards' && sessionCards.length > 0 && (
          <motion.div
            key="cards"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6 max-w-2xl mx-auto w-full"
          >
            {/* Шкала шагов */}
            <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 font-bold mb-2">
              <span className="flex items-center gap-1.5"><Brain className="w-5 h-5 text-indigo-500 animate-pulse" /> Шаг 1 из 3 · Повторение карточек</span>
              <span>{cardIdx + 1} / {sessionCards.length}</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${(cardIdx / sessionCards.length) * 100}%` }} />
            </div>

            {/* Карточка */}
            <motion.div
              key={cardIdx}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              className="card min-h-[300px] md:min-h-[360px] p-8 md:p-12 flex flex-col items-center justify-center cursor-pointer relative active:scale-[0.99] transition-all shadow-lg hover:shadow-xl border border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-900/80 backdrop-blur-md"
              onClick={handleRevealCard}
            >
              {sessionCards[cardIdx].isMock && (
                <span className="absolute top-4 left-4 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-md text-[9px] font-black uppercase tracking-wider">
                  Разминка
                </span>
              )}
              <span className="text-xs sm:text-sm font-black uppercase text-indigo-500 dark:text-indigo-400 tracking-wider mb-3">Вопрос</span>
              <div className="text-lg sm:text-xl md:text-2xl font-black text-slate-900 dark:text-slate-100 text-center leading-snug max-w-xl px-2 mb-6 markdown-content">
                <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{sessionCards[cardIdx].question}</ReactMarkdown>
              </div>

              <AnimatePresence>
                {cardRevealed && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: 'hidden' }}
                    className="w-full border-t border-slate-100 dark:border-slate-800/80 pt-6 mt-2"
                  >
                    <span className="text-xs sm:text-sm font-black uppercase text-emerald-500 tracking-wider mb-3 block text-center">Ответ</span>
                    <div className="text-slate-800 dark:text-slate-200 text-sm sm:text-base md:text-lg font-semibold text-center leading-relaxed max-w-xl mx-auto px-2 whitespace-pre-line markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{sessionCards[cardIdx].answer}</ReactMarkdown>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!cardRevealed && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 animate-pulse font-medium">Нажмите, чтобы открыть ответ</p>
              )}
            </motion.div>

            {/* Управление */}
            <div className="pt-3">
              {!cardRevealed ? (
                <button
                  onClick={handleRevealCard}
                  className="w-full h-14 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl font-bold transition text-sm md:text-base tracking-wide shadow-md flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-indigo-500/10 active:scale-[0.99]"
                >
                  Показать ответ
                </button>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => handleCardAnswer(1)}
                    className="h-14 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-400 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
                  >
                    <span>Не знал 😕</span>
                  </button>
                  <button
                    onClick={() => handleCardAnswer(3)}
                    className="h-14 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-400 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
                  >
                    <span>Затруднялся 🤔</span>
                  </button>
                  <button
                    onClick={() => handleCardAnswer(5)}
                    className="h-14 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
                  >
                    <span>Знал! 😎</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══ ФАЗА: ЧТЕНИЕ И AI ЧАТ (Шаг 2) ═══ */}
        {phase === 'read' && (
          <motion.div
            key="read"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full"
          >
            {/* Заголовок сверху на всю ширину */}
            <div className="lg:col-span-12 space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 font-bold">
                <span className="flex items-center gap-1.5"><BookOpen className="w-5 h-5 text-indigo-500" /> Шаг 2 из 3 · Разбор Лекции</span>
                <span>Теория + Консультация</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: '66.6%' }} />
              </div>
            </div>

            {/* Сам конспект лекции (Левая колонка) */}
            <div className="lg:col-span-6 flex flex-col space-y-4">
              <div className="card p-6 md:p-8 flex-1 flex flex-col max-h-[60vh] lg:max-h-[530px] overflow-hidden">
                <h3 className="font-black text-lg md:text-xl text-slate-900 dark:text-slate-100 mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
                  📖 Выжимка теории: {activeMaterial?.title}
                </h3>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar text-sm md:text-base text-slate-700 dark:text-slate-300 leading-relaxed space-y-4 markdown-content">
                  {summaryText ? (
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{summaryText}</ReactMarkdown>
                  ) : (
                    <p className="text-slate-400 text-sm italic">Конспект не содержит краткого содержания. Спроси Форджи ниже!</p>
                  )}
                </div>
              </div>
            </div>

            {/* Чат с наставником Форджи (Правая колонка) */}
            <div className="lg:col-span-6 flex flex-col space-y-4">
              <div className="card p-6 flex flex-col h-[50vh] lg:h-[470px] overflow-hidden bg-slate-900 text-white border-slate-800 shadow-xl">
                <div className="flex items-center gap-3 border-b border-slate-800 pb-3 mb-3 shrink-0">
                  <div className="w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white text-lg">🤖</div>
                  <div>
                    <h4 className="text-sm font-black text-white leading-none">ИИ-Наставник Forgey</h4>
                    <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping shrink-0" />
                      Онлайн в твоем уроке
                    </span>
                  </div>
                </div>

                {/* Сообщения чата */}
                <div className="flex-1 overflow-y-auto p-1 space-y-3 pr-2 custom-scrollbar text-sm leading-relaxed">
                  {chatMessages.map((msg, index) => (
                    <div
                      key={index}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-2.5 rounded-xl ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-tr-none'
                            : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700/40'
                        }`}
                      >
                        <div className="whitespace-pre-wrap markdown-content text-sm text-left">
                          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                            {formatMessageContent(msg.content)}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-slate-800/50 text-slate-400 px-3.5 py-2 rounded-xl rounded-tl-none border border-slate-700/40 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Быстрые подсказки-таблетки */}
                <div className="flex gap-1.5 overflow-x-auto pb-2 pt-2 border-t border-slate-800/80 shrink-0 select-none custom-scrollbar">
                  {[
                    'Объясни на примерах',
                    '3 главных вывода',
                    'Где применить в жизни?'
                  ].map(pill => (
                    <button
                      key={pill}
                      disabled={chatLoading}
                      onClick={() => handleSendMessage(pill)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-lg text-xs text-indigo-300 font-bold whitespace-nowrap transition disabled:opacity-50 shrink-0 active:scale-[0.98]"
                    >
                      {pill}
                    </button>
                  ))}
                </div>

                {/* Ввод сообщения */}
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                  className="flex gap-2 pt-2 border-t border-slate-800 shrink-0"
                >
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={e => setInputMessage(e.target.value)}
                    placeholder="Задай вопрос по лекции..."
                    disabled={chatLoading}
                    className="flex-1 bg-slate-800 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition"
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !inputMessage.trim()}
                    className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white flex items-center justify-center transition shrink-0 active:scale-[0.96]"
                  >
                    <Send className="w-4.5 h-4.5" />
                  </button>
                </form>
              </div>

              {/* Кнопка далее */}
              <button
                onClick={handleGoToQuiz}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-1.5 shadow-md"
              >
                Всё понял, к мини-тесту! <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ ФАЗА: ТЕСТ (Шаг 3) ═══ */}
        {phase === 'quiz' && (
          <motion.div
            key="quiz"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6 max-w-4xl mx-auto w-full px-2 md:px-4"
          >
            {/* Шкала викторины */}
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-bold mb-1">
              <span className="flex items-center gap-1"><HelpCircle className="w-4 h-4 text-indigo-500" /> Шаг 3 из 3 · Проверочный квест</span>
              <span>{quizIdx + 1} / {testQuestions.length} вопросов</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${((quizIdx) / testQuestions.length) * 100}%` }} />
            </div>

            {/* Карточка квеста */}
            {testQuestions.length > 0 ? (
              <motion.div
                animate={shake ? { x: [-10, 10, -10, 10, 0] } : {}}
                transition={{ duration: 0.4 }}
                className="card p-4 md:p-6 space-y-4 shadow-md"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-full text-[9px] font-black uppercase tracking-wider">
                    Миссия {quizIdx + 1}: {testQuestions[quizIdx].title}
                  </span>
                </div>

                <div className="text-base sm:text-lg md:text-xl font-extrabold text-slate-900 dark:text-slate-50 leading-snug markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{testQuestions[quizIdx].question}</ReactMarkdown>
                </div>

                {/* Варианты ответов */}
                <div className="grid grid-cols-1 gap-2.5 pt-2">
                  {testQuestions[quizIdx].options.map((opt) => {
                    const isThisSelected = selectedOption === opt;
                    const isCorrectAnswer = opt.startsWith(testQuestions[quizIdx].correct);

                    let btnStyle = "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800";
                    
                    if (selectedOption) {
                      if (isThisSelected) {
                        btnStyle = isCorrectAnswer
                          ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500/20 font-bold"
                          : "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-300 ring-2 ring-rose-500/20 font-bold";
                      } else if (isCorrectAnswer && !isCorrect) {
                        btnStyle = "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 opacity-60";
                      } else {
                        btnStyle = "bg-slate-50 dark:bg-slate-900 border-transparent text-slate-400 dark:text-slate-500 opacity-40 cursor-default";
                      }
                    }

                    return (
                      <button
                        key={opt}
                        onClick={() => handleOptionClick(opt)}
                        disabled={isCorrect === true}
                        className={`w-full px-5 py-4 rounded-xl border text-left text-sm sm:text-base font-black transition-all duration-200 flex justify-between items-center ${btnStyle}`}
                      >
                        <span>{opt}</span>
                        {selectedOption && isThisSelected && (
                          isCorrectAnswer
                            ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                            : <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Подсказки и комментарии */}
                <AnimatePresence>
                  {showHint && testQuestions[quizIdx].hint && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: 'hidden' }}
                      className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl mt-3"
                    >
                      <div className="p-3.5 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                        <AlertCircle className="w-4.5 h-4.5 shrink-0 text-amber-500 mt-0.5" />
                        <div>
                          <span className="font-extrabold block mb-0.5">💡 Подсказка Forgey:</span>
                          <div className="mb-2 markdown-content text-xs md:text-sm">
                            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                              {testQuestions[quizIdx].hint}
                            </ReactMarkdown>
                          </div>
                          <span className="text-[9px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 inline-block animate-pulse">
                            👉 Выберите другой вариант
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Кнопка перехода к следующему */}
                {isCorrect && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="pt-2"
                  >
                    <button
                      onClick={handleNextQuiz}
                      className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-1.5 shadow-md"
                    >
                      {quizIdx + 1 >= testQuestions.length ? 'Завершить урок 🎉' : 'К следующей миссии →'}
                    </button>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <div className="card p-8 text-center space-y-4">
                <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin mx-auto" />
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Создаем проверочный тест по лекции...</h3>
                <p className="text-xs text-slate-400">Форджи преобразует сложные термины в викторину</p>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══ ФАЗА: COMPLETED (Урок завершен) ═══ */}
        {phase === 'completed' && (
          <motion.div
            key="completed"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="card p-5 md:p-10 text-center bg-gradient-to-br from-indigo-50 to-teal-50 dark:from-slate-900/30 dark:to-teal-950/20 border-indigo-100 dark:border-slate-800 shadow-xl relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />

            {/* Кубок */}
            <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white shadow-xl relative overflow-hidden">
              <div className="absolute inset-0 bg-white/10 rounded-full scale-90 border border-dashed border-white/50 animate-spin-slow" />
              <Trophy className="w-10 h-10 animate-bounce" />
            </div>

            <h2 className="text-3xl font-black text-indigo-800 dark:text-indigo-300 mb-3 flex items-center justify-center gap-2.5">
              Дневная сессия завершена!
              <Sparkles className="w-7 h-7 text-amber-500 animate-pulse" />
            </h2>
            
            <p className="text-slate-600 dark:text-slate-300 text-sm md:text-base max-w-lg mx-auto mb-6 leading-relaxed">
              Отличная работа! Ты успешно прошёл интервальное повторение, проработал теорию лекции <strong className="font-extrabold text-indigo-600 dark:text-indigo-400">«{activeMaterial?.title}»</strong> и ответил на проверочные вопросы. Твой стрик дней под защитой 🔥!
            </p>

            {/* Награды */}
            <div className="flex justify-center gap-4 flex-wrap mb-8">
              <div className="bg-indigo-600 text-white font-extrabold px-6 py-3.5 rounded-2xl shadow-md flex items-center gap-2 border border-indigo-500/40">
                <Sparkles className="w-4.5 h-4.5 text-amber-300 animate-pulse" />
                <span className="text-sm tracking-wider">НАГРАДА: +{xpGained} XP</span>
              </div>
              <div className="bg-orange-500 text-white font-extrabold px-6 py-3.5 rounded-2xl shadow-md flex items-center gap-2 border border-orange-400/40">
                <Flame className="w-4.5 h-4.5 text-white animate-pulse" />
                <span className="text-sm tracking-wider">СТРИК ПОДТВЕРЖДЕН 🔥</span>
              </div>
            </div>

            {/* Управление */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-sm mx-auto">
              <button
                onClick={() => navigate('/dashboard')}
                className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
              >
                На дашборд
              </button>
              <button
                onClick={() => {
                  if (user?.id) {
                    localStorage.removeItem(`study_session_${user.id}`);
                  }
                  setPhase('setup');
                  setCardIdx(0);
                  setCardRevealed(false);
                  setCardStats({ correct: 0, wrong: 0 });
                  setQuizIdx(0);
                  setQuizScore(0);
                  setSelectedOption(null);
                  setIsCorrect(null);
                }}
                className="px-6 py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-750 transition"
              >
                Пройти ещё раз ⚡
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
