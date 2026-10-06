import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import '../styles/paper.css';
import '../components/oral/oral.css';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { checkAILimit, nextLimitReset } from '../api/limits';
import { AI_COSTS } from '../lib/plans';
import { newEventId, recordSelfRating, type SelfRating as Rating } from '../api/learning';
import { SELF_RATING_LABELS } from '../lib/learning/readiness';
import { SPEECH_ERROR_MESSAGES, SPEECH_UNSUPPORTED_MESSAGE, joinSpeech } from '../hooks/useSpeechAnswer';
import { useVoiceAnswer, type VoiceEngine } from '../hooks/useVoiceAnswer';
import MicLevel from '../components/oral/MicLevel';
import { isTTSReady, playTTS, prefetchTTS, stopTTS } from '../utils/tts';
import { Mark, seedFrom } from '../components/marks';
import TicketCard, { ticketHeading } from '../components/oral/TicketCard';
import RubricSlots from '../components/oral/RubricSlots';
import LiveTranscript from '../components/oral/LiveTranscript';
import ExaminerLine, { ExaminerThinking } from '../components/oral/ExaminerLine';
import PrivacySheet from '../components/oral/PrivacySheet';
import {
  ProtocolGrade,
  ProtocolSheet,
  ReviewCard,
  livePoints,
  stampFor,
  storedGrade,
  storedPoints,
  type ProtocolFollowup,
} from '../components/oral/OralProtocol';
import { browserCandidate, decideFollowup, saysDontKnow } from '../lib/oral/followup';
import { followupFallback, liveMarks, namedPoints, underlinedFinalWords, words } from '../lib/oral/rubricMatch';
import { gradeAnswer, gradeWord, type GradeResult } from '../lib/oral/oralGrade';
import { subjectOf } from '../lib/exams/format';
import {
  CHECK_CONFIRM_TIMEOUT_MS,
  CHECK_FOLLOWUP_TIMEOUT_MS,
  AI_UNAVAILABLE_MESSAGE,
  checkAnswer,
  evaluateAnswer,
  fetchRubric,
  isOralApiError,
  type Rubric,
  type RubricPoint,
} from '../lib/oral/oralApi';
import {
  addPeakFlag,
  buildAttemptPayload,
  clearDraft,
  clearStashedAttempt,
  createDraftWriter,
  initialLiveMarks,
  readDraft,
  readStashedAttempt,
  rememberLiveMarks,
  saveOralAttempt,
  stashAttempt,
  type AnswerInput,
  type FollowupRecord,
  type TicketMode,
} from '../lib/oral/oralPersistence';
import {
  TICKET_LOAD_FAILED,
  departmentTicketNumber,
  isUuid,
  loadExam,
  loadOralSession,
  loadQuestionHistory,
  loadRubricAnchors,
  loadTicket,
  parseQuestionIds,
  type StoredProtocol,
  type TicketExam,
  type TicketQuestion,
} from '../lib/oral/ticketData';
import {
  ALL_COVERED_LINE,
  THANKS_LINE,
  answerTime,
  closingLine,
  hasUnsavedAnswer,
  initialTicketState,
  protocolState,
  ticketReducer,
  type AnswerMode,
  type NearestDisplay,
  type RubricState,
  type TicketState,
} from '../lib/oral/ticketMachine';
import { clockTime, draftTime, elapsedLabel, elapsedSpoken, glue, longDateTime, nextQuestionLabel, plural, shortDate, shortDateTime } from '../lib/oral/format';
import { displayMaterialTitle } from '../utils/materialTitle';
import { secondsBucket, track } from '../lib/telemetry';
import { useAnswerSheetChange } from '../components/exams/sheet/answerChange';
import { protocolSheetLine } from '../components/exams/sheet/copy';

/** The examiner's short lines, prefetched with the follow-ups (contracts §7.2). */
export const FILLER_LINE = 'Так…';
export { ALL_COVERED_LINE, THANKS_LINE };
export const NOT_HEARD_LINE = 'Не расслышал ответ';

/** Recognition of the answer to the follow-up starts this long after the question's audio ended. */
export const LISTEN_AFTER_AUDIO_MS = 300;
/** «Так…» never holds the follow-up longer than this. */
const FILLER_WAIT_MS = 2500;
/** The page's own links and buttons wait this long for a save in flight before they ask about leaving. */
export const SAVE_WAIT_MS = 5000;
const SILENCE_HINT_MS = 8000;
const LONG_ANSWER_MS = 120_000;

/**
 * Contracts §7.2 without its last sentence: «Протокол видите вы и преподаватель вашей учебной группы»
 * promised a teacher's screen that does not exist (redesign critique 5, round 2; Jury_Check 11).
 */
export const PRIVACY_LINE =
  'Речь распознаёт браузер, в Chrome — через сервис Google. Текст ответа проверяет ИИ-сервис (Google Gemini, запасной — Groq). Запись голоса Meldy не получает; в истории остаются оценки по пунктам и короткие отрывки ответа.';

/** An answer nobody checks goes nowhere: only the student's own rating is saved. */
export const PRIVACY_UNCHECKED_LINE =
  'Речь распознаёт браузер, в Chrome — через сервис Google. Ответ без проверки остаётся на этом устройстве: сохраняется только ваша отметка «знаю», «плаваю» или «не знаю».';

/** The same two lines when the speech is recognised on the server (the browser could not, or there is no Web Speech). */
export const PRIVACY_SERVER_LINE =
  'Речь распознаёт сервер Meldy через сервис Groq (запасной — Google Gemini): запись уходит туда кусками и не сохраняется. Текст ответа проверяет ИИ-сервис (Google Gemini, запасной — Groq); в истории остаются оценки по пунктам и короткие отрывки ответа.';
export const PRIVACY_SERVER_UNCHECKED_LINE =
  'Речь распознаёт сервер Meldy через сервис Groq (запасной — Google Gemini): запись не сохраняется. Ответ без проверки остаётся на этом устройстве: сохраняется только ваша отметка «знаю», «плаваю» или «не знаю».';

export function privacyText(engine: VoiceEngine, checked: boolean): string {
  if (engine === 'server') return checked ? PRIVACY_SERVER_LINE : PRIVACY_SERVER_UNCHECKED_LINE;
  return checked ? PRIVACY_LINE : PRIVACY_UNCHECKED_LINE;
}

/** What the server's recognition is doing, under «Готово». */
export function serverVoiceLine(settling: boolean, pending: number, paused: boolean, lost: number): string {
  if (settling) return 'Распознаём последние слова…';
  if (pending > 0) return 'Распознаём сказанное…';
  if (paused) return 'Пауза.';
  if (lost > 0) return 'Часть сказанного не распознана — можно повторить или дописать текстом.';
  return 'Слушаю. Текст появляется после каждой паузы.';
}

/** Said once when the server takes over the recognition. */
export const SWITCHED_TO_SERVER_NOTICE = 'Браузер не смог распознать речь — дальше её распознаёт сервер Meldy. Сказанное сохранено.';
export const CHOSE_SERVER_NOTICE = 'Браузер не присылает распознанный текст — дальше речь распознаёт сервер Meldy: текст появляется после каждой паузы.';

/** The examiner's voice starts this long after the follow-up appears: the brace, then the words, then the voice. */
export const FOLLOWUP_VOICE_DELAY_MS = 300;

const EVALUATION_FAILED_MESSAGE = 'Не удалось проверить ответ: сервис занят. Ответ сохранён на этой странице — попробуйте через минуту.';
/** The server refused the check (429 ai_limit): a repeat helps only after the reset, so the line says when. */
export function evaluationLimitMessage(resetAt: Date = nextLimitReset()): string {
  return `Дневной лимит ИИ исчерпан — ответ не проверен. Он сохранён на этой странице: «Проверить снова» сработает после ${clockTime(resetAt)}.`;
}
const EMPTY_ANSWER_NOTICE = 'Ответ пустой: скажите или напишите ответ, потом нажмите «Готово».';

/**
 * The examiner's lines in the order they are prefetched (contracts §7.2): «Так…», the follow-ups,
 * the two closing lines («Хорошо, по существу всё», «Хорошо, спасибо»), «Не расслышал ответ».
 */
export function examinerLines(points: RubricPoint[]): string[] {
  const essential = points.filter((point) => point.essential).map((point) => point.followup.question);
  const others = points.filter((point) => !point.essential).map((point) => point.followup.question);
  const lines = [FILLER_LINE, ...essential, ...others, ALL_COVERED_LINE, THANKS_LINE, NOT_HEARD_LINE].map((line) => line.trim()).filter(Boolean);
  return Array.from(new Set(lines));
}

/** «Восстановлен черновик…», the plural of «пункт» and the like, kept together for the screen. */
function pointsWord(n: number): string {
  return `${n} ${plural(n, 'пункт', 'пункта', 'пунктов')}`;
}

export default function ExamTicket() {
  const { id: examId = '' } = useParams();
  const [params] = useSearchParams();
  const sessionId = params.get('session');
  const rawIds = params.get('q');
  const questionIds = useMemo(() => parseQuestionIds(rawIds), [rawIds]);
  // «Билет N» only when the exam's own list of tickets backs it (checked once the exam is loaded).
  const requestedNumber = params.get('n');
  // Sent only by the draw's «Как на экзамене»: marks off by default, no hint, no counter.
  const mode: TicketMode = params.get('mode') === 'exam' ? 'exam' : 'training';
  // The read-only protocol ignores both.
  if (sessionId !== null) return <ReadOnlyProtocol examId={examId} sessionId={sessionId} />;
  return (
    <TicketRoom
      key={`${examId}|${questionIds.join(',')}|${mode}`}
      examId={examId}
      questionIds={questionIds}
      requestedNumber={requestedNumber}
      mode={mode}
    />
  );
}

// ── The top line of the room ───────────────────────────────────────────────────────

interface RoomBarProps {
  course: string;
  where: string;
  short: string;
  onLeave: (to: string) => void;
  right: ReactNode;
  /** A protocol: on a phone the line is only «‹ Лист экзамена» on the left (redesign critique 11). */
  backOnPhone?: boolean;
}

function RoomBar({ course, where, short, onLeave, right, backOnPhone = false }: RoomBarProps) {
  return (
    <header className="sf-room-bar" data-back={backOnPhone ? '' : undefined}>
      <div className="or-bar-left">
        <button type="button" className="or-wordmark" onClick={() => onLeave('/dashboard')}>
          Meldy
        </button>
        <span className="or-where">
          {course ? <span className="or-course">{glue(`${course} · `)}</span> : null}
          <span className="or-long">{where}</span>
          <span className="or-short">{short}</span>
        </span>
      </div>
      <div className="or-bar-right">{right}</div>
    </header>
  );
}

