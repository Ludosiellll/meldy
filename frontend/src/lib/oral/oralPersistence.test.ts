import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase } from './testing/fakeSupabase';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof createFakeSupabase>['client'],
  incrementAIUsage: vi.fn(async () => undefined),
}));
vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => state.client.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => state.client.rpc(fn, args),
  },
}));
vi.mock('../../api/limits', () => ({ incrementAIUsage: state.incrementAIUsage }));

import {
  ATTEMPT_KEY,
  OralSaveError,
  addPeakFlag,
  buildAttemptPayload,
  clearDraft,
  clearStashedAttempt,
  createDraftWriter,
  draftKey,
  fragmentsLabel,
  initialLiveMarks,
  pointSource,
  readDraft,
  readLiveMarks,
  readStashedAttempt,
  rememberLiveMarks,
  saveOralAttempt,
  stashAttempt,
  writeLiveMarks,
  type OralAttemptPayload,
} from './oralPersistence';
import { gradeAnswer } from './oralGrade';
import type { Evaluation, Rubric } from './oralApi';

const Q1 = '0a000000-0000-4000-8000-000000000001';
const RUBRIC_ID = '07000000-0000-4000-8000-000000000001';

const rubric: Rubric = {
  v: 1,
  question: 'Как обучается нейронная сеть?',
  coverage: 'full',
  coverage_note: '',
  fragments_considered: 10,
  fragments_total: 30,
  materials: [
    { key: 'M1', material_id: 'mat-1', title: 'Нейронные сети' },
    { key: 'M2', material_id: 'mat-2', title: 'Оптимизация' },
  ],
  points: [
    { id: 'p1', title: 'Подбор весов', essential: true, source_quote: 'Обучение сети заключается в подборе весов', source_ids: ['M1:S12'], anchors: [['вес']], followup: { question: 'А что минимизируют?', expected: 'Функцию потерь.' } },
    { id: 'p2', title: 'Прямой проход', essential: true, source_quote: 'Сначала прямой проход', source_ids: ['M1:S13', 'M1:S14'], anchors: [['прям проход']], followup: { question: 'Что на выходе?', expected: 'Предсказание.' } },
    { id: 'p3', title: 'Скорость обучения', essential: true, source_quote: 'большая ускоряет обучение', source_ids: ['M2:S05'], anchors: [['скорост обуч']], followup: { question: 'А что будет, если взять большую скорость?', expected: 'Колебания.' } },
    { id: 'p4', title: 'Adam', essential: false, source_quote: 'Adam подбирает шаг', source_ids: ['M1:S16'], anchors: [['adam', 'адам']], followup: { question: 'Чем хорош Adam?', expected: 'Свой шаг для параметра.' } },
  ],
  nearest: [],
};

const evaluation: Evaluation = {
  points: [
    { id: 'p1', status: 'covered', student_quote: 'подбор весов', comment: 'Сказано.' },
    { id: 'p2', status: 'partial', student_quote: 'проход', comment: 'Без выхода.' },
    { id: 'p3', status: 'missing', student_quote: '', comment: '' },
    { id: 'p4', status: 'covered', student_quote: 'адам', comment: '' },
  ],
  errors: [{ point_id: 'p2', student_quote: 'проход назад', correction: 'Прямой проход идёт от входа к выходу.' }],
  verdict: 'Повторите скорость обучения.',
};

function payload(): OralAttemptPayload {
  const followup = { point_id: 'p3', question: 'А что будет, если взять большую скорость?', expected: 'Колебания.', status: 'missing' as const, student_quote: 'не знаю', chosen_by: 'check' as const };
  const grade = gradeAnswer(
    rubric.points.map((point) => ({ id: point.id, essential: point.essential, status: evaluation.points.find((item) => item.id === point.id)!.status })),
    followup,
  );
  return buildAttemptPayload({
    attemptId: 'attempt-0001',
    examQuestionId: Q1,
    evidenceMaterialId: 'mat-1',
    rubricId: RUBRIC_ID,
    rubric,
    evaluation,
    grade,
    followup,
    live: new Set(['p1', 'p4']),
    input: 'speech',
    durationSeconds: 18.4,
    confidence: 3,
    localDate: '2026-10-07',
  });
}

