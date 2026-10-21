/**
 * The «занятие» in chat (spec §4.3–§4.4, §4.8; decisions 10–18): the router's `SessionPort` — `start` («Начать»,
 * «Только ошибки», «Ещё 20 новых», a record's «Ещё 20 вопросов» / «Дальше: …»: `go|<cid>|<mode>`), `press` (every
 * `s|<sid>|<pos>|<act>`), `text` (a typed short answer). supabase/functions/telegram/index.ts puts it in `ports`
 * as `session`.
 *
 * Order of work for a press (spec §6.1): the database call → `answerCallbackQuery` → one edit. Telegram sends one
 * press of a user at a time and T5's SQL locks the session row, so edits do not race; a press that comes again (a
 * double tap, a replayed update, «Повторить») finds the question answered (`repeat`) or an old position (`old`): the
 * first one wins.
 *
 * - The database is T5's (CONTRACT_T5.md, migration 20261010120003_telegram_bot_sessions.sql), reached through T2's
 *   `rpc()`; `sessionApi` below is the only place that knows its JSON. The user is always the Telegram user's link,
 *   owner, position and range are checked in SQL, the key comes only with an answered question's review.
 * - What TypeScript computes (the copied session.ts): the queue (seed = sid), every question's option order
 *   (`optionOrder`, seed `<sid>:<pos>`, from `bot_session_items`), the classes, `afterAnswer` after a miss.
 * - The plan is T2's seam (card.ts `dayView`): today.ts takes the block to start and the rest of the day from it.
 * - A card that becomes a session is marked `used` first (`bot_card_sent`), or the night's close would delete it.
 * - Every message is HTML from render.ts / summary.ts, sent and edited through tg.ts (`send()` has `protect_content`).
 *   «message to edit not found» → the same screen as a new message; the session follows it (`bot_session_move`).
 */
import { encode, SID_RE, type GoMode, type SessionAct } from './codec.ts';
import { dayCard, planInputOf } from './card.ts';
import { DbError, type BotDb, type Link, type Today } from './db.ts';
import { transient } from './ledger.ts';
import type { Ctx, SessionCallback, SessionPort, Tap } from './router.ts';
import { edit, editKeyboard, remove, send, type InlineKeyboardMarkup, type Keyboard, type Out, type TgMessage } from './tg.ts';
import * as W from './words.ts';
import type { PlanCls, PlanInput } from '../plan/container.ts';
import { countableFrom } from '../plan/rule.ts';
import { TIME_STEP_MIN } from '../plan/plan.ts';
import { clockText, localDay } from '../plan/time.ts';
import {
  counterAt, fileOptionsOf, isMarked, MAX_OPTIONS, orderFor, requeueAfterMiss, shortNorm, typedAnswer, validMask,
  type ItemKind, type QuestionItem, type QueueEntry,
} from './question.ts';
import {
  examGoneOut, fitsTelegram, headerText, movedOut, questionKeyboard, questionOut, retryOut, reviewOut, rightToast, S,
  shortRightOut, type QuestionView, type Shown,
} from './render.ts';
import { summaryOut, type RestOfDay, type SessionCounts } from './summary.ts';
import { buildTopics, closedSince, topicClosedLine } from '../plan/topics.ts';
import { comesBackOn, comesBackText, examOf, firstCountText, pickBlock, restOfDay, type Block, type SessionKind } from './today.ts';

// ─────────────────────────────────────────── T5's functions: shapes ───────────────────────────────────────────

/** CONTRACT_T5 «Statuses». */
export type Status =
  | 'ok' | 'repeat' | 'old' | 'not_found' | 'ended' | 'unavailable' | 'unlinked' | 'invalid' | 'no_question' | 'conflict' | 'empty';

const STATUSES: readonly Status[] = ['ok', 'repeat', 'old', 'not_found', 'ended', 'unavailable', 'unlinked', 'invalid', 'no_question', 'conflict', 'empty'];

/** SESSION of CONTRACT_T5, as the function reads it. */
export interface SessionRow {
  sid: string;
  kind: SessionKind;
  status: 'open' | 'finished' | 'abandoned';
  containerId: string;
  subjectId: string;
  examTitle: string;
  subjectTitle: string;
  role: 'owner' | 'member';
  localDay: string;
  position: number;
  queue: QueueEntry[];
  /** The current question has an answer awaiting «Дальше». */
  answered: boolean;
  chatId: number | null;
  messageId: number | null;
  createdAt: number | null;
  /** The database's clock (ms). */
  now: number | null;
  counts: SessionCounts;
  figure: SessionFigure;
}

export interface SessionFigure {
  inPlan: number | null;
  twoDays: number | null;
  /** two_days + gained − dropped (null without a start figure). */
  now: number | null;
  /** The core's state of each «right again, too early» question (rule.ts countableFrom). */
  tooEarlyStates: Array<{ streakAt: number; streakDay: string; peekDay: string | null }>;
}

/** The review of an answered question (VIEW.review): the key in shown indices. */
export interface Review {
  correct: boolean;
  dontKnow: boolean;
  /** Shown indices chosen. */
  choice: number[];
  text: string | null;
  /** Shown indices of the key. */
  key: number[];
  /** A short answer's accepted forms. */
  answers: string[];
  recorded: boolean;
  misclick: boolean;
  doubt: boolean;
  status: string | null;
  step: string | null;
}

/** VIEW of CONTRACT_T5: the current question in the shown order. */
export interface ViewData {
  pos: number;
  item: QuestionItem;
  /** order[k] = the file index shown k-th. */
  order: number[];
  retry: 0 | 1 | 2;
  review: Review | null;
}

/** ANSWER of CONTRACT_T5. */
export interface AnswerData {
  /** saved | late | duplicate | stale | gone | no_key | conflict | pending */
  status: string;
  correct: boolean;
  dontKnow: boolean;
  step: string | null;
  misclick: boolean;
  /** The figure after it: «Теперь <now> из <in_plan>». */
  figure: { inPlan: number | null; now: number | null } | null;
}

