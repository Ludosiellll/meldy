import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AnalysisResults } from '../types';

const db = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  updateError: null as null | { message: string },
  sync: vi.fn(),
  increment: vi.fn(),
  verify: vi.fn(),
  quizProps: null as null | Record<string, unknown>,
  toastSuccess: vi.fn(),
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: clone(db.row), error: null }) }) }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => ({
          select: async () => {
            if (db.updateError) return { data: null, error: db.updateError };
            db.updates.push(clone(payload));
            Object.assign(db.row, clone(payload));
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock('../api/flashcards', () => ({ syncFlashcards: (...args: unknown[]) => db.sync(...args) }));
vi.mock('../api/limits', () => ({ incrementAIUsage: (...args: unknown[]) => db.increment(...args), checkAILimit: vi.fn() }));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: (...args: unknown[]) => db.verify(...args) }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../api/materials', () => ({ updateMaterialTitle: vi.fn() }));
vi.mock('./QuizView', () => ({
  default: (props: Record<string, unknown>) => {
    db.quizProps = props;
    return <div>Тест на экране</div>;
  },
}));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: (...args: unknown[]) => db.toastSuccess(...args), error: vi.fn() }),
}));

import ResultsPanel from './ResultsPanel';

const summary = { title: 'Энтропия', subject: 'Физика', content: 'Энтропия — мера беспорядка системы.', terms: [], source_ids: ['S01'] };
const cards = { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка', source_ids: ['S01'] }] };
const quiz = { quiz: [{ id: 1, question: 'Растёт ли энтропия?', options: ['A) Да', 'B) Нет'], correct: 'A', explanation: 'Да', source_ids: [] }] };
const grounding = { source_count: 1, citable_items: 1, sources: [{ id: 'S01', text: 'Энтропия — мера беспорядка системы.' }] };

function partialResults(): AnalysisResults {
  return {
    summarizer: summary,
    flashcards: cards,
    quiz: { quiz: [] },
    grounding,
    sections: {
      summarizer: { status: 'ok' },
      flashcards: { status: 'ok' },
      quiz: { status: 'busy', message: 'Сервис ИИ был перегружен' },
    },
  };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

function renderPanel(props: Partial<Parameters<typeof ResultsPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ResultsPanel results={partialResults()} onReset={() => undefined} materialId="m1" originalText="Энтропия — мера беспорядка системы." {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  db.row = { id: 'm1', user_id: 'user-1', original_text: 'Энтропия — мера беспорядка системы.', summary_json: { content: summary.content, sections: partialResults().sections } };
  db.updates = [];
  db.updateError = null;
  db.sync = vi.fn(async () => ({ inserted: 1, skipped: 0 }));
  db.increment = vi.fn();
  db.verify = vi.fn(async () => true);
  db.quizProps = null;
  db.toastSuccess = vi.fn();
  fetchMock = vi.fn(async () => jsonResponse(200, { section: 'quiz', status: 'ok', result: quiz, grounding: { source_count: 1, sources: grounding.sources } }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('header', () => {
  it('says «Материал обработан» only when every requested section is ok', () => {
    renderPanel({
      results: { ...partialResults(), quiz, sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' } } },
    });
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
    expect(screen.queryByText('Обработан частично')).not.toBeInTheDocument();
  });

  it('says «Обработан частично» when a requested section failed and keeps its tab', () => {
    renderPanel();
    expect(screen.getByText('Обработан частично')).toBeInTheDocument();
    expect(screen.queryByText('Материал обработан')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Тест/ })).toBeInTheDocument();
    expect(screen.queryByText(/Остальные результаты доступны/)).not.toBeInTheDocument();
  });

  it('shows the interrupted-stream line for partial results', () => {
    renderPanel({ partial: true });
    expect(screen.getByText('Связь прервалась. Показаны разделы, которые успели прийти.')).toBeInTheDocument();
  });

  it('hides the interrupted-stream line once no section is missing', () => {
    renderPanel({
      partial: true,
      results: { ...partialResults(), quiz, sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' } } },
    });
    expect(screen.queryByText('Связь прервалась. Показаны разделы, которые успели прийти.')).not.toBeInTheDocument();
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
  });

  it('a legacy material without sections shows no failure lines', () => {
    renderPanel({ results: { summarizer: summary, flashcards: cards, quiz: { quiz: [] } } as AnalysisResults });
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Тест/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/не получил/)).not.toBeInTheDocument();
  });

  it('mentions a failed cheat sheet, which has no tab here', () => {
    renderPanel({
      results: {
        ...partialResults(),
        quiz,
        sections: { summarizer: { status: 'ok' }, quiz: { status: 'ok' }, cheatsheet: { status: 'failed', message: 'Модель не ответила' } },
      },
    });
    expect(screen.getByText('Шпаргалка не получилась: модель не ответила.')).toBeInTheDocument();
  });

  it('calls lexical source links «наиболее похожий фрагмент», never confirmed', () => {
    const { unmount } = renderPanel({
      results: { ...partialResults(), grounding: { ...grounding, source_count: 23, citable_items: 9 } },
    });
    expect(screen.getByText('Основано на 23 фрагментах исходника')).toBeInTheDocument();
    expect(screen.getByText('у 9 пунктов есть ссылка на наиболее похожий фрагмент')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/подтвержд/i);
    unmount();

    renderPanel({ results: { ...partialResults(), grounding: { ...grounding, source_count: 21, citable_items: 1 } } });
    expect(screen.getByText('Основано на 21 фрагменте исходника')).toBeInTheDocument();
    expect(screen.getByText('у 1 пункта есть ссылка на наиболее похожий фрагмент')).toBeInTheDocument();
  });

  it('on the material page shows no conversation tab or line: the page has its own «Разговор»', () => {
    renderPanel({
      embedded: true,
      results: { ...partialResults(), quiz, sections: { summarizer: { status: 'ok' }, quiz: { status: 'ok' }, podcast: { status: 'busy' } } },
    });
    expect(screen.getByRole('button', { name: /^Тест/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Разговор/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Разговор не получился/)).not.toBeInTheDocument();
  });
});

describe('preview of an unsaved result (repeat demo run)', () => {
  it('writes nothing: no recreate, no title edit, no quiz journal', async () => {
    renderPanel({ preview: true });
    expect(screen.queryByRole('button', { name: 'Изменить название' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    expect(await screen.findByText('Тест не получился: сервис ИИ был перегружен.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать тест заново' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Станет доступно/)).not.toBeInTheDocument();
    cleanup();

    renderPanel({ preview: true, results: { ...partialResults(), quiz, sections: { quiz: { status: 'ok' } } } });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    await screen.findByText('Тест на экране');
    // Без materialId QuizView не ведёт журнал и не пишет «не сохранён».
    expect(db.quizProps).not.toBeNull();
    expect(db.quizProps?.materialId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });
});

describe('a section that arrives after the panel closed', () => {
  it('is saved and handed to the parent, without a toast for a screen that is gone', async () => {
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => (release = resolve)));
    const onResultsChange = vi.fn();
    const view = renderPanel({ onResultsChange });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать тест заново' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.unmount();

    await act(async () => release(jsonResponse(200, { section: 'quiz', status: 'ok', result: quiz })));
    await waitFor(() => expect(onResultsChange).toHaveBeenCalledTimes(1));
    expect(onResultsChange).toHaveBeenCalledWith(expect.objectContaining({ quiz }), 'quiz');
    expect(db.updates[0]).toEqual({ quiz_json: quiz });
    expect(db.toastSuccess).not.toHaveBeenCalled();
  });
});

describe('«Создать … заново»', () => {
  it('shows one plain sentence and recreates the test without charging', async () => {
    const onResultsChange = vi.fn();
    renderPanel({ onResultsChange, analysisSettings: { summaryDetail: 'medium', flashcardCount: 6, quizCount: 5, quizDifficulty: 'mixed', quizType: 'multiple', enabledAgents: ['summarizer', 'flashcards', 'quiz'] } });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    expect(await screen.findByText('Тест не получился: сервис ИИ был перегружен.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));

    expect(await screen.findByText('Тест на экране')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/analyze/section');
    expect(JSON.parse(String(init.body))).toEqual({
      section: 'quiz',
      text: 'Энтропия — мера беспорядка системы.',
      settings: { summary_detail: 'medium', flashcard_count: 6, quiz_count: 5, quiz_difficulty: 'mixed', quiz_type: 'multiple' },
    });
    // Сначала содержимое, затем статус раздела.
    expect(db.updates[0]).toEqual({ quiz_json: quiz });
    expect((db.updates[1].summary_json as Record<string, unknown>).sections).toMatchObject({ quiz: { status: 'ok' } });
    expect((db.updates[1].summary_json as Record<string, unknown>).content).toBe(summary.content);
    expect(onResultsChange).toHaveBeenCalledWith(
      expect.objectContaining({ quiz, sections: expect.objectContaining({ quiz: { status: 'ok' } }) }),
      'quiz',
    );
    expect(db.increment).not.toHaveBeenCalled();
    expect(db.verify).not.toHaveBeenCalled();
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
  });

  it('recreates cards, saves them and adds them to review', async () => {
    const newCards = { flashcards: [{ id: 1, question: 'Где энтропия не убывает?', answer: 'В изолированной системе', source_ids: ['S01'] }] };
    fetchMock.mockImplementation(async () => jsonResponse(200, { section: 'flashcards', status: 'ok', result: newCards, grounding: { source_count: 1, sources: [] } }));
    renderPanel({
      results: { ...partialResults(), quiz, flashcards: { flashcards: [] }, sections: { summarizer: { status: 'ok' }, flashcards: { status: 'empty' }, quiz: { status: 'ok' } } },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Карточки/ }));
    expect(await screen.findByText('Карточки не получились: модель вернула пустой ответ.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать карточки заново' }));
    await waitFor(() => expect(db.sync).toHaveBeenCalledTimes(1));
    expect(db.sync).toHaveBeenCalledWith('user-1', 'm1', newCards.flashcards);
    expect(db.updates[0]).toEqual({ flashcards_json: newCards });
    expect(db.increment).not.toHaveBeenCalled();
  });

  it('says so when the new cards did not reach review and retries the sync', async () => {
    const newCards = { flashcards: [{ id: 1, question: 'Где энтропия не убывает?', answer: 'В изолированной системе' }] };
    fetchMock.mockImplementation(async () => jsonResponse(200, { section: 'flashcards', status: 'ok', result: newCards }));
    db.sync = vi.fn(async () => {
      throw new Error('Не удалось добавить карточки в повторение.');
    });
    renderPanel({ results: { ...partialResults(), flashcards: { flashcards: [] }, sections: { flashcards: { status: 'failed' } } } });
    fireEvent.click(screen.getByRole('button', { name: /^Карточки/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать карточки заново' }));
    expect(await screen.findByText('Карточки не добавлены в повторение.')).toBeInTheDocument();
    db.sync = vi.fn(async () => ({ inserted: 1, skipped: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Карточки не добавлены в повторение.')).not.toBeInTheDocument());
  });

  it('recreates the summary through a summary_json patch', async () => {
    const newSummary = { title: 'Энтропия', subject: 'Физика', content: '# Энтропия\nНовый конспект', terms: [{ term: 'Энтропия', definition: 'Мера беспорядка' }], source_ids: ['S01'] };
    fetchMock.mockImplementation(async () => jsonResponse(200, { section: 'summarizer', status: 'ok', result: newSummary }));
    db.row.summary_json = { content: '', podcast: [{ speaker: 'Макс', text: 'Привет' }], sections: { summarizer: { status: 'timeout' } } };
    renderPanel({
      results: { summarizer: { content: '' }, flashcards: cards, quiz, sections: { summarizer: { status: 'timeout' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' } } },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Конспект/ }));
    expect(await screen.findByText('Конспект не получился: модель не ответила вовремя.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать конспект заново' }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    const saved = db.updates[0].summary_json as Record<string, unknown>;
    expect(saved.content).toBe(newSummary.content);
    expect(saved.terms).toEqual(newSummary.terms);
    expect(saved.podcast).toEqual([{ speaker: 'Макс', text: 'Привет' }]);
    expect(saved.sections).toMatchObject({ summarizer: { status: 'ok' } });
    expect(await screen.findByText('Новый конспект')).toBeInTheDocument();
  });

  it('shows the server detail on failure and keeps the button', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(422, { detail: 'Модель вернула непригодный тест. Попробуйте ещё раз.' }));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать тест заново' }));
    expect(await screen.findByText('Модель вернула непригодный тест. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать тест заново' })).toBeEnabled();
    expect(db.updates).toHaveLength(0);
  });

  it('a 502 HTML page gives a readable message, not parser text', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать тест заново' }));
    expect(await screen.findByText('Сервер сейчас недоступен. Повторите попытку через минуту.')).toBeInTheDocument();
  });

  it('names a busy or silent AI service by its error code', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(429, { detail: 'Сервис ИИ сейчас занят. Подождите минуту и попробуйте ещё раз.', code: 'ai_busy' }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать тест заново' }));
    expect(await screen.findByText('Сервис ИИ сейчас занят. Подождите минуту и попробуйте ещё раз.')).toBeInTheDocument();

    fetchMock.mockImplementation(async () => jsonResponse(504, { detail: 'ИИ-сервис не ответил вовремя. Попробуйте ещё раз.', code: 'ai_timeout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));
    expect(await screen.findByText('ИИ-сервис не ответил вовремя. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(db.updates).toHaveLength(0);
  });

  it('does not show a section that could not be saved', async () => {
    db.updateError = { message: 'network' };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать тест заново' }));
    expect(await screen.findByText('Раздел создан, но сохранить его не удалось. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(screen.queryByText('Тест на экране')).not.toBeInTheDocument();
  });

  it('is disabled until the material is saved and while a section is being created', async () => {
    const { rerender } = renderPanel({ materialId: undefined });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    expect(await screen.findByRole('button', { name: 'Создать тест заново' })).toBeDisabled();
    expect(screen.getByText('Станет доступно, когда материал сохранится в библиотеке.')).toBeInTheDocument();

    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => (release = resolve)));
    rerender(
      <MemoryRouter>
        <ResultsPanel results={partialResults()} onReset={() => undefined} materialId="m1" originalText="Энтропия — мера беспорядка системы." />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Создать тест заново' }));
    const busy = await screen.findByRole('button', { name: 'Создаём тест…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => release(jsonResponse(200, { section: 'quiz', status: 'ok', result: quiz })));
    expect(await screen.findByText('Тест на экране')).toBeInTheDocument();
  });

  it('is not offered on someone else’s material', async () => {
    renderPanel({ canEdit: false });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    expect(await screen.findByText('Тест не получился: сервис ИИ был перегружен.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать тест заново' })).not.toBeInTheDocument();
  });
});

describe('quiz journal props', () => {
  it('passes materialId, topic and surface to QuizView', async () => {
    renderPanel({ results: { ...partialResults(), quiz, sections: { quiz: { status: 'ok' } } } });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    await screen.findByText('Тест на экране');
    expect(db.quizProps).toMatchObject({ materialId: 'm1', topic: 'Физика', surface: 'analysis' });
  });

  it('uses the title as the topic and the material surface when embedded', async () => {
    renderPanel({
      embedded: true,
      materialId: undefined,
      sourceFileName: 'Лекция про энтропию.pdf',
      results: { summarizer: { content: 'Текст' }, flashcards: { flashcards: [] }, quiz },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    await screen.findByText('Тест на экране');
    expect(db.quizProps).toMatchObject({ materialId: null, topic: 'Лекция про энтропию', surface: 'material' });
  });
});

describe('text-only materials', () => {
  it('shows the text-only notice instead of empty tabs and offers no export', () => {
    renderPanel({ results: { summarizer: { content: '' }, flashcards: { flashcards: [] }, quiz: { quiz: [] }, text_only: true }, embedded: true });
    expect(screen.getByText('Только текст, конспекта нет. Материал участвует в разметке экзаменов.')).toBeInTheDocument();
    expect(screen.queryByText('Нет данных для отображения')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Экспорт' })).not.toBeInTheDocument();
  });
});
