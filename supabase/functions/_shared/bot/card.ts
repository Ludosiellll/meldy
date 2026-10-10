/**
 * The day card (spec §4.2): K1 in every variant of its table, K2 «Присылать план дальше?», K3 after the date.
 *
 * Each exam is decoded from `plan_inputs` with the copied `planInputs.ts` and planned with the copied `planDay`, so the
 * bot and «Сегодня» count the same. Every plan and count line is the copied `words.ts`; the lead exam is chosen as
 * «Сегодня» chooses it (pages/Dashboard.tsx `todayLayout`): the nearest date among the exams with something to do
 * today, else the nearest whose day is done; ties — the newer exam.
 */
import type { DayPlan, LocalDay, PlanInput } from '../plan/container.ts';
import { decodePlanInputs } from '../plan/planInputs.ts';
import { planDay } from '../plan/plan.ts';
import { figureLines, lineText, planLine, RULE_LINE, shownMinutes, startLabel } from '../plan/words.ts';
import { counter } from '../plan/session.ts';
import { addDays, daysBetween } from '../plan/time.ts';
import { encode } from './codec.ts';
import type { AfterDateRow, Link, Today } from './db.ts';
import { b, lines, t, thousands } from './html.ts';
import type { Button, Keyboard, Out } from './tg.ts';
import * as W from './words.ts';

export interface ExamDay {
  id: string;
  title: string;
  role: 'owner' | 'member';
  /** The nearest test date still ahead (or today), else the last one, else null (TodayExamCard `nearestDate`). */
  date: LocalDay | null;
  daysLeft: number | null;
  createdAt: string | null;
  keyChanges: number;
  hasOral: boolean;
  plan: DayPlan;
  input: PlanInput;
}

export interface DayView {
  day: LocalDay;
  exams: ExamDay[];
  /** The leading exam, or null when there is none to show. */
  main: ExamDay | null;
  /** Other exams with something to do today, nearest first. */
  others: ExamDay[];
  /**
   * What «Другой экзамен» offers, nearest first: the shown exam and those the site's «Сегодня» lists (work today, the
   * exam day, or today's work done). Not an exam without questions: its card would say there is no exam with a plan.
   */
  listed: ExamDay[];
}

const sentence = (text: string) => (/[.?…]$/.test(text) ? text : `${text}.`);

function byDate(a: ExamDay, b: ExamDay): number {
  const left = a.date ?? '9999-12-31';
  const right = b.date ?? '9999-12-31';
  if (left !== right) return left < right ? -1 : 1;
  const ca = a.createdAt ?? '';
  const cb = b.createdAt ?? '';
  return ca > cb ? -1 : ca < cb ? 1 : 0;
}

/**
 * THE one place a plan input is built (the card, M3, S1, the reminder's context, and T6's session start): the copied
 * decoder over `plan_inputs` for one exam, in the link's zone, at the server's clock, with `today.oral` — the oral
 * questions, empty until package T11 supplies them. Throws when the wire has no such exam.
 */
export function planInputOf(today: Today, containerId: string): PlanInput {
  if (!today.wire) throw new Error('planInputOf: no plan input');
  return decodePlanInputs(today.wire, { containerId, tz: today.link.tz, now: today.now, pending: [], oral: today.oral ?? [] });
}

