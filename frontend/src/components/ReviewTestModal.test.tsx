import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewTestModal from './ReviewTestModal';

const api = vi.hoisted(() => ({
  generateReviewTest: vi.fn(),
  updateModuleReview: vi.fn(),
}));

vi.mock('../api/career', () => ({
  generateReviewTest: api.generateReviewTest,
  updateModuleReview: api.updateModuleReview,
}));

const questions = [1, 2, 3].map(id => ({
  id,
  question: `Вопрос ${id}`,
  options: [`A) Верный ответ ${id}`, `B) Неверный ответ ${id}`],
  correct: 'A',
  explanation: `Пояснение ${id}`,
}));

function renderModal(onComplete = vi.fn()) {
  render(
    <StrictMode>
      <ReviewTestModal
        moduleId="module-1"
        moduleTitle="SQL: группировка"
        moduleTheory="GROUP BY объединяет строки."
        practiceType="sql"
        courseProfession="Аналитик"
        token="test-token"
        onClose={vi.fn()}
        onComplete={onComplete}
      />
    </StrictMode>,
  );
  return onComplete;
}

async function answerCorrectly(user: ReturnType<typeof userEvent.setup>, id: number) {
  await user.click(await screen.findByRole('button', { name: `A) Верный ответ ${id}` }));
}

describe('ReviewTestModal scoring', () => {
  beforeEach(() => {
    api.generateReviewTest.mockResolvedValue({ questions });
    api.updateModuleReview.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('scores three correct answers out of three as 100%', async () => {
    const user = userEvent.setup();
    const onComplete = renderModal();

    await answerCorrectly(user, 1);
    await user.click(screen.getByRole('button', { name: /Следующий вопрос/ }));
    await answerCorrectly(user, 2);
    await user.click(screen.getByRole('button', { name: /Следующий вопрос/ }));
    await answerCorrectly(user, 3);
    await user.click(screen.getByRole('button', { name: /Завершить тест/ }));

    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(api.updateModuleReview).toHaveBeenCalledWith('module-1', 'Аналитик', 100, 'test-token');
    expect(onComplete).toHaveBeenCalledWith(100);
  });

  it('counts a timed-out question once as a wrong answer', async () => {
    // jsdom drives requestAnimationFrame with setInterval, so fake time must keep flowing for animations.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: true });
    const user = userEvent.setup();
    const onComplete = renderModal();

    expect(await screen.findByText(/Вопрос 1/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(await screen.findByText('Пояснение 1')).toBeInTheDocument();
    expect(screen.getByText('0с')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `A) Верный ответ 1` })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Следующий вопрос/ }));
    await answerCorrectly(user, 2);
    await user.click(screen.getByRole('button', { name: /Следующий вопрос/ }));
    await answerCorrectly(user, 3);
    await user.click(screen.getByRole('button', { name: /Завершить тест/ }));

    expect(await screen.findByText('67%')).toBeInTheDocument();
    expect(api.updateModuleReview).toHaveBeenCalledWith('module-1', 'Аналитик', 67, 'test-token');
    expect(onComplete).toHaveBeenCalledWith(67);
  });
});
