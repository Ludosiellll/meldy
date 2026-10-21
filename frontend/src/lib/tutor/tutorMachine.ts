/**
 * «Поговорить о лекции» as one state machine (notes: 10_Project/Voice_Tutor_Spec_2026-10-05):
 *
 *   loading → start (the start card) → speaking (the tutor's line on screen, its voice playing, the
 *   microphone closed) → idle (the pill «Отвечать») → listening («Готово») → recognising (the last
 *   words) → thinking (the server) → speaking → …
 *
 * typing is the same turn in writing (the field and «Готово»); error keeps what was said for
 * «Повторить»; ended is the summary. The cards are asked in the order the server gives, at most
 * MAX_CARDS a session. Each card starts at rung 0 with its own question (no server call); the
 * server's move decides what follows: a closed card (done) moves on with «Дальше.» and the next
 * question, or ends the conversation; an open one stays, at the rung the server returned. A question
 * of the student's own («Спросить») is answered and the card's question asked again; the card's
 * rung does not change.
 *
 * What the voice says is state too (speech: an id and the parts): the page plays it and reports
 * back with spoken / speech_failed for that id. Pure: no timers, no network, no audio.
 */
import type { TutorFragment, TutorHistoryLine, TutorTarget, TutorTurnResponse } from '../../api/tutor';
import { plural } from '../oral/format';

export const MAX_CARDS = 4;
/** Lines of the conversation sent with a turn (the server keeps the last four as well). */
export const HISTORY_LINES = 4;
/** Two failed lines in a row and the voice rests for the session: the lines stay on screen. */
export const VOICE_FAILURES_TO_GIVE_UP = 2;

// ── The tutor's own lines (code, never the model) ──────────────────────────────────

export const NEXT_LINE = 'Дальше.';
export const BACK_LINE = 'Вернёмся к вопросу.';
export const LAST_LINE = 'На этом всё.';
/** Said from the cache 700 ms into a wait for the server. */
export const FILLER_LINE = 'Так…';
export const NOT_HEARD_LINE = 'Не расслышала. Повторите, пожалуйста.';
/** «Не знаю» is an answer: the server climbs the same ladder of hints. */
export const DONT_KNOW_ANSWER = 'не знаю';

/** The lines the server says word for word (backend/tutor.py): cached ahead like the code's own. */
export const SERVER_LINES = ['Вот как сказано в лекции. Скажите своими словами.', 'Это не по лекции. Вернёмся к вопросу.', 'В лекции об этом не сказано.'];

export type NoticeKind =
  | 'not_heard'
  | 'not_heard_again'
  | 'empty'
  | 'mic_denied'
  | 'mic_missing'
  | 'no_voice_input'
  | 'recognition_failed'
  | 'voice_failed'
  | 'fix';

export const NOTICE_TEXT: Record<Exclude<NoticeKind, 'fix'>, string> = {
  not_heard: NOT_HEARD_LINE,
  not_heard_again: 'Ничего не слышно. Проверьте, какой микрофон выбран (значок слева от адреса), или ответьте текстом.',
  empty: 'Напишите ответ или нажмите «Не знаю».',
  mic_denied: 'Микрофон запрещён для этого сайта. Нажмите значок слева от адреса, разрешите микрофон и обновите страницу. Пока можно отвечать текстом.',
  mic_missing: 'Микрофон не найден. Подключите его или ответьте текстом.',
  no_voice_input: 'В этом браузере голосовой ввод недоступен — ответьте текстом.',
  recognition_failed: 'Не удалось распознать речь. Сказанное раньше сохранено — повторите или допишите текстом.',
  voice_failed: 'Голос не включился — реплика на экране.',
};
export const VOICE_UNAVAILABLE_LINE = 'Голос пока недоступен — реплики только текстом.';
export const SLOW_LINE = 'Отвечаю дольше обычного.';
export const RECOGNISING_LINE = 'Распознаём последние слова…';

// ── Shapes ────────────────────────────────────────────────────────────────────────