// ── Helpers of the live room ───────────────────────────────────────────────────────

function nearestFromRow(question: TicketQuestion): NearestDisplay[] {
  return question.nearest.slice(0, 3).map((item) => ({
    title: item.material_title,
    fragment: fragmentWord(item.source_id),
    text: item.excerpt,
    matched: item.matched,
  }));
}

function nearestFromRubric(rubric: Rubric): NearestDisplay[] {
  return rubric.nearest.slice(0, 3).map((item) => {
    const [key, sid] = item.source_id.includes(':') ? item.source_id.split(':') : [null, item.source_id];
    const material = rubric.materials.find((entry) => entry.key === key || entry.material_id === item.material_id);
    return { title: displayMaterialTitle(material?.title, ''), fragment: fragmentWord(sid), text: item.text, matched: [] };
  });
}

function fragmentWord(sourceId: string): string {
  const match = /S0*(\d{1,4})/.exec(sourceId);
  return match ? `фрагмент ${match[1]}` : '';
}

function NearestList({ items }: { items: NearestDisplay[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <p className="or-state-text">Наиболее похожие фрагменты ваших лекций:</p>
      <ul className="or-nearest">
        {items.map((item, index) => (
          <li key={index}>
            <blockquote className="sf-slip">
              <span className="or-slip-cap">{[item.title ? `«${item.title}»` : '', item.fragment].filter(Boolean).join(', ')}</span>
              {item.text}
            </blockquote>
          </li>
        ))}
      </ul>
    </>
  );
}

/** How the student last chose to answer: that way is offered first next time (a new key, nothing renamed). */
const MODE_KEY = 'meldy_oral_mode';

function readPreferredMode(): AnswerMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'text' ? 'text' : 'voice';
  } catch {
    return 'voice';
  }
}

function writePreferredMode(mode: AnswerMode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage blocked: the choice simply is not remembered.
  }
}

/** The answer can be checked against the lectures: a reference, and checks left today. */
function checkableIn(state: TicketState): boolean {
  return state.rubric.status === 'ready' && state.limit !== 'exhausted';
}

/**
 * The answer can be given at all: checked, or for practice — no reference to check against (the
 * question is not in the lectures, the lectures have no text, the reference did not come together or
 * did not come back) or the day's checks spent. Only a missing question or a lost session blocks it.
 */
function answerableIn(state: TicketState): boolean {
  const status = state.rubric.status;
  return status === 'ready' || status === 'not_in_lectures' || status === 'unverifiable' || status === 'failed';
}

const SELF_RATINGS: Rating[] = ['know', 'unsure', 'dont_know'];

/** Why nobody checked the answer, in the reference's own terms (headline and the line under it). */
function uncheckedWhy(rubric: RubricState, limitSpent: boolean): { title: string; text: string; after: string; fix: string | null } {
  if (rubric.status === 'not_in_lectures') {
    return { title: rubric.message, text: '', after: 'Этого вопроса нет в ваших лекциях — сверять было не с чем.', fix: 'Добавить лекции' };
  }
  if (rubric.status === 'unverifiable') {
    if (rubric.code === 'no_lectures') {
      return {
        title: 'К экзамену не выбраны лекции',
        text: 'Meldy сверяет ответ с лекциями экзамена. Выберите их — и ответы будут проверяться.',
        after: 'К экзамену не выбраны лекции — сверять было не с чем.',
        fix: 'Выбрать лекции',
      };
    }
    if (rubric.code === 'no_text') {
      return {
        title: 'У лекций этого экзамена нет текста',
        text: 'Похоже, это сканы или файлы без текста. Добавьте лекции текстом — PDF, DOCX, TXT или MD, — и ответы будут проверяться.',
        after: 'У лекций экзамена нет текста — сверять было не с чем.',
        fix: 'Добавить лекции',
      };
    }
    return { title: 'Пункты ответа не собрались', text: rubric.message, after: 'Пункты ответа по лекциям не собрались.', fix: null };
  }
  if (rubric.status === 'failed') return { title: 'Пункты ответа не готовы', text: rubric.message, after: 'Пункты ответа не были готовы — сервис не ответил.', fix: null };
  if (limitSpent) return { title: '', text: '', after: 'Проверки на сегодня закончились — сравните ответ с пунктами из лекций сами.', fix: null };
  return { title: 'Пунктов ответа нет', text: rubric.status === 'blocked' ? rubric.message : '', after: '', fix: null };
}

function speakLine(text: string, maxMs = 15_000): Promise<'ended' | 'failed'> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (how: 'ended' | 'failed') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(how);
    };
    const timer = setTimeout(() => finish('failed'), maxMs);
    void playTTS(
      text,
      'professor',
      () => finish('ended'),
      () => finish('failed'),
    );
  });
}

/** The outcome of a promise that never rejects, or 'waiting' when it takes longer than ms. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'waiting'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('waiting'), ms);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function inputOf(usedSpeech: boolean, usedText: boolean): AnswerInput {
  if (usedSpeech && usedText) return 'mixed';
  return usedSpeech ? 'speech' : 'text';
}

// ── The live room ──────────────────────────────────────────────────────────────────

interface TicketRoomProps {
  examId: string;
  questionIds: string[];
  /** &n of the address: a department ticket's number, honoured only when the exam's tickets back it. */
  requestedNumber: string | null;
  mode: TicketMode;
}

