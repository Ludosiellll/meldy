import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { FROM_TRY } from '../../lib/returnTo';
import { useConfirm } from '../../contexts/ConfirmContext';
import { SPEECH_ERROR_MESSAGES, joinSpeech, useSpeechAnswer } from '../../hooks/useSpeechAnswer';
import { Mark, seedFrom } from '../marks';
import TicketCard, { ticketHeading } from '../oral/TicketCard';
import RubricSlots from '../oral/RubricSlots';
import LiveTranscript from '../oral/LiveTranscript';
import ExaminerLine, { ExaminerThinking } from '../oral/ExaminerLine';
import PrivacySheet from '../oral/PrivacySheet';
import { livePoints, type ProtocolFollowup } from '../oral/OralProtocol';
import { liveMarks, namedPoints, underlinedFinalWords, words } from '../../lib/oral/rubricMatch';
import { answerTime, closingLine, initialTicketState, ticketReducer, type AnswerMode, type TicketState } from '../../lib/oral/ticketMachine';
import type { AnswerInput } from '../../lib/oral/oralPersistence';
import { elapsedLabel, glue, plural } from '../../lib/oral/format';
import { exampleQuestion, exampleRubricResponse, exampleTicket, type ExampleQuestion } from '../../data/example';
import { exampleFollowup, judgeFollowupAnswer, keywordEvaluation } from './exampleFlow';
import { checkSummary, checkTryAnswer, checkTryFollowup, followupPlan, tryEvaluation, type TryCheck, type TryFollowupCheck } from './tryCheck';
import { saysDontKnow } from '../../lib/oral/followup';
import { FINISH_SHORTCUTS, finishKeysLabel, isFinishKey, useDeskColumn } from '../oral/roomDesk';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import TryBar, { ownExamHref } from './TryBar';
import TrySteps from './TrySteps';
import ExampleCheck from './ExampleCheck';
import { checkHeadline } from './exampleCheck';
import { isSampleAnswer, sampleAnswer } from './sampleAnswers';
import { countBucket, track } from '../../lib/telemetry';
import { usePasteGuard, type PasteGuard } from '../oral/usePasteGuard';
import PasteNotice from '../oral/PasteNotice';
import '../oral/oral.css';

/** «Экзаменатор слушает ответ…» stays at least this long after «Проверить ответ» (the real screen waits for its quick check). */
export const EXAMINER_PAUSE_MS = 900;
/**
 * The examiner asks about a point the AI's protocol did not find — or, when the AI is slower than this,
 * about one the key words did not find (the real ticket's quick check gets 4.5 s on the server). The
 * check still waits for the AI (up to tryCheck.TRY_CHECK_TIMEOUT_MS) while the follow-up is answered.
 */
export const FOLLOWUP_WAIT_MS = 4500;
/** With nothing to ask, the examiner's closing line stays this long before the check. */
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
const EMPTY_ANSWER_NOTICE = 'Ответ пустой. Скажите или напишите ответ и нажмите «Проверить ответ».';
/** This browser has no speech recognition (useSpeechAnswer's own line, in short sentences). */
const NO_SPEECH_LINE = 'В этом браузере нельзя ответить голосом. Ответьте текстом.';

/**
 * Step 2 in plain words: what to do and what will happen (the owner, 21.10: «просят ввести что, а что не понятно»). One
 * thought per short sentence (the owner's plain-words rule, 21.10): these strings follow it all through /try.
 */
export const EXAMPLE_NEXT_LINE = 'Ответьте голосом или текстом, как на экзамене. Meldy сверит ответ с лекциями. Если чего-то не хватит, экзаменатор задаст вопрос.';

/**
 * Who sees the answer in the example: the browser recognises speech (in Chrome, Google does), then Meldy's server and
 * Google's model check the text (try_api.py); nothing is kept.
 */
