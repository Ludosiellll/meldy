/**
 * Settings, pause, help (spec §4.5): S1 `/settings`, S2 the time, S3 the pause (until tomorrow, for 3 days, until
 * Monday, a date by ForceReply), S4 unlinking (`/stop` does it without asking), S5 `/help`, S6 a text outside a
 * question (once an hour, stamped by `bot_settings({hint: true})`); and the answers to K2 «Присылать план дальше?».
 *
 * `paused_until` is the first day the card comes again. Every screen after S1 is an edit of the same message.
 * `bot_settings` answers with a status: `unlinked` → the line «Telegram отключён…».
 */
import type { LocalDay } from '../plan/container.ts';
import { addDays, daysBetween, weekday } from '../plan/time.ts';
import { planNow, timeText, type ExamDay } from './card.ts';
import { encode, type Callback } from './codec.ts';
import type { Link, Prompt } from './db.ts';
import { hhmm } from './db.ts';
import { b, lines, t } from './html.ts';
import { askTime, askWith, timeKeyboard } from './link.ts';
import type { Ctx, Tap } from './router.ts';
import { edit, editOrSend, remove, send, type Keyboard, type Out, type TgMessage } from './tg.ts';
import * as W from './words.ts';

/** A reply to one of these texts is a date. */
export function isDatePrompt(text: string): boolean {
  return text === W.DATE_PROMPT || text === W.DATE_BAD || text === W.DATE_PAST || /^Эта дата позже экзамена .+\. Напишите дату до него\.$/.test(text);
}

const isPaused = (link: Link) => link.pausedUntil !== null && link.pausedUntil > link.today;

// ─────────────────────────────────────────── screens ───────────────────────────────────────────

/** S1: the time and its zone, the exam, the pause; [Время] [Пауза | Снять паузу] / [Отключить Telegram]. */
export function s1(link: Link, exam: Pick<ExamDay, 'title' | 'date'> | null): Out {
  const time = timeText(link.remindAt);
  const text = lines(
    b(W.SETTINGS_TITLE),
    t(link.remindOn ? W.planAt(time, W.zoneText(link.tz)) : W.PLAN_OFF),
    t(exam ? W.examIs(exam.title, exam.date) : W.NO_EXAM),
    isPaused(link) ? t(W.pauseUntil(link.pausedUntil as LocalDay, addDays(link.today, 1))) : null,
  );
  const keyboard: Keyboard = [
    [
      { text: W.TIME, data: encode({ kind: 'settings', screen: 'time' }) },
      isPaused(link)
        ? { text: W.UNPAUSE, data: encode({ kind: 'pause', choice: 'off' }) }
        : { text: W.PAUSE, data: encode({ kind: 'settings', screen: 'pause' }) },
    ],
    [{ text: W.UNLINK_TG, data: encode({ kind: 'settings', screen: 'off' }) }],
  ];
  return { text, keyboard };
}

/** S2: the time. */
export function s2(): Out {
  return { text: b(W.S2_TITLE), keyboard: [...timeKeyboard('settings'), [{ text: W.BACK, data: encode({ kind: 'settings', screen: 'back' }) }]] };
}

/** S3: until which day nothing comes. */
export function s3(): Out {
  return {
    text: lines(b(W.S3_TITLE), t(W.S3_BODY)),
    keyboard: [
      [{ text: W.PAUSE_1, data: encode({ kind: 'pause', choice: '1' }) }, { text: W.PAUSE_3, data: encode({ kind: 'pause', choice: '3' }) }],
      [{ text: W.PAUSE_MON, data: encode({ kind: 'pause', choice: 'mon' }) }],
      [{ text: W.PAUSE_DATE, data: encode({ kind: 'pause', choice: 'date' }) }, { text: W.BACK, data: encode({ kind: 'settings', screen: 'back' }) }],
    ],
  };
}

/** After a pause is chosen: «Пауза до понедельника, 19 октября.» and when the plan comes back; [Снять паузу]. */
export function pausedScreen(link: Link, until: LocalDay): Out {
  const tomorrow = addDays(link.today, 1);
  return {
    text: lines(b(W.pauseUntil(until, tomorrow)), t(W.pauseBack(until, tomorrow, daysBetween(link.today, until), timeText(link.remindAt)))),
    keyboard: [[{ text: W.UNPAUSE, data: encode({ kind: 'pause', choice: 'off' }) }]],
  };
}

/** «Пауза снята: план придёт сегодня в 20:00.» (or «завтра»). */
export function unpausedScreen(link: Link): Out {
  return { text: t(W.unpaused(comesToday(link) ? 'сегодня' : 'завтра', timeText(link.remindAt))), keyboard: null };
}

/** S4: are you sure. */
export function s4(): Out {
  return {
    text: lines(b(W.S4_TITLE), t(W.S4_BODY)),
    keyboard: [[{ text: W.UNLINK, data: encode({ kind: 'unlink' }), style: 'danger' }], [{ text: W.CANCEL, data: encode({ kind: 'settings', screen: 'back' }) }]],
  };
}