export interface Reply {
  status: Status;
  reason: string | null;
  session: SessionRow | null;
  view: ViewData | null;
  answer: AnswerData | null;
  /** start: the same card or sid again. */
  resumed: boolean;
  /** start: the open session it closed. */
  replaced: { sid: string; chatId: number | null; messageId: number | null } | null;
  /** move: the message the session left. */
  prevMessageId: number | null;
  /** unavailable: «Экзамен «…» больше недоступен». */
  examTitle: string | null;
}

export interface ItemFacts {
  id: string;
  subjectId: string;
  kind: ItemKind;
  keepOrder: boolean;
  code: boolean;
  rev: number;
  /** In the file's order. */
  options: string[];
}

export type Choice = { i: number } | { mask: number } | { text: string } | { dontKnow: true };

export interface StartArgs {
  sid: string;
  containerId: string;
  subjectId: string;
  kind: SessionKind;
  /** buildSession's questions in order: their class and their option order (file indices in display order). */
  queue: Array<{ id: string; cls: PlanCls; shown: number[] }>;
  /** The card that turns into the session; null for a new message (then `move`). */
  messageId: number | null;
  figure: { inPlan: number; twoDays: number } | null;
}

/** CONTRACT_T5 «Functions», one method each. */
export interface SessionApi {
  items(tgUserId: number, containerId: string, itemIds: string[]): Promise<{ status: Status; items: ItemFacts[] }>;
  start(tgUserId: number, args: StartArgs): Promise<Reply>;
  view(tgUserId: number, sid: string, pos: number | null): Promise<Reply>;
  /** A typed short answer passes sid and pos null. */
  answer(tgUserId: number, sid: string | null, pos: number | null, choice: Choice): Promise<Reply>;
  resolve(tgUserId: number, sid: string, pos: number, action: 'next' | 'misclick' | 'skip', queue: Array<{ id: string; retry: number; shown?: number[] }> | null): Promise<Reply>;
  finish(tgUserId: number, sid: string): Promise<Reply>;
  move(tgUserId: number, sid: string, messageId: number): Promise<Reply>;
  doubt(tgUserId: number, sid: string, pos: number): Promise<Reply>;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const ints = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)).filter((x): x is number => x !== null && Number.isInteger(x)) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const msOf = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const at = Date.parse(s);
  return Number.isFinite(at) ? at : null;
};
const count = (v: unknown) => Math.max(0, Math.round(num(v) ?? 0));
const kindOf = (v: unknown): ItemKind | null => (v === 'single' || v === 'multiple' || v === 'short' ? v : null);

function toFigure(raw: unknown): SessionFigure & { gained: number; dropped: number; started: number; tooEarly: number } {
  const f = obj(raw);
  const states = (Array.isArray(f.too_early_states) ? f.too_early_states : []).map(obj).flatMap((s) => {
    const at = msOf(s.streak_at);
    const day = str(s.streak_day);
    return at !== null && day ? [{ streakAt: at, streakDay: day.slice(0, 10), peekDay: str(s.peek_day)?.slice(0, 10) ?? null }] : [];
  });
  return {
    inPlan: num(f.in_plan), twoDays: num(f.two_days), now: num(f.now), tooEarlyStates: states,
    gained: count(f.gained), dropped: count(f.dropped), started: count(f.started), tooEarly: count(f.too_early),
  };
}

function toSession(raw: unknown): SessionRow | null {
  const r = obj(raw);
  const sid = str(r.sid);
  if (!sid || !SID_RE.test(sid)) return null;
  const c = obj(r.counts);
  const figure = toFigure(r.figure);
  const queue = (Array.isArray(r.queue) ? r.queue : []).map(obj).flatMap((e) => {
    const id = str(e.id);
    const retry = num(e.retry);
    return id ? [{ id, retry: (retry === 1 || retry === 2 ? retry : 0) as 0 | 1 | 2 }] : [];
  });
  return {
    sid,
    kind: r.kind === 'errors' || r.kind === 'extra' ? r.kind : 'plan',
    status: r.status === 'finished' || r.status === 'abandoned' ? r.status : 'open',
    containerId: str(r.container_id) ?? '',
    subjectId: str(r.subject_id) ?? '',
    examTitle: str(r.exam_title) ?? '',
    subjectTitle: str(r.subject_title) ?? '',
    role: r.role === 'owner' ? 'owner' : 'member',
    localDay: str(r.local_day)?.slice(0, 10) ?? '',
    position: Math.max(0, num(r.position) ?? 0),
    queue,
    answered: r.answered === true,
    chatId: num(r.chat_id),
    messageId: num(r.message_id),
    createdAt: msOf(r.created_at),
    now: msOf(r.now),
    counts: {
      questions: count(c.questions), right: count(c.right), wrong: count(c.wrong), dontKnow: count(c.dont_know),
      misclicks: count(c.misclick), retries: count(c.retries), skipped: count(c.skipped), doubted: count(c.doubted),
      gained: figure.gained, dropped: figure.dropped, tooEarly: figure.tooEarly, started: figure.started,
    },
    figure: { inPlan: figure.inPlan, twoDays: figure.twoDays, now: figure.now, tooEarlyStates: figure.tooEarlyStates },
  };
}