export const EXAMPLE_PRIVACY_LINE = 'Голос распознаёт браузер. В Chrome это делает Google. Ответ проверяют сервер Meldy и Google Gemini. Мы его не сохраняем.';

/** Leaving an unfinished answer: the example keeps no answer anywhere. */
export const LEAVE_MESSAGE = 'Ответ пропадёт. В примере ответы не сохраняются.';

/** The label of the ready answer, put in by «Вставить готовый ответ» and not changed since. */
export const EXAMPLE_ANSWER_LABEL = 'Готовый ответ';

/** The button that puts the ready answer in (it does not send it: «Проверить ответ» does). */
export const INSERT_SAMPLE_LABEL = 'Вставить готовый ответ';

/** «Готово» of the real screen, said as what it does. */
export const CHECK_ANSWER_LABEL = 'Проверить ответ';

/** A pasted ready text is refused, as on a real ticket («Чистый ответ», Н7); the example says where the ready one is. */
export const EXAMPLE_PASTE_REFUSED = `Сюда нельзя вставить готовый текст. На экзамене отвечают сами. Чтобы посмотреть проверку, нажмите «${INSERT_SAMPLE_LABEL}».`;

/** The closed rows of the answer sheet, said in words: what they are and when they open. */
export const BLANK_ROW_TEXT = 'откроется, когда вы его назовёте';

/** Above the rows: what they are. */
export function examplePointsLine(question: ExampleQuestion, points: number): string {
  const head = `В полном ответе ${points} ${plural(points, 'пункт', 'пункта', 'пунктов')} из лекций. Пока они скрыты.`;
  return question.coverage === 'partial' && question.missing ? `${head} В лекциях нет ${question.missing}, поэтому об этом пунктов нет.` : head;
}

/** «Открыто 4 пункта из 5»: the number first, with its noun. */
export function openedLine(count: number, total: number): string {
  const verb = count % 10 === 1 && count % 100 !== 11 ? 'Открыт' : 'Открыто';
  return `${verb} ${count} ${plural(count, 'пункт', 'пункта', 'пунктов')} из ${total}`;
}

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

/**
 * Whether this device can be heard: speech recognition, and a microphone the browser lists. Without either, the ready
 * answer is the step's blue pill (a laptop with no microphone, a jury that does not know the subject).
 */
