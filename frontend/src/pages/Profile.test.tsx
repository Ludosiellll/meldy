import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Profile, { loadProfileStats } from './Profile';
import { ContainerApiError } from '../api/containers';
import { windowStart } from '../lib/learning/studyDays';

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
      for (const method of ['select', 'eq', 'gte', 'in', 'order', 'limit', 'range']) {
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
// Days with answers to the questions of an exam's file (package D1 builds the read; spec decision 2 / test_answer_days).
const containers = vi.hoisted(() => ({ fetchAnswerDays: vi.fn() }));
vi.mock('../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/containers')>()),
  fetchAnswerDays: (...args: unknown[]) => containers.fetchAnswerDays(...args),
}));
vi.mock('../api/social', () => ({
  // The old counters still hold zeros: the page must not show them.
  getProfile: async () => ({ id: 'user-1', full_name: 'Анна', streak_days: 0, total_materials: 0, total_reviews: 0, is_pro: false }),
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
}));
vi.mock('../components/oral/AnswerTextsSetting', () => ({ default: () => null }));
vi.mock('../components/reminders/DailyReminder', () => ({ default: () => null }));
vi.mock('../components/telegram/TelegramCard', () => ({ default: () => null }));
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
  // A database without the exam containers: the old path.
  containers.fetchAnswerDays.mockReset().mockRejectedValue(new ContainerApiError('unavailable', 'Не получилось.'));
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

  it('counts a day with answers to the questions of an exam’s file as a day in a row (test_answer_days)', async () => {
    const now = new Date();
    db.answer = liveRows(now);
    const back = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    // Cards today, a ticket yesterday, a test the day before: 3. Answers to exam questions 3 and 4 days ago: 5.
    containers.fetchAnswerDays.mockResolvedValue([
      { local_date: back(3), answers: 20 },
      { local_date: back(4), answers: 7 },
      { local_date: back(6), answers: 0 },
    ]);
    expect(await loadProfileStats('user-1', now)).toEqual({ streak: 5, lectures: 3, answers: 14 });
    // The same window as the other reads.
    expect(containers.fetchAnswerDays).toHaveBeenCalledWith(windowStart(60, now));
  });

  it('fills a gap with exam answers alone, and counts as before when the database has no such answers', async () => {
    const now = new Date();
    const day = (back: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - back);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    // Cards today and a ticket two days ago; yesterday only questions of an exam's file.
    db.answer = (table, calls) => {
      if (table === 'study_sessions') return { data: [{ date: day(0), cards_reviewed: 4 }], error: null };
      if (table === 'learning_events' && !isHead(calls)) return { data: [{ kind: 'exam_answer', local_date: day(2) }], error: null };
      return liveRows(now)(table, calls);
    };
    containers.fetchAnswerDays.mockResolvedValue([{ local_date: day(1), answers: 12 }]);
    expect((await loadProfileStats('user-1', now)).streak).toBe(3);
    // The function is missing (an old database), or the read fails: the old count, never a failed figure.
    containers.fetchAnswerDays.mockRejectedValue(new ContainerApiError('unavailable', 'Не получилось.'));
    expect((await loadProfileStats('user-1', now)).streak).toBe(1);
    containers.fetchAnswerDays.mockImplementation(() => {
      throw new Error('not built');
    });
    expect((await loadProfileStats('user-1', now)).streak).toBe(1);
    containers.fetchAnswerDays.mockResolvedValue(null);
    expect((await loadProfileStats('user-1', now)).streak).toBe(1);
  });

  it('reads the journal page by page: an answer beyond the first 1000 still counts its day (Concept 3 §5.4)', async () => {
    const now = new Date();
    const day = (back: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - back);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    // 1000 answers today and yesterday, the 1001st two days ago: newest first, it is on the second page.
    const journal = [
      ...Array.from({ length: 1000 }, (_, index) => ({ kind: 'quiz_answer', local_date: day(index < 500 ? 0 : 1) })),
      { kind: 'exam_answer', local_date: day(2) },
    ];
    db.answer = (table, calls) => {
      if (table === 'study_sessions') return { data: [], error: null };
      if (table === 'learning_events' && !isHead(calls)) {
        const [from, to] = calls.find(([method]) => method === 'range')![1] as [number, number];
        return { data: journal.slice(from, to + 1), error: null };
      }
      return liveRows(now)(table, calls);
    };
    expect((await loadProfileStats('user-1', now)).streak).toBe(3);
    const pages = db.queries.filter((query) => query.table === 'learning_events' && !isHead(query.calls));
    expect(pages.map((page) => page.calls.find(([method]) => method === 'range')![1])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(pages[0].calls.filter(([method]) => method === 'order')).toEqual([
      ['order', ['local_date', { ascending: false }]],
      ['order', ['id', { ascending: false }]],
    ]);
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

describe('the figures as one line of text (10_Project/Phone_Declutter_2026-10-08, every size)', () => {
  it('says them in one line under the name, without cards or icons', async () => {
    db.answer = liveRows(new Date());
    const { container } = render(<MemoryRouter><Profile /></MemoryRouter>);
    const name = await screen.findByRole('heading', { level: 1, name: 'Анна' });
    const line = container.querySelector('.ac-statline') as HTMLElement;
    await within(line).findByText('14');
    expect(Array.from(line.querySelectorAll('[data-stat]')).map((part) => part.textContent?.replace(/\s+/g, ' '))).toEqual(['3 дня подряд', '3 лекции', '14 ответов на билеты']);
    expect(line.querySelector('svg')).toBeNull();
    expect(container.querySelector('.ac-stats, .ac-stat')).toBeNull();
    expect(line).toHaveAttribute('aria-busy', 'false');
    // In the hero, under the name.
    expect(name.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.closest('.ac-hero')).not.toBeNull();
  });

  it('marks a line too long for a phone’s card, which then breaks before the answers (never with «·» first)', async () => {
    db.answer = liveRows(new Date());
    const { container } = render(<MemoryRouter><Profile /></MemoryRouter>);
    await within(await waitForLine(container)).findByText('14');
    expect(container.querySelector('.ac-statline')).not.toHaveAttribute('data-long');
    cleanup();

    db.answer = (table, calls) => (table === 'learning_events' && isHead(calls) ? { count: 1500, error: null } : liveRows(new Date())(table, calls));
    const second = render(<MemoryRouter><Profile /></MemoryRouter>);
    const line = await waitForLine(second.container);
    await within(line).findByText('1500');
    expect(line).toHaveAttribute('data-long');
    // The break is the second «·», drawn as nothing (Profile.css): the words stay whole.
    expect(line.querySelector('[data-sep="2"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps its place, blank, while the figures are counted', async () => {
    db.answer = () => new Promise(() => {});
    const { container } = render(<MemoryRouter><Profile /></MemoryRouter>);
    await screen.findByRole('heading', { level: 1, name: 'Анна' });
    const line = container.querySelector('.ac-statline') as HTMLElement;
    expect(line).toHaveAttribute('aria-busy', 'true');
    expect(line.textContent).not.toMatch(/\d/);
  });
});

describe('«Уведомления»', () => {
  it('has no browser push row: its subscriptions lived in a file of the server and every release erased them', async () => {
    db.answer = liveRows(new Date());
    render(<MemoryRouter><Profile /></MemoryRouter>);
    const card = (await screen.findByRole('heading', { name: 'Уведомления' })).closest('section') as HTMLElement;
    expect(within(card).queryByText('Напоминания о повторении')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Включить' })).toBeNull();
  });
});

async function waitForLine(container: HTMLElement): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1, name: 'Анна' });
  return container.querySelector('.ac-statline') as HTMLElement;
}
