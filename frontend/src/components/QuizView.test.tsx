import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuizView, { correctOptionIndex } from './QuizView';

const journal = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../api/learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/learning')>();
  return { ...actual, recordQuizAttempt: (...args: unknown[]) => journal.record(...args) };
});

const MATERIAL_ID = '11111111-2222-4333-8444-555555555555';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const quiz = {
  quiz: [
    {
      id: 1,
      question: 'Что измеряет энтропия?',
      options: ['A) Беспорядок системы', 'B) Массу тела', 'C) Скорость света', 'D) Заряд'],
      correct: 'A',
      explanation: 'Энтропия — мера беспорядка.',
      source_ids: ['S01'],
    },
    {
      id: 2,
      question: 'Растёт ли энтропия изолированной системы?',
      options: ['A) Да', 'B) Нет'],
      correct: 'A)',
      explanation: 'Второй закон термодинамики.',
      source_ids: [],
    },
    {
      id: 3,
      question: 'Кто ввёл понятие энтропии?',
      options: ['A) Ньютон', 'B) Клаузиус'],
      correct: 'Клаузиус',
      explanation: '',
      source_ids: ['S03'],
    },
  ],
};

function savedResult(overrides: Record<string, unknown> = {}) {
  return { events: 3, duplicate: false, retake: false, mistakesAdded: 0, mistakesExisting: 0, ...overrides };
}

function renderQuiz(props: Partial<Parameters<typeof QuizView>[0]> = {}) {
  const view = render(
    <MemoryRouter>
      <QuizView data={quiz} materialId={MATERIAL_ID} topic="Физика" surface="analysis" {...props} />
    </MemoryRouter>,
  );
  return {
    ...view,
    rerenderQuiz: (next: Partial<Parameters<typeof QuizView>[0]>) =>
      view.rerender(
        <MemoryRouter>
          <QuizView data={quiz} materialId={MATERIAL_ID} topic="Физика" surface="analysis" {...props} {...next} />
        </MemoryRouter>,
      ),
  };
}

function choose(questionNumber: number, optionText: string) {
  const question = screen.getByText(new RegExp(`^${questionNumber}\\. `));
  const group = screen.getByRole('group', { name: question.textContent ?? '' });
  fireEvent.click(within(group).getByRole('button', { name: new RegExp(optionText) }));
}

/** Two right answers (1 and 2) and one wrong (3). */
function answerTwoOfThree() {
  choose(1, 'Беспорядок системы');
  choose(2, 'Да');
  choose(3, 'Ньютон');
}

describe('QuizView scoring', () => {
  afterEach(cleanup);

  it('reads the right option from a letter, a letter with «)», Cyrillic letters or the option text', () => {
    const options = ['A) Да', 'B) Нет', 'C) Не знаю', 'D) Иногда'];
    expect(correctOptionIndex(options, 'A')).toBe(0);
    expect(correctOptionIndex(options, 'b')).toBe(1);
    expect(correctOptionIndex(options, 'C)')).toBe(2);
    expect(correctOptionIndex(options, 'D) Иногда')).toBe(3);
    expect(correctOptionIndex(options, 'Нет')).toBe(1);
    expect(correctOptionIndex(options, 'B) Нет')).toBe(1);
    // A Cyrillic «В» typed for the Latin «B» label.
    expect(correctOptionIndex(options, 'В')).toBe(1);
    // Cyrillic lettering by position when the options carry no labels of their own.
    expect(correctOptionIndex(['Да', 'Нет', 'Не знаю', 'Иногда'], 'Г')).toBe(3);
    expect(correctOptionIndex(['Да', 'Нет', 'Не знаю', 'Иногда'], 'Б)')).toBe(1);
    expect(correctOptionIndex(['А) Да', 'Б) Нет', 'В) Не знаю'], 'В')).toBe(2);
  });

  it('leaves a question unscored when the right answer is empty, unknown or contradictory', () => {
    const options = ['A) Да', 'B) Нет'];
    expect(correctOptionIndex(options, '')).toBeNull();
    expect(correctOptionIndex(options, '   ')).toBeNull();
    expect(correctOptionIndex(options, undefined)).toBeNull();
    expect(correctOptionIndex(options, 'E')).toBeNull();
    expect(correctOptionIndex(options, 'Возможно')).toBeNull();
    expect(correctOptionIndex(options, 'A) Нет')).toBeNull();
    expect(correctOptionIndex([], 'A')).toBeNull();
  });

  it('never counts an empty right answer as correct', () => {
    journal.record.mockResolvedValue(savedResult());
    render(
      <MemoryRouter>
        <QuizView
          data={{ quiz: [
            { id: 1, question: 'Вопрос без ключа?', options: ['A) Да', 'B) Нет'], correct: '' },
            { id: 2, question: 'Вопрос с ключом?', options: ['A) Да', 'B) Нет'], correct: 'B' },
          ] }}
        />
      </MemoryRouter>,
    );
    choose(1, 'Да');
    choose(2, 'Да');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));

    expect(screen.getByText('0 из 1 верно — нужно подтянуть')).toBeInTheDocument();
    expect(screen.getByText('Правильный ответ не указан, вопрос не учитывается.')).toBeInTheDocument();
    expect(screen.getByText(/Без правильного ответа: 1 вопрос/)).toBeInTheDocument();
    // Without the materialId prop nothing goes to the journal.
    expect(journal.record).not.toHaveBeenCalled();
  });
});

