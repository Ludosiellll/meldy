/**
 * The router (spec §6.1, §6.5): the HTTP routes of the `telegram` function and the dispatch of one update.
 *
 * Routes: `POST /telegram` (the webhook: HMAC header → ledger → dispatch), `POST /telegram/tick` (HMAC header → 202,
 * the work in `waitUntil`), `POST /telegram/setup`, `GET /telegram/status`, `/telegram/file` for the file package, and
 * `POST /telegram/webapp/session` for the Mini App's sign-in (webapp.ts; it links nothing: linking is /start L<code>),
 * and the live game's `POST /telegram/game/join|post|sync` (game.ts).
 * Updates: `message`, `callback_query`, `my_chat_member`; `edited_message` and channel posts are ignored.
 *
 * Other packages plug in through `Ports` (one import line each in supabase/functions/telegram/index.ts):
 * - `session` (T6): «Начать» / «Только ошибки» / «Ещё 20 новых» (`go|…`), every `s|…` press, and short answers typed
 *   in a private chat;
 * - `group` (T8): `/start@bot G<code>` in a group, `/start g<id>` in private, `g|…` presses, `my_chat_member` and
 *   `migrate_to_chat_id` of groups, and the tick's steps 1, 2 and 4;
 * - `files` (T9): a document in a private chat and the `/telegram/file` route; `voice` (T10): a voice message;
 * - `monitor` (monitor.ts): the tick's step «monitor», the site's outage monitor, after the other steps;
 * - `sweep` (sweep.ts, optional): the tick's step «sweep», the pictures of deleted exams and tests, before «monitor».
 * - `quiz` (quiz.ts, optional): the tick's step «quiz», the authors' quiz messages and shares, before «sweep».
 */
import { decode, type Callback, type GoMode } from './codec.ts';
import { dayCard, examList } from './card.ts';
import type { BotDb, Link, Who } from './db.ts';
import { derivedSecret, sameSecret } from './secrets.ts';
import { askTime, claimLink, m1, openPrompt, promptOf, timeChosen, timeReply, TIME_PROMPTS } from './link.ts';
import { buttonsOnly, dateReply, helpCommand, isDatePrompt, settingsCommand, settingsTap, showSettings, stopCommand } from './settings.ts';
import { examsTap, isMovePrompt, moveReply } from './exams.ts';
import { liveStart } from './live.ts';
import { errorName, log, type LogRoute } from './log.ts';
import { processUpdate } from './ledger.ts';
import { runTick, type StepStats, type TickTools } from './tick.ts';
import { readStatus, runSetup } from './setup.ts';
import {
  type InlineKeyboardMarkup,
  answer as answerQuery, createTelegram, editKeyboard, editOrSend, remove, send, type FetchLike, type Keyboard, type Telegram, type TgChat,
  type TgMessage, type TgUser,
} from './tg.ts';
import { typo } from './html.ts';
import { gameStub, type GamePort } from './game.ts';
import * as W from './words.ts';

// ─────────────────────────────────────────── what handlers get ───────────────────────────────────────────

/** The clients, the site and the clock, for every handler and port. */
export interface Ctx {
  tg: Telegram;
  db: BotDb;
  site: string;
  botUsername: string;
  now: () => number;
  /** Once an hour per chat for someone not linked (M1 for stray text); linked chats use the database's stamp. */
  hourly: (chatId: number) => boolean;
}

/** A button press. `answer` stops the client's spinner; only the first call is sent. */
export interface Tap {
  id: string;
  tgUserId: number;
  chatId: number;
  /** null when Telegram no longer gives the message (an inaccessible message, older than 48 h). */
  messageId: number | null;
  chatType: string;
  data: string;
  /** The pressed message's keyboard, when Telegram sends it: T6 re-marks a multiple-answer question without a read. */
  markup?: InlineKeyboardMarkup | null;
  answered: boolean;
  answer(text?: string, alert?: boolean): Promise<void>;
}

