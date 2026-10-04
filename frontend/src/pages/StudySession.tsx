import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import { Flame, Trophy, X, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSound } from '../hooks/useSound';
import { getDueCards, updateCardProgress } from '../api/flashcards';
import { getMaterials, updateMaterialMissions } from '../api/materials';
import { addXP, recordStudyActivity } from '../api/quests';
import { incrementAIUsage } from '../api/limits';
import { newEventId } from '../api/learning';
import '../styles/paper.css';
import './StudySession.css';

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

// Анализ сохраняет { flashcards: [...] }, старые материалы — просто массив карточек.
function materialPracticeCards(flashcardsJson: unknown): Flashcard[] {
  const items: unknown[] = Array.isArray(flashcardsJson)
    ? flashcardsJson
    : Array.isArray((flashcardsJson as { flashcards?: unknown } | null)?.flashcards)
      ? (flashcardsJson as { flashcards: unknown[] }).flashcards
      : [];
  return items
    .filter((card: any) => typeof card?.question === 'string' && card.question.trim() && typeof card?.answer === 'string' && card.answer.trim())
    .map((card: any) => ({ question: card.question, answer: card.answer, isMock: true }));
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
  const [cardProcessing, setCardProcessing] = useState(false);
  const [cardSaveError, setCardSaveError] = useState<string | null>(null);
  const cardProcessingRef = useRef(false);
  const [reviewSessionId] = useState(() => newEventId());
  /** client_event_id of an answer whose save has not succeeded yet: a retry reuses it. */
  const pendingEventIds = useRef(new Map<string, string>());

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
      const practiceCards = materialPracticeCards(mat.flashcards_json);

      if (relatedDueCards.length > 0) {
        // Берем просроченные карточки именно по этой лекции
        preparedCards = relatedDueCards.slice(0, 10);
      } else if (cards.length > 0) {
        // Если по ней нет, берем любые просроченные
        preparedCards = cards.slice(0, 10);
      } else if (practiceCards.length > 0) {
        // Если просроченных карточек 0 вообще, берем из кэша лекции (как тренировку)
        preparedCards = practiceCards.slice(0, 5);
      }

      setSessionCards(preparedCards);
      
      // Инициализируем сообщения чата (Шаг 2)
      setChatMessages([
        {
          role: 'assistant',
          content: `Привет, ${user?.user_metadata?.full_name || 'друг'}! Сессия по теме **«${mat.title}»**.

${preparedCards.length > 0 ? `Сначала повторим карточки (${preparedCards.length} шт.), затем разберём` : 'Сначала разберём'} главное из теории, а в конце ответим на 3 проверочных вопроса. Начнём?`
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

  const handleCardAnswer = async (quality: number) => {
    if (!sessionCards[cardIdx] || cardProcessingRef.current) return;
    
    const card = sessionCards[cardIdx];
    cardProcessingRef.current = true;
    setCardProcessing(true);
    setCardSaveError(null);

    // Only a card with a progress row is a review; practice cards from the material are not saved.
    const savesProgress = Boolean(card.id && !card.isMock);
    try {
      if (savesProgress && card.id) {
        const eventId = pendingEventIds.current.get(card.id) ?? newEventId();
        pendingEventIds.current.set(card.id, eventId);
        await updateCardProgress(card.id, quality, { clientEventId: eventId, sessionId: reviewSessionId });
        pendingEventIds.current.delete(card.id);
      } else if (!card.isMock) {
        throw new Error('Study card is missing its database id.');
      }

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

      if (user?.id && savesProgress) {
        recordStudyActivity(user.id, 1, 0).catch(err => console.error('Error recording study activity:', err));
      }
    } catch (error) {
      console.error('Error saving card progress:', error);
      setCardSaveError('Ответ не сохранён. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      cardProcessingRef.current = false;
      setCardProcessing(false);
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
    playSuccessSound();

    if (user?.id) {
      localStorage.removeItem(`study_session_${user.id}`);
      try {
        // Начисляем XP (+50 за всю сессию + по 10 за каждый верный ответ)
        const earnedXP = 50 + quizScore * 10;
        setXpGained(earnedXP);
        await addXP(user.id, earnedXP);
        playXpSound();
        // Карточки уже записаны в активность по одной, при каждом сохранённом ответе.
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (loading) return (
    <div className="sf-page ss">
      <div className="ss-wrap ss-state" role="status" aria-label="Загружаем сессию">
        <p className="ss-quiet">Загружаем…</p>
      </div>
    </div>
  );

  if (materials.length === 0) {
    return (
      <div className="sf-page ss">
        <div className="ss-wrap ss-state">
          <section className="ss-card ss-empty">
            <h2 className="ss-h2">Библиотека пуста</h2>
            <p className="ss-text">Загрузи свой первый конспект или лекцию, и Meldy составит план учебной сессии.</p>
            <button type="button" onClick={() => navigate('/analyze')} className="sf-primary ss-gap">
              Загрузить первый материал
            </button>
          </section>
        </div>
      </div>
    );
  }

  const summaryText = typeof activeMaterial?.summary_json === 'string'
    ? activeMaterial.summary_json
    : (activeMaterial?.summary_json?.content || '');
  const rise = { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } };

  return (
    <MotionConfig reducedMotion="user">
    <div className="sf-page ss">
      <div className="ss-wrap" data-wide={phase === 'read' ? '' : undefined}>
      {/* ── КНОПКА ЗАКРЫТИЯ ── */}
      {phase !== 'completed' && (
        <div className="ss-close-row">
          <button
            type="button"
            aria-label="Выйти из сессии"
            title="Выйти из сессии"
            onClick={() => {
              if (confirm('Вы уверены, что хотите выйти из сессии обучения? Прогресс будет утерян.')) {
                localStorage.removeItem(`study_session_${user?.id}`);
                navigate('/dashboard');
              }
            }}
            className="ss-close"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* ═══ ФАЗА: SETUP ═══ */}
        {phase === 'setup' && (
          <motion.section key="setup" {...rise} className="ss-card ss-setup">
            <h1 className="ss-h1">Персональная сессия готовит тебя к победам!</h1>
            <p className="ss-lede">
              Давай закрепим тему <strong className="ss-topic">«{activeMaterial?.title}»</strong> по методу глубокого погружения.
            </p>

            {/* Карточка планов */}
            <div className="ss-plan">
              <h2 className="ss-label">План урока сегодня:</h2>
              <ol className="ss-steps">
                {sessionCards.length > 0 && (
                  <li className="ss-stepline">
                    <span className="ss-num" aria-hidden="true">1</span>
                    <span>
                      <span className="ss-step-t">Разминка с карточками ({sessionCards.length} шт)</span>
                      <span className="ss-step-s">Интервальное повторение по алгоритму SM-2</span>
                    </span>
                  </li>
                )}
                <li className="ss-stepline">
                  <span className="ss-num" aria-hidden="true">{sessionCards.length > 0 ? '2' : '1'}</span>
                  <span>
                    <span className="ss-step-t">Изучение выжимки лекции с AI</span>
                    <span className="ss-step-s">Краткий конспект и свободные вопросы наставнику</span>
                  </span>
                </li>
                <li className="ss-stepline">
                  <span className="ss-num" aria-hidden="true">{sessionCards.length > 0 ? '3' : '2'}</span>
                  <span>
                    <span className="ss-step-t">Проверочный мини-квест</span>
                    <span className="ss-step-s">3 вопроса на усвоение с разбором ошибок</span>
                  </span>
                </li>
              </ol>
            </div>

            <button type="button" onClick={handleStart} className="sf-primary ss-go">
              Поехали!
            </button>
          </motion.section>
        )}

        {/* ═══ ФАЗА: КАРТОЧКИ (Шаг 1) ═══ */}
        {phase === 'cards' && sessionCards.length > 0 && (
          <motion.div key="cards" {...rise} className="ss-col">
            {/* Шкала шагов */}
            <div className="ss-top">
              <span className="ss-step">Шаг 1 из 3 · Повторение карточек</span>
              <span className="ss-count">{cardIdx + 1} / {sessionCards.length}</span>
            </div>
            <div className="ss-progress" aria-hidden="true">
              <i style={{ width: `${Math.max(cardIdx / sessionCards.length, 0.02) * 100}%` }} />
            </div>

            {/* Карточка */}
            <motion.section
              key={cardIdx}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="ss-card ss-flash"
              onClick={handleRevealCard}
              data-revealed={cardRevealed ? '' : undefined}
            >
              {sessionCards[cardIdx].isMock && <span className="ss-chip">Разминка</span>}
              <span className="ss-flash-l">Вопрос</span>
              <div className="ss-flash-q markdown-content">
                <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{sessionCards[cardIdx].question}</ReactMarkdown>
              </div>

              <AnimatePresence>
                {cardRevealed && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="ss-flash-back">
                      <span className="ss-flash-l">Ответ</span>
                      <div className="ss-flash-a markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{sessionCards[cardIdx].answer}</ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!cardRevealed && <p className="ss-flash-hint">Нажмите, чтобы открыть ответ</p>}
            </motion.section>

            {/* Управление */}
            <div className="ss-controls" aria-busy={cardProcessing}>
              {!cardRevealed ? (
                <button type="button" onClick={handleRevealCard} className="sf-primary">
                  Показать ответ
                </button>
              ) : (
                <div className="ss-grades">
                  <button type="button" onClick={() => handleCardAnswer(1)} disabled={cardProcessing} className="ss-grade" data-tone="no">
                    <span className="ss-dot" aria-hidden="true" />
                    Не знал
                  </button>
                  <button type="button" onClick={() => handleCardAnswer(3)} disabled={cardProcessing} className="ss-grade" data-tone="hard">
                    <span className="ss-dot" aria-hidden="true" />
                    Затруднялся
                  </button>
                  <button type="button" onClick={() => handleCardAnswer(5)} disabled={cardProcessing} className="ss-grade" data-tone="yes">
                    <span className="ss-dot" aria-hidden="true" />
                    Знал!
                  </button>
                </div>
              )}
              {cardProcessing && <p role="status" aria-live="polite" className="ss-quiet ss-gap-s">Сохраняем ответ…</p>}
              {cardSaveError && <p role="alert" className="ss-alert">{cardSaveError}</p>}
            </div>
          </motion.div>
        )}

        {/* ═══ ФАЗА: ЧТЕНИЕ И AI ЧАТ (Шаг 2) ═══ */}
        {phase === 'read' && (
          <motion.div key="read" {...rise}>
            {/* Заголовок сверху на всю ширину */}
            <div className="ss-top">
              <span className="ss-step">Шаг 2 из 3 · Разбор Лекции</span>
              <span className="ss-count">Теория + Консультация</span>
            </div>
            <div className="ss-progress" aria-hidden="true">
              <i style={{ width: '66.6%' }} />
            </div>

            <div className="ss-read">
              {/* Сам конспект лекции (Левая колонка) */}
              <section className="ss-card ss-summary">
                <h3 className="ss-summary-h">Выжимка теории: {activeMaterial?.title}</h3>
                <div className="ss-summary-body markdown-content">
                  {summaryText ? (
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{summaryText}</ReactMarkdown>
                  ) : (
                    <p className="ss-quiet">Конспект не содержит краткого содержания. Спроси Meldy ниже!</p>
                  )}
                </div>
              </section>

              {/* Чат с наставником Meldy (правая колонка) */}
              <div className="ss-side">
                <section className="ss-card ss-chat" aria-label="ИИ-наставник Meldy">
                  <div className="ss-chat-head">
                    <span className="ss-ava" aria-hidden="true">M</span>
                    <div>
                      <h4 className="ss-chat-h">ИИ-наставник Meldy</h4>
                      <span className="ss-online">Онлайн в твоем уроке</span>
                    </div>
                  </div>

                  {/* Сообщения чата */}
                  <div className="ss-msgs">
                    {chatMessages.map((msg, index) => (
                      <div key={index} className="ss-msg" data-role={msg.role}>
                        <div className={`ss-bubble markdown-content${msg.role === 'user' ? ' white-text' : ''}`}>
                          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                            {formatMessageContent(msg.content)}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="ss-msg" data-role="assistant">
                        <div className="ss-bubble ss-typing" aria-label="Meldy пишет">
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Быстрые подсказки-таблетки */}
                  <div className="ss-prompts">
                    {[
                      'Объясни на примерах',
                      '3 главных вывода',
                      'Где применить в жизни?'
                    ].map(pill => (
                      <button key={pill} type="button" disabled={chatLoading} onClick={() => handleSendMessage(pill)} className="ss-prompt">
                        {pill}
                      </button>
                    ))}
                  </div>

                  {/* Ввод сообщения */}
                  <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="ss-form">
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={e => setInputMessage(e.target.value)}
                      placeholder="Задай вопрос по лекции..."
                      aria-label="Вопрос по лекции"
                      disabled={chatLoading}
                      className="sf-input ss-input"
                    />
                    <button type="submit" disabled={chatLoading || !inputMessage.trim()} className="ss-send" aria-label="Отправить">
                      <Send aria-hidden="true" />
                    </button>
                  </form>
                </section>

                {/* Кнопка далее */}
                <button type="button" onClick={handleGoToQuiz} className="sf-primary ss-next">
                  Всё понял, к мини-тесту!
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ═══ ФАЗА: ТЕСТ (Шаг 3) ═══ */}
        {phase === 'quiz' && (
          <motion.div key="quiz" {...rise} className="ss-col">
            {/* Шкала викторины */}
            <div className="ss-top">
              <span className="ss-step">Шаг 3 из 3 · Проверочный квест</span>
              <span className="ss-count">{quizIdx + 1} / {testQuestions.length} вопросов</span>
            </div>
            <div className="ss-progress" aria-hidden="true">
              <i style={{ width: `${Math.max(quizIdx / Math.max(1, testQuestions.length), 0.02) * 100}%` }} />
            </div>

            {/* Карточка квеста */}
            {testQuestions.length > 0 ? (
              <motion.section animate={shake ? { x: [-10, 10, -10, 10, 0] } : {}} transition={{ duration: 0.4 }} className="ss-card ss-quiz">
                <span className="ss-flag">
                  Миссия {quizIdx + 1}: {testQuestions[quizIdx].title}
                </span>

                <div className="ss-quiz-q markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{testQuestions[quizIdx].question}</ReactMarkdown>
                </div>

                {/* Варианты ответов */}
                <div className="ss-opts">
                  {testQuestions[quizIdx].options.map((opt) => {
                    const isThisSelected = selectedOption === opt;
                    const isCorrectAnswer = opt.startsWith(testQuestions[quizIdx].correct);
                    let state: string | undefined;
                    if (selectedOption) {
                      if (isThisSelected) state = isCorrectAnswer ? 'right' : 'wrong';
                      else if (isCorrectAnswer && !isCorrect) state = 'hint';
                      else state = 'faded';
                    }

                    return (
                      <button key={opt} type="button" onClick={() => handleOptionClick(opt)} disabled={isCorrect === true} className="ss-opt" data-state={state}>
                        <span>{opt}</span>
                        {selectedOption && isThisSelected && (
                          isCorrectAnswer
                            ? <CheckCircle2 className="ss-opt-i" aria-hidden="true" />
                            : <AlertCircle className="ss-opt-i" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Подсказки и комментарии */}
                <AnimatePresence>
                  {showHint && testQuestions[quizIdx].hint && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                      <div className="ss-hint">
                        <span className="ss-hint-h">Подсказка Meldy:</span>
                        <div className="ss-hint-t markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                            {testQuestions[quizIdx].hint}
                          </ReactMarkdown>
                        </div>
                        <span className="ss-hint-tag">Выберите другой вариант</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Кнопка перехода к следующему */}
                {isCorrect && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="ss-next-row">
                    <button type="button" onClick={handleNextQuiz} className="sf-primary">
                      {quizIdx + 1 >= testQuestions.length ? 'Завершить урок' : 'К следующей миссии'}
                    </button>
                  </motion.div>
                )}
              </motion.section>
            ) : (
              <section className="ss-card ss-quiz ss-wait" role="status">
                <h3 className="ss-h3">Создаем проверочный тест по лекции...</h3>
                <p className="ss-quiet">Meldy превратит сложные термины в короткую викторину</p>
              </section>
            )}
          </motion.div>
        )}

        {/* ═══ ФАЗА: COMPLETED (Урок завершен) ═══ */}
        {phase === 'completed' && (
          <motion.section key="completed" {...rise} className="ss-card ss-done">
            {/* Кубок */}
            <div className="ss-trophy" aria-hidden="true">
              <Trophy />
            </div>

            <h2 className="ss-h1">Дневная сессия завершена!</h2>

            <p className="ss-lede">
              Отличная работа! Ты успешно прошёл интервальное повторение, проработал теорию лекции <strong className="ss-topic">«{activeMaterial?.title}»</strong> и ответил на проверочные вопросы. Занятие засчитано в серию дней.
            </p>

            {/* Награды */}
            <div className="ss-rewards">
              <span className="ss-pill" data-tone="blue">Награда: +{xpGained} XP</span>
              <span className="ss-pill" data-tone="yellow">
                <Flame aria-hidden="true" />
                Серия дней продолжается
              </span>
            </div>

            {/* Управление */}
            <div className="ss-done-acts">
              <button type="button" onClick={() => navigate('/dashboard')} className="sf-primary">
                На дашборд
              </button>
              <button
                type="button"
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
                className="sf-secondary"
              >
                Пройти ещё раз
              </button>
            </div>
          </motion.section>
        )}

      </AnimatePresence>
      </div>
    </div>
    </MotionConfig>
  );
}
