/**
 * Which exams the day plan includes, and «Перенести экзамен» (release 47, docs/superpowers/plans/
 * 2026-10-18-exam-move-bot-exams.md; the owner, 2026-10-18: the plan could not be turned off for one exam or sent for
 * several, and a passed exam could not be moved with a button).
 *
 * - «Экзамены» (S1, and the day card with two exams or more): «Какие экзамены присылать», a row per exam
 *   «✓ Осенняя сессия · 3 ноября» (in the plan) / «— Зимняя сессия · 20 декабря» (not); a press switches it
 *   (bot_exam_remind) and the screen shows the new state; «‹ Назад» returns to S1 or to the card. Every screen is an
 *   edit of the same message.
 * - «Перенести экзамен»: K3 and the /today card of a passed exam carry the choices; the exam-day card opens them in
 *   place of its keyboard. «Перенести на неделю» / «На 2 недели» are 7 / 14 days from the link's local day; «Другая
 *   дата» is typed (a ForceReply, like the pause's date). The author of an exam with active members then picks
 *   «Для всех участников» / «Только для меня»; without members it moves for everyone; a member moves it for themselves
 *   (bot_exam_move, the rules of exam_date_move on the link's day). The answer: «Экзамен «…» перенесён на 25 октября.
 *   План пересчитан.» with «План на сегодня».
 */
import type { LocalDay } from '../plan/container.ts';
import { addDays } from '../plan/time.ts';
import { dayCard, moveKeyboard } from './card.ts';
import { encode, type Callback, type ExamsFrom } from './codec.ts';
import type { BotExam, Link, MoveFor, Prompt } from './db.ts';
import { b, lines, t } from './html.ts';
import { askWith } from './link.ts';
import type { Ctx, Tap } from './router.ts';
import { parseDate } from './settings.ts';
import { editKeyboard, editOrSend, remove, send, type Keyboard, type Out, type TgMessage } from './tg.ts';
import * as W from './words.ts';

/** At most this many exams on «Экзамены» (nearest first; the passed ones last). */
export const MAX_EXAM_ROWS = 12;
/** A full-width button (§3). */
const FULL = 26;
/** The furthest move: today + 730 days (exam_date_move). */
export const MOVE_MAX_DAYS = 730;

/**
 * «✓ Осенняя · 3 ноября» when it fits a full-width button (26, §3); else the title alone «✓ Осенняя сессия» (the name
 * is what the student knows the exam by); a title longer than that is shortened with «…».
 */
export function choiceLabel(exam: Pick<BotExam, 'on' | 'title' | 'date'>): string {
  const full = W.examChoice(exam.on, exam.title, exam.date);
  if ([...full].length <= FULL) return full;
  const bare = W.examChoice(exam.on, exam.title, null);
  if ([...bare].length <= FULL) return bare;
  const room = FULL - [...W.examChoice(exam.on, '', null)].length - 1;
  return W.examChoice(exam.on, `${[...exam.title].slice(0, room).join('').trimEnd()}…`, null);
}

const backTo = (from: ExamsFrom) => (from === 's' ? encode({ kind: 'settings', screen: 'back' }) : encode({ kind: 'card' }));

/** «Какие экзамены присылать»: a row per exam that switches it, and «‹ Назад». */
export function examsScreen(exams: readonly BotExam[], from: ExamsFrom): Out {
  if (exams.length === 0) return { text: lines(b(W.EXAMS_TITLE), t(W.NO_EXAM)), keyboard: [[{ text: W.BACK, data: backTo(from) }]] };
  const keyboard: Keyboard = exams.slice(0, MAX_EXAM_ROWS)
    .map((exam) => [{ text: choiceLabel(exam), data: encode({ kind: 'remind', cid: exam.id, on: !exam.on, from }) }]);
  keyboard.push([{ text: W.BACK, data: backTo(from) }]);
  return { text: lines(b(W.EXAMS_TITLE), t(W.EXAMS_BODY)), keyboard };
}

