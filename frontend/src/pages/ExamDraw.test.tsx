import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ExamBundle, ExamQuestion } from '../api/exams';
import type { LearningEvent } from '../api/learning';

const mocks = vi.hoisted(() => ({
  loadExamBundle: vi.fn(),
  prefetchRubric: vi.fn(),
  fetchQuestionEvents: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/exams')>();
  return { ...actual, loadExamBundle: mocks.loadExamBundle, prefetchRubric: mocks.prefetchRubric };
});
vi.mock('../api/learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/learning')>();
  return { ...actual, fetchQuestionEvents: mocks.fetchQuestionEvents };
});

import ExamDraw, { skippedNote } from './ExamDraw';

const hash = (n: number) => n.toString(16).padStart(32, 'b');

function question(n: number, coverage: ExamQuestion['coverage'] = 'full'): ExamQuestion {
  return {
    id: `q${n}`,
    exam_id: 'exam-1',
    position: n,
    label: String(n),
    section: null,
    text: `Вопрос номер ${n} о рынке`,
    question_hash: hash(n),
    coverage,
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    evidence: [],
    nearest: [],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: '2026-10-03T06:40:00Z',
    created_at: '2026-10-01T06:40:00Z',
  };
}

function bundle(questions: ExamQuestion[], layout: ExamBundle['exam']['ticket_layout'] = { mode: 'random', per_ticket: 2 }): ExamBundle {
  return {
    exam: {
      id: 'exam-1',
      title: 'Микроэкономика',
      kind: 'exam',
      exam_date: null,
      source_kind: 'paste',
      source_text: '',
      ticket_layout: layout,
      mapping_state: 'done',
      mapping_started_at: null,
      mapped_at: '2026-10-03T06:40:00Z',
      mapped_material_ids: ['m1'],
      created_at: '2026-10-01T06:40:00Z',
    },
    questions,
    materialIds: ['m1'],
    materials: [{ id: 'm1', title: 'Лекция' }],
  };
}

