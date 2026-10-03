import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import { ArrowLeft, CheckCircle2, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSound } from '../hooks/useSound';
import { getDueCards, updateCardProgress, type DueCard } from '../api/flashcards';
import { recordStudyActivity } from '../api/quests';
import { newEventId } from '../api/learning';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Review of due cards («Повторение»).
 *
 * Every answer goes through the review_flashcard RPC with its own client_event_id. A failed save
 * keeps that id for the card, so a retry can never apply the same answer twice; the id is dropped
 * only after the save succeeded. One review session id covers the whole page load. `?material=<id>`
 * limits the queue to one material. Activity counters are written one after another, and the done
 * screen appears only after the last one is stored, so «Сегодня» opened next shows the answers.
 */
export default function Review() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  const materialParam = searchParams.get('material');
  const materialFilter = materialParam ? materialParam.trim() : null;
  const { playFlipSound, playSuccessSound } = useSound();
  const [cards, setCards] = useState<DueCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0 });
  const [done, setDone] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const [sessionId] = useState(() => newEventId());
  /** client_event_id of an answer whose save has not succeeded yet, per card. */
  const pendingEventIds = useRef(new Map<string, string>());
  const activityChain = useRef<Promise<void>>(Promise.resolve());

  const loadCards = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    processingRef.current = false;
    try {
      const data =
        materialFilter && !UUID.test(materialFilter)
          ? []
          : await getDueCards(user.id, materialFilter ? { materialId: materialFilter } : {});
      setCards(data);
      setIdx(0);
      setRevealed(false);
      setSessionStats({ correct: 0, wrong: 0 });
      setDone(false);
    } catch (error) {
      console.error('Error loading due cards:', error);
      setCards([]);
      setLoadError('Не удалось загрузить карточки. Проверьте соединение и повторите попытку.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCards(); }, [user?.id, materialFilter]);

  const handleReveal = () => {
    if (!revealed) {
      playFlipSound();
      setRevealed(true);
    }
  };

  const recordActivity = () => {
    if (!user?.id) return activityChain.current;
    const userId = user.id;
    activityChain.current = activityChain.current
      .then(() => recordStudyActivity(userId, 1, 0))
      .catch((err) => console.error('Error recording study activity:', err));
    return activityChain.current;
  };

  const handleAnswer = async (quality: number) => {
    if (!cards[idx] || processingRef.current) return;

    const currentCard = cards[idx];
    processingRef.current = true;
    setProcessing(true);
    setSaveError(null);

    try {
      if (!currentCard.id) throw new Error('Review card is missing its database id.');
      const eventId = pendingEventIds.current.get(currentCard.id) ?? newEventId();
      pendingEventIds.current.set(currentCard.id, eventId);
      await updateCardProgress(currentCard.id, quality, { clientEventId: eventId, sessionId });
      pendingEventIds.current.delete(currentCard.id);

      if (quality >= 3) {
        setSessionStats(p => ({ ...p, correct: p.correct + 1 }));
      } else {
        setSessionStats(p => ({ ...p, wrong: p.wrong + 1 }));
      }

      const activity = recordActivity();
      if (idx + 1 >= cards.length) {
        // The last answer: the done screen and «Сегодня» after it must already see the counters.
        await activity;
        playSuccessSound();
        setDone(true);
      } else {
        setIdx(p => p + 1);
        setRevealed(false);
      }
    } catch (error) {
      console.error('Error saving card progress:', error);
      setSaveError('Ответ не сохранён. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  const header = (
    <div className="mb-7 flex items-center justify-between gap-4">
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[var(--sf-muted)] hover:text-[var(--sf-ink)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Сегодня
      </button>
      <Link
        to="/exams"
        className="inline-flex min-h-[44px] items-center text-sm font-medium text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
      >
        Экзамены
      </Link>
    </div>
  );

  if (loading) return (
    <div className="p-4 md:p-6 flex items-center justify-center min-h-[60vh]" role="status" aria-label="Загружаем карточки">
      <div className="w-8 h-8 border-2 border-[var(--sf-accent-fg)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
    </div>
  );

  if (loadError) return (
    <main className="mx-auto max-w-xl px-4 py-10 md:py-16">
      {header}
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-[var(--sf-ink)] mb-3">Не удалось загрузить карточки</h2>
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300 mb-6">{loadError}</p>
        <button onClick={loadCards} className="min-h-[44px] px-5 py-2.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-lg text-sm font-semibold transition-colors">
          Повторить загрузку
        </button>
      </div>
    </main>
  );

  // No cards due
  if (cards.length === 0) return (
    <main className="mx-auto max-w-xl px-4 py-10 md:py-16">
      {header}
      <div className="text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mx-auto mb-4" aria-hidden="true" />
        {materialFilter ? (
          <>
            <h2 className="text-2xl font-semibold text-[var(--sf-ink)] mb-2">Карточек этого материала к повторению сейчас нет</h2>
            <p className="text-[var(--sf-muted)] mb-6">Срок следующего повторения ещё не наступил.</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <button onClick={() => navigate('/review')} className="min-h-[44px] px-5 py-2.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-lg text-sm font-semibold transition-colors">
                Все карточки к повторению
              </button>
              {UUID.test(materialFilter) && (
                <button onClick={() => navigate(`/library/${materialFilter}`)} className="min-h-[44px] px-5 py-2 border border-[var(--sf-line)] text-[var(--sf-ink)] hover:bg-[var(--sf-surface-soft)] rounded-lg text-sm font-medium transition">
                  К материалу
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold text-[var(--sf-ink)] mb-2">На сегодня всё</h2>
            <p className="text-[var(--sf-muted)] mb-6">Карточек с наступившим сроком повторения нет.</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <button onClick={() => navigate('/library')} className="min-h-[44px] px-5 py-2.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-lg text-sm font-semibold transition-colors">
                В библиотеку
              </button>
              <button onClick={() => navigate('/analyze')} className="min-h-[44px] px-5 py-2 border border-[var(--sf-line)] text-[var(--sf-ink)] hover:bg-[var(--sf-surface-soft)] rounded-lg text-sm font-medium transition">
                Новый анализ
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );

  // Session done
  if (done) {
    const total = sessionStats.correct + sessionStats.wrong;
    return (
      <main className="mx-auto max-w-xl px-4 py-10 md:py-16">
        {header}
        <div className="text-center">
          <h2 className="text-3xl font-semibold text-[var(--sf-ink)] mb-4">Сессия завершена</h2>
          <p className="text-lg text-[var(--sf-ink)] mb-1">Вспомнили {sessionStats.correct} из {total}.</p>
          <p className="text-[var(--sf-muted)] text-sm mb-8">Ответы сохранены. Если карточки ещё остались, продолжите следующей группой.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button onClick={loadCards} className="flex min-h-[44px] items-center gap-2 px-5 py-2.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-lg text-sm font-semibold transition-colors">
              <RotateCcw className="w-4 h-4" aria-hidden="true" />Продолжить повторение
            </button>
            <button onClick={() => navigate('/dashboard')} className="min-h-[44px] px-5 py-2 border border-[var(--sf-line)] text-[var(--sf-ink)] hover:bg-[var(--sf-surface-soft)] rounded-lg text-sm font-medium transition">
              На главную
            </button>
          </div>
        </div>
      </main>
    );
  }

  const card = cards[idx];
  const followUp = card.origin === 'oral_followup';

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-10">
      {header}
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-[var(--sf-muted)] mb-2">
          <span>{idx + 1} из {cards.length}</span>
          <span>вспомнили {sessionStats.correct}, нет {sessionStats.wrong}</span>
        </div>
        <div className="h-1 bg-[var(--sf-line)] overflow-hidden">
          <div className="h-full bg-[var(--sf-accent-fg)] transition-all" style={{ width: `${((idx + 1) / cards.length) * 100}%` }} />
        </div>
      </div>

      {/* Card */}
      <motion.div
        key={idx}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="min-h-[340px] p-6 md:p-12 flex flex-col items-center justify-center cursor-pointer relative transition border-y border-[var(--sf-line)] bg-[var(--sf-surface)]"
        onClick={handleReveal}
      >
        <span className="text-sm text-[var(--sf-muted)] mb-5">{followUp ? 'Вопрос экзаменатора' : 'Вопрос'}</span>
        <div className="text-lg sm:text-xl md:text-2xl font-semibold text-[var(--sf-ink)] text-center leading-snug max-w-xl px-2 mb-6 markdown-content">
          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{card.question}</ReactMarkdown>
        </div>

        {revealed && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
            className="w-full border-t border-[var(--sf-line)] pt-6 mt-2"
          >
            <span className="text-sm text-[var(--sf-muted)] mb-3 block text-center">Ответ</span>
            <div className="text-[var(--sf-ink)] text-sm sm:text-base md:text-lg text-center leading-relaxed max-w-xl mx-auto px-2 whitespace-pre-line markdown-content">
              <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{card.answer}</ReactMarkdown>
            </div>
          </motion.div>
        )}

        {!revealed && (
          <p className="text-sm text-[var(--sf-muted)] mt-4">Нажмите, чтобы открыть ответ</p>
        )}
      </motion.div>

      {/* Actions */}
      <div className="mt-6" aria-busy={processing}>
        {!revealed ? (
          <button
            onClick={handleReveal}
            className="w-full h-14 bg-cyan-300 hover:bg-cyan-200 active:bg-cyan-400 text-slate-950 rounded-lg font-semibold transition-colors text-base"
          >
            Показать ответ
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            <button
              onClick={() => handleAnswer(1)}
              disabled={processing}
              className="h-14 md:h-12 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 rounded-xl font-medium transition text-sm disabled:cursor-wait disabled:opacity-60"
            >
              Не помню
            </button>
            <button
              onClick={() => handleAnswer(3)}
              disabled={processing}
              className="h-14 md:h-12 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 rounded-xl font-medium transition text-sm disabled:cursor-wait disabled:opacity-60"
            >
              С трудом
            </button>
            <button
              onClick={() => handleAnswer(5)}
              disabled={processing}
              className="h-14 md:h-12 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 rounded-xl font-medium transition text-sm disabled:cursor-wait disabled:opacity-60"
            >
              Знаю
            </button>
          </div>
        )}
        {processing && <p role="status" aria-live="polite" className="mt-3 text-center text-sm text-[var(--sf-muted)]">Сохраняем ответ…</p>}
        {saveError && <p role="alert" className="mt-3 text-center text-sm text-rose-700 dark:text-rose-300">{saveError}</p>}
      </div>
    </main>
  );
}