function toView(raw: unknown): ViewData | null {
  const v = obj(raw);
  const id = str(v.item_id);
  const kind = kindOf(v.kind);
  const stem = str(v.stem);
  if (!id || !kind || stem === null) return null;
  const options = kind === 'short' ? [] : strs(v.options).slice(0, MAX_OPTIONS);
  if (kind !== 'short' && options.length < 2) return null;
  const order = kind === 'short' ? [] : ints(v.order);
  const r = v.review ? obj(v.review) : null;
  const retry = num(v.retry);
  return {
    pos: Math.max(0, num(v.pos) ?? 0),
    item: {
      id,
      kind,
      stem,
      options,
      code: v.code === true,
      keepOrder: v.keep_order === true,
      fileNo: str(v.file_no) ?? '',
      position: num(v.number) ?? 0,
      topicTitle: str(v.topic_title),
      keySource: (r && str(r.key_source)) ?? 'none',
      rev: num(v.rev) ?? 1,
      keyChangedAt: r ? str(r.key_changed_at) : null,
    },
    order: order.length === options.length ? order : options.map((_, i) => i),
    retry: (retry === 1 || retry === 2 ? retry : 0) as 0 | 1 | 2,
    review: r
      ? {
          correct: r.correct === true,
          dontKnow: r.dont_know === true,
          choice: ints(r.choice),
          text: str(r.text),
          key: ints(r.key),
          answers: strs(r.answers),
          recorded: r.recorded === true,
          misclick: r.misclick === true,
          doubt: r.doubt === true,
          status: str(r.status),
          step: str(r.step),
        }
      : null,
  };
}

function toAnswer(raw: unknown): AnswerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = obj(raw);
  const f = a.figure ? obj(a.figure) : null;
  return {
    status: str(a.status) ?? '',
    correct: a.correct === true,
    dontKnow: a.dont_know === true,
    step: str(a.step),
    misclick: a.misclick === true,
    figure: f ? { inPlan: num(f.in_plan), now: num(f.now) } : null,
  };
}

/** A session call's JSON (CONTRACT_T5 «Shapes») → a Reply. */
export function toReply(raw: unknown): Reply {
  const r = obj(raw);
  const replaced = r.replaced ? obj(r.replaced) : null;
  return {
    status: STATUSES.includes(r.status as Status) ? (r.status as Status) : 'invalid',
    reason: str(r.reason),
    session: toSession(r.session),
    view: toView(r.view),
    answer: toAnswer(r.answer),
    resumed: r.resumed === true,
    replaced: replaced && str(replaced.sid) ? { sid: str(replaced.sid) as string, chatId: num(replaced.chat_id), messageId: num(replaced.message_id) } : null,
    prevMessageId: num(r.prev_message_id),
    examTitle: str(r.exam_title),
  };
}

function choiceJson(choice: Choice): Record<string, unknown> {
  if ('i' in choice) return { i: choice.i };
  if ('mask' in choice) return { mask: choice.mask };
  if ('text' in choice) return { text: choice.text };
  return { dont_know: true };
}

/** T5's functions through T2's `rpc()` (POST /rest/v1/rpc/<name>, the service role, named arguments). */
export function sessionApi(db: BotDb): SessionApi {
  const call = async (fn: `bot_${string}`, args: Record<string, unknown>) => toReply(await db.rpc(fn, args));
  return {
    async items(tg, containerId, itemIds) {
      const r = obj(await db.rpc('bot_session_items', { p_tg_user_id: tg, p_container_id: containerId, p_item_ids: itemIds }));
      const status = STATUSES.includes(r.status as Status) ? (r.status as Status) : 'invalid';
      const items = (Array.isArray(r.items) ? r.items : []).map(obj).flatMap((i): ItemFacts[] => {
        const id = str(i.id);
        const kind = kindOf(i.kind);
        if (!id || !kind) return [];
        return [{ id, subjectId: str(i.subject_id) ?? '', kind, keepOrder: i.keep_order === true, code: i.code === true, rev: num(i.rev) ?? 1, options: strs(i.options) }];
      });
      return { status, items };
    },
    start: (tg, a) => call('bot_session_start', {
      p_tg_user_id: tg, p_sid: a.sid, p_container_id: a.containerId, p_subject_id: a.subjectId, p_kind: a.kind,
      p_queue: a.queue.map((e) => ({ id: e.id, cls: e.cls, shown: e.shown })), p_message_id: a.messageId,
      p_figure: a.figure ? { in_plan: a.figure.inPlan, two_days: a.figure.twoDays } : null,
    }),
    view: (tg, sid, pos) => call('bot_session_view', { p_tg_user_id: tg, p_sid: sid, p_pos: pos }),
    answer: (tg, sid, pos, choice) => call('bot_session_answer', { p_tg_user_id: tg, p_sid: sid, p_pos: pos, p_choice: choiceJson(choice) }),
    resolve: (tg, sid, pos, action, queue) => call('bot_session_resolve', { p_tg_user_id: tg, p_sid: sid, p_pos: pos, p_action: action, p_queue: queue }),
    finish: (tg, sid) => call('bot_session_finish', { p_tg_user_id: tg, p_sid: sid }),
    move: (tg, sid, messageId) => call('bot_session_move', { p_tg_user_id: tg, p_sid: sid, p_message_id: messageId }),
    doubt: (tg, sid, pos) => call('bot_key_doubt', { p_tg_user_id: tg, p_sid: sid, p_pos: pos }),
  };
}

// ─────────────────────────────────────────── pure steps ───────────────────────────────────────────

/** A session id: 8 × [0-9a-z], also the seed of its order (spec §6.2). */
export function newSid(random: () => number = secureRandom): string {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.min(35, Math.floor(random() * 36))];
  return out;
}

function secureRandom(): number {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return bytes[0] / 4294967296;
}

/**
 * `p_queue` of `bot_session_start`: the block's questions that can be shown (with a key, of this exam), in their
 * order, each with its class and its option order at its position (seed `<sid>:<pos>`).
 */
export function startQueue(block: Block, facts: readonly ItemFacts[], sid: string): StartArgs['queue'] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: StartArgs['queue'] = [];
  block.queue.forEach((entry, i) => {
    const f = byId.get(entry.id);
    if (!f || (f.kind !== 'short' && f.options.length < 2)) return;
    out.push({ id: entry.id, cls: block.cls[i] ?? 'free', shown: orderFor({ kind: f.kind, keepOrder: f.keepOrder, options: f.options }, sid, out.length) });
  });
  return out;
}

