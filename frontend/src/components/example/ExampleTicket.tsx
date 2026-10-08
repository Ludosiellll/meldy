import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useConfirm } from '../../contexts/ConfirmContext';
import { SPEECH_ERROR_MESSAGES, SPEECH_UNSUPPORTED_MESSAGE, joinSpeech, useSpeechAnswer } from '../../hooks/useSpeechAnswer';
import { Mark, seedFrom } from '../marks';
import TicketCard, { ticketHeading } from '../oral/TicketCard';
import RubricSlots from '../oral/RubricSlots';
import LiveTranscript from '../oral/LiveTranscript';
import ExaminerLine, { ExaminerThinking } from '../oral/ExaminerLine';
import PrivacySheet from '../oral/PrivacySheet';
import { ProtocolSheet, livePoints, type ProtocolFollowup } from '../oral/OralProtocol';
import { liveMarks, namedPoints, underlinedFinalWords, words } from '../../lib/oral/rubricMatch';
import { answerTime, closingLine, initialTicketState, ticketReducer, type AnswerMode, type TicketState } from '../../lib/oral/ticketMachine';
import type { AnswerInput } from '../../lib/oral/oralPersistence';
import { elapsedLabel, glue, longDateTime, plural } from '../../lib/oral/format';
import { exampleQuestion, exampleRubricResponse, exampleTicket, type ExampleQuestion } from '../../data/example';
import { answerQuote, exampleFollowup, judgeFollowupAnswer, keywordEvaluation } from './exampleFlow';
import {
  checkLine,
  checkSummary,
  checkTryAnswer,
  checkTryFollowup,
  followupPlan,
  keptEvaluation,
  parseCheckSummary,
  tryEvaluation,
  type TryCheck,
  type TryFollowupCheck,
} from './tryCheck';
import { saysDontKnow } from '../../lib/oral/followup';
import { FINISH_SHORTCUTS, finishKeysLabel, isFinishKey, useDeskColumn } from '../oral/roomDesk';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import ExampleGrade from './ExampleGrade';
import TryBar, { ownExamHref } from './TryBar';
import { countBucket, track } from '../../lib/telemetry';
import { usePasteGuard } from '../oral/usePasteGuard';
import PasteNotice from '../oral/PasteNotice';
import { answerChange, type AnswerChange } from '../exams/sheet/answerChange';
import { protocolSheetLine } from '../exams/sheet/copy';
import type { Evaluation } from '../../lib/oral/oralApi';
import { exampleRubric } from '../../data/example';
import {
  EXAMPLE_ANSWER_Q5,
  EXAMPLE_ANSWER_QUESTION,
  findTryAnswer,
  isSeededSession,
  saveTryAnswer,
  setTryPeak,
  trySheetQuestions,
  tryEvents,
  type TryAnswer,
} from './trySheet';

/** The example's cheat sheet: the answers erase its lines (sheet spec 4.3). */
const TRY_SHEET_PATH = '/try?view=sheet';

/** «Экзаменатор слушает ответ…» stays at least this long after «Готово» (the real screen waits for its quick check). */
export const EXAMINER_PAUSE_MS = 900;
/**
 * The examiner asks about a point the AI's protocol did not find — or, when the AI is slower than this,
 * about one the key words did not find (the real ticket's quick check gets 4.5 s on the server). The
 * protocol still waits for the AI (up to tryCheck.TRY_CHECK_TIMEOUT_MS) while the follow-up is answered.
 */
export const FOLLOWUP_WAIT_MS = 4500;
/** With nothing to ask, the examiner's closing line stays this long before the protocol. */
export const CLOSING_PAUSE_MS = 1400;
/**
 * A spoken answer to the follow-up is listened to this long after the question appears. The real screen
 * starts 300 ms after the examiner's voice ends; the example shows the question as text only: its voice
 * comes from /api/tts, which needs an account (the example's one call is the AI check of the answer).
 */
export const FOLLOWUP_LISTEN_MS = 300;
const SILENCE_HINT_MS = 8000;
const LONG_ANSWER_MS = 120_000;
/** The real screen's line when the follow-up's answer was not heard (pages/ExamTicket NOT_HEARD_LINE). */
const NOT_HEARD_LINE = 'Не расслышал ответ';
const EMPTY_ANSWER_NOTICE = 'Ответ пустой: скажите или напишите ответ, потом нажмите «Готово».';

/** Who sees the answer in the example: the browser, then Meldy's server and the Google model that check it (try_api.py). */
export const EXAMPLE_PRIVACY_LINE =
  'Речь распознаёт браузер, в Chrome — через сервис Google. Для проверки текст ответа отправляется на сервер Meldy и в ИИ-сервис Google Gemini. Meldy его не сохраняет.';

/** Leaving an unfinished answer: the tab keeps finished answers (the sheet erases by them), not this one (PUB-3). */
export const LEAVE_MESSAGE = 'Ответ пропадёт: незаконченный ответ нигде не сохраняется.';

/** Before the answer, above the two ways to answer: what «Готово» leads to (EX-32 for the example; no units here). */
export const EXAMPLE_NEXT_LINE = 'После «Готово» экзаменатор спросит о пропущенном пункте, если он есть, а потом откроется протокол по пунктам из лекций.';

function inputOf(usedSpeech: boolean, usedText: boolean): AnswerInput {
  if (usedSpeech && usedText) return 'mixed';
  return usedSpeech ? 'speech' : 'text';
}

/** The state machine of the real answer screen, loaded with the example's question and its points. */
function setupRoom(question: ExampleQuestion): TicketState {
  const { exam, question: ticketQuestion } = exampleTicket(question);
  const response = exampleRubricResponse(question);
  let state = ticketReducer(initialTicketState(), { type: 'loaded', exam, questions: [ticketQuestion] });
  if (response) state = ticketReducer(state, { type: 'rubric', run: state.run, rubric: { status: 'ready', response } });
  return ticketReducer(state, { type: 'limit', run: state.run, limit: 'ok' });
}