/** After unlinking (S4 or /stop). */
export function unlinkedScreen(site: string): Out {
  return { text: t(W.UNLINKED_DONE), keyboard: [[{ text: W.OPEN_PROFILE, url: `${site}${W.PATH.profile}` }]] };
}

/** S5 `/help`. */
export function s5(): Out {
  return { text: lines(b(W.HELP_TITLE), t(W.HELP.join('\n'))), keyboard: null };
}

/** S6: a text outside a question. */
export function s6(): Out {
  return { text: t(W.BUTTONS_ONLY), keyboard: null };
}

/** K2's answers. */
export const k2Yes = (link: Link): Out => ({ text: t(W.k2YesDone(timeText(link.remindAt))), keyboard: null });
export const k2No = (): Out => ({ text: t(W.K2_NO_DONE), keyboard: null });

// ─────────────────────────────────────────── days ───────────────────────────────────────────

/** The first day the card comes again for a pause button. */
export function pauseDay(choice: '1' | '3' | 'mon', today: LocalDay): LocalDay {
  if (choice === '1') return addDays(today, 1);
  if (choice === '3') return addDays(today, 3);
  const toMonday = (7 - weekday(today)) % 7;
  return addDays(today, toMonday === 0 ? 7 : toMonday);
}

/** Whether a card can still come today when the pause comes off (the 3-hour window, not after 23:00). */
export function comesToday(link: Link): boolean {
  return link.localTime < Math.min(link.remindAt + 180, 23 * 60);
}

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

function realDay(y: number, m: number, d: number): LocalDay | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * «25.10», «25.10.2026», «25/10/26», «25-10», «25 10», «25 октября» → a local day. Without a year: this year, or the
 * next one when that day was more than half a year ago (in December «05.01» means January). null: not a date.
 */
export function parseDate(text: string, today: LocalDay): LocalDay | null {
  const s = text.trim().toLowerCase().replace(/ё/g, 'е');
  let d: number;
  let m: number;
  let y: number | null = null;
  const numeric = /^(\d{1,2})\s*[./\-\s]\s*(\d{1,2})(?:\s*[./\-\s]\s*(\d{2}|\d{4}))?\.?$/.exec(s);
  const words = /^(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?\.?$/.exec(s);
  if (numeric) {
    d = Number(numeric[1]);
    m = Number(numeric[2]);
    if (numeric[3]) y = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
  } else if (words) {
    d = Number(words[1]);
    const index = MONTHS.findIndex((stem) => (stem === 'ма' ? /^ма[йяе]$/.test(words[2]) : words[2].startsWith(stem)));
    if (index < 0) return null;
    m = index + 1;
    if (words[3]) y = Number(words[3]);
  } else {
    return null;
  }
  if (y !== null) return realDay(y, m, d);
  const thisYear = Number(today.slice(0, 4));
  const guess = realDay(thisYear, m, d);
  if (guess === null) return realDay(thisYear + 1, m, d);
  return daysBetween(guess, today) > 183 ? realDay(thisYear + 1, m, d) : guess;
}

// ─────────────────────────────────────────── handlers ───────────────────────────────────────────

/** S1 in this message (or anew when it is gone or unknown). */
export async function showSettings(ctx: Ctx, chatId: number, messageId: number | null, link: Link): Promise<void> {
  const today = await ctx.db.today(link.tgUserId);
  const exam = today ? planNow(today).exam : null;
  const out = s1(today?.link ?? link, exam);
  await editOrSend(ctx.tg, { chatId, messageId, text: out.text, keyboard: out.keyboard });
}

/** `/settings`: S1 as a new message; the typed command goes away. */
export async function settingsCommand(ctx: Ctx, msg: TgMessage, link: Link): Promise<void> {
  await showSettings(ctx, msg.chat.id, null, link);
  await remove(ctx.tg, msg.chat.id, msg.message_id);
}

/** `/stop`: unlink without asking. */
export async function stopCommand(ctx: Ctx, msg: TgMessage, linked: boolean): Promise<void> {
  if (linked) await ctx.db.chatEvent(msg.from?.id ?? msg.chat.id, 'stop');
  const out = unlinkedScreen(ctx.site);
  await send(ctx.tg, { chatId: msg.chat.id, text: out.text, keyboard: out.keyboard });
}

/** `/help`. */
export async function helpCommand(ctx: Ctx, msg: TgMessage): Promise<void> {
  await send(ctx.tg, { chatId: msg.chat.id, text: s5().text });
}

/** S6, when the database says this hour has none yet. */
export async function buttonsOnly(ctx: Ctx, msg: TgMessage, link: Link): Promise<void> {
  const result = await ctx.db.settings(link.tgUserId, { hint: true });
  if (result.status === 'ok' && result.hint) await send(ctx.tg, { chatId: msg.chat.id, text: s6().text });
}

async function editTo(ctx: Ctx, tap: Tap, out: Out): Promise<void> {
  if (tap.messageId) {
    const result = await edit(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, text: out.text, keyboard: out.keyboard });
    if (result !== 'gone') return;
  }
  await send(ctx.tg, { chatId: tap.chatId, text: out.text, keyboard: out.keyboard });
}