beforeEach(() => {
  state.client = createFakeSupabase().client;
  state.incrementAIUsage.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the record_oral_attempt payload (contracts §1.5)', () => {
  it('builds the documented shape', () => {
    const body = payload();
    expect(body).toMatchObject({
      attempt_id: 'attempt-0001',
      local_date: '2026-10-07',
      exam_question_id: Q1,
      rubric_id: RUBRIC_ID,
      material_id: 'mat-1',
      duration_seconds: 18,
      input: 'speech',
      confidence: 3,
      verdict: 'Повторите скорость обучения.',
      make_card: true,
      followup: { point_id: 'p3', status: 'missing', student_quote: 'не знаю', chosen_by: 'check' },
      errors: [{ point_id: 'p2', student_quote: 'проход назад', correction: 'Прямой проход идёт от входа к выходу.' }],
    });
    expect(body.score).toBe(57);
    expect(body.grade).toBe(3);
    expect(body.points[0]).toEqual({
      id: 'p1',
      title: 'Подбор весов',
      essential: true,
      status: 'covered',
      credit: 1,
      student_quote: 'подбор весов',
      comment: 'Сказано.',
      source_ids: ['S12'],
      material_id: 'mat-1',
      source_quote: 'Обучение сети заключается в подборе весов',
      source_label: '«Нейронные сети», фрагмент 12',
      live: true,
    });
    expect(body.points[1]).toMatchObject({ source_ids: ['S13', 'S14'], source_label: '«Нейронные сети», фрагменты 13, 14', credit: 0.5, live: false });
    expect(body.points[2]).toMatchObject({ material_id: 'mat-2', source_ids: ['S05'], source_label: '«Оптимизация», фрагмент 5', credit: 0 });
    expect(JSON.stringify(body).length).toBeLessThan(32_000);
  });

  it('refuses to build a save without a grade', () => {
    const grade = gradeAnswer([{ id: 'p1', essential: true, status: 'unrated' }], null);
    expect(() =>
      buildAttemptPayload({
        attemptId: 'attempt-0002',
        examQuestionId: Q1,
        evidenceMaterialId: null,
        rubricId: null,
        rubric,
        evaluation,
        grade,
        followup: null,
        live: new Set(),
        input: 'text',
        durationSeconds: 1,
        confidence: null,
      }),
    ).toThrow();
  });

  it('labels fragments and splits material keys', () => {
    expect(fragmentsLabel(['S07'])).toBe('фрагмент 7');
    expect(fragmentsLabel(['M1:S12', 'M1:S13'])).toBe('фрагменты 12, 13');
    expect(pointSource({ source_ids: ['S03'] }, rubric)).toMatchObject({ materialId: 'mat-1', sourceIds: ['S03'], label: '«Нейронные сети», фрагмент 3' });
  });
});

