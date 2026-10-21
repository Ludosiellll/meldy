import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listQuizzes: vi.fn(), copyText: vi.fn() }));
vi.mock('../../api/quizzes', () => ({ listQuizzes: api.listQuizzes }));
vi.mock('../../lib/clipboard', () => ({ copyText: api.copyText }));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({ data: null, loading: true, offline: false, unavailable: false, error: null, gone: false, reload: vi.fn() }),
}));

import QuickLinkPage, { linkFacts } from './QuickLinkPage';
import { QUICK_LINK } from '../../components/quick/copyQuick';
import type { QuizListRow } from '../../types/quiz';

/* The контрольная's link at once after «Быстрая контрольная» (UX audit of 21.10, P1; mockup m3). */

function row(patch: Partial<QuizListRow> = {}): QuizListRow {
  return {
    id: 'q-1',
    container_id: 'c-1',
    code: 'k7m2p9q4r8st',
    title: 'Кислоты и основания, 9 Б',
    subject_ids: ['s-1'],
    item_count: 4,
    same_set: true,
    shuffle_items: false,
    shuffle_options: true,
    time_limit_s: null,
    opens_at: null,
    closes_at: new Date(2026, 9, 28, 23, 59).toISOString(),
    closed_at: null,
    attempts: 1,
    grading: 'best',
    allow_back: true,
    pass_percent: null,
    review: 'mistakes_then_answers',
    members_only: false,
    guests: true,
    cover_path: null,
    accent: 'blue',
    offer_practice: false,
    created_at: '2026-10-21T10:00:00Z',
    updated_at: '2026-10-21T10:00:00Z',
    state: 'open',
    started: false,
    people: 0,
    writing: 0,
    finished: 0,
    avg_percent: null,
    ...patch,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/exams/c/c-1/quizzes/q-1/link']}>
      <Routes>
        <Route path="/exams/c/:id/quizzes/:quizId/link" element={<QuickLinkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.listQuizzes.mockReset().mockResolvedValue([row()]);
  api.copyText.mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

describe('QuickLinkPage', () => {
  it('shows the link and its QR code at once, with the facts as tags', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Кислоты и основания, 9 Б' })).toBeInTheDocument();
    expect(screen.getByText(QUICK_LINK.ready)).toBeInTheDocument();
    expect(screen.getByText(QUICK_LINK.guests)).toBeInTheDocument();
    expect(screen.getByText(QUICK_LINK.noTime)).toBeInTheDocument();
    expect(screen.getByText(/Открыта до 28/)).toBeInTheDocument();
    expect(document.querySelector('.qk-qr svg path')).not.toBeNull();
    expect(screen.getByDisplayValue(`${window.location.host}/k/k7m2p9q4r8st`)).toBeInTheDocument();
    expect(api.listQuizzes).toHaveBeenCalledWith('c-1');
  });

  it('«Скопировать ссылку» copies the whole link and says so', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QUICK_LINK.copy }));
    expect(await screen.findByText(QUICK_LINK.copied)).toBeInTheDocument();
    expect(api.copyText.mock.calls[0][0]).toBe(`${window.location.origin}/k/k7m2p9q4r8st`);
  });

  it('the QR code opens over the whole screen and Escape closes it', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QUICK_LINK.full }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Кислоты и основания, 9 Б' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nobody yet: says where the results will be; then the counts', async () => {
    renderPage();
    expect(await screen.findByText(QUICK_LINK.nobody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: QUICK_LINK.openResults })).toHaveAttribute('href', '/exams/c/c-1/quizzes/q-1');
    cleanup();
    api.listQuizzes.mockResolvedValue([row({ people: 20, writing: 3, finished: 17 })]);
    renderPage();
    expect(await screen.findByText('Пишут 3')).toBeInTheDocument();
    expect(screen.getByText('Сдали 17')).toBeInTheDocument();
  });

  it('the next steps: the studio, the settings, another контрольная', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: QUICK_LINK.studio })).toHaveAttribute('href', '/exams/c/c-1/studio');
    expect(screen.getByRole('link', { name: QUICK_LINK.edit })).toHaveAttribute('href', '/exams/c/c-1/quizzes/q-1/edit');
    expect(screen.getByRole('link', { name: QUICK_LINK.another })).toHaveAttribute('href', '/tests/quick');
  });

  it('a контрольная that is gone, and a read that failed', async () => {
    api.listQuizzes.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(QUICK_LINK.missing)).toBeInTheDocument();
    cleanup();
    api.listQuizzes.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'network' })).mockResolvedValueOnce([row()]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QUICK_LINK.retry }));
    expect(await screen.findByText(QUICK_LINK.ready)).toBeInTheDocument();
  });

  it('linkFacts: the time and the end in words', () => {
    const now = new Date(2026, 9, 21);
    expect(linkFacts(row({ time_limit_s: 1200 }), now).slice(0, 3)).toEqual(['4 вопроса', 'На 20 минут', 'Открыта до 28 октября, 23:59']);
    expect(linkFacts(row({ closes_at: null, time_limit_s: 3600 }), now).slice(0, 3)).toEqual(['4 вопроса', 'На 1 час', 'Без срока']);
    expect(linkFacts(row({ state: 'closed' }), now)[2]).toBe('Закрыта');
    // When the right answers show (owner, 21.10: at the end, by default at once).
    expect(linkFacts(row({}), now)[3]).toBe('Верные ответы после закрытия');
    expect(linkFacts(row({ review: 'answers' }), now)[3]).toBe('Верные ответы сразу');
  });
});