function TicketRoom({ examId, questionIds, requestedNumber, mode }: TicketRoomProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const [state, dispatch] = useReducer(ticketReducer, undefined, initialTicketState);
  const stateRef = useRef<TicketState>(state);
  stateRef.current = state;
  // «Как на экзамене» starts with the marks off and never touches the stored preference.
  const [liveMarksOn, setLiveMarksOn] = useState(() => initialLiveMarks(mode));
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [preferred, setPreferred] = useState<AnswerMode>(readPreferredMode);
  const controllerRef = useRef<AbortController | null>(null);
  const draftRef = useRef<ReturnType<typeof createDraftWriter> | null>(null);
  const lastDraftRef = useRef('');
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const askTokenRef = useRef(0);
  const mountedRef = useRef(true);
  /** The save in flight: leaving waits for it, and a new answer to the same question does not get its draft back. */
  const savingRef = useRef<{ questionId: string; promise: Promise<'saved' | 'failed'> } | null>(null);
  /** One way out at a time: another click while the first one waits is ignored. */
  const leavingRef = useRef(false);
  const roomRef = useRef<HTMLDivElement | null>(null);
  /** The last control focused in the room: when a state change removes it, the focus goes to the state's main control. */
  const lastFocusRef = useRef<HTMLElement | null>(null);
  /** The student chose to answer in writing: the field gets the focus as soon as it is there. */
  const focusTextRef = useRef(false);

  const question = state.questions[state.index] ?? null;
  // The question's words help the server's recognition spell its terms.
  const speech = useVoiceAnswer({ hint: question?.text });
  const speechRef = useRef(speech);
  speechRef.current = speech;
  /** «Готово» waits for the server to recognise the last words: no second press meanwhile. */
  const [settling, setSettling] = useState(false);
  const settlingRef = useRef(false);
  // «Билет 12» only for the department's ticket 12 whose questions these are (a forged &n shows nothing).
  const ticketNumber = useMemo(
    () => (state.exam ? departmentTicketNumber(state.exam.layout, requestedNumber, questionIds) : null),
    [questionIds, requestedNumber, state.exam],
  );
  const rubricResponse = state.rubric.status === 'ready' ? state.rubric.response : null;
  const points = useMemo(() => rubricResponse?.rubric.points ?? [], [rubricResponse]);
  // What the saved answer changed on the cheat sheet, for the protocol (sheet spec 4.2).
  const sheetChange = useAnswerSheetChange({
    question,
    response: rubricResponse,
    sessionId: state.phase === 'protocol' && state.save.status === 'saved' ? state.save.result.sessionId : null,
  });
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

  const alive = useCallback((run: number) => mountedRef.current && stateRef.current.run === run, []);

  /**
   * Everything said so far. With the browser's recognition it is there at once; the server gets the
   * speech in pieces, so the pieces in flight (and the one being recorded) are waited for (≤ 20 s).
   */
  const heardSoFar = useCallback(async (): Promise<string> => {
    const voice = speechRef.current;
    if (voice.engine !== 'server') return voice.snapshot();
    settlingRef.current = true;
    setSettling(true);
    try {
      return await voice.settle();
    } finally {
      settlingRef.current = false;
      if (mountedRef.current) setSettling(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      draftRef.current?.flush();
      stopTTS();
    };
  }, []);

  // ── Loading the ticket ──
  useEffect(() => {
    let active = true;
    if (questionIds.length === 0) {
      dispatch({ type: 'load_failed', kind: 'not_found', message: 'В адресе нет вопросов билета.' });
      return;
    }
    loadTicket(examId, questionIds).then(
      (result) => {
        if (active) dispatch({ type: 'loaded', exam: result.exam, questions: result.questions });
      },
      (error: unknown) => {
        if (!active) return;
        const kind = error && typeof error === 'object' && (error as { kind?: string }).kind === 'not_found' ? 'not_found' : 'failed';
        dispatch({ type: 'load_failed', kind, message: error instanceof Error ? error.message : TICKET_LOAD_FAILED });
      },
    );
    return () => {
      active = false;
    };
  }, [examId, questionIds]);

  const loadRubric = useCallback(
    async (run: number, target: TicketQuestion, signal: AbortSignal) => {
      dispatch({ type: 'rubric_loading', run });
      let rubric: RubricState;
      try {
        const response = await fetchRubric({ examId, questionId: target.id }, { signal });
        rubric =
          response.rubric.coverage === 'none' || response.rubric.points.length === 0
            ? { status: 'not_in_lectures', message: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.', nearest: nearestFromRubric(response.rubric) }
            : { status: 'ready', response };
      } catch (error) {
        if (signal.aborted) return;
        if (isOralApiError(error) && error.status === 409) {
          rubric = { status: 'not_in_lectures', message: error.message, nearest: nearestFromRow(target) };
        } else if (isOralApiError(error) && error.status === 422) {
          rubric = { status: 'unverifiable', message: error.message, code: error.code };
        } else if (isOralApiError(error) && error.outage) {
          rubric = { status: 'failed', message: error.message };
        } else if (isOralApiError(error) && error.limitReached) {
          // New answer points cost a unit and the day is spent: the answer goes unchecked, like a spent limit.
          if (alive(run)) dispatch({ type: 'limit', run, limit: 'exhausted' });
          rubric = { status: 'blocked', message: error.message };
        } else {
          rubric = { status: 'blocked', message: error instanceof Error ? error.message : AI_UNAVAILABLE_MESSAGE };
        }
      }
      if (alive(run)) dispatch({ type: 'rubric', run, rubric });
    },
    [alive, examId],
  );

  // ── Each question: rubric, history, limit, a restored attempt or draft ──
  useEffect(() => {
    const target = stateRef.current.questions[stateRef.current.index];
    if (!target || state.run === 0) return;
    const run = state.run;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    speechRef.current.reset('');
    stopTTS();
    draftRef.current?.flush();
    draftRef.current = createDraftWriter(target.id);
    lastDraftRef.current = '';
    setSheetOpen(false);

    void loadRubric(run, target, controller.signal);
    loadQuestionHistory(target.question_hash).then(
      (history) => {
        if (alive(run)) dispatch({ type: 'history', run, history });
      },
      () => {
        if (alive(run)) dispatch({ type: 'history', run, history: null });
      },
    );
    if (user?.id) {
      // A checked answer costs AI_COSTS.answer units (the server charges them at /api/oral/evaluate).
      checkAILimit(user.id, AI_COSTS.answer).then((status) => {
        if (alive(run)) dispatch({ type: 'limit', run, limit: status.ok && !status.allowed ? 'exhausted' : 'ok' });
      });
    }

    const restore = () => {
      if (!alive(run)) return;
      const stash = readStashedAttempt(examId, target.id);
      if (stash) {
        dispatch({
          type: 'stash_restored',
          message: EVALUATION_FAILED_MESSAGE,
          attempt: {
            attemptId: stash.attemptId,
            snapshot: stash.transcript,
            transcript: stash.transcript,
            live: stash.live,
            input: stash.input,
            durationSeconds: stash.durationSeconds,
            startedAt: stash.createdAt,
            restored: true,
          },
          followup: stash.followup
            ? {
                pointId: stash.followup.point_id,
                question: stash.followup.question,
                expected: stash.followup.expected,
                chosenBy: stash.followup.chosen_by,
                stage: 'done',
                mode: 'text',
                typed: '',
                notHeard: false,
                status: stash.followup.status,
                answer: stash.followup.student_quote,
                judgedBy: stash.followup.judged_by ?? null,
              }
            : null,
        });
        return;
      }
      const draft = readDraft(target.id);
      if (draft) dispatch({ type: 'draft_restored', text: draft.text, savedAt: draft.savedAt, input: draft.input, now: Date.now() });
    };
    // «Ответить ещё раз» while the last answer to this question is still being saved: its draft is
    // offered back only if that save fails (a successful one clears it).
    const pending = savingRef.current;
    if (pending && pending.questionId === target.id) void pending.promise.then(restore);
    else restore();
    return () => controller.abort();
    // The run number alone starts a question; everything else is read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.run]);

  // ── When the rubric is ready: the examiner's lines go into the persistent cache, in order ──
  useEffect(() => {
    if (!rubricResponse) return;
    for (const line of examinerLines(rubricResponse.rubric.points)) void prefetchTTS(line, 'professor', { persist: true });
  }, [rubricResponse]);

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
    const announcement = added.map((point) => `Пункт ${points.indexOf(point) + 1} назван: ${point.title}`).join('. ');
    dispatch({ type: 'marks', named: points.filter((point) => named.has(point.id)).map((point) => point.id), announcement });
  }, [marksActive, named, points, state.named]);

  // Speech that produced words makes the answer a spoken one.
  useEffect(() => {
    if (state.phase === 'answering' && voiceAnswer && (speech.finalText || speech.interimText)) dispatch({ type: 'heard' });
  }, [speech.finalText, speech.interimText, state.phase, voiceAnswer]);

  // ── The draft: the answer text is kept on this device while it is given ──
  useEffect(() => {
    if (state.phase !== 'answering') return;
    // A restored draft is not written back unchanged: its time stays the time it was written.
    if (state.draftAt && lastDraftRef.current === '' && answerText === state.typed) {
      lastDraftRef.current = answerText;
      return;
    }
    if (answerText === lastDraftRef.current) return;
    lastDraftRef.current = answerText;
    draftRef.current?.update(answerText, inputOf(state.usedSpeech || voiceAnswer, state.usedText));
  }, [answerText, state.draftAt, state.phase, state.typed, state.usedSpeech, state.usedText, voiceAnswer]);

  // ── The clock and the hints ──
  const ticking = state.phase === 'answering' || state.phase === 'followup';
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  // ── The server took over the recognition: say so once (the words said so far stay) ──
  const switchedBecause = speech.switchedBecause;
  useEffect(() => {
    if (!switchedBecause || switchedBecause === 'chosen') return;
    const current = stateRef.current;
    if (current.phase !== 'answering' && current.phase !== 'followup') return;
    dispatch({ type: 'notice', text: switchedBecause === 'silence' ? CHOSE_SERVER_NOTICE : SWITCHED_TO_SERVER_NOTICE });
  }, [switchedBecause]);

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

  // ── The evaluation decides when the protocol opens ──
  useEffect(() => {
    if (state.phase === 'evaluating' && (state.evaluation.status === 'done' || state.evaluation.status === 'failed')) dispatch({ type: 'protocol' });
  }, [state.phase, state.evaluation.status]);

  // An answer whose evaluation failed waits in sessionStorage for «Проверить снова».
  useEffect(() => {
    if (state.phase !== 'protocol' || state.evaluation.status !== 'failed' || !state.attempt || !question) return;
    const f = state.followup;
    stashAttempt({
      examId,
      questionId: question.id,
      attemptId: state.attempt.attemptId,
      transcript: state.attempt.transcript,
      input: state.attempt.input,
      durationSeconds: state.attempt.durationSeconds,
      live: state.attempt.live,
      followup:
        f && f.status
          ? {
              point_id: f.pointId,
              question: f.question,
              expected: f.expected,
              status: f.status,
              student_quote: f.answer,
              chosen_by: f.chosenBy,
              judged_by: f.judgedBy,
            }
          : null,
      createdAt: state.attempt.startedAt,
    });
  }, [examId, question, state.attempt, state.evaluation.status, state.followup, state.phase]);

  // ── The grade and the one save ──
  const grade: GradeResult | null = useMemo(() => {
    if (!rubricResponse || state.evaluation.status !== 'done') return null;
    const evaluated = new Map(state.evaluation.result.points.map((point) => [point.id, point.status]));
    // How the follow-up was judged decides whether the cap for an unrecovered main point applies:
    // the model's check, «Не знаю» or silence (null) are trusted; the key-word fallback is not.
    const f =
      state.followup && state.followup.status
        ? { point_id: state.followup.pointId, status: state.followup.status, judgedBy: state.followup.judgedBy }
        : null;
    return gradeAnswer(
      rubricResponse.rubric.points.map((point) => ({ id: point.id, essential: point.essential, status: evaluated.get(point.id) ?? 'unrated' })),
      f,
    );
  }, [rubricResponse, state.evaluation, state.followup]);

  const save = useCallback(async () => {
    const current = stateRef.current;
    const target = current.questions[current.index];
    if (!target || !current.attempt || current.evaluation.status !== 'done' || current.rubric.status !== 'ready' || !grade) return;
    if (grade.score === null) {
      dispatch({ type: 'no_grade' });
      return;
    }
    const f = current.followup;
    const followup: FollowupRecord | null =
      f && f.status
        ? { point_id: f.pointId, question: f.question, expected: f.expected, status: f.status, student_quote: f.answer, chosen_by: f.chosenBy }
        : null;
    const payload = buildAttemptPayload({
      attemptId: current.attempt.attemptId,
      examQuestionId: target.id,
      evidenceMaterialId: target.evidence[0]?.material_id || null,
      rubricId: current.rubric.response.rubric_id,
      rubric: current.rubric.response.rubric,
      evaluation: current.evaluation.result,
      grade,
      followup,
      live: new Set(current.attempt.live),
      input: current.attempt.input,
      durationSeconds: current.attempt.durationSeconds,
      confidence: current.history?.confidence ?? null,
    });
    const run = current.run;
    const attemptId = current.attempt.attemptId;
    const before = current.history?.state.readiness ?? 'untested';
    const startedAt = new Date().toISOString();
    dispatch({ type: 'save_start' });
    const promise = saveOralAttempt(user?.id ?? null, payload).then(
      (result) => {
        // The answer is in the history now, whatever the page did meanwhile (the student may have
        // left it): its draft and its waiting copy go, and the exam sheet learns which question changed.
        if (alive(run)) draftRef.current?.cancel();
        clearDraft(target.id, startedAt);
        clearStashedAttempt(attemptId);
        addPeakFlag(examId, { hash: target.question_hash, questionId: target.id, before });
        if (alive(run)) dispatch({ type: 'save_done', result, at: new Date().toISOString() });
        return 'saved' as const;
      },
      () => {
        if (alive(run)) dispatch({ type: 'save_failed' });
        return 'failed' as const;
      },
    );
    const entry = { questionId: target.id, promise };
    savingRef.current = entry;
    await promise;
    if (savingRef.current === entry) savingRef.current = null;
  }, [alive, examId, grade, user?.id]);

  useEffect(() => {
    if (state.phase === 'protocol' && state.evaluation.status === 'done' && state.save.status === 'idle') void save();
  }, [save, state.evaluation.status, state.phase, state.save.status]);

  // ── Leaving ──
  const unsaved = hasUnsavedAnswer(state, answerText);
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  const askToLeave = useCallback(async (): Promise<boolean> => {
    const pending = savingRef.current;
    if (pending) {
      // The answer is being saved right now: wait for it rather than call it unsaved.
      const outcome = await within(pending.promise, SAVE_WAIT_MS);
      if (outcome === 'saved') return true;
      if (outcome === 'waiting') {
        return confirm({
          title: 'Выйти из билета?',
          message: 'Результат ещё сохраняется. Если сохранить не получится, текст ответа останется черновиком на этом устройстве.',
          confirmText: 'Выйти',
          cancelText: 'Остаться',
          type: 'warning',
        });
      }
      // The save failed: the answer is not saved, as the question below says.
    }
    if (!hasUnsavedAnswer(stateRef.current, joinSpeech(stateRef.current.mode === 'voice' ? speechRef.current.snapshot() : stateRef.current.typed))) {
      return true;
    }
    return confirm({
      title: 'Выйти из билета?',
      message: 'Ответ ещё не сохранён. Текст ответа останется черновиком на этом устройстве.',
      confirmText: 'Выйти',
      cancelText: 'Остаться',
      type: 'warning',
    });
  }, [confirm]);

  const leave = useCallback(
    async (to: string) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      try {
        if (!(await askToLeave())) return;
        draftRef.current?.flush();
        stopTTS();
        navigate(to);
      } finally {
        leavingRef.current = false;
      }
    },
    [askToLeave, navigate],
  );

  // ── Answering ──
  const choose = (mode: AnswerMode) => {
    setPreferred(mode);
    writePreferredMode(mode);
  };

  const startVoice = () => {
    if (!answerableIn(state)) return;
    if (!speech.supported) {
      focusTextRef.current = true;
      track('answer_started', { mode: 'text', voice_unsupported: true });
      dispatch({ type: 'start', mode: 'text', now: Date.now() });
      return;
    }
    choose('voice');
    speech.reset(state.typed);
    if (speech.start()) {
      if (state.phase !== 'answering') track('answer_started', { mode: 'voice', engine: speech.engine });
      dispatch({ type: state.phase === 'answering' ? 'mode' : 'start', mode: 'voice', now: Date.now() });
    }
  };

  const startText = () => {
    if (!answerableIn(state) || settlingRef.current) return;
    choose('text');
    focusTextRef.current = true;
    if (state.phase === 'answering' && voiceAnswer) {
      const toText = (text: string) => {
        speechRef.current.reset(text);
        dispatch({ type: 'mode', mode: 'text', typed: text, now: Date.now() });
      };
      if (speechRef.current.engine === 'server') {
        // The server's last pieces belong to the answer: the field gets them too.
        const run = state.run;
        void heardSoFar().then((text) => {
          if (alive(run) && stateRef.current.phase === 'answering') toText(text);
        });
        return;
      }
      toText(speechRef.current.snapshot());
      return;
    }
    track('answer_started', { mode: 'text' });
    dispatch({ type: 'start', mode: 'text', now: Date.now() });
  };

  const pause = () => {
    speech.pause();
    dispatch({ type: 'pause', now: Date.now() });
  };

  const resume = () => {
    if (speech.start()) dispatch({ type: 'resume', now: Date.now() });
  };

  const restartAnswer = async () => {
    const ok = await confirm({
      title: 'Начать ответ заново?',
      message: 'Сказанное и написанное в этом ответе будет стёрто.',
      confirmText: 'Начать заново',
      cancelText: 'Отмена',
      type: 'warning',
    });
    if (!ok) return;
    speech.reset('');
    draftRef.current?.cancel();
    if (question) clearDraft(question.id);
    dispatch({ type: 'restart' });
  };

  const clearRestoredDraft = () => {
    speech.reset('');
    draftRef.current?.cancel();
    if (question) clearDraft(question.id);
    dispatch({ type: 'draft_cleared' });
  };

  const listenFollowup = useCallback(
    (token: number) => {
      const current = stateRef.current;
      if (token !== askTokenRef.current || current.phase !== 'followup' || !current.followup || current.followup.stage === 'done') return;
      if (current.followup.mode !== 'voice') return;
      // The recognizer holds only this follow-up's answer (emptied when the follow-up began), so
      // words said before «Повторить вопрос» stay in it.
      if (speechRef.current.start()) dispatch({ type: 'followup_listen' });
      else dispatch({ type: 'followup_mode', mode: 'text', typed: speechRef.current.snapshot() });
    },
    [],
  );

  /** Says the follow-up; the microphone opens only when the question has been heard (+300 ms). */
  const askFollowup = useCallback(
    (text: string) => {
      const token = (askTokenRef.current += 1);
      void speakLine(text).then((how) => {
        if (!mountedRef.current || token !== askTokenRef.current) return;
        const current = stateRef.current;
        if (current.phase !== 'followup' || current.followup?.stage !== 'asking' || current.followup.mode !== 'voice') return;
        later(() => listenFollowup(token), how === 'failed' ? 0 : LISTEN_AFTER_AUDIO_MS);
      });
    },
    [later, listenFollowup],
  );

  /**
   * «Готово» with nothing to check against: no model, no grade. The answer stays on the screen and the
   * student rates it; the words still being recognised replace the snapshot when they come.
   */
  const finishUnchecked = () => {
    const current = stateRef.current;
    if (current.phase !== 'answering' || !question) return;
    const voice = current.mode === 'voice';
    const snapshot = voice ? speech.snapshot() : current.typed;
    if (words(snapshot).length === 0) {
      dispatch({ type: 'notice', text: EMPTY_ANSWER_NOTICE });
      return;
    }
    const run = current.run;
    const reference = current.rubric.status === 'ready' ? current.rubric.response.rubric.points : [];
    const live = reference.length > 0 ? Array.from(liveMarks(reference, snapshot, '', new Set(current.named))) : [];
    const input = inputOf(current.usedSpeech || (voice && words(snapshot).length > 0), current.usedText);
    dispatch({ type: 'self_check', attemptId: newEventId(), transcript: snapshot, live, input, now: Date.now(), startedAt: new Date().toISOString() });
    track('answer_finished', { checked: false, mode: voice ? 'voice' : 'text', time: secondsBucket(answerTime(current, Date.now())) });
    draftRef.current?.cancel();
    clearDraft(question.id);
    if (voice) {
      void speech.stop().then((text) => {
        if (alive(run) && words(text).length > 0) dispatch({ type: 'transcript', text });
      });
    }
  };

  /** «знаю · плаваю · не знаю» for an unchecked answer: the same journal entry as the sheet's self-rating. */
  const rateSelf = async (rating: Rating) => {
    const current = stateRef.current;
    if (current.phase !== 'self_check' || !question || current.selfRating.status === 'saving') return;
    const run = current.run;
    dispatch({ type: 'self_rating', status: 'saving', rating });
    try {
      await recordSelfRating({
        questionHash: question.question_hash,
        rating,
        examId,
        examQuestionId: question.id,
        materialId: question.evidence[0]?.material_id || null,
      });
      if (alive(run)) dispatch({ type: 'self_rating', status: 'saved', rating });
    } catch {
      if (alive(run)) dispatch({ type: 'self_rating', status: 'failed', rating });
    }
  };

  /** A failed check. A spent day (429 ai_limit) says when it resets and marks the limit as spent. */
  const evaluationFailed = (run: number, error: unknown) => {
    const limit = isOralApiError(error) && error.limitReached;
    dispatch({ type: 'evaluation_failed', run, message: limit ? evaluationLimitMessage() : EVALUATION_FAILED_MESSAGE });
    if (limit) dispatch({ type: 'limit', run, limit: 'exhausted' });
  };

  const finish = async () => {
    const before = stateRef.current;
    if (before.phase !== 'answering' || !question || settlingRef.current) return;
    if (before.mode === 'voice' && speechRef.current.engine === 'server') {
      // The last phrase is still on its way to the server: the answer is not complete without it.
      await heardSoFar();
      if (!alive(before.run) || stateRef.current.phase !== 'answering') return;
    }
    const current = stateRef.current;
    if (current.rubric.status !== 'ready' || current.limit === 'exhausted') {
      finishUnchecked();
      return;
    }
    const rubric = current.rubric.response.rubric;
    const rubricPoints = rubric.points;
    const voice = current.mode === 'voice';
    const snapshot = voice ? speech.snapshot() : current.typed;
    if (words(snapshot).length === 0) {
      dispatch({ type: 'notice', text: EMPTY_ANSWER_NOTICE });
      return;
    }
    const run = current.run;
    const signal = controllerRef.current?.signal;
    const live = Array.from(liveMarks(rubricPoints, snapshot, '', new Set(current.named)));
    const input = inputOf(current.usedSpeech || (voice && words(snapshot).length > 0), current.usedText);
    const attemptId = newEventId();
    const startedAt = new Date().toISOString();
    dispatch({ type: 'finalize', attemptId, snapshot, live, input, now: Date.now(), startedAt });
    track('answer_finished', { checked: true, mode: voice ? 'voice' : 'text', time: secondsBucket(answerTime(current, Date.now())) });
    draftRef.current?.update(snapshot, input);
    draftRef.current?.flush();

    // t0: the quick check on what was heard so far, in parallel with the final transcript and the evaluation.
    const checkPoints = rubricPoints.map((point) => ({ id: point.id, title: point.title, essential: point.essential }));
    const checked = checkAnswer({ question: question.text, points: checkPoints, transcript: snapshot }, { signal, timeoutMs: CHECK_CONFIRM_TIMEOUT_MS }).then(
      (result) => result,
      () => null,
    );
    const finalText = voice ? speech.stop() : Promise.resolve(snapshot);
    const evaluation = finalText.then((text) => {
      const transcript = words(text).length > 0 ? text : snapshot;
      if (alive(run)) dispatch({ type: 'transcript', text: transcript });
      return evaluateAnswer(
        {
          question: question.text,
          points: rubricPoints.map((point) => ({ id: point.id, title: point.title, essential: point.essential, source_quote: point.source_quote })),
          transcript,
        },
        { signal },
      );
    });
    evaluation.then(
      (result) => {
        if (alive(run)) dispatch({ type: 'evaluation_done', run, result });
      },
      (error: unknown) => {
        if (!alive(run) || (isOralApiError(error) && error.kind === 'aborted')) return;
        evaluationFailed(run, error);
      },
    );
    dispatch({ type: 'examiner' });

    const candidate = browserCandidate(rubricPoints, snapshot);
    // «Так…» only from the cache: a live request would arrive after the question it is meant to fill.
    const filler = isTTSReady(FILLER_LINE, 'professor').then((ready) => (ready ? speakLine(FILLER_LINE, FILLER_WAIT_MS) : undefined));
    const check = await checked;
    if (!alive(run)) return;
    const choice = decideFollowup(candidate, check);
    await filler;
    // The examiner speaks once the whole answer is in (stop() takes at most 800 ms, usually done by now).
    await finalText;
    if (!alive(run) || stateRef.current.phase !== 'examiner') return;
    const point = choice ? rubricPoints.find((item) => item.id === choice.pointId) : undefined;
    if (choice && point && point.followup.question) {
      const mode: AnswerMode = voice && speech.supported && speechRef.current.status !== 'error' ? 'voice' : 'text';
      // The answer itself is kept in the attempt; the recognizer starts empty for the follow-up's answer.
      speechRef.current.reset('');
      dispatch({ type: 'followup', pointId: point.id, question: point.followup.question, expected: point.followup.expected, chosenBy: choice.chosenBy, mode });
      // The brace draws (250 ms), the examiner's block comes in at +200 ms, the voice at +300 ms —
      // unless the student has already chosen to answer or said «Не знаю».
      const token = askTokenRef.current;
      const askedQuestion = point.followup.question;
      later(() => {
        const current = stateRef.current;
        // Typing an answer meanwhile is fine (the field is there while the question is heard); «Не знаю»,
        // «Отвечать» or «Текстом» move the token on and keep the voice silent.
        if (token !== askTokenRef.current || current.phase !== 'followup' || !current.followup || current.followup.status !== null) return;
        askFollowup(askedQuestion);
      }, FOLLOWUP_VOICE_DELAY_MS);
      return;
    }
    // «Хорошо, по существу всё» only over an answer that named every row by key words; a closed row
    // gets «Хорошо, спасибо» (Jury_Check item 12).
    const closing = closingLine(rubricPoints, live);
    dispatch({ type: 'no_followup', closing });
    void speakLine(closing);
  };

  // ── The follow-up ──
  const followup = state.followup;
  const followupVoice = followup?.mode === 'voice';

  const answerFollowupNow = () => {
    stopTTS();
    const token = (askTokenRef.current += 1);
    const f = stateRef.current.followup;
    // What is already answered stays in the answer: the typed words, or words said before «Повторить вопрос».
    const carried = f?.mode === 'text' ? f.typed : speechRef.current.snapshot();
    if (!speech.supported) {
      dispatch({ type: 'followup_mode', mode: 'text', typed: carried });
      return;
    }
    speechRef.current.reset(carried);
    if (f?.mode !== 'voice') dispatch({ type: 'followup_mode', mode: 'voice' });
    later(() => {
      if (token !== askTokenRef.current) return;
      if (speechRef.current.start()) dispatch({ type: 'followup_listen' });
      else dispatch({ type: 'followup_mode', mode: 'text', typed: speechRef.current.snapshot() });
    }, LISTEN_AFTER_AUDIO_MS);
  };

  const followupToText = () => {
    askTokenRef.current += 1;
    stopTTS();
    const f = stateRef.current.followup;
    if (f?.mode === 'voice' && speechRef.current.engine === 'server') {
      const run = stateRef.current.run;
      void heardSoFar().then((text) => {
        if (alive(run) && stateRef.current.phase === 'followup') followupTextWith(text);
      });
      return;
    }
    followupTextWith(f?.mode === 'voice' ? speechRef.current.snapshot() : f?.typed ?? '');
  };

  const followupTextWith = (text: string) => {
    speechRef.current.reset('');
    focusTextRef.current = true;
    dispatch({ type: 'followup_mode', mode: 'text', typed: text });
  };

  const repeatFollowup = () => {
    if (!followup) return;
    const question = followup.question;
    // The microphone must not take the examiner's words: listen again after the repeat.
    const repeatAndListen = () => {
      dispatch({ type: 'followup_repeat' });
      const token = (askTokenRef.current += 1);
      void speakLine(question).then((how) => {
        if (token !== askTokenRef.current) return;
        later(() => {
          if (token !== askTokenRef.current || stateRef.current.followup?.stage !== 'asking') return;
          if (speechRef.current.start()) dispatch({ type: 'followup_listen' });
        }, how === 'failed' ? 0 : LISTEN_AFTER_AUDIO_MS);
      });
    };
    if (followup.stage === 'answering' && followupVoice && speechRef.current.engine === 'server') {
      // The server's pieces in flight stay in the answer: wait for them, then repeat.
      const run = stateRef.current.run;
      void heardSoFar().then((text) => {
        if (!alive(run) || stateRef.current.phase !== 'followup') return;
        speechRef.current.reset(text);
        repeatAndListen();
      });
      return;
    }
    if (followup.stage === 'answering' && followupVoice) {
      const text = speechRef.current.snapshot();
      speechRef.current.reset(text);
      repeatAndListen();
      return;
    }
    askFollowup(question);
  };

  const dontKnow = () => {
    askTokenRef.current += 1;
    stopTTS();
    speech.reset('');
    // «Не знаю» is an answer: missing, without a call.
    dispatch({ type: 'followup_result', status: 'missing', answer: 'не знаю' });
  };

  const finishFollowup = async () => {
    const before = stateRef.current;
    if (before.phase !== 'followup' || !before.followup || settlingRef.current) return;
    if (before.followup.mode === 'voice' && speechRef.current.engine === 'server') {
      await heardSoFar();
      if (!alive(before.run) || stateRef.current.phase !== 'followup' || stateRef.current.followup?.pointId !== before.followup.pointId) return;
    }
    const current = stateRef.current;
    const f = current.followup;
    if (current.phase !== 'followup' || !f || current.rubric.status !== 'ready' || !question) return;
    const point = current.rubric.response.rubric.points.find((item) => item.id === f.pointId);
    if (!point) return;
    const voice = f.mode === 'voice';
    const heard = voice ? speechRef.current.snapshot() : f.typed;
    if (words(heard).length === 0 && !voice) {
      dispatch({ type: 'notice', text: 'Ответ пустой: напишите ответ или нажмите «Не знаю».' });
      return;
    }
    if (words(heard).length === 0) {
      if (!f.notHeard) {
        const token = (askTokenRef.current += 1);
        speech.reset('');
        dispatch({ type: 'followup_not_heard' });
        void speakLine(NOT_HEARD_LINE).then((how) => {
          if (token !== askTokenRef.current) return;
          if (voice) later(() => listenFollowup(token), how === 'failed' ? 0 : LISTEN_AFTER_AUDIO_MS);
        });
        return;
      }
      speech.reset('');
      dispatch({ type: 'followup_result', status: 'missing', answer: '' });
      return;
    }
    askTokenRef.current += 1;
    dispatch({ type: 'followup_checking' });
    const answer = voice ? (await speech.stop()) || heard : heard;
    const run = current.run;
    // «Не знаю» said or typed is the button's answer: missing, no check — so the grade cap holds even when the check is slow.
    if (saysDontKnow(answer)) {
      if (!alive(run)) return;
      dispatch({ type: 'followup_result', status: 'missing', answer: answer.trim().slice(0, 160) });
      return;
    }
    let status: 'covered' | 'partial' | 'missing' | 'wrong';
    let judgedBy: 'check' | 'keywords' = 'check';
    try {
      const result = await checkAnswer(
        {
          question: question.text,
          points: current.rubric.response.rubric.points.map((item) => ({ id: item.id, title: item.title, essential: item.essential })),
          transcript: answer,
          only: f.pointId,
          followupQuestion: f.question,
        },
        { signal: controllerRef.current?.signal, timeoutMs: CHECK_FOLLOWUP_TIMEOUT_MS },
      );
      status = result.statuses[f.pointId] ?? 'missing';
    } catch {
      // No answer from the check in time: the browser rule decides, without the words the question
      // already said — and the protocol says it was decided by key words.
      status = followupFallback(point.anchors, f.question, answer);
      judgedBy = 'keywords';
    }
    if (!alive(run)) return;
    dispatch({ type: 'followup_result', status, answer: answer.slice(0, 160), judgedBy });
  };

  // ── Retrying ──
  const retryRubric = () => {
    if (!question || !controllerRef.current) return;
    void loadRubric(state.run, question, controllerRef.current.signal);
  };

  const retryEvaluation = async () => {
    const current = stateRef.current;
    if (!current.attempt || current.rubric.status !== 'ready' || !question) return;
    const run = current.run;
    dispatch({ type: 'evaluation_retry', run });
    try {
      const result = await evaluateAnswer(
        {
          question: question.text,
          points: current.rubric.response.rubric.points.map((point) => ({
            id: point.id,
            title: point.title,
            essential: point.essential,
            source_quote: point.source_quote,
          })),
          transcript: current.attempt.transcript,
        },
        { signal: controllerRef.current?.signal },
      );
      if (alive(run)) dispatch({ type: 'evaluation_done', run, result });
    } catch (error) {
      if (alive(run) && !(isOralApiError(error) && error.kind === 'aborted')) evaluationFailed(run, error);
    }
  };

  const goToQuestion = async (index: number) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      if (!(await askToLeave())) return;
      clearStashedAttempt();
      stopTTS();
      dispatch({ type: 'question', index });
    } finally {
      leavingRef.current = false;
    }
  };

  const toggleLiveMarks = (on: boolean) => {
    rememberLiveMarks(mode, on);
    setLiveMarksOn(on);
  };

  // ── Focus: a control removed by a state change hands the focus to the state's main control ──
  const rememberFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement) lastFocusRef.current = event.target;
  }, []);

  useLayoutEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    if (focusTextRef.current) {
      focusTextRef.current = false;
      const field = room.querySelector<HTMLTextAreaElement>('textarea.or-text-field');
      if (field) {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
        return;
      }
    }
    // Only a focus that fell out of the page with its control is moved: never on arrival, never away
    // from a control the student is on.
    const lost = lastFocusRef.current;
    const active = document.activeElement;
    if (!lost || lost.isConnected || (active && active !== document.body)) return;
    room.querySelector<HTMLElement>('[data-anchor]')?.focus();
  });

  // ── What the screen says ──
  const exam = state.exam;
  const total = state.questions.length;
  const heading = ticketHeading(ticketNumber, state.index, total || questionIds.length, question?.label || (question ? String(question.position) : ''));
  const where = [heading.strong, heading.rest].filter(Boolean).join(', ');
  const short = total > 1 ? `${heading.strong} · ${state.index + 1} из ${total}` : heading.strong;
  const protocol = protocolState(state);
  const elapsed = answerTime(state, now);
  const timerShown = state.phase === 'answering' || state.phase === 'finalizing' || state.phase === 'examiner' || state.phase === 'followup';
  const exitLink = (
    <button type="button" className="sf-link" data-muted="" onClick={() => void leave(`/exams/${examId}`)}>
      <span className="or-exit-long">Выйти из билета</span>
      <span className="or-exit-short">Выйти</span>
    </button>
  );

  if (state.phase === 'loading' || state.phase === 'load_error') {
    return (
      <div className="or-shell" ref={roomRef} onFocus={rememberFocus}>
        <RoomBar course="" where="Билет" short="Билет" onLeave={(to) => void leave(to)} right={exitLink} />
        <main className="sf-page or-room or-room-single">
          {state.phase === 'loading' ? (
            <p className="or-message or-message-muted" role="status">
              Загружаем билет…
            </p>
          ) : (
            <div className="or-state">
              <h1 className="or-state-title">{state.loadError?.kind === 'not_found' ? 'Билет не найден' : 'Не удалось загрузить билет'}</h1>
              <p className="or-state-text">{state.loadError?.message}</p>
              <div className="or-acts">
                <Link className="sf-link" to={`/exams/${examId}`}>
                  Лист экзамена
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // «Цифровая экономика · Билет 12, вопрос 1 из 2»: the subject, not «Экзамен: …» again.
  const course = exam ? subjectOf(exam.title) : '';
  const answerFinalWords = state.phase === 'answering' ? underlinedFinalWords(points, named, finalText) : underlinedFinalWords(points, new Set(state.named), state.attempt?.transcript ?? '');

  // ── The protocol ──
  if (state.phase === 'protocol' && rubricResponse && question) {
    const followupForProtocol: ProtocolFollowup | null =
      state.followup && state.followup.status
        ? {
            pointId: state.followup.pointId,
            question: state.followup.question,
            answer: state.followup.answer,
            status: state.followup.status,
            judgedBy: state.followup.judgedBy,
          }
        : null;
    // For screen readers and the focus: the protocol's own heading (the sheet has none of its own).
    const protocolTitle = (
      <h1 className="sr-only or-sr-title" tabIndex={-1} data-anchor="">
        {`Протокол ответа, ${where}`}
      </h1>
    );
    const savedAt = state.save.status === 'saved' ? state.save.at : state.attempt?.startedAt ?? new Date().toISOString();
    const previous = state.history?.previous ?? null;
    // The previous answer may have been given in another exam with the same question: its protocol lives there.
    const previousPath = previous ? `/exams/${previous.examId ?? examId}/ticket?session=${encodeURIComponent(previous.sessionId)}` : '';
    // «Прошлый ответ, 2 окт.: «хорошо».» on its own line, the date being the link to that protocol: a
    // grade in words, not «4 из 5» next to «Раскрыто 3 пункта из 5» (redesign critique 4, round 2).
    const previousWord = previous && previous.grade !== null ? gradeWord(previous.grade) : '';
    const previousLink =
      previous && previous.sessionId !== (state.save.status === 'saved' ? state.save.result.sessionId : '') ? (
        <>
          {'Прошлый ответ, '}
          <Link className="sf-ref" to={previousPath} aria-label={`Протокол прошлого ответа, ${shortDate(previous.localDate)}`}>
            {shortDate(previous.localDate)}
          </Link>
          {previousWord ? `: «${previousWord}».` : '.'}
        </>
      ) : null;
    const hasNext = state.index + 1 < total;
    // «Билет 12, вопрос 1 · ответ 3 октября, 14:12»; a drawn pair: «Вопрос 12 · ответ 4 октября, 1:13».
    const sheetHeading = glue(
      `${heading.strong}${ticketNumber && total > 1 ? `, вопрос ${state.index + 1}` : ''} · ответ ${longDateTime(savedAt)}`,
    );
    const barRight = (
      <>
        {protocol === 'saved' ? <span className="or-saved">Сохранено</span> : null}
        <button type="button" className="sf-link or-sheet-link" data-muted="" onClick={() => void leave(`/exams/${examId}`)}>
          <ArrowLeft className="or-back-icon" aria-hidden="true" strokeWidth={1.75} />
          Лист экзамена
        </button>
      </>
    );
    const seed = state.attempt?.attemptId ?? question.id;

    if (protocol === 'eval_error') {
      return (
        <div className="or-shell" ref={roomRef} onFocus={rememberFocus}>
          <RoomBar course={course} where={`${heading.strong} · ответ не проверен`} short={short} onLeave={(to) => void leave(to)} right={barRight} backOnPhone />
          <main className="sf-page or-room" data-phase="protocol">
            {protocolTitle}
            <section className="or-left" aria-label="Предварительные отметки">
              <ProtocolSheet heading={sheetHeading} points={livePoints(rubricResponse.rubric, null, new Set(state.named))} followup={null} stamp="none" seed={seed} preliminary />
            </section>
            <section className="or-side" aria-label="Проверка ответа">
              <h2 className="or-state-title">Ответ не проверен</h2>
              <p className="or-message" role="alert">
                {state.evaluation.status === 'failed' ? state.evaluation.message : EVALUATION_FAILED_MESSAGE}
              </p>
              <p className="or-hint">Оценки нет, лимит не списан, в историю ничего не записано.</p>
              {previous ? (
                <p className="or-previous">
                  <Link className="sf-ref" to={previousPath}>
                    {`Открыть протокол прошлого ответа (${shortDate(previous.localDate)})`}
                  </Link>
                </p>
              ) : null}
              <div className="or-acts" data-wide="">
                <button type="button" className="sf-primary" onClick={() => void retryEvaluation()}>
                  Проверить снова
                </button>
                <button type="button" className="sf-link" onClick={() => void goToQuestion(state.index)}>
                  Ответить ещё раз
                </button>
                <button type="button" className="sf-link or-acts-extra" data-muted="" onClick={() => void leave(`/exams/${examId}`)}>
                  Лист экзамена
                </button>
              </div>
            </section>
          </main>
        </div>
      );
    }

    const result = grade ?? gradeAnswer([], null);
    const saved = state.save.status === 'saved' ? state.save.result : null;
    const askedPoint = followupForProtocol ? rubricResponse.rubric.points.find((point) => point.id === followupForProtocol.pointId) : null;
    const askedStatus = askedPoint && state.evaluation.status === 'done' ? state.evaluation.result.points.find((point) => point.id === askedPoint.id)?.status : null;
    const primary = hasNext ? (
      <button type="button" className="sf-primary" onClick={() => void goToQuestion(state.index + 1)}>
        {nextQuestionLabel(state.index + 1)}
      </button>
    ) : (
      <button type="button" className="sf-primary" onClick={() => void leave(`/exams/${examId}/draw`)}>
        Следующий билет
      </button>
    );
    return (
      <div className="or-shell" ref={roomRef} onFocus={rememberFocus}>
        <RoomBar
          course={course}
          where={`${heading.strong} · протокол ответа, ${longDateTime(savedAt)}`}
          short={`${heading.strong} · протокол`}
          onLeave={(to) => void leave(to)}
          right={barRight}
          backOnPhone
        />
        <main className="sf-page or-room" data-phase="protocol">
          {protocolTitle}
          <section className="or-left" aria-label="Пункты ответа и ваш ответ">
            <ProtocolSheet
              heading={sheetHeading}
              points={livePoints(rubricResponse.rubric, state.evaluation.status === 'done' ? state.evaluation.result : null, new Set(state.named))}
              followup={followupForProtocol}
              // «Засчитано» means counted: the stamp lands only once the answer is saved (jury review).
              stamp={state.save.status === 'saved' ? stampFor(result.grade) : 'none'}
              seed={seed}
              animate={!state.attempt?.restored}
            />
          </section>
          <section className="or-side" aria-label="Оценка">
            <ProtocolGrade result={result} previous={previousLink}>
              <div className="or-back">
                {saved?.cardAdded && followupForProtocol ? (
                  <>
                    <ReviewCard question={followupForProtocol.question} />
                    <p className="or-back-line">
                      {askedStatus === 'wrong'
                        ? 'Пункт с ошибкой стал карточкой — она вернётся в повторении завтра.'
                        : 'Пропущенный пункт стал карточкой — она вернётся в повторении завтра.'}
                    </p>
                  </>
                ) : null}
                {state.save.status === 'saving' || state.save.status === 'idle' ? (
                  <p className="or-save-line" role="status">
                    Сохраняем…
                  </p>
                ) : state.save.status === 'saved' ? (
                  <>
                    <p className="or-save-line" role="status">
                      Сохранено в историю и{' '}
                      <Link className="sf-ref" to="/mistakes">
                        дневник ошибок
                      </Link>
                      .
                    </p>
                    {sheetChange ? (
                      <p className="or-save-line or-sheet-change">
                        {glue(protocolSheetLine(sheetChange))}
                        {' · '}
                        <button type="button" className="sf-link" onClick={() => void leave(`/exams/${examId}?view=sheet`)}>
                          посмотреть
                        </button>
                      </p>
                    ) : null}
                  </>
                ) : state.save.status === 'no_grade' ? (
                  <p className="or-save-line" role="status">
                    Оценки нет: ни один пункт не оценён. Ответ не сохранён, лимит не списан.
                  </p>
                ) : (
                  <p className="or-save-line" data-state="failed" role="alert">
                    Результат не сохранён.{' '}
                    <button type="button" className="sf-link" onClick={() => dispatch({ type: 'save_retry' })}>
                      Повторить
                    </button>
                  </p>
                )}
              </div>
              <div className="or-acts" data-wide="">
                {primary}
                <button type="button" className="sf-link" onClick={() => void goToQuestion(state.index)}>
                  Ответить ещё раз
                </button>
                <button type="button" className="sf-link or-acts-extra" data-muted="" onClick={() => void leave(`/exams/${examId}?view=sheet`)}>
                  К шпаргалке
                </button>
              </div>
            </ProtocolGrade>
          </section>
        </main>
      </div>
    );
  }

  // ── Before and during the answer ──
  const rubric = state.rubric;
  const answering = state.phase === 'answering';
  const ready = rubric.status === 'ready';
  // «Обновится в 3:00» (spec 3.10, 5.11): local time of 00:00 UTC, the hour without a leading zero.
  const limitLine = state.limit === 'exhausted' ? `Дневной лимит исчерпан. Обновится в ${clockTime(nextLimitReset())}.` : null;
  const shownNamed = liveMarksOn ? named : new Set<string>();
  const namedCount = named.size;
  const asked = followup ? followup.pointId : null;
  const silence = answering && voiceAnswer && !state.paused && speech.status === 'listening' && speech.lastActivityAt !== null && now - speech.lastActivityAt > SILENCE_HINT_MS;
  const transcriptShown = answering || state.phase === 'finalizing' || state.phase === 'examiner' || state.phase === 'followup' || state.phase === 'evaluating';
  const shownFinal = answering ? finalText : state.attempt?.transcript ?? finalText;
  const shownInterim = answering ? interimText : '';
  // The words that named the rows: while answering, final and interim words; after it, the answer kept.
  const saidText = answering ? answerText : state.attempt?.transcript ?? answerText;
  const seedBase = question?.id ?? examId;

  const checkable = checkableIn(state);
  const selfCheck = state.phase === 'self_check';
  const why = uncheckedWhy(rubric, state.limit === 'exhausted');
  const nextLink =
    state.index + 1 < total ? (
      <button type="button" className="sf-link" onClick={() => void goToQuestion(state.index + 1)}>
        {nextQuestionLabel(state.index + 1)}
      </button>
    ) : (
      <button type="button" className="sf-link" onClick={() => void leave(`/exams/${examId}/draw`)}>
        Тянуть другой билет
      </button>
    );
  // The way to a reference: lectures with text for this exam (the editor opens at them).
  const fixLink = why.fix ? (
    <button type="button" className="sf-link" onClick={() => void leave(`/exams/${examId}/edit#lectures`)}>
      {why.fix}
    </button>
  ) : null;
  const sheetLink = (
    <button type="button" className="sf-link or-acts-extra" data-muted="" onClick={() => void leave(`/exams/${examId}`)}>
      Лист экзамена
    </button>
  );

  // Why nothing can be checked: before the answer, not while answering (the nearest fragments would be a crib).
  let leftState: ReactNode = null;
  if (rubric.status === 'loading') {
    leftState = (
      <p className="or-message or-message-muted" role="status">
        Собираем пункты ответа по лекциям…
      </p>
    );
  } else if (rubric.status !== 'ready' && !answering) {
    leftState = (
      <div className="or-state">
        <h2 className="or-state-title">{why.title}</h2>
        {why.text ? (
          <p className="or-state-text" role={rubric.status === 'not_in_lectures' ? undefined : 'alert'}>
            {why.text}
          </p>
        ) : null}
        {rubric.status === 'not_in_lectures' ? <NearestList items={rubric.nearest} /> : null}
      </div>
    );
  }

  // Two equal ways to answer: the one chosen last time is the blue pill, the other the white one.
  const voiceFirst = speech.supported && preferred === 'voice';
  // On a phone the white pill says one word, so both fit the bar's one line.
  const voiceButton = (main: boolean) =>
    main ? (
      <button type="button" className="sf-primary" onClick={startVoice} data-anchor="">
        Отвечать голосом
      </button>
    ) : (
      <button type="button" className="or-alt" onClick={startVoice} aria-label="Отвечать голосом">
        <span className="or-wide">Отвечать голосом</span>
        <span className="or-narrow">Голосом</span>
      </button>
    );
  const textButton = (main: boolean) =>
    main ? (
      <button type="button" className="sf-primary" onClick={startText} data-anchor="">
        Ответить текстом
      </button>
    ) : (
      <button type="button" className="or-alt" onClick={startText} aria-label="Ответить текстом">
        <span className="or-wide">Ответить текстом</span>
        <span className="or-narrow">Текстом</span>
      </button>
    );
  const answerChoice = (
    <div className="or-acts or-choice">
      {!speech.supported ? (
        textButton(true)
      ) : voiceFirst ? (
        <>
          {voiceButton(true)}
          {textButton(false)}
        </>
      ) : (
        <>
          {textButton(true)}
          {voiceButton(false)}
        </>
      )}
    </div>
  );

  let side: ReactNode;
  if (selfCheck) {
    const rated = state.selfRating;
    side = (
      <>
        <h2 className="or-state-title" tabIndex={-1} data-anchor="">
          Ответ не проверялся
        </h2>
        {why.after ? <p className="or-hint">{why.after}</p> : null}
        <p className="or-rate-q" id="or-rate-q">
          Как вы ответили?
        </p>
        <div className="or-rate" role="group" aria-labelledby="or-rate-q">
          {SELF_RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              aria-pressed={rated.rating === rating}
              disabled={rated.status === 'saving'}
              onClick={() => {
                if (rated.rating === rating && rated.status === 'saved') return;
                void rateSelf(rating);
              }}
            >
              {SELF_RATING_LABELS[rating]}
            </button>
          ))}
        </div>
        <p className="or-rate-line" role="status" data-state={rated.status === 'failed' ? 'failed' : undefined}>
          {rated.status === 'saving'
            ? 'Сохраняем…'
            : rated.status === 'saved' && rated.rating
              ? `Отмечено «${SELF_RATING_LABELS[rated.rating]}» — видно на листе экзамена.`
              : rated.status === 'failed'
                ? 'Отметка не сохранилась — нажмите ещё раз.'
                : 'Отметка появится на листе экзамена у этого вопроса.'}
        </p>
        <div className="or-acts" data-wide="">
          {state.index + 1 < total ? (
            <button type="button" className="sf-primary" onClick={() => void goToQuestion(state.index + 1)}>
              {nextQuestionLabel(state.index + 1)}
            </button>
          ) : (
            <button type="button" className="sf-primary" onClick={() => void leave(`/exams/${examId}/draw`)}>
              Следующий билет
            </button>
          )}
          <button type="button" className="sf-link" onClick={() => void goToQuestion(state.index)}>
            Ответить ещё раз
          </button>
          {fixLink}
          {sheetLink}
        </div>
      </>
    );
  } else if (rubric.status === 'loading') {
    side = (
      <>
        <div className="or-acts" data-wide="">
          <button type="button" className="sf-primary" disabled>
            {voiceFirst ? 'Отвечать голосом' : 'Ответить текстом'}
          </button>
        </div>
        <p className="or-privacy">{privacyText(speech.engine, true)}</p>
      </>
    );
  } else if (rubric.status === 'blocked') {
    side = (
      <div className="or-acts" data-wide="">
        <button type="button" className="sf-primary" onClick={() => void leave(`/exams/${examId}`)} data-anchor="">
          Лист экзамена
        </button>
        {state.index + 1 < total ? nextLink : null}
      </div>
    );
  } else if (state.phase === 'ready' && rubric.status === 'failed') {
    side = (
      <>
        <div className="or-acts" data-wide="">
          <button type="button" className="sf-primary" onClick={retryRubric} data-anchor="">
            Повторить
          </button>
          <button type="button" className="sf-link" onClick={voiceFirst ? startVoice : startText}>
            Ответить без проверки
          </button>
          {sheetLink}
        </div>
        <p className="or-privacy">{privacyText(speech.engine, true)}</p>
      </>
    );
  } else if (state.phase === 'ready') {
    side = (
      <>
        {limitLine ? (
          <p className="or-message" role="status">
            {limitLine}
          </p>
        ) : null}
        {!speech.supported ? <p className="or-message or-message-muted">{SPEECH_UNSUPPORTED_MESSAGE}</p> : null}
        {!checkable ? (
          <p className="or-message or-message-muted">
            {ready
              ? 'Можно ответить без проверки — после ответа сравните его с пунктами из лекций сами.'
              : 'Можно ответить без проверки — голосом или текстом. После ответа отметьте, как получилось: отметка появится на листе экзамена.'}
          </p>
        ) : null}
        {answerChoice}
        {!checkable && !ready ? (
          <p className="or-links">
            {fixLink}
            {nextLink}
            {sheetLink}
          </p>
        ) : null}
        {ready ? (
          <label className="or-switch">
            <input type="checkbox" checked={liveMarksOn} onChange={(event) => toggleLiveMarks(event.target.checked)} />
            <span className="or-switch-track" aria-hidden="true" />
            Отмечать пункты во время ответа
          </label>
        ) : null}
        <p className="or-privacy">{privacyText(speech.engine, checkable)}</p>
      </>
    );
  } else if (answering) {
    side = (
      <>
        {/* Secondary on purpose: a count by key words, not the result (Jury_Check item 7). */}
        {points.length === 0 ? (
          <p className="or-message or-message-muted">Ответ без проверки: после него оцените себя сами.</p>
        ) : liveMarksOn ? (
          <div className="or-count">
            <p className="or-count-line">
              По ключевым словам:{' '}
              <b>
                {namedCount}
                {'\u00a0'}из{'\u00a0'}
                {points.length}
              </b>
            </p>
            <p className="or-count-fine">итог — после ответа</p>
          </div>
        ) : (
          <p className="or-message or-message-muted">Отметки во время ответа выключены: пункты откроются в протоколе.</p>
        )}
        {state.draftAt ? (
          <p className="or-draft">
            <span>{`Восстановлен черновик ответа от ${draftTime(state.draftAt)}`}</span>
            <button type="button" className="sf-link" data-muted="" onClick={clearRestoredDraft}>
              Очистить
            </button>
          </p>
        ) : null}
        {state.notice ? (
          <p className="or-message" role="status">
            {state.notice}
          </p>
        ) : null}
        {limitLine ? <p className="or-message">{limitLine}</p> : null}
        {voiceAnswer && speech.engine === 'browser' && speech.stuck && !state.paused ? (
          <p className="or-stuck" role="status">
            Текст не появляется? Проверьте, что браузеру разрешён нужный микрофон, или ответьте текстом.
          </p>
        ) : silence ? (
          <p className="or-hint">Говорите — я слушаю.</p>
        ) : null}
        {voiceAnswer && speech.engine === 'server' ? (
          <p className="or-voice" role="status">
            {!state.paused && speech.status === 'listening' ? <MicLevel feed={speech.level} /> : null}
            <span>{serverVoiceLine(settling, speech.pending, state.paused, speech.lost)}</span>
          </p>
        ) : null}
        {elapsed >= LONG_ANSWER_MS ? <p className="or-hint">Обычно на ответ дают 2–3 минуты.</p> : null}
        <div className="or-acts">
          <button type="button" className="sf-primary" onClick={() => void finish()} data-anchor={voiceAnswer ? '' : undefined} aria-busy={settling || undefined}>
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
        {/* The paragraph is said in full before the first answer; while answering it is one link on every
            width (redesign critique 5, round 2: six lines under «Готово» for the whole answer). */}
        <button type="button" className="sf-link or-privacy-link" onClick={() => setPrivacyOpen(true)}>
          Кто видит ответ
        </button>
        {privacyOpen ? <PrivacySheet text={privacyText(speech.engine, checkable)} onClose={() => setPrivacyOpen(false)} /> : null}
      </>
    );
  } else {
    // finalizing, examiner, followup, evaluating: the same line as during the answer stays, so the
    // examiner's question is the largest thing on the desk (redesign critique 3, round 2; Jury_Check 9).
    side = (
      <>
        {liveMarksOn ? (
          <p className="or-count-line">
            По ключевым словам:{' '}
            <b>
              {state.named.length}
              {'\u00a0'}из{'\u00a0'}
              {points.length}
            </b>
          </p>
        ) : null}
        {state.phase === 'finalizing' || state.phase === 'examiner' ? <ExaminerThinking /> : null}
        {state.phase === 'followup' && followup ? (
          <ExaminerLine question={followup.question} onRepeat={followup.stage !== 'checking' ? repeatFollowup : undefined} alignTo={followup.pointId}>
            {followup.stage === 'checking' ? (
              <ExaminerThinking />
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
                {/* One transcript from the question on: while the examiner asks it keeps its place unseen, so the
                    block does not move when the microphone opens (peak 2 on the stage). */}
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
                      emptyText="Говорите — я слушаю."
                    />
                  </div>
                ) : null}
                {followup.mode === 'voice' && followup.stage === 'answering' && speech.engine === 'server' ? (
                  <p className="or-voice" role="status">
                    {speech.status === 'listening' ? <MicLevel feed={speech.level} /> : null}
                    <span>{serverVoiceLine(settling, speech.pending, false, speech.lost)}</span>
                  </p>
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
                  {followup.mode === 'voice' ? (
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
              Проверяем ответ по пунктам из лекций…
            </p>
          </>
        ) : null}
      </>
    );
  }

  // «Как на экзамене»: no «В эталоне N пунктов» hint (Jury_Check item 11).
  const noteLine =
    ready && points.length > 0 && mode !== 'exam' && !selfCheck
      ? liveMarksOn
        ? `Полный ответ — ${pointsWord(points.length)} из ваших лекций. Они откроются, когда вы их назовёте.`
        : `Полный ответ — ${pointsWord(points.length)} из ваших лекций.`
      : null;

  // The answer itself: the field while typing, the transcript otherwise (also after an unchecked answer).
  const answerBody =
    answering && state.mode === 'text' ? (
      <div className="or-said">
        <label className="or-said-label" htmlFor="or-answer-text">
          {`Ваш ответ, ${elapsedLabel(elapsed)}`}
        </label>
        <textarea
          id="or-answer-text"
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
        underlined={liveMarksOn ? answerFinalWords : new Set()}
        drawNew={answering}
        seed={seedFrom(seedBase, 'said')}
        emptyText={answering && voiceAnswer ? (state.paused ? 'Пауза.' : 'Говорите — расшифровка появится здесь.') : undefined}
      />
    );

  return (
    <div className="or-shell" ref={roomRef} onFocus={rememberFocus}>
      <RoomBar
        course={course}
        where={where}
        short={short}
        onLeave={(to) => void leave(to)}
        right={
          <>
            {timerShown ? (
              <span className="or-timer" role="timer" aria-label={`Время ответа ${elapsedSpoken(elapsed)}`}>
                {elapsedLabel(elapsed)}
              </span>
            ) : null}
            {exitLink}
          </>
        }
      />
      <main className="sf-page or-room" data-phase={state.phase}>
        <section className="or-left" aria-label="Билет и пункты ответа">
          {question ? <TicketCard heading={heading} question={question.text} /> : null}
          {noteLine ? <p className="or-note">{noteLine}</p> : null}
          {selfCheck ? (
            <>
              {/* The day's checks spent: the reference is there — its points, marked by key words, to compare with. */}
              {ready && rubricResponse && points.length > 0 ? (
                <ProtocolSheet
                  heading="Пункты ответа из лекций: сравните со своим ответом"
                  points={livePoints(rubricResponse.rubric, null, new Set(state.named))}
                  followup={null}
                  stamp="none"
                  seed={state.attempt?.attemptId ?? seedBase}
                  preliminary
                />
              ) : null}
              <div className="sf-sheet or-sheet" data-plain="">
                {answerBody}
              </div>
              {rubric.status === 'not_in_lectures' && rubric.nearest.length > 0 ? (
                <div className="or-state">
                  <NearestList items={rubric.nearest} />
                </div>
              ) : null}
            </>
          ) : null}
          {selfCheck ? null : leftState}
          {!selfCheck && answering && !(ready && points.length > 0) ? (
            <div className="sf-sheet or-sheet" data-plain="">
              {answerBody}
            </div>
          ) : null}
          {!selfCheck && ready && points.length > 0 ? (
            <div className="sf-sheet or-sheet" data-collapsed={sheetOpen ? undefined : ''} data-empty={transcriptShown ? undefined : ''}>
              {/* Phones: the strip «По ключевым словам: 3 из 5 · итог — после ответа» heads the answer sheet
                  itself — two paper objects instead of three (redesign critique 10, round 2); its marks are the
                  provisional dots of the sheet (Jury_Check item 7). Hidden on wide screens. */}
              {state.phase !== 'ready' && liveMarksOn ? (
                <div className="or-strip">
                  <p className="or-strip-count">
                    По ключевым словам:{' '}
                    <b>
                      {namedCount}
                      {'\u00a0'}из{'\u00a0'}
                      {points.length}
                    </b>{' '}
                    <span className="or-strip-fine">итог — после ответа</span>
                  </p>
                  <div className="or-strip-marks" aria-hidden="true">
                    {points.map((point) =>
                      shownNamed.has(point.id) ? (
                        <Mark key={point.id} kind="dot" seed={seedFrom(seedBase, point.id)} />
                      ) : (
                        <span key={point.id} className="or-strip-blank" />
                      ),
                    )}
                  </div>
                  <button type="button" className="sf-link" data-muted="" aria-expanded={sheetOpen} onClick={() => setSheetOpen((open) => !open)}>
                    {sheetOpen ? 'Скрыть пункты' : 'Пункты ответа'}
                  </button>
                </div>
              ) : null}
              <RubricSlots
                points={points}
                materials={rubricResponse?.rubric.materials ?? []}
                named={shownNamed}
                asked={asked}
                seed={seedBase}
                announcement={liveMarksOn ? state.announcement : ''}
                said={saidText}
              />
              {transcriptShown ? answerBody : null}
            </div>
          ) : null}
        </section>
        <section className="or-side" aria-label="Экзаменатор">
          {/* The follow-up is said once to screen readers too: the voice may fail, the text never does. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {state.phase === 'followup' && followup ? `Экзаменатор спрашивает: «${followup.question}»` : ''}
          </p>
          {side}
        </section>
      </main>
    </div>
  );
}

// ── A saved protocol, read only (contracts §7.1) ──────────────────────────────────

type ReadOnlyState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed'; message: string }
  | {
      status: 'ready';
      protocol: StoredProtocol;
      /** The exam the answer was given in (it may differ from the one in the address). */
      exam: TicketExam | null;
      /** Where «Лист экзамена» leads: that exam, or the address's exam when that one is gone. */
      sheetExamId: string;
      anchors: Record<string, string[][]>;
    };

function ReadOnlyProtocol({ examId, sessionId }: { examId: string; sessionId: string }) {
  const [view, setView] = useState<ReadOnlyState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    setView({ status: 'loading' });
    if (!isUuid(sessionId)) {
      setView({ status: 'missing' });
      return;
    }
    (async () => {
      try {
        const protocol = await loadOralSession(sessionId);
        if (!active) return;
        if (!protocol) {
          setView({ status: 'missing' });
          return;
        }
        // History is kept by question text across exams: a «Зачёт» and an «Экзамен» with the same
        // question share it, so the protocol may belong to another exam than the address says.
        const ownerId = isUuid(protocol.examId) ? protocol.examId : examId;
        const [owner, anchors] = await Promise.all([
          loadExam(ownerId).then(
            (exam) => ({ exam, gone: exam === null }),
            () => ({ exam: null, gone: false }),
          ),
          loadRubricAnchors(protocol.rubricId),
        ]);
        if (!active) return;
        setView({ status: 'ready', protocol, exam: owner.exam, sheetExamId: owner.gone ? examId : ownerId, anchors });
      } catch (error) {
        if (active) setView({ status: 'failed', message: error instanceof Error ? error.message : 'Не удалось загрузить протокол.' });
      }
    })();
    return () => {
      active = false;
    };
  }, [examId, sessionId, attempt]);

  // The exam's title as it is now, or as it was when the answer was saved (exam_sessions.subject).
  const course = view.status === 'ready' ? subjectOf(view.exam?.title || view.protocol.subject || '') : '';
  // The saved grade against today's formula: like a fresh protocol, or with the rule of that day.
  const graded = view.status === 'ready' ? storedGrade(view.protocol) : { result: gradeAnswer([], null), note: null };
  const date = view.status === 'ready' ? view.protocol.completedAt : null;
  const sheetPath = `/exams/${view.status === 'ready' ? view.sheetExamId : examId}`;
  const sheetLink = (
    <button type="button" className="sf-link or-sheet-link" data-muted="" onClick={() => navigate(sheetPath)}>
      <ArrowLeft className="or-back-icon" aria-hidden="true" strokeWidth={1.75} />
      Лист экзамена
    </button>
  );

  return (
    <div className="or-shell">
      <RoomBar
        course={course}
        where={date ? `протокол ответа, ${longDateTime(date)}` : 'протокол ответа'}
        short="Протокол"
        onLeave={(to) => navigate(to)}
        right={sheetLink}
        backOnPhone
      />
      {view.status === 'ready' ? (
        <main className="sf-page or-room" data-phase="protocol">
          <h1 className="sr-only or-sr-title">
            {view.protocol.question ? `Протокол ответа на вопрос «${view.protocol.question}»` : 'Протокол ответа'}
          </h1>
          <section className="or-left" aria-label="Пункты ответа и ответ">
            <ProtocolSheet
              heading={`Ответ от ${shortDateTime(view.protocol.completedAt)}`}
              points={storedPoints(view.protocol, view.anchors)}
              followup={
                view.protocol.followup
                  ? {
                      pointId: view.protocol.followup.point_id,
                      question: view.protocol.followup.question,
                      answer: view.protocol.followup.student_quote,
                      status: view.protocol.followup.status,
                    }
                  : null
              }
              stamp={stampFor(view.protocol.grade)}
              seed={view.protocol.sessionId}
            />
          </section>
          <section className="or-side" aria-label="Оценка">
            <p className="or-readonly-note">{`Ответ от ${shortDateTime(view.protocol.completedAt)}. Протокол только для чтения.`}</p>
            <ProtocolGrade result={graded.result} note={graded.note}>
              <div className="or-acts" data-wide="">
                <button type="button" className="sf-link" onClick={() => navigate(sheetPath)}>
                  Лист экзамена
                </button>
              </div>
            </ProtocolGrade>
          </section>
        </main>
      ) : (
        <main className="sf-page or-room or-room-single">
          {view.status === 'loading' ? (
            <p className="or-message or-message-muted" role="status">
              Загружаем протокол…
            </p>
          ) : (
            <div className="or-state">
              <h1 className="or-state-title">{view.status === 'missing' ? 'Протокол не найден' : 'Не удалось загрузить протокол'}</h1>
              {view.status === 'failed' ? <p className="or-state-text">{view.message}</p> : null}
              <div className="or-acts">
                {view.status === 'failed' ? (
                  <button type="button" className="sf-link" onClick={() => setAttempt((value) => value + 1)}>
                    Повторить
                  </button>
                ) : null}
                <Link className="sf-link" to={`/exams/${examId}`}>
                  Лист экзамена
                </Link>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
