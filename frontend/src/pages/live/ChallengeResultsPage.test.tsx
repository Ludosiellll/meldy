/**
 * The challenge's page for its author (/live/challenge/<id>): the link with its QR code, «Скопировать», «Закрыть
 * досрочно» after a confirmation, the results (the finished by place, those under way, «Убрать»), each question with
 * how many got it right and the hardest marked; someone else's challenge says so.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setChallengeApi } from '../../lib/challenge/api';
import type { ChallengeApi, ChallengeResults } from '../../lib/challenge/types';
import { LiveError } from '../../lib/live/types';
import { CPAGE } from '../../components/challenge/copyAuthor';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, loading: false, requestSession: () => {} }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

import ChallengeResultsPage from './ChallengeResultsPage';

const look = { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' } as const;
const RESULTS: ChallengeResults = {
  code: 'k7m2p9q4r8st', title: 'Базы данных', q_count: 4, time_s: 20, speed: true, deadline: '2026-11-03T20:59:00.000Z', state: 'open', over: null,
  finished: 2, playing: 1, challenge_id: 'ch1', container_id: 'c1', quiz_id: null, skipped: 0, path: '/s/k7m2p9q4r8st',
  url: 'https://ludosiel-studyforge.hf.space/s/k7m2p9q4r8st', created_at: '2026-10-31T10:00:00.000Z', closed_at: null,
  runs: [
    { run_id: 'r1', place: 1, name: 'Аня', look, dmg: 412, right: 4, time_ms: 31000, answered: 4, joined_at: '', finished_at: '2026-10-31T11:00:00.000Z', removed: false },
    { run_id: 'r2', place: 2, name: 'Боря', look, dmg: 210, right: 2, time_ms: 52000, answered: 4, joined_at: '', finished_at: '2026-10-31T12:00:00.000Z', removed: false },
    { run_id: 'r3', place: null, name: 'Вика', look, dmg: 98, right: 1, time_ms: 9000, answered: 2, joined_at: '', finished_at: null, removed: false },
  ],
  questions: [
    { qi: 0, text: 'Какая команда отменяет транзакцию?', kind: 'single', answered: 3, right: 3, partial: 0 },
    { qi: 1, text: 'Какие команды относятся к DML?', kind: 'multiple', answered: 3, right: 1, partial: 1 },
    { qi: 2, text: 'Язык запросов?', kind: 'short', answered: 2, right: 2, partial: 0 },
    { qi: 3, text: 'Байт в килобайте?', kind: 'number', answered: 2, right: 1, partial: 0 },
  ],
};

const api = { results: vi.fn(), close: vi.fn(), remove: vi.fn() };
beforeEach(() => {
  api.results.mockReset().mockResolvedValue(RESULTS);
  api.close.mockReset().mockResolvedValue({});
  api.remove.mockReset().mockResolvedValue(undefined);
  setChallengeApi({ kind: 'fake', ...api } as unknown as ChallengeApi);
});
afterEach(() => {
  cleanup();
  setChallengeApi(null);
});

async function open() {
  const view = render(
    <MemoryRouter initialEntries={['/live/challenge/ch1']}>
      <Routes>
        <Route path="/live/challenge/:id" element={<ChallengeResultsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  return view;
}

describe('the challenge’s page', () => {
  it('shows the link with its QR code, the results and the questions', async () => {
    const view = await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Базы данных' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\/s\/k7m2p9q4r8st$/ })).toHaveAttribute('href', '/s/k7m2p9q4r8st');
    expect(screen.getByRole('img', { name: 'QR-код ссылки' })).toBeInTheDocument();
    const rows = within(view.container.querySelector('.lcp-table tbody') as HTMLElement).getAllByRole('row');
    expect(rows.map((r) => r.querySelector('.lcp-place')?.textContent)).toEqual(['1', '2', '—']);
    expect(rows[2].textContent).toContain(CPAGE.underway(2, 4));
    expect(view.container.textContent).toContain('Прошли: 2 · Играют сейчас: 1');
    const hard = view.container.querySelector('.lcp-questions li[data-hard="true"]');
    expect(hard?.textContent).toContain('Какие команды относятся к DML?');
    expect(hard?.textContent).toContain(CPAGE.hard);
  });

  it('«Закрыть досрочно» asks first, then closes', async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CPAGE.close }));
    });
    expect(screen.getByRole('alertdialog').textContent).toContain('Кто уже отвечает на вопрос, успеет его закончить.');
    expect(api.close).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CPAGE.closeYes }));
    });
    expect(api.close).toHaveBeenCalledWith('ch1');
  });

  it('«Убрать» takes a name off the table after a confirmation', async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: CPAGE.remove })[1]);
    });
    expect(screen.getByRole('alertdialog').textContent).toContain('«Боря»');
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: CPAGE.removeYes }));
    });
    expect(api.remove).toHaveBeenCalledWith('ch1', 'r2');
  });

  it('someone else’s challenge says so', async () => {
    api.results.mockReset().mockRejectedValue(new LiveError('42501', 'author', 403));
    await open();
    expect(screen.getByRole('alert').textContent).toContain(CPAGE.notMine);
  });
});
