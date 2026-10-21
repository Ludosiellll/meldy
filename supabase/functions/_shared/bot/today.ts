/**
 * The plan side of a «занятие» in chat: what a start takes from today's plan, and what the record of a session offers
 * next (spec §4.3, §4.4, decisions 10–11, 18). Pure: the plan input and the day's plan come from T2's one seam,
 * card.ts `dayView` (the decoded `plan_inputs` of every exam, planned by the copied `planDay`); nothing here decodes the
 * wire or plans on its own, so the bot and «Сегодня» count the same.
 *
 * - «Начать» / «Ещё 20 вопросов» / «Дальше: …» (`go|<cid>|p`): the next block of the plan — the copied `buildSession` on
 *   the plan's first block with options (20 questions of one subject), seeded by the session id.
 * - «Только ошибки» / «Пройтись по ошибкам» (`go|<cid>|e`): the copied `freeSession` with `onlyErrors`, on the first
 *   subject (the exam day's subjects first) that has errors not answered today, else the first with any; today's
 *   mistakes are in the session too, after the older ones (as the site's studySetup).
 * - «Ещё 20 новых» (`go|<cid>|x`): the copied `extraNew` past today's plan, in a seeded order.
 *
 * `answeredToday` and `clsOf` mirror the site's components/containers/model.ts (they are not in the copied modules).
 */
import { dayView, planSentence, type ExamDay } from './card.ts';
import { encode, type GoMode } from './codec.ts';
import type { Today } from './db.ts';
import * as W from './words.ts';
import type { LocalDay, PlanCls, PlanInput, UnitState } from '../plan/container.ts';
import { extraNew, SESSION_SIZE } from '../plan/plan.ts';
import { emptyState, isOpenError, isSeen } from '../plan/rule.ts';
import { buildSession, freeSession, shuffled, type QueueEntry } from '../plan/session.ts';
import { addDays, isStudyDay, studyMask } from '../plan/time.ts';
import { lineText, nextStudyDayWord } from '../plan/words.ts';
import { nextLabels, type RestOfDay } from './summary.ts';

export type SessionKind = 'plan' | 'errors' | 'extra';

export const kindOfMode = (mode: GoMode): SessionKind => (mode === 'e' ? 'errors' : mode === 'x' ? 'extra' : 'plan');
export const modeOfKind = (kind: SessionKind): GoMode => (kind === 'errors' ? 'e' : kind === 'extra' ? 'x' : 'p');

/** One exam of today through T2's seam (card.ts `dayView`); null when it is not among the user's exams any more. */
export function examOf(today: Today, containerId: string): ExamDay | null {
  return dayView(today).exams.find((exam) => exam.id === containerId) ?? null;
}

/** Questions answered today (the site's model.ts `answeredToday`): a session never asks them again today. */
export function answeredToday(input: PlanInput, day: LocalDay): Set<string> {
  const out = new Set<string>();
  for (const item of input.items ?? []) if (item.u?.lastDay === day) out.add(item.id);
  return out;
}

/** The plan class of an answer from the question's state (the site's model.ts `clsOf`), for the student's own pace. */
export function clsOf(u: UnitState | undefined, inWindow: boolean): PlanCls {
  if (!u || !isSeen(u)) return 'new_floor';
  if (u.twoDaysAt !== null) return inWindow ? 'final' : 'check';
  if (u.seriesAt !== null) return 'confirm';
  return 'relearn';
}

const subjectTitle = (input: PlanInput, subjectId: string) => input.subjects.find((s) => s.id === subjectId)?.title ?? '';

/** The subject a «Только ошибки» session takes: the first with errors not answered today (the exam day's first). */
export function errorsSubject(exam: ExamDay, done: ReadonlySet<string>): string | null {
  const input = exam.input;
  const day = exam.plan.day;
  const subjects = [...input.subjects].sort((a, c) => Number(c.date === day) - Number(a.date === day));
  const empty = emptyState();
  for (const subject of subjects) {
    const any = (input.items ?? []).some((item) => item.f === 't' && item.s === subject.id && !done.has(item.id) && isOpenError(item.u ?? empty));
    if (any) return subject.id;
  }
  return null;
}

/** What a start takes: the subject, the queue (seeded by the session id) and each question's plan class. */
export interface Block {
  kind: SessionKind;
  subjectId: string;
  subjectTitle: string;
  queue: QueueEntry[];
  cls: PlanCls[];
}

/** The block a `go|<cid>|<mode>` press starts, or null when there is nothing to take. */
export function pickBlock(exam: ExamDay, mode: GoMode, sid: string): Block | null {
  const { input, plan } = exam;
  const done = answeredToday(input, plan.day);
  const units = new Map((input.items ?? []).map((item) => [item.id, item.u]));
  const kind = kindOfMode(mode);
  let subjectId: string | null = null;
  let queue: QueueEntry[] = [];
  let cls: (id: string) => PlanCls;
  try {
    if (kind === 'plan') {
      const first = plan.sessions.find((s) => s.kind === 'answer' && s.ids.length > 0);
      if (first) {
        subjectId = first.subjectId;
        queue = buildSession(plan, first.subjectId, 'answer', [...done], sid);
      }
      const inWindow = Boolean(plan.window.inWindow);
      cls = (id) => clsOf(units.get(id), inWindow);
    } else if (kind === 'errors') {
      // As on the site (studySetup, 20.10): «Только ошибки: N» counts today's mistakes too, so it opens them too — a
      // subject with mistakes not touched today first, else any; freeSession puts the older ones first.
      subjectId = errorsSubject(exam, done) ?? errorsSubject(exam, new Set());
      if (subjectId) queue = freeSession(input, { subjectId, onlyErrors: true }, [], sid);
      cls = () => 'free';
    } else {
      const more = extraNew(input, SESSION_SIZE.answer, plan);
      if (more) {
        subjectId = more.subjectId;
        queue = shuffled(more.ids.filter((id) => !done.has(id)), sid).map((id) => ({ id, retry: 0 as const }));
      }
      cls = () => 'new_fill';
    }
  } catch {
    return null;
  }
  if (!subjectId || queue.length === 0) return null;
  return { kind, subjectId, subjectTitle: subjectTitle(input, subjectId), queue, cls: queue.map((entry) => cls(entry.id)) };
}

