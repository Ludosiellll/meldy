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

import ResultsPanel, { buildHtmlExport, restsOnLine } from './ResultsPanel';
import type { ResultExportItem, ResultTab } from './resultSections';

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
    expect(screen.getByText('Выжимка не получилась: модель не ответила.')).toBeInTheDocument();
  });

  it('says what rests on the fragments in the student’s words, never «confirmed» (finding LIB-19)', () => {
    const { unmount } = renderPanel({
      results: { ...partialResults(), quiz, grounding: { ...grounding, source_count: 23, citable_items: 9 } },
    });
    expect(screen.getByText('Конспект, карточки и тест опираются на 23 фрагмента лекции')).toBeInTheDocument();
    // Links found by matching words, not checked: «похожий фрагмент».
    expect(screen.getByText('у 9 пунктов есть ссылка на похожий фрагмент')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/подтвержд|исходник|наиболее похож/i);
    unmount();

    renderPanel({ results: { ...partialResults(), quiz, grounding: { ...grounding, source_count: 21, citable_items: 1 } } });
    expect(screen.getByText('Конспект, карточки и тест опираются на 21 фрагмент лекции')).toBeInTheDocument();
    expect(screen.getByText('у 1 пункта есть ссылка на похожий фрагмент')).toBeInTheDocument();
  });

  it('names only the materials the result has (QA 2026-10-11: «карточки и тест» under a lone конспект)', () => {
    const lone = { summarizer: summary, flashcards: { flashcards: [] }, quiz: { quiz: [] }, grounding: { ...grounding, source_count: 4, citable_items: 0 } } as AnalysisResults;
    const { unmount } = renderPanel({ results: lone });
    expect(screen.getByText('Конспект опирается на 4 фрагмента лекции')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/карточки|тест опира/i);
    unmount();

    // The test did not come: the summary and the cards rest on the fragments.
    renderPanel({ results: { ...partialResults(), grounding: { ...grounding, source_count: 23, citable_items: 9 } } });
    expect(screen.getByText('Конспект и карточки опираются на 23 фрагмента лекции')).toBeInTheDocument();
  });

  it('builds the line from what exists, with the verb in the right number', () => {
    expect(restsOnLine(['summary'], 4)).toBe('Конспект опирается на 4\u00a0фрагмента лекции');
    expect(restsOnLine(['flashcards'], 1)).toBe('Карточки опираются на 1\u00a0фрагмент лекции');
    expect(restsOnLine(['quiz'], 11)).toBe('Тест опирается на 11\u00a0фрагментов лекции');
    expect(restsOnLine(['summary', 'quiz'], 2)).toBe('Конспект и тест опираются на 2\u00a0фрагмента лекции');
    expect(restsOnLine(['summary', 'flashcards', 'quiz'], 5)).toBe('Конспект, карточки и тест опираются на 5\u00a0фрагментов лекции');
    expect(restsOnLine([], 5)).toBe('');
    expect(restsOnLine(['summary'], 0)).toBe('');
  });

  it('on the material page says it in one line next to the cards and the test, naming only those it has', () => {
    const { unmount } = renderPanel({
      embedded: true,
      initialTab: 'flashcards',
      results: { ...partialResults(), quiz, grounding: { ...grounding, source_count: 17, citable_items: 17 } },
    });
    expect(screen.getByText('Карточки и тест опираются на 17 фрагментов лекции · у 17 пунктов есть ссылка на похожий фрагмент')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/исходник|наиболее похож/i);
    unmount();

    // The test failed: the cards alone.
    renderPanel({
      embedded: true,
      initialTab: 'flashcards',
      results: { ...partialResults(), grounding: { ...grounding, source_count: 17, citable_items: 17 } },
    });
    expect(screen.getByText('Карточки опираются на 17 фрагментов лекции · у 17 пунктов есть ссылка на похожий фрагмент')).toBeInTheDocument();
  });

  it('on the material page says «Обработан частично» as a plain line when a saved section is not ok', () => {
    renderPanel({ embedded: true });
    const line = screen.getByText('Обработан частично');
    expect(line.tagName).toBe('P');
    expect(line.children).toHaveLength(0);
    expect(screen.queryByText('Материал обработан')).not.toBeInTheDocument();
  });

  it('on the material page says nothing about the status when every section is there or the row is legacy', () => {
    const { unmount } = renderPanel({
      embedded: true,
      results: { ...partialResults(), quiz, sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' } } },
    });
    expect(screen.queryByText('Обработан частично')).not.toBeInTheDocument();
    expect(screen.queryByText('Материал обработан')).not.toBeInTheDocument();
    unmount();

    renderPanel({ embedded: true, results: { summarizer: summary, flashcards: cards, quiz: { quiz: [] } } as AnalysisResults });
    expect(screen.queryByText('Обработан частично')).not.toBeInTheDocument();
  });

  it('on the material page shows no podcast tab or line: the page has its own «Подкаст»', () => {
    renderPanel({
      embedded: true,
      results: { ...partialResults(), quiz, sections: { summarizer: { status: 'ok' }, quiz: { status: 'ok' }, podcast: { status: 'busy' } } },
    });
    expect(screen.getByRole('button', { name: /^Тест/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Подкаст|Разговор/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/(Подкаст|Разговор) не получился/)).not.toBeInTheDocument();
  });

  it('on the analysis page names the two-host audio «Подкаст» (decision 1)', () => {
    renderPanel({
      results: {
        ...partialResults(),
        quiz,
        podcast: { podcast: [{ speaker: 'Макс', text: 'Что такое энтропия?' }, { speaker: 'Софья', text: 'Мера беспорядка.' }] },
        sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' }, podcast: { status: 'ok' } },
      } as AnalysisResults,
    });
    expect(screen.getByRole('button', { name: /^Подкаст/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Разговор/ })).not.toBeInTheDocument();
  });
});

