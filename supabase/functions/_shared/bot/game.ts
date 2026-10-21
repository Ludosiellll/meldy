/**
 * The live class game «Битва с монстром» in Telegram (docs/live/CONTRACT.md §9; migration 20261021090000_live_game.sql).
 * Three routes of the `telegram` function:
 *
 * - `POST /telegram/game/join` `{init_data, pin, look?, name?}` from the Mini App (`/tg/play`), the site's origin or the
 *   site's /sb/ way: the same checks as `/webapp/session` (CORS, 120 a minute per address, the body, initData's HMAC and
 *   its hour, 20 a minute per Telegram user), then a player token made here (32 random bytes, base64url) whose sha256
 *   goes to `bot_live_join` with the launch's replay key. 200 `{status}`: `joined` (+ the JoinResult and `token`, given
 *   once), `invalid`, `stale`, `replayed`, `slow_down`, `not_found`, `ended`, `full`, `members_only`, `kicked`,
 *   `name_refused` / `look_refused` (+ `reason`). The name: `name` of the body, else the Telegram first name.
 * - `POST /telegram/game/post` `{game_id}` and `POST /telegram/game/sync` `{game_id}`: called by the database through
 *   pg_net (after the author's `live_tg_post`, and on the game's state changes), signed with `x-meldy-live` =
 *   HMAC-SHA256(bot token, 'meldy:live:v1') (secrets.ts; /setup stores it with `bot_live_setup`). 202 at once, the work
 *   after the response: the post (sound on) and its message id (`bot_live_post` → send → `bot_live_posted`); an edit of
 *   that message (`bot_live_sync`: the database keeps the cadence — one edit per 3 s, the lobby every 5 s) and, once at
 *   the podium, the final post (silent). A 429 from Telegram skips that edit: the next state's edit carries the latest
 *   text. Keys and per-question results never reach the chat.
 *
 * The user's JWT is never read here (security.test.ts): the author's right to post is checked by PostgREST and the
 * database in `live_tg_post`. Never logged: the bot token, initData, the player token, names, ids.
 */
import { DbError } from './db.ts';
import { esc } from './html.ts';
import { errorName, log } from './log.ts';
import type { Ctx } from './router.ts';
import { derivedSecret, sameSecret } from './secrets.ts';
import { edit, isRateLimited, send, TelegramError, type Keyboard, type Out } from './tg.ts';
import {
  BODY_MAX, checkInitData, clientAddress, PER_ADDRESS_PER_MINUTE, PER_TELEGRAM_PER_MINUTE, replayKey, UNKNOWN_ADDRESS_PER_MINUTE,
  windowLimiter,
} from './webapp.ts';
import * as W from './words.ts';

export type GameAction = 'join' | 'post' | 'sync';

export interface GamePort {
  http(req: Request, ctx: Ctx, action: GameAction): Promise<Response>;
}

/** Without the game's port the routes are not there. */
export const gameStub: GamePort = {
  async http() {
    return new Response('Not found', { status: 404 });
  },
};

// ─────────────────────────────────────────── the texts (W3: live.ts) ───────────────────────────────────────────

export type LiveState = 'lobby' | 'countdown' | 'open' | 'reveal' | 'leaderboard' | 'podium' | 'ended';

/** What the post says (bot_live_post). */
export interface LivePost {
  title: string;
  qCount: number;
  /** The author's profile name, or null. */
  host: string | null;
  pin: string;
  players: number;
  /** bot.config.flags.live_direct: the Mini App's direct link exists (@BotFather /newapp `play`). */
  direct: boolean;
  /**
   * The game's mode (migration 20261023090000_live_stand_phone.sql): «Встань на ответ» is 'stand'. Absent (an older
   * database) reads as the battle, 'boss'.
   */
  mode?: LiveMode;
}

export type LiveMode = 'boss' | 'stand';
/** A stand game says so; a battle's facts stay as they were (no key). */
const modeOf = (v: unknown): { mode?: LiveMode } => (v === 'stand' ? { mode: 'stand' } : {});

/** The same message now (bot_live_sync). */
export interface LiveNow extends LivePost {
  state: LiveState;
  /** The current question (0-based), -1 in the lobby. */
  qi: number;
  /** The boss's HP in percent, null before the first question. */
  hpPct: number | null;
}