describe('saving once, charging once', () => {
  it('calls record_oral_attempt, then charges one unit', async () => {
    const fake = createFakeSupabase({
      rpc: async () => ({ data: { session_id: 'sess-1', duplicate: false, events: 5, mistakes_added: 2, mistakes_existing: 0, card_added: true }, error: null }),
    });
    state.client = fake.client;
    const body = payload();
    const result = await saveOralAttempt('user-1', body);
    expect(fake.rpcCalls).toEqual([{ fn: 'record_oral_attempt', args: { p_attempt: body } }]);
    expect(result).toEqual({ sessionId: 'sess-1', duplicate: false, events: 5, mistakesAdded: 2, mistakesExisting: 0, cardAdded: true });
    expect(state.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(state.incrementAIUsage).toHaveBeenCalledWith('user-1', 1);
  });

  it('charges nothing when the save fails, and a retry reuses the attempt id', async () => {
    let fail = true;
    const fake = createFakeSupabase({
      rpc: async () =>
        fail
          ? { data: null, error: { code: '08006', message: 'connection' } }
          : { data: { session_id: 'sess-2', duplicate: true, events: 0, mistakes_added: 0, mistakes_existing: 0, card_added: false }, error: null },
    });
    state.client = fake.client;
    const body = { ...payload(), attempt_id: 'attempt-retry' };
    const error = await saveOralAttempt('user-1', body).catch((caught) => caught);
    expect(error).toBeInstanceOf(OralSaveError);
    expect(error.message).toBe('Результат не сохранён');
    expect(state.incrementAIUsage).not.toHaveBeenCalled();

    fail = false;
    const result = await saveOralAttempt('user-1', body);
    expect(result.sessionId).toBe('sess-2');
    expect(fake.rpcCalls.map((call) => (call.args.p_attempt as OralAttemptPayload).attempt_id)).toEqual(['attempt-retry', 'attempt-retry']);
    expect(state.incrementAIUsage).toHaveBeenCalledTimes(1);

    await saveOralAttempt('user-1', body);
    expect(state.incrementAIUsage).toHaveBeenCalledTimes(1);
  });

  it('treats an answer without a session id as a failed save', async () => {
    state.client = createFakeSupabase({ rpc: async () => ({ data: {}, error: null }) }).client;
    await expect(saveOralAttempt('user-1', { ...payload(), attempt_id: 'attempt-empty' })).rejects.toBeInstanceOf(OralSaveError);
    expect(state.incrementAIUsage).not.toHaveBeenCalled();
  });
});

describe('browser storage', () => {
  it('stores the draft 500 ms after the last change and restores it', () => {
    vi.useFakeTimers();
    const writer = createDraftWriter(Q1);
    writer.update('Обучение — это', 'text');
    vi.advanceTimersByTime(300);
    writer.update('Обучение — это подбор весов', 'text');
    vi.advanceTimersByTime(499);
    expect(window.localStorage.getItem(draftKey(Q1))).toBeNull();
    vi.advanceTimersByTime(1);
    expect(readDraft(Q1)).toMatchObject({ text: 'Обучение — это подбор весов', input: 'text' });
    clearDraft(Q1);
    expect(readDraft(Q1)).toBeNull();
  });

  it('keeps an answer waiting for its evaluation in sessionStorage', () => {
    stashAttempt({
      examId: 'exam-1',
      questionId: Q1,
      attemptId: 'attempt-0003',
      transcript: 'подбор весов',
      input: 'speech',
      durationSeconds: 12,
      live: ['p1'],
      followup: null,
      createdAt: '2026-10-07T11:00:00Z',
    });
    expect(window.sessionStorage.getItem(ATTEMPT_KEY)).toContain('attempt-0003');
    expect(readStashedAttempt('exam-1', Q1)).toMatchObject({ attemptId: 'attempt-0003', live: ['p1'] });
    expect(readStashedAttempt('exam-1', 'другой')).toBeNull();
    clearStashedAttempt();
    expect(readStashedAttempt('exam-1', Q1)).toBeNull();
  });

  it('clears a waiting answer by its attempt id only, and keeps how its follow-up was judged', () => {
    stashAttempt({
      examId: 'exam-1',
      questionId: Q1,
      attemptId: 'attempt-0004',
      transcript: 'подбор весов',
      input: 'text',
      durationSeconds: 20,
      live: ['p1'],
      followup: { point_id: 'p3', question: 'А что будет?', expected: 'Колебания.', status: 'partial', student_quote: 'колебания', chosen_by: 'client', judged_by: 'keywords' },
      createdAt: '2026-10-07T11:00:00Z',
    });
    expect(readStashedAttempt('exam-1', Q1)?.followup).toMatchObject({ status: 'partial', judged_by: 'keywords' });
    // A save of another attempt that finishes late leaves this waiting answer alone.
    clearStashedAttempt('attempt-0001');
    expect(readStashedAttempt('exam-1', Q1)).not.toBeNull();
    clearStashedAttempt('attempt-0004');
    expect(readStashedAttempt('exam-1', Q1)).toBeNull();
    // An unreadable stash is removed by any clear.
    window.sessionStorage.setItem(ATTEMPT_KEY, '{broken');
    clearStashedAttempt('attempt-0004');
    expect(window.sessionStorage.getItem(ATTEMPT_KEY)).toBeNull();
  });

  it('clears only a draft written up to the save, never a newer answer’s draft', () => {
    const saveStarted = '2026-10-07T11:00:05.000Z';
    window.localStorage.setItem(draftKey(Q1), JSON.stringify({ v: 1, text: 'сохранённый ответ', input: 'text', saved_at: '2026-10-07T11:00:01.000Z' }));
    clearDraft(Q1, saveStarted);
    expect(readDraft(Q1)).toBeNull();
    window.localStorage.setItem(draftKey(Q1), JSON.stringify({ v: 1, text: 'новый ответ', input: 'text', saved_at: '2026-10-07T11:00:09.000Z' }));
    clearDraft(Q1, saveStarted);
    expect(readDraft(Q1)).toMatchObject({ text: 'новый ответ' });
    // A draft without a time cannot be newer: it goes.
    window.localStorage.setItem(draftKey(Q1), JSON.stringify({ v: 1, text: 'старый ответ', input: 'text' }));
    clearDraft(Q1, saveStarted);
    expect(window.localStorage.getItem(draftKey(Q1))).toBeNull();
  });

  it('turns live marks on by default and remembers the switch', () => {
    expect(readLiveMarks()).toBe(true);
    writeLiveMarks(false);
    expect(window.localStorage.getItem('meldy_oral_live_marks')).toBe('0');
    expect(readLiveMarks()).toBe(false);
  });

  it('starts «как на экзамене» with live marks off and never touches the stored preference (Jury_Check item 11)', () => {
    window.localStorage.clear();
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    expect(initialLiveMarks('exam')).toBe(false);
    rememberLiveMarks('exam', true);
    rememberLiveMarks('exam', false);
    expect(getItem).not.toHaveBeenCalledWith('meldy_oral_live_marks');
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('meldy_oral_live_marks')).toBeNull();
    getItem.mockRestore();
    setItem.mockRestore();
    // Training keeps today's behaviour: the stored preference, on by default, and the switch is remembered.
    expect(initialLiveMarks('training')).toBe(true);
    rememberLiveMarks('training', false);
    expect(window.localStorage.getItem('meldy_oral_live_marks')).toBe('0');
    expect(initialLiveMarks('training')).toBe(false);
    // A stored «off» does not leak into the exam mode's default either way.
    expect(initialLiveMarks('exam')).toBe(false);
  });

  it('adds every saved question of a ticket to the exam sheet’s flag', () => {
    addPeakFlag('exam-1', { hash: 'a'.repeat(32), questionId: Q1, before: 'once' });
    addPeakFlag('exam-1', { hash: 'b'.repeat(32), questionId: 'q2', before: 'untested' });
    addPeakFlag('exam-1', { hash: 'a'.repeat(32), questionId: Q1, before: 'once' });
    expect(JSON.parse(window.sessionStorage.getItem('meldy_exam_peak_exam-1') ?? '[]')).toEqual([
      { hash: 'b'.repeat(32), question_id: 'q2', before: 'untested' },
      { hash: 'a'.repeat(32), question_id: Q1, before: 'once' },
    ]);
  });
});