describe('«Выжимка» on the result screen (QA 2026-10-11: made, and shown nowhere here)', () => {
  const brief = '# Экспресс-шпаргалка\n\n## Суть\n\nКлетка — основа жизни [S01].\n\n- **АТФ:** источник энергии [S02].';
  const withBrief = (): AnalysisResults => ({
    ...partialResults(),
    quiz,
    cheatsheet: { content: brief },
    podcast: { podcast: [{ speaker: 'Макс', text: 'Что такое клетка?' }] },
    sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' }, cheatsheet: { status: 'ok' }, podcast: { status: 'ok' } },
  });

  it('is a tab of its own, named as the picker and the lecture page name it, between the test and the podcast', () => {
    renderPanel({ results: withBrief() });
    const row = screen.getByRole('navigation', { name: 'Разделы результата' });
    expect(Array.from(row.querySelectorAll('.sf-sectab-label')).map(label => label.textContent)).toEqual(['Конспект', 'Карточки', 'Тест', 'Выжимка', 'Подкаст']);
    fireEvent.click(screen.getByRole('button', { name: 'Выжимка' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Выжимка' })).toBeInTheDocument();
    expect(screen.getByText('Главное из материала для быстрого повторения')).toBeInTheDocument();
    expect(screen.getByText('Клетка — основа жизни.')).toBeInTheDocument();
    // Neither the fragment marks nor the old name of its first heading.
    expect(document.querySelector('.xp-md')?.textContent).not.toMatch(/\[S0|шпаргалка/i);
  });

  it('copies the text as it is shown', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPanel({ results: withBrief() });
    fireEvent.click(screen.getByRole('button', { name: 'Выжимка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Копировать']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Копировать' }));
    expect(writeText).toHaveBeenCalledWith('## Суть\n\nКлетка — основа жизни.\n\n- **АТФ:** источник энергии.');
  });

  it('stays the lecture page’s own tab there, and a failed one is the line under the header', () => {
    const { unmount } = renderPanel({ results: withBrief(), embedded: true });
    expect(screen.queryByRole('button', { name: 'Выжимка' })).toBeNull();
    unmount();

    renderPanel({
      results: { ...withBrief(), cheatsheet: { content: '' }, sections: { ...withBrief().sections, cheatsheet: { status: 'failed', message: 'Модель не ответила' } } },
    });
    expect(screen.queryByRole('button', { name: 'Выжимка' })).toBeNull();
    expect(screen.getByText('Выжимка не получилась: модель не ответила.')).toBeInTheDocument();
  });
});

describe('«Подкаст» on the result screen opens with its player in view (QA 2026-10-11: ▶ below the first screen at 1532×734)', () => {
  const originalRect = Element.prototype.getBoundingClientRect;
  const withPodcast = (): AnalysisResults => ({
    ...partialResults(),
    quiz,
    podcast: { podcast: [{ speaker: 'Макс', text: 'Что такое энтропия?' }, { speaker: 'Софья', text: 'Мера беспорядка.' }] },
    sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' }, podcast: { status: 'ok' } },
  });
  let reveals: Array<ScrollIntoViewOptions | boolean | undefined>;

  beforeEach(() => {
    reveals = [];
    // The panel under the result's tall header: it starts at 508 px of a 734 px window.
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      const box = (y: number, h: number) => ({ top: y, bottom: y + h, left: 0, right: 900, width: 900, height: h, x: 0, y, toJSON: () => ({}) }) as DOMRect;
      if (this.classList.contains('cv-show')) return box(508, 495);
      if (this.classList.contains('cv-play')) return box(913, 60);
      if (this.classList.contains('cv-sheet')) return box(522, 258);
      return box(0, 0);
    };
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function scroll(this: HTMLElement, options?: ScrollIntoViewOptions | boolean) {
      if (this.classList.contains('cv-show')) reveals.push(options);
    });
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
  });

  it('brings the player into the window when the tab is opened', () => {
    renderPanel({ results: withPodcast() });
    expect(reveals).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^Подкаст/ }));
    expect(screen.getByRole('button', { name: 'Слушать' })).toBeInTheDocument();
    expect(reveals).toHaveLength(1);
  });
});

