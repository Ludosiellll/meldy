import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Profile, { loadProfileStats } from './Profile';

const db = vi.hoisted(() => ({
  queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
  answer: (() => ({ data: [], error: null })) as (table: string, calls: Array<[string, unknown[]]>) => unknown,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const entry = { table, calls: [] as Array<[string, unknown[]]> };
      db.queries.push(entry);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gte', 'in', 'order', 'limit']) {
        chain[method] = (...args: unknown[]) => {
          entry.calls.push([method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(db.answer(table, entry.calls)).then(resolve, reject);
      return chain;
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../api/social', () => ({
  // The old counters still hold zeros: the page must not show them.
  getProfile: async () => ({ id: 'user-1', full_name: 'Анна', streak_days: 0, total_materials: 0, total_reviews: 0, is_pro: false }),
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
}));
vi.mock('../utils/push', () => ({ subscribeUserToPush: vi.fn(), checkPushSubscription: async () => false, requestNotificationPermission: vi.fn() }));
vi.mock('../components/oral/AnswerTextsSetting', () => ({ default: () => null }));
vi.mock('../components/reminders/DailyReminder', () => ({ default: () => null }));
vi.mock('../components/UniversitySelect', () => ({ default: () => null }));
vi.mock('../components/ImageCropper', () => ({ default: () => null }));
vi.mock('../lib/telemetry', () => ({ TELEMETRY_NOTE: 'Meldy считает только посещения страниц.' }));

const isHead = (calls: Array<[string, unknown[]]>) => calls.some(([method, args]) => method === 'select' && (args[1] as { head?: boolean } | undefined)?.head);
const eqOf = (calls: Array<[string, unknown[]]>, column: string) => calls.find(([method, args]) => method === 'eq' && args[0] === column)?.[1][1];

/** A student with 3 lectures, 14 ticket answers, cards today and tickets yesterday and the day before. */
function liveRows(now: Date) {
  const day = (back: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return (table: string, calls: Array<[string, unknown[]]>) => {
    if (table === 'materials' && isHead(calls)) return { count: 3, error: null };
    if (table === 'learning_events' && isHead(calls)) return { count: eqOf(calls, 'kind') === 'exam_answer' ? 14 : 0, error: null };
    if (table === 'study_sessions') return { data: [{ date: day(0), cards_reviewed: 6 }], error: null };
    if (table === 'learning_events') return { data: [{ kind: 'exam_answer', local_date: day(1) }, { kind: 'quiz_answer', local_date: day(2) }], error: null };
    return { data: [], error: null };
  };
}

beforeEach(() => {
  db.queries.length = 0;
});

afterEach(cleanup);

describe('the profile’s figures (LIB-13)', () => {
  it('counts lectures, ticket answers and days in a row live from the student’s own rows', async () => {
    const now = new Date();
    db.answer = liveRows(now);
    expect(await loadProfileStats('user-1', now)).toEqual({ streak: 3, lectures: 3, answers: 14 });
    // Only the student's rows, and the counts as HEAD requests.
    const lectures = db.queries.find((query) => query.table === 'materials')!;
    expect(lectures.calls).toEqual([
      ['select', ['id', { count: 'exact', head: true }]],
      ['eq', ['user_id', 'user-1']],
    ]);
    const answers = db.queries.find((query) => query.table === 'learning_events' && isHead(query.calls))!;
    expect(eqOf(answers.calls, 'kind')).toBe('exam_answer');
    expect(db.queries.every((query) => eqOf(query.calls, 'user_id') === 'user-1')).toBe(true);
    // The profile's own counters are not read.
    expect(db.queries.some((query) => query.table === 'profiles')).toBe(false);
  });

  it('shows the live figures with words that agree, never the old zeros', async () => {
    db.answer = liveRows(new Date());
    const { container } = render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Анна' })).toBeInTheDocument();
    const figure = (key: string) => container.querySelector(`[data-stat="${key}"]`) as HTMLElement;
    await within(figure('answers')).findByText('14');
    expect(figure('streak')).toHaveTextContent(/^3\s*дня подряд$/);
    expect(figure('lectures')).toHaveTextContent(/^3\s*лекции$/);
    expect(figure('answers')).toHaveTextContent(/^14\s*ответов на билеты$/);
    expect(screen.queryByText('Материалов')).toBeNull();
    expect(screen.queryByText('Повторений')).toBeNull();
    expect(document.title).toBe('Профиль — Meldy');
  });

  it('shows «—» for a figure that could not be counted, never a 0', async () => {
    db.answer = (table, calls) => (table === 'materials' && isHead(calls) ? { count: null, error: { message: 'offline' } } : liveRows(new Date())(table, calls));
    const { container } = render(<MemoryRouter><Profile /></MemoryRouter>);
    await screen.findByRole('heading', { level: 1, name: 'Анна' });
    const lectures = container.querySelector('[data-stat="lectures"]') as HTMLElement;
    await within(lectures).findByText('не удалось посчитать');
    expect(lectures.textContent).not.toMatch(/\d/);
    expect(lectures).toHaveTextContent('—');
  });
});