export type Phase = 'loading' | 'load_error' | 'start' | 'speaking' | 'idle' | 'listening' | 'recognising' | 'thinking' | 'typing' | 'error' | 'ended';
export type InputMode = 'voice' | 'text';
export type Rung = 0 | 1 | 2;
/** self — closed at rung 0; assisted — closed after a hint or the lecture's words; missed — explained. */
export type Outcome = 'self' | 'assisted' | 'missed';
export type EndReason = 'done' | 'left' | 'limit' | 'error';

export interface CardState {
  target: TutorTarget;
  rung: Rung;
  outcome: Outcome | null;
}

/** The lecture's own words on the desk: a quote for the reply, or the fragment nearest to a question. */
export interface Slip {
  sourceId: string;
  text: string;
  kind: 'quote' | 'nearest';
}

/** One piece of what the tutor says; the main piece is set large (the question to answer now). */
export interface Segment {
  text: string;
  main: boolean;
}

export interface TutorLine {
  id: number;
  segments: Segment[];
  slip: Slip | null;
}

export interface ProtocolRow {
  id: number;
  role: 'tutor' | 'student';
  text: string;
  /** The student's own question («Спросить»). */
  question: boolean;
  slip: Slip | null;
}

/** What the voice says now: the page plays it and answers with spoken / speech_failed for this id. */
export interface Speech {
  id: number;
  parts: string[];
}

export interface PendingTurn {
  kind: 'answer' | 'question';
  utterance: string;
  targetId: string;
  rung: Rung;
  history: TutorHistoryLine[];
}

export interface Notice {
  kind: NoticeKind;
  text: string;
}

/** limit — the day's units; busy — 429/5xx/timeout; offline; restart — the card is gone (409); other — the server's words. */
export type TurnErrorKind = 'limit' | 'busy' | 'offline' | 'restart' | 'other';

export interface TurnError {
  kind: TurnErrorKind | 'fix';
  message: string;
}

export interface TutorState {
  phase: Phase;
  title: string;
  loadError: string | null;
  /** «Повторить» helps (the server was busy or unreachable); not for no text, no cards, not found. */
  loadRetry: boolean;
  /** Bumps with every load of the session (the page's effect keys on it). */
  loads: number;
  /** Every card the server gave (up to eight): «Продолжить разговор» takes the next ones from here. */
  pool: TutorTarget[];
  /** Cards whose question was asked during this visit, in order. */
  asked: string[];
  /** How the student answers: the microphone or the field. */
  mode: InputMode;
  /** The tutor's voice is wanted («Без звука» turns it off; the page remembers the choice). */
  voiceOn: boolean;
  /** Lines failed to sound VOICE_FAILURES_TO_GIVE_UP times in a row: no more tries this session. */
  voiceBroken: boolean;
  voiceFailures: number;
  cards: CardState[];
  index: number;
  line: TutorLine | null;
  speech: Speech | null;
  protocol: ProtocolRow[];
  typed: string;
  /** «Спросить»: the next reply goes to the server as a question of the student's own. */
  asking: boolean;
  pending: PendingTurn | null;
  /** Bumps with every request (a reply sent, «Повторить»): late answers of an older one are ignored. */
  turn: number;
  slow: boolean;
  fillerPlayed: boolean;
  notice: Notice | null;
  /** «Готово» with nothing heard, in a row. */
  emptyInRow: number;
  error: TurnError | null;
  startedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  nextId: number;
}

export type TutorAction =
  | { type: 'loaded'; title: string; targets: TutorTarget[] }
  | { type: 'load_failed'; message: string; retry: boolean }
  | { type: 'reload' }
  | { type: 'begin'; mode: InputMode; now: number }
  | { type: 'continue'; now: number }
  | { type: 'spoken'; speech: number; played: boolean }
  | { type: 'speech_failed'; speech: number }
  | { type: 'voice'; on: boolean }
  | { type: 'repeat' }
  | { type: 'listen' }
  | { type: 'recognise' }
  | { type: 'heard'; text: string }
  | { type: 'mic_failed'; kind: 'denied' | 'missing' | 'unsupported' | 'failed'; text?: string }
  | { type: 'mode'; mode: InputMode; text?: string }
  | { type: 'typed'; text: string }
  | { type: 'submit' }
  | { type: 'dont_know' }
  | { type: 'ask'; on: boolean }
  | { type: 'reply'; turn: number; response: TutorTurnResponse; now: number }
  | { type: 'failed'; turn: number; error: TurnError }
  | { type: 'retry' }
  | { type: 'slow'; turn: number }
  | { type: 'filler'; turn: number }
  | { type: 'notice'; notice: Notice | null }
  | { type: 'finish'; now: number };