/** Every exam of the user planned for today, and the one the card leads with (`focus`: «Другой экзамен»). */
export function dayView(today: Today, focus?: string | null): DayView {
  const wire = today.wire;
  const exams: ExamDay[] = [];
  let day = today.link.today;
  if (wire && Array.isArray(wire.containers)) {
    wire.containers.forEach((container, index) => {
      try {
        const input = planInputOf(today, container.id);
        const plan = planDay(input);
        day = plan.day;
        const dates = wire.subjects.filter((s) => s.container === index).map((s) => s.test_date).filter((d): d is string => Boolean(d));
        if (dates.length === 0 && container.exam_date) dates.push(container.exam_date);
        const ahead = [...new Set(dates.filter((d) => d >= plan.day))].sort();
        const date = ahead[0] ?? [...dates].sort()[dates.length - 1] ?? null;
        const meta = today.exams.find((e) => e.id === container.id);
        exams.push({
          id: container.id,
          title: container.title,
          role: container.role === 'owner' ? 'owner' : 'member',
          date,
          daysLeft: date === null ? null : daysBetween(plan.day, date),
          createdAt: meta?.createdAt ?? null,
          keyChanges: meta?.keyChanges ?? 0,
          hasOral: meta?.hasOral ?? false,
          plan,
          input,
        });
      } catch {
        // An exam the copied engine cannot read is left out of the card, not the whole card.
      }
    });
  }
  const shown = exams.filter((e) => e.plan.state !== 'after');
  const active = shown.filter((e) => e.plan.state === 'study' || e.plan.state === 'exam_today').sort(byDate);
  const quiet = shown.filter((e) => e.plan.state === 'done' || e.plan.state === 'nothing' || e.plan.state === 'empty').sort(byDate);
  const listable = (e: ExamDay) => e.plan.state === 'study' || e.plan.state === 'exam_today' || e.plan.state === 'done';
  const focused = focus ? shown.find((e) => e.id === focus && listable(e)) ?? null : null;
  const main = focused ?? active[0] ?? quiet[0] ?? null;
  const others = shown.filter((e) => e !== main && e.plan.state === 'study').sort(byDate);
  const listed = shown.filter((e) => e === main || listable(e)).sort(byDate);
  return { day, exams, main, others, listed };
}

/** «Сегодня около 45 минут: 30 новых и 60 знакомых.» with the skip and eve forms of the table. */
export function planSentence(exam: ExamDay): string {
  const plan = exam.plan;
  if (plan.state !== 'study') return sentence(planLine(plan));
  const line = sentence(planLine(plan));
  if (exam.daysLeft === 1) return `${W.EXAM_EVE} ${line}`;
  const skip = plan.lines.find((l) => l.key === 'skip');
  if (skip && plan.counts.estSec <= plan.counts.leftSec) return sentence(lineText(skip));
  return line;
}

/** «143 из 960 — верно в два разных дня»; while it is 0, the dated first-count line; before any answer, the rule. */
export function figureLine(plan: DayPlan): { line: string; under: string | null } {
  const first = plan.lines.find((l) => l.key === 'first_count');
  const words = figureLines(plan.figure, plan.firstCountDay ?? first?.day ?? null, { today: plan.day, time: first?.time ?? null });
  if (plan.figure.twoDays > 0) return { line: `${words.big} ${words.of} — ${words.label}`, under: words.under };
  return { line: plan.figure.seen > 0 ? words.label : RULE_LINE, under: words.under };
}

function examLineOf(exam: ExamDay): string {
  return W.examLine(exam.title, exam.date === null || exam.daysLeft === null ? null : W.dateWhen(exam.date, exam.daysLeft));
}

const url = (site: string, path: string) => `${site}${path}`;
const row = (button: Button): Button[] => [button];

export type CardMode = 'reminder' | 'today';

export interface CardResult {
  out: Out;
  /** reminder: false when there is nothing to send today (done, nothing, exam day, after the date, no exam). */
  send: boolean;
  /** The lead exam's plan state (study, done, nothing, exam_today, after, empty) or none: the reason of a skipped reminder. */
  state: string;
  examId: string | null;
  /** The user's names inside the message (exam titles), for the linter. */
  user: string[];
}

/** The open session of today in this exam: «Продолжить: 8 из 20» (session.ts `counter`). */
function resumeButton(today: Today, exam: ExamDay): Button | null {
  const s = today.session;
  // Only a session of today with a question left: T5's bot_session_move refuses any other day.
  if (!s || s.containerId !== exam.id || s.localDay !== exam.plan.day || s.queue.length === 0 || s.position >= s.queue.length) return null;
  const pos = Math.max(0, Math.min(s.position, s.queue.length - 1));
  const { n, of } = counter(s.queue, pos);
  try {
    return { text: W.resume(n, of), data: encode({ kind: 'session', sid: s.sid, pos: s.position, act: { a: 'continue' } }), style: 'primary' };
  } catch {
    return null;
  }
}