/** The final post at the podium (once). `top`: the first three, only when the author allows names. */
export interface LiveFinal {
  won: boolean;
  top: Array<{ name: string; dmg: number }> | null;
  accuracyPct: number;
  gameId: string;
  containerId: string;
  direct: boolean;
  /** As LivePost.mode: in a stand game nobody beats the boss, places count (`won` is always false). */
  mode?: LiveMode;
}

export interface LiveLinks {
  /** The site, `https://ludosiel-studyforge.hf.space`. */
  site: string;
  /** The bot's username, `Meldyteach_bot`. */
  bot: string;
}

/**
 * The bot's texts of the game (HTML for parse_mode=HTML; `Out` of tg.ts). W3 writes them in live.ts; until then
 * `liveTextsStub` below says the contract's lines. Never a key, a choice or a per-question result.
 */
export interface LiveTexts {
  post(facts: LivePost, links: LiveLinks): Out;
  edit(facts: LiveNow, links: LiveLinks): Out;
  final(facts: LiveFinal, links: LiveLinks): Out;
}

/** The «Играть» link: the Mini App's direct link, or the private chat's `/start play_<PIN>` until it exists. */
export function playUrl(links: LiveLinks, pin: string, direct: boolean): string {
  return direct ? `https://t.me/${links.bot}/play?startapp=${pin}` : `https://t.me/${links.bot}?start=play_${pin}`;
}

const playKeyboard = (facts: LivePost, links: LiveLinks): Keyboard => [[{ text: 'Играть', url: playUrl(links, facts.pin, facts.direct), style: 'primary' }]];
const hostLine = (facts: LivePost) => (facts.host ? `Ведёт ${esc(facts.host)} · PIN ${facts.pin}` : `PIN ${facts.pin}`);

/** The contract's lines (§9), until W3's live.ts. */
export const liveTextsStub: LiveTexts = {
  post(facts, links) {
    return {
      text: [`<b>Игра по тесту «${esc(facts.title)}»</b>`, `Битва с монстром · ${facts.qCount} вопросов`, hostLine(facts), `Играют ${facts.players}`].join('\n'),
      keyboard: playKeyboard(facts, links),
    };
  },
  edit(facts, links) {
    const head = [`<b>Игра по тесту «${esc(facts.title)}»</b>`, `Битва с монстром · ${facts.qCount} вопросов`, hostLine(facts)];
    if (facts.state === 'podium' || facts.state === 'ended') return { text: [...head, 'Игра закончилась'].join('\n'), keyboard: null };
    if (facts.state === 'lobby') return { text: [...head, `Играют ${facts.players}`].join('\n'), keyboard: playKeyboard(facts, links) };
    return {
      text: [...head, `Идёт игра · вопрос ${facts.qi + 1} из ${facts.qCount}`, `Играют ${facts.players}${facts.hpPct === null ? '' : ` · у Дедлайна ${facts.hpPct} %`}`].join('\n'),
      keyboard: playKeyboard(facts, links),
    };
  },
  final(facts, links) {
    const lines = [facts.won ? '<b>Дедлайн повержен</b>' : '<b>Дедлайн победил</b>'];
    if (facts.top) facts.top.forEach((row, i) => lines.push(`${i + 1}. ${esc(row.name)} — ${row.dmg}`));
    lines.push(`Верных ответов ${facts.accuracyPct} %. Свой разбор — у каждого в игре.`);
    const review = facts.direct
      ? `https://t.me/${links.bot}/play?startapp=r_${facts.gameId.replace(/-/g, '')}`
      : `${links.site}/play?review=${facts.gameId}`;
    return { text: lines.join('\n'), keyboard: [[{ text: 'Разбор', url: review }, { text: 'Ещё игра', url: `${links.site}/exams/c/${facts.containerId}` }]] };
  },
};

// ─────────────────────────────────────────── the database's answers ───────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN = /^[0-9]{6}$/;
/** A name typed in the Mini App: the database checks it (1–24 characters, the rude-word filter). */
export const NAME_MAX = 64;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export const JOIN_STATUSES = ['joined', 'replayed', 'slow_down', 'not_found', 'ended', 'full', 'members_only', 'kicked', 'name_refused', 'look_refused'] as const;
export type JoinStatus = (typeof JOIN_STATUSES)[number] | 'invalid' | 'stale';