describe('the podcast voice is prepared while the result is read (QA 2026-10-11: 7–17 s of silence after the first ▶)', () => {
  const lines = [
    { speaker: 'Макс', text: 'Заранее: что такое **энтропия**?' },
    { speaker: 'Софья', text: 'Заранее: мера беспорядка системы.' },
    { speaker: 'Макс', text: 'Заранее: а третья реплика ждёт плеера.' },
  ];
  const withPodcast = (): AnalysisResults => ({
    ...partialResults(),
    quiz,
    podcast: { podcast: lines },
    sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' }, podcast: { status: 'ok' } },
  });
  const voiceAsked = () =>
    fetchMock.mock.calls
      .filter(([url]) => url === '/api/tts')
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { text: string; role: string });

  beforeEach(() => {
    let clips = 0;
    Object.defineProperty(URL, 'createObjectURL', { value: () => `blob:early-${(clips += 1)}`, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true, writable: true });
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/tts' ? { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['mp3']) } : jsonResponse(404, {}),
    );
  });
  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('asks for the first two lines on the analysis page before «Подкаст» is opened, in the voices the player uses', async () => {
    renderPanel({ results: withPodcast() });
    // The result opens on «Конспект»; the podcast's player is not on screen.
    expect(screen.queryByRole('button', { name: 'Слушать' })).toBeNull();
    await waitFor(() =>
      expect(voiceAsked()).toEqual([
        { text: 'Заранее: что такое энтропия?', role: 'male' },
        { text: 'Заранее: мера беспорядка системы.', role: 'female' },
      ]),
    );
  });

  it('asks for nothing on the lecture page, where «Подкаст» is the page’s own mode', async () => {
    renderPanel({ results: withPodcast(), embedded: true });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(voiceAsked()).toEqual([]);
  });
});