// ── Small helpers ─────────────────────────────────────────────────────────────────

export function initialTutorState(options: { voiceOn?: boolean } = {}): TutorState {
  return {
    phase: 'loading',
    title: '',
    loadError: null,
    loadRetry: false,
    loads: 0,
    pool: [],
    asked: [],
    mode: 'voice',
    voiceOn: options.voiceOn ?? true,
    voiceBroken: false,
    voiceFailures: 0,
    cards: [],
    index: 0,
    line: null,
    speech: null,
    protocol: [],
    typed: '',
    asking: false,
    pending: null,
    turn: 0,
    slow: false,
    fillerPlayed: false,
    notice: null,
    emptyInRow: 0,
    error: null,
    startedAt: null,
    endedAt: null,
    endReason: null,
    nextId: 1,
  };
}

export function voiceActive(state: TutorState): boolean {
  return state.voiceOn && !state.voiceBroken;
}

/** The student's turn without a request in flight: «Отвечать», «Текстом», «Не знаю», «Спросить». */
export function inTurn(state: TutorState): boolean {
  return state.phase === 'speaking' || state.phase === 'idle' || state.phase === 'listening' || state.phase === 'typing';
}

export function currentCard(state: TutorState): CardState | null {
  return state.cards[state.index] ?? null;
}

/** Letters or digits: «Готово» with only noise or punctuation heard nothing. */
export function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function turnPhase(mode: InputMode): Phase {
  return mode === 'text' ? 'typing' : 'idle';
}

function notice(kind: Exclude<NoticeKind, 'fix'>): Notice {
  return { kind, text: NOTICE_TEXT[kind] };
}

function clampRung(value: number): Rung {
  return value >= 2 ? 2 : value >= 1 ? 1 : 0;
}

export function lineText(line: Pick<TutorLine, 'segments'>): string {
  return line.segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
}

export function partsOf(line: Pick<TutorLine, 'segments'>): string[] {
  return line.segments.map((segment) => segment.text.trim()).filter(Boolean);
}

/** The last HISTORY_LINES lines of the conversation, as the server takes them. */
export function historyOf(protocol: readonly ProtocolRow[]): TutorHistoryLine[] {
  return protocol.slice(-HISTORY_LINES).map((row) => ({ role: row.role, text: row.text }));
}

function slipOf(fragment: TutorFragment, kind: Slip['kind']): Slip {
  return { sourceId: fragment.source_id, text: fragment.text, kind };
}

/** What the tutor says when the server sent a move without words (it never should). */
function fallbackSay(move: TutorTurnResponse['move']): string {
  switch (move) {
    case 'confirm':
      return 'Верно.';
    case 'nudge':
      return 'Подумайте ещё. Что об этом говорится в лекции?';
    case 'quote':
      return SERVER_LINES[0];
    case 'explain':
      return 'Вот как это объясняется в лекции.';
    case 'redirect':
      return SERVER_LINES[1];
    case 'not_in_lecture':
      return SERVER_LINES[2];
    default:
      return 'Вот что об этом сказано в лекции.';
  }
}

/** A new line of the tutor: on screen and in the protocol at once, in the voice when it is on. */
function tell(state: TutorState, segments: Segment[], slip: Slip | null, ended = false): TutorState {
  const lineId = state.nextId;
  const line: TutorLine = { id: lineId, segments, slip };
  const voice = voiceActive(state);
  const speech: Speech | null = voice ? { id: lineId + 1, parts: partsOf(line) } : null;
  return {
    ...state,
    nextId: lineId + 2,
    line,
    speech,
    protocol: [...state.protocol, { id: lineId, role: 'tutor', text: lineText(line), question: false, slip }],
    phase: ended ? 'ended' : voice ? 'speaking' : turnPhase(state.mode),
    typed: '',
    asking: false,
    pending: null,
    slow: false,
    fillerPlayed: false,
    notice: null,
    error: null,
  };
}