export function makeTap(tg: Telegram, q: TgCallbackQuery): Tap {
  const tap: Tap = {
    id: q.id,
    tgUserId: q.from.id,
    chatId: q.message?.chat?.id ?? q.from.id,
    messageId: q.message && q.message.date !== 0 ? q.message.message_id : null,
    chatType: q.message?.chat?.type ?? 'private',
    data: q.data ?? '',
    markup: q.message?.reply_markup ?? null,
    answered: false,
    async answer(text?: string, alert?: boolean) {
      if (tap.answered) return;
      tap.answered = true;
      // A line or a window is plain text: the same no-break spaces as the messages.
      await answerQuery(tg, { id: q.id, text: text ? typo(text) : undefined, alert });
    },
  };
  return tap;
}

/** At most once an hour per chat, per instance (best effort; only for chats with no link). */
export function hourlyGate(now: () => number): (chatId: number) => boolean {
  const last = new Map<number, number>();
  return (chatId) => {
    const at = last.get(chatId);
    if (at !== undefined && now() - at < 3_600_000) return false;
    if (last.size > 10000) last.clear();
    last.set(chatId, now());
    return true;
  };
}

// ─────────────────────────────────────────── ports for the other packages ───────────────────────────────────────────

export type SessionCallback = Extract<Callback, { kind: 'session' }>;
export type GroupCallback = Extract<Callback, { kind: 'group' }>;
export type { StepStats, TickTools };

/**
 * T6 — the session in chat (Z1–Z12, I1–I3, §4.8). The router does not look the user up for these: T5's SQL resolves
 * the user from `tap.tgUserId` in the same call (spec §6.1: one database call → answerCallbackQuery → the edit).
 */
export interface SessionPort {
  /** `go|<cid>|p` «Начать», `e` «Только ошибки» / «Пройтись по ошибкам», `x` «Ещё 20 новых»: the session starts in the tapped message. */
  start(ctx: Ctx, tap: Tap, go: { containerId: string; mode: GoMode }): Promise<void>;
  /** Every `s|<sid>|<pos>|<act>` press, «Продолжить» of the /today card (I3) included. */
  press(ctx: Ctx, tap: Tap, cb: SessionCallback): Promise<void>;
  /** A text in a private chat of a linked user: true when it answered a short question (Z5). */
  text(ctx: Ctx, msg: TgMessage, link: Link): Promise<boolean>;
}

/** T8 — the group (§4.6). */
export interface GroupPort {
  /** `/start@bot G<code>` in a group or supergroup. */
  startGroup(ctx: Ctx, msg: TgMessage, code: string): Promise<void>;
  /** `/start g<id>` in a private chat (the post's «Заниматься в Meldy»); false: answer as a plain /start. */
  privateStart(ctx: Ctx, msg: TgMessage, payload: string, who: Who): Promise<boolean>;
  /** `g|<post>|<i>` presses (linked or not). */
  press(ctx: Ctx, tap: Tap, cb: GroupCallback): Promise<void>;
  /** `my_chat_member` of a group or supergroup (added, left, kicked, admin). */
  member(ctx: Ctx, update: TgChatMemberUpdated): Promise<void>;
  /** The group became a supergroup (`migrate_to_chat_id`). */
  migrate(ctx: Ctx, fromChatId: number, toChatId: number): Promise<void>;
  /**
   * Tick steps 1 (close posts at 21:00), 2 (send posts), 4 («Ответили N»). `tools.deadline`: epoch ms to stop starting
   * work by; `tools.pace()`: await it before every call to Telegram (the whole tick sends at most 25 a second).
   */
  closePosts(ctx: Ctx, tools: TickTools): Promise<StepStats>;
  sendPosts(ctx: Ctx, tools: TickTools): Promise<StepStats>;
  counters(ctx: Ctx, tools: TickTools): Promise<StepStats>;
}

