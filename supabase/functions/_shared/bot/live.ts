/**
 * The live game «Битва с монстром» in Telegram (docs/live/CONTRACT.md §9; meldy-notes
 * 10_Project/Telegram_Live_Game_Spec_2026-10-20.md): the group post with «Играть», its live edits, the final post, the
 * private chat's answer to `/start play_<PIN>` (and `/start r_<game>` for the review) while the direct link waits for
 * the owner's @BotFather step, and the cadence of the edits.
 *
 * Texts and markup only (plus the one /start hook): the routes (`/telegram/game/post`, `/game/sync`, `/game/join`) and
 * the database are W1's; they call these builders with the game's row. Keys and per-question correctness never appear
 * here — only the boss's HP share, the number of players and, with the author's `chat_names`, the top three names.
 *
 * Comments stay in English: the tests read the Russian strings with the message linter.
 */
import { glue } from '../plan/words.ts';
import { b, esc, lines, t } from './html.ts';
import type { Ctx } from './router.ts';
import { send, type Keyboard, type Out, type TgMessage } from './tg.ts';
import { BOT_USERNAME } from './words.ts';

// ─────────────────────────────────────────── links ───────────────────────────────────────────

/** The Mini App's short name (@BotFather /newapp, owner's step). */
export const MINI_APP_NAME = 'play';
const PIN_RE = /^\d{6}$/;
const GAME_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A game's uuid without dashes, lower case (32 hex): the start parameter's form. */
export function gameKey(gameId: string): string {
  if (!GAME_RE.test(gameId)) throw new Error('not a game id');
  return gameId.replace(/-/g, '').toLowerCase();
}

/**
 * «Играть»: the direct link to the Mini App (`startapp=<PIN>`), or — while `bot.config.flags.live_direct` is false —
 * the bot's private chat (`start=play_<PIN>`), which answers with a web_app button.
 */
export function playUrl(pin: string, direct: boolean, bot = BOT_USERNAME): string {
  if (!PIN_RE.test(pin)) throw new Error('not a PIN');
  return direct ? `https://t.me/${bot}/${MINI_APP_NAME}?startapp=${pin}` : `https://t.me/${bot}?start=play_${pin}`;
}

/** «Разбор»: the Mini App with `startapp=r_<game>`, or the private chat's `start=r_<game>`. */
export function reviewUrl(gameId: string, direct: boolean, bot = BOT_USERNAME): string {
  const key = gameKey(gameId);
  return direct ? `https://t.me/${bot}/${MINI_APP_NAME}?startapp=r_${key}` : `https://t.me/${bot}?start=r_${key}`;
}

/** The Mini App's page on the site (the web_app button of the private chat). */
export function miniAppUrl(site: string, query: { pin: string } | { review: string }): string {
  return 'pin' in query ? `${site}/tg/play?pin=${query.pin}` : `${site}/tg/play?r=${gameKey(query.review)}`;
}

// ─────────────────────────────────────────── words ───────────────────────────────────────────

export const PLAY = 'Играть';
export const REVIEW = 'Разбор';
export const ONE_MORE = 'Ещё игра';
export const MODE = 'Битва с монстром';
export const ENDED = 'Игра закончилась';
export const WON = 'Дедлайн повержен';
export const LOST = 'Дедлайн победил';
export const OWN_REVIEW = 'Свой разбор — у каждого в игре.';
export const PRIVATE_PLAY = 'Нажмите «Играть»: игра откроется здесь, в Telegram.';
export const PRIVATE_REVIEW = 'Ваши ответы и верные варианты этой игры — по кнопке «Разбор».';
const NBSP = ' ';

const pinText = (pin: string) => `${pin.slice(0, 3)}${NBSP}${pin.slice(3)}`;
const questions = (n: number) => glue(n, 'вопрос', 'вопроса', 'вопросов');

/** The boss's health in whole percent; never 0 % while it is alive, never above 100. */
export function hpPct(hp: number, hpMax: number): number {
  if (!(hpMax > 0) || hp <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((100 * hp) / hpMax)));
}