/** The author of an exam with members: for everyone, or only for them. */
export function moveAskScreen(title: string, date: LocalDay, cid: string): Out {
  return {
    text: lines(b(W.moveAsk(title, date)), t(W.MOVE_ASK_BODY)),
    keyboard: [
      [{ text: W.MOVE_FOR_ALL, data: encode({ kind: 'moveFor', cid, date, who: 'all' }) }],
      [{ text: W.MOVE_FOR_ME, data: encode({ kind: 'moveFor', cid, date, who: 'me' }) }],
    ],
  };
}

/** «Экзамен «…» перенесён на 25 октября. План пересчитан.» and «План на сегодня». */
export function movedScreen(title: string, date: LocalDay): Out {
  return { text: t(W.examMoved(title, date)), keyboard: [[{ text: W.PLAN_TODAY, data: encode({ kind: 'card' }) }]] };
}

/** A reply to one of these texts is the date of a move. */
export function isMovePrompt(text: string): boolean {
  return text === W.MOVE_PROMPT || text === W.MOVE_BAD || text === W.MOVE_PAST || text === W.MOVE_FAR;
}

/** What is wrong with a typed date of a move (null: fine): not a date, before today, more than 730 days ahead. */
export function moveDateProblem(day: LocalDay | null, today: LocalDay): string | null {
  if (day === null) return W.MOVE_BAD;
  if (day < today) return W.MOVE_PAST;
  if (day > addDays(today, MOVE_MAX_DAYS)) return W.MOVE_FAR;
  return null;
}

/** Where a move answers: a press (the spinner, a line, an edit) or a typed date (a message, the target edited). */
interface Place {
  ack(): Promise<void>;
  say(text: string): Promise<void>;
  show(out: Out): Promise<void>;
}

function tapPlace(ctx: Ctx, tap: Tap): Place {
  return {
    ack: () => tap.answer(),
    say: (text) => tap.answer(text),
    async show(out) {
      await editOrSend(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, text: out.text, keyboard: out.keyboard });
    },
  };
}

function replyPlace(ctx: Ctx, chatId: number, targetId: number | null): Place {
  return {
    async ack() {},
    async say(text) {
      await send(ctx.tg, { chatId, text: t(text) });
    },
    async show(out) {
      await editOrSend(ctx.tg, { chatId, messageId: targetId, text: out.text, keyboard: out.keyboard });
    },
  };
}

/** The move itself, for whom it is decided. */
async function moveFor(ctx: Ctx, place: Place, tgUserId: number, cid: string, date: LocalDay, forWhom: MoveFor): Promise<void> {
  const result = await ctx.db.examMove(tgUserId, cid, date, forWhom);
  switch (result.status) {
    case 'ok':
      await place.ack();
      await place.show(movedScreen(result.title, date));
      return;
    case 'invalid':
      return place.say(result.reason === 'far' ? W.MOVE_FAR : W.MOVE_PAST);
    case 'forbidden':
      return place.say(W.MOVE_ONLY_OWNER);
    case 'gone':
      return place.say(W.EXAM_GONE);
    default:
      return place.say(W.NOT_LINKED);
  }
}

/** A date chosen: the author of an exam with members chooses for whom; otherwise it moves (for everyone / for me). */
async function moveTo(ctx: Ctx, place: Place, tgUserId: number, cid: string, date: LocalDay, exams: readonly BotExam[]): Promise<void> {
  const exam = exams.find((e) => e.id === cid);
  if (!exam) return place.say(W.EXAM_GONE);
  if (exam.role === 'owner' && exam.members > 0) {
    await place.ack();
    await place.show(moveAskScreen(exam.title, date, cid));
    return;
  }
  return moveFor(ctx, place, tgUserId, cid, date, exam.role === 'owner' ? 'all' : 'me');
}