/** The view as render.ts takes it. */
export function questionView(row: SessionRow, view: ViewData): QuestionView {
  const { n, of } = counterAt(row.queue, view.pos);
  return {
    sid: row.sid, pos: view.pos, subject: row.subjectTitle, n, of, retry: view.retry > 0, item: view.item, role: row.role,
    containerId: row.containerId, subjectId: row.subjectId,
  };
}

/** An answered question's review as render.ts takes it («Вернётся через пару вопросов» while its retry is under 2). */
export function shownOf(view: ViewData): Shown {
  const r = view.review;
  return {
    dontKnow: r?.dontKnow ?? false,
    key: r?.key ?? [],
    chosen: r?.choice ?? [],
    forms: r?.answers ?? [],
    text: r?.text ?? null,
    again: view.retry < 2,
    recorded: r?.recorded ?? false,
  };
}

/**
 * The screen of the current state (VIEW): the question, its review, «Нажали не туда?», the doubt done, a typed answer
 * right. `back`: when a mistake comes back (`backOf`), «завтра» when left out.
 */
export function screenOf(row: SessionRow, view: ViewData, site: string, mask = 0, back?: string): Out {
  const v = questionView(row, view);
  const r = view.review;
  if (!r) return questionOut(v, mask);
  if (r.correct) {
    const typed = r.text ?? '';
    const form = r.answers.find((a) => a.trim() !== '' && typed.trim() !== '' && normEq(a, typed)) ?? r.answers[0] ?? typed;
    return shortRightOut(v, form);
  }
  const stage = r.misclick ? 'misclick' : r.doubt ? 'doubted' : 'review';
  return reviewOut(v, shownOf(view), stage, { site, back });
}

/** A screen that says when the question comes back: the review of a mistake or «Не знаю», and «Нажали не туда?». */
const saysBack = (view: ViewData) => Boolean(view.review && !view.review.correct && !view.review.doubt);

const normEq = (a: string, b: string) => shortNorm(a) === shortNorm(b);

/** «Продолжить: 8 из 20» of I2 = counter(queue, position). */
export const resumeCounter = (row: SessionRow) => counterAt(row.queue, row.position);

/**
 * The keyboard after a mark of several correct answers (`t<mask>`), rebuilt from the message's own keyboard — no
 * database call: the option buttons are the ones whose data is `s|<sid>|<pos>|t…`, in shown order; each gets «✓ » by
 * `mask` and the data of its next tap; «Ответить» carries `a<mask>`. null when the keyboard is not this question's.
 */
export function remark(markup: InlineKeyboardMarkup | null | undefined, sid: string, pos: number, mask: number): Keyboard | null {
  if (!markup || !Array.isArray(markup.inline_keyboard)) return null;
  const prefix = `s|${sid}|${pos}|`;
  let k = 0;
  let found = false;
  const keyboard: Keyboard = markup.inline_keyboard.map((row) => row.map((raw) => {
    const button = obj(raw);
    const text = str(button.text) ?? '';
    const data = str(button.callback_data);
    const url = str(button.url);
    const style = button.style === 'primary' || button.style === 'danger' ? button.style : undefined;
    if (data && data.startsWith(prefix) && /^t\d+$/.test(data.slice(prefix.length))) {
      const i = k;
      k += 1;
      found = true;
      const base = text.replace(/^✓ /, '');
      return { text: isMarked(mask, i) ? `✓ ${base}` : base, data: encode({ kind: 'session', sid, pos, act: { a: 'toggle', mask: mask ^ (1 << i) } }), ...(style ? { style } : {}) };
    }
    if (data && data.startsWith(prefix) && /^a\d+$/.test(data.slice(prefix.length))) {
      return { text, data: encode({ kind: 'session', sid, pos, act: { a: 'submit', mask } }), ...(style ? { style } : {}) };
    }
    const webApp = str(obj(button.web_app).url);
    if (webApp) return { text, webApp, ...(style ? { style } : {}) };
    return url ? { text, url, ...(style ? { style } : {}) } : { text, data: data ?? '', ...(style ? { style } : {}) };
  }));
  return found && validMask(mask, k) ? keyboard : null;
}

// ─────────────────────────────────────────── the port ───────────────────────────────────────────

export interface SessionOptions {
  /** The database calls (the default maps T5's functions through `ctx.db.rpc`). */
  api?: (db: BotDb) => SessionApi;
  random?: () => number;
}

/** A failed press makes the next failure in the same chat within this window a «повторно» (§4.8: the edit with «Повторить»). */
export const RETRY_WINDOW_MS = 5 * 60_000;
/** At most this many questions in a row are left to the site (over 4096) in one update. */
const SKIP_LIMIT = 20;

/** A press may carry the message's keyboard (the callback query's `message.reply_markup`), when the router passes it. */
type TapWithMarkup = Tap & { markup?: InlineKeyboardMarkup | null; message?: { reply_markup?: InlineKeyboardMarkup } | null };

