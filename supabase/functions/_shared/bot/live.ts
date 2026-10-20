/**
 * The live game «Битва с монстром» in Telegram (docs/live/CONTRACT.md §9; meldy-notes
 * 10_Project/Telegram_Live_Game_Spec_2026-10-20.md): the bot's texts — the group post with «Играть», its live edits, the
 * final post — as `liveTexts` (the `LiveTexts` of game.ts, which the routes `/game/post` and `/game/sync` call), and the
 * private chat's answer to `/start play_<PIN>` and `/start r_<game>` (the router's hook) while the Mini App's direct link
 * waits for the owner's @BotFather step (`bot.config.flags.live_direct`).
 *
 * The database keeps the cadence of the edits (one per 3 s, the lobby every 5 s); these are texts and markup only. Keys
 * and per-question correctness never appear here — only the boss's HP share, the number of players and, when the author
 * allows names, the top three.
 *
 * Comments stay in English: the tests read the Russian strings with the message linter.
 */
import { glue } from '../plan/words.ts';
import type { LiveFinal, LiveLinks, LiveNow, LivePost, LiveTexts } from './game.ts';
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
 * «Играть»: the direct link to the Mini App (`startapp=<PIN>`), or — while `live_direct` is false — the bot's private
 * chat (`start=play_<PIN>`), which answers with a web_app button (a web_app button opens only from a private chat).
 */
export function playUrl(pin: string, direct: boolean, bot = BOT_USERNAME): string {
  if (!PIN_RE.test(pin)) throw new Error('not a PIN');
  return direct ? `https://t.me/${bot}/${MINI_APP_NAME}?startapp=${pin}` : `https://t.me/${bot}?start=play_${pin}`;
}

/**
 * «Разбор»: the Mini App with `startapp=r_<game>`, or the private chat's `start=r_<game>`. Always Telegram: a Telegram
 * player's token is in Telegram's SecureStorage, so the review opens where the game was played.
 */
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

// ─────────────────────────────────────────── the group post ───────────────────────────────────────────

function head(facts: LivePost): string[] {
  return [b(`Игра по тесту «${facts.title}»`), t(`${MODE} · ${questions(facts.qCount)}`)];
}

function playKeyboard(facts: LivePost, links: LiveLinks): Keyboard {
  return [[{ text: PLAY, url: playUrl(facts.pin, facts.direct, links.bot), style: 'primary' }]];
}

function hostLine(facts: LivePost): string {
  const host = facts.host?.trim();
  return t(host ? `Ведёт ${host} · PIN ${pinText(facts.pin)}` : `PIN ${pinText(facts.pin)}`);
}

/** The post (`/game/post`, sent with sound): title, mode and count, host and PIN, players; «Играть». */
export function livePost(facts: LivePost, links: LiveLinks): Out {
  return { text: lines(...head(facts), hostLine(facts), t(`Играют ${facts.players}`)), keyboard: playKeyboard(facts, links) };
}

/**
 * An edit of the same message (`/game/sync`, silent). The lobby: the post with the count. A question (countdown to
 * leaderboard): «Идёт игра · вопрос k из n» and the players with the boss's HP. The end: «Игра закончилась», keyboard
 * removed. Until the end «Играть» stays: a late player can still join.
 */
export function liveEdit(facts: LiveNow, links: LiveLinks): Out {
  if (facts.state === 'podium' || facts.state === 'ended') return { text: lines(...head(facts), t(ENDED)), keyboard: null };
  if (facts.state === 'lobby' || facts.qi < 0) return livePost(facts, links);
  const hp = facts.hpPct === null ? '' : ` · у Дедлайна ${facts.hpPct} %`;
  return {
    text: lines(...head(facts), t(`Идёт игра · вопрос ${facts.qi + 1} из ${facts.qCount}`), t(`Играют ${facts.players}${hp}`)),
    keyboard: playKeyboard(facts, links),
  };
}

/** The final post (a new message, silent): who won, the top three (only when given), the class's accuracy. */
export function liveFinal(facts: LiveFinal, links: LiveLinks): Out {
  // Names are the players' own (escaped, never glued): «1. Лена — 779».
  const names = (facts.top ?? []).slice(0, 3).map((row, i) => `${i + 1}. ${esc(row.name.trim())}${NBSP}— ${Math.round(row.dmg)}`);
  return {
    text: lines(b(facts.won ? WON : LOST), ...names, t(`Верных ответов ${facts.accuracyPct} %. ${OWN_REVIEW}`)),
    keyboard: [[
      { text: REVIEW, url: reviewUrl(facts.gameId, facts.direct, links.bot) },
      { text: ONE_MORE, url: `${links.site}/exams/c/${facts.containerId}` },
    ]],
  };
}

/** The texts game.ts sends (CONTRACT §9; supabase/functions/telegram/index.ts passes them to createGame). */
export const liveTexts: LiveTexts = { post: livePost, edit: liveEdit, final: liveFinal };

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

/** The answer to `/start play_<PIN>`: a web_app button «Играть» to /tg/play. */
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