/** «4 пункта ответа из лекций примера…» above the sheet before the answer. */
export function exampleNoteLine(question: ExampleQuestion, points: number): string {
  const head = `${points} ${plural(points, 'пункт', 'пункта', 'пунктов')} ответа из лекций примера. Они откроются, когда вы их назовёте.`;
  return question.coverage === 'partial' && question.missing
    ? `${head} В лекциях нет ${question.missing}, поэтому пунктов об этом тоже нет.`
    : head;
}

/**
 * The answer screen of the example (/try/ticket?q=…): the question from the draw. A question the
 * example cannot check (unknown, or in no lecture) gets an honest line and the way back.
 */
export default function ExampleTicket() {
  useDocumentTitle('Билет · пример');
  const [params] = useSearchParams();
  const question = exampleQuestion(params.get('q'));
  if (!question || question.coverage === 'none' || question.points.length === 0) return <TicketMissing question={question} />;
  // An answer kept in this tab (the line's history of the sheet): its protocol, to read.
  const kept = findTryAnswer(params.get('answer'));
  if (kept && kept.questionId === question.id) return <KeptProtocol question={question} answer={kept} />;
  return <ExampleRoom key={question.id} question={question} />;
}

/** What one answer of the example changed on the example's sheet («На шпаргалке: …»). */
function sheetChangeOf(answer: TryAnswer, events = tryEvents({ v: 1, seededAt: 0, answers: [answer], peeks: [] })): AnswerChange | null {
  const sheetQuestion = trySheetQuestions().find((item) => item.question_id === answer.questionId);
  return sheetQuestion ? answerChange(sheetQuestion, events, answer.session, Date.now()) : null;
}

/**
 * «На шпаргалке: 3 строки стёрлись, 1 — наполовину» — in the protocol's header, where the real protocol
 * says what the answer did to the sheet (Ф1); «К шпаргалке» on the desk leads there.
 */
function sheetNoteOf(change: AnswerChange | null): string | null {
  return change ? glue(protocolSheetLine(change.summary, change.quiet)) : null;
}

/**
 * The protocol of an answer kept in this tab: yesterday's answers of the example, or the guest's own.
 * The same paper as after an answer, read only: the points as they were named, the result, the way
 * back to the sheet and to answering again.
 */
function KeptProtocol({ question, answer }: { question: ExampleQuestion; answer: TryAnswer }) {
  const deskRef = useDeskColumn();
  const rubric = exampleRubric(question);
  if (!rubric) return <TicketMissing question={question} />;
  const checked = parseCheckSummary(answer.check) ?? { by: 'keywords' as const };
  // The AI's own protocol when it checked the answer; otherwise the statuses with the key words' quotes.
  const byAI = checked.by === 'ai' ? keptEvaluation(answer.evaluation, rubric.points.map((point) => point.id)) : null;
  const evaluation: Evaluation = byAI ?? {
    points: rubric.points.map((point) => {
      const status = answer.statuses[point.id] ?? 'missing';
      return { id: point.id, status, student_quote: status === 'missing' ? '' : answerQuote(answer.transcript, point.anchors), comment: '' };
    }),
    errors: [],
    verdict: '',
  };
  const live = Array.isArray(answer.live) ? answer.live.filter((id): id is string => typeof id === 'string') : null;
  const named = new Set(live ?? rubric.points.filter((point) => answer.statuses[point.id] === 'covered').map((point) => point.id));
  const points = livePoints(rubric, evaluation, named);
  const followup = answer.followup ? { ...answer.followup } : null;
  const heading = ticketHeading(null, 0, 1, String(question.number));
  const seeded = isSeededSession(answer.session);
  const when = longDateTime(new Date(answer.at));
  return (
    <>
      <TryBar where="Лист примера" back="/try" />
      <main className="sf-page or-room tx-room" data-phase="protocol">
        <h1 className="sr-only or-sr-title" tabIndex={-1}>
          {`Протокол ответа, ${heading.strong}`}
        </h1>
        <section className="or-left" aria-label="Пункты ответа и ваш ответ">
          <ProtocolSheet
            heading={glue(`${heading.strong} · ответ ${when}`)}
            points={points}
            followup={followup}
            checkNote={glue(checkLine(checked))}
            seed={`example:${question.id}:${answer.session}`}
            animate={false}
          />
        </section>
        <section className="or-side" aria-label="Итог" ref={deskRef}>
          <p className="or-readonly-note">
            {glue(
              seeded
                ? `Ответ примера: считаем, что он дан вчера, ${when}. Строки названных в нём пунктов этот ответ стёр на шпаргалке наполовину.`
                : `Ваш ответ от ${when}. Протокол только для чтения.`,
            )}
          </p>
          {seeded ? <p className="or-readonly-note tx-kept-said">{`«${answer.transcript}»`}</p> : null}
          <ExampleGrade points={points} followup={followup} checked={checked}>
            <div className="or-acts" data-wide="">
              <Link className="sf-primary" to={`/try/ticket?q=${encodeURIComponent(question.id)}`}>
                Ответить на этот вопрос
              </Link>
              <Link className="sf-link" to={TRY_SHEET_PATH}>
                К шпаргалке
              </Link>
            </div>
          </ExampleGrade>
        </section>
      </main>
    </>
  );
}