// ─────────────────────────────────────────── the group post ───────────────────────────────────────────

/** The game as the post shows it: from the game row, the exam or quiz and the author's profile. */
export interface LiveGameInfo {
  gameId: string;
  pin: string;
  /** The test's or контрольная's title. */
  title: string;
  qCount: number;
  /** The author's profile name; null: the line is «PIN …» alone. */
  host: string | null;
  /** settings.chat_names: the final post names the top three. */
  chatNames: boolean;
  /** bot.config.flags.live_direct: «Играть» is the Mini App's direct link. */
  direct: boolean;
}

/** What the live message shows now. `qi` counts from 0 (the text says «вопрос qi + 1»). */
export type LiveStatus =
  | { state: 'lobby'; players: number }
  | { state: 'question'; qi: number; players: number; hpPct: number }
  | { state: 'ended' };

function head(game: LiveGameInfo): string[] {
  return [b(`Игра по тесту «${game.title}»`), t(`${MODE} · ${questions(game.qCount)}`)];
}

function playKeyboard(game: LiveGameInfo): Keyboard {
  return [[{ text: PLAY, url: playUrl(game.pin, game.direct), style: 'primary' }]];
}

/** The text of the live message in a state (HTML). */
export function liveText(game: LiveGameInfo, status: LiveStatus): string {
  const top = head(game);
  if (status.state === 'lobby') {
    const who = game.host && game.host.trim() ? `Ведёт ${game.host.trim()} · PIN ${pinText(game.pin)}` : `PIN ${pinText(game.pin)}`;
    return lines(...top, t(who), t(`Играют ${status.players}`));
  }
  if (status.state === 'question') {
    return lines(...top, t(`Идёт игра · вопрос ${status.qi + 1} из ${game.qCount}`), t(`Играют ${status.players} · у Дедлайна ${status.hpPct} %`));
  }
  return lines(...top, t(ENDED));
}

/** The post (`/telegram/game/post`, sent with sound): the lobby text and «Играть». */
export function livePost(game: LiveGameInfo, players = 0): Out {
  return { text: liveText(game, { state: 'lobby', players }), keyboard: playKeyboard(game) };
}

/** An edit of the same message (silent). The end removes the keyboard; until then «Играть» stays for late joiners. */
export function liveEdit(game: LiveGameInfo, status: LiveStatus): Out {
  return { text: liveText(game, status), keyboard: status.state === 'ended' ? null : playKeyboard(game) };
}

export interface LiveFinal {
  won: boolean;
  /** The ranking's first three (CONTRACT §3 order); shown only with `chat_names`. */
  top: ReadonlyArray<{ name: string; dmg: number }>;
  accuracyPct: number;
  /** The exam's page on the site, for «Ещё игра» (absolute https). */
  examUrl: string;
}

/** The final post (a new message, silent): who won, the top three if the author allowed it, the class's accuracy. */
export function liveFinal(game: LiveGameInfo, final: LiveFinal): Out {
  // Names are the players' own (escaped, never glued); «1. Лена — 779».
  const names = game.chatNames ? final.top.slice(0, 3).map((row, i) => `${i + 1}. ${esc(row.name.trim())}${NBSP}— ${Math.round(row.dmg)}`) : [];
  return {
    text: lines(b(final.won ? WON : LOST), ...names, t(`Верных ответов ${final.accuracyPct} %. ${OWN_REVIEW}`)),
    keyboard: [[{ text: REVIEW, url: reviewUrl(game.gameId, game.direct) }, { text: ONE_MORE, url: final.examUrl }]],
  };
}

// ─────────────────────────────────────────── the private chat ───────────────────────────────────────────

export type LiveStart = { kind: 'play'; pin: string } | { kind: 'review'; gameId: string };

