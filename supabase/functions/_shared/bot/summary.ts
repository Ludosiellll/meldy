/**
 * The end of a «занятие» (spec §4.4): I1 when the session ran out, I2 after «Закончить». One edit turns the session's
 * message into its record, with no key in it; the next session starts in a new message.
 *
 * I1:
 *   <b>Базы данных: 20 вопросов и 6 повторов за 11 минут</b>
 *   Верно 13 · неверно 5 · не знали 2
 *   Ошибки повторили — завтра они вернутся.
 *   В счёт вошли 4 вопроса: теперь 147 из 960.
 *   (lines by occasion: dropped out of the figure; right again too early; only on the site — over 4096)
 *
 *   Сегодня осталось 70 вопросов, около 35 минут.
 *   [[Дальше: Компьютерные сети]] or [[Ещё 20 вопросов]] / [Открыть занятие] (the Mini App, web_app) / [Готово];
 *   the day done: [[Готово]] / [Ещё 20 новых]
 * I2: the same record with «Ошибки вернутся завтра.» and [[Продолжить: 8 из 20]] (today only).
 *
 * The numbers come from the session's counts (T5's `counts`); the figure («147 из 960»), the line of the rest of the
 * day and «Ещё 20 новых» are the copied plan's own words (words.ts through card.ts and today.ts): the bot words no
 * number itself. Comments stay in English: a test reads the Russian strings for forbidden words.
 */
import { encode } from './codec.ts';
import { b, lines, t } from './html.ts';
import type { Button, Keyboard, Out } from './tg.ts';
import * as W from './words.ts';
import { figureLines, glue, plural } from '../plan/words.ts';
import { S } from './render.ts';

/** What one session did, counted by the database as the answers were recorded. */
export interface SessionCounts {
  /** Planned questions answered (their first answer, «Нажали не туда?» included). */
  questions: number;
  /** First answers (not the session's own retries): right, wrong, «Не знаю». */
  right: number;
  wrong: number;
  dontKnow: number;
  /** «Нажали не туда?»: neither right nor a mistake. */
  misclicks: number;
  /** Answers to the session's own retries of mistakes («повтор, не считается»). */
  retries: number;
  /** Questions that reached «выучено» (step `two_days`). */
  gained: number;
  /** Questions in the figure that a mistake took out of it. */
  dropped: number;
  /** Right again, but within 20 hours (step `too_early`). */
  tooEarly: number;
  /** Right for the first time (step `start`): they count after another day and 20 hours. */
  started: number;
  /** Left to the site: longer than a Telegram message. */
  skipped: number;
  /** Set aside: «Сомневаюсь в ключе». */
  doubted: number;
}

export function emptyCounts(): SessionCounts {
  return { questions: 0, right: 0, wrong: 0, dontKnow: 0, misclicks: 0, retries: 0, gained: 0, dropped: 0, tooEarly: 0, started: 0, skipped: 0, doubted: 0 };
}

/** A button of the record that starts the next session (`go|<cid>|p`, `e`, `x`). */
export interface NextBlock {
  label: string;
  data: string;
}

/** What is left today, in the plan's words (today.ts `restOfDay`). */
export interface RestOfDay {
  /** «Сегодня осталось 70 вопросов, около 35 минут.», «На сегодня всё: 90 вопросов за 45 минут.», '' for none. */
  line: string;
  /** Lines under it: «Дальше: <предмет>.» when the button names only the count; «Ещё 12 вопросов — после 17:00». */
  extra: string[];
  /** The next block: «Ещё 20 вопросов» (the same subject) or «Дальше: <предмет>». */
  next: NextBlock | null;
  /** The day is done: «Ещё 20 новых». */
  moreNew: NextBlock | null;
  /** A quiet way to the site (oral questions are planned there). */
  link: { label: string; url: string } | null;
  /** «Открыть занятие»: the same day in the Mini App (`web_app`), while there is a next block today. */
  app?: { label: string; webApp: string } | null;
}