function useCanSpeak(supported: boolean): boolean {
  const [microphone, setMicrophone] = useState(true);
  useEffect(() => {
    if (!supported) return undefined;
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!devices || typeof devices.enumerateDevices !== 'function') return undefined;
    let live = true;
    devices
      .enumerateDevices()
      .then((list) => {
        if (live) setMicrophone(list.some((device) => device.kind === 'audioinput'));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [supported]);
  return supported && microphone;
}

/** The paste guard's line in the example's words. */
function examplePaste(guard: PasteGuard): PasteGuard {
  return guard.notice ? { ...guard, notice: EXAMPLE_PASTE_REFUSED } : guard;
}

/**
 * Steps 2 and 3 of the example (/try/ticket?q=…): the answer to the chosen question, then what the check found. A
 * question the example cannot check (unknown, or in no lecture) gets an honest line and the way back to the list.
 */
export default function ExampleTicket() {
  useDocumentTitle('Ответ · пример');
  const [params] = useSearchParams();
  const question = exampleQuestion(params.get('q'));
  if (!question || question.coverage === 'none' || question.points.length === 0) return <TicketMissing question={question} />;
  return <ExampleRoom key={question.id} question={question} />;
}

function TicketMissing({ question }: { question: ExampleQuestion | null }) {
  return (
    <>
      <TryBar />
      <main className="sf-page or-room or-room-single tx-room">
        <div className="or-state">
          <h1 className="or-state-title">{question ? 'Этого вопроса нет в лекциях примера' : 'Такого вопроса в примере нет'}</h1>
          <p className="or-state-text">
            {question ? 'Проверить ответ не получится. Выберите другой вопрос.' : 'Выберите вопрос из списка.'}
          </p>
          <div className="or-acts">
            <Link className="sf-primary" to="/try">
              Выбрать вопрос
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
 * or typed, «Проверить ответ», the examiner's follow-up on a point that was not named, and the check. At «Проверить
 * ответ» the answer goes to the AI check once (tryCheck.ts, backend/try_api.py): the check is the AI's, as on a real
 * ticket, and the follow-up is chosen by its statuses when they come in time. Without the AI check the key words on
 * this device decide (exampleFlow.ts), and step 3 says so. Nothing is saved anywhere.
 */
function ExampleRoom({ question }: { question: ExampleQuestion }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const speech = useSpeechAnswer();
  const canSpeak = useCanSpeak(speech.supported);
  const [state, dispatch] = useReducer(ticketReducer, question, setupRoom);
  const stateRef = useRef(state);
  stateRef.current = state;
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [attempts, setAttempts] = useState(0);
  /** The text in which each point first lit up: its words for the check when the final answer lost them. */
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
  /** The desk column follows the reader on a computer (oral.css): «Проверить ответ» and the next steps stay in view. */
  const deskRef = useDeskColumn();

  const rubric = state.rubric.status === 'ready' ? state.rubric.response.rubric : null;
  const points = useMemo(() => rubric?.points ?? [], [rubric]);
  const voiceAnswer = state.mode === 'voice';
  const finalText = voiceAnswer ? speech.finalText : state.typed;
  const interimText = voiceAnswer ? speech.interimText : '';
  const answerText = joinSpeech(finalText, interimText);
  const sample = sampleAnswer(question);

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

  // ── The check opens once it is done (after the closing line, when there was no follow-up) ──
  useEffect(() => {
    if (state.phase !== 'evaluating' || state.evaluation.status !== 'done') return;
    const timer = setTimeout(() => dispatch({ type: 'protocol' }), state.closing ? CLOSING_PAUSE_MS : 0);
    return () => clearTimeout(timer);
  }, [state.phase, state.evaluation.status, state.closing]);

  // «Чистый ответ» (Н7), as on a real ticket: a pasted ready text is refused; «Вставить готовый ответ» is a button.
  const answerPaste = usePasteGuard((count) => track('try_answer_paste_refused', { field: 'answer', words: countBucket(count) }));
  const followupPaste = usePasteGuard((count) => track('try_answer_paste_refused', { field: 'followup', words: countBucket(count) }));

  // ── Leaving: an answer in progress is lost, so ask first ──
  const inProgress = () => {
    const current = stateRef.current;
    if (current.phase === 'answering') return joinSpeech(current.mode === 'voice' ? speechRef.current.snapshot() : current.typed) !== '';
    return current.phase === 'finalizing' || current.phase === 'examiner' || current.phase === 'followup' || current.phase === 'evaluating';
  };
  const leave = async (to: string) => {
    if (inProgress()) {
      const ok = await confirm({
        title: 'Выйти из ответа?',
        message: LEAVE_MESSAGE,
        confirmText: 'Выйти',
        cancelText: 'Остаться',
        type: 'warning',
      });
      if (!ok) return;
    }
    // Every way out of the example says where it came from: the sign-up offers the way back.
    navigate(to, { state: FROM_TRY });
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
   * «Вставить готовый ответ»: the question's ready answer in the text field, whatever the mode was. A button, not a
   * paste: «Чистый ответ» does not stop it, and a line about a refused paste goes away. It does not send the answer.
   */
  const insertSample = () => {
    if (!sample) return;
    answerPaste.clear();
    focusTextRef.current = true;
    track('try_sample_inserted');
    if (state.phase === 'ready') {
      dispatch({ type: 'start', mode: 'text', now: Date.now() });
    } else if (state.phase === 'answering' && voiceAnswer) {
      speech.reset(sample);
      dispatch({ type: 'mode', mode: 'text', typed: sample, now: Date.now() });
      return;
    }
    dispatch({ type: 'typed', text: sample });
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
      title: 'Стереть ответ?',
      message: 'Всё, что вы сказали и написали, пропадёт.',
      confirmText: 'Стереть',
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
   * «Проверить ответ»: the answer goes to the AI check once (key words when it is not there); the examiner asks
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
    track('try_answered', { mode: voice ? 'voice' : 'text', sample: isSampleAnswer(question, snapshot) });
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
      // One AI check per answer: the check is the AI's, or the key words' with the reason why.
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
          dispatch({
            type: 'followup',
            pointId: point.id,
            question: point.followup.question,
            expected: point.followup.expected,
            chosenBy: choice.chosenBy,
            mode,
          });
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
  const askedPoint = followup ? (points.find((point) => point.id === followup.pointId) ?? null) : null;

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
    const text = f?.mode === 'voice' ? speechRef.current.snapshot() : (f?.typed ?? '');
    speechRef.current.reset('');
    focusTextRef.current = true;
    dispatch({ type: 'followup_mode', mode: 'text', typed: text });
  };

  /** The ready reply to the examiner: the words the examiner waits for (the AI still judges them). */
  const insertReply = () => {
    const expected = askedPoint?.followup.expected ?? '';
    if (!expected) return;
    askRef.current += 1;
    speechRef.current.reset('');
    followupPaste.clear();
    focusTextRef.current = true;
    track('try_sample_reply_inserted');
    dispatch({ type: 'followup_mode', mode: 'text', typed: expected });
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
      dispatch({ type: 'notice', text: 'Ответ пустой. Напишите ответ или нажмите «Не знаю».' });
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
  // A guest signs up and lands on a new exam, as from the top line's «Начать со своего списка».
  const createHref = ownExamHref(Boolean(user));
  const toList = () => void leave('/try');

  // ── Step 3: what the check found ──
  if (state.phase === 'protocol' && rubric && state.evaluation.status === 'done') {
    const followupForCheck: ProtocolFollowup | null =
      followup && followup.status
        ? { pointId: followup.pointId, question: followup.question, answer: followup.answer, status: followup.status, judgedBy: followup.judgedBy }
        : null;
    const checkPoints = livePoints(rubric, state.evaluation.result, new Set(state.named));
    const checked = check && check.attemptId === state.attempt?.attemptId ? checkSummary(check.result) : null;
    return (
      <>
        <TryBar />
        <main className="sf-page tx-page tx-checkpage" ref={roomRef} onFocus={rememberFocus}>
          <TrySteps current={3} />
          <ExampleCheck
            question={question}
            points={checkPoints}
            followup={followupForCheck}
            checked={checked}
            seed={`${seedBase}:${attempts}`}
            ownHref={createHref}
            onOther={() => navigate('/try')}
            onAgain={answerAgain}
          />
        </main>
        <CheckAnnouncement text={glue(checkHeadline(checkPoints, followupForCheck).title)} />
      </>
    );
  }

  // ── Before and during the answer ──
  const answering = state.phase === 'answering';
  const namedCount = named.size;
  const asked = followup ? followup.pointId : null;
  const silence =
    answering &&
    voiceAnswer &&
    !state.paused &&
    speech.status === 'listening' &&
    speech.lastActivityAt !== null &&
    now - speech.lastActivityAt > SILENCE_HINT_MS;
  const transcriptShown = answering || state.phase === 'finalizing' || state.phase === 'examiner' || state.phase === 'followup' || state.phase === 'evaluating';
  const shownFinal = answering ? finalText : (state.attempt?.transcript ?? finalText);
  const shownInterim = answering ? interimText : '';
  const saidText = answering ? answerText : (state.attempt?.transcript ?? answerText);
  const answerFinalWords = answering
    ? underlinedFinalWords(points, named, finalText)
    : underlinedFinalWords(points, new Set(state.named), state.attempt?.transcript ?? '');
  const countLine = (count: number) => <b className="tx-count">{openedLine(count, points.length)}</b>;

  // The ready answer is the step's blue pill where this device cannot be heard (no speech recognition, no
  // microphone); otherwise speaking is, and the ready answer is the white pill right under it.
  const samplePrimary = Boolean(sample) && !canSpeak;
  const insertButton = (primary: boolean) => (
    <button type="button" className={primary ? 'sf-primary' : 'tx-secondary tx-insert'} onClick={insertSample} data-anchor={primary ? '' : undefined}>
      {INSERT_SAMPLE_LABEL}
    </button>
  );

  let side: ReactNode;
  if (state.phase === 'ready') {
    side = (
      <>
        {!speech.supported ? <p className="or-message or-message-muted">{NO_SPEECH_LINE}</p> : null}
        <div className="or-acts or-choice" data-wide="">
          {samplePrimary ? (
            insertButton(true)
          ) : canSpeak ? (
            <button type="button" className="sf-primary" onClick={startVoice} data-anchor="">
              Ответить голосом
            </button>
          ) : (
            <button type="button" className="sf-primary" onClick={startText} data-anchor="">
              Написать ответ
            </button>
          )}
        </div>
        {sample && !samplePrimary ? (
          <div className="tx-sample">
            <p className="tx-sample-q">Не знаете тему?</p>
            {insertButton(false)}
          </div>
        ) : null}
        <p className="tx-alt">
          {samplePrimary ? <span className="tx-alt-lead">Или ответьте сами.</span> : null}
          {samplePrimary && speech.supported ? (
            <button type="button" className="sf-link" onClick={startVoice}>
              Ответить голосом
            </button>
          ) : null}
          {samplePrimary || canSpeak ? (
            <button type="button" className="sf-link" onClick={startText}>
              Написать ответ
            </button>
          ) : null}
        </p>
        <p className="or-privacy">{glue(EXAMPLE_PRIVACY_LINE)}</p>
        <p className="or-links">
          <Link className="sf-link" data-muted="" to="/try">
            Выбрать другой вопрос
          </Link>
        </p>
      </>
    );
  } else if (answering) {
    const holdsSample = !voiceAnswer && isSampleAnswer(question, state.typed);
    side = (
      <>
        <div className="or-count">
          <p className="or-count-line">{countLine(namedCount)}</p>
          <p className="or-count-fine">
            {glue(
              holdsSample
                ? `Это готовый ответ. Нажмите «${CHECK_ANSWER_LABEL}». ИИ проверит его, а экзаменатор спросит о том, чего в нём нет.`
                : `Пункты открываются по словам из ответа. Точную проверку сделает ИИ после кнопки «${CHECK_ANSWER_LABEL}».`,
            )}
          </p>
        </div>
        {state.notice ? (
          <p className="or-message" role="status">
            {state.notice}
          </p>
        ) : null}
        {silence ? <p className="or-hint">Говорите, я слушаю.</p> : null}
        {voiceAnswer && sample && !answerText.trim() ? <div className="tx-sample">{insertButton(false)}</div> : null}
        {elapsed >= LONG_ANSWER_MS ? <p className="or-hint">Обычно на ответ дают 2–3 минуты.</p> : null}
        <div className="or-acts" data-wide="">
          <button
            type="button"
            className="sf-primary"
            onClick={finish}
            data-anchor={voiceAnswer ? '' : undefined}
            aria-keyshortcuts={voiceAnswer ? undefined : FINISH_SHORTCUTS}
          >
            {CHECK_ANSWER_LABEL}
          </button>
          {voiceAnswer ? (
            <>
              <button type="button" className="sf-link" onClick={startText} aria-label="Писать текстом">
                <span className="or-wide">Писать текстом</span>
                <span className="or-narrow">Текстом</span>
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
            <button type="button" className="sf-link" onClick={startVoice} aria-label="Ответить голосом">
              Ответить голосом
            </button>
          ) : null}
          <button type="button" className="sf-link or-acts-extra" data-muted="" onClick={() => void restartAnswer()}>
            Стереть ответ
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
        <p className="or-count-line">{countLine(state.named.length)}</p>
        {state.phase === 'finalizing' || state.phase === 'examiner' ? <ExaminerThinking /> : null}
        {state.phase === 'followup' && followup ? (
          <ExaminerLine question={followup.question} alignTo={followup.pointId}>
            {followup.stage === 'checking' ? (
              <ExaminerThinking text="Экзаменатор слушает ответ…" />
            ) : (
              <>
                <p className="tx-why-asked">
                  {glue(
                    askedPoint
                      ? `В ответе не было пункта ${points.indexOf(askedPoint) + 1}. Экзаменатор спрашивает о нём.`
                      : 'Экзаменатор спрашивает о том, чего не было в ответе.',
                  )}
                </p>
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
                    <PasteNotice guard={examplePaste(followupPaste)} />
                  </>
                ) : null}
                {followup.mode === 'voice' && (followup.stage === 'answering' || followup.stage === 'asking') ? (
                  <div
                    className="or-examiner-listen"
                    data-waiting={followup.stage === 'asking' ? '' : undefined}
                    aria-hidden={followup.stage === 'asking' ? true : undefined}
                  >
                    <LiveTranscript
                      className="or-examiner-answer"
                      label="Ваш ответ на вопрос"
                      finalText={speech.finalText}
                      interimText={speech.interimText}
                      underlined={new Set()}
                      seed={seedFrom(seedBase, 'followup')}
                      emptyText="Говорите, я слушаю."
                    />
                  </div>
                ) : null}
                {askedPoint?.followup.expected && !(followup.mode === 'text' && followup.typed.trim()) ? (
                  <div className="tx-sample tx-sample-reply">
                    <button type="button" className="tx-secondary tx-insert" onClick={insertReply}>
                      {INSERT_SAMPLE_LABEL}
                    </button>
                  </div>
                ) : null}
                <div className="or-acts" data-wide="">
                  {followup.stage === 'asking' ? (
                    <button type="button" className="sf-primary" onClick={answerFollowupNow} data-anchor="">
                      Ответить голосом
                    </button>
                  ) : (
                    <button type="button" className="sf-primary" onClick={() => void finishFollowup()} data-anchor={followup.mode === 'text' ? undefined : ''}>
                      Отправить ответ
                    </button>
                  )}
                  {/* «Не знаю» first: it is the honest answer of a visitor who does not know the subject. */}
                  <button type="button" className="sf-link" onClick={dontKnow}>
                    Не знаю
                  </button>
                  {followupVoice ? (
                    <button type="button" className="sf-link" onClick={followupToText} aria-label="Писать текстом">
                      <span className="or-wide">Писать текстом</span>
                      <span className="or-narrow">Текстом</span>
                    </button>
                  ) : speech.supported && speech.status !== 'error' ? (
                    <button type="button" className="sf-link" onClick={answerFollowupNow} aria-label="Ответить голосом">
                      <span className="or-wide">Ответить голосом</span>
                      <span className="or-narrow">Голосом</span>
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </ExaminerLine>
        ) : null}
        {state.phase === 'evaluating' ? (
          <>
            {state.closing ? <p className="or-line or-line-ink">{`${state.closing}.`}</p> : null}
            <p className="or-line" role="status">
              Сверяем ответ с лекциями…
            </p>
          </>
        ) : null}
      </>
    );
  }

  const pointsLine = points.length > 0 ? examplePointsLine(question, points.length) : null;

  // The answer itself: the field while typing, the transcript otherwise.
  const answerBody =
    answering && state.mode === 'text' ? (
      <div className="or-said">
        <label className="or-said-label" htmlFor="tx-answer-text">
          {isSampleAnswer(question, state.typed) ? EXAMPLE_ANSWER_LABEL : `Ваш ответ, ${elapsedLabel(elapsed)}`}
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
        <PasteNotice guard={examplePaste(answerPaste)} />
        {sample && !state.typed.trim() ? <div className="tx-sample">{insertButton(false)}</div> : null}
        {/* On a computer the hands are on the keys: «Проверить ответ» without the mouse (PUB-1). */}
        <p className="or-keys">{`Проверить ответ можно клавишами ${finishKeysLabel()}.`}</p>
      </div>
    ) : (
      <LiveTranscript
        label={
          isSampleAnswer(question, shownFinal)
            ? EXAMPLE_ANSWER_LABEL
            : `Ваш ответ, ${elapsedLabel(state.attempt ? state.attempt.durationSeconds * 1000 : elapsed)}`
        }
        finalText={shownFinal}
        interimText={shownInterim}
        underlined={answerFinalWords}
        drawNew={answering}
        seed={seedFrom(seedBase, 'said')}
        emptyText={answering && voiceAnswer ? (state.paused ? 'Пауза.' : 'Говорите. Текст ответа появится здесь.') : undefined}
      />
    );

  return (
    <>
      <TryBar onLeave={(to) => void leave(to)} />
      <main className="sf-page or-room tx-room" data-phase={state.phase} ref={roomRef} onFocus={rememberFocus}>
        <TrySteps current={2} onLeave={(to) => void leave(to)} />
        <section className="or-left" aria-label="Вопрос и пункты ответа">
          <TicketCard heading={heading} question={question.text} />
          {state.phase === 'ready' ? <p className="tx-next">{glue(EXAMPLE_NEXT_LINE)}</p> : null}
          <div className="sf-sheet or-sheet" data-collapsed={sheetOpen ? undefined : ''}>
            {pointsLine ? <p className="tx-pts-line">{glue(pointsLine)}</p> : null}
            {/* A phone, before the answer: the closed points as numbered blanks (the rows open with the answer). */}
            {state.phase === 'ready' ? (
              <p className="tx-pts-chips" aria-hidden="true">
                {points.map((point, index) => (
                  <span key={point.id}>{index + 1}</span>
                ))}
              </p>
            ) : null}
            {/* Phones: «Открыто 2 пункта из 4» heads the answer sheet once the answer starts. */}
            {state.phase !== 'ready' ? (
              <div className="or-strip">
                <p className="or-strip-count">{countLine(namedCount)}</p>
                <div className="or-strip-marks" aria-hidden="true">
                  {points.map((point) =>
                    named.has(point.id) ? (
                      <Mark key={point.id} kind="dot" seed={seedFrom(seedBase, point.id)} />
                    ) : (
                      <span key={point.id} className="or-strip-blank" />
                    ),
                  )}
                </div>
                <button type="button" className="sf-link" data-muted="" aria-expanded={sheetOpen} onClick={() => setSheetOpen((open) => !open)}>
                  {sheetOpen ? 'Скрыть пункты' : 'Показать пункты'}
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
              blankText={BLANK_ROW_TEXT}
            />
            {transcriptShown ? answerBody : null}
          </div>
        </section>
        <section className="or-side" aria-label={state.phase === 'ready' ? 'Как ответить' : 'Экзаменатор'} ref={deskRef}>
          {/* The follow-up is said once to screen readers too: the example shows it as text only. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {state.phase === 'followup' && followup ? `Экзаменатор спрашивает: «${followup.question}»` : ''}
          </p>
          {side}
        </section>
      </main>
      <CheckAnnouncement text="" />
    </>
  );
}

/**
 * The live region that says the check is ready: the same node before and after (a region that appears with its text is
 * not read), outside the room, whose content changes from step 2 to step 3.
 */
function CheckAnnouncement({ text }: { text: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-try-announce="">
      {text ? `Проверка готова. ${text}.` : ''}
    </p>
  );
}
