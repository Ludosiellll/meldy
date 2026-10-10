/**
 * Linking (spec §4.1, M1–M6): `/start` without a code, `/start L<32 hex>` from the profile or from «Напоминать в
 * Telegram», the time of the daily plan (M2 → M3), «Другое время» with a ForceReply prompt (M4), the refusals (M5) and
 * the note to a chat the account left (M6).
 *
 * The code message is deleted once it is used (an incoming private message can be deleted within 48 h). A retried
 * delivery of the same code from the same Telegram is `linked` again, so M2 comes again (decision 6). Every payload
 * goes to `bot_link_claim`, so garbage counts toward its 10 failures an hour.
 */
import { startLabel } from '../plan/words.ts';
import { planNow, timeText } from './card.ts';
import { encode } from './codec.ts';
import type { ClaimResult, Link, Prompt } from './db.ts';
import { hhmm } from './db.ts';
import { b, lines, t } from './html.ts';
import type { Ctx, Tap } from './router.ts';
import { editOrSend, remove, send, type Keyboard, type Out, type TgMessage } from './tg.ts';
import * as W from './words.ts';

/** The texts the bot asks a time with: a reply to one of them is a time. */
export const TIME_PROMPTS: readonly string[] = [W.TIME_PROMPT, W.TIME_BAD, W.TIME_RANGE];

const profileButton = (site: string): Keyboard => [[{ text: W.OPEN_PROFILE, url: `${site}${W.PATH.profile}` }]];

/** M1: not linked. */
export function m1(site: string): Out {
  return { text: t(W.M1.join('\n')), keyboard: [[{ text: W.OPEN_PROFILE, url: `${site}${W.PATH.profile}`, style: 'primary' }]] };
}

/** The quick times and «Другое время» (M2 and S2). */
export function timeKeyboard(from: 'link' | 'settings'): Keyboard {
  return [
    W.TIME_OPTIONS.map((minutes) => ({ text: timeText(minutes), data: encode({ kind: 'time', minutes, from }) })),
    [{ text: W.OTHER_TIME, data: encode({ kind: 'time', minutes: null, from }) }],
  ];
}

/** M2: linked; the exam that leads and the time of the plan. No blue: the choice is the step. */
export function m2(exam: { title: string; date: string | null } | null, remindAt: number): Out {
  return {
    text: lines(b(W.M2_TITLE), t(exam ? W.examIs(exam.title, exam.date) : W.NO_EXAM), '', t(W.m2Time(timeText(remindAt)))),
    keyboard: timeKeyboard('link'),
  };
}

/** M3: the time is set; today's plan in the plan's words and «Начать». */
export function m3(site: string, remindAt: number, plan: ReturnType<typeof planNow>): Out {
  const title = b(W.m3Title(timeText(remindAt)));
  if (!plan.exam) {
    return { text: lines(title, t(W.NO_EXAM_UPLOAD)), keyboard: [[{ text: W.UPLOAD, url: `${site}${W.PATH.upload}`, style: 'primary' }]] };
  }
  const exam = plan.exam;
  const first = exam.plan.state === 'study' ? exam.plan.sessions.find((s) => s.kind === 'answer') : undefined;
  if (!first) return { text: lines(title, t(plan.line)), keyboard: null };
  return {
    text: lines(title, t(plan.line), '', t(W.M3_SETTINGS)),
    keyboard: [[{ text: startLabel(first.ids.length, null, null), data: encode({ kind: 'go', cid: exam.id, mode: 'p' }), style: 'primary' }]],
  };
}

/** M5: the code did not work (nothing for `private_only`: that is a group). */
export function m5(status: ClaimResult['status'], site: string): Out | null {
  switch (status) {
    case 'used': return { text: t(W.LINK_USED), keyboard: profileButton(site) };
    case 'expired': return { text: t(W.LINK_EXPIRED), keyboard: profileButton(site) };
    case 'invalid': return { text: t(W.LINK_INVALID), keyboard: profileButton(site) };
    case 'slow_down': return { text: t(W.LINK_SLOW), keyboard: null };
    default: return null;
  }
}

/** M6: once, to the chat the account left. */
export const m6 = (): Out => ({ text: t(W.LINK_MOVED), keyboard: null });