/** The student's reply goes out: into the protocol at once, to the server with the four lines before it. */
function send(state: TutorState, utterance: string, kind: PendingTurn['kind']): TutorState {
  const card = currentCard(state);
  if (!card) return state;
  const text = utterance.replace(/\s+/g, ' ').trim();
  return {
    ...state,
    nextId: state.nextId + 1,
    protocol: [...state.protocol, { id: state.nextId, role: 'student', text, question: kind === 'question', slip: null }],
    pending: { kind, utterance: text, targetId: card.target.id, rung: card.rung, history: historyOf(state.protocol) },
    turn: state.turn + 1,
    phase: 'thinking',
    speech: null,
    typed: '',
    asking: false,
    slow: false,
    fillerPlayed: false,
    notice: null,
    emptyInRow: 0,
    error: null,
  };
}

/** A new session: the conversation starts over; the voice settings, the input mode and the ids go on. */
function fresh(state: TutorState): TutorState {
  const base = initialTutorState({ voiceOn: state.voiceOn });
  return { ...base, mode: state.mode, voiceBroken: state.voiceBroken, voiceFailures: state.voiceFailures, nextId: state.nextId, loads: state.loads };
}

function cardsOf(targets: readonly TutorTarget[]): CardState[] {
  return targets.slice(0, MAX_CARDS).map((target): CardState => ({ target, rung: 0, outcome: null }));
}

function noteAsked(asked: readonly string[], id: string): string[] {
  return asked.includes(id) ? [...asked] : [...asked, id];
}

// ── The reducer ───────────────────────────────────────────────────────────────────

