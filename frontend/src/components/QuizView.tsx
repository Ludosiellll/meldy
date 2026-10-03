import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Maximize2, RotateCcw, X, XCircle } from 'lucide-react';
import SourceReferences from './SourceReferences';
import { pluralRu } from './conversation/visuals';
import {
  LearningSaveError,
  SAVE_FAILED_MESSAGE,
  newEventId,
  recordQuizAttempt,
  type QuizAttemptAnswer,
} from '../api/learning';

/**
 * The test of a material («Тест» after analysis and on the material page).
 *
 * Correctness is decided by option index: `correct` may be a letter (A–D or А–Г, with or without
 * «)»), a letter with the option text («A) Да»), or the exact option text. An empty or unmatched
 * `correct` leaves the question unscored: it is never counted as right or wrong.
 *
 * With `materialId` every checked attempt goes to the learning journal (record_quiz_attempt): one
 * new session per «Проверить ответы», «Пройти снова» starts a new session marked as a retake, and a
 * failed save is retried with the same session (the RPC is idempotent). `materialId === null`
 * means the material is not in the library yet; the attempt is saved as soon as an id arrives.
 * Without the prop (teacher assignments) the host saves the result itself through `onComplete`.
 * The presentation mode is for an audience and is never recorded.
 */

export interface QuizViewProps {
  data: any;
  onComplete?: (scorePct: number) => void;
  sources?: { id: string; text: string }[];
  materialId?: string | null;
  topic?: string;
  surface?: 'analysis' | 'material';
}

interface NormalizedQuestion {
  question: string;
  options: string[];
  labels: (string | null)[];
  correctIndex: number | null;
  explanation: string;
  sourceIds: string[];
}

const LABEL_RE = /^\s*([A-Za-zА-ЯЁа-яё])\s*[).:]\s*/;
const LATIN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CYRILLIC_LETTERS = 'АБВГДЕЖЗИКЛМН';
/** Cyrillic capitals that look like Latin ones («В» typed for «B»). */
const LATIN_GLYPH: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y',
};

function normalizeText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Own labels of the options («A) …», «б. …») when every option has one and they are distinct. */
export function optionLabels(options: string[]): (string | null)[] {
  const labels = options.map((option) => LABEL_RE.exec(option)?.[1] ?? null);
  const distinct = new Set(labels.map((label) => (label ? label.toUpperCase() : '')));
  const usable = labels.length > 0 && labels.every((label) => label !== null) && distinct.size === labels.length;
  return usable ? labels : options.map(() => null);
}

function optionBody(option: string, label: string | null): string {
  return label ? option.replace(LABEL_RE, '') : option;
}

function letterIndex(letter: string, labels: (string | null)[], count: number): number | null {
  const upper = letter.toUpperCase();
  if (labels.length > 0 && labels.every((label) => label !== null)) {
    const exact = labels.findIndex((label) => label!.toUpperCase() === upper);
    if (exact >= 0) return exact;
    const glyph = LATIN_GLYPH[upper] ?? upper;
    const similar = labels.findIndex((label) => {
      const own = label!.toUpperCase();
      return (LATIN_GLYPH[own] ?? own) === glyph;
    });
    if (similar >= 0) return similar;
  }
  let position = LATIN_LETTERS.indexOf(upper);
  if (position < 0) position = CYRILLIC_LETTERS.indexOf(upper === 'Ё' ? 'Е' : upper);
  return position >= 0 && position < count ? position : null;
}