function noExamCard(site: string, state = 'none'): CardResult {
  return {
    out: { text: t(W.NO_EXAM_UPLOAD), keyboard: [row({ text: W.UPLOAD, url: url(site, W.PATH.upload), style: 'primary' })] },
    send: false,
    state,
    examId: null,
    user: [],
  };
}

/** K1 for the tick (`reminder`) and for /today and /start (`today`: adds «Видели…», «Только ошибки» and «Открыть в Meldy»). */
export function dayCard(today: Today, mode: CardMode, site: string, focus?: string | null): CardResult {
  const view = dayView(today, focus);
  const main = view.main;
  if (!main) {
    const past = view.exams.filter((e) => e.date !== null).sort(byDate).at(-1);
    if (mode === 'today' && past && past.date) {
      return {
        out: { text: b(W.examPassed(past.date)), keyboard: [row({ text: W.NEW_DATE, url: url(site, W.PATH.examSettings(past.id)) })] },
        send: false,
        state: 'after',
        examId: past.id,
        user: [past.title],
      };
    }
    return noExamCard(site, view.exams.length > 0 ? 'after' : 'none');
  }
  if (main.plan.state === 'empty') return noExamCard(site, 'empty');

  const plan = main.plan;
  const user = [main.title, ...view.others.map((e) => e.title)];
  const keyboard: Keyboard = [];
  const text: Array<string | null> = [];
  const figure = figureLine(plan);
  const errors = plan.figure.errors;
  const cid = main.id;

  if (plan.state === 'exam_today') {
    text.push(b(sentence(planLine(plan))), t(examLineOf(main)));
    if (mode === 'today' && figure.under) text.push(t(figure.under));
    const lead = plan.lines.find((l) => l.key === 'exam_errors');
    if (lead && errors > 0) keyboard.push(row({ text: W.throughErrors(lead.n?.[0] ?? errors), data: encode({ kind: 'go', cid, mode: 'e' }), style: 'primary' }));
  } else {
    text.push(b(planSentence(main)), t(examLineOf(main)));
    // «Накануне окна» (the day before the final days) and «В окне» (spec §4.2): the plan keeps window_ahead every day.
    for (const line of plan.lines) {
      if ((line.key === 'window_ahead' && line.day === addDays(plan.day, 1)) || line.key === 'window_in') text.push(t(lineText(line)));
    }
    text.push(t(figure.line));
    if (mode === 'today' && figure.under) text.push(t(figure.under));
    const noDate = plan.lines.find((l) => l.key === 'no_date');
    if (noDate) text.push(t(lineText(noDate)));
    if (main.role === 'member' && main.keyChanges > 0) text.push(t(W.keysFixed(main.keyChanges)));
    const more = plan.lines.find((l) => l.key === 'more_new');
    if (plan.state !== 'study' && more) text.push(t(W.moreNewNote(lineText(more))));

    if (plan.state === 'study') {
      const resume = resumeButton(today, main);
      const first = plan.sessions.find((s) => s.kind === 'answer');
      if (resume) keyboard.push(row(resume));
      else if (first) keyboard.push(row({ text: startLabel(first.ids.length, null, null), data: encode({ kind: 'go', cid, mode: 'p' }), style: 'primary' }));
    } else if (more) {
      keyboard.push(row({ text: lineText(more), data: encode({ kind: 'go', cid, mode: 'x' }) }));
    }
    if (noDate) keyboard.push(row({ text: W.SET_DATE, url: url(site, W.PATH.examSettings(cid)) }));
    // Oral questions are planned on the site (the bot's plan input has the test part only): a quiet way there.
    if (main.hasOral) keyboard.push(row({ text: W.ORAL_IN_MELDY, url: url(site, W.PATH.exam(cid)) }));
  }
  for (const other of view.others) {
    const sec = other.plan.counts.leftSec > 0 ? other.plan.counts.leftSec : other.plan.counts.estSec;
    text.push(t(W.alsoToday(other.title, shownMinutes(sec))));
  }
  if (mode === 'today') {
    if (errors > 0 && plan.state !== 'exam_today') keyboard.push(row({ text: W.onlyErrors(errors), data: encode({ kind: 'go', cid, mode: 'e' }) }));
    keyboard.push(row({ text: W.OPEN_IN_MELDY, url: url(site, W.PATH.exam(cid)) }));
  }
  if (view.listed.length > 1) keyboard.push(row({ text: W.OTHER_EXAM, data: encode({ kind: 'exam', cid: null }) }));

  return { out: { text: lines(...text), keyboard }, send: plan.state === 'study', state: plan.state, examId: cid, user };
}