describe('QuizView journal', () => {
  beforeEach(() => {
    journal.record.mockReset();
    journal.record.mockResolvedValue(savedResult());
  });

  afterEach(cleanup);

  it('records one checked attempt with every answer and retake false', async () => {
    renderQuiz();
    answerTwoOfThree();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));

    expect(await screen.findByText('Результат сохранён')).toBeInTheDocument();
    // No words of the 5-point scale (Ф1): the count and the share only.
    expect(screen.getByText('2 из 3 верно')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Отлично|Хорошо|Удовлетворительно/);
    expect(screen.getByText('67% правильных ответов')).toBeInTheDocument();
    expect(journal.record).toHaveBeenCalledTimes(1);
    const input = journal.record.mock.calls[0][0];
    expect(input).toMatchObject({ materialId: MATERIAL_ID, retake: false, surface: 'analysis', topic: 'Физика' });
    expect(input.sessionId).toMatch(UUID);
    expect(input.answers).toEqual([
      {
        index: 0, question: 'Что измеряет энтропия?', chosen: 'A', chosenText: 'Беспорядок системы',
        expected: 'A', expectedText: 'Беспорядок системы', correct: true,
        explanation: 'Энтропия — мера беспорядка.', sourceIds: ['S01'], options: 4,
      },
      {
        index: 1, question: 'Растёт ли энтропия изолированной системы?', chosen: 'A', chosenText: 'Да',
        expected: 'A', expectedText: 'Да', correct: true,
        explanation: 'Второй закон термодинамики.', sourceIds: [], options: 2,
      },
      {
        index: 2, question: 'Кто ввёл понятие энтропии?', chosen: 'A', chosenText: 'Ньютон',
        expected: 'B', expectedText: 'Клаузиус', correct: false,
        explanation: '', sourceIds: ['S03'], options: 2,
      },
    ]);
  });

  it('starts a new session marked as a retake after «Пройти снова»', async () => {
    renderQuiz();
    answerTwoOfThree();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));
    await screen.findByText('Результат сохранён');

    fireEvent.click(screen.getByRole('button', { name: 'Пройти снова' }));
    answerTwoOfThree();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));
    await screen.findByText('Результат сохранён');

    expect(journal.record).toHaveBeenCalledTimes(2);
    const [first, second] = journal.record.mock.calls.map((call) => call[0]);
    expect(first.retake).toBe(false);
    expect(second.retake).toBe(true);
    expect(second.sessionId).toMatch(UUID);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('says when the server counted the attempt as a retake', async () => {
    journal.record.mockResolvedValue(savedResult({ retake: true }));
    renderQuiz();
    answerTwoOfThree();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));

    expect(await screen.findByText('Повторная попытка: в «Прогрессе» считается первая')).toBeInTheDocument();
  });

  it('links the mistakes that went to the diary', async () => {
    journal.record.mockResolvedValue(savedResult({ mistakesAdded: 5 }));
    renderQuiz();
    answerTwoOfThree();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));

    expect(await screen.findByRole('link', { name: '5 ошибок добавлены в дневник ошибок' })).toHaveAttribute('href', '/mistakes');
  });

  it('shows a retry line for a rejected save and retries with the same session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    journal.record.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(savedResult());
    renderQuiz();
    answerTwoOfThree();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Результат не сохранён.');
    expect(alert).not.toHaveTextContent('offline');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Результат сохранён')).toBeInTheDocument();
    expect(journal.record).toHaveBeenCalledTimes(2);
    const [first, retry] = journal.record.mock.calls.map((call) => call[0]);
    expect(retry.sessionId).toBe(first.sessionId);
    expect(retry.answers).toEqual(first.answers);
    expect(retry.retake).toBe(false);
  });

  it('does not save before the material is in the library, and saves once it arrives', async () => {
    const { rerenderQuiz } = renderQuiz({ materialId: null });
    answerTwoOfThree();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответы' }));

    expect(screen.getByText('Результат не сохранён: материал ещё не в библиотеке')).toBeInTheDocument();
    expect(journal.record).not.toHaveBeenCalled();

    rerenderQuiz({ materialId: MATERIAL_ID });
    expect(await screen.findByText('Результат сохранён')).toBeInTheDocument();
    expect(journal.record).toHaveBeenCalledTimes(1);
    expect(journal.record.mock.calls[0][0].materialId).toBe(MATERIAL_ID);
  });

  it('never records the presentation mode', () => {
    renderQuiz();
    fireEvent.click(screen.getByRole('button', { name: 'Режим презентации для аудитории' }));
    const dialog = screen.getByRole('dialog', { name: 'Режим презентации' });
    expect(within(dialog).getByText('Режим презентации · ответы зрителей не сохраняются')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Беспорядок системы/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Следующий вопрос' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Да/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Следующий вопрос' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Клаузиус/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Завершить тест' }));

    expect(within(dialog).getByText('3 из 3')).toBeInTheDocument();
    expect(journal.record).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть презентацию' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(journal.record).not.toHaveBeenCalled();
  });

  it('uses neither gradients nor uppercase labels in the presentation mode', () => {
    renderQuiz();
    fireEvent.click(screen.getByRole('button', { name: 'Режим презентации для аудитории' }));
    const dialog = screen.getByRole('dialog', { name: 'Режим презентации' });
    expect(dialog.outerHTML).not.toMatch(/gradient|uppercase/);
  });
});