function TicketMissing({ question }: { question: ExampleQuestion | null }) {
  return (
    <>
      <TryBar where="Лист примера" back="/try" />
      <main className="sf-page or-room or-room-single">
        <div className="or-state">
          <h1 className="or-state-title">{question ? 'Этого вопроса нет в лекциях примера' : 'Такого вопроса в примере нет'}</h1>
          <p className="or-state-text">{question ? 'Ответ на него не с чем сверить. Вытяните билет из вопросов, которые в лекциях есть.' : 'Вытяните билет из списка примера.'}</p>
          <div className="or-acts">
            <Link className="sf-primary" to="/try/draw">
              Тянуть билет
            </Link>
            <Link className="sf-link" to="/try">
              Лист примера
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

/**
 * The live room of the example: the same machine and paper as a real ticket (lib/oral/ticketMachine,
 * components/oral) — the ticket card, the answer sheet whose points open as their key words are said
 * or typed, «Готово», the examiner's follow-up on a point that was not named, the protocol with the
 * lecture quotes and the result. At «Готово» the answer goes to the AI check once (tryCheck.ts,
 * backend/try_api.py): the protocol is the AI's, as on a real ticket, and the follow-up is chosen by
 * its statuses when they come in time. Without the AI check the key words on this device decide, as the
 * example always did (exampleFlow.ts), and the protocol says so. Nothing is saved but in this tab.
 */
function ExampleRoom({ question }: { question: ExampleQuestion }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const speech = useSpeechAnswer();
  const [state, dispatch] = useReducer(ticketReducer, question, setupRoom);
  const stateRef = useRef(state);
  stateRef.current = state;
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [attempts, setAttempts] = useState(0);
  /** The text in which each point first lit up: its words for the protocol when the final answer lost them. */
  const namedInRef = useRef<Record<string, string>>({});
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mountedRef = useRef(true);
  /** Bumps with every new attempt: a pause of an older attempt does nothing. */
  const attemptRef = useRef(0);
  /** Bumps with every step of the follow-up: a listening start of an older step does nothing. */
  const askRef = useRef(0);
  const roomRef = useRef<HTMLElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const focusTextRef = useRef(false);
  /** How the latest attempt was checked, once known: the AI's protocol, «не знаю», or key words and why. */
  const [check, setCheck] = useState<{ attemptId: string; result: TryCheck } | null>(null);
  /** The same, for the reply to the follow-up: whether its AI check is worth asking, and how long to wait. */
  const checkRef = useRef<{ attemptId: string; result: TryCheck } | null>(null);
  /** The AI checks in flight (the answer's, then the reply's): a new attempt or leaving the page stops them. */
  const checkAbortRef = useRef<AbortController | null>(null);
  /** The desk column follows the reader on a computer (oral.css): «Готово» and the next steps stay in view. */
  const deskRef = useDeskColumn();

  const rubric = state.rubric.status === 'ready' ? state.rubric.response.rubric : null;
  const points = useMemo(() => rubric?.points ?? [], [rubric]);
  const voiceAnswer = state.mode === 'voice';
  const finalText = voiceAnswer ? speech.finalText : state.typed;
  const interimText = voiceAnswer ? speech.interimText : '';
  const answerText = joinSpeech(finalText, interimText);

  const later = useCallback((callback: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      if (mountedRef.current) callback();
    }, ms);
    timersRef.current.add(timer);
  }, []);

  /** A pause that ends with the page: a promise that never settles once the room is gone. */
  const wait = useCallback((ms: number) => new Promise<void>((resolve) => later(resolve, ms)), [later]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      checkAbortRef.current?.abort();
    };
  }, []);

  // ── Live marks: computed in the render that brings the words, kept in state so they only add ──
  const marksActive = state.phase === 'answering' && points.length > 0;
  const named = useMemo(() => {
    const known = new Set(state.named);
    if (!marksActive) return known;
    for (const id of namedPoints(points, answerText)) known.add(id);
    return known;
  }, [answerText, marksActive, points, state.named]);

  useEffect(() => {
    if (!marksActive || named.size === state.named.length) return;
    const added = points.filter((point) => named.has(point.id) && !state.named.includes(point.id));
    for (const point of added) if (!namedInRef.current[point.id]) namedInRef.current[point.id] = answerText;
    const announcement = added.map((point) => `Пункт ${points.indexOf(point) + 1} назван: ${point.title}`).join('. ');
    dispatch({ type: 'marks', named: points.filter((point) => named.has(point.id)).map((point) => point.id), announcement });
  }, [answerText, marksActive, named, points, state.named]);

  // Speech that produced words makes the answer a spoken one.
  useEffect(() => {
    if (state.phase === 'answering' && voiceAnswer && (speech.finalText || speech.interimText)) dispatch({ type: 'heard' });
  }, [speech.finalText, speech.interimText, state.phase, voiceAnswer]);

  // ── The clock ──
  const ticking = state.phase === 'answering' || state.phase === 'followup';
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  // ── Recognition failed: the same answer continues as text ──
  useEffect(() => {
    if (speech.status !== 'error' || !speech.error) return;
    const message = SPEECH_ERROR_MESSAGES[speech.error];
    const current = stateRef.current;
    if (current.phase === 'answering' && current.mode === 'voice') {
      dispatch({ type: 'mode', mode: 'text', typed: speechRef.current.snapshot(), now: Date.now() });
      dispatch({ type: 'notice', text: message });
    } else if (current.phase === 'followup' && current.followup?.mode === 'voice') {
      dispatch({ type: 'followup_mode', mode: 'text', typed: speechRef.current.snapshot() });
      dispatch({ type: 'notice', text: message });
    }
  }, [speech.status, speech.error]);

  // ── The protocol opens once the check is done (after the closing line, when there was no follow-up) ──
  useEffect(() => {
    if (state.phase !== 'evaluating' || state.evaluation.status !== 'done') return;
    const timer = setTimeout(() => dispatch({ type: 'protocol' }), state.closing ? CLOSING_PAUSE_MS : 0);
    return () => clearTimeout(timer);
  }, [state.phase, state.evaluation.status, state.closing]);

  // ── The protocol keeps the answer in this tab: the example's sheet erases by it (sheet spec 4.3) ──
  const keptSession = useRef<{ attempt: string; session: string } | null>(null);
  const [sheetChange, setSheetChange] = useState<AnswerChange | null>(null);
  // «Чистый ответ» (Н7), as on a real ticket: a pasted ready text is refused; «Вставить ответ примера» is a button.
  const answerPaste = usePasteGuard((words) => track('try_answer_paste_refused', { field: 'answer', words: countBucket(words) }));
  const followupPaste = usePasteGuard((words) => track('try_answer_paste_refused', { field: 'followup', words: countBucket(words) }));
  useEffect(() => {
    if (state.phase !== 'protocol' || state.evaluation.status !== 'done' || !state.attempt) return;
    const attemptId = state.attempt.attemptId;
    if (keptSession.current?.attempt === attemptId) return;
    const session = `try-${Date.now().toString(36)}-${attemptId}`;
    keptSession.current = { attempt: attemptId, session };
    const statuses: TryAnswer['statuses'] = {};
    for (const point of state.evaluation.result.points) if (point.status !== 'unrated') statuses[point.id] = point.status;
    const f = state.followup;
    const checked = check && check.attemptId === attemptId ? check.result : null;
    const answer: TryAnswer = {
      session,
      questionId: question.id,
      at: Date.parse(state.attempt.startedAt) || Date.now(),
      transcript: state.attempt.transcript ?? '',
      statuses,
      followup: f && f.status ? { pointId: f.pointId, question: f.question, answer: f.answer, status: f.status, judgedBy: f.judgedBy } : null,
      ...(checked ? { check: checkSummary(checked), live: [...state.named] } : {}),
      ...(checked?.by === 'ai' ? { evaluation: state.evaluation.result } : {}),
    };
    const store = saveTryAnswer(answer);
    setTryPeak(question.id);
    setSheetChange(sheetChangeOf(answer, tryEvents(store)));
  }, [question.id, state.phase, state.evaluation, state.attempt, state.followup, state.named, check]);

  // ── Leaving: an answer in progress is lost (only a finished one is kept in this tab), so ask first ──
  const inProgress = () => {
    const current = stateRef.current;
    if (current.phase === 'answering') return joinSpeech(current.mode === 'voice' ? speechRef.current.snapshot() : current.typed) !== '';
    return current.phase === 'finalizing' || current.phase === 'examiner' || current.phase === 'followup' || current.phase === 'evaluating';
  };
  const leave = async (to: string) => {
    if (inProgress()) {
      const ok = await confirm({
        title: 'Выйти из билета?',
        // The tab keeps finished answers (the sheet erases by them): only this unfinished one is lost (PUB-3).
        message: LEAVE_MESSAGE,
        confirmText: 'Выйти',
        cancelText: 'Остаться',
        type: 'warning',
      });
      if (!ok) return;
    }
    navigate(to);
  };

  // ── Answering ──
  const startVoice = () => {
    if (!speech.supported) {
      focusTextRef.current = true;
      dispatch({ type: 'start', mode: 'text', now: Date.now() });
      return;
    }
    speech.reset(state.typed);
    if (speech.start()) dispatch({ type: state.phase === 'answering' ? 'mode' : 'start', mode: 'voice', now: Date.now() });
  };

  /**
   * «Вставить ответ примера»: the example's own answer in the text field, whatever the mode was. A button,
   * not a paste: «Чистый ответ» does not stop it, and a line about a refused paste goes away.
   */
  const insertExample = () => {
    answerPaste.clear();
    focusTextRef.current = true;
    if (state.phase === 'ready') {
      dispatch({ type: 'start', mode: 'text', now: Date.now() });
    } else if (state.phase === 'answering' && voiceAnswer) {
      speech.reset(EXAMPLE_ANSWER_Q5);
      dispatch({ type: 'mode', mode: 'text', typed: EXAMPLE_ANSWER_Q5, now: Date.now() });
      return;
    }
    dispatch({ type: 'typed', text: EXAMPLE_ANSWER_Q5 });
  };

  const startText = () => {
    focusTextRef.current = true;
    if (state.phase === 'answering' && voiceAnswer) {
      const text = speech.snapshot();
      speech.reset(text);
      dispatch({ type: 'mode', mode: 'text', typed: text, now: Date.now() });
      return;
    }
    dispatch({ type: 'start', mode: 'text', now: Date.now() });
  };

  const pause = () => {
    speech.pause();
    dispatch({ type: 'pause', now: Date.now() });
  };

  const resume = () => {
    if (speech.start()) dispatch({ type: 'resume', now: Date.now() });
  };

  /** A new attempt at the same question: the answer, the marks and the follow-up start over. */
  const answerAgain = () => {
    attemptRef.current += 1;
    askRef.current += 1;
    namedInRef.current = {};
    checkAbortRef.current?.abort();
    checkAbortRef.current = null;
    checkRef.current = null;
    speech.reset('');
    setSheetOpen(false);
    setCheck(null);
    dispatch({ type: 'restart' });
  };

  const restartAnswer = async () => {
    const ok = await confirm({
      title: 'Начать ответ заново?',
      message: 'Сказанное и написанное в этом ответе будет стёрто.',
      confirmText: 'Начать заново',
      cancelText: 'Отмена',
      type: 'warning',
    });
    if (ok) answerAgain();
  };

  const listenFollowup = useCallback((token: number) => {
    const current = stateRef.current;
    if (!mountedRef.current || token !== askRef.current || current.phase !== 'followup' || !current.followup) return;
    if (current.followup.stage === 'done' || current.followup.mode !== 'voice') return;
    if (speechRef.current.start()) dispatch({ type: 'followup_listen' });
    else dispatch({ type: 'followup_mode', mode: 'text', typed: speechRef.current.snapshot() });
  }, []);

  /**
   * «Готово»: the answer goes to the AI check once (key words when it is not there); the examiner asks
   * about a point the check did not find, by the key words when the AI is slow.
   */
  const finish = () => {
    const current = stateRef.current;
    if (current.phase !== 'answering' || !rubric) return;
    const voice = current.mode === 'voice';
    const snapshot = voice ? speech.snapshot() : current.typed;
    if (words(snapshot).length === 0) {
      dispatch({ type: 'notice', text: EMPTY_ANSWER_NOTICE });
      return;
    }
    const attempt = (attemptRef.current += 1);
    const attemptId = `example-${attempt}`;
    const live = liveMarks(rubric.points, snapshot, '', new Set(current.named));
    for (const id of live) if (!namedInRef.current[id]) namedInRef.current[id] = snapshot;
    const input = inputOf(current.usedSpeech || (voice && words(snapshot).length > 0), current.usedText);
    dispatch({ type: 'finalize', attemptId, snapshot, live: Array.from(live), input, now: Date.now(), startedAt: new Date().toISOString() });
    track('try_answered', { mode: voice ? 'voice' : 'text' });
    setAttempts((count) => count + 1);
    checkAbortRef.current?.abort();
    const controller = new AbortController();
    checkAbortRef.current = controller;
    const pointIds = rubric.points.map((point) => point.id);
    const heard = voice ? speech.stop() : Promise.resolve(snapshot);
    void heard.then((text) => {
      if (!mountedRef.current || attempt !== attemptRef.current) return;
      const transcript = words(text).length > 0 ? text : snapshot;
      dispatch({ type: 'transcript', text: transcript });
      const keywords = keywordEvaluation(rubric.points, live, transcript, namedInRef.current);
      // One AI check per answer: the protocol is the AI's, or the key words' with the reason why.
      const checked = checkTryAnswer(question.id, transcript, pointIds, { signal: controller.signal });
      void checked.then((result) => {
        if (!mountedRef.current || attempt !== attemptRef.current) return;
        checkRef.current = { attemptId, result };
        setCheck({ attemptId, result });
        track('try_checked', result.by === 'keywords' ? { by: result.by, reason: result.reason } : { by: result.by });
        dispatch({ type: 'evaluation_done', run: stateRef.current.run, result: tryEvaluation(result, pointIds, keywords) });
      });
      dispatch({ type: 'examiner' });
      // The examiner asks once the check is in, or by the key words when the AI takes longer than FOLLOWUP_WAIT_MS.
      const inTime = Promise.race([checked, wait(FOLLOWUP_WAIT_MS).then(() => null)]);
      void Promise.all([inTime, wait(EXAMINER_PAUSE_MS)]).then(([result]) => {
        if (!mountedRef.current || attempt !== attemptRef.current || stateRef.current.phase !== 'examiner') return;
        const choice = exampleFollowup(rubric.points, snapshot, result ? tryEvaluation(result, pointIds, keywords) : keywords);
        const point = choice ? rubric.points.find((item) => item.id === choice.pointId) : undefined;
        if (choice && point && point.followup.question) {
          const mode: AnswerMode = voice && speechRef.current.supported && speechRef.current.status !== 'error' ? 'voice' : 'text';
          // The answer itself is kept in the attempt; the recognizer starts empty for the follow-up's answer.
          speechRef.current.reset('');
          if (mode === 'text') focusTextRef.current = true;
          dispatch({ type: 'followup', pointId: point.id, question: point.followup.question, expected: point.followup.expected, chosenBy: choice.chosenBy, mode });
          if (mode === 'voice') {
            const token = (askRef.current += 1);
            later(() => listenFollowup(token), FOLLOWUP_LISTEN_MS);
          }
          return;
        }
        // «Хорошо, по существу всё» only over an answer that named every point; otherwise «Хорошо, спасибо».
        dispatch({ type: 'no_followup', closing: closingLine(rubric.points, live) });
      });
    });
  };

  // ── The follow-up ──
  const followup = state.followup;
  const followupVoice = followup?.mode === 'voice';

  const answerFollowupNow = () => {
    const token = (askRef.current += 1);
    const f = stateRef.current.followup;
    const carried = f?.mode === 'text' ? f.typed : speechRef.current.snapshot();
    if (!speech.supported) {
      dispatch({ type: 'followup_mode', mode: 'text', typed: carried });
      return;
    }
    speechRef.current.reset(carried);
    if (f?.mode !== 'voice') dispatch({ type: 'followup_mode', mode: 'voice' });
    if (speechRef.current.start()) dispatch({ type: 'followup_listen' });
    else if (token === askRef.current) dispatch({ type: 'followup_mode', mode: 'text', typed: speechRef.current.snapshot() });
  };

  const followupToText = () => {
    askRef.current += 1;
    const f = stateRef.current.followup;
    const text = f?.mode === 'voice' ? speechRef.current.snapshot() : f?.typed ?? '';
    speechRef.current.reset('');
    focusTextRef.current = true;
    dispatch({ type: 'followup_mode', mode: 'text', typed: text });
  };

  const dontKnow = () => {
    askRef.current += 1;
    speech.reset('');
    // «Не знаю» is an answer: not counted, and no key words are looked for.
    dispatch({ type: 'followup_result', status: 'missing', answer: 'не знаю' });
  };

  const finishFollowup = async () => {
    const current = stateRef.current;
    const f = current.followup;
    if (current.phase !== 'followup' || !f || !rubric) return;
    const point = rubric.points.find((item) => item.id === f.pointId);
    if (!point) return;
    const voice = f.mode === 'voice';
    const heard = voice ? speech.snapshot() : f.typed;
    if (words(heard).length === 0 && !voice) {
      dispatch({ type: 'notice', text: 'Ответ пустой: напишите ответ или нажмите «Не знаю».' });
      return;
    }
    if (words(heard).length === 0) {
      if (!f.notHeard) {
        const token = (askRef.current += 1);
        speech.reset('');
        dispatch({ type: 'followup_not_heard' });
        later(() => listenFollowup(token), FOLLOWUP_LISTEN_MS);
        return;
      }
      speech.reset('');
      dispatch({ type: 'followup_result', status: 'missing', answer: '' });
      return;
    }
    const token = (askRef.current += 1);
    dispatch({ type: 'followup_checking' });
    const answer = voice ? (await speech.stop()) || heard : heard;
    if (!mountedRef.current || token !== askRef.current) return;
    // «Не знаю» is the button's answer. Anything else goes to the AI once, judged by the point as a real
    // ticket's reply is (PUB-2): the key words alone never name it. Without the AI — the key words, said so.
    let reply: TryFollowupCheck | null = null;
    if (!saysDontKnow(answer)) {
      const known = checkRef.current && checkRef.current.attemptId === stateRef.current.attempt?.attemptId ? checkRef.current.result : null;
      const plan = followupPlan(known);
      reply = plan.ask
        ? await checkTryFollowup(question.id, f.pointId, answer.trim(), { signal: checkAbortRef.current?.signal, timeoutMs: plan.timeoutMs })
        : { by: 'keywords', reason: plan.reason };
      if (!mountedRef.current || token !== askRef.current) return;
      track('try_followup_checked', reply.by === 'keywords' ? { by: reply.by, reason: reply.reason } : { by: reply.by });
    }
    const verdict = judgeFollowupAnswer(point, f.question, answer, reply);
    dispatch({ type: 'followup_result', status: verdict.status, answer: answer.trim().slice(0, 160), judgedBy: verdict.judgedBy });
  };

  // ── Focus: a control removed by a state change hands the focus to the state's main control ──
  const rememberFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement) lastFocusRef.current = event.target;
  }, []);

  useLayoutEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    if (focusTextRef.current) {
      const field = room.querySelector<HTMLTextAreaElement>('textarea.or-text-field');
      if (field) {
        focusTextRef.current = false;
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
        return;
      }
    }
    const lost = lastFocusRef.current;
    const active = document.activeElement;
    if (!lost || lost.isConnected || (active && active !== document.body)) return;
    room.querySelector<HTMLElement>('[data-anchor]')?.focus();
  });

  // ── What the screen says ──
  const heading = ticketHeading(null, 0, 1, String(question.number));
  const seedBase = `example:${question.id}`;
  const elapsed = answerTime(state, now);
  // A guest signs up and lands on a new exam, as from the top bar's «Начать со своего списка».
  const createHref = ownExamHref(Boolean(user));

  // ── The protocol ──
  if (state.phase === 'protocol' && rubric && state.evaluation.status === 'done') {
    const followupForProtocol: ProtocolFollowup | null =
      followup && followup.status
        ? { pointId: followup.pointId, question: followup.question, answer: followup.answer, status: followup.status, judgedBy: followup.judgedBy }
        : null;
    const sheetHeading = glue(`${heading.strong} · ответ ${longDateTime(state.attempt?.startedAt ?? new Date())}`);
    const protocolPoints = livePoints(rubric, state.evaluation.result, new Set(state.named));
    const checked = check && check.attemptId === state.attempt?.attemptId ? checkSummary(check.result) : null;
    return (
      <>
        <TryBar where="Лист примера" back="/try" />
        <main className="sf-page or-room tx-room" data-phase="protocol" ref={roomRef} onFocus={rememberFocus}>
          <h1 className="sr-only or-sr-title" tabIndex={-1} data-anchor="">
            {`Протокол ответа, ${heading.strong}`}
          </h1>
          <section className="or-left" aria-label="Пункты ответа и ваш ответ">
            {/* Under the heading: what the answer did to the example's sheet (kept in this tab, sheet spec 4.3). */}
            <ProtocolSheet
              heading={sheetHeading}
              points={protocolPoints}
              followup={followupForProtocol}
              sheetNote={sheetNoteOf(sheetChange)}
              checkNote={checked ? glue(checkLine(checked)) : null}
              seed={`${seedBase}:${attempts}`}
              animate
            />
          </section>
          <section className="or-side" aria-label="Итог" ref={deskRef}>
            <ExampleGrade points={protocolPoints} followup={followupForProtocol} checked={checked}>
              {/* The example's story goes on on its sheet: the answer is played there (sheet spec 4.3). */}
              <div className="or-acts" data-wide="">
                <Link className="sf-primary" to={TRY_SHEET_PATH}>
                  К шпаргалке
                </Link>
                <button type="button" className="sf-link" onClick={() => navigate('/try/draw')}>
                  Ещё билет
                </button>
              </div>
              <p className="tx-grade-back">
                <Link className="ex-secondary" to={createHref}>
                  Создать свой экзамен
                </Link>
                <button type="button" className="sf-link" data-muted="" onClick={answerAgain}>
                  Ответить ещё раз
                </button>
              </p>
            </ExampleGrade>
          </section>
        </main>
      </>
    );
  }

  // ── Before and during the answer ──
  const answering = state.phase === 'answering';
  const namedCount = named.size;
  const asked = followup ? followup.pointId : null;
  const silence = answering && voiceAnswer && !state.paused && speech.status === 'listening' && speech.lastActivityAt !== null && now - speech.lastActivityAt > SILENCE_HINT_MS;
  const transcriptShown = answering || state.phase === 'finalizing' || state.phase === 'examiner' || state.phase === 'followup' || state.phase === 'evaluating';
  const shownFinal = answering ? finalText : state.attempt?.transcript ?? finalText;
  const shownInterim = answering ? interimText : '';
  const saidText = answering ? answerText : state.attempt?.transcript ?? answerText;
  const answerFinalWords = answering ? underlinedFinalWords(points, named, finalText) : underlinedFinalWords(points, new Set(state.named), state.attempt?.transcript ?? '');

  // Two equal ways to answer: by voice (the blue pill) or in writing; only writing without the speech API.
  // Below 360 px both say one word, so they share the bar's one line (PUB-8).
  const answerChoice = (
    <div className="or-acts or-choice">
      {speech.supported ? (
        <>
          <button type="button" className="sf-primary" onClick={startVoice} data-anchor="" aria-label="Отвечать голосом">
            <span className="or-pill-long">Отвечать голосом</span>
            <span className="or-pill-short">Голосом</span>
          </button>
          <button type="button" className="or-alt" onClick={startText} aria-label="Ответить текстом">
            <span className="or-wide">Ответить текстом</span>
            <span className="or-narrow">Текстом</span>
          </button>
        </>
      ) : (
        <button type="button" className="sf-primary" onClick={startText} data-anchor="">
          Ответить текстом
        </button>
      )}
    </div>
  );

  let side: ReactNode;
  if (state.phase === 'ready') {
    side = (
      <>
        {!speech.supported ? <p className="or-message or-message-muted">{SPEECH_UNSUPPORTED_MESSAGE}</p> : null}
        {/* What «Готово» leads to, before the first answer (EX-32 in the example's words: nothing is charged here). */}
        <p className="or-next">{glue(EXAMPLE_NEXT_LINE)}</p>
        {answerChoice}
        {question.id === EXAMPLE_ANSWER_QUESTION ? (
          <button type="button" className="sf-link tx-insert" onClick={insertExample}>
            Вставить ответ примера
          </button>
        ) : null}
        <p className="or-privacy">{EXAMPLE_PRIVACY_LINE}</p>
        <p className="or-links">
          <Link className="sf-link" data-muted="" to="/try/draw">
            Тянуть другой билет
          </Link>
          <Link className="sf-link tx-narrow-only" data-muted="" to="/try">
            Лист примера
          </Link>
        </p>
      </>
    );
  } else if (answering) {
    side = (
      <>
        {/* Secondary on purpose: a count by key words, not the result (Jury_Check item 7). */}
        <div className="or-count">
          <p className="or-count-line">
            По ключевым словам:{' '}
            <b>
              {namedCount}
              {' '}из{' '}
              {points.length}
            </b>
          </p>
          <p className="or-count-fine">итог — после ответа</p>
        </div>
        {state.notice ? (
          <p className="or-message" role="status">
            {state.notice}
          </p>
        ) : null}
        {silence ? <p className="or-hint">Говорите — я слушаю.</p> : null}
        {voiceAnswer && question.id === EXAMPLE_ANSWER_QUESTION && !answerText.trim() ? (
          <button type="button" className="sf-link tx-insert" onClick={insertExample}>
            Вставить ответ примера
          </button>
        ) : null}
        {elapsed >= LONG_ANSWER_MS ? <p className="or-hint">Обычно на ответ дают 2–3 минуты.</p> : null}
        <div className="or-acts">
          <button type="button" className="sf-primary" onClick={finish} data-anchor={voiceAnswer ? '' : undefined} aria-keyshortcuts={voiceAnswer ? undefined : FINISH_SHORTCUTS}>
            Готово
          </button>
          {voiceAnswer ? (
            <>
              <button type="button" className="sf-link" onClick={startText}>
                Текстом
              </button>
              {state.paused ? (
                <button type="button" className="sf-link" onClick={resume}>
                  Продолжить
                </button>
              ) : (
                <button type="button" className="sf-link" onClick={pause}>
                  Пауза
                </button>
              )}
            </>
          ) : speech.supported ? (
            <button type="button" className="sf-link" onClick={startVoice} aria-label="Отвечать голосом">
              <span className="or-wide">Отвечать голосом</span>
              <span className="or-narrow">Голосом</span>
            </button>
          ) : null}
          <button type="button" className="sf-link or-acts-extra" data-muted="" onClick={() => void restartAnswer()}>
            Сначала
          </button>
        </div>
        <button type="button" className="sf-link or-privacy-link" onClick={() => setPrivacyOpen(true)}>
          Кто видит ответ
        </button>
        {privacyOpen ? <PrivacySheet text={EXAMPLE_PRIVACY_LINE} onClose={() => setPrivacyOpen(false)} /> : null}
      </>
    );
  } else {
    // finalizing, examiner, followup, evaluating: the count stays, the examiner's question is the largest thing on the desk.
    side = (
      <>
        <p className="or-count-line">
          По ключевым словам:{' '}
          <b>
            {state.named.length}
            {' '}из{' '}
            {points.length}
          </b>
        </p>
        {state.phase === 'finalizing' || state.phase === 'examiner' ? <ExaminerThinking /> : null}
        {state.phase === 'followup' && followup ? (
          <ExaminerLine question={followup.question} alignTo={followup.pointId}>
            {followup.stage === 'checking' ? (
              <ExaminerThinking text="Экзаменатор слушает ответ…" />
            ) : (
              <>
                {followup.notHeard && followup.stage === 'asking' ? <p className="or-hint">{`${NOT_HEARD_LINE}.`}</p> : null}
                {state.notice ? <p className="or-hint">{state.notice}</p> : null}
                {followup.stage === 'answering' && followup.mode === 'text' ? (
                  <>
                    <textarea
                      className="or-text-field"
                      aria-label="Ответ на вопрос экзаменатора"
                      placeholder="Напишите ответ своими словами"
                      value={followup.typed}
                      onChange={(event) => {
                        followupPaste.clear();
                        dispatch({ type: 'followup_typed', text: event.target.value });
                      }}
                      onKeyDown={(event) => {
                        if (!isFinishKey(event)) return;
                        event.preventDefault();
                        void finishFollowup();
                      }}
                      {...followupPaste.fieldProps}
                      data-anchor=""
                    />
                    <PasteNotice guard={followupPaste} />
                  </>
                ) : null}
                {followup.mode === 'voice' && (followup.stage === 'answering' || followup.stage === 'asking') ? (
                  <div className="or-examiner-listen" data-waiting={followup.stage === 'asking' ? '' : undefined} aria-hidden={followup.stage === 'asking' ? true : undefined}>
                    <LiveTranscript
                      className="or-examiner-answer"
                      label="Ваш ответ на вопрос"
                      finalText={speech.finalText}
                      interimText={speech.interimText}
                      underlined={new Set()}
                      seed={seedFrom(seedBase, 'followup')}
                      emptyText="Говорите — я слушаю."
                    />
                  </div>
                ) : null}
                <div className="or-acts">
                  {followup.stage === 'asking' ? (
                    <button type="button" className="sf-primary" onClick={answerFollowupNow} data-anchor="">
                      Отвечать
                    </button>
                  ) : (
                    <button type="button" className="sf-primary" onClick={() => void finishFollowup()} data-anchor={followup.mode === 'text' ? undefined : ''}>
                      Готово
                    </button>
                  )}
                  {followupVoice ? (
                    <button type="button" className="sf-link" onClick={followupToText}>
                      Текстом
                    </button>
                  ) : speech.supported && speech.status !== 'error' ? (
                    <button type="button" className="sf-link" onClick={answerFollowupNow}>
                      Голосом
                    </button>
                  ) : null}
                  <button type="button" className="sf-link" onClick={dontKnow}>
                    Не знаю
                  </button>
                </div>
              </>
            )}
          </ExaminerLine>
        ) : null}
        {state.phase === 'evaluating' ? (
          <>
            {state.closing ? <p className="or-line or-line-ink">{`${state.closing}.`}</p> : null}
            <p className="or-line" role="status">
              Сверяем ответ с пунктами…
            </p>
          </>
        ) : null}
      </>
    );
  }

  const noteLine = state.phase === 'ready' && points.length > 0 ? exampleNoteLine(question, points.length) : null;

  // The answer itself: the field while typing, the transcript otherwise.
  const answerBody =
    answering && state.mode === 'text' ? (
      <div className="or-said">
        <label className="or-said-label" htmlFor="tx-answer-text">
          {`Ваш ответ, ${elapsedLabel(elapsed)}`}
        </label>
        <textarea
          id="tx-answer-text"
          className="or-text-field"
          placeholder="Напишите ответ своими словами"
          value={state.typed}
          onChange={(event) => {
            answerPaste.clear();
            dispatch({ type: 'typed', text: event.target.value });
          }}
          onKeyDown={(event) => {
            if (!isFinishKey(event)) return;
            event.preventDefault();
            finish();
          }}
          {...answerPaste.fieldProps}
          data-anchor=""
        />
        <PasteNotice guard={answerPaste} />
        {/* The example's own answer to the question its sheet asks for (sheet spec 4.3). */}
        {question.id === EXAMPLE_ANSWER_QUESTION && !state.typed.trim() ? (
          <button type="button" className="sf-link tx-insert" onClick={insertExample}>
            Вставить ответ примера
          </button>
        ) : null}
        {/* On a computer the hands are on the keys: «Готово» without the mouse (PUB-1). */}
        <p className="or-keys">{`Готово — ${finishKeysLabel()}`}</p>
      </div>
    ) : (
      <LiveTranscript
        label={`Ваш ответ, ${elapsedLabel(state.attempt ? state.attempt.durationSeconds * 1000 : elapsed)}`}
        finalText={shownFinal}
        interimText={shownInterim}
        underlined={answerFinalWords}
        drawNew={answering}
        seed={seedFrom(seedBase, 'said')}
        emptyText={answering && voiceAnswer ? (state.paused ? 'Пауза.' : 'Говорите — расшифровка появится здесь.') : undefined}
      />
    );

  return (
    <>
      <TryBar where="Лист примера" back="/try" onLeave={(to) => void leave(to)} />
      <main className="sf-page or-room tx-room" data-phase={state.phase} ref={roomRef} onFocus={rememberFocus}>
        <section className="or-left" aria-label="Билет и пункты ответа">
          <TicketCard heading={heading} question={question.text} />
          {noteLine ? <p className="or-note">{glue(noteLine)}</p> : null}
          <div className="sf-sheet or-sheet" data-collapsed={sheetOpen ? undefined : ''} data-empty={transcriptShown ? undefined : ''}>
            {/* Phones: «По ключевым словам: 2 из 4» heads the answer sheet (as on the real ticket). */}
            {state.phase !== 'ready' ? (
              <div className="or-strip">
                <p className="or-strip-count">
                  По ключевым словам:{' '}
                  <b>
                    {namedCount}
                    {' '}из{' '}
                    {points.length}
                  </b>{' '}
                  <span className="or-strip-fine">итог — после ответа</span>
                </p>
                <div className="or-strip-marks" aria-hidden="true">
                  {points.map((point) =>
                    named.has(point.id) ? <Mark key={point.id} kind="dot" seed={seedFrom(seedBase, point.id)} /> : <span key={point.id} className="or-strip-blank" />,
                  )}
                </div>
                <button type="button" className="sf-link" data-muted="" aria-expanded={sheetOpen} onClick={() => setSheetOpen((open) => !open)}>
                  {sheetOpen ? 'Скрыть пункты' : 'Пункты ответа'}
                </button>
              </div>
            ) : null}
            <RubricSlots
              points={points}
              materials={rubric?.materials ?? []}
              named={named}
              asked={asked}
              seed={seedBase}
              announcement={state.announcement}
              said={saidText}
            />
            {transcriptShown ? answerBody : null}
          </div>
        </section>
        <section className="or-side" aria-label="Экзаменатор" ref={deskRef}>
          {/* The follow-up is said once to screen readers too: the example shows it as text only. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {state.phase === 'followup' && followup ? `Экзаменатор спрашивает: «${followup.question}»` : ''}
          </p>
          {side}
        </section>
      </main>
    </>
  );
}
