import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useUrlState } from '../lib/urlState';
import { CheckCircle2, RefreshCw, Trash2, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { useSound } from '../hooks/useSound';
import { AI_LIMIT_MESSAGE, notifyAIUsageChanged } from '../api/limits';
import { AI_COSTS } from '../lib/plans';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import SectionCrumb from '../components/SectionCrumb';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { groupMistakes, mistakeDay, notNamed, quoted, splitOralAnswer } from '../lib/learning/mistakeText';
import { pluralRu } from '../components/conversation/visuals';
import { ty } from '../components/landing/typo';
import { usePhone } from '../lib/usePhone';
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
  if (origin === 'quiz') return 'Самопроверка';
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

/** «Ответ на билет · Базы данных · 7 окт.», with « · исправлена» for a fixed one; the date only when asked. */
function metaLine(mistake: Mistake, withDate: boolean, withOrigin = true): string {
  const parts: string[] = [];
  if (withOrigin) parts.push(mistakeOriginLabel(mistake.origin));
  if (withOrigin && mistake.topic) parts.push(mistake.topic);
  if (withDate) parts.push(mistakeDay(mistake.created_at));
  if (mistake.is_resolved) parts.push(withOrigin ? 'исправлена' : 'исправлено');
  return parts.filter(Boolean).join(' · ');
}

/** «Из лекции «Модель данных», фрагмент 4» under the lecture's words; «Из лекции» when it has no title. */
function sourceCaption(source: string | null): string {
  if (!source || source === 'Лекция') return 'Из лекции';
  if (source.startsWith('Лекция')) return `Из лекции${source.slice('Лекция'.length)}`;
  return `Из лекции ${source}`;
}

interface MistakeItemProps {
  mistake: Mistake;
  /** A point of a ticket answer under its question (the question is the group's head). */
  point: boolean;
  /** The row shows its own date (a single mistake, or a point of a group answered on several days). */
  withDate: boolean;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
  onDelete: () => void;
  busy: boolean;
  error: string | null;
}

/**
 * One mistake as a row: a ticket's point (the point is the row, the question is above it) or a test's
 * question. Opened, it shows the student's answer and what had to be said — for a ticket's point, the
 * lecture's own words with their source.
 */
function MistakeItem({ mistake, point, withDate, expanded, onToggle, onResolve, onDelete, busy, error }: MistakeItemProps) {
  const fromQuiz = mistake.origin === 'quiz';
  const oral = mistake.origin === 'oral_ticket';
  const parts = oral ? splitOralAnswer(mistake.correct_answer) : null;
  const title = point && parts ? parts.point || mistake.question : mistake.question;
  const meta = metaLine(mistake, withDate, !point);
  const missing = notNamed(mistake.student_answer);
  return (
    <li className="md-item" data-point={point ? '' : undefined} data-open={expanded ? '' : undefined}>
      <button type="button" aria-expanded={expanded} onClick={onToggle} className="md-row">
        <span className="md-dot" data-tone={mistake.is_resolved ? 'resolved' : 'open'} aria-hidden="true" />
        <span className="md-main">
          <span className="md-q">{title}</span>
          {meta ? <span className="md-meta">{meta}</span> : null}
        </span>
        <span className="md-chev" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>

      {expanded && (
        <div className="md-detail">
          <div className="md-ans">
            <p className="md-ans-l">Ваш ответ</p>
            {oral && missing ? (
              <p className="md-ans-t" data-none="">
                Вы не назвали этот пункт.
              </p>
            ) : (
              <p className="md-ans-t">{mistake.student_answer || 'Ответа нет.'}</p>
            )}
          </div>
          {parts && parts.quote ? (
            <div className="md-ans" data-right="">
              <p className="md-ans-l">Как сказано в лекции</p>
              <p className="md-ans-t">{quoted(parts.quote)}</p>
              <p className="md-src">{sourceCaption(parts.source)}</p>
            </div>
          ) : (
            <div className="md-ans" data-right="">
              <p className="md-ans-l">{fromQuiz ? 'Верный ответ' : 'Что нужно было сказать'}</p>
              <p className="md-ans-t">{parts ? parts.point : mistake.correct_answer}</p>
            </div>
          )}
          <div className="md-acts">
            {!mistake.is_resolved && (
              <button type="button" onClick={onResolve} disabled={busy} className="sf-secondary md-act">
                <CheckCircle2 aria-hidden="true" />
                Отметить как исправленную
              </button>
            )}
            <button type="button" onClick={onDelete} disabled={busy} className="md-del">
              <Trash2 aria-hidden="true" />
              Удалить
            </button>
          </div>
          {error ? (
            <p role="alert" className="md-alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}

const RESOLVE_FAILED = 'Не удалось отметить ошибку. Проверьте соединение и попробуйте ещё раз.';
const DELETE_FAILED = 'Не удалось удалить ошибку. Проверьте соединение и попробуйте ещё раз.';
const MISTAKE_FILTERS = ['all', 'open', 'resolved'] as const;

/**
 * What the practice takes, under its button: «Задания по 5 открытым ошибкам. Расходует 2 единицы дневного лимита ИИ,
 * если задания получились.»; on a phone one short line, «Задания по 5 ошибкам · 2 единицы лимита ИИ» (that a failed
 * set costs nothing is said in the limit window, under the limit in the top line). «Задания по» keeps the 5 from
 * reading as the count of mistakes right under «Открыто 17».
 */
export function practiceNote(open: number, phone: boolean): string {
  const n = Math.min(open, 5);
  const cost = AI_COSTS.mistakesPractice;
  if (phone) return `Задания по ${n} ${n === 1 ? 'ошибке' : 'ошибкам'}, ${cost} ${pluralRu(cost, ['единица', 'единицы', 'единиц'])} ИИ`;
  return `Задания по ${n} ${n === 1 ? 'открытой ошибке' : 'открытым ошибкам'}. Это ${cost} ${pluralRu(cost, ['единица', 'единицы', 'единиц'])} из дневного лимита ИИ, только если задания получились.`;
}

export default function MistakeDiary() {
  useDocumentTitle('Дневник ошибок');
  const { user } = useAuth();
  const phone = usePhone();
  const { confirm } = useConfirm();
  const { verifyEnergy } = useEnergyConfirm();
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  // The filter lives in the address (?filter=open | resolved; lib/urlState.ts): a reload and «Назад» keep it.
  const [filter, setFilter] = useUrlState<'all' | 'open' | 'resolved'>('filter', 'all', MISTAKE_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { playFlipSound, playSuccessSound, playErrorSound } = useSound();

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
  const [practiceResolvedCount, setPracticeResolvedCount] = useState(0);
  const [practiceMistakeCount, setPracticeMistakeCount] = useState(0);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  /**
   * Bumped when a write (a mistake marked fixed, deleted, or fixed by the practice) has answered. A read that was on
   * its way meanwhile may have been answered before that write and would bring the row back as it was: its rows are
   * dropped, and the screen keeps the write (the next read brings the rest).
   */
  const writes = useRef(0);
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
        const ok = await verifyEnergy(user.id, AI_COSTS.mistakesPractice, 'Работа над ошибками');
        if (!ok) return;
      }

      const res = await fetch('/api/mistakes/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mistakes: toPractice }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        // Дневной лимит ИИ (сервер списывает единицы до модели) — не «сервис занят».
        setPracticeError(body?.code === 'ai_limit' ? AI_LIMIT_MESSAGE : PRACTICE_BUSY);
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

      // Единицы списал сервер до модели (и вернул бы за негодный ответ): остаток перечитывается.
      notifyAIUsageChanged();

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
      setPracticeResolvedCount(0);
      setPracticeMistakeCount(toPractice.length);
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
          writes.current += 1;
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

      setPracticeFinished(true);
      setFinishingPractice(false);
    }
  };

  const fetchMistakes = async () => {
    if (!user) return;
    const since = writes.current;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('mistake_diary')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // A write answered while this read was on its way: the rows on the screen have it, these may not.
      if (since === writes.current) setMistakes(data || []);
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

  // Back on the screen (another tab, the phone's app switcher), the diary reads itself again, quietly: no
  // «Загружаем…», the rows stay as they are until the new ones arrive, and a failed read keeps them. Not during the
  // practice, which works on the mistakes it started with.
  useEffect(() => {
    const userId = user?.id;
    if (!userId || isPracticing) return undefined;
    let alive = true;
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const since = writes.current;
      try {
        const { data, error } = await supabase
          .from('mistake_diary')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        // A mistake marked fixed or deleted while this read was on its way would come back as it was: the read is
        // dropped (the write is on the screen; the next visit reads the rest).
        if (!error && alive && since === writes.current) setMistakes(data || []);
      } catch {
        // The rows on the screen stay; «Обновить» on a computer and the next visit read them again.
      }
    };
    const listener = () => void onVisible();
    document.addEventListener('visibilitychange', listener);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', listener);
    };
  }, [user?.id, isPracticing]);

  /** The row whose action is being saved, and an action that failed (shown under its row). */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  // A change is shown only after the database took it (LIB-29): a failed write keeps the row and says so.
  const markResolved = async (id: string) => {
    setBusyId(id);
    setRowError(null);
    try {
      const { error } = await supabase
        .from('mistake_diary')
        .update({ is_resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', id);
      writes.current += 1;
      if (error) throw error;
      setMistakes(prev => prev.map(m => m.id === id ? { ...m, is_resolved: true } : m));
    } catch (e) {
      console.error('Marking a mistake as fixed failed:', e);
      setRowError({ id, text: RESOLVE_FAILED });
    } finally {
      setBusyId(null);
    }
  };

  const deleteMistake = async (id: string) => {
    const ok = await confirm({
      title: 'Удалить ошибку?',
      message: 'Её не будет в дневнике и в «Работе над ошибками». Вернуть удалённую ошибку нельзя.',
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      type: 'danger',
    });
    if (!ok) return;
    setBusyId(id);
    setRowError(null);
    try {
      const { error } = await supabase.from('mistake_diary').delete().eq('id', id);
      writes.current += 1;
      if (error) throw error;
      setMistakes(prev => prev.filter(m => m.id !== id));
      setExpandedId(current => (current === id ? null : current));
    } catch (e) {
      console.error('Deleting a mistake failed:', e);
      setRowError({ id, text: DELETE_FAILED });
    } finally {
      setBusyId(null);
    }
  };

  const filtered = mistakes.filter(m => {
    if (filter === 'open') return !m.is_resolved;
    if (filter === 'resolved') return m.is_resolved;
    return true;
  });

  const openCount = mistakes.filter(m => !m.is_resolved).length;
  const resolvedCount = mistakes.filter(m => m.is_resolved).length;

  const FILTERS: Array<{ key: 'all' | 'open' | 'resolved'; label: string; count: number }> = [
    { key: 'all', label: 'Все', count: mistakes.length },
    { key: 'open', label: 'Открытые', count: openCount },
    { key: 'resolved', label: 'Исправленные', count: resolvedCount },
  ];
  // A phone's filter is a row of text tabs with their counts, «Все 17 · Открытые 17»: a tab with nothing in it is left
  // out unless it is the one chosen; while the diary loads (or did not load) the counts are not known yet.
  const counted = phone && !loading && !loadError;
  const filters = counted ? FILTERS.filter(({ key, count }) => count > 0 || key === filter) : FILTERS;

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
                      if (await confirm({ title: 'Прервать', message: 'Прервать работу над ошибками? Ответы не сохранятся.', type: 'warning' })) {
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
                    <p className="md-text">Изменения не сохранены. Ошибки остались открытыми.</p>
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
              <SectionCrumb to="/review" label="Повторение" />
              <h1 className="sf-h1">Дневник ошибок</h1>
              {/* A phone keeps one line: where a mistake came from is on every row. */}
              <p className="sf-lede">
                {phone ? 'Нажмите на строку, чтобы увидеть ответ.' : ty('Ошибки из самопроверок и ответов на билеты. Нажмите на строку, чтобы увидеть верный ответ.')}
              </p>
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
                  {/* A phone says it in three words, so the pill keeps one line from 360 px. */}
                  <button type="button" onClick={startPractice} disabled={practiceLoading} className="sf-primary md-start" aria-busy={practiceLoading}>
                    {practiceLoading ? 'Готовим задания…' : phone ? 'Работать над ошибками' : 'Начать работу над ошибками'}
                  </button>
                  <p className="md-note">{practiceNote(openCount, phone)}</p>
                  {practiceError && (
                    <p role="alert" className="md-alert">
                      {practiceError}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Фильтры: only when there is something to filter. */}
          {loading || loadError || mistakes.length > 0 ? (
            <div className="md-bar">
              <ul className="sf-tabs md-tabs" aria-label="Какие ошибки показать">
                {filters.map(({ key, label, count }) => (
                  <li key={key}>
                    <button type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}>
                      {label}
                      {counted ? (
                        <>
                          {' '}
                          <span className="md-tab-n">{count}</span>
                        </>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              {/* Not on a phone: the diary reads itself on every visit and when the app comes back to the screen. */}
              {phone ? null : (
                <button type="button" onClick={fetchMistakes} className="md-round" title="Обновить" aria-label="Обновить">
                  <RefreshCw aria-hidden="true" />
                </button>
              )}
            </div>
          ) : null}

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
            mistakes.length === 0 ? (
              // A diary that never had a mistake: where they come from, and the one way to get there (LIB-14).
              <div className="md-card md-state md-empty">
                <h2 className="md-h3">Ошибок пока нет</h2>
                <p className="md-text">
                  {ty('Сюда попадут пункты, которые вы не назвали в ответе на билет, и вопросы самопроверки, на которые вы ответили неверно.')}
                </p>
                <Link className="sf-secondary md-state-act" to="/exams">
                  Ответить на билет
                </Link>
              </div>
            ) : (
              <div className="md-card md-state md-empty">
                <h2 className="md-h3">{filter === 'open' ? 'Открытых ошибок нет' : 'Исправленных пока нет'}</h2>
                <p className="md-text">
                  {filter === 'open'
                    ? 'Все ошибки отмечены как исправленные.'
                    : ty('Отметьте ошибку исправленной, когда разберёте её, или пройдите работу над ошибками.')}
                </p>
              </div>
            )
          ) : (
            <ul className="md-list">
              {groupMistakes(filtered).map((entry) => {
                const itemProps = (mistake: Mistake) => ({
                  mistake,
                  expanded: expandedId === mistake.id,
                  onToggle: () => setExpandedId(expandedId === mistake.id ? null : mistake.id),
                  onResolve: () => void markResolved(mistake.id),
                  onDelete: () => void deleteMistake(mistake.id),
                  busy: busyId === mistake.id,
                  error: rowError?.id === mistake.id ? rowError.text : null,
                });
                if (entry.kind === 'single') {
                  return <MistakeItem key={entry.key} point={false} withDate {...itemProps(entry.item)} />;
                }
                // The points of one ticket question under it: the question once, the points as rows (LIB-11).
                const head = entry.items[0];
                const days = new Set(entry.items.map((item) => mistakeDay(item.created_at)));
                const open = entry.items.filter((item) => !item.is_resolved).length;
                const lead = [mistakeOriginLabel(head.origin), head.topic].filter(Boolean).join(' · ');
                // The date and the count wrap together: a line never starts with « · 4 пункта».
                const tail = [
                  days.size === 1 ? mistakeDay(head.created_at) : '',
                  entry.items.length > 1
                    ? `${entry.items.length} ${pluralRu(entry.items.length, ['пункт', 'пункта', 'пунктов'])}${open < entry.items.length ? `, открыто ${open}` : ''}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={entry.key} className="md-group">
                    <div className="md-group-head">
                      <p className="md-group-q">{entry.question}</p>
                      <p className="md-meta">
                        {lead}
                        {lead && tail ? ' · ' : ''}
                        {tail ? <span className="md-nowrap">{tail}</span> : null}
                      </p>
                    </div>
                    <ul className="md-points" aria-label={`Пункты ответа: ${entry.question}`}>
                      {entry.items.map((item) => (
                        <MistakeItem key={item.id} point withDate={days.size > 1} {...itemProps(item)} />
                      ))}
                    </ul>
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
