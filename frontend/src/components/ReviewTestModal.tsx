import { useState, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { X, CheckCircle2, XCircle, Clock, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './ReviewTestModal.css';
import type { ReviewQuestion } from '../api/career';
import { generateReviewTest, updateModuleReview } from '../api/career';

interface ReviewTestModalProps {
  moduleId: string;
  moduleTitle: string;
  moduleTheory: string;
  practiceType: string;
  courseProfession: string;
  token: string;
  onClose: () => void;
  onComplete: (score: number) => void;
  numQuestions?: number;
}

const TIMER_SECONDS = 90; // 90 sec per question

export default function ReviewTestModal({
  moduleId, moduleTitle, moduleTheory, practiceType,
  courseProfession, token, onClose, onComplete, numQuestions = 3,
}: ReviewTestModalProps) {
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [scores, setScores] = useState<boolean[]>([]);
  const [timer, setTimer] = useState(TIMER_SECONDS);
  const [done, setDone] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleId = useId();

  useEffect(() => {
    loadTest();
  }, []);

  useEffect(() => {
    if (!loading && !done && !answered) {
      timerRef.current = setInterval(() => {
        setTimer(t => Math.max(0, t - 1));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading, done, answered, currentIdx]);

  // Time out = wrong answer. Handled here, not inside the setTimer updater, which must stay pure.
  useEffect(() => {
    if (timer === 0 && !loading && !done && !answered) handleAnswer(null);
  }, [timer, loading, done, answered]);

  async function loadTest() {
    setLoading(true);
    try {
      const data = await generateReviewTest(moduleId, moduleTitle, moduleTheory, practiceType, numQuestions);
      setQuestions(data.questions || []);
    } catch {
      // fallback empty
    }
    setLoading(false);
  }

  function handleAnswer(choice: string | null) {
    if (answered) return;
    clearInterval(timerRef.current!);
    setSelected(choice);
    setAnswered(true);
    const q = questions[currentIdx];
    const isCorrect = choice !== null && choice.startsWith(q.correct);
    // One result per question, so a repeated call cannot add an extra answer.
    setScores(s => {
      const next = [...s];
      next[currentIdx] = isCorrect;
      return next;
    });
  }

  async function handleNext() {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelected(null);
      setAnswered(false);
      setTimer(TIMER_SECONDS);
    } else {
      // finish: handleAnswer has already recorded the last answer in scores
      const correct = scores.filter(Boolean).length;
      const total = questions.length;
      const pct = Math.round((correct / total) * 100);
      setFinalScore(pct);
      setDone(true);
      setSaving(true);
      try {
        await updateModuleReview(moduleId, courseProfession, pct, token);
      } catch { /* silent */ }
      setSaving(false);
      onComplete(pct);
    }
  }

  const q = questions[currentIdx];
  const timerPct = (timer / TIMER_SECONDS) * 100;
  // The time left in words' colours: green, then yellow, then the colour of a wrong answer.
  const timerTone = timer > 45 ? 'ok' : timer > 20 ? 'mid' : 'low';

  return (
    <MotionConfig reducedMotion="user">
    <AnimatePresence>
      <div className="rt-scrim">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="rt-dialog"
        >
          {/* Header */}
          <div className="rt-head">
            <div className="rt-head-l">
              <span className="rt-ico" aria-hidden="true">
                <RotateCcw />
              </span>
              <div className="min-w-0">
                <p className="rt-kicker">Spaced Repetition</p>
                <h3 id={titleId} className="rt-title">{moduleTitle}</h3>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rt-close" aria-label="Закрыть">
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="rt-body">
            {loading ? (
              <div className="rt-loading" role="status">
                <p className="rt-quiet">Генерируем вопросы...</p>
              </div>
            ) : done ? (
              /* Results screen */
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rt-result">
                <div className="rt-score" data-good={finalScore >= 70 ? '' : undefined} style={{ ['--rt-share' as string]: `${finalScore}%` }}>
                  <span>{finalScore}%</span>
                </div>
                <div>
                  <p className="rt-verdict">{finalScore >= 70 ? 'Отлично! Материал усвоен!' : 'Нужно ещё поработать'}</p>
                  <p className="rt-quiet">
                    {finalScore >= 70
                      ? `Следующее повторение запланировано автоматически`
                      : 'Рекомендуем перечитать теорию и повторить через 1 день'}
                  </p>
                </div>
                {saving && <p className="rt-quiet" role="status">Сохраняем прогресс...</p>}
                <button type="button" onClick={onClose} className="sf-secondary rt-wide">
                  Закрыть
                </button>
              </motion.div>
            ) : (
              <>
                {/* Progress & Timer */}
                <div className="rt-meter">
                  <div className="rt-steps" aria-hidden="true">
                    {questions.map((_, i) => (
                      <i key={i} data-state={i < currentIdx ? (scores[i] ? 'right' : 'wrong') : i === currentIdx ? 'now' : undefined} />
                    ))}
                  </div>
                  <div className="rt-timer" data-tone={timerTone}>
                    <Clock aria-hidden="true" />
                    <span>{timer}с</span>
                  </div>
                </div>

                {/* Timer bar */}
                <div className="rt-bar" aria-hidden="true">
                  <motion.div className="rt-bar-fill" data-tone={timerTone} animate={{ width: `${timerPct}%` }} transition={{ duration: 0.4 }} />
                </div>

                {/* Question */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentIdx}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="rt-qblock"
                  >
                    <p className="rt-q">
                      <span className="rt-qn">Q{currentIdx + 1}.</span> {q?.question}
                    </p>

                    {/* Options */}
                    <div className="rt-opts">
                      {q?.options.map((opt, oi) => {
                        const letter = opt.split(')')[0].trim();
                        const isCorrect = q.correct === letter;
                        const isSelected = selected?.startsWith(letter);
                        const state = !answered ? undefined : isCorrect ? 'right' : isSelected ? 'wrong' : 'faded';
                        return (
                          <button key={oi} type="button" disabled={answered} onClick={() => handleAnswer(opt)} className="rt-opt" data-state={state}>
                            <span className="rt-opt-in">
                              {answered && isCorrect && <CheckCircle2 className="rt-opt-i" aria-hidden="true" />}
                              {answered && isSelected && !isCorrect && <XCircle className="rt-opt-i" aria-hidden="true" />}
                              <span>{opt}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Explanation */}
                    {answered && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rt-expl">
                        <span className="rt-expl-h">Объяснение: </span>
                        <ReactMarkdown>{q?.explanation}</ReactMarkdown>
                      </motion.div>
                    )}

                    {answered && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <button type="button" onClick={handleNext} className="sf-primary rt-wide">
                          {currentIdx < questions.length - 1 ? 'Следующий вопрос' : 'Завершить тест'}
                        </button>
                      </motion.div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
    </MotionConfig>
  );
}
