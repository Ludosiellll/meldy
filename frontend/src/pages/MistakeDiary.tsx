import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, RefreshCw, Trash2, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { useSound } from '../hooks/useSound';
import { addXP } from '../api/quests';
import confetti from 'canvas-confetti';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import '../styles/paper.css';
import './MistakeDiary.css';

interface Mistake {
  id: string;
  question: string;
  correct_answer: string;
  student_answer: string;
  topic: string;
  is_resolved: boolean;
  created_at: string;
  material_id: string | null;
  /** 'quiz' (a test), 'oral_ticket' (an answer to an exam ticket, spoken or typed), 'professor' (the old oral exam). */
  origin?: string | null;
}

const PRACTICE_BUSY = 'Сервис ИИ сейчас занят. Подождите минуту и попробуйте ещё раз.';
const PRACTICE_FAILED = 'Не удалось подготовить задания. Попробуйте ещё раз.';

/**
 * Where a mistake came from, in the words of the screens that made it. A ticket can be answered by
 * voice or in writing and both count the same, so the label names the ticket, not the voice
 * (Jury_Check item 11).
 */
export function mistakeOriginLabel(origin: string | null | undefined): string {
  if (origin === 'quiz') return 'Тест';
  if (origin === 'oral_ticket') return 'Ответ на билет';
  return 'Устный экзамен';
}

interface MistakePracticeQuestion {
  id: number | string;
  mistake_id: string;
  question: string;
  options: string[];
  correct: 'A' | 'B' | 'C' | 'D';
  explanation: string;
}