type SettingsCallback = Extract<Callback, { kind: 'settings' | 'time' | 'pause' | 'unlink' | 'ask' }>;

/** Every press of S1–S4 and K2 (M2's time buttons are link.ts's). `link` comes from `bot_whoami`. */
export async function settingsTap(ctx: Ctx, tap: Tap, cb: SettingsCallback, link: Link): Promise<void> {
  switch (cb.kind) {
    case 'settings': {
      await tap.answer();
      if (cb.screen === 'time') await editTo(ctx, tap, s2());
      else if (cb.screen === 'pause') await editTo(ctx, tap, s3());
      else if (cb.screen === 'off') await editTo(ctx, tap, s4());
      else await showSettings(ctx, tap.chatId, tap.messageId, link);
      return;
    }
    case 'time': {
      if (cb.minutes === null) return askTime(ctx, tap, 'settings');
      const result = await ctx.db.settings(link.tgUserId, { remind_at: hhmm(cb.minutes) });
      if (result.status === 'unlinked') return tap.answer(W.NOT_LINKED);
      await tap.answer();
      await showSettings(ctx, tap.chatId, tap.messageId, result.status === 'ok' ? result.link : link);
      return;
    }
    case 'pause': {
      if (cb.choice === 'date') {
        await tap.answer();
        await askWith(ctx, tap.chatId, tap.tgUserId, W.DATE_PROMPT, W.DATE_PLACEHOLDER, { kind: 'date', targetId: tap.messageId, from: 'settings' });
        return;
      }
      const until = cb.choice === 'off' ? null : pauseDay(cb.choice, link.today);
      const result = await ctx.db.settings(link.tgUserId, { paused_until: until });
      if (result.status === 'unlinked') return tap.answer(W.NOT_LINKED);
      await tap.answer();
      if (result.status !== 'ok') return showSettings(ctx, tap.chatId, tap.messageId, link);
      await editTo(ctx, tap, until === null ? unpausedScreen(result.link) : pausedScreen(result.link, until));
      return;
    }
    case 'unlink': {
      await ctx.db.chatEvent(link.tgUserId, 'stop');
      await tap.answer();
      await editTo(ctx, tap, unlinkedScreen(ctx.site));
      return;
    }
    case 'ask': {
      // The answer is kept on the K2 row (the pilot's numbers); «Не присылать» also turns the plan off, «Пауза» opens S3.
      const patch = cb.answer === 'y' ? { ask: 'yes' as const } : cb.answer === 'p' ? { ask: 'pause' as const } : { ask: 'stop' as const, remind_on: false };
      const result = await ctx.db.settings(link.tgUserId, patch);
      if (result.status === 'unlinked') return tap.answer(W.NOT_LINKED);
      await tap.answer();
      if (cb.answer === 'p') await editTo(ctx, tap, s3());
      else await editTo(ctx, tap, cb.answer === 'y' ? k2Yes(result.status === 'ok' ? result.link : link) : k2No());
      return;
    }
  }
}

/** A reply to the date prompt: the prompt and the reply go away; the pause is set, or a new prompt says what is wrong. */
export async function dateReply(ctx: Ctx, msg: TgMessage, link: Link, prompt: Prompt): Promise<void> {
  const chatId = msg.chat.id;
  await remove(ctx.tg, chatId, prompt.promptId);
  await remove(ctx.tg, chatId, msg.message_id);
  const day = parseDate(msg.text ?? '', link.today);
  let problem: string | null = null;
  if (day === null) problem = W.DATE_BAD;
  else if (day <= link.today) problem = W.DATE_PAST;
  else {
    const today = await ctx.db.today(link.tgUserId);
    const exam = today ? planNow(today).exam : null;
    if (exam && exam.date && exam.date >= link.today && day > exam.date) problem = W.dateAfterExam(exam.date);
  }
  if (problem === null && day !== null) {
    const result = await ctx.db.settings(link.tgUserId, { paused_until: day, prompt: null });
    if (result.status === 'ok') {
      const out = pausedScreen(result.link, day);
      await editOrSend(ctx.tg, { chatId, messageId: prompt.targetId, text: out.text, keyboard: out.keyboard });
      return;
    }
    if (result.status === 'unlinked') return;
    problem = result.reason === 'past' ? W.DATE_PAST : W.DATE_BAD;
  }
  await askWith(ctx, chatId, link.tgUserId, problem ?? W.DATE_BAD, W.DATE_PLACEHOLDER, prompt);
}