type ExamsCallback = Extract<Callback, { kind: 'exams' | 'remind' | 'card' | 'move' | 'moveFor' }>;

/** Every press of «Экзамены» and «Перенести экзамен»; the user comes from the bot's own SQL (bot_exams, …). */
export async function examsTap(ctx: Ctx, tap: Tap, cb: ExamsCallback): Promise<void> {
  const place = tapPlace(ctx, tap);
  switch (cb.kind) {
    case 'exams': {
      const result = await ctx.db.exams(tap.tgUserId);
      if (result.status !== 'ok') return tap.answer(W.NOT_LINKED);
      await tap.answer();
      return place.show(examsScreen(result.exams, cb.from));
    }
    case 'remind': {
      const result = await ctx.db.examRemind(tap.tgUserId, cb.cid, cb.on);
      if (result.status === 'unlinked') return tap.answer(W.NOT_LINKED);
      if (result.status !== 'ok') {
        // Not the user's exam any more: the line says so, the list shows what is there now.
        await tap.answer(W.EXAM_GONE);
        const now = await ctx.db.exams(tap.tgUserId);
        if (now.status === 'ok') await place.show(examsScreen(now.exams, cb.from));
        return;
      }
      await tap.answer();
      return place.show(examsScreen(result.exams, cb.from));
    }
    case 'card': {
      const today = await ctx.db.today(tap.tgUserId);
      if (!today) return tap.answer(W.NOT_LINKED);
      await tap.answer();
      return place.show(dayCard(today, 'today', ctx.site).out);
    }
    case 'move': {
      if (cb.act === 'open') {
        await tap.answer();
        if (tap.messageId) await editKeyboard(ctx.tg, { chatId: tap.chatId, messageId: tap.messageId, keyboard: moveKeyboard(cb.cid, true) });
        return;
      }
      if (cb.act === 'date') {
        await tap.answer();
        await askWith(ctx, tap.chatId, tap.tgUserId, W.MOVE_PROMPT, W.DATE_PLACEHOLDER, { kind: 'move', targetId: tap.messageId, from: 'settings', cid: cb.cid });
        return;
      }
      const list = await ctx.db.exams(tap.tgUserId);
      if (list.status !== 'ok' || list.today === null) return tap.answer(W.NOT_LINKED);
      return moveTo(ctx, place, tap.tgUserId, cb.cid, addDays(list.today, cb.act === 'w1' ? 7 : 14), list.exams);
    }
    case 'moveFor':
      return moveFor(ctx, place, tap.tgUserId, cb.cid, cb.date, cb.who);
  }
}

/**
 * A typed date of a move (a reply to its prompt, or plain text within the hour): the prompt and the reply go away; a
 * date that is not one, has passed or is too far asks again; otherwise the move, its answer in place of the message the
 * move came from (K3, the card).
 */
export async function moveReply(ctx: Ctx, msg: TgMessage, link: Link, prompt: Prompt): Promise<void> {
  const chatId = msg.chat.id;
  await remove(ctx.tg, chatId, prompt.promptId);
  await remove(ctx.tg, chatId, msg.message_id);
  if (!prompt.cid) {
    await send(ctx.tg, { chatId, text: t(W.MOVE_LOST) });
    return;
  }
  const day = parseDate(msg.text ?? '', link.today);
  const problem = moveDateProblem(day, link.today);
  if (problem !== null || day === null) {
    await askWith(ctx, chatId, link.tgUserId, problem ?? W.MOVE_BAD, W.DATE_PLACEHOLDER, prompt);
    return;
  }
  await ctx.db.settings(link.tgUserId, { prompt: null });
  const list = await ctx.db.exams(link.tgUserId);
  if (list.status !== 'ok') return;
  await moveTo(ctx, replyPlace(ctx, chatId, prompt.targetId), link.tgUserId, prompt.cid, day, list.exams);
}