export interface SummaryInput {
  sid: string;
  /** The session's position now (its buttons carry it). */
  pos: number;
  subject: string;
  counts: SessionCounts;
  /** Questions of the session shown and answered, retries apart. */
  questions: number;
  minutes: number;
  /** done: the session ran out (I1); stopped: «Закончить» (I2). */
  end: 'done' | 'stopped';
  /** The figure after the session: «теперь 147 из 960». */
  figure: { twoDays: number; inPlan: number } | null;
  /** While the figure is 0: the plan's line «Ответьте верно ещё раз завтра после 17:00, и первые вопросы будут выучены». */
  firstCount: string | null;
  /** When the too-early ones can count today («19:00»), or null for `back`. */
  tooEarlyAt: string | null;
  /**
   * When the plan brings the session's questions back: «завтра» (the default), or the next study day when tomorrow is
   * a day off («в понедельник»: the copied words.ts nextStudyDayWord with the exam's settings.study_weekdays).
   */
  back?: string;
  rest: RestOfDay;
  /** I2: «Продолжить: 8 из 20» (today only). */
  resume: { n: number; of: number } | null;
}

const sentence = (text: string) => (/[.?…]$/.test(text) ? text : `${text}.`);

/** «20 вопросов и 6 повторов за 11 минут». */
export function timeLine(questions: number, retries: number, minutes: number): string {
  const what = retries > 0 ? `${glue(questions, 'вопрос', 'вопроса', 'вопросов')} и ${glue(retries, 'повтор', 'повтора', 'повторов')}` : glue(questions, 'вопрос', 'вопроса', 'вопросов');
  return `${what} за ${glue(Math.max(1, Math.round(minutes)), 'минуту', 'минуты', 'минут')}`;
}

/** «13 верно, 5 неверно, 2 не знали» (parts that are 0 are left out; the number first, the owner's plain words). */
export function scoreLine(c: SessionCounts): string | null {
  const parts = [[c.right, 'верно'], [c.wrong, 'неверно'], [c.dontKnow, 'не знали']]
    .filter(([n]) => (n as number) > 0)
    .map(([n, word]) => `${n} ${word}`);
  if (parts.length === 0) return null;
  return parts.join(', ');
}

/** The mistakes of the session: repeated in it (I1) or not yet (I2); they come back `when` (SummaryInput `back`). */
export function errorsLine(c: SessionCounts, end: SummaryInput['end'], when = 'завтра'): string | null {
  if (c.wrong + c.dontKnow === 0) return null;
  return end === 'done' && c.retries > 0 ? `Ошибки повторили. ${when.charAt(0).toUpperCase()}${when.slice(1)} повторим их ещё раз.` : `Ошибки повторим ${when}.`;
}

/** «Выучено ещё 4 вопроса. Всего 147 из 960.» — the figure in the plan's words (words.ts figureLines). */
export function gainedLine(gained: number, figure: { twoDays: number; inPlan: number }): string {
  const words = figureLines({ inPlan: figure.inPlan, twoDays: figure.twoDays, seen: 0, errors: 0, selfKnow: 0 }, null);
  return `${plural(gained, 'Выучен', 'Выучено', 'Выучено')} ещё ${glue(gained, 'вопрос', 'вопроса', 'вопросов')}. Всего ${words.big} ${words.of}.`;
}

export const NEW_LATER = 'Новые вопросы будут выучены, если ответите на них верно ещё раз в другой день.';

/** Questions that counted and got a mistake today (as the site's end screen says it). */
export function droppedLine(n: number): string {
  return `${glue(n, 'выученный вопрос', 'выученных вопроса', 'выученных вопросов')} снова с ошибкой. ${plural(n, 'Его', 'Их', 'Их')} нужно выучить заново.`;
}