/** T9 — a forwarded file (§4.7) and `GET /telegram/file?t=`. */
export interface FilesPort {
  /** true: answered (F1). false: the router answers S6 / M1. */
  document(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean>;
  http(req: Request, ctx: Ctx): Promise<Response>;
}

/** T10 — a voice answer (§4.9, flag `voice`). */
export interface VoicePort {
  voice(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean>;
  /** A `v|<aid>|<act>` press (V1–V4, the self-check). */
  press(ctx: Ctx, tap: Tap): Promise<void>;
  /** A typed text while an oral question waits for a voice: true when the stage answered it. */
  text(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean>;
}

/** The Mini App's sign-in (webapp.ts): `POST /telegram/webapp/session`. */
export type WebAppAction = 'session';
export interface WebAppPort {
  http(req: Request, ctx: Ctx, action: WebAppAction): Promise<Response>;
}

/**
 * The outage monitor (monitor.ts): the tick's step «monitor», after the others and before the beat. Off until
 * bot.config.monitor_chat_id is set. `tools` as for the group's steps.
 */
export interface MonitorPort {
  tick(ctx: Ctx, tools: TickTools): Promise<StepStats>;
}

/**
 * The pictures of deleted exams and tests (sweep.ts): the tick's step «sweep», before «monitor». Optional: without it
 * the step does nothing.
 */
export interface SweepPort {
  tick(ctx: Ctx, tools: TickTools): Promise<StepStats>;
}

/**
 * The authors' quiz messages (quiz.ts, release 49): the tick's step «quiz», before «sweep». Optional: without it the
 * step does nothing.
 */
export interface QuizPort {
  tick(ctx: Ctx, tools: TickTools): Promise<StepStats>;
}

export interface Ports {
  session: SessionPort;
  group: GroupPort;
  files: FilesPort;
  voice: VoicePort;
  webapp: WebAppPort;
  monitor: MonitorPort;
  sweep?: SweepPort;
  quiz?: QuizPort;
  /** The live game (game.ts): /telegram/game/join, /game/post, /game/sync. */
  game: GamePort;
}

/** Until T6 is merged: presses only stop the spinner. */
export const sessionStub: SessionPort = {
  async start(_ctx, tap) {
    await tap.answer();
  },
  async press(_ctx, tap) {
    await tap.answer();
  },
  async text() {
    return false;
  },
};

const noStats = async (): Promise<StepStats> => ({});

/** Until T8 is merged: the bot stays silent in groups (spec G1: added without a code, it says nothing). */
export const groupStub: GroupPort = {
  async startGroup() {},
  async privateStart() {
    return false;
  },
  async press(_ctx, tap) {
    await tap.answer();
  },
  async member() {},
  async migrate() {},
  closePosts: noStats,
  sendPosts: noStats,
  counters: noStats,
};

/** Until T9 is merged. */
export const filesStub: FilesPort = {
  async document() {
    return false;
  },
  async http() {
    return new Response('Not found', { status: 404 });
  },
};

/** Until T10 is merged. */
export const voiceStub: VoicePort = {
  async voice() {
    return false;
  },
  async press(_ctx, tap) {
    await tap.answer();
  },
  async text() {
    return false;
  },
};

/** Without the Mini App's port the routes are not there. */
export const webappStub: WebAppPort = {
  async http() {
    return new Response('Not found', { status: 404 });
  },
};

/** Without the monitor's port the step does nothing. */
export const monitorStub: MonitorPort = { tick: noStats };

export const STUBS: Ports = { session: sessionStub, group: groupStub, files: filesStub, voice: voiceStub, webapp: webappStub, monitor: monitorStub, game: gameStub };

// ─────────────────────────────────────────── updates ───────────────────────────────────────────

export interface TgCallbackQuery { id: string; from: TgUser; message?: TgMessage; data?: string; chat_instance?: string }
export interface TgChatMember { status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'; user: TgUser }
export interface TgChatMemberUpdated { chat: TgChat; from: TgUser; date: number; old_chat_member: TgChatMember; new_chat_member: TgChatMember }
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
}

export type UpdateKind = 'message' | 'callback' | 'my_chat_member' | 'ignored';

/** What the ledger and the log call an update: edited messages and channel posts are ignored. */
export function updateKind(update: TgUpdate): UpdateKind {
  if (update.message) return update.message.chat?.type === 'channel' ? 'ignored' : 'message';
  if (update.callback_query) return 'callback';
  if (update.my_chat_member) return 'my_chat_member';
  return 'ignored';
}

/** `/start@Meldyteach_bot L…` → { name: 'start', payload: 'L…' }; another bot's command → null. */
export function parseCommand(text: string | undefined, botUsername: string): { name: string; payload: string } | null {
  if (typeof text !== 'string') return null;
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  if (m[2] && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: m[1].toLowerCase(), payload: (m[3] ?? '').trim() };
}

/** The text of a message the bot sent, as written in words.ts (the renderer glued it with no-break spaces). */
const plain = (text: string | undefined) => (typeof text === 'string' ? text.replace(/ /g, ' ') : '');

async function sendOut(ctx: Ctx, chatId: number, out: { text: string; keyboard?: Keyboard | null }) {
  await send(ctx.tg, { chatId, text: out.text, keyboard: out.keyboard });
}

/** /today (and /start of a linked user): K1 at the bottom; the earlier unused card and the typed command go away. */
export async function todayCommand(ctx: Ctx, msg: TgMessage, tgUserId: number): Promise<void> {
  const chatId = msg.chat.id;
  const today = await ctx.db.today(tgUserId);
  if (!today) return sendOut(ctx, chatId, m1(ctx.site));
  const card = dayCard(today, 'today', ctx.site);
  const sent = await send(ctx.tg, { chatId, text: card.out.text, keyboard: card.out.keyboard });
  // The record lets the night's close remove an unused card; losing it costs only that, so it never fails the update.
  const recorded = await ctx.db.cardSent(tgUserId, sent.message_id, 'card').catch(() => ({ prevMessageId: null }));
  if (recorded.prevMessageId !== null) await remove(ctx.tg, chatId, recorded.prevMessageId);
  await remove(ctx.tg, chatId, msg.message_id);
}

async function onCommand(ctx: Ctx, ports: Ports, msg: TgMessage, command: { name: string; payload: string }): Promise<void> {
  const tgUserId = (msg.from as TgUser).id;
  const chatId = msg.chat.id;
  if (command.name === 'help') return helpCommand(ctx, msg);
  // The live game (live.ts): `play_<PIN>` and `r_<game>` answer with the Mini App's button, linked or not.
  if (command.name === 'start' && (await liveStart(ctx, msg, command.payload))) return;
  if (command.name === 'start' && command.payload && !/^g/.test(command.payload)) return claimLink(ctx, msg, command.payload);
  const who = await ctx.db.whoami(tgUserId);
  switch (command.name) {
    case 'start': {
      if (command.payload && (await ports.group.privateStart(ctx, msg, command.payload, who))) return;
      return who.linked ? todayCommand(ctx, msg, tgUserId) : sendOut(ctx, chatId, m1(ctx.site));
    }
    case 'today':
      return who.linked ? todayCommand(ctx, msg, tgUserId) : sendOut(ctx, chatId, m1(ctx.site));
    case 'settings':
      return who.linked ? settingsCommand(ctx, msg, who) : sendOut(ctx, chatId, m1(ctx.site));
    case 'stop':
      return stopCommand(ctx, msg, who.linked);
    default:
      if (who.linked) return buttonsOnly(ctx, msg, who);
      if (ctx.hourly(chatId)) return sendOut(ctx, chatId, m1(ctx.site));
  }
}

async function onPrivateMessage(ctx: Ctx, ports: Ports, msg: TgMessage): Promise<void> {
  const from = msg.from as TgUser;
  const command = parseCommand(msg.text, ctx.botUsername);
  if (command) return onCommand(ctx, ports, msg, command);
  const who = await ctx.db.whoami(from.id);
  // Anything sent that is neither text nor voice: a document gets F1, other media the «Не документ» line (§4.7).
  if (typeof msg.text !== 'string' && !msg.voice && (await ports.files.document(ctx, msg, who))) return;
  if (msg.voice && (await ports.voice.voice(ctx, msg, who))) return;
  if (!who.linked) {
    if (ctx.hourly(msg.chat.id)) await sendOut(ctx, msg.chat.id, m1(ctx.site));
    return;
  }
  const text = typeof msg.text === 'string' ? msg.text : null;
  const reply = msg.reply_to_message;
  const showS1 = (chatId: number, messageId: number | null, link: Link) => showSettings(ctx, chatId, messageId, link);
  if (text !== null && reply && reply.from?.is_bot) {
    const asked = plain(reply.text);
    if (TIME_PROMPTS.includes(asked)) return timeReply(ctx, msg, who, promptOf(who, 'time', reply.message_id), showS1);
    if (isDatePrompt(asked)) return dateReply(ctx, msg, who, promptOf(who, 'date', reply.message_id));
    if (isMovePrompt(asked)) return moveReply(ctx, msg, who, promptOf(who, 'move', reply.message_id));
  }
  if (text !== null && (await ports.session.text(ctx, msg, who))) return;
  const pending = text !== null ? openPrompt(who, ctx.now()) : null;
  if (pending) {
    if (pending.kind === 'time') return timeReply(ctx, msg, who, pending, showS1);
    return pending.kind === 'move' ? moveReply(ctx, msg, who, pending) : dateReply(ctx, msg, who, pending);
  }
  // After the time and date prompts: a typed «19:45» answers the prompt, not the oral question waiting for a voice.
  if (text !== null && (await ports.voice.text(ctx, msg, who))) return;
  return buttonsOnly(ctx, msg, who);
}

async function onGroupMessage(ctx: Ctx, ports: Ports, msg: TgMessage): Promise<void> {
  if (typeof msg.migrate_to_chat_id === 'number') return ports.group.migrate(ctx, msg.chat.id, msg.migrate_to_chat_id);
  const command = parseCommand(msg.text, ctx.botUsername);
  // The bot keeps nothing of a group's talk: only `/start G<code>` (the author's «Подключить беседу») is read.
  if (command && command.name === 'start' && msg.from && /^G/.test(command.payload)) return ports.group.startGroup(ctx, msg, command.payload);
}

async function onTap(ctx: Ctx, ports: Ports, tap: Tap): Promise<void> {
  // The voice stage's own data (`v|<aid>|<act>`, voice.ts) is not in codec.ts.
  if (tap.data.startsWith('v|')) return ports.voice.press(ctx, tap);
  const cb = decode(tap.data);
  if (!cb) return tap.answer();
  if (cb.kind === 'group') return ports.group.press(ctx, tap, cb);
  if (tap.chatType !== 'private') return tap.answer();
  if (cb.kind === 'session') return ports.session.press(ctx, tap, cb);
  if (cb.kind === 'go') return ports.session.start(ctx, tap, { containerId: cb.cid, mode: cb.mode });
  if (cb.kind === 'exam') {
    const today = await ctx.db.today(tap.tgUserId);
    if (!today) return tap.answer(W.NOT_LINKED);
    await tap.answer();
    if (cb.cid === null) {
      if (tap.messageId) await editKeyboard(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, keyboard: examList(today) });
      return;
    }
    const card = dayCard(today, 'today', ctx.site, cb.cid);
    await editOrSend(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, text: card.out.text, keyboard: card.out.keyboard });
    return;
  }
  // «Экзамены» and «Перенести экзамен»: their own SQL (bot_exams, bot_exam_remind, bot_exam_move) finds the user.
  if (cb.kind === 'exams' || cb.kind === 'remind' || cb.kind === 'card' || cb.kind === 'move' || cb.kind === 'moveFor') return examsTap(ctx, tap, cb);
  const who = await ctx.db.whoami(tap.tgUserId);
  if (!who.linked) return tap.answer(W.NOT_LINKED);
  if (cb.kind === 'time' && cb.from === 'link') return cb.minutes === null ? askTime(ctx, tap, 'link') : timeChosen(ctx, tap, cb.minutes);
  return settingsTap(ctx, tap, cb, who);
}

async function onMember(ctx: Ctx, ports: Ports, update: TgChatMemberUpdated): Promise<void> {
  if (update.chat?.type !== 'private') return ports.group.member(ctx, update);
  const status = update.new_chat_member?.status;
  if (status === 'kicked') await ctx.db.chatEvent(update.from.id, 'blocked');
  else if (status === 'member') await ctx.db.chatEvent(update.from.id, 'unblocked');
}

/** One update, after the ledger let it through. */
export async function dispatch(ctx: Ctx, ports: Ports, update: TgUpdate, tap: Tap | null): Promise<void> {
  if (update.message) {
    const msg = update.message;
    const type = msg.chat?.type;
    if (type === 'private') {
      if (!msg.from || msg.from.is_bot) return;
      return onPrivateMessage(ctx, ports, msg);
    }
    if (type === 'group' || type === 'supergroup') return onGroupMessage(ctx, ports, msg);
    return;
  }
  if (update.callback_query && tap) return onTap(ctx, ports, tap);
  if (update.my_chat_member) return onMember(ctx, ports, update.my_chat_member);
}

// ─────────────────────────────────────────── HTTP ───────────────────────────────────────────

export interface AppDeps {
  token: string;
  /** Telegram's fetch (tests pass a fake). */
  fetch: FetchLike;
  db: BotDb;
  /** `https://<ref>.supabase.co/functions/v1/telegram`, no query string. */
  functionUrl: string;
  waitUntil: (work: Promise<unknown>) => void;
  /** The region this instance runs in (SB_REGION), for /status. */
  region?: string | null;
  site?: string;
  botUsername?: string;
  now?: () => number;
  ports?: Partial<Ports>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export type Route = 'webhook' | 'tick' | 'setup' | 'status' | 'file' | 'webapp_session' | 'game_join' | 'game_post' | 'game_sync' | null;

/** `/telegram`, `/functions/v1/telegram/tick`, `/telegram/setup/`, `/telegram/webapp/session`, `/telegram/game/join` → the route. */
export function routeOf(url: string): Route {
  let path: string;
  try {
    path = new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
  const m = /(?:^|\/)telegram(?:\/(tick|setup|status|file|webapp\/session|game\/(?:join|post|sync)))?$/.exec(path);
  if (!m) return null;
  if (m[1] === 'webapp/session') return 'webapp_session';
  if (m[1] && m[1].startsWith('game/')) return `game_${m[1].slice(5)}` as Route;
  return (m[1] as Route) ?? 'webhook';
}

const empty = (status: number) => new Response(null, { status });

/** How long /status answers from memory. */
export const STATUS_CACHE_MS = 15_000;

export function createApp(deps: AppDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const tg = createTelegram({ token: deps.token, fetch: deps.fetch, sleep: deps.sleep, random: deps.random });
  const ports: Ports = { ...STUBS, ...(deps.ports ?? {}) };
  const ctx: Ctx = { tg, db: deps.db, site: deps.site ?? W.SITE, botUsername: deps.botUsername ?? W.BOT_USERNAME, now, hourly: hourlyGate(now) };
  const tickCtx: Ctx = { ...ctx, tg: tg.with({ wait429Sec: 0 }) };
  let lastSetup = Number.NEGATIVE_INFINITY;

  async function webhook(req: Request): Promise<Response> {
    const started = now();
    if (req.method !== 'POST') return empty(405);
    const expected = await derivedSecret(deps.token, 'webhook');
    if (!sameSecret(req.headers.get('x-telegram-bot-api-secret-token'), expected)) {
      log({ route: 'webhook', outcome: 'unauthorized', ms: now() - started });
      return empty(401);
    }
    let update: TgUpdate;
    try {
      update = await req.json();
    } catch {
      log({ route: 'webhook', outcome: 'bad_json', ms: now() - started });
      return empty(200);
    }
    if (!update || typeof update !== 'object' || !Number.isInteger(update.update_id) || update.update_id < 0) {
      log({ route: 'webhook', outcome: 'no_update_id', ms: now() - started });
      return empty(200);
    }
    const tap = update.callback_query ? makeTap(ctx.tg, update.callback_query) : null;
    return empty(await processUpdate(ctx, update, updateKind(update), tap, () => dispatch(ctx, ports, update, tap), started));
  }

  async function tick(req: Request): Promise<Response> {
    if (req.method !== 'POST') return empty(405);
    const expected = await derivedSecret(deps.token, 'tick');
    if (!sameSecret(req.headers.get('x-meldy-tick'), expected)) {
      log({ route: 'tick', outcome: 'unauthorized' });
      return empty(401);
    }
    deps.waitUntil(runTick(tickCtx, ports, { sleep: deps.sleep }).catch((error) => log({ route: 'tick', outcome: 'failed', error_name: errorName(error) })));
    return empty(202);
  }

  async function setup(req: Request): Promise<Response> {
    if (req.method !== 'POST') return empty(405);
    if (now() - lastSetup < 60_000) return Response.json({ ok: false, error: 'slow_down' }, { status: 429 });
    lastSetup = now();
    const result = await runSetup(ctx, { token: deps.token, functionUrl: deps.functionUrl });
    const status = result.ok ? 200 : result.error === 'slow_down' ? 429 : 502;
    return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
  }

  // /status is public: one read of Telegram and the database per 15 s and instance, whoever asks.
  let statusCache: { at: number; body: unknown } | null = null;
  async function status(req: Request): Promise<Response> {
    if (req.method !== 'GET') return empty(405);
    if (!statusCache || now() - statusCache.at >= STATUS_CACHE_MS) {
      statusCache = { at: now(), body: await readStatus(ctx, { functionUrl: deps.functionUrl, region: deps.region ?? null }) };
    }
    return Response.json(statusCache.body, { headers: { 'Cache-Control': 'no-store' } });
  }

  return async (req: Request): Promise<Response> => {
    const route = routeOf(req.url);
    try {
      switch (route) {
        case 'webhook': return await webhook(req);
        case 'tick': return await tick(req);
        case 'setup': return await setup(req);
        case 'status': return await status(req);
        case 'file': return await ports.files.http(req, ctx); // T9: GET /telegram/file?t=
        // The Mini App (webapp.ts): the site's /tg page signs in a linked Telegram.
        case 'webapp_session': return await ports.webapp.http(req, ctx, 'session');
        // The live game (game.ts): the Mini App's join; the database's post and sync calls.
        case 'game_join': return await ports.game.http(req, ctx, 'join');
        case 'game_post': return await ports.game.http(req, ctx, 'post');
        case 'game_sync': return await ports.game.http(req, ctx, 'sync');
        default: return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      const logRoute: LogRoute = route === 'webapp_session' ? 'webapp' : route === null ? 'http' : route.startsWith('game_') ? 'game' : (route as LogRoute);
      log({ route: logRoute, outcome: 'failed', error_name: errorName(error) });
      return empty(500);
    }
  };
}