const ellipsize = (text: string, max: number) => ([...text].length <= max ? text : `${[...text].slice(0, max - 1).join('').trimEnd()}…`);

/** «Другой экзамен»: the exams one per row and «‹ Назад» (a keyboard edit). */
export function examList(today: Today): Keyboard {
  const view = dayView(today);
  const keyboard: Keyboard = view.listed.map((e) => row({ text: ellipsize(e.title, 26), data: encode({ kind: 'exam', cid: e.id }) }));
  if (view.main) keyboard.push(row({ text: W.BACK, data: encode({ kind: 'exam', cid: view.main.id }) }));
  return keyboard;
}

/** The plan line under M3 and the exam it is about (null: no exam with a plan). */
export function planNow(today: Today): { exam: ExamDay | null; line: string } {
  const view = dayView(today);
  if (!view.main || view.main.plan.state === 'empty') return { exam: null, line: W.NO_EXAM_UPLOAD };
  return { exam: view.main, line: planSentence(view.main) };
}

/** K2 «Присылать план дальше?» in place of the fourth reminder (silent). */
export function askCard(today: Today, link: Link): CardResult {
  const view = dayView(today);
  const main = view.main;
  const sec = main ? (main.plan.counts.leftSec > 0 ? main.plan.counts.leftSec : main.plan.counts.estSec) : 0;
  const time = timeText(link.remindAt);
  return {
    out: {
      text: lines(b(W.K2_TITLE), t(W.k2Body(main?.daysLeft ?? null, shownMinutes(sec)))),
      keyboard: [
        row({ text: W.k2Yes(time), data: encode({ kind: 'ask', answer: 'y' }), style: 'primary' }),
        [{ text: W.PAUSE, data: encode({ kind: 'ask', answer: 'p' }) }, { text: W.DONT_SEND, data: encode({ kind: 'ask', answer: 'n' }) }],
      ],
    },
    send: Boolean(main && main.plan.state === 'study'),
    state: main ? main.plan.state : 'none',
    examId: main?.id ?? null,
    user: main ? [main.title] : [],
  };
}

/** K3 after the exam's (last test) date: the last thing the bot writes about it (silent). «За N дней» = last − first + 1. */
export function afterDateCard(row0: AfterDateRow & { exam: NonNullable<AfterDateRow['exam']> }, site: string): CardResult {
  const e = row0.exam;
  const days = e.firstPlanDay ? daysBetween(e.firstPlanDay, e.lastDate) + 1 : null;
  return {
    out: {
      text: lines(
        b(W.examPassed(e.lastDate)),
        days !== null && days > 0 ? t(W.k3Days(days, e.activeDays, thousands(e.answers), e.answers)) : null,
        t(W.k3Figure(e.twoDays, e.keyed)),
        '',
        t(W.K3_LAST),
      ),
      keyboard: [row({ text: W.NEW_DATE, url: url(site, W.PATH.examSettings(row0.containerId)) })],
    },
    send: true,
    state: 'after',
    examId: row0.containerId,
    user: [],
  };
}

/** 1200 → '20:00', 450 → '7:30' (the site's clock form). */
export function timeText(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The next day after `day`. */
export const nextDay = (day: LocalDay) => addDays(day, 1);