describe('opening tab', () => {
  const full = (): AnalysisResults => ({ ...partialResults(), quiz, sections: { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' } } });

  it('opens on the tab a link from «Прогресс» asks for (?section=quiz) when it has content', () => {
    renderPanel({ embedded: true, results: full(), initialTab: 'quiz' });
    expect(screen.getByRole('button', { name: /^Тест/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^Конспект/ })).not.toHaveAttribute('aria-current');
  });

  it('falls back to the first tab with content when the asked one is empty', () => {
    renderPanel({ embedded: true, results: { ...full(), quiz: { quiz: [] } }, initialTab: 'quiz' });
    expect(screen.getByRole('button', { name: /^Конспект/ })).toHaveAttribute('aria-current', 'page');
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
  it('shows one plain sentence and recreates the test as a repair of the saved material', async () => {
    const onResultsChange = vi.fn();
    renderPanel({ onResultsChange, analysisSettings: { summaryDetail: 'medium', flashcardCount: 6, quizCount: 5, quizDifficulty: 'mixed', quizType: 'multiple', enabledAgents: ['summarizer', 'flashcards', 'quiz'] } });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    expect(await screen.findByText('Тест не получился: сервис ИИ был перегружен.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));

    expect(await screen.findByText('Тест на экране')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/analyze/section');
    // The material's id lets the server repair a section of a paid analysis free (from the saved text).
    expect(JSON.parse(String(init.body))).toEqual({
      section: 'quiz',
      text: 'Энтропия — мера беспорядка системы.',
      material_id: 'm1',
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

describe('the test on a screen for an audience (finding LIB-17)', () => {
  it('opens from «Экспорт» on the test tab, not from inside the student’s test', async () => {
    renderPanel({ results: { ...partialResults(), quiz, sections: { quiz: { status: 'ok' } } } });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    await screen.findByText('Тест на экране');
    expect(db.quizProps).toMatchObject({ presenting: false });

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Показать тест на экране' }));
    expect(db.quizProps).toMatchObject({ presenting: true });
    expect(screen.queryByRole('menu', { name: 'Экспорт' })).not.toBeInTheDocument();

    act(() => (db.quizProps?.onExitPresentation as () => void)());
    expect(db.quizProps).toMatchObject({ presenting: false });
  });

  it('is not offered on the other tabs', () => {
    renderPanel({ results: { ...partialResults(), quiz, sections: { quiz: { status: 'ok' } } } });
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(screen.getByRole('menu', { name: 'Экспорт' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Показать тест на экране' })).not.toBeInTheDocument();
  });
});

describe('text-only materials', () => {
  it('shows the text-only notice instead of empty tabs and offers no export', () => {
    renderPanel({ results: { summarizer: { content: '' }, flashcards: { flashcards: [] }, quiz: { quiz: [] }, text_only: true }, embedded: true });
    expect(screen.getByText('Только текст, конспекта нет. Материал участвует в сверке экзаменов с лекциями.')).toBeInTheDocument();
    expect(screen.queryByText('Нет данных для отображения')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Экспорт' })).not.toBeInTheDocument();
  });
});

describe('HTML export', () => {
  it('leaves out the fragment marks the model copied into cards and questions (QA 2026-10-11)', () => {
    const html = buildHtmlExport(
      {
        summarizer: { content: 'Клетка — единица живого [S01].' },
        flashcards: { flashcards: [{ id: 1, question: 'Что такое клетка? [S01]', answer: 'Единица живого [S01, S02].' }] },
        quiz: { quiz: [{ id: 1, question: 'Где синтез АТФ? [S02]', options: ['A) В митохондриях [S02]', 'B) В ядре'], correct: 'A', explanation: 'Так в лекции [S02].' }] },
      } as unknown as AnalysisResults,
      'Клетка',
    );
    expect(html).not.toMatch(/\[S0/);
    expect(html).toContain('Что такое клетка?');
    expect(html).toContain('A) В митохондриях ✓');
  });

  it('is self-contained: no web-font links, the system font stack, no capitals by CSS', () => {
    const html = buildHtmlExport(
      { summarizer: { content: '# Энтропия\nМера беспорядка' }, flashcards: { flashcards: [] }, quiz: { quiz: [] } } as unknown as AnalysisResults,
      'Энтропия',
    );
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|<link/i);
    expect(html).not.toMatch(/'Inter'/);
    expect(html).toMatch(/font-family: system-ui/);
    expect(html).not.toMatch(/text-transform:\s*uppercase/);
    expect(html).toContain('Энтропия');
  });
});

describe('the lecture page’s own row on a phone (pageTabs, Phone_Declutter_2026-10-08)', () => {
  const allOk = (): AnalysisResults => ({ ...partialResults(), quiz, sections: { quiz: { status: 'ok' } } });

  function panel(section: ResultTab, results: AnalysisResults = allOk()) {
    return (
      <MemoryRouter>
        <ResultsPanel
          results={results}
          onReset={() => undefined}
          materialId="m1"
          originalText="Энтропия — мера беспорядка системы."
          embedded
          pageTabs={{ section, onSection: vi.fn(), exportItems }}
        />
      </MemoryRouter>
    );
  }
  let exportItems: { current: ResultExportItem[] };
  beforeEach(() => {
    exportItems = { current: [] };
  });

  it('shows the section the page chose, with no row and no «Экспорт» of its own, and hands «Экспорт» over', async () => {
    render(panel('quiz'));
    expect(await screen.findByText('Тест на экране')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Разделы результата' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Экспорт' })).toBeNull();
    // On a phone each card and question keeps its «фрагмент N»: no sentence about all of them above.
    expect(screen.queryByText(/опираются на/)).toBeNull();
    expect(exportItems.current.map(item => item.label)).toEqual(['Копировать', 'Печать или PDF', 'Показать тест на экране', 'Скачать HTML']);
    act(() => exportItems.current.find(item => item.key === 'present')?.run());
    expect(db.quizProps).toMatchObject({ presenting: true });
  });

  it('follows the page to another section and offers that section’s formats', () => {
    const view = render(panel('quiz'));
    view.rerender(panel('flashcards'));
    expect(screen.getByText('Что такое энтропия?')).toBeInTheDocument();
    expect(exportItems.current.map(item => item.label)).toEqual(['Копировать', 'Печать или PDF', 'Файл для Anki', 'Скачать HTML']);
  });

  it('offers no export for a text-only material', () => {
    render(panel('summary', { summarizer: { content: '' }, flashcards: { flashcards: [] }, quiz: { quiz: [] }, text_only: true } as AnalysisResults));
    expect(screen.getByText('Только текст, конспекта нет. Материал участвует в сверке экзаменов с лекциями.')).toBeInTheDocument();
    expect(exportItems.current).toEqual([]);
  });

  it('without it the panel keeps its row, its «Экспорт» and the line about fragments', () => {
    renderPanel({ embedded: true, results: allOk() });
    expect(screen.getByRole('navigation', { name: 'Разделы результата' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Карточки/ }));
    expect(screen.getByText(/Карточки и тест опираются на 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Копировать', 'Печать или PDF', 'Файл для Anki', 'Скачать HTML']);
  });
});
