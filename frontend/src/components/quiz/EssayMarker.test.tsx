import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestItem } from '../../types/container';

const calls = vi.hoisted(() => ({ check: vi.fn(), mark: vi.fn() }));
vi.mock('../../api/quizzes', () => ({
  essayCheck: calls.check,
  essayMark: calls.mark,
  EssayCheckError: class extends Error {
    code = 'no_lectures';
  },
}));
import EssayMarker from './EssayMarker';

const item = (materials: string[]): TestItem => ({
  id: 'item-1', container_id: 'c', subject_id: 's', position: 1, file_no: '1', topic: null, kind: 'essay', stem: 'Эссе',
  options: [], correct: [], answers: [], key_source: 'none', code: false, keep_order: false, flags: [], rev: 1, updated_at: '',
  images: null, explanation: '', material_ids: materials,
});
const answer = { item_id: 'item-1', chosen: null, text: 'Были три реформы.', correct: false, answered_at: '', mark: null, pending: true };

describe('EssayMarker: the author marks an essay', () => {
  afterEach(cleanup);
  beforeEach(() => {
    calls.check.mockReset();
    calls.mark.mockReset();
  });
  it('checks by the lectures and shows the mark with its quote', async () => {
    calls.check.mockResolvedValue({ verdict: 'partial', quote: 'Реформы шли в три этапа.', mark: { verdict: 'partial', quote: 'Реформы шли в три этапа.', source: 'ai' }, points: [] });
    const marked = vi.fn();
    render(<EssayMarker attemptId="a-1" item={item(['m1'])} answer={answer} onMarked={marked} />);
    expect(screen.getByText('Были три реформы.')).toBeTruthy();
    expect(screen.getByText('Ответ ещё не проверен.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить по лекциям' }));
    await waitFor(() => expect(marked).toHaveBeenCalledWith({ verdict: 'partial', quote: 'Реформы шли в три этапа.', source: 'ai' }));
    expect(calls.check).toHaveBeenCalledWith('a-1', 'item-1');
    expect(screen.getByText('Реформы шли в три этапа.')).toBeTruthy();
    expect(screen.getByText(/Проверено по лекциям/)).toBeTruthy();
  });
  it('without lectures the author marks by hand, and the word wins', async () => {
    calls.mark.mockResolvedValue({ verdict: 'full', quote: null, source: 'author' });
    const marked = vi.fn();
    render(<EssayMarker attemptId="a-1" item={item([])} answer={answer} onMarked={marked} />);
    expect(screen.queryByRole('button', { name: 'Проверить по лекциям' })).toBeNull();
    expect(screen.getByText('Лекции к вопросу не выбраны: оцените сами.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Полно' }));
    await waitFor(() => expect(marked).toHaveBeenCalledWith({ verdict: 'full', quote: null, source: 'author' }));
    expect(calls.mark).toHaveBeenCalledWith('a-1', 'item-1', 'full', null);
    expect(screen.getByRole('button', { name: 'Полно' }).getAttribute('aria-pressed')).toBe('true');
  });
});
