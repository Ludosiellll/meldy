import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ExamListItem } from '../api/exams';
import type { LearningEvent } from '../api/learning';

const mocks = vi.hoisted(() => ({ listExams: vi.fn(), fetchQuestionEvents: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/exams')>();
  return { ...actual, listExams: mocks.listExams };
});
vi.mock('../api/learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/learning')>();
  return { ...actual, fetchQuestionEvents: mocks.fetchQuestionEvents };
});

import Exams, { examCoverageLine, examDateLine } from './Exams';

const pad = (n: number) => String(n).padStart(2, '0');
function dayKey(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const hash = (n: number) => n.toString(16).padStart(32, 'c');

function item(overrides: Partial<ExamListItem> = {}): ExamListItem {
  return {
    id: 'exam-1',
    title: 'Микроэкономика',
    kind: 'exam',
    exam_date: dayKey(12),
    mapping_state: 'done',
    mapped_at: '2026-10-03T06:40:00Z',
    created_at: '2026-10-01T06:40:00Z',
    total: 40,
    coverage: { full: 24, partial: 7, none: 9, unverified: 0, unmapped: 0 },
    hashes: Array.from({ length: 40 }, (_, index) => hash(index + 1)),
    ...overrides,
  };
}

function passes(n: number): LearningEvent[] {
  return ['2026-09-20', '2026-09-27'].map((day, index) => ({
    id: `e${n}-${index}`,
    created_at: `${day}T10:00:00Z`,
    local_date: day,
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${hash(n)}`,
    correct: true,
    score: 0.9,
    confidence: null,
    source_ids: [],
    session_id: `s${n}${index}`,
    payload: { grade: 5 },
  }));
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/exams']}>
      <Routes>
        <Route path="/exams" element={<Exams />} />
        <Route path="/exams/new" element={<h1>Новый экзамен</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');

beforeEach(() => {
  mocks.listExams.mockReset();
  mocks.fetchQuestionEvents.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('Exams', () => {
  it('lists exams as plain rows: when, how much is in the lectures, how much is confirmed', async () => {
    mocks.listExams.mockResolvedValue([
      item(),
      item({ id: 'exam-2', title: 'Макроэкономика', kind: 'credit', exam_date: null, mapping_state: 'none', mapped_at: null, total: 25, coverage: { full: 0, partial: 0, none: 0, unverified: 0, unmapped: 25 }, hashes: [] }),
      item({ id: 'exam-3', title: 'История экономических учений', kind: 'colloquium', exam_date: dayKey(-20), total: 12, coverage: { full: 8, partial: 0, none: 4, unverified: 0, unmapped: 0 }, hashes: [] }),
    ]);
    mocks.fetchQuestionEvents.mockResolvedValue(Array.from({ length: 6 }, (_, index) => passes(index + 1)).flat());
    renderList();

    const list = await screen.findByRole('list', { name: 'Ваши экзамены' });
    const links = within(list).getAllByRole('link').filter((link) => link.classList.contains('ex-row'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/exams/exam-1', '/exams/exam-2', '/exams/exam-3']);
    // A ticket is drawn right from the card once some question is in the lectures; not before the mapping.
    const draws = within(list).getAllByRole('link', { name: /^Тянуть билет/ });
    expect(draws.map((link) => link.getAttribute('href'))).toEqual(['/exams/exam-1/draw', '/exams/exam-3/draw']);
    expect(draws[0]).toHaveAccessibleName('Тянуть билет: Микроэкономика');
    await waitFor(() => expect(plain(links[0].textContent)).toContain('24 из 40 вопросов есть в лекциях · подтверждено 6'));
    expect(plain(links[0].textContent)).toMatch(/экзамен · \d+ [а-я]+, через 12 дней/);
    expect(plain(links[1].textContent)).toContain('зачёт, дата не указана · 25 вопросов, со своими лекциями ещё не сверены');
    expect(plain(links[2].textContent)).toMatch(/коллоквиум · прошёл \d+ [а-я]+ · 8 из 12 вопросов есть в лекциях/);
    expect(mocks.fetchQuestionEvents).toHaveBeenCalledWith(expect.arrayContaining([hash(1)]), ['exam_answer']);
    expect(screen.getByRole('link', { name: 'Новый экзамен' })).toHaveAttribute('href', '/exams/new');
  });

  it('counts «подтверждено» by the rule: passes on one day, or two minutes apart over midnight, confirm nothing', async () => {
    mocks.listExams.mockResolvedValue([item()]);
    const pass = (n: number, id: string, createdAt: string, localDate: string): LearningEvent => ({
      ...passes(n)[0],
      id,
      created_at: createdAt,
      local_date: localDate,
    });
    mocks.fetchQuestionEvents.mockResolvedValue([
      // 1:00 and 21:00 of one day
      pass(1, 'a1', '2026-09-30T22:00:00Z', '2026-10-01'),
      pass(1, 'a2', '2026-10-01T18:00:00Z', '2026-10-01'),
      // 23:59 and 0:01
      pass(2, 'b1', '2026-10-01T20:59:00Z', '2026-10-01'),
      pass(2, 'b2', '2026-10-01T21:01:00Z', '2026-10-02'),
      // two days and 22 hours: confirmed
      pass(3, 'c1', '2026-10-01T07:00:00Z', '2026-10-01'),
      pass(3, 'c2', '2026-10-02T05:00:00Z', '2026-10-02'),
    ]);
    renderList();
    const link = await screen.findByRole('link', { name: /^Микроэкономика/ });
    await waitFor(() => expect(plain(link.textContent)).toContain('24 из 40 вопросов есть в лекциях · подтверждено 1'));
  });

  it('names an exam by its subject: «Экзамен: цифровая экономика» reads «Цифровая экономика» next to «экзамен ·»', async () => {
    mocks.listExams.mockResolvedValue([item({ title: 'Экзамен: цифровая экономика' })]);
    renderList();
    const list = await screen.findByRole('list', { name: 'Ваши экзамены' });
    const title = list.querySelector('.ex-row-title');
    expect(title?.textContent).toBe('Цифровая экономика');
  });

  it('still lists the exams when the answer history cannot be read', async () => {
    mocks.listExams.mockResolvedValue([item()]);
    mocks.fetchQuestionEvents.mockRejectedValue(new Error('offline'));
    renderList();
    const link = await screen.findByRole('link', { name: /^Микроэкономика/ });
    expect(plain(link.textContent)).toContain('24 из 40 вопросов есть в лекциях');
    expect(plain(link.textContent)).not.toContain('подтверждено');
  });

  it('shows a running mapping as a moving bar, with nothing to draw yet', async () => {
    mocks.listExams.mockResolvedValue([
      item({ mapping_state: 'running', coverage: { full: 3, partial: 0, none: 0, unverified: 0, unmapped: 37 } }),
    ]);
    mocks.fetchQuestionEvents.mockResolvedValue([]);
    renderList();
    const list = await screen.findByRole('list', { name: 'Ваши экзамены' });
    await waitFor(() => expect(list.querySelector('.ex-bar[data-running]')).not.toBeNull());
    expect(within(list).queryByRole('link', { name: /^Тянуть билет/ })).toBeNull();
    expect(plain(within(list).getAllByRole('link')[0].textContent)).toContain('идёт сверка с лекциями');
  });

  it('starts empty with the department’s list as the one action', async () => {
    mocks.listExams.mockResolvedValue([]);
    renderList();
    expect(await screen.findByRole('heading', { name: 'Вставьте список вопросов, который дала кафедра' })).toBeInTheDocument();
    expect(screen.getByText(/Meldy отметит, какие вопросы есть в ваших лекциях/)).toBeInTheDocument();
    // The example exam is one quiet link away, for a student who wants to see it work first.
    expect(screen.getByRole('link', { name: 'Попробовать на примере' })).toHaveAttribute('href', '/try');
    fireEvent.click(screen.getByRole('button', { name: 'Вставить список вопросов' }));
    expect(await screen.findByRole('heading', { name: 'Новый экзамен' })).toBeInTheDocument();
  });

  it('says what failed and retries', async () => {
    mocks.listExams.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([item()]);
    renderList();
    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить экзамены' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('link', { name: /^Микроэкономика/ })).toBeInTheDocument();
  });
});

describe('row texts', () => {
  const now = new Date(2026, 9, 3, 12, 0, 0);
  it('words the date', () => {
    expect(examDateLine({ kind: 'exam', exam_date: '2026-10-15' }, now)).toBe('экзамен · 15 октября, через 12 дней');
    expect(examDateLine({ kind: 'credit', exam_date: '2026-10-04' }, now)).toBe('зачёт · 4 октября, завтра');
    expect(examDateLine({ kind: 'colloquium', exam_date: '2026-09-01' }, now)).toBe('коллоквиум · прошёл 1 сентября');
    expect(examDateLine({ kind: 'exam', exam_date: null }, now)).toBe('экзамен, дата не указана');
  });

  it('words the coverage', () => {
    expect(examCoverageLine(item(), 6, false)).toBe('24 из 40 вопросов есть в лекциях · подтверждено 6');
    expect(examCoverageLine(item({ total: 21, coverage: { full: 3, partial: 0, none: 18, unverified: 0, unmapped: 0 } }), 0, false)).toBe(
      '3 из 21 вопроса есть в лекциях',
    );
    expect(examCoverageLine(item(), null, true)).toBe('40 вопросов · идёт сверка с лекциями');
    expect(examCoverageLine(item({ total: 0 }), null, false)).toBe('вопросов пока нет');
  });
});
