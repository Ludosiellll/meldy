import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * What «Сегодня» reads (pages/today/loadToday.ts), without the page: the leading exam with its questions and answers,
 * an exam that cannot be read (the page still opens: examFailed), the lectures and the review cards, and «Первые шаги»
 * with the exam container. The page's own tests (Dashboard*.test.tsx) read through the same module.
 */

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, () => { data?: unknown; error?: unknown }>,
    countDueCards: vi.fn(async () => 3),
    getDueCards: vi.fn(async () => [] as unknown[]),
    fetchQuestionEvents: vi.fn(async () => [] as unknown[]),
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit']) builder[method] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, ...(state.tables[table]?.() ?? {}) }).then(resolve, reject);
    return builder;
  };
  return Object.assign(state, { from });
});

vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => db.from(table) } }));
vi.mock('../../api/flashcards', () => ({
  countDueCards: () => db.countDueCards(),
  getDueCards: () => db.getDueCards(),
}));
vi.mock('../../api/learning', () => ({ fetchQuestionEvents: (...args: unknown[]) => db.fetchQuestionEvents(...(args as [])) }));

import { loadDashboard, type SettledLayer } from './loadToday';
import { localDateKey, shiftDateKey } from '../../utils/streak';

// Within the leading exam's horizon (lib/exams/leading.ts EXAM_HORIZON_DAYS).
const SOON = shiftDateKey(localDateKey(), 10);

const off = async (): Promise<SettledLayer> => ({ mode: 'off' }) as SettledLayer;
const hash = (n: number) => n.toString(16).padStart(32, '0');

beforeEach(() => {
  db.tables = {};
  db.countDueCards.mockClear();
  db.fetchQuestionEvents.mockReset().mockResolvedValue([]);
});

describe('loadDashboard', () => {
  it('reads the leading exam with its questions and answers, the lectures and the review cards', async () => {
    db.tables.exams = () => ({
      data: [{ id: 'e-1', title: 'Экзамен по праву', kind: 'exam', exam_date: SOON, mapped_at: null, ticket_layout: null, created_at: '2026-10-01T10:00:00Z' }],
    });
    db.tables.exam_questions = () => ({
      data: [1, 2].map((n) => ({ id: `q-${n}`, position: n, label: `Вопрос ${n}`, section: null, question_hash: hash(n), coverage: n === 1 ? 'full' : 'bogus' })),
    });
    db.tables.materials = () => ({ data: [{ id: 'm-1', title: 'Лекция 1', created_at: '2026-10-02T10:00:00Z' }] });
    db.tables.flashcard_progress = () => ({ data: [{ material_id: 'm-1' }] });
    db.fetchQuestionEvents.mockResolvedValue([{ id: 'ev-1', kind: 'exam_answer' }]);
    const data = await loadDashboard('user-1', true, off);
    expect(data.exam?.id).toBe('e-1');
    expect(data.exam?.questions.map((q) => [q.label, q.coverage])).toEqual([['Вопрос 1', 'full'], ['Вопрос 2', 'unmapped']]);
    expect(db.fetchQuestionEvents).toHaveBeenCalledWith([hash(1), hash(2)], ['exam_answer']);
    expect(data.exam?.events).toHaveLength(1);
    expect(data.hasExams).toBe(true);
    expect(data.examFailed).toBe(false);
    expect(data.dueCount).toBe(3);
    expect(data.lectures.map((l) => l.id)).toEqual(['m-1']);
    expect(data.materialsWithCards).toEqual(new Set(['m-1']));
    // the steps from what the page reads: a lecture with text, an exam with questions, an answer among its events
    expect(data.steps).toEqual({ lecture: true, list: true, answer: true, drawExamId: 'e-1' });
    expect(data.layerKey).toBe('off');
  });

  it('an exam that cannot be read leaves the page open: no exam, examFailed, no steps claimed', async () => {
    db.tables.exams = () => ({ error: { message: 'boom' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = await loadDashboard('user-1', true, off);
    expect(data.exam).toBeNull();
    expect(data.examFailed).toBe(true);
    expect(data.steps).toBeNull();
  });

  it('answers that cannot be read: the exam still comes, its events are null', async () => {
    db.tables.exams = () => ({ data: [{ id: 'e-1', title: 'Право', kind: 'exam', exam_date: null, mapped_at: null, ticket_layout: null, created_at: '2026-10-01T10:00:00Z' }] });
    db.tables.exam_questions = () => ({ data: [{ id: 'q-1', position: 1, label: '1', section: null, question_hash: hash(1), coverage: 'none' }] });
    db.fetchQuestionEvents.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = await loadDashboard('user-1', false, off);
    expect(data.exam?.events).toBeNull();
    expect(data.exam?.daysLeft).toBeNull();
    expect(data.examFailed).toBe(false);
  });

  it('with the exam container: an exam of the account inside a container is never the leading one; its questions count for step 1', async () => {
    db.tables.exams = () => ({ data: [{ id: 'oral-1', title: 'Устная часть', kind: 'exam', exam_date: SOON, mapped_at: null, ticket_layout: null, created_at: '2026-10-01T10:00:00Z' }] });
    const layer = async (): Promise<SettledLayer> =>
      ({ mode: 'on', overview: { containers: [{ id: 'c-1', items: 40 }], attached_exam_ids: ['oral-1'] } }) as unknown as SettledLayer;
    const data = await loadDashboard('user-1', true, layer);
    expect(data.exam).toBeNull();
    expect(data.hasExams).toBe(true);
    expect(data.steps).toMatchObject({ list: true, neutral: true, lecture: false });
  });
});
