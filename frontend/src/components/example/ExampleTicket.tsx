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
import { gradeAnswer, type GradeResult } from '../../lib/oral/oralGrade';
import { answerTime, closingLine, initialTicketState, ticketReducer, type AnswerMode, type TicketState } from '../../lib/oral/ticketMachine';
import type { AnswerInput } from '../../lib/oral/oralPersistence';
import { elapsedLabel, glue, longDateTime, plural } from '../../lib/oral/format';
import { exampleQuestion, exampleRubricResponse, exampleTicket, type ExampleQuestion } from '../../data/example';
import { exampleFollowup, judgeFollowupAnswer, keywordEvaluation } from './exampleFlow';
import ExampleGrade from './ExampleGrade';
import TryBar from './TryBar';
import { track } from '../../lib/telemetry';

/** «Экзаменатор слушает ответ…» stays this long after «Готово» (the real screen waits for its quick check). */
export const EXAMINER_PAUSE_MS = 900;
/** With nothing to ask, the examiner's closing line stays this long before the protocol. */
export const CLOSING_PAUSE_MS = 1400;
/**
 * A spoken answer to the follow-up is listened to this long after the question appears. The real screen
 * starts 300 ms after the examiner's voice ends; the example shows the question as text only: its voice
 * comes from /api/tts, which needs an account, and the example makes no /api call at all.
 */
export const FOLLOWUP_LISTEN_MS = 300;
const SILENCE_HINT_MS = 8000;
const LONG_ANSWER_MS = 120_000;
/** The real screen's line when the follow-up's answer was not heard (pages/ExamTicket NOT_HEARD_LINE). */
const NOT_HEARD_LINE = 'Не расслышал ответ';
const EMPTY_ANSWER_NOTICE = 'Ответ пустой: скажите или напишите ответ, потом нажмите «Готово».';