function uniqueMatch(values: string[], wanted: string): number | null {
  if (!wanted) return null;
  const matches: number[] = [];
  values.forEach((value, index) => {
    if (normalizeText(value) === wanted) matches.push(index);
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Index of the right option, or null when the question cannot be scored (no options, an empty
 * `correct`, or a `correct` that matches no option or matches several).
 */
export function correctOptionIndex(options: unknown, correct: unknown): number | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const texts = options.map((option) => (typeof option === 'string' ? option : String(option ?? '')));
  const raw = typeof correct === 'string' ? correct.trim() : '';
  if (!raw) return null;

  const labels = optionLabels(texts);
  const bodies = texts.map((text, index) => optionBody(text, labels[index]));
  const wanted = normalizeText(raw);

  const byText = uniqueMatch(texts, wanted);
  if (byText !== null) return byText;
  const byBody = uniqueMatch(bodies, wanted);
  if (byBody !== null) return byBody;

  const letter = /^([A-Za-zА-ЯЁа-яё])\s*(?:[).:]\s*(.*))?$/su.exec(raw);
  if (!letter) return null;
  const index = letterIndex(letter[1], labels, texts.length);
  if (index === null) return null;
  const rest = normalizeText(letter[2] ?? '');
  if (rest) {
    // «B) Нет» must not point at the option whose text is «Нет» under another letter.
    const other = uniqueMatch(bodies, rest);
    if (other !== null && other !== index) return null;
  }
  return index;
}

function displayLetter(labels: (string | null)[], index: number): string {
  return labels[index] ?? LATIN_LETTERS[index] ?? String(index + 1);
}

function normalizeQuestions(quiz: unknown[]): NormalizedQuestion[] {
  return quiz.map((item) => {
    const q = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const options = Array.isArray(q.options)
      ? q.options.map((option) => (typeof option === 'string' ? option : String(option ?? '')))
      : [];
    return {
      question: typeof q.question === 'string' ? q.question : '',
      options,
      labels: optionLabels(options),
      correctIndex: correctOptionIndex(options, q.correct),
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
      sourceIds: Array.isArray(q.source_ids) ? q.source_ids.filter((id): id is string => typeof id === 'string') : [],
    };
  });
}

function score(questions: NormalizedQuestion[], answers: Record<number, number>) {
  let correct = 0;
  let scored = 0;
  questions.forEach((q, i) => {
    if (q.correctIndex === null) return;
    scored += 1;
    if (answers[i] === q.correctIndex) correct += 1;
  });
  return { correct, scored, unscored: questions.length - scored };
}

function gradeLabel(pct: number): string {
  if (pct >= 90) return 'Отлично';
  if (pct >= 70) return 'Хорошо';
  if (pct >= 50) return 'Удовлетворительно';
  return 'Нужно подтянуть';
}

function attemptAnswers(questions: NormalizedQuestion[], answers: Record<number, number>): QuizAttemptAnswer[] {
  return questions.map((q, index) => {
    const chosen = answers[index];
    const hasChoice = typeof chosen === 'number' && chosen >= 0 && chosen < q.options.length;
    const expected = q.correctIndex;
    return {
      index,
      question: q.question,
      chosen: hasChoice ? displayLetter(q.labels, chosen) : null,
      chosenText: hasChoice ? optionBody(q.options[chosen], q.labels[chosen]).trim() : '',
      expected: expected === null ? null : displayLetter(q.labels, expected),
      expectedText: expected === null ? '' : optionBody(q.options[expected], q.labels[expected]).trim(),
      correct: expected === null || !hasChoice ? null : chosen === expected,
      explanation: q.explanation,
      sourceIds: q.sourceIds,
      options: q.options.length,
    };
  });
}

interface Attempt {
  sessionId: string;
  retake: boolean;
  answers: QuizAttemptAnswer[];
}

type SaveState =
  | { status: 'off' }
  | { status: 'no_material' }
  | { status: 'saving' }
  | { status: 'saved'; retake: boolean; mistakesAdded: number; mistakesExisting: number }
  | { status: 'failed'; message: string };

function addedLine(added: number): string {
  return `${added} ${pluralRu(added, ['ошибка добавлена', 'ошибки добавлены', 'ошибок добавлены'])} в дневник ошибок`;
}

function existingLine(existing: number, afterAdded: boolean): string {
  return afterAdded
    ? `ещё ${existing} ${pluralRu(existing, ['уже была', 'уже были', 'уже были'])} там`
    : `${existing} ${pluralRu(existing, ['ошибка уже есть', 'ошибки уже есть', 'ошибок уже есть'])} в дневнике ошибок`;
}

function JournalLine({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.status === 'off') return null;
  if (state.status === 'no_material') {
    return (
      <p role="status" className="text-sm text-[var(--sf-muted)]">
        Результат не сохранён: материал ещё не в библиотеке
      </p>
    );
  }
  if (state.status === 'saving') {
    return (
      <p role="status" aria-live="polite" className="text-sm text-[var(--sf-muted)]">
        Сохраняем результат…
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 text-sm text-[var(--sf-ink)]">
        <span>{state.message === SAVE_FAILED_MESSAGE ? 'Результат не сохранён.' : state.message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline"
        >
          Повторить
        </button>
      </div>
    );
  }
  const { mistakesAdded: added, mistakesExisting: existing } = state;
  return (
    <div role="status" className="space-y-1 text-sm text-[var(--sf-muted)]">
      <p>Результат сохранён</p>
      {state.retake && <p>Повторная попытка: в «Прогрессе» считается первая</p>}
      {(added > 0 || existing > 0) && (
        <p>
          {added > 0 && (
            <Link to="/mistakes" className="font-semibold text-[var(--sf-accent-fg)] underline underline-offset-4">
              {addedLine(added)}
            </Link>
          )}
          {existing > 0 && (
            <>
              {added > 0 ? ', ' : ''}
              {added > 0 ? existingLine(existing, true) : (
                <Link to="/mistakes" className="font-semibold text-[var(--sf-accent-fg)] underline underline-offset-4">
                  {existingLine(existing, false)}
                </Link>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function PresentationMode({ questions, onExit }: { questions: NormalizedQuestion[]; onExit: () => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const total = questions.length;
  const q = questions[index];
  const { correct, scored } = score(questions, answers);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Режим презентации"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[var(--sf-canvas)] text-[var(--sf-ink)]"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--sf-line)] px-5 py-3 sm:px-8">
        <p className="text-sm text-[var(--sf-muted)]">Режим презентации · ответы зрителей не сохраняются</p>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[var(--sf-ink)] hover:bg-[var(--sf-surface-soft)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Выйти
        </button>
      </div>

      {!finished ? (
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
          <p className="mb-3 text-base text-[var(--sf-muted)]">Вопрос {index + 1} из {total}</p>
          <h2 className="mb-8 text-2xl font-semibold leading-snug sm:text-3xl lg:text-4xl">{q.question}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {q.options.map((option, j) => {
              const selected = answers[index] === j;
              return (
                <button
                  type="button"
                  key={j}
                  aria-pressed={selected}
                  onClick={() => setAnswers((prev) => ({ ...prev, [index]: j }))}
                  className={`flex min-h-[64px] items-center gap-4 rounded-xl border px-5 py-4 text-left text-lg transition-colors lg:text-xl ${
                    selected
                      ? 'border-[var(--sf-accent)] bg-[var(--sf-accent-soft)]'
                      : 'border-[var(--sf-line)] bg-[var(--sf-surface)] hover:border-[var(--sf-muted)]'
                  }`}
                >
                  <span className="w-6 shrink-0 font-semibold text-[var(--sf-muted)]">{displayLetter(q.labels, j)}</span>
                  <span className="leading-snug">{optionBody(option, q.labels[j])}</span>
                </button>
              );
            })}
          </div>
          {answers[index] !== undefined && (
            <button
              type="button"
              onClick={() => (index + 1 < total ? setIndex(index + 1) : setFinished(true))}
              className="mt-8 min-h-[52px] self-start rounded-xl bg-[var(--sf-accent)] px-8 text-base font-semibold text-white transition active:translate-y-px hover:bg-[var(--sf-accent-hover)]"
            >
              {index + 1 < total ? 'Следующий вопрос' : 'Завершить тест'}
            </button>
          )}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 sm:px-8">
          <p className="text-4xl font-semibold tabular-nums">
            {correct} из {scored}
          </p>
          <p className="mt-1 text-base text-[var(--sf-muted)]">верных ответов</p>
          <ol className="mt-8 divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]">
            {questions.map((item, i) => {
              const right = item.correctIndex !== null && answers[i] === item.correctIndex;
              return (
                <li key={i} className="flex items-start gap-3 py-4">
                  {item.correctIndex === null ? (
                    <span className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  ) : right ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">
                      {i + 1}. {item.question}
                    </p>
                    <p className="mt-1 text-sm text-[var(--sf-muted)]">
                      {item.correctIndex === null
                        ? 'Правильный ответ не указан, вопрос не учитывается.'
                        : right
                          ? 'Верно.'
                          : `Правильный ответ: ${displayLetter(item.labels, item.correctIndex)}) ${optionBody(item.options[item.correctIndex], item.labels[item.correctIndex])}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={onExit}
            className="mt-8 min-h-[48px] rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-6 text-sm font-semibold hover:bg-[var(--sf-surface-soft)]"
          >
            Закрыть презентацию
          </button>
        </div>
      )}
    </div>
  );
}

export default function QuizView({ data, onComplete, sources = [], materialId, topic = '', surface = 'analysis' }: QuizViewProps) {
  const reduceMotion = useReducedMotion();
  const quiz: unknown = data?.quiz;
  const questions = Array.isArray(quiz) ? normalizeQuestions(quiz) : [];

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: 'off' });

  const attemptRef = useRef<Attempt | null>(null);
  const retakeRef = useRef(false);
  const journal = materialId !== undefined;

  const latest = useRef({ materialId, topic, surface });
  latest.current = { materialId, topic, surface };

  const saveAttempt = useCallback(async (attempt: Attempt) => {
    const { materialId: id, topic: currentTopic, surface: currentSurface } = latest.current;
    if (!id) {
      setSave({ status: 'no_material' });
      return;
    }
    setSave({ status: 'saving' });
    try {
      const result = await recordQuizAttempt({
        sessionId: attempt.sessionId,
        materialId: id,
        retake: attempt.retake,
        surface: currentSurface,
        topic: currentTopic,
        answers: attempt.answers,
      });
      if (attemptRef.current !== attempt) return;
      setSave({
        status: 'saved',
        retake: result.retake,
        mistakesAdded: result.mistakesAdded,
        mistakesExisting: result.mistakesExisting,
      });
    } catch (error) {
      if (attemptRef.current !== attempt) return;
      console.error('Quiz attempt was not saved:', error);
      setSave({
        status: 'failed',
        message: error instanceof LearningSaveError ? error.message : SAVE_FAILED_MESSAGE,
      });
    }
  }, []);

  // The material may reach the library after the test was checked (the insert runs in parallel).
  useEffect(() => {
    if (save.status === 'no_material' && materialId && attemptRef.current) {
      void saveAttempt(attemptRef.current);
    }
  }, [materialId, save.status, saveAttempt]);

  const exitPresentation = useCallback(() => setPresenting(false), []);

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-5 py-6">
        <p className="font-medium text-[var(--sf-ink)]">Теста нет</p>
        <p className="mt-1 text-sm text-[var(--sf-muted)]">В этом результате нет ни одного вопроса.</p>
      </div>
    );
  }

  if (presenting) return <PresentationMode questions={questions} onExit={exitPresentation} />;

  const total = questions.length;
  const answeredCount = Object.keys(answers).length;
  const { correct, scored, unscored } = score(questions, answers);
  const pct = scored > 0 ? Math.round((correct / scored) * 100) : 0;

  const handleSelect = (qi: number, optionIndex: number) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [qi]: optionIndex }));
  };

  const handleSubmit = () => {
    if (submitted || answeredCount < total) return;
    setSubmitted(true);
    if (onComplete && scored > 0) onComplete(pct);
    if (!journal) return;
    const attempt: Attempt = {
      sessionId: newEventId(),
      retake: retakeRef.current,
      answers: attemptAnswers(questions, answers),
    };
    attemptRef.current = attempt;
    void saveAttempt(attempt);
  };

  const handleRetry = () => {
    retakeRef.current = true;
    attemptRef.current = null;
    setAnswers({});
    setSubmitted(false);
    setSave({ status: 'off' });
  };

  const retrySave = () => {
    if (attemptRef.current) void saveAttempt(attemptRef.current);
  };

  return (
    <div className="relative text-[var(--sf-ink)]">
      <div className="mb-6 flex flex-col gap-3 border-b border-[var(--sf-line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Проверочный тест</h3>
          <p className="text-sm text-[var(--sf-muted)]">
            {total} {pluralRu(total, ['вопрос', 'вопроса', 'вопросов'])} по материалу
          </p>
        </div>
        {!submitted && (
          <button
            type="button"
            onClick={() => setPresenting(true)}
            className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-lg px-2 -mx-2 text-sm font-medium text-[var(--sf-muted)] hover:text-[var(--sf-ink)] sm:self-auto"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
            Режим презентации для аудитории
          </button>
        )}
      </div>

      {submitted && (
        <motion.section
          aria-label="Результат теста"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="mb-6 rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-5 py-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              {scored > 0 ? (
                <>
                  <p className="text-lg font-semibold">
                    {correct} из {scored} — {gradeLabel(pct)}
                  </p>
                  <p className="text-sm text-[var(--sf-muted)]">{pct}% правильных ответов</p>
                </>
              ) : (
                <p className="text-lg font-semibold">Проверить ответы не по чему</p>
              )}
              {unscored > 0 && (
                <p className="text-sm text-[var(--sf-muted)]">
                  {unscored === total
                    ? 'Ни у одного вопроса не указан правильный ответ.'
                    : `Без правильного ответа: ${unscored} ${pluralRu(unscored, ['вопрос', 'вопроса', 'вопросов'])}, в результат не входят.`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 self-start rounded-lg border border-[var(--sf-line)] bg-[var(--sf-surface)] px-4 text-sm font-medium hover:bg-[var(--sf-surface-soft)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Пройти снова
            </button>
          </div>
          {journal && (
            <div className="mt-3 border-t border-[var(--sf-line)] pt-3">
              <JournalLine state={save} onRetry={retrySave} />
            </div>
          )}
        </motion.section>
      )}

      <ol className="space-y-4">
        {questions.map((q, i) => {
          const selected = answers[i];
          const unscoredQuestion = q.correctIndex === null;
          return (
            <li key={i} className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-5">
              <p id={`quiz-q-${i}`} className="mb-3 font-medium leading-snug">
                {i + 1}. {q.question}
              </p>
              <div role="group" aria-labelledby={`quiz-q-${i}`} className="space-y-2">
                {q.options.map((option, j) => {
                  const isSelected = selected === j;
                  const isRight = submitted && !unscoredQuestion && q.correctIndex === j;
                  const isWrongChoice = submitted && isSelected && !unscoredQuestion && q.correctIndex !== j;
                  let tone = 'border-[var(--sf-line)] bg-[var(--sf-canvas)] text-[var(--sf-ink)]';
                  if (!submitted) {
                    tone = isSelected
                      ? 'border-[var(--sf-accent)] bg-[var(--sf-accent-soft)] text-[var(--sf-ink)]'
                      : 'border-[var(--sf-line)] bg-[var(--sf-canvas)] text-[var(--sf-ink)] hover:border-[var(--sf-muted)]';
                  } else if (isRight) {
                    tone = 'border-emerald-600/50 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200';
                  } else if (isWrongChoice) {
                    tone = 'border-rose-600/50 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/30 dark:text-rose-200';
                  } else if (isSelected) {
                    tone = 'border-[var(--sf-muted)] bg-[var(--sf-surface-soft)] text-[var(--sf-ink)]';
                  } else {
                    tone = 'border-[var(--sf-line)] bg-[var(--sf-canvas)] text-[var(--sf-muted)]';
                  }
                  return (
                    <button
                      type="button"
                      key={j}
                      aria-pressed={isSelected}
                      disabled={submitted}
                      onClick={() => handleSelect(i, j)}
                      className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${tone}`}
                    >
                      {isRight && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                      {isWrongChoice && <XCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />}
                      <span>{option}</span>
                      {isRight && <span className="sr-only"> — правильный ответ</span>}
                      {isWrongChoice && <span className="sr-only"> — ваш ответ, неверный</span>}
                    </button>
                  );
                })}
              </div>
              {submitted && unscoredQuestion && (
                <p className="mt-3 text-sm text-[var(--sf-muted)]">Правильный ответ не указан, вопрос не учитывается.</p>
              )}
              {submitted && q.explanation && (
                <p className="mt-3 border-t border-[var(--sf-line)] pt-3 text-sm text-[var(--sf-muted)]">
                  <span className="font-medium text-[var(--sf-ink)]">Пояснение:</span> {q.explanation}
                </p>
              )}
              <SourceReferences ids={q.sourceIds} sources={sources} compact />
            </li>
          );
        })}
      </ol>

      {!submitted && (
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-[var(--sf-muted)]">
            Отвечено {answeredCount} из {total}
          </p>
          {answeredCount === total && (
            <button
              type="button"
              onClick={handleSubmit}
              className="min-h-[48px] rounded-xl bg-[var(--sf-accent)] px-8 text-base font-semibold text-white shadow-[0_2px_0_rgba(0,0,0,0.18)] transition hover:bg-[var(--sf-accent-hover)] active:translate-y-px active:shadow-none"
            >
              Проверить ответы
            </button>
          )}
        </div>
      )}
    </div>
  );
}