const nothing = (line = ''): RestOfDay => ({ line, extra: [], next: null, moreNew: null, link: null });

/**
 * What the record of a session says about the rest of the day and which button starts what (I1): the plan's sentence
 * («Сегодня осталось 70 вопросов, около 35 минут.», «На сегодня всё: …»), the next block — «Ещё 20 вопросов» in the
 * same subject, «Дальше: <предмет>» in another (errors after errors) — or, the day done, «Ещё 20 новых».
 */
export function restOfDay(exam: ExamDay | null, finished: { subjectId: string; kind: SessionKind }, site: string): RestOfDay {
  if (!exam) return nothing();
  const { input, plan } = exam;
  const done = answeredToday(input, plan.day);
  const cid = exam.id;
  const go = (mode: GoMode) => encode({ kind: 'go', cid, mode });
  let line = '';
  try {
    line = planSentence(exam);
  } catch {
    line = '';
  }
  const rest: RestOfDay = { line, extra: [], next: null, moreNew: null, link: null };
  const offer = (subjectId: string, count: number, mode: GoMode) => {
    const labels = nextLabels(subjectId === finished.subjectId, subjectTitle(input, subjectId), count);
    rest.next = { label: labels.label, data: go(mode) };
    if (labels.line) rest.extra.push(labels.line);
  };
  try {
    if (finished.kind === 'errors' || plan.state === 'exam_today') {
      const subjectId = errorsSubject(exam, done);
      const count = subjectId ? freeSession(input, { subjectId, onlyErrors: true }, [], 'count').length : 0;
      if (subjectId && count > 0) offer(subjectId, count, 'e');
    }
    if (!rest.next && plan.state === 'study') {
      const first = plan.sessions.find((s) => s.kind === 'answer' && s.ids.length > 0);
      if (first) {
        offer(first.subjectId, buildSession(plan, first.subjectId, 'answer', [...done], 'count').length, 'p');
      } else {
        // Nothing to answer right now: the plan's «Ещё 12 вопросов — после 17:00» says when.
        const later = plan.lines.find((l) => l.key === 'later');
        if (later) rest.extra.push(`${lineText(later)}.`);
      }
    }
    if (!rest.next && (plan.state === 'done' || plan.state === 'nothing')) {
      const more = plan.lines.find((l) => l.key === 'more_new');
      if (more) {
        rest.moreNew = { label: lineText(more), data: go('x') };
        // «…сейчас — завтра их будет меньше» only when tomorrow is a study day (settings.study_weekdays).
        if (isStudyDay(addDays(plan.day, 1), studyMask(input.studyWeekdays))) rest.line = `${rest.line} ${W.moreNewNote(lineText(more))}`.trim();
      }
    }
    if (exam.hasOral && plan.sessions.some((s) => s.kind !== 'answer' && s.ids.length > 0)) {
      rest.link = { label: W.ORAL_IN_MELDY, url: `${site}${W.PATH.exam(cid)}` };
    }
    // More today: the same day in the Mini App (Telegram_Mini_App_Spec_2026-10-10, decision 2).
    if (rest.next) rest.app = { label: W.OPEN_SESSION, webApp: `${site}${W.PATH.miniApp(cid)}` };
  } catch {
    return nothing(line);
  }
  return rest;
}

/** While the figure is 0: the plan's own «Первые войдут в счёт завтра после 17:00 — если снова ответите верно». */
export function firstCountText(exam: ExamDay | null): string | null {
  if (!exam || exam.plan.figure.twoDays > 0) return null;
  const line = exam.plan.lines.find((l) => l.key === 'first_count');
  return line ? lineText(line) : null;
}

/**
 * When the plan brings back what was answered today (the record's mistakes and too-early ones): «завтра», or the
 * exam's next study day when tomorrow is a day off (settings.study_weekdays) — «в понедельник», as the site's end of
 * a session says it. Without the exam: «завтра».
 */
export function comesBackText(exam: ExamDay | null): string {
  return exam ? comesBackOn(exam.plan.day, exam.input.studyWeekdays) : 'завтра';
}

/**
 * The same word for one press (the review of a mistake, «Нажали не туда?»): the first study day after `day` by the
 * exam's days of the week (`weekdays`, settings.study_weekdays). A day the words cannot read: «завтра».
 */
export function comesBackOn(day: LocalDay, weekdays: number | undefined): string {
  try {
    return nextStudyDayWord(day, studyMask(weekdays));
  } catch {
    return 'завтра';
  }
}