export function tutorReducer(state: TutorState, action: TutorAction): TutorState {
  switch (action.type) {
    case 'loaded': {
      const cards = cardsOf(action.targets);
      if (cards.length === 0) return { ...fresh(state), phase: 'load_error', loadError: 'Сначала разберите лекцию: репетитор спрашивает по её карточкам.' };
      return { ...fresh(state), phase: 'start', title: action.title, pool: action.targets.slice(), cards };
    }
    case 'load_failed':
      return state.phase === 'loading' ? { ...state, phase: 'load_error', loadError: action.message, loadRetry: action.retry } : state;
    case 'reload':
      // After a lost card (409) as well: the server reads the lecture and its cards again.
      return state.phase === 'load_error' || state.phase === 'error' ? { ...fresh(state), phase: 'loading', loads: state.loads + 1 } : state;
    case 'begin': {
      if (state.phase !== 'start') return state;
      const first = state.cards[0];
      if (!first) return state;
      return tell(
        { ...state, mode: action.mode, index: 0, startedAt: action.now, asked: noteAsked(state.asked, first.target.id) },
        [{ text: first.target.question, main: true }],
        null,
      );
    }
    case 'continue': {
      // «Продолжить разговор»: the cards not asked yet in this visit, or all of them again; no request,
      // so the tap itself starts the voice.
      if (state.phase !== 'ended' || state.pool.length === 0) return state;
      const left = state.pool.filter((target) => !state.asked.includes(target.id));
      const targets = left.length > 0 ? left : state.pool;
      const next: TutorState = {
        ...fresh(state),
        phase: 'start',
        title: state.title,
        pool: state.pool,
        asked: left.length > 0 ? state.asked : [],
        cards: cardsOf(targets),
      };
      return tutorReducer(next, { type: 'begin', mode: state.mode, now: action.now });
    }
    case 'spoken': {
      if (!state.speech || state.speech.id !== action.speech) return state;
      const next = { ...state, speech: null, voiceFailures: action.played ? 0 : state.voiceFailures };
      return state.phase === 'speaking' ? { ...next, phase: turnPhase(state.mode) } : next;
    }
    case 'speech_failed': {
      if (!state.speech || state.speech.id !== action.speech) return state;
      const failures = state.voiceFailures + 1;
      const broken = failures >= VOICE_FAILURES_TO_GIVE_UP;
      // Given up: the line «Голос пока недоступен» comes from voiceBroken, not from a notice. «Не расслышала»
      // stays on screen when it was its own voice that failed.
      const kept = state.notice?.kind === 'not_heard' ? state.notice : null;
      const next = { ...state, speech: null, voiceFailures: failures, voiceBroken: broken, notice: kept ?? (broken ? null : notice('voice_failed')) };
      return state.phase === 'speaking' ? { ...next, phase: turnPhase(state.mode) } : next;
    }
    case 'voice': {
      if (action.on) {
        const voiceNotice = state.notice?.kind === 'voice_failed';
        return { ...state, voiceOn: true, voiceBroken: false, voiceFailures: 0, notice: voiceNotice ? null : state.notice };
      }
      const next = { ...state, voiceOn: false, speech: null };
      return state.phase === 'speaking' ? { ...next, phase: turnPhase(state.mode) } : next;
    }
    case 'repeat': {
      if (!state.line || !voiceActive(state)) return state;
      if (!(inTurn(state) || state.phase === 'ended')) return state;
      return {
        ...state,
        nextId: state.nextId + 1,
        speech: { id: state.nextId, parts: partsOf(state.line) },
        phase: state.phase === 'ended' ? 'ended' : 'speaking',
        notice: state.notice?.kind === 'voice_failed' ? null : state.notice,
      };
    }
    case 'listen': {
      if (!(state.phase === 'speaking' || state.phase === 'idle' || state.phase === 'typing')) return state;
      return { ...state, phase: 'listening', mode: 'voice', speech: null, notice: null };
    }
    case 'recognise':
      return state.phase === 'listening' ? { ...state, phase: 'recognising' } : state;
    case 'heard': {
      if (state.phase !== 'listening' && state.phase !== 'recognising') return state;
      if (hasWords(action.text)) return send(state, action.text, state.asking ? 'question' : 'answer');
      const empty = state.emptyInRow + 1;
      if (empty === 1 && voiceActive(state)) {
        // «Не расслышала» is said aloud; the question stays on the card.
        return { ...state, emptyInRow: 1, notice: notice('not_heard'), phase: 'speaking', speech: { id: state.nextId, parts: [NOT_HEARD_LINE] }, nextId: state.nextId + 1 };
      }
      return { ...state, emptyInRow: empty, notice: notice(empty === 1 ? 'not_heard' : 'not_heard_again'), phase: 'idle', speech: null };
    }
    case 'mic_failed': {
      const hearing = state.phase === 'listening' || state.phase === 'recognising';
      if (action.kind === 'failed') {
        // Words said before stay (the page keeps them); the student repeats or finishes in writing.
        return { ...state, notice: notice('recognition_failed'), phase: hearing ? 'idle' : state.phase };
      }
      const kind = action.kind === 'denied' ? 'mic_denied' : action.kind === 'missing' ? 'mic_missing' : 'no_voice_input';
      return {
        ...state,
        mode: 'text',
        typed: action.text ?? state.typed,
        notice: notice(kind),
        phase: hearing || state.phase === 'idle' ? 'typing' : state.phase,
      };
    }
    case 'mode': {
      if (state.phase === 'loading' || state.phase === 'load_error' || state.phase === 'ended') return state;
      if (action.mode === 'text') {
        const typed = action.text ?? state.typed;
        const turned = state.phase === 'listening' || state.phase === 'recognising' || state.phase === 'idle';
        return { ...state, mode: 'text', typed, phase: turned ? 'typing' : state.phase };
      }
      return { ...state, mode: 'voice', phase: state.phase === 'typing' ? 'idle' : state.phase };
    }
    case 'typed':
      return { ...state, typed: action.text, notice: state.notice?.kind === 'empty' ? null : state.notice };
    case 'submit': {
      if (state.mode !== 'text' || !(state.phase === 'typing' || state.phase === 'speaking')) return state;
      if (!hasWords(state.typed)) return { ...state, notice: notice('empty') };
      return send(state, state.typed, state.asking ? 'question' : 'answer');
    }
    case 'dont_know': {
      if (!(inTurn(state) || state.phase === 'recognising')) return state;
      return send(state, DONT_KNOW_ANSWER, 'answer');
    }
    case 'ask':
      return inTurn(state) || state.phase === 'recognising' ? { ...state, asking: action.on } : state;
    case 'reply': {
      if (state.phase !== 'thinking' || !state.pending || action.turn !== state.turn) return state;
      const response = action.response;
      const card = currentCard(state);
      if (!card) return state;
      const say = response.say.trim() || fallbackSay(response.move);
      if (state.pending.kind === 'question') {
        // Answered (or not in the lecture): the card's question again, at the rung it had.
        const slip = response.quote ? slipOf(response.quote, 'quote') : response.nearest ? slipOf(response.nearest, 'nearest') : null;
        return tell(
          state,
          [
            { text: say, main: false },
            { text: BACK_LINE, main: false },
            { text: card.target.question, main: true },
          ],
          slip,
        );
      }
      const slip = response.quote ? slipOf(response.quote, 'quote') : null;
      if (response.done) {
        const outcome: Outcome = response.move === 'explain' ? 'missed' : response.assisted ? 'assisted' : 'self';
        const cards = state.cards.map((item, index) => (index === state.index ? { ...item, outcome, rung: clampRung(response.rung) } : item));
        const next = cards[state.index + 1];
        if (next) {
          return tell(
            { ...state, cards, index: state.index + 1, asked: noteAsked(state.asked, next.target.id) },
            [
              { text: say, main: false },
              { text: NEXT_LINE, main: false },
              { text: next.target.question, main: true },
            ],
            slip,
          );
        }
        return tell(
          { ...state, cards, endReason: 'done', endedAt: action.now },
          [
            { text: say, main: true },
            { text: LAST_LINE, main: false },
          ],
          slip,
          true,
        );
      }
      const cards = state.cards.map((item, index) => (index === state.index ? { ...item, rung: clampRung(response.rung) } : item));
      // Off topic: the server's «Вернёмся к вопросу», then the question itself.
      const segments: Segment[] =
        response.move === 'redirect'
          ? [
              { text: say, main: false },
              { text: card.target.question, main: true },
            ]
          : [{ text: say, main: true }];
      return tell({ ...state, cards }, segments, slip);
    }
    case 'failed': {
      if (state.phase !== 'thinking' || !state.pending || action.turn !== state.turn) return state;
      if (action.error.kind === 'fix') {
        // The server refused the words themselves (too long): they go back into the field to be shortened.
        const last = state.protocol[state.protocol.length - 1];
        const protocol = last && last.role === 'student' ? state.protocol.slice(0, -1) : state.protocol;
        return {
          ...state,
          protocol,
          phase: 'typing',
          mode: 'text',
          typed: state.pending.utterance,
          asking: state.pending.kind === 'question',
          pending: null,
          notice: { kind: 'fix', text: action.error.message },
          slow: false,
        };
      }
      return { ...state, phase: 'error', error: action.error, slow: false };
    }
    case 'retry': {
      if (state.phase !== 'error' || !state.pending || !state.error) return state;
      if (state.error.kind === 'limit' || state.error.kind === 'restart') return state;
      return { ...state, phase: 'thinking', error: null, turn: state.turn + 1, slow: false, fillerPlayed: false };
    }
    case 'slow':
      return state.phase === 'thinking' && action.turn === state.turn ? { ...state, slow: true } : state;
    case 'filler':
      return state.phase === 'thinking' && action.turn === state.turn ? { ...state, fillerPlayed: true } : state;
    case 'notice':
      return { ...state, notice: action.notice };
    case 'finish': {
      if (state.phase === 'loading' || state.phase === 'load_error' || state.phase === 'start' || state.phase === 'ended') return state;
      const endReason: EndReason = state.phase === 'error' ? (state.error?.kind === 'limit' ? 'limit' : 'error') : 'left';
      return { ...state, phase: 'ended', endReason, endedAt: action.now, speech: null, pending: null, line: null, notice: null, asking: false };
    }
    default:
      return state;
  }
}

