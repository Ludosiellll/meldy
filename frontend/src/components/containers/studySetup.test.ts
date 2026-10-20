import { describe, expect, it } from 'vitest';
import type { DayPlan, PlanInput } from '../../types/container';
import { sessionOpens, setupSession } from './studySetup';
import { errorCount, sessionHref, studyHref } from './model';
import type { SavedSession } from './sessionStore';
import { CONTAINER, ORAL_EXAM, SUBJECT_CS, SUBJECT_DB, SUBJECT_ORAL, TODAY, dayPlan, planInput, subject, summary, unit } from './testkit/fixtures';

/**
 * The end screen's pill names what its link opens (usability check 2026-10-11, D3: «Ещё 13 вопросов» opened 18):
 * sessionOpens against setupSession's own queue for the link.
 */
const ids = (prefix: string, from: number, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${from + i}`);
const exam = summary({
  subjects: [...summary().subjects, subject({ id: SUBJECT_ORAL, title: 'Гражданское право', keyed: 0, topics: [], oral: { exam_id: ORAL_EXAM, questions: 12 } })],
});

/** The questions a session at `href` takes on this plan and input (StudyPage: setupSession). */
function queued(href: string, plan: DayPlan, input: PlanInput): number {
  const params = new URLSearchParams(href.split('?')[1] ?? '');
  return setupSession({ params, saved: null, plan, input, summary: exam, today: plan.day, now: 0 }).queue.length;
}

describe('sessionOpens: the questions a plan session’s link opens', () => {
  // «Программирование на C#» today: 25 questions in two sessions of the plan (20 and 5), «Базы данных» 25 too.
  const plan = dayPlan({
    sessions: [
      { subjectId: SUBJECT_CS, kind: 'answer', ids: ids('cs', 0, 20), estSec: 600 },
      { subjectId: SUBJECT_DB, kind: 'answer', ids: ids('db', 0, 20), estSec: 600 },
      { subjectId: SUBJECT_CS, kind: 'answer', ids: ids('cs', 20, 5), estSec: 150 },
      { subjectId: SUBJECT_DB, kind: 'answer', ids: ids('db', 20, 5), estSec: 150 },
      { subjectId: SUBJECT_ORAL, kind: 'self_check', ids: ids('o', 0, 12), estSec: 720 },
      { subjectId: SUBJECT_ORAL, kind: 'ai_check', ids: ids('a', 0, 5), estSec: 750 },
    ],
  });
  const answered = ids('cs', 0, 7);

  it('the same subject: the rest of its first session and its next ones, up to 20 — 18, not the 13 left of the first', () => {
    const rest = { ...plan.sessions[0], ids: plan.sessions[0].ids.filter((id) => !answered.includes(id)) };
    expect(rest.ids).toHaveLength(13);
    // The plan as the session ended, the session's answers named.
    const before = planInput();
    expect(sessionOpens({ plan, input: before, summary: exam, session: rest, answered })).toBe(18);
    // The plan read after it: the answers are answered today in its input.
    const after = planInput({ items: answered.map((id, k) => ({ id, s: SUBJECT_CS, f: 't' as const, tp: 1, o: k + 1, u: unit({ seen: 1, firstDay: TODAY, lastDay: TODAY }) })) });
    expect(sessionOpens({ plan, input: after, summary: exam, session: rest })).toBe(18);
    expect(queued(sessionHref(CONTAINER, exam, rest) as string, plan, after)).toBe(18);
  });

  it('another subject, the oral self-checks (10 a session) and the AI check (a ticket of 3): each what its link takes', () => {
    const input = planInput();
    const db = plan.sessions[1];
    expect(sessionOpens({ plan, input, summary: exam, session: db })).toBe(20);
    expect(queued(sessionHref(CONTAINER, exam, db) as string, plan, input)).toBe(20);
    const self = plan.sessions[4];
    expect(sessionOpens({ plan, input, summary: exam, session: self })).toBe(10);
    expect(queued(sessionHref(CONTAINER, exam, self) as string, plan, input)).toBe(10);
    const aloud = plan.sessions[5];
    expect(sessionOpens({ plan, input, summary: exam, session: aloud })).toBe(3);
    expect(new URL(sessionHref(CONTAINER, exam, aloud) as string, 'https://x').searchParams.get('q')?.split(',')).toHaveLength(3);
  });

  it('fewer than a session left: all of them', () => {
    const small = dayPlan({ sessions: [{ subjectId: SUBJECT_CS, kind: 'answer', ids: ids('cs', 0, 4), estSec: 120 }] });
    expect(sessionOpens({ plan: small, input: planInput(), summary: exam, session: small.sessions[0], answered: ['cs-0'] })).toBe(3);
  });
});

describe('«Только ошибки: N» opens what it counts (owner, 2026-10-20: «хочу ошибки посмотреть … пишет их нет»)', () => {
  const plan = dayPlan({ sessions: [] });
  const wrongOn = (day: string) => unit({ seen: 1, wrong: 1, firstDay: day, lastDay: day });
  /** `older` mistakes of earlier days and `today` of today, in «Базы данных». */
  function errorsInput(older: number, today: number): PlanInput {
    const items = Array.from({ length: older + today }, (_, k) => ({
      id: `e-${k}`, s: SUBJECT_DB, f: 't' as const, tp: 1, o: k + 1, u: wrongOn(k < older ? '2026-10-08' : TODAY),
    }));
    return planInput({ items: [...items, { id: 'fine', s: SUBJECT_DB, f: 't' as const, tp: 1, o: 999, u: unit({ seen: 1, firstDay: TODAY, lastDay: TODAY }) }] });
  }
  const open = (input: PlanInput) => {
    const href = studyHref(CONTAINER, { s: SUBJECT_DB, only: 'errors' });
    const params = new URLSearchParams(href.split('?')[1] ?? '');
    return setupSession({ params, saved: null, plan, input, summary: exam, today: TODAY, now: 0 }).queue.map((entry) => entry.id);
  };

  it('all made today: the link counts 10 and opens the 10', () => {
    const input = errorsInput(0, 10);
    expect(errorCount(input, SUBJECT_DB)).toBe(10);
    expect(open(input).sort()).toEqual(Array.from({ length: 10 }, (_, k) => `e-${k}`).sort());
  });

  it('older and today’s: all of them, never a question that is not an error', () => {
    const input = errorsInput(4, 6);
    expect(open(input)).toHaveLength(errorCount(input, SUBJECT_DB));
    expect(open(input)).not.toContain('fine');
  });

  it('more than a session: 20, the older mistakes first', () => {
    const input = errorsInput(15, 15);
    const ids = open(input);
    expect(ids).toHaveLength(20);
    for (let k = 0; k < 15; k += 1) expect(ids).toContain(`e-${k}`);
  });

  it('a topic’s block still skips what was answered today', () => {
    const input = errorsInput(0, 3);
    const params = new URLSearchParams(studyHref(CONTAINER, { s: SUBJECT_DB, topic: 1 }).split('?')[1] ?? '');
    expect(setupSession({ params, saved: null, plan, input, summary: exam, today: TODAY, now: 0 }).queue).toHaveLength(0);
  });
});

describe('a reload opens the session its address names (owner, 2026-10-20: «обновляю сайт, то с 1 вопроса»)', () => {
  const plan = dayPlan();
  const input = planInput();
  const SID = '0b6f3c2e-9a1d-4e7b-8c5a-2d4e6f8a0b1c';
  const saved = (over: Partial<SavedSession> = {}): SavedSession => ({
    v: 1, id: SID, containerId: CONTAINER, day: TODAY, subjectId: SUBJECT_DB, kind: 'answer', topic: null, only: null,
    queue: ['q-code', 'q-iso', 'q-plain'].map((id) => ({ id, retry: 0 as const })), pos: 1, startedAt: 5, records: [], ...over,
  });
  const at = (search: string, kept: SavedSession | null) =>
    setupSession({ params: new URLSearchParams(search), saved: kept, plan, input, summary: exam, today: TODAY, now: 9 });

  it('the same id, the same day, not finished: that session where it stopped — before the first answer too', () => {
    const again = at(`s=${SUBJECT_DB}&sid=${SID}`, saved());
    expect(again).toMatchObject({ id: SID, resumed: true, pos: 1, startedAt: 5 });
    expect(again.queue.map((entry) => entry.id)).toEqual(['q-code', 'q-iso', 'q-plain']);
    expect(at(`s=${SUBJECT_DB}&sid=${SID}`, saved({ pos: 0 }))).toMatchObject({ id: SID, resumed: true, pos: 0 });
  });

  it('another session’s id, another day, or a finished one: a new session', () => {
    for (const kept of [saved({ id: 'other' }), saved({ day: '2026-10-09' }), saved({ pos: 3 })]) {
      const fresh = at(`s=${SUBJECT_DB}&sid=${SID}`, kept);
      expect(fresh.resumed).toBe(false);
      expect(fresh.id).not.toBe(SID);
    }
  });

  it('an address without the id is a new session, as each visit of a link is', () => {
    expect(at(`s=${SUBJECT_DB}`, saved()).resumed).toBe(false);
  });
});