/** bot_live_join's answer as the Mini App reads it; an unknown shape throws (the request then answers 503). */
export function toJoinAnswer(raw: unknown): Record<string, unknown> {
  const r = obj(raw);
  if (!(JOIN_STATUSES as readonly unknown[]).includes(r.status)) throw new TypeError('bot_live_join: unknown answer');
  if (r.status === 'joined') {
    if (typeof r.game_id !== 'string' || !UUID.test(r.game_id) || typeof r.player_id !== 'string' || !UUID.test(r.player_id)) {
      throw new TypeError('bot_live_join: no player');
    }
    const keep = ['status', 'game_id', 'player_id', 'topic', 'state', 'rev', 'now', 'name', 'look', 'wardrobe'];
    return Object.fromEntries(keep.map((k) => [k, r[k] ?? null]));
  }
  if (r.status === 'name_refused' || r.status === 'look_refused') return { status: r.status, reason: text(r.reason) };
  return { status: r.status };
}

export function toPost(raw: unknown): ({ chatId: number } & LivePost) | null {
  const r = obj(raw);
  if (r.status !== 'post') return null;
  const chatId = int(r.chat_id);
  const qCount = int(r.q_count);
  const players = int(r.players);
  if (chatId === null || chatId >= 0 || qCount === null || players === null || typeof r.title !== 'string' || typeof r.pin !== 'string') {
    throw new TypeError('bot_live_post: bad answer');
  }
  return { chatId, title: r.title, qCount, host: text(r.host), pin: r.pin, players, direct: r.direct === true, ...modeOf(r.mode) };
}

export interface SyncEdit {
  chatId: number;
  messageId: number;
  now: LiveNow;
  final: LiveFinal | null;
}

const STATES: readonly LiveState[] = ['lobby', 'countdown', 'open', 'reveal', 'leaderboard', 'podium', 'ended'];

export function toSync(raw: unknown): SyncEdit | null {
  const r = obj(raw);
  if (r.status !== 'edit') return null;
  const chatId = int(r.chat_id);
  const messageId = int(r.message_id);
  const qCount = int(r.q_count);
  const players = int(r.players);
  const qi = int(r.qi);
  if (chatId === null || messageId === null || qCount === null || players === null || qi === null
      || !STATES.includes(r.state as LiveState) || typeof r.title !== 'string' || typeof r.pin !== 'string') {
    throw new TypeError('bot_live_sync: bad answer');
  }
  const direct = r.direct === true;
  const f = r.final === null || r.final === undefined ? null : obj(r.final);
  let final: LiveFinal | null = null;
  if (f) {
    const top = Array.isArray(f.top)
      ? f.top.map((row) => ({ name: String(obj(row).name ?? ''), dmg: int(obj(row).dmg) ?? 0 }))
      : null;
    if (typeof f.game_id !== 'string' || !UUID.test(f.game_id) || typeof f.container_id !== 'string' || !UUID.test(f.container_id)) {
      throw new TypeError('bot_live_sync: bad final');
    }
    final = { won: f.won === true, top, accuracyPct: int(f.accuracy_pct) ?? 0, gameId: f.game_id, containerId: f.container_id, direct, ...modeOf(f.mode ?? r.mode) };
  }
  return {
    chatId,
    messageId,
    now: { state: r.state as LiveState, qi, qCount, players, title: r.title, pin: r.pin, host: text(r.host), direct, hpPct: int(r.hp_pct), ...modeOf(r.mode) },
    final,
  };
}

