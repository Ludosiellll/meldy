import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Перенести экзамен» and the Telegram plan per exam (release 47, 20261018120000): exam_date_move, exam_remind_set and
 * telegram_exams through the app's Supabase client, as the plan's data contract has them.
 */
type Answer = { data: unknown; error: unknown; status?: number };

const db = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  answer: (_name: string, _args: Record<string, unknown>): Answer => ({ data: null, error: null, status: 200 }),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc(name: string, args: Record<string, unknown>) {
      db.calls.push({ name, args });
      const builder = {
        abortSignal: () => builder,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve().then(() => db.answer(name, args)).then(resolve, reject),
      };
      return builder;
    },
  },
}));

import { ContainerApiError, MOVE_DATE_TEXT, moveExamDate, setExamRemind, telegramExams } from './containers';

const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const S1 = '69ead689-38d6-4350-bc5d-13d273f8b9b2';

async function caught(promise: Promise<unknown>): Promise<ContainerApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ContainerApiError);
    return error as ContainerApiError;
  }
  throw new Error('expected a ContainerApiError');
}

beforeEach(() => {
  db.calls.length = 0;
  db.answer = () => ({ data: null, error: null, status: 200 });
});

describe('exam_date_move', () => {
  it('sends the exam, the date, whose and the subject (null without one), and reads the answer', async () => {
    db.answer = () => ({
      data: { for: 'all', container_id: C1, exam_date: '2026-10-25', own_exam_date: null, subjects: [{ id: S1, exam_date: '2026-10-25' }, { id: 'x', exam_date: null }, { exam_date: '2026-10-25' }] },
      error: null,
    });
    const moved = await moveExamDate(C1, '2026-10-25', 'all');
    expect(db.calls).toEqual([{ name: 'exam_date_move', args: { p_container_id: C1, p_date: '2026-10-25', p_for: 'all', p_subject_id: null } }]);
    expect(moved).toEqual({
      for: 'all', container_id: C1, exam_date: '2026-10-25', own_exam_date: null,
      subjects: [{ id: S1, exam_date: '2026-10-25' }, { id: 'x', exam_date: null }],
    });
    await moveExamDate(C1, '2026-10-25', 'all', S1);
    expect(db.calls[1].args.p_subject_id).toBe(S1);
  });

  it('a member’s own date, and clearing it with null', async () => {
    db.answer = (_name, args) => ({ data: { for: 'me', container_id: C1, exam_date: '2026-10-17', own_exam_date: args.p_date, subjects: [] }, error: null });
    expect((await moveExamDate(C1, '2026-11-01', 'me')).own_exam_date).toBe('2026-11-01');
    expect((await moveExamDate(C1, null, 'me')).own_exam_date).toBeNull();
    expect(db.calls.map((call) => call.args.p_date)).toEqual(['2026-11-01', null]);
  });

  it('a date out of range (22023) is said as such; the author-only move (42501) in the usual words', async () => {
    db.answer = () => ({ data: null, error: { code: '22023', message: 'date' }, status: 400 });
    const range = await caught(moveExamDate(C1, '2020-01-01', 'all'));
    expect(range.code).toBe('22023');
    expect(range.message).toBe(MOVE_DATE_TEXT);
    db.answer = () => ({ data: null, error: { code: '42501', message: 'owner only' }, status: 403 });
    expect((await caught(moveExamDate(C1, '2026-10-25', 'all'))).message).toBe('Это может сделать только автор экзамена.');
  });

  it('an answer that is not one is refused; dates are cut to the day', async () => {
    db.answer = () => ({ data: [], error: null });
    expect((await caught(moveExamDate(C1, '2026-10-25', 'all'))).detail).toBe('bad shape: exam_date_move');
    db.answer = () => ({ data: { exam_date: '2026-10-25T00:00:00', own_exam_date: 'soon' }, error: null });
    expect(await moveExamDate(C1, '2026-10-25', 'me')).toEqual({ for: 'me', container_id: C1, exam_date: '2026-10-25', own_exam_date: null, subjects: [] });
  });
});

describe('exam_remind_set', () => {
  it('sends the switch and reads it back', async () => {
    db.answer = (_name, args) => ({ data: { container_id: C1, tg_remind: args.p_on }, error: null });
    expect(await setExamRemind(C1, false)).toEqual({ container_id: C1, tg_remind: false });
    expect(db.calls).toEqual([{ name: 'exam_remind_set', args: { p_container_id: C1, p_on: false } }]);
  });
});

describe('telegram_exams', () => {
  it('reads the exams in their order, each with its state and switch', async () => {
    db.answer = () => ({
      data: [
        { container_id: 'c-3', title: ' Летняя практика ', exam_date: '2026-10-18', state: 'exam_today', tg_remind: true },
        { container_id: 'c-2', title: 'Осенняя сессия', exam_date: '2026-11-03', state: 'study', tg_remind: false },
        { container_id: 'c-4', title: '', exam_date: null, state: 'odd' },
        { title: 'no id' },
        'junk',
      ],
      error: null,
    });
    expect(await telegramExams()).toEqual([
      { container_id: 'c-3', title: 'Летняя практика', exam_date: '2026-10-18', state: 'exam_today', tg_remind: true },
      { container_id: 'c-2', title: 'Осенняя сессия', exam_date: '2026-11-03', state: 'study', tg_remind: false },
      { container_id: 'c-4', title: 'Экзамен', exam_date: null, state: 'no_date', tg_remind: true },
    ]);
    expect(db.calls).toEqual([{ name: 'telegram_exams', args: {} }]);
  });

  it('null on a database without the function; other failures throw', async () => {
    db.answer = () => ({ data: null, error: { code: 'PGRST202', message: 'not found' }, status: 404 });
    expect(await telegramExams()).toBeNull();
    db.answer = () => ({ data: null, error: { code: 'XX000', message: 'boom' }, status: 500 });
    expect((await caught(telegramExams())).code).toBe('unknown');
  });
});
