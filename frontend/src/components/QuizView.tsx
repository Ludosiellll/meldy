import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, RotateCcw, X, XCircle } from 'lucide-react';
import SourceReferences from './SourceReferences';
import { pluralRu } from './conversation/visuals';
import { stemsOf, stripSourceMarkers } from './summary/fragmentModel';
import {
  LearningSaveError,
  SAVE_FAILED_MESSAGE,
  newEventId,
  recordQuizAttempt,
  type QuizAttemptAnswer,
} from '../api/learning';
import './QuizView.css';

/** What the fragment panel says over a question's fragments: they are found by shared words, not checked. */
export const QUESTION_SOURCE_NOTE = 'Здесь в лекции больше всего общих слов с вопросом.';

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
 * Without the prop nothing is recorded.
 * The presentation mode is for an audience and is never recorded; it opens from «Экспорт» → «Показать на экране»
 * (ResultsPanel passes `presenting`), not from a button in a student's test (finding LIB-17).
 *
 * Options are lettered «А) Б) В) Г)» on screen whatever the model wrote («A) B) C) D)», whose «B» and «C» read as
 * Cyrillic «В» and «С» — finding LIB-15); the journal keeps the option's own letter, so matching is unchanged.
 */

export interface QuizViewProps {
  data: any;
  sources?: { id: string; text: string }[];
  materialId?: string | null;
  topic?: string;
  surface?: 'analysis' | 'material';
  /** The full-screen mode for an audience is open (ResultsPanel's «Экспорт» → «Показать на экране»). */
  presenting?: boolean;
  /** Leaving the full-screen mode (Escape, «Выйти», «Закрыть презентацию»). */
  onExitPresentation?: () => void;
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

/** The letter the student sees: «А», «Б», «В», «Г»… by the option's place. */
export function shownLetter(index: number): string {
  return CYRILLIC_LETTERS[index] ?? String(index + 1);
}

function normalizeQuestions(quiz: unknown[]): NormalizedQuestion[] {
  return quiz.map((item) => {
    const q = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    // The model sometimes copies the fragment labels «[S02]» of its input into the text: not for the student's eyes.
    const options = Array.isArray(q.options)
      ? q.options.map((option) => stripSourceMarkers(typeof option === 'string' ? option : String(option ?? '')))
      : [];
    return {
      question: typeof q.question === 'string' ? stripSourceMarkers(q.question) : '',
      options,
      labels: optionLabels(options),
      correctIndex: correctOptionIndex(options, typeof q.correct === 'string' ? stripSourceMarkers(q.correct) : q.correct),
      explanation: typeof q.explanation === 'string' ? stripSourceMarkers(q.explanation) : '',
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

/**
 * «2 из 3 верно», «0 из 1 верно — нужно подтянуть». No words of the 5-point scale («Отлично»,
 * «Удовлетворительно»): the department grades on 10 points, Meldy only counts the right answers (Ф1).
 */
function scoreLine(correct: number, scored: number, pct: number): string {
  return `${correct} из ${scored} верно${pct < 50 ? ' — нужно подтянуть' : ''}`;
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
      <p role="status" className="qz-journal-line">
        Результат не сохранён: материал ещё не в библиотеке
      </p>
    );
  }
  if (state.status === 'saving') {
    return (
      <p role="status" aria-live="polite" className="qz-journal-line">
        Сохраняем результат…
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <div role="alert" className="qz-journal-line qz-journal-failed">
        <span>{state.message === SAVE_FAILED_MESSAGE ? 'Результат не сохранён.' : state.message}</span>
        <button type="button" onClick={onRetry} className="qz-link">
          Повторить
        </button>
      </div>
    );
  }
  const { mistakesAdded: added, mistakesExisting: existing } = state;
  return (
    <div role="status" className="qz-journal-line qz-journal-saved">
      <p>Результат сохранён</p>
      {state.retake && <p>Повторная попытка: в «Прогрессе» считается первая</p>}
      {(added > 0 || existing > 0) && (
        <p>
          {added > 0 && (
            <Link to="/mistakes" className="qz-link">
              {addedLine(added)}
            </Link>
          )}
          {existing > 0 && (
            <>
              {added > 0 ? ', ' : ''}
              {added > 0 ? existingLine(existing, true) : (
                <Link to="/mistakes" className="qz-link">
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
    <div role="dialog" aria-modal="true" aria-label="Режим презентации" className="qz-pres">
      <div className="qz-pres-bar">
        <p>Режим презентации · ответы зрителей не сохраняются</p>
        <button type="button" onClick={onExit} className="qz-chip">
          <X aria-hidden="true" strokeWidth={2} />
          Выйти
        </button>
      </div>

      {!finished ? (
        <div className="qz-pres-stage">
          <p className="qz-pres-count">Вопрос {index + 1} из {total}</p>
          <h2 className="qz-pres-q">{q.question}</h2>
          <div className="qz-pres-options">
            {q.options.map((option, j) => {
              const selected = answers[index] === j;
              return (
                <button
                  type="button"
                  key={j}
                  aria-pressed={selected}
                  onClick={() => setAnswers((prev) => ({ ...prev, [index]: j }))}
                  className="qz-pres-opt"
                >
                  <span className="qz-letter">{shownLetter(j)}</span>
                  <span>{optionBody(option, q.labels[j])}</span>
                </button>
              );
            })}
          </div>
          {answers[index] !== undefined && (
            <button
              type="button"
              onClick={() => (index + 1 < total ? setIndex(index + 1) : setFinished(true))}
              className="sf-primary qz-pres-next"
            >
              {index + 1 < total ? 'Следующий вопрос' : 'Завершить'}
            </button>
          )}
        </div>
      ) : (
        <div className="qz-pres-done">
          <p className="qz-pres-score">
            {correct} из {scored}
          </p>
          <p className="qz-pres-score-cap">верных ответов</p>
          <ol className="qz-pres-list">
            {questions.map((item, i) => {
              const right = item.correctIndex !== null && answers[i] === item.correctIndex;
              return (
                <li key={i}>
                  {item.correctIndex === null ? (
                    <span className="qz-pres-mark" aria-hidden="true" />
                  ) : right ? (
                    <CheckCircle2 className="qz-pres-mark" data-tone="right" aria-hidden="true" />
                  ) : (
                    <XCircle className="qz-pres-mark" data-tone="wrong" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="qz-pres-item">
                      {i + 1}. {item.question}
                    </p>
                    <p className="qz-pres-item-sub">
                      {item.correctIndex === null
                        ? 'Правильный ответ не указан, вопрос не учитывается.'
                        : right
                          ? 'Верно.'
                          : `Правильный ответ: ${shownLetter(item.correctIndex)}) ${optionBody(item.options[item.correctIndex], item.labels[item.correctIndex])}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={onExit} className="qz-chip qz-pres-close">
            Закрыть презентацию
          </button>
        </div>
      )}
    </div>
  );
}

export default function QuizView({ data, sources = [], materialId, topic = '', surface = 'analysis', presenting = false, onExitPresentation }: QuizViewProps) {
  const reduceMotion = useReducedMotion();
  const quiz: unknown = data?.quiz;
  const questions = Array.isArray(quiz) ? normalizeQuestions(quiz) : [];

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
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

  const exitPresentation = useCallback(() => onExitPresentation?.(), [onExitPresentation]);

  if (questions.length === 0) {
    return (
      <div className="qz-empty">
        <p className="qz-empty-h">Самопроверки нет</p>
        <p className="qz-empty-p">В этом результате нет ни одного вопроса.</p>
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
    <div className="qz">
      <div className="qz-head">
        <div>
          <h3 className="qz-title">Самопроверка</h3>
          <p className="qz-sub">
            {total} {pluralRu(total, ['вопрос', 'вопроса', 'вопросов'])} по материалу
          </p>
        </div>
      </div>

      {submitted && (
        <motion.section
          aria-label="Результат самопроверки"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="qz-result"
        >
          <div className="qz-result-top">
            <div className="qz-result-main">
              {scored > 0 ? (
                <>
                  <p className="qz-score">{scoreLine(correct, scored, pct)}</p>
                  <p className="qz-pct">{pct}% правильных ответов</p>
                </>
              ) : (
                <p className="qz-score">Проверить ответы не по чему</p>
              )}
              {unscored > 0 && (
                <p className="qz-pct">
                  {unscored === total
                    ? 'Ни у одного вопроса не указан правильный ответ.'
                    : `Без правильного ответа: ${unscored} ${pluralRu(unscored, ['вопрос', 'вопроса', 'вопросов'])}, в результат не входят.`}
                </p>
              )}
            </div>
            <button type="button" onClick={handleRetry} className="qz-chip">
              <RotateCcw aria-hidden="true" strokeWidth={1.75} />
              Пройти снова
            </button>
          </div>
          {journal && (
            <div className="qz-journal">
              <JournalLine state={save} onRetry={retrySave} />
            </div>
          )}
        </motion.section>
      )}

      <ol className="qz-list">
        {questions.map((q, i) => {
          const selected = answers[i];
          const unscoredQuestion = q.correctIndex === null;
          return (
            <li key={i} className="qz-card" data-answered={selected !== undefined ? '' : undefined}>
              <p id={`quiz-q-${i}`} className="qz-q">
                {i + 1}. {q.question}
              </p>
              <div role="group" aria-labelledby={`quiz-q-${i}`} className="qz-options">
                {q.options.map((option, j) => {
                  const isSelected = selected === j;
                  const isRight = submitted && !unscoredQuestion && q.correctIndex === j;
                  const isWrongChoice = submitted && isSelected && !unscoredQuestion && q.correctIndex !== j;
                  // What the option shows: chosen before the check, then right, the wrong choice, an unscored choice or the rest.
                  let state = isSelected ? 'selected' : 'idle';
                  if (submitted) state = isRight ? 'right' : isWrongChoice ? 'wrong' : isSelected ? 'chosen' : 'rest';
                  return (
                    <button
                      type="button"
                      key={j}
                      aria-pressed={isSelected}
                      disabled={submitted}
                      onClick={() => handleSelect(i, j)}
                      className="qz-opt"
                      data-state={state}
                    >
                      {isRight && <CheckCircle2 className="qz-opt-mark" aria-hidden="true" />}
                      {isWrongChoice && <XCircle className="qz-opt-mark" aria-hidden="true" />}
                      <span>
                        <span className="qz-opt-letter">{shownLetter(j)})</span> {optionBody(option, q.labels[j])}
                      </span>
                      {isRight && <span className="sr-only"> — правильный ответ</span>}
                      {isWrongChoice && <span className="sr-only"> — ваш ответ, неверный</span>}
                    </button>
                  );
                })}
              </div>
              {submitted && unscoredQuestion && <p className="qz-note">Правильный ответ не указан, вопрос не учитывается.</p>}
              {submitted && q.explanation && (
                <p className="qz-explain">
                  <span className="qz-explain-h">Пояснение:</span> {q.explanation}
                </p>
              )}
              <SourceReferences
                ids={q.sourceIds}
                sources={sources}
                note={QUESTION_SOURCE_NOTE}
                panelKey={`q-${i + 1}`}
                stems={[...stemsOf(`${q.question} ${q.explanation}`)]}
                compact
              />
            </li>
          );
        })}
      </ol>

      {!submitted && (
        <div className="qz-submit">
          <p className="qz-progress">
            Отвечено {answeredCount} из {total}
          </p>
          {answeredCount === total && (
            <button type="button" onClick={handleSubmit} className="sf-primary">
              Проверить ответы
            </button>
          )}
        </div>
      )}
    </div>
  );
}