function answer(n: number): LearningEvent {
  return {
    id: `a${n}`,
    created_at: '2026-10-02T10:00:00Z',
    local_date: '2026-10-02',
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${hash(n)}`,
    correct: true,
    score: 0.8,
    confidence: null,
    source_ids: [],
    session_id: `s${n}`,
    payload: { grade: 4 },
  };
}

let location = '';
function Where() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

function renderDraw(path = '/exams/exam-1/draw') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/:id/draw" element={<ExamDraw />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.loadExamBundle.mockReset();
  mocks.prefetchRubric.mockReset();
  mocks.fetchQuestionEvents.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExamDraw', () => {
  it('draws a ticket on arrival and opens the answer screen with its questions', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw();
    const card = await screen.findByRole('article', { name: /Случайный билет: вопросы 1 и 2/ });
    expect(card).toHaveTextContent('Вопрос номер 1 о рынке');
    expect(card).toHaveTextContent('Вопрос номер 2 о рынке');
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    expect(location).toBe('/exams/exam-1/ticket?q=q1,q2');
  });

  it('passes the department’s ticket number for a known ticket', async () => {
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1), question(2), question(3), question(4)], { mode: 'fixed', per_ticket: 2, tickets: [{ number: 12, question_ids: ['q1', 'q3'] }] }),
    );
    renderDraw();
    expect(await screen.findByRole('article', { name: 'Билет 12: вопросы 1 и 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    expect(location).toBe('/exams/exam-1/ticket?q=q1,q3&n=12');
  });

  it('prepares answer keys only for drawn questions that are in the lectures, and says which one is not', async () => {
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'full'), question(2, 'none')], { mode: 'fixed', per_ticket: 2, tickets: [{ number: 3, question_ids: ['q1', 'q2'] }] }),
    );
    renderDraw();
    await screen.findByRole('article', { name: 'Билет 3: вопросы 1 и 2' });
    expect(mocks.prefetchRubric).toHaveBeenCalledTimes(1);
    expect(mocks.prefetchRubric).toHaveBeenCalledWith('exam-1', 'q1');
    expect(screen.getByText(/Этого вопроса нет в ваших лекциях — оценить ответ не по чему/)).toBeInTheDocument();
    expect(screen.getByText('Отвечать будете на один вопрос: вопроса 2 нет в ваших лекциях.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    expect(location).toBe('/exams/exam-1/ticket?q=q1&n=3');
  });

  it('offers only another draw when every drawn question is missing from the lectures', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'none')], { mode: 'random', per_ticket: 1 }));
    renderDraw();
    await screen.findByRole('article', { name: 'Вопрос 1' });
    expect(mocks.prefetchRubric).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Отвечать' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Тянуть ещё' })).toBeInTheDocument();
  });

  it('draws only from answered questions in that mode and says so once, in the top line', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3), question(4)], { mode: 'random', per_ticket: 1 }));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(3)]);
    renderDraw('/exams/exam-1/draw?mode=answered');
    const single = await screen.findByRole('article', { name: 'Вопрос 3' });
    // One question: the card's line is the one the answer screen's card will have, said once.
    expect(single.querySelector('.dw-no')?.textContent).toBe('Вопрос 3');
    expect(single.querySelector('.dw-q-n')).toBeNull();
    expect(document.querySelector('.sf-room-bar .dw-long')?.textContent).toBe('Микроэкономика · тянуть вопрос, из уже отвеченных');
    expect(document.querySelector('.sf-room-bar .dw-short')?.textContent).toBe('Тянуть вопрос');
    // No second choice of the mode on this page: it sits under «Тянуть билет» on the sheet.
    expect(screen.queryByRole('list', { name: 'Как тянуть' })).toBeNull();
  });

  it('puts the card where the ticket card will be and «Отвечать» in the column next to it', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw();
    const card = await screen.findByRole('article', { name: /Случайный билет/ });
    const room = document.querySelector('main.dw-room') as HTMLElement;
    expect(card.closest('.dw-left-col')?.parentElement).toBe(room);
    const answer = screen.getByRole('button', { name: 'Отвечать' });
    expect(answer.closest('.dw-side')?.parentElement).toBe(room);
    expect(screen.getByRole('button', { name: 'Тянуть ещё' }).closest('.dw-acts')).toBe(answer.closest('.dw-acts'));
  });

  it('explains an empty answered pool and offers the exam mode', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw('/exams/exam-1/draw?mode=answered');
    expect(await screen.findByText(/Вы ещё не отвечали вслух ни на один вопрос этого экзамена/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Тянуть как на экзамене' }));
    expect(await screen.findByRole('article', { name: /Случайный билет/ })).toBeInTheDocument();
    expect(location).toBe('/exams/exam-1/draw');
  });

  it('«Тянуть ещё» never repeats the last three tickets', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3), question(4), question(5)], { mode: 'random', per_ticket: 1 }));
    renderDraw();
    await screen.findByRole('article', { name: /Вопрос \d/ });
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const card = screen.getByRole('article', { name: /Вопрос \d/ });
      seen.push(card.getAttribute('aria-label') ?? '');
      fireEvent.click(screen.getByRole('button', { name: 'Тянуть ещё' }));
    }
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen.slice(Math.max(0, i - 3), i)).not.toContain(seen[i]);
    }
    const stored = JSON.parse(window.sessionStorage.getItem('meldy_exam_last_tickets_exam-1') ?? '[]');
    expect(stored).toHaveLength(3);
  });

  it('reads the way of drawing from the address chosen on the sheet', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2), question(3)]));
    renderDraw('/exams/exam-1/draw?mode=weak');
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(document.querySelector('.sf-room-bar .dw-long')?.textContent).toBe('Микроэкономика · тянуть билет, чаще слабые');
  });

  it('voices nothing (correction 7)', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    renderDraw();
    await screen.findByRole('article', { name: /Случайный билет/ });
    expect(speak).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('tts'))).toHaveLength(0);
  });

  it('lifts the top card, except under prefers-reduced-motion', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    const first = renderDraw();
    expect(await screen.findByRole('article', { name: /Случайный билет/ })).toHaveAttribute('data-state', 'lift');
    first.unmount();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    renderDraw();
    const card = await screen.findByRole('article', { name: /Случайный билет/ });
    // Reduced motion: no lift and no turn, only a 150 ms fade.
    expect(card).toHaveAttribute('data-state', 'fade');
  });

  it('keeps the way back to the sheet in the room bar and explains a missing exam', async () => {
    mocks.loadExamBundle.mockResolvedValue(null);
    renderDraw();
    expect(await screen.findByRole('heading', { name: 'Экзамен не найден' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/exam-1');
  });

  it('still draws when the answer history could not be read', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1), question(2)]));
    mocks.fetchQuestionEvents.mockRejectedValue(new Error('offline'));
    renderDraw();
    expect(await screen.findByText('История ответов не загрузилась: тянем без неё.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('article', { name: /Случайный билет/ })).toBeInTheDocument());
  });
});

describe('skippedNote', () => {
  it('names the questions that will not be answered', () => {
    expect(skippedNote(1, ['36'])).toBe('Отвечать будете на один вопрос: вопроса 36 нет в ваших лекциях.');
    expect(skippedNote(2, ['5', '9'])).toBe('Отвечать будете на 2 вопроса: вопросов 5, 9 нет в ваших лекциях.');
  });
});