export default function MistakeDiary() {
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const { verifyEnergy } = useEnergyConfirm();
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { playFlipSound, playSuccessSound, playErrorSound, playXpSound } = useSound();

  // Состояния для AI-Работы над ошибками
  const [isPracticing, setIsPracticing] = useState(false);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceQuestions, setPracticeQuestions] = useState<MistakePracticeQuestion[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finalCorrectCount, setFinalCorrectCount] = useState(0);
  const [correctQuestionIndexes, setCorrectQuestionIndexes] = useState<number[]>([]);
  const [practiceFinished, setPracticeFinished] = useState(false);
  const [finishingPractice, setFinishingPractice] = useState(false);
  const [practiceSaveError, setPracticeSaveError] = useState(false);
  const [practiceXpError, setPracticeXpError] = useState(false);
  const [practiceResolvedCount, setPracticeResolvedCount] = useState(0);
  const [practiceMistakeCount, setPracticeMistakeCount] = useState(0);
  const [practiceXpAwarded, setPracticeXpAwarded] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  /**
   * Set before the first await: the limit check takes two reads, and a second press in that time
   * must not start a second request and a second charge.
   */
  const startingRef = useRef(false);

  const startPractice = async () => {
    if (startingRef.current) return;
    const openMistakes = mistakes.filter(m => !m.is_resolved);
    if (openMistakes.length === 0) return;

    // Берём до 5 неисправленных ошибок
    const toPractice = openMistakes.slice(0, 5);

    startingRef.current = true;
    setPracticeLoading(true);
    setPracticeError(null);
    try {
      if (user?.id) {
        const ok = await verifyEnergy(user.id, 2, 'Работа над ошибками');
        if (!ok) return;
      }

      const res = await fetch('/api/mistakes/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mistakes: toPractice }),
      });
      if (res.status === 429) {
        setPracticeError(PRACTICE_BUSY);
        return;
      }
      if (!res.ok) throw new Error(`practice ${res.status}`);
      const data = await res.json();
      const allowedMistakeIds = new Set(toPractice.map(mistake => mistake.id));
      const questions = data?.practice;
      const isValidPractice = Array.isArray(questions) && questions.length > 0 && questions.every((question: Partial<MistakePracticeQuestion>) =>
        typeof question.id === 'number' || typeof question.id === 'string'
      ) && questions.every((question: Partial<MistakePracticeQuestion>) =>
        typeof question.mistake_id === 'string' &&
        allowedMistakeIds.has(question.mistake_id) &&
        typeof question.question === 'string' && question.question.trim().length > 0 &&
        Array.isArray(question.options) && question.options.length === 4 &&
        question.options.every(option => typeof option === 'string' && option.trim().length > 0) &&
        ['A', 'B', 'C', 'D'].includes(question.correct ?? '') &&
        question.options.some(option => option.startsWith(question.correct ?? '\0')) &&
        typeof question.explanation === 'string' && question.explanation.trim().length > 0
      );

      if (!isValidPractice) throw new Error('Invalid practice response');

      // Энергия списывается только за задания, которые действительно можно пройти.
      if (user?.id) await incrementAIUsage(user.id, 2);

      setPracticeQuestions(questions);
      setIsPracticing(true);
      setCurrentQIndex(0);
      setSelectedOption(null);
      setShowExplanation(false);
      setCorrectCount(0);
      setFinalCorrectCount(0);
      setCorrectQuestionIndexes([]);
      setPracticeFinished(false);
      setFinishingPractice(false);
      setPracticeSaveError(false);
      setPracticeXpError(false);
      setPracticeResolvedCount(0);
      setPracticeMistakeCount(toPractice.length);
      setPracticeXpAwarded(false);
    } catch (e) {
      console.error('Mistakes practice failed:', e);
      setPracticeError(PRACTICE_FAILED);
    } finally {
      startingRef.current = false;
      setPracticeLoading(false);
    }
  };

  const checkAnswer = (opt: string) => {
    if (selectedOption) return; // Запрещаем повторный выбор
    setSelectedOption(opt);
    setShowExplanation(true);
    const q = practiceQuestions[currentQIndex];
    if (opt.startsWith(q.correct)) {
      playFlipSound(); // Pleasant sound for correct
      setCorrectCount(prev => prev + 1);
      setCorrectQuestionIndexes(prev => prev.includes(currentQIndex) ? prev : [...prev, currentQIndex]);
    } else {
      playErrorSound();
    }
  };

  const nextQuestion = async () => {
    if (currentQIndex + 1 < practiceQuestions.length) {
      setCurrentQIndex(prev => prev + 1);
      setSelectedOption(null);
      setShowExplanation(false);
    } else {
      setFinishingPractice(true);

      const correctIndexes = new Set(correctQuestionIndexes);
      if (selectedOption?.startsWith(practiceQuestions[currentQIndex]?.correct)) {
        correctIndexes.add(currentQIndex);
      }
      const finalCorrect = correctIndexes.size;
      const finalRate = finalCorrect / practiceQuestions.length;
      setFinalCorrectCount(finalCorrect);

      const questionIndexesByMistake = new Map<string, number[]>();
      practiceQuestions.forEach((question, index) => {
        const indexes = questionIndexesByMistake.get(question.mistake_id) ?? [];
        indexes.push(index);
        questionIndexesByMistake.set(question.mistake_id, indexes);
      });
      const resolvedIds = [...questionIndexesByMistake]
        .filter(([, indexes]) => indexes.every(index => correctIndexes.has(index)))
        .map(([mistakeId]) => mistakeId);

      if (resolvedIds.length > 0) {
        try {
          const { error } = await supabase
            .from('mistake_diary')
            .update({ is_resolved: true, resolved_at: new Date().toISOString() })
            .in('id', resolvedIds);
          if (error) throw error;
        } catch {
          setPracticeSaveError(true);
          setPracticeFinished(true);
          setFinishingPractice(false);
          return;
        }

        setMistakes(prev => prev.map(mistake => resolvedIds.includes(mistake.id)
          ? { ...mistake, is_resolved: true }
          : mistake));
        setPracticeResolvedCount(resolvedIds.length);
        playSuccessSound();
      }

      if (user && resolvedIds.length > 0 && finalRate >= 0.6) {
        try {
          await addXP(user.id, 50);
          setPracticeXpAwarded(true);
          setTimeout(() => playXpSound(), 800);
          confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
        } catch {
          setPracticeXpError(true);
        }
      }

      setPracticeFinished(true);
      setFinishingPractice(false);
    }
  };

  const fetchMistakes = async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('mistake_diary')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setMistakes(data || []);
    } catch (e) {
      console.error('Loading the mistake diary failed:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMistakes();
  }, [user?.id]);

  const markResolved = async (id: string) => {
    await supabase
      .from('mistake_diary')
      .update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', id);
    setMistakes(prev => prev.map(m => m.id === id ? { ...m, is_resolved: true } : m));
  };

  const deleteMistake = async (id: string) => {
    await supabase.from('mistake_diary').delete().eq('id', id);
    setMistakes(prev => prev.filter(m => m.id !== id));
  };

  const filtered = mistakes.filter(m => {
    if (filter === 'open') return !m.is_resolved;
    if (filter === 'resolved') return m.is_resolved;
    return true;
  });

  const openCount = mistakes.filter(m => !m.is_resolved).length;
  const resolvedCount = mistakes.filter(m => m.is_resolved).length;

  const FILTERS: Array<{ key: 'all' | 'open' | 'resolved'; label: string }> = [
    { key: 'all', label: 'Все' },
    { key: 'open', label: 'Открытые' },
    { key: 'resolved', label: 'Исправленные' },
  ];

  return (
    <MotionConfig reducedMotion="user">
    <div className="sf-page md">
      {/* ═══ РЕЖИМ ПРАКТИКИ ════════════════════════════════════════════════════ */}
      {isPracticing ? (
        <div className="md-practice">
          <AnimatePresence mode="wait">
            {!practiceFinished ? (
              <motion.div
                key={`q-${currentQIndex}`}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Хедер прогресса */}
                <div className="md-ptop">
                  <p className="md-pwhere">
                    <b>
                      Вопрос {currentQIndex + 1} из {practiceQuestions.length}
                    </b>
                    <span>Верных ответов: {correctCount}</span>
                  </p>
                  <button
                    type="button"
                    className="sf-link md-stop"
                    data-muted=""
                    onClick={async () => {
                      if (await confirm({ title: 'Прервать', message: 'Вы уверены, что хотите прервать работу над ошибками? Прогресс не сохранится.', type: 'warning' })) {
                        setIsPracticing(false);
                      }
                    }}
                  >
                    Прервать
                  </button>
                </div>
                <div className="md-progress" aria-hidden="true">
                  <i style={{ width: `${((currentQIndex + (selectedOption ? 1 : 0)) / Math.max(1, practiceQuestions.length)) * 100}%` }} />
                </div>

                {/* Карточка вопроса */}
                <section className="md-card md-qcard">
                  <h2 className="md-qtext">{practiceQuestions[currentQIndex]?.question}</h2>

                  {/* Опции */}
                  <div className="md-opts">
                    {practiceQuestions[currentQIndex]?.options.map((opt: string) => {
                      const isSelected = selectedOption === opt;
                      const isCorrect = opt.startsWith(practiceQuestions[currentQIndex]?.correct);
                      const hasAnswered = selectedOption !== null;
                      const state = !hasAnswered ? undefined : isCorrect ? 'right' : isSelected ? 'wrong' : 'faded';

                      return (
                        <button key={opt} type="button" disabled={hasAnswered} onClick={() => checkAnswer(opt)} className="md-opt" data-state={state}>
                          <span className="md-opt-t">{opt}</span>
                          {hasAnswered && isCorrect && <span className="md-opt-v">верный ответ</span>}
                          {hasAnswered && isSelected && !isCorrect && <span className="md-opt-v">ваш ответ</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Объяснение */}
                  {showExplanation && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={{ overflow: 'hidden' }}>
                      <div className="md-expl">
                        <h3 className="md-expl-h">Пояснение</h3>
                        <p className="md-expl-t">{practiceQuestions[currentQIndex]?.explanation}</p>
                      </div>
                    </motion.div>
                  )}

                  {/* Кнопка далее */}
                  {selectedOption && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="md-next">
                      <button type="button" className="sf-primary" onClick={nextQuestion} disabled={finishingPractice}>
                        {finishingPractice
                          ? 'Сохраняем результат…'
                          : currentQIndex + 1 < practiceQuestions.length ? 'Следующий вопрос' : 'Завершить практику'}
                      </button>
                    </motion.div>
                  )}
                </section>
              </motion.div>
            ) : (
              <motion.section
                key="finished"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="md-card md-done"
              >
                {/* Результат показываем только после сохранения */}
                {practiceSaveError ? (
                  <div role="alert">
                    <h2 className="md-h2">Не удалось сохранить прогресс</h2>
                    <p className="md-text">Изменения не сохранены. Ошибки остались открытыми, опыт не начислен.</p>
                  </div>
                ) : (
                  <div>
                    <h2 className="md-h2">Работа завершена</h2>
                    <p className="md-text md-text-ink">
                      Правильных ответов: {finalCorrectCount} из {practiceQuestions.length}.
                    </p>
                    <p className="md-text">
                      Исправлено ошибок: {practiceResolvedCount} из {practiceMistakeCount}. Остальные остаются открытыми.
                    </p>
                    {practiceXpAwarded && <p className="md-pill" data-tone="green">Получено +50 XP</p>}
                    {practiceXpError && (
                      <p role="status" className="md-text md-warn">
                        Ошибки сохранены, но XP начислить не удалось.
                      </p>
                    )}
                  </div>
                )}

                {/* Кнопка выхода */}
                <div className="md-done-acts">
                  <button
                    type="button"
                    className="sf-primary"
                    onClick={() => {
                      setIsPracticing(false);
                      setPracticeFinished(false);
                      fetchMistakes();
                    }}
                  >
                    Вернуться в дневник
                  </button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* ═══ ОБЫЧНЫЙ РЕЖИМ ДНЕВНИКА ═══════════════════════════════════════════ */
        <>
          {/* Заголовок */}
          <header className="sf-head md-head">
            <div className="min-w-0">
              <h1 className="sf-h1">Дневник ошибок</h1>
              <p className="sf-lede">Ошибки из тестов, ответов на билеты и устных экзаменов. Правильный ответ открывается по нажатию.</p>
            </div>
          </header>

          {/* Сколько открыто и работа над ошибками */}
          {(openCount > 0 || (!loading && !loadError && mistakes.length > 0)) && (
            <section className="md-card md-summary" aria-label="Ошибки и работа над ними">
              {!loading && !loadError && mistakes.length > 0 && (
                <div className="md-figs">
                  <p className="md-fig" data-tone="open">
                    <span className="md-fig-l">Открыто</span> <span className="md-fig-n">{openCount}</span>
                  </p>
                  <p className="md-fig" data-tone="resolved">
                    <span className="md-fig-l">Исправлено</span> <span className="md-fig-n">{resolvedCount}</span>
                  </p>
                </div>
              )}

              {/* Работа над ошибками */}
              {openCount > 0 && (
                <div className="md-cta">
                  <button type="button" onClick={startPractice} disabled={practiceLoading} className="sf-primary md-start" aria-busy={practiceLoading}>
                    {practiceLoading ? 'Готовим задания…' : 'Начать работу над ошибками'}
                  </button>
                  <p className="md-note">
                    Задания по {Math.min(openCount, 5)} {Math.min(openCount, 5) === 1 ? 'открытой ошибке' : 'открытым ошибкам'}. Расходует 2 единицы дневного лимита ИИ, если задания получились.
                  </p>
                  {practiceError && (
                    <p role="alert" className="md-alert">
                      {practiceError}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Фильтры */}
          <div className="md-bar">
            <ul className="sf-tabs md-tabs" aria-label="Какие ошибки показать">
              {FILTERS.map(({ key, label }) => (
                <li key={key}>
                  <button type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}>
                    {label}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={fetchMistakes} className="md-round" title="Обновить" aria-label="Обновить">
              <RefreshCw aria-hidden="true" />
            </button>
          </div>

          {/* Список ошибок */}
          {loading ? (
            <div className="md-loading" role="status" aria-label="Загружаем дневник ошибок">
              <p className="md-text">Загружаем…</p>
            </div>
          ) : loadError ? (
            <div className="md-card md-state">
              <p role="alert" className="md-text md-text-ink">
                Не удалось загрузить дневник ошибок.
              </p>
              <button type="button" onClick={fetchMistakes} className="sf-secondary md-state-act">
                Повторить
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="md-card md-state md-empty">
              <h2 className="md-h3">{filter === 'open' ? 'Открытых ошибок нет' : 'Пока пусто'}</h2>
              <p className="md-text">
                {filter === 'open' ? 'Все ошибки отмечены как исправленные.' : 'Ошибки из тестов и ответов на билеты появятся здесь.'}
              </p>
            </div>
          ) : (
            <ul className="md-list">
              {filtered.map(mistake => {
                const expanded = expandedId === mistake.id;
                const fromQuiz = mistake.origin === 'quiz';
                return (
                  <li key={mistake.id} className="md-item" data-open={expanded ? '' : undefined}>
                    <button type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : mistake.id)} className="md-row">
                      <span className="md-dot" data-tone={mistake.is_resolved ? 'resolved' : 'open'} aria-hidden="true" />
                      <span className="md-main">
                        <span className="md-q">{mistake.question}</span>
                        <span className="md-meta">
                          {mistakeOriginLabel(mistake.origin)}
                          {mistake.topic ? ` · ${mistake.topic}` : ''}
                          {' · '}
                          {new Date(mistake.created_at).toLocaleDateString('ru-RU')}
                          {mistake.is_resolved ? ' · исправлена' : ''}
                        </span>
                      </span>
                      <span className="md-chev" aria-hidden="true">
                        <ChevronDown />
                      </span>
                    </button>

                    {expanded && (
                      <div className="md-detail">
                        <div className="md-ans">
                          <p className="md-ans-l">Ваш ответ</p>
                          <p className="md-ans-t">{mistake.student_answer || '(пусто)'}</p>
                        </div>
                        <div className="md-ans" data-right="">
                          <p className="md-ans-l">{fromQuiz ? 'Правильный ответ' : 'Что нужно было сказать'}</p>
                          <p className="md-ans-t">{mistake.correct_answer}</p>
                        </div>
                        <div className="md-acts">
                          {!mistake.is_resolved && (
                            <button type="button" onClick={() => markResolved(mistake.id)} className="sf-secondary md-act">
                              <CheckCircle2 aria-hidden="true" />
                              Отметить как исправленную
                            </button>
                          )}
                          <button type="button" onClick={() => deleteMistake(mistake.id)} className="md-del">
                            <Trash2 aria-hidden="true" />
                            Удалить
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
    </MotionConfig>
  );
}