/** Right again, but sooner than 20 hours: answer after 19:00 today, else on the day they come back (as the site). */
export function tooEarlyLine(n: number, at: string | null, day = 'завтра'): string {
  const when = at ? `после ${at}` : day;
  return `${glue(n, 'вопрос', 'вопроса', 'вопросов')} ещё не ${plural(n, 'выучен', 'выучены', 'выучены')}, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз ${when}.`;
}

export function skippedLine(n: number): string {
  return `${glue(n, 'вопрос', 'вопроса', 'вопросов')} можно решить только на сайте, ${plural(n, 'он не помещается', 'они не помещаются', 'они не помещаются')} в сообщение Telegram.`;
}

/** The count lines between the score and the rest of the day. */
function figureLinesOf(input: SummaryInput): string[] {
  const c = input.counts;
  const out: string[] = [];
  if (c.gained > 0 && input.figure && input.figure.twoDays > 0) out.push(gainedLine(c.gained, input.figure));
  else if (c.gained === 0 && input.firstCount) out.push(sentence(input.firstCount));
  else if (c.gained === 0 && c.started > 0) out.push(NEW_LATER);
  if (c.dropped > 0) out.push(droppedLine(c.dropped));
  if (c.tooEarly > 0) out.push(tooEarlyLine(c.tooEarly, input.tooEarlyAt, input.back));
  if (c.skipped > 0) out.push(skippedLine(c.skipped));
  return out;
}

const row = (button: Button): Button[] => [button];

/** I1 / I2: the record of the session and its buttons. */
export function summaryOut(input: SummaryInput): Out {
  const c = input.counts;
  const title = input.questions > 0 ? `${input.subject}: ${timeLine(input.questions, c.retries, input.minutes)}` : input.subject;
  const rest = input.rest;
  const restLines = [rest.line, ...rest.extra].filter((line) => line.trim() !== '');
  const text = lines(
    b(title),
    ...[scoreLine(c), errorsLine(c, input.end, input.back), ...figureLinesOf(input)].filter((line): line is string => Boolean(line)).map(t),
    restLines.length > 0 ? '' : null,
    ...restLines.map(t),
  );

  const done = encode({ kind: 'session', sid: input.sid, pos: input.pos, act: { a: 'done' } });
  const keyboard: Keyboard = [];
  if (input.end === 'stopped' && input.resume) {
    const data = encode({ kind: 'session', sid: input.sid, pos: input.pos, act: { a: 'continue' } });
    keyboard.push(row({ text: W.resume(input.resume.n, input.resume.of), data, style: 'primary' }));
  } else if (input.end === 'done' && rest.next) {
    // Two ways on (in the chat, or the same day in the Mini App), then «Готово».
    keyboard.push(row({ text: rest.next.label, data: rest.next.data, style: 'primary' }));
    if (rest.app) keyboard.push(row({ text: rest.app.label, webApp: rest.app.webApp }));
    keyboard.push(row({ text: S.done, data: done }));
  } else if (input.end === 'done' && rest.moreNew) {
    keyboard.push(row({ text: S.done, data: done, style: 'primary' }), row({ text: rest.moreNew.label, data: rest.moreNew.data }));
  } else {
    keyboard.push(row({ text: S.done, data: done, style: input.end === 'done' ? 'primary' : undefined }));
  }
  if (rest.link) keyboard.push(row({ text: rest.link.label, url: rest.link.url }));
  return { text, keyboard };
}

/** The labels of the next block: «Ещё 20 вопросов», «Дальше: <предмет>» (≤ 26), else «Дальше: 20 вопросов» + a line. */
export function nextLabels(sameSubject: boolean, subject: string, count: number): { label: string; line: string | null } {
  if (sameSubject) return { label: `Ещё ${glue(count, 'вопрос', 'вопроса', 'вопросов')}`, line: null };
  const named = `${S.next}: ${subject.replace(/\s+/g, ' ').trim()}`;
  if ([...named].length <= 26) return { label: named, line: null };
  return { label: `${S.next}: ${glue(count, 'вопрос', 'вопроса', 'вопросов')}`, line: `${S.next}: ${subject.replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '')}.` };
}