// ── What the screen says ──────────────────────────────────────────────────────────

/** «S04» → 4. */
export function fragmentNumber(sourceId: string): number | null {
  const match = /^S0*(\d{1,4})$/.exec(sourceId.trim());
  return match ? Number(match[1]) : null;
}

/**
 * «Из лекции, фрагмент 4»; the nearest fragment, found by the words of the question (tutor.pick_fragments), says so
 * in plain words (owner 21.10): «Больше всего слов из вопроса во фрагменте 4».
 */
export function slipCaption(slip: Slip): string {
  const number = fragmentNumber(slip.sourceId);
  if (slip.kind === 'nearest') return number !== null ? `Больше всего слов из вопроса во фрагменте ${number}` : 'Больше всего слов из вопроса в этом месте лекции';
  return number !== null ? `Из лекции, фрагмент ${number}` : 'Из лекции';
}

/**
 * What the fragment panel says over the whole fragment of the desk: why the nearest one is there; nothing over the
 * lecture's own words (the desk's caption «Из лекции, фрагмент 4» already said it).
 */
export function slipPanelNote(slip: Slip): string | undefined {
  return slip.kind === 'nearest' ? 'Здесь в лекции больше всего слов из вопроса.' : undefined;
}

/** The main text by its length: 40 / 32 / 26 / 22 px on a computer (oral.css steps, one more for explanations). */
export type LineSize = 'l' | 'm' | 's' | 'xs';