/** Who sees the answer in the example: the browser, and nobody else. */
export const EXAMPLE_PRIVACY_LINE =
  'Речь распознаёт браузер, в Chrome — через сервис Google. Meldy ответ в примере не получает и не сохраняет: его проверяет этот браузер по ключевым словам.';

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
  const [params] = useSearchParams();
  const question = exampleQuestion(params.get('q'));
  if (!question || question.coverage === 'none' || question.points.length === 0) return <TicketMissing question={question} />;
  return <ExampleRoom key={question.id} question={question} />;
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
 * lecture quotes and the app's grade. Only the checking differs: the key words on this device stand in
 * for the AI (exampleFlow.ts). No /api call, nothing saved.
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

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
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

  // ── The grade: the app's formula over the key-word statuses and the follow-up ──
  const grade: GradeResult | null = useMemo(() => {
    if (!rubric || state.evaluation.status !== 'done') return null;
    const evaluated = new Map(state.evaluation.result.points.map((point) => [point.id, point.status]));
    const f =
      state.followup && state.followup.status
        ? { point_id: state.followup.pointId, status: state.followup.status, judgedBy: state.followup.judgedBy }
        : null;
    return gradeAnswer(
      rubric.points.map((point) => ({ id: point.id, essential: point.essential, status: evaluated.get(point.id) ?? 'unrated' })),
      f,
    );
  }, [rubric, state.evaluation, state.followup]);

  // ── Leaving: an answer in progress is lost (nothing is saved), so ask first ──
  const inProgress = () => {
    const current = stateRef.current;
    if (current.phase === 'answering') return joinSpeech(current.mode === 'voice' ? speechRef.current.snapshot() : current.typed) !== '';
    return current.phase === 'finalizing' || current.phase === 'examiner' || current.phase === 'followup' || current.phase === 'evaluating';
  };
  const leave = async (to: string) => {
    if (inProgress()) {
      const ok = await confirm({
        title: 'Выйти из билета?',
        message: 'Ответ пропадёт: пример ничего не сохраняет.',
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
    speech.reset('');
    setSheetOpen(false);
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

  /** «Готово»: the answer is checked by its key words; the examiner asks about a point that was not named. */
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
    const live = liveMarks(rubric.points, snapshot, '', new Set(current.named));
    for (const id of live) if (!namedInRef.current[id]) namedInRef.current[id] = snapshot;
    const input = inputOf(current.usedSpeech || (voice && words(snapshot).length > 0), current.usedText);
    dispatch({ type: 'finalize', attemptId: `example-${attempt}`, snapshot, live: Array.from(live), input, now: Date.now(), startedAt: new Date().toISOString() });
    track('try_answered', { mode: voice ? 'voice' : 'text' });
    setAttempts((count) => count + 1);
    const heard = voice ? speech.stop() : Promise.resolve(snapshot);
    void heard.then((text) => {
      if (!mountedRef.current || attempt !== attemptRef.current) return;
      const transcript = words(text).length > 0 ? text : snapshot;
      dispatch({ type: 'transcript', text: transcript });
      const evaluation = keywordEvaluation(rubric.points, live, transcript, namedInRef.current);
      dispatch({ type: 'evaluation_done', run: stateRef.current.run, result: evaluation });
      dispatch({ type: 'examiner' });
      later(() => {
        if (attempt !== attemptRef.current || stateRef.current.phase !== 'examiner') return;
        const choice = exampleFollowup(rubric.points, snapshot, evaluation);
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
      }, EXAMINER_PAUSE_MS);
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
    const verdict = judgeFollowupAnswer(point, f.question, answer);
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
  const createHref = user ? '/exams/new' : '/register';

  // ── The protocol ──
  if (state.phase === 'protocol' && rubric && grade && state.evaluation.status === 'done') {
    const followupForProtocol: ProtocolFollowup | null =
      followup && followup.status
        ? { pointId: followup.pointId, question: followup.question, answer: followup.answer, status: followup.status, judgedBy: followup.judgedBy }
        : null;
    const sheetHeading = glue(`${heading.strong} · ответ ${longDateTime(state.attempt?.startedAt ?? new Date())}`);
    return (
      <>
        <TryBar where="Лист примера" back="/try" />
        <main className="sf-page or-room tx-room" data-phase="protocol" ref={roomRef} onFocus={rememberFocus}>
          <h1 className="sr-only or-sr-title" tabIndex={-1} data-anchor="">
            {`Протокол ответа, ${heading.strong}`}
          </h1>
          <section className="or-left" aria-label="Пункты ответа и ваш ответ">
            {/* No stamp: «Засчитано» means counted towards readiness, and the example saves nothing. */}
            <ProtocolSheet
              heading={sheetHeading}
              points={livePoints(rubric, state.evaluation.result, new Set(state.named))}
              followup={followupForProtocol}
              stamp="none"
              seed={`${seedBase}:${attempts}`}
              animate
            />
          </section>
          <section className="or-side" aria-label="Оценка">
            <ExampleGrade result={grade}>
              <p className="tx-grade-back">
                <Link className="sf-link tx-narrow-only" data-muted="" to="/try">
                  Лист примера
                </Link>
                <button type="button" className="sf-link" data-muted="" onClick={answerAgain}>
                  Ответить ещё раз
                </button>
              </p>
              <div className="or-acts" data-wide="">
                <Link className="sf-primary" to={createHref}>
                  Создать свой экзамен
                </Link>
                <button type="button" className="sf-link" onClick={() => navigate('/try/draw')}>
                  Ещё билет
                </button>
              </div>
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
  const answerChoice = (
    <div className="or-acts or-choice">
      {speech.supported ? (
        <>
          <button type="button" className="sf-primary" onClick={startVoice} data-anchor="">
            Отвечать голосом
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
        {answerChoice}
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
        {elapsed >= LONG_ANSWER_MS ? <p className="or-hint">Обычно на ответ дают 2–3 минуты.</p> : null}
        <div className="or-acts">
          <button type="button" className="sf-primary" onClick={finish} data-anchor={voiceAnswer ? '' : undefined}>
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
                  <textarea
                    className="or-text-field"
                    aria-label="Ответ на вопрос экзаменатора"
                    placeholder="Напишите ответ своими словами"
                    value={followup.typed}
                    onChange={(event) => dispatch({ type: 'followup_typed', text: event.target.value })}
                    data-anchor=""
                  />
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
          onChange={(event) => dispatch({ type: 'typed', text: event.target.value })}
          data-anchor=""
        />
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
        <section className="or-side" aria-label="Экзаменатор">
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