/** `/start <payload>` in a private chat (any payload but a group's `g…`). */
export async function claimLink(ctx: Ctx, msg: TgMessage, code: string): Promise<void> {
  const from = msg.from as { id: number; language_code?: string };
  const chatId = msg.chat.id;
  const result = await ctx.db.linkClaim({ code, tgUserId: from.id, chatId, lang: from.language_code ?? null, messageDate: msg.date });
  if (result.status !== 'linked') {
    const out = m5(result.status, ctx.site);
    if (out) await send(ctx.tg, { chatId, text: out.text, keyboard: out.keyboard });
    return;
  }
  const today = await ctx.db.today(from.id);
  const lead = today ? planNow(today).exam : null;
  const out = m2(lead ? { title: lead.title, date: lead.date } : null, today?.link.remindAt ?? 20 * 60);
  await send(ctx.tg, { chatId, text: out.text, keyboard: out.keyboard });
  await remove(ctx.tg, chatId, msg.message_id);
  if (result.replacedChatId !== null && result.replacedChatId !== chatId) {
    // Blocked or gone there: nothing more to do.
    await send(ctx.tg, { chatId: result.replacedChatId, text: m6().text }).catch(() => undefined);
  }
}

/** M3 in place of M2 (or anew, when M2 is gone or unknown). */
export async function showM3(ctx: Ctx, chatId: number, messageId: number | null, link: Link): Promise<void> {
  const today = await ctx.db.today(link.tgUserId);
  const out = m3(ctx.site, link.remindAt, today ? planNow(today) : { exam: null, line: W.NO_EXAM_UPLOAD });
  await editOrSend(ctx.tg, { chatId, messageId, text: out.text, keyboard: out.keyboard });
}

/** A time from M2's buttons: save it (it turns the plan on), M2 becomes M3. */
export async function timeChosen(ctx: Ctx, tap: Tap, minutes: number): Promise<void> {
  const result = await ctx.db.settings(tap.tgUserId, { remind_at: hhmm(minutes) });
  if (result.status === 'unlinked') return tap.answer(W.NOT_LINKED);
  await tap.answer();
  if (result.status === 'ok') await showM3(ctx, tap.chatId, tap.messageId, result.link);
}

/** A ForceReply prompt (M4 time, S3 date); the database keeps which message it answers for. */
export async function askWith(ctx: Ctx, chatId: number, tgUserId: number, text: string, placeholder: string,
  prompt: Pick<Prompt, 'kind' | 'targetId' | 'from'>): Promise<void> {
  const sent = await send(ctx.tg, { chatId, text: t(text), forceReply: { placeholder } });
  await ctx.db.settings(tgUserId, {
    prompt: { kind: prompt.kind, prompt_id: sent.message_id, target_id: prompt.targetId, from: prompt.from, at: Math.floor(ctx.now() / 1000) },
  });
}

/** «Другое время» (M2 or S2): M4. */
export async function askTime(ctx: Ctx, tap: Tap, from: 'link' | 'settings'): Promise<void> {
  await tap.answer();
  await askWith(ctx, tap.chatId, tap.tgUserId, W.TIME_PROMPT, W.TIME_PLACEHOLDER, { kind: 'time', targetId: tap.messageId, from });
}

/** «7:45», «19.45», «0745», «7 45», «9» → minutes after midnight; null when it is not a time. */
export function parseTime(text: string): number | null {
  const m = /^\s*(\d{1,2})(?:\s*[:.,\-\s]\s*(\d{2})|(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? m[3] ?? '0');
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** The pending prompt this reply answers: the stored one when the ids match, else a prompt with no target. */
export function promptOf(link: Link, kind: Prompt['kind'], replyToId: number): Prompt {
  if (link.prompt && link.prompt.kind === kind && link.prompt.promptId === replyToId) return link.prompt;
  return { kind, promptId: replyToId, targetId: null, from: 'settings', at: null };
}

/** A prompt still waiting for plain text (not a reply): asked within the last hour. */
export function openPrompt(link: Link, nowMs: number): Prompt | null {
  const p = link.prompt;
  return p && p.at !== null && nowMs / 1000 - p.at < 3600 ? p : null;
}

/**
 * A reply to the time prompt: the prompt and the reply are deleted; then M2 becomes M3 (or S1 shows the new time), or a
 * new prompt with what is wrong replaces the old one.
 */
export async function timeReply(ctx: Ctx, msg: TgMessage, link: Link, prompt: Prompt,
  showSettings: (chatId: number, messageId: number | null, link: Link) => Promise<void>): Promise<void> {
  const chatId = msg.chat.id;
  await remove(ctx.tg, chatId, prompt.promptId);
  await remove(ctx.tg, chatId, msg.message_id);
  const minutes = parseTime(msg.text ?? '');
  if (minutes === null || minutes < W.TIME_MIN || minutes > W.TIME_MAX) {
    await askWith(ctx, chatId, link.tgUserId, minutes === null ? W.TIME_BAD : W.TIME_RANGE, W.TIME_PLACEHOLDER, prompt);
    return;
  }
  const result = await ctx.db.settings(link.tgUserId, { remind_at: hhmm(minutes), prompt: null });
  if (result.status !== 'ok') return;
  if (prompt.from === 'link') await showM3(ctx, chatId, prompt.targetId, result.link);
  else await showSettings(chatId, prompt.targetId, result.link);
}