export function createSession(options: SessionOptions = {}): SessionPort {
  const apiOf = options.api ?? sessionApi;
  const random = options.random ?? secureRandom;
  /** chat → the moment a press failed on the database (this instance only: best effort). */
  const failures = new Map<number, number>();
  /** chat:message → the muted line it shows («Базы данных · 8 из 20»), for the «Повторить» edit. */
  const headers = new Map<string, string>();
  const remember = (chatId: number, messageId: number | null, header: string | null) => {
    if (!messageId || !header) return;
    if (headers.size > 2000) headers.clear();
    headers.set(`${chatId}:${messageId}`, header);
  };
  /** sid → the exam's days of the week and the student's zone (this instance only: «Начать» keeps them, `backOf` reads them). */
  const weeks = new Map<string, { weekdays: number | undefined; tz: string }>();
  const keepWeek = (sid: string, input: PlanInput) => {
    if (weeks.size > 2000) weeks.clear();
    weeks.set(sid, { weekdays: input.studyWeekdays, tz: input.tz });
  };

  /**
   * When the question of a press comes back: the exam's next study day after today («в понедельник» before a day off,
   * settings.study_weekdays), as the site's answer and the record say it. SESSION carries no days of the week: they
   * come from the plan read at «Начать», or, on an instance that did not start the session, from one bot_today read
   * (after the callback's answer). Without the plan: «завтра».
   */
  async function backOf(ctx: Ctx, tg: number, row: SessionRow): Promise<string> {
    if (!weeks.has(row.sid)) {
      const today = await ctx.db.today(tg).catch(() => null);
      try {
        if (today) keepWeek(row.sid, planInputOf(today, row.containerId));
      } catch {
        // the exam is not in the plan any more
      }
    }
    const week = weeks.get(row.sid);
    try {
      return week ? comesBackOn(localDay(row.now ?? ctx.now(), week.tz), week.weekdays) : 'завтра';
    } catch {
      return 'завтра'; // a zone the clock cannot read
    }
  }

  /** Edits the message, or sends it anew when it is gone; the session (sid) follows a new message. */
  async function put(ctx: Ctx, api: SessionApi, tg: number, chatId: number, messageId: number | null, out: Out, sid: string | null): Promise<number> {
    if (messageId) {
      const result = await edit(ctx.tg, { chatId, messageId, text: out.text, keyboard: out.keyboard });
      if (result !== 'gone') return messageId;
    }
    const sent = await send(ctx.tg, { chatId, text: out.text, keyboard: out.keyboard });
    if (sid) await api.move(tg, sid, sent.message_id).catch(() => null);
    return sent.message_id;
  }

  /** The record of a session (I1 finished, I2 stopped; `closed`: another session replaced it — no buttons). */
  async function recordOf(ctx: Ctx, tg: number, row: SessionRow, end: 'done' | 'stopped' | 'closed', read?: Today | null): Promise<Out> {
    let today: Today | null = read ?? null;
    if (read === undefined) {
      try {
        today = await ctx.db.today(tg);
      } catch {
        today = null; // the record keeps its own numbers; the plan's lines wait for /today
      }
    }
    const exam = today ? examOf(today, row.containerId) : null;
    const sameDay = Boolean(exam && exam.plan.day === row.localDay);
    const rest: RestOfDay = sameDay && end !== 'closed'
      ? restOfDay(exam, { subjectId: row.subjectId, kind: row.kind }, ctx.site)
      : { line: '', extra: [], next: null, moreNew: null, link: null };
    const figure = row.figure.now !== null && row.figure.inPlan !== null
      ? { twoDays: row.figure.now, inPlan: row.figure.inPlan }
      : sameDay && exam ? { twoDays: exam.plan.figure.twoDays, inPlan: exam.plan.figure.inPlan } : null;
    const now = row.now ?? ctx.now();
    const out = summaryOut({
      sid: row.sid,
      pos: row.position,
      subject: row.subjectTitle || (exam?.input.subjects.find((s) => s.id === row.subjectId)?.title ?? ''),
      counts: row.counts,
      questions: row.counts.questions,
      minutes: row.createdAt !== null ? Math.max(1, Math.round((now - row.createdAt) / 60_000)) : 1,
      end: end === 'done' ? 'done' : 'stopped',
      figure,
      firstCount: sameDay && figure !== null && figure.twoDays === 0 ? firstCountText(exam) : null,
      tooEarlyAt: sameDay && exam ? tooEarlyClock(row, exam.input.tz, now) : null,
      back: comesBackText(sameDay ? exam : null),
      rest,
      resume: end === 'stopped' && row.status === 'open' && row.position < row.queue.length ? resumeCounter(row) : null,
      topics: sameDay && exam && end !== 'closed' ? closedTopicsLine(row, exam.input) : null,
    });
    return end === 'closed' ? { text: out.text, keyboard: null } : out;
  }

  /** «Тема «…» выучена.»: the topics of the session's subject it closed, read from the plan after it (topics.ts). */
  function closedTopicsLine(row: SessionRow, input: PlanInput): string | null {
    if (row.createdAt === null) return null;
    try {
      const topics = buildTopics({ subjectId: row.subjectId, items: input.items, titles: null }).topics;
      const closed = closedSince(topics, new Set(row.queue.map((entry) => entry.id)), row.createdAt);
      return closed.length > 0 ? closed.map((topic) => topicClosedLine(topic)).join(' ') : null;
    } catch {
      return null;
    }
  }

  /** When the session's «right again, too early» can count: «19:00» today, or null for «завтра» (rule.ts countableFrom). */
  function tooEarlyClock(row: SessionRow, tz: string, now: number): string | null {
    let at: number | null = null;
    const today = localDay(now, tz);
    for (const s of row.figure.tooEarlyStates) {
      try {
        const from = countableFrom(s.streakAt, s.streakDay, s.peekDay, today, tz);
        at = at === null ? from : Math.max(at, from);
      } catch {
        // a broken state says nothing about the time
      }
    }
    if (at === null || at <= now || localDay(at, tz) !== today) return null;
    return clockText(at, tz, TIME_STEP_MIN);
  }

  /** Shows a record in `messageId`; a record with buttons becomes the day's last one and the earlier loses its keyboard. */
  async function showRecord(ctx: Ctx, api: SessionApi, tg: number, chatId: number, messageId: number | null, row: SessionRow, end: 'done' | 'stopped', read?: Today | null): Promise<void> {
    const out = await recordOf(ctx, tg, row, end, read);
    const id = await put(ctx, api, tg, chatId, messageId, out, null);
    if (out.keyboard && out.keyboard.length > 0) {
      const prev = await ctx.db.cardSent(tg, id, 'last').catch(() => ({ prevMessageId: null }));
      if (prev.prevMessageId !== null && prev.prevMessageId !== id) {
        await editKeyboard(ctx.tg, { chatId, messageId: prev.prevMessageId, keyboard: null }).catch(() => undefined);
      }
    }
  }

  /**
   * Shows where a session stands (a reply's `session` and `view`): its record when it is done (I1), else the current
   * screen. A question longer than a Telegram message is left to the site (`skip`, counted for the record).
   */
  async function show(ctx: Ctx, api: SessionApi, tg: number, chatId: number, messageId: number | null, reply: Reply, mask = 0): Promise<number | null> {
    let r = reply;
    for (let guard = 0; guard <= SKIP_LIMIT; guard += 1) {
      const row = r.session;
      if (!row) return messageId;
      if (row.status !== 'open' || !r.view) {
        await showRecord(ctx, api, tg, chatId, messageId, row, 'done');
        return messageId;
      }
      const view = r.view;
      if (!view.review && !fitsTelegram(questionView(row, view), { site: ctx.site }) && guard < SKIP_LIMIT) {
        const next = await api.resolve(tg, row.sid, view.pos, 'skip', null);
        if (next.status !== 'ok' || !next.session) return messageId;
        r = next;
        continue;
      }
      const out = screenOf(row, view, ctx.site, mask, saysBack(view) ? await backOf(ctx, tg, row) : undefined);
      const header = headerText(questionView(row, view));
      remember(chatId, messageId, header);
      const id = await put(ctx, api, tg, chatId, messageId, out, row.sid);
      remember(chatId, id, header);
      return id;
    }
    return messageId;
  }

  /** The answer of §4.8 to a refused press (or a re-render of the current state when the press is this message's). */
  async function refused(ctx: Ctx, api: SessionApi, tap: Tap, r: Reply): Promise<void> {
    const row = r.session;
    const here = Boolean(row && tap.messageId !== null && (row.messageId === tap.messageId || row.messageId === null));
    switch (r.status) {
      case 'unlinked':
        return tap.answer(W.NOT_LINKED);
      case 'unavailable':
        await tap.answer();
        if (tap.messageId) await put(ctx, api, tap.tgUserId, tap.chatId, tap.messageId, examGoneOut(r.examTitle ?? row?.examTitle ?? ''), null);
        return;
      case 'ended':
        if (here && row?.status === 'finished') {
          // The press was the session's last step (a double tap, «Повторить» after a lost reply): its record (I1).
          await tap.answer(r.answer && r.answer.correct && !r.answer.misclick ? S.right : undefined);
          await showRecord(ctx, api, tap.tgUserId, tap.chatId, tap.messageId, row, 'done');
          return;
        }
        await tap.answer(W.SESSION_OVER);
        // The session's own message keeps no dead buttons; another one (the /today card of several exams) keeps its own.
        if (here && tap.messageId) await editKeyboard(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, keyboard: null }).catch(() => undefined);
        return;
      case 'repeat':
        // The question is answered already (a double tap): the first answer stands; the screen shows it.
        await tap.answer();
        if (here && row?.status === 'open') await show(ctx, api, tap.tgUserId, tap.chatId, tap.messageId, r);
        return;
      case 'old':
        // An answer recorded at that position (a lost reply, «Повторить», the second tap after the first moved on):
        // where the session stands now. Nothing recorded there: an older button.
        if (r.answer !== null && here && row?.status === 'open') {
          await tap.answer(r.answer.correct && !r.answer.misclick ? S.right : undefined);
          await show(ctx, api, tap.tgUserId, tap.chatId, tap.messageId, r);
          return;
        }
        return tap.answer(W.OLD_BUTTON);
      case 'invalid':
        if (here && row?.status === 'open' && r.view) {
          await tap.answer();
          await show(ctx, api, tap.tgUserId, tap.chatId, tap.messageId, r);
          return;
        }
        return tap.answer(W.OLD_BUTTON);
      default:
        return tap.answer(W.OLD_BUTTON);
    }
  }

  /** A press whose database call failed: the line the first time (the ledger), «Повторить» the next time (§4.8). */
  async function failed(ctx: Ctx, tap: Tap, error: unknown): Promise<never> {
    if (error instanceof DbError && transient(error)) {
      const at = failures.get(tap.chatId);
      if (failures.size > 5000) failures.clear();
      failures.set(tap.chatId, ctx.now());
      if (at !== undefined && ctx.now() - at < RETRY_WINDOW_MS && tap.messageId) {
        await tap.answer();
        const out = retryOut(headers.get(`${tap.chatId}:${tap.messageId}`) ?? null, tap.data);
        await edit(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, text: out.text, keyboard: out.keyboard }).catch(() => undefined);
      }
    }
    throw error;
  }

  async function guarded(ctx: Ctx, tap: Tap, work: () => Promise<void>): Promise<void> {
    try {
      await work();
      failures.delete(tap.chatId);
    } catch (error) {
      await failed(ctx, tap, error);
    }
  }

  // ─────────────────────────── «Начать», «Только ошибки», «Ещё 20 новых», «Ещё 20 вопросов», «Дальше: …» ───────────────────────────

  async function start(ctx: Ctx, tap: Tap, go: { containerId: string; mode: GoMode }): Promise<void> {
    const api = apiOf(ctx.db);
    const tg = tap.tgUserId;
    await guarded(ctx, tap, async () => {
      // A card that turns into the session: marked used first, or the night's close would delete it.
      if (tap.messageId) await ctx.db.cardSent(tg, tap.messageId, 'used');
      const today = await ctx.db.today(tg);
      if (!today) return tap.answer(W.NOT_LINKED);
      // A record's buttons start a new message (I1); a card or M3 becomes the session.
      const fromRecord = Boolean(today.day && today.day.lastMessageId !== null && today.day.lastMessageId === tap.messageId);
      const inPlace = !fromRecord && tap.messageId !== null;
      if (fromRecord && today.session && today.session.localDay === today.link.today) {
        // The record's keyboard went when a session started from it: this is the same press again (a double tap).
        return tap.answer();
      }
      const exam = examOf(today, go.containerId);

      let reply: Reply | null = null;
      let stale = false;
      let sid = '';
      for (let attempt = 0; exam && attempt < 3 && !reply; attempt += 1) {
        sid = newSid(random);
        const block = pickBlock(exam, go.mode, sid);
        if (!block) break;
        const facts = await api.items(tg, exam.id, block.queue.map((e) => e.id));
        if (facts.status === 'unlinked') return tap.answer(W.NOT_LINKED);
        if (facts.status !== 'ok') break;
        const queue = startQueue(block, facts.items, sid);
        if (queue.length === 0) break;
        const started = await api.start(tg, {
          sid, containerId: exam.id, subjectId: block.subjectId, kind: block.kind, queue, messageId: inPlace ? tap.messageId : null,
          figure: { inPlan: exam.plan.figure.inPlan, twoDays: exam.plan.figure.twoDays },
        });
        if (started.status === 'conflict') continue; // the sid is taken: draw another
        if (started.status === 'unlinked') return tap.answer(W.NOT_LINKED);
        if (started.status === 'unavailable') {
          await tap.answer();
          await put(ctx, api, tg, tap.chatId, inPlace ? tap.messageId : null, examGoneOut(started.examTitle ?? exam.title), null);
          return;
        }
        if (started.status === 'ok' && started.session) reply = started;
        stale = started.status === 'empty';
        break;
      }
      if (!reply || !reply.session) {
        // Nothing to take (the day is done, the plan was stale, the exam is gone): the card as it stands now.
        await tap.answer();
        const fresh = stale ? await ctx.db.today(tg).catch(() => today) : today;
        const card = dayCard(fresh ?? today, 'today', ctx.site, exam ? go.containerId : null);
        if (inPlace) await put(ctx, api, tg, tap.chatId, tap.messageId, card.out, null);
        else await send(ctx.tg, { chatId: tap.chatId, text: card.out.text, keyboard: card.out.keyboard });
        return;
      }
      // The exam's days of the week, for the presses of this session (a mistake comes back on the next study day).
      if (exam) keepWeek(reply.session.sid, exam.input);
      await tap.answer();
      if (!inPlace && tap.messageId) await editKeyboard(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, keyboard: null }).catch(() => undefined);
      const shownIn = reply.session.messageId ?? (inPlace ? tap.messageId : null);
      await show(ctx, api, tg, tap.chatId, shownIn, reply);
      // The session this one replaced keeps its record (no key stays in the chat), without buttons.
      const old = reply.replaced;
      if (old && old.sid !== reply.session.sid && old.messageId && old.messageId !== shownIn) {
        const closed = await api.view(tg, old.sid, null).catch(() => null);
        if (closed?.session) {
          const out = await recordOf(ctx, tg, closed.session, 'closed', today);
          await edit(ctx.tg, { chatId: old.chatId ?? tap.chatId, messageId: old.messageId, text: out.text, keyboard: null }).catch(() => undefined);
        }
      }
    });
  }

  // ─────────────────────────── every press of a session ───────────────────────────

  async function press(ctx: Ctx, tap: Tap, cb: SessionCallback): Promise<void> {
    const api = apiOf(ctx.db);
    const tg = tap.tgUserId;
    const { sid, pos, act } = cb;
    const chatId = tap.chatId;
    const messageId = tap.messageId;

    // «Готово»: the record loses its keyboard. No database call.
    if (act.a === 'done') {
      await tap.answer();
      if (messageId) await editKeyboard(ctx.tg, { chatId, messageId, keyboard: null });
      return;
    }
    // «Ответить» with nothing marked: a line, no database call.
    if (act.a === 'submit' && act.mask === 0) return tap.answer(S.markOne);
    // A mark of several correct answers: only the keyboard changes, from the message's own (no database call).
    if (act.a === 'toggle') {
      const t = tap as TapWithMarkup;
      const keyboard = remark(t.markup ?? t.message?.reply_markup ?? null, sid, pos, act.mask);
      if (keyboard && messageId) {
        await tap.answer();
        await editKeyboard(ctx.tg, { chatId, messageId, keyboard });
        return;
      }
    }

    await guarded(ctx, tap, async () => {
      switch (act.a) {
        case 'option':
        case 'dont_know':
        case 'submit': {
          const choice: Choice = act.a === 'option' ? { i: act.i } : act.a === 'submit' ? { mask: act.mask } : { dontKnow: true };
          const r = await api.answer(tg, sid, pos, choice);
          if (r.status !== 'ok' || !r.session) return refused(ctx, api, tap, r);
          const a = r.answer;
          if (a && (a.status === 'stale' || a.status === 'gone' || a.status === 'no_key' || a.status === 'conflict')) {
            await tap.answer(a.status === 'stale' ? W.KEY_STALE : W.ITEM_GONE);
          } else if (a && a.correct) {
            const keys = act.a === 'submit' ? bits(act.mask) : 1;
            const figure = a.step === 'two_days' && a.figure && a.figure.now !== null && a.figure.inPlan !== null ? { twoDays: a.figure.now, inPlan: a.figure.inPlan } : null;
            await tap.answer(rightToast(act.a === 'submit' ? 'multiple' : 'single', keys, figure));
          } else {
            await tap.answer();
          }
          await show(ctx, api, tg, chatId, messageId, r);
          return;
        }
        case 'toggle': {
          // The router gave no keyboard to rebuild from: the question again (a read, nothing recorded).
          const r = await api.view(tg, sid, pos);
          // Answered already («Ответить» came first): the same message shows its review.
          if (r.status !== 'ok' || !r.session || !r.view || r.view.review) return refused(ctx, api, tap, r.status === 'ok' ? { ...r, status: 'repeat' } : r);
          if (r.view.item.kind !== 'multiple' || !validMask(act.mask, r.view.item.options.length)) return tap.answer();
          await tap.answer();
          const keyboard = questionKeyboard(questionView(r.session, r.view), act.mask);
          const result = messageId ? await editKeyboard(ctx.tg, { chatId, messageId, keyboard }) : 'gone';
          if (result === 'gone') await show(ctx, api, tg, chatId, null, r, act.mask);
          return;
        }
        case 'next': {
          let r = await api.resolve(tg, sid, pos, 'next', null);
          if (r.status === 'invalid' && r.reason === 'queue' && r.session && r.view) {
            // A miss that comes back: afterAnswer's queue, the repeat with its new option order.
            const fileOptions = fileOptionsOf(r.view.item.options, r.view.order) ?? r.view.item.options;
            const queue = requeueAfterMiss(r.session.queue, pos, r.session.sid, {
              id: r.view.item.id, kind: r.view.item.kind, keepOrder: r.view.item.keepOrder, fileOptions,
            });
            if (queue) r = await api.resolve(tg, sid, pos, 'next', queue);
          }
          if (r.status !== 'ok' || !r.session) return refused(ctx, api, tap, r);
          await tap.answer();
          await show(ctx, api, tg, chatId, messageId, r);
          return;
        }
        case 'misclick':
        case 'doubt_mark': {
          const r = act.a === 'misclick' ? await api.resolve(tg, sid, pos, 'misclick', null) : await api.doubt(tg, sid, pos);
          if (r.status !== 'ok' || !r.session) return refused(ctx, api, tap, r);
          await tap.answer();
          await show(ctx, api, tg, chatId, messageId, r);
          return;
        }
        case 'doubt':
        case 'doubt_back': {
          const r = await api.view(tg, sid, pos);
          if (r.status !== 'ok' || !r.session || !r.view) return refused(ctx, api, tap, r);
          if (!r.view.review || r.view.review.correct || r.view.review.misclick || r.view.review.doubt) {
            // Nothing to doubt here (no answer, a right one, already done): the screen as it stands.
            await tap.answer();
            await show(ctx, api, tg, chatId, messageId, r);
            return;
          }
          await tap.answer();
          const v = questionView(r.session, r.view);
          const back = act.a === 'doubt' ? undefined : await backOf(ctx, tg, r.session);
          const out = reviewOut(v, shownOf(r.view), act.a === 'doubt' ? 'doubt' : 'review', { site: ctx.site, back });
          remember(chatId, messageId, headerText(v));
          await put(ctx, api, tg, chatId, messageId, out, r.session.sid);
          return;
        }
        case 'finish': {
          const r = await api.finish(tg, sid);
          // Closed with nothing answered, in this message (a double tap, «Повторить» after a lost reply): as the first time.
          const unanswered = r.status === 'ended' && r.session?.status === 'abandoned' && messageId !== null && r.session.messageId === messageId
            && r.session.counts.questions + r.session.counts.retries === 0;
          if ((r.status !== 'ok' && !unanswered) || !r.session) return refused(ctx, api, tap, r);
          await tap.answer();
          const row = r.session;
          if (row.status === 'abandoned') {
            // Nothing was answered: the card again («Начать»).
            const today = await ctx.db.today(tg).catch(() => null);
            if (today) await put(ctx, api, tg, chatId, messageId, dayCard(today, 'today', ctx.site, row.containerId).out, null);
            else if (messageId) await editKeyboard(ctx.tg, { chatId, messageId, keyboard: null });
            return;
          }
          await showRecord(ctx, api, tg, chatId, messageId, row, row.status === 'finished' ? 'done' : 'stopped');
          return;
        }
        case 'continue': {
          // «Продолжить» of I2 (the same message) or of the /today card (I3): the session lives in the pressed message.
          if (!messageId) return tap.answer(W.OLD_BUTTON);
          await ctx.db.cardSent(tg, messageId, 'used');
          const r = await api.move(tg, sid, messageId);
          if (r.status !== 'ok' || !r.session) return refused(ctx, api, tap, r);
          await tap.answer();
          await show(ctx, api, tg, chatId, messageId, r);
          const prev = r.prevMessageId;
          if (prev !== null && prev !== messageId && !(await remove(ctx.tg, chatId, prev))) {
            await edit(ctx.tg, { chatId, messageId: prev, text: movedOut().text, keyboard: null }).catch(() => undefined);
          }
          return;
        }
        default:
          return tap.answer();
      }
    });
  }

  // ─────────────────────────── a typed short answer (Z5) ───────────────────────────

  async function text(ctx: Ctx, msg: TgMessage, link: Link): Promise<boolean> {
    const typed = typedAnswer(typeof msg.text === 'string' ? msg.text : '');
    if (typed === null) return false;
    const api = apiOf(ctx.db);
    const tg = link.tgUserId;
    const r = await api.answer(tg, null, null, { text: typed });
    if (r.status !== 'ok' || !r.session) return false; // no_question (S6), a second message while one waits, refusals
    await remove(ctx.tg, msg.chat.id, msg.message_id);
    await show(ctx, api, tg, msg.chat.id, r.session.messageId, r);
    return true;
  }

  return { start, press, text };
}

const bits = (mask: number) => {
  let n = 0;
  for (let m = mask; m > 0; m >>= 1) n += m & 1;
  return n;
};

/** The port the router gets (one per function instance). */
export const session: SessionPort = createSession();

/** The `s|…` data of a session button. */
export const pressData = (sid: string, pos: number, act: SessionAct) => encode({ kind: 'session', sid, pos, act });