export function lineSize(text: string): LineSize {
  const length = text.trim().length;
  if (length <= 90) return 'l';
  if (length <= 140) return 'm';
  if (length <= 240) return 's';
  return 'xs';
}

/**
 * The voice goes sentence by sentence: the first one sounds sooner, the rest load meanwhile. A short
 * word before a dot («т.», «др.», an initial) is an abbreviation, not an end. No lookbehind (Safari < 16.4).
 */
export function sentences(text: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    current = current ? `${current} ${word}` : word;
    const bare = word.replace(/["»”’)\]]+$/, '');
    const ends = /[.!?…]$/.test(bare);
    const abbreviation = /^(?:[а-яёa-z]{1,2}|[А-ЯЁA-Z])\.$/.test(bare);
    if (ends && !abbreviation) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out;
}

export interface Tally {
  /** Cards closed in this session. */
  cards: number;
  self: number;
  assisted: number;
  missed: number;
}

export function tally(state: Pick<TutorState, 'cards'>): Tally {
  const result: Tally = { cards: 0, self: 0, assisted: 0, missed: 0 };
  for (const card of state.cards) {
    if (!card.outcome) continue;
    result.cards += 1;
    result[card.outcome] += 1;
  }
  return result;
}

/** The fragments of the cards closed with help or explained, by number, each once. */
export function rereadFragments(state: Pick<TutorState, 'cards'>): number[] {
  const numbers = new Set<number>();
  for (const card of state.cards) {
    if (card.outcome !== 'assisted' && card.outcome !== 'missed') continue;
    for (const fragment of card.target.fragments) {
      const number = fragmentNumber(fragment.source_id);
      if (number !== null) numbers.add(number);
    }
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

/** «фрагмент 4», «фрагменты 4 и 7», «фрагменты 4, 7 и 9». */
export function fragmentsWord(numbers: readonly number[]): string {
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return `фрагмент ${numbers[0]}`;
  return `фрагменты ${numbers.slice(0, -1).join(', ')} и ${numbers[numbers.length - 1]}`;
}

/** «3 мин.», «меньше минуты». */
export function talkTime(ms: number): string {
  if (!(ms >= 60_000)) return 'меньше минуты';
  return `${Math.round(ms / 60_000)} мин.`;
}

export interface Summary {
  /** «Поговорили 3 мин.» */
  title: string;
  /** «Сами: 2. С подсказкой: 1.» (+ «Не вспомнили: 1.» when there are such cards). */
  counts: string;
  /** «Перечитайте: фрагменты 4 и 7.» or null when every card was answered alone. */
  reread: string | null;
}

export function summaryOf(state: Pick<TutorState, 'cards' | 'startedAt' | 'endedAt'>, now: number): Summary {
  const counts = tally(state);
  const length = (state.endedAt ?? now) - (state.startedAt ?? now);
  const time = talkTime(length);
  const numbers = rereadFragments(state);
  return {
    title: `Поговорили ${time}${time.endsWith('.') ? '' : '.'}`,
    counts: `Сами: ${counts.self}. С подсказкой: ${counts.assisted}.${counts.missed > 0 ? ` Не вспомнили: ${counts.missed}.` : ''}`,
    reread: numbers.length > 0 ? `Перечитайте: ${fragmentsWord(numbers)}.` : null,
  };
}

/** «4 вопроса по карточкам лекции» on the start card. */
export function questionsWord(count: number): string {
  return `${count} ${plural(count, 'вопрос', 'вопроса', 'вопросов')}`;
}