// ─────────────────────────────────────────── helpers ───────────────────────────────────────────

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** 32 random bytes as base64url (43 characters): the player's token, given once. */
export function newPlayerToken(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** sha256 hex: what the database keeps of a token. */
export async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

/** The Telegram first name of a CHECKED initData (the database checks length and words), at most 24 characters. */
export function telegramName(initData: string): string | null {
  try {
    const user = obj(JSON.parse(new URLSearchParams(initData).get('user') ?? ''));
    const first = typeof user.first_name === 'string' ? user.first_name.replace(/\s+/g, ' ').trim() : '';
    return first ? [...first].slice(0, 24).join('') : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────── the routes ───────────────────────────────────────────

export interface GameDeps {
  /** The bot token: initData's check and the live secret. '' → 503 not_configured. */
  token: () => string;
  texts: LiveTexts;
  /** The work after a 202 (EdgeRuntime.waitUntil in index.ts). */
  waitUntil: (work: Promise<unknown>) => void;
  now?: () => number;
  random?: (bytes: Uint8Array) => Uint8Array;
}

type Outcome = JoinStatus | 'preflight' | 'forbidden_origin' | 'bad_method' | 'bad_request' | 'too_big' | 'rate_limited'
  | 'not_configured' | 'failed' | 'unauthorized' | 'accepted';

export function createGame(deps: GameDeps): GamePort {
  const clock = deps.now ?? (() => Date.now());
  const allowed = windowLimiter((key) => (key === '' ? UNKNOWN_ADDRESS_PER_MINUTE : PER_ADDRESS_PER_MINUTE), 60_000, clock);
  const allowedUser = windowLimiter(() => PER_TELEGRAM_PER_MINUTE, 60_000, clock);

  async function readJson(req: Request): Promise<Record<string, unknown> | 'too_big' | 'bad_request'> {
    const length = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > BODY_MAX) return 'too_big';
    const raw = await req.text();
    if (raw.length > BODY_MAX) return 'too_big';
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : 'bad_request';
    } catch {
      return 'bad_request';
    }
  }

  async function join(ctx: Ctx, body: Record<string, unknown>, token: string): Promise<{ outcome: Outcome; json: Record<string, unknown> }> {
    const check = await checkInitData(body.init_data, token, ctx.now());
    if (!check.ok) {
      const status = check.reason === 'stale' || check.reason === 'future' ? 'stale' : 'invalid';
      return { outcome: status, json: { status } };
    }
    if (!allowedUser(String(check.data.user.id))) return { outcome: 'slow_down', json: { status: 'slow_down' } };
    const pin = typeof body.pin === 'string' && PIN.test(body.pin) ? body.pin : null;
    if (pin === null) return { outcome: 'not_found', json: { status: 'not_found' } };
    // A name typed in the Mini App goes as typed (cut to NAME_MAX): the database answers name_refused for a bad one.
    const typed = typeof body.name === 'string' ? body.name.trim() : '';
    const name = typed !== '' ? [...typed].slice(0, NAME_MAX).join('') : telegramName(String(body.init_data)) ?? 'Игрок';
    const look = body.look && typeof body.look === 'object' && !Array.isArray(body.look) ? body.look : null;
    const playerToken = newPlayerToken(deps.random);
    const answer = toJoinAnswer(await ctx.db.rpc('bot_live_join', {
      p_pin: pin, p_tg_user_id: check.data.user.id, p_name: name, p_look: look, p_token_hash: await sha256Hex(playerToken),
      p_init_hash: await replayKey(check.data.hash), p_auth_date: new Date(check.data.authDate * 1000).toISOString(),
    }));
    if (answer.status === 'joined') return { outcome: 'joined', json: { ...answer, token: playerToken } };
    return { outcome: answer.status as JoinStatus, json: answer };
  }

  async function joinHttp(req: Request, ctx: Ctx): Promise<Response> {
    const started = ctx.now();
    let site = W.SITE;
    try {
      site = new URL(ctx.site).origin;
    } catch {
      site = W.SITE;
    }
    const origin = req.headers.get('origin');
    const ours = origin !== null && origin === site;
    const base: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    if (ours) base['Access-Control-Allow-Origin'] = site;
    const note = (outcome: Outcome, extra: { error_name?: string } = {}) => log({ route: 'game', kind: 'join', outcome, ms: ctx.now() - started, ...extra });
    const fail = (status: number, error: string, outcome: Outcome, extra: { error_name?: string } = {}) => {
      note(outcome, extra);
      return Response.json({ error }, { status, headers: { ...base, ...(status === 405 ? { Allow: 'POST, OPTIONS' } : {}) } });
    };
    try {
      if (req.method === 'OPTIONS') {
        if (!ours) return fail(403, 'origin', 'forbidden_origin');
        note('preflight');
        return new Response(null, {
          status: 204,
          headers: { ...base, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region', 'Access-Control-Max-Age': '600' },
        });
      }
      if (req.method !== 'POST') return fail(405, 'method', 'bad_method');
      if (origin !== null && !ours) return fail(403, 'origin', 'forbidden_origin');
      if (!allowed(clientAddress(req))) return fail(429, 'slow_down', 'rate_limited');
      const token = deps.token();
      if (!token) return fail(503, 'not_configured', 'not_configured');
      const body = await readJson(req);
      if (body === 'too_big') return fail(413, 'too_big', 'too_big');
      if (body === 'bad_request') return fail(400, 'bad_request', 'bad_request');
      const result = await join(ctx, body, token);
      note(result.outcome);
      return Response.json(result.json, { status: 200, headers: base });
    } catch (error) {
      return fail(503, 'unavailable', 'failed', { error_name: error instanceof DbError ? `DbError:${error.code || error.status}` : errorName(error) });
    }
  }

  async function post(ctx: Ctx, game: string): Promise<string> {
    const facts = toPost(await ctx.db.rpc('bot_live_post', { p_game: game }));
    if (!facts) return 'skip';
    const out = deps.texts.post(facts, { site: ctx.site, bot: ctx.botUsername });
    let messageId: number;
    try {
      const sent = await send(ctx.tg.with({ wait429Sec: 0 }), { chatId: facts.chatId, text: out.text, keyboard: out.keyboard, sound: true });
      messageId = sent.message_id;
    } catch (error) {
      log({ route: 'game', kind: 'post', outcome: 'failed', error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
      return 'failed';
    }
    await ctx.db.rpc('bot_live_posted', { p_game: game, p_chat_id: facts.chatId, p_message_id: messageId });
    return 'posted';
  }

  async function sync(ctx: Ctx, game: string): Promise<string> {
    const s = toSync(await ctx.db.rpc('bot_live_sync', { p_game: game }));
    if (!s) return 'skip';
    const links = { site: ctx.site, bot: ctx.botUsername };
    const tg = ctx.tg.with({ wait429Sec: 0 });
    let outcome = 'edited';
    const out = deps.texts.edit(s.now, links);
    try {
      const done = await edit(tg, { chatId: s.chatId, messageId: s.messageId, text: out.text, keyboard: out.keyboard });
      if (done === 'gone') outcome = 'gone';
    } catch (error) {
      // A 429 skips this edit: the next state's edit carries the latest text.
      outcome = isRateLimited(error) ? 'rate_limited' : 'failed';
      log({ route: 'game', kind: 'edit', outcome, error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
    }
    if (s.final) {
      const fin = deps.texts.final(s.final, links);
      try {
        await send(tg, { chatId: s.chatId, text: fin.text, keyboard: fin.keyboard });
        outcome = `${outcome}+final`;
      } catch (error) {
        log({ route: 'game', kind: 'final', outcome: 'failed', error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
      }
    }
    return outcome;
  }

  /** /game/post and /game/sync: the database's calls, signed; 202 and the work after the response. */
  async function dbHttp(req: Request, ctx: Ctx, action: 'post' | 'sync'): Promise<Response> {
    const empty = (status: number) => new Response(null, { status });
    if (req.method !== 'POST') return empty(405);
    const token = deps.token();
    if (!token) return empty(503);
    if (!sameSecret(req.headers.get('x-meldy-live'), await derivedSecret(token, 'live'))) {
      log({ route: 'game', kind: action, outcome: 'unauthorized' });
      return empty(401);
    }
    const body = await readJson(req);
    const game = typeof body === 'object' && typeof body.game_id === 'string' && UUID.test(body.game_id) ? body.game_id.toLowerCase() : null;
    if (!game) return empty(400);
    const started = ctx.now();
    deps.waitUntil(
      (action === 'post' ? post(ctx, game) : sync(ctx, game))
        .then((outcome) => log({ route: 'game', kind: action, outcome, ms: ctx.now() - started }))
        .catch((error) => log({ route: 'game', kind: action, outcome: 'failed', error_name: error instanceof DbError ? `DbError:${error.code || error.status}` : errorName(error) })),
    );
    return empty(202);
  }

  return {
    async http(req, ctx, action) {
      if (action === 'join') return joinHttp(req, ctx);
      return dbHttp(req, ctx, action);
    },
  };
}
