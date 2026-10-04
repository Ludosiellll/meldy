import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, Trash2, Filter, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { useSound } from '../hooks/useSound';
import { addXP } from '../api/quests';
import confetti from 'canvas-confetti';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';

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

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto">
      {/* ═══ РЕЖИМ ПРАКТИКИ ════════════════════════════════════════════════════ */}
      {isPracticing ? (
        <div className="max-w-2xl mx-auto py-8">
          <AnimatePresence mode="wait">
            {!practiceFinished ? (
              <motion.div
                key={`q-${currentQIndex}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Хедер прогресса */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--sf-ink)]">
                      Вопрос {currentQIndex + 1} из {practiceQuestions.length}
                    </span>
                    <span className="text-xs text-slate-400">
                      Верных ответов: {correctCount}
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      if (await confirm({ title: 'Прервать', message: 'Вы уверены, что хотите прервать работу над ошибками? Прогресс не сохранится.', type: 'warning' })) {
                        setIsPracticing(false);
                      }
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition"
                  >
                    Прервать
                  </button>
                </div>

                {/* Карточка вопроса */}
                <div className="card p-4 md:p-8 space-y-4 md:space-y-6">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-relaxed">
                    {practiceQuestions[currentQIndex]?.question}
                  </h3>

                  {/* Опции */}
                  <div className="space-y-3">
                    {practiceQuestions[currentQIndex]?.options.map((opt: string) => {
                      const isSelected = selectedOption === opt;
                      const isCorrect = opt.startsWith(practiceQuestions[currentQIndex]?.correct);
                      const hasAnswered = selectedOption !== null;

                      let btnStyle = 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200';
                      if (hasAnswered) {
                        if (isCorrect) {
                          btnStyle = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300';
                        } else if (isSelected) {
                          btnStyle = 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-300';
                        } else {
                          btnStyle = 'border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 opacity-60';
                        }
                      }

                      return (
                        <button
                          key={opt}
                          disabled={hasAnswered}
                          onClick={() => checkAnswer(opt)}
                          className={`w-full p-3 md:p-4 text-left text-sm font-semibold rounded-xl border-2 transition-all duration-200 ${btnStyle} flex justify-between items-center`}
                        >
                          <span>{opt}</span>
                          {hasAnswered && isCorrect && (
                            <span className="text-xs font-medium shrink-0">верный ответ</span>
                          )}
                          {hasAnswered && isSelected && !isCorrect && (
                            <span className="text-xs font-medium shrink-0">ваш ответ</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Объяснение */}
                  {showExplanation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      style={{ overflow: 'hidden' }}
                      className="p-4 bg-[var(--sf-surface-soft)] border border-[var(--sf-line)] rounded-xl space-y-1"
                    >
                      <h4 className="text-sm font-medium text-[var(--sf-ink)]">Пояснение</h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {practiceQuestions[currentQIndex]?.explanation}
                      </p>
                    </motion.div>
                  )}

                  {/* Кнопка далее */}
                      {selectedOption && (
                    <motion.button
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={nextQuestion}
                      disabled={finishingPractice}
                      className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-100"
                    >
                      {finishingPractice
                        ? 'Сохраняем результат…'
                        : currentQIndex + 1 < practiceQuestions.length ? 'Следующий вопрос' : 'Завершить практику'}
                    </motion.button>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="finished"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card p-8 md:p-10 text-center space-y-6"
              >
                {/* Результат показываем только после сохранения */}
                {practiceSaveError ? (
                  <div role="alert" className="space-y-2">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Не удалось сохранить прогресс</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                      Изменения не сохранены. Ошибки остались открытыми, опыт не начислен.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">Работа завершена</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                      Правильных ответов: {finalCorrectCount} из {practiceQuestions.length}.
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Исправлено ошибок: {practiceResolvedCount} из {practiceMistakeCount}. Остальные остаются открытыми.
                    </p>
                    {practiceXpAwarded && (
                      <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold rounded-full px-4 py-2 mt-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Получено +50 XP
                      </div>
                    )}
                    {practiceXpError && (
                      <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
                        Ошибки сохранены, но XP начислить не удалось.
                      </p>
                    )}
                  </div>
                )}

                {/* Кнопка выхода */}
                <button
                  onClick={() => {
                    setIsPracticing(false);
                    setPracticeFinished(false);
                    fetchMistakes();
                  }}
                  className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black rounded-xl transition"
                >
                  Вернуться в дневник
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* ═══ ОБЫЧНЫЙ РЕЖИМ ДНЕВНИКА ═══════════════════════════════════════════ */
        <>
          {/* Заголовок */}
          <header className="mb-6 border-b border-[var(--sf-line)] pb-4">
            <h1 className="text-xl font-semibold text-[var(--sf-ink)]">Дневник ошибок</h1>
            <p className="mt-1 text-sm text-[var(--sf-muted)]">
              Ошибки из тестов, ответов на билеты и устных экзаменов. Правильный ответ открывается по нажатию.
            </p>
            {!loading && !loadError && mistakes.length > 0 && (
              <p className="mt-2 text-sm text-[var(--sf-ink)]">
                Открыто: {openCount}. Исправлено: {resolvedCount}.
              </p>
            )}
          </header>

          {/* Работа над ошибками */}
          {openCount > 0 && (
            <div className="mb-6">
              <button
                onClick={startPractice}
                disabled={practiceLoading}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-accent)] px-6 text-sm font-semibold text-white shadow-[0_2px_0_rgba(0,0,0,0.18)] transition hover:bg-[var(--sf-accent-hover)] active:translate-y-px active:shadow-none disabled:cursor-wait disabled:opacity-70 sm:w-auto"
              >
                {practiceLoading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
                    Готовим задания…
                  </>
                ) : (
                  'Начать работу над ошибками'
                )}
              </button>
              <p className="mt-2 text-sm text-[var(--sf-muted)]">
                Задания по {Math.min(openCount, 5)} {Math.min(openCount, 5) === 1 ? 'открытой ошибке' : 'открытым ошибкам'}. Расходует 2 единицы дневного лимита ИИ, если задания получились.
              </p>
              {practiceError && (
                <p role="alert" className="mt-2 text-sm text-[var(--sf-ink)]">
                  {practiceError}
                </p>
              )}
            </div>
          )}

          {/* Фильтры */}
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-[var(--sf-muted)]" aria-hidden="true" />
            {(['all', 'open', 'resolved'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-sm transition ${
                  filter === f
                    ? 'bg-[var(--sf-ink)] text-[var(--sf-canvas)]'
                    : 'text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]'
                }`}
              >
                {f === 'all' && 'Все'}
                {f === 'open' && 'Открытые'}
                {f === 'resolved' && 'Исправленные'}
              </button>
            ))}
            <button
              onClick={fetchMistakes}
              className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--sf-muted)] hover:text-[var(--sf-ink)] transition"
              title="Обновить"
              aria-label="Обновить"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Список ошибок */}
          {loading ? (
            <div className="flex items-center justify-center py-20" role="status" aria-label="Загружаем дневник ошибок">
              <div className="w-8 h-8 border-2 border-[var(--sf-accent-fg)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-6">
              <p role="alert" className="text-sm text-[var(--sf-ink)]">Не удалось загрузить дневник ошибок.</p>
              <button
                onClick={fetchMistakes}
                className="mt-2 min-h-[44px] text-sm font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
              >
                Повторить
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-10 text-center">
              <h3 className="font-semibold text-[var(--sf-ink)] mb-1">
                {filter === 'open' ? 'Открытых ошибок нет' : 'Пока пусто'}
              </h3>
              <p className="text-sm text-[var(--sf-muted)]">
                {filter === 'open'
                  ? 'Все ошибки отмечены как исправленные.'
                  : 'Ошибки из тестов и ответов на билеты появятся здесь.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
              {filtered.map(mistake => {
                const expanded = expandedId === mistake.id;
                const fromQuiz = mistake.origin === 'quiz';
                return (
                  <li key={mistake.id} className={mistake.is_resolved ? 'opacity-70' : ''}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : mistake.id)}
                      className="flex w-full items-start gap-3 py-4 text-left"
                    >
                      <span className="mt-0.5 shrink-0" aria-hidden="true">
                        {mistake.is_resolved
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          : <AlertCircle className="w-4 h-4 text-[var(--sf-muted)]" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug text-[var(--sf-ink)] line-clamp-2">
                          {mistake.question}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--sf-muted)]">
                          {mistakeOriginLabel(mistake.origin)}
                          {mistake.topic ? ` · ${mistake.topic}` : ''}
                          {' · '}
                          {new Date(mistake.created_at).toLocaleDateString('ru-RU')}
                          {mistake.is_resolved ? ' · исправлена' : ''}
                        </span>
                      </span>
                      <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--sf-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>

                    {expanded && (
                      <div className="space-y-3 pb-4 pl-7">
                        <div>
                          <p className="text-xs text-[var(--sf-muted)]">Ваш ответ</p>
                          <p className="text-sm leading-relaxed text-[var(--sf-ink)]">{mistake.student_answer || '(пусто)'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--sf-muted)]">{fromQuiz ? 'Правильный ответ' : 'Что нужно было сказать'}</p>
                          <p className="text-sm leading-relaxed text-[var(--sf-ink)]">{mistake.correct_answer}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {!mistake.is_resolved && (
                            <button
                              onClick={() => markResolved(mistake.id)}
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--sf-line)] bg-[var(--sf-surface)] px-3 text-sm font-medium text-[var(--sf-ink)] hover:bg-[var(--sf-surface-soft)] transition"
                            >
                              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                              Отметить как исправленную
                            </button>
                          )}
                          <button
                            onClick={() => deleteMistake(mistake.id)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm text-[var(--sf-muted)] hover:text-rose-700 dark:hover:text-rose-300 transition"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
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
  );
}