/** `/start play_482913` → play; `/start r_<32 hex>` → review; anything else → null (other /start payloads). */
export function parseLiveStart(payload: string): LiveStart | null {
  const play = /^play_(\d{6})$/.exec(payload);
  if (play) return { kind: 'play', pin: play[1] };
  const review = /^r_([0-9a-f]{32})$/.exec(payload);
  if (review) {
    const h = review[1];
    return { kind: 'review', gameId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
  }
  return null;
}

/** The answer to `/start play_<PIN>`: a web_app button «Играть» (web_app opens only from a private chat). */
export function playPrivate(pin: string, site: string): Out {
  return {
    text: lines(b(`${MODE} · PIN ${pinText(pin)}`), t(PRIVATE_PLAY)),
    keyboard: [[{ text: PLAY, webApp: miniAppUrl(site, { pin }), style: 'primary' }]],
  };
}

/** The answer to `/start r_<game>`: the game's review in the Mini App. */
export function reviewPrivate(gameId: string, site: string): Out {
  return {
    text: lines(b(REVIEW), t(PRIVATE_REVIEW)),
    keyboard: [[{ text: REVIEW, webApp: miniAppUrl(site, { review: gameId }), style: 'primary' }]],
  };
}

/** The router's hook: true when the payload was the game's and the private chat got its button. */
export async function liveStart(ctx: Ctx, msg: TgMessage, payload: string): Promise<boolean> {
  const start = parseLiveStart(payload);
  if (!start || msg.chat.type !== 'private') return false;
  const out = start.kind === 'play' ? playPrivate(start.pin, ctx.site) : reviewPrivate(start.gameId, ctx.site);
  await send(ctx.tg, { chatId: msg.chat.id, text: out.text, keyboard: out.keyboard });
  return true;
}

// ─────────────────────────────────────────── the cadence ───────────────────────────────────────────

/** At most one edit of a message per 3 s (Telegram: 20 a minute per group, 1 a second per chat). */
export const EDIT_GAP_MS = 3000;
/** The lobby's count at most every 5 s. */
export const LOBBY_GAP_MS = 5000;

/** The game's state as the database reports it to `/game/sync`. */
export type GameState = 'lobby' | 'countdown' | 'open' | 'reveal' | 'leaderboard' | 'podium' | 'ended';

/** What the message showed last, and when it was edited. */
export interface LastEdit {
  at: number | null;
  text: string | null;
}

export type EditPlan =
  /** Edit now. */
  | { send: true; waitMs: 0 }
  /** The end: edit after `waitMs` (the message must not stay «Играют …»). */
  | { send: true; waitMs: number }
  /** Not now: this state does not edit, nothing changed, or too soon (the next state's edit carries the latest text). */
  | { send: false; reason: 'state' | 'same' | 'soon' };

/** The live status a state shows, or null when the state does not edit (open, leaderboard). */
export function statusOf(state: GameState, figures: { qi: number; players: number; hp: number; hpMax: number }): LiveStatus | null {
  if (state === 'lobby') return { state: 'lobby', players: figures.players };
  if (state === 'countdown' || state === 'reveal') return { state: 'question', qi: figures.qi, players: figures.players, hpPct: hpPct(figures.hp, figures.hpMax) };
  if (state === 'podium' || state === 'ended') return { state: 'ended' };
  return null;
}

/**
 * Whether `/game/sync` edits now (CONTRACT §9 «Cadence»): only on countdown, reveal and lobby count changes; at most
 * one edit per 3 s, the lobby at most every 5 s; the end always goes out, after the gap if it came too soon.
 */
export function planEdit(last: LastEdit, status: LiveStatus | null, text: string | null, now: number): EditPlan {
  if (!status || text === null) return { send: false, reason: 'state' };
  if (last.text === text) return { send: false, reason: 'same' };
  const since = last.at === null ? Number.POSITIVE_INFINITY : now - last.at;
  if (status.state === 'ended') return since >= EDIT_GAP_MS ? { send: true, waitMs: 0 } : { send: true, waitMs: EDIT_GAP_MS - since };
  const gap = status.state === 'lobby' ? LOBBY_GAP_MS : EDIT_GAP_MS;
  return since >= gap ? { send: true, waitMs: 0 } : { send: false, reason: 'soon' };
}
