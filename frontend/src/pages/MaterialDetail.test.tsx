import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

/* ── Память вместо Supabase: одна строка materials, записи видны сразу ───── */

type Material = {
  id: string;
  user_id: string;
  title: string;
  subject: string;
  is_public: boolean;
  created_at: string;
  original_text: string;
  summary_json: Record<string, unknown>;
  flashcards_json: unknown;
  quiz_json: unknown;
};

const state = vi.hoisted(() => ({
  material: null as unknown as Material,
  /** Другие материалы по id (для переходов между страницами). */
  others: {} as Record<string, Material>,
  writes: [] as Array<Record<string, unknown>>,
  updateError: false,
  userId: 'user-1',
  /** Cards the lecture got from ticket answers (lib/followupCards). */
  followups: 0,
  increment: vi.fn(),
  confirm: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toast: vi.fn(),
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const rowById = (id: unknown) => state.others[String(id)] ?? state.material;

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, id: unknown) => ({ single: async () => ({ data: clone(rowById(id)), error: null }) }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => {
          const apply = () => {
            const row = rowById(id);
            if (state.updateError) return { data: null, error: { message: 'network' } };
            // Как RLS: чужую строку обновить нельзя — 0 строк, без ошибки.
            if (row.user_id !== state.userId) return { data: [], error: null };
            state.writes.push(clone(payload));
            Object.assign(row, clone(payload));
            return { data: [{ id: row.id }], error: null };
          };
          return {
            then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
              Promise.resolve(apply()).then(resolve, reject),
            select: async () => apply(),
          };
        },
      }),
    }),
  },
}));
vi.mock('../api/materials', async importOriginal => ({
  ...(await importOriginal<typeof import('../api/materials')>()),
  getMaterialById: vi.fn(async (id: string) => clone(rowById(id))),
  updateMaterialSubject: vi.fn(),
  updateMaterialTitle: vi.fn(),
  deleteMaterial: vi.fn(async () => undefined),
}));
// The count of follow-up cards is one request to flashcard_progress: the tests say what it returns.
vi.mock('../lib/followupCards', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/followupCards')>()),
  followupCardsOf: vi.fn(async () => state.followups),
}));
// The server charges the AI jobs; the page only refreshes the meter afterwards.
vi.mock('../api/limits', () => ({
  notifyAIUsageChanged: (...args: unknown[]) => state.increment(...args),
  // The guide's «Лимит ИИ» chapter (reached through the first-use tip) names the reset time.
  formatLimitReset: () => '3:00',
  nextLimitReset: () => new Date(),
}));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: vi.fn(async () => true) }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock('../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => state.confirm(...args), alert: vi.fn(async () => undefined) }),
}));
vi.mock('react-hot-toast', () => ({
  default: Object.assign((...args: unknown[]) => state.toast(...args), {
    success: (...args: unknown[]) => state.toastSuccess(...args),
    error: (...args: unknown[]) => state.toastError(...args),
  }),
}));

import MaterialDetail, { materialMeta } from './MaterialDetail';
import { PHONE_QUERY } from '../lib/usePhone';
import ResultsPanel from '../components/ResultsPanel';
import { resetJobsForTests } from '../components/conversation/jobs';
import { stopTTS } from '../utils/tts';

/* ── Звук: настоящий utils/tts, поддельный <audio> ─────────────────────── */

type Listener = () => void;
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  paused = true;
  playbackRate = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  private listeners = new Map<string, Listener[]>();
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string) {
    (this.listeners.get(type) ?? []).forEach(listener => listener());
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, headers: new Headers(), json: async () => body, blob: async () => new Blob(['mp3']) }) as unknown as Response;

const legacyLines = [
  { speaker: 'Макс', text: 'Привет! О чём сегодня поговорим?' },
  { speaker: 'Софья', text: 'Про энтропию и порядок в системах.' },
  { speaker: 'Макс', text: 'А почему это важно?' },
];

function makeMaterial(summary: Record<string, unknown> = {}, owner = 'user-1'): Material {
  return {
    id: 'm1',
    user_id: owner,
    title: 'Энтропия',
    subject: 'Физика',
    is_public: false,
    created_at: '2026-10-01T10:00:00Z',
    original_text: 'Энтропия — мера беспорядка. В изолированной системе энтропия не убывает.',
    summary_json: { content: 'Конспект про энтропию', terms: [{ term: 'Энтропия', definition: 'Мера беспорядка' }], ...summary },
    flashcards_json: null,
    quiz_json: null,
  };
}

const generated = {
  podcast: [
    { speaker: 'Макс', text: 'Что такое энтропия?', source_ids: ['S01'], visual: { type: 'term', term: 'Энтропия', definition: 'Мера беспорядка' } },
    { speaker: 'Софья', text: 'Это мера беспорядка системы.', source_ids: ['S01'] },
  ],
};
const visualsPayload = {
  visuals: [{ index: 1, visual: { type: 'steps', title: 'Порядок и беспорядок', items: ['Порядок', 'Беспорядок'] } }],
};

let pending: Record<string, Array<ReturnType<typeof deferred<Response>>>> = {};
let urlCounter = 0;

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/library/:id" element={<MaterialDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

const savedPodcast = () => (state.material.summary_json.podcast as unknown[] | undefined) ?? [];

beforeEach(() => {
  resetJobsForTests();
  state.others = {};
  stopTTS();
  pending = {};
  FakeAudio.instances = [];
  state.writes = [];
  state.updateError = false;
  state.userId = 'user-1';
  state.followups = 0;
  state.material = makeMaterial({ podcast: [] });
  state.increment = vi.fn(async () => undefined);
  state.confirm = vi.fn(async () => true);
  state.toastSuccess = vi.fn();
  state.toastError = vi.fn();
  state.toast = vi.fn();
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => `blob:audio-${++urlCounter}`);
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => undefined) } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/tts') return jsonResponse({});
      const call = deferred<Response>();
      (pending[url] ??= []).push(call);
      return call.promise;
    }),
  );
});

afterEach(() => {
  cleanup();
  stopTTS();
  vi.unstubAllGlobals();
});

describe('summary_json writes do not overwrite each other', () => {
  it('keeps a conversation that was saved while the cheatsheet was being made', async () => {
    renderPage('/library/m1?mode=express');
    fireEvent.click(await screen.findByRole('tab', { name: /Подкаст/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать подкаст' }));
    await waitFor(() => expect(pending['/api/podcast/generate']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Выжимка/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать выжимку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));

    // Разговор готов первым и сохраняется…
    await act(async () => pending['/api/podcast/generate'][0].resolve(jsonResponse(generated)));
    await waitFor(() => expect(savedPodcast()).toHaveLength(2));
    // …а выжимка, начатая раньше, не возвращает старый пустой разговор.
    await act(async () => pending['/api/quick-prep'][0].resolve(jsonResponse({ cheatsheet: '# Главное' })));
    await waitFor(() => expect(state.material.summary_json.cheatsheet).toBe('# Главное'));
    expect(savedPodcast()).toHaveLength(2);
    expect(state.increment).toHaveBeenCalledTimes(2); // both jobs refreshed the meter (the server charged them)

    expect(await screen.findByRole('heading', { name: 'Главное' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Подкаст/ }));
    expect(screen.queryByText('Подкаста по этой лекции ещё нет')).not.toBeInTheDocument();
    expect(screen.getByText('Что такое энтропия?', { selector: 'section[aria-label="Субтитры"] p' })).toBeInTheDocument();
  });

  it('does not charge energy for a cheatsheet the user cannot save', async () => {
    state.material = makeMaterial({}, 'teacher-1');
    state.userId = 'user-1';
    renderPage('/library/m1?mode=express');
    expect(await screen.findByText('Выжимку может создать только автор материала.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать выжимку' })).not.toBeInTheDocument();
  });
});

describe('model jobs outlive the tab that started them', () => {
  it('keeps «Добавить схемы» busy after a tab switch and runs the paid job once', async () => {
    state.material = makeMaterial({ cheatsheet: '# Выжимка', podcast: legacyLines });
    renderPage('/library/m1?mode=express&tab=podcast');
    fireEvent.click(await screen.findByRole('button', { name: /Добавить схемы/ }));
    await waitFor(() => expect(pending['/api/podcast/visuals']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Выжимка/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Подкаст/ }));

    const busy = await screen.findByRole('button', { name: /Подбираем схемы/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(pending['/api/podcast/visuals']).toHaveLength(1);

    await act(async () => pending['/api/podcast/visuals'][0].resolve(jsonResponse(visualsPayload)));
    await waitFor(() => expect(state.increment).toHaveBeenCalledTimes(1));
    expect(state.toastSuccess).toHaveBeenCalledWith('Схемы добавлены');
    expect((savedPodcast()[1] as { visual?: { type: string } }).visual?.type).toBe('steps');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Добавить схемы|Подбираем схемы/ })).not.toBeInTheDocument());
  });

  it('a job that finishes after its player closed does not silence the reopened player', async () => {
    state.material = makeMaterial({ cheatsheet: '# Выжимка', podcast: legacyLines });
    renderPage('/library/m1?mode=express&tab=podcast');
    fireEvent.click(await screen.findByRole('button', { name: /Добавить схемы/ }));
    await waitFor(() => expect(pending['/api/podcast/visuals']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Выжимка/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Подкаст/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Слушать' }));
    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThan(0));
    const audio = FakeAudio.instances[FakeAudio.instances.length - 1];
    act(() => audio.emit('playing'));
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();

    await act(async () => pending['/api/podcast/visuals'][0].resolve(jsonResponse(visualsPayload)));
    await waitFor(() => expect(state.increment).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(audio.paused).toBe(false);
    expect(audio.onended).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();

    // Реплика заканчивается — плеер идёт дальше, к реплике с новой схемой.
    await act(async () => {
      audio.onended?.();
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(screen.getByText('Реплика 2 из 3')).toBeInTheDocument();
    const scene = screen.getByRole('region', { name: 'Сцена' }).querySelector('[data-scene-layer="active"]') as HTMLElement;
    expect(within(scene).getByText('Порядок и беспорядок')).toBeInTheDocument();
  });

  it('keeps «Создать выжимку» busy after switching to «Материал» and back', async () => {
    renderPage('/library/m1?mode=express');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать выжимку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Материал/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Выжимка/ }));
    expect(await screen.findByRole('button', { name: /Составляем выжимку/ })).toBeDisabled();

    await act(async () => pending['/api/quick-prep'][0].resolve(jsonResponse({ cheatsheet: '# Готово' })));
    expect(await screen.findByRole('heading', { name: 'Выжимка' })).toBeInTheDocument();
    expect(pending['/api/quick-prep']).toHaveLength(1);
    expect(state.increment).toHaveBeenCalledTimes(1);
  });

  it('shows the cheatsheet error inline and does not charge for a failed answer', async () => {
    renderPage('/library/m1?mode=express');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать выжимку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));
    await act(async () =>
      pending['/api/quick-prep'][0].resolve({
        ok: false,
        status: 502,
        json: async () => ({ detail: 'Не удалось создать выжимку. Попробуйте ещё раз.' }),
      } as unknown as Response),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось создать выжимку. Попробуйте ещё раз.');
    expect(state.writes).toHaveLength(0);
    expect(state.increment).not.toHaveBeenCalled();
  });

  it('keeps the results panel conversation busy across its own tab switches', async () => {
    render(
      <MemoryRouter>
        <ResultsPanel
          results={{ summarizer: { content: 'Конспект про энтропию' }, podcast: { podcast: legacyLines } } as never}
          onReset={() => undefined}
          materialId="m1"
        />
      </MemoryRouter>,
    );
    state.material = makeMaterial({ podcast: legacyLines });
    fireEvent.click(screen.getByRole('button', { name: /Подкаст/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Добавить схемы/ }));
    await waitFor(() => expect(pending['/api/podcast/visuals']).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Конспект/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Подкаст/ }));
    expect(await screen.findByRole('button', { name: /Подбираем схемы/ })).toBeDisabled();
  });
});

describe('a job that finishes after the page moved to another material', () => {
  it('saves to its own material and does not show up on the other one', async () => {
    let go: (to: string) => void = () => undefined;
    function Navigator() {
      go = useNavigate();
      return null;
    }
    const second = { ...makeMaterial({ podcast: [] }), id: 'm2', title: 'Второй материал' };
    state.others = { m2: second };
    render(
      <MemoryRouter initialEntries={['/library/m1?mode=express&tab=podcast']}>
        <Navigator />
        <Routes>
          <Route path="/library/:id" element={<MaterialDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Создать подкаст' }));
    await waitFor(() => expect(pending['/api/podcast/generate']).toHaveLength(1));

    act(() => go('/library/m2?mode=express&tab=podcast'));
    expect(await screen.findByRole('heading', { name: 'Второй материал' })).toBeInTheDocument();

    await act(async () => pending['/api/podcast/generate'][0].resolve(jsonResponse(generated)));
    await waitFor(() => expect(state.increment).toHaveBeenCalledTimes(1));
    expect(savedPodcast()).toHaveLength(2);
    expect(second.summary_json.podcast).toEqual([]);
    expect(screen.getByText('Подкаста по этой лекции ещё нет')).toBeInTheDocument();
  });
});

describe('materials of other authors', () => {
  it('offers no paid model work and no sharing to a student on a teacher material', async () => {
    state.material = makeMaterial({ podcast: [] }, 'teacher-1');
    renderPage('/library/m1?mode=express&tab=podcast');
    expect(await screen.findByText('Подкаст может создать только автор лекции.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать подкаст' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).not.toBeInTheDocument();
    // Only the author gets «⋯» (rename, subject, sharing); the meta line says whose it is.
    expect(screen.queryByRole('button', { name: 'Действия с лекцией' })).not.toBeInTheDocument();
    expect(screen.getByText(/материал другого автора/, { selector: '.md-meta' })).toBeInTheDocument();
  });

  it('hides «Добавить схемы» on someone else’s legacy conversation', async () => {
    state.material = makeMaterial({ podcast: legacyLines }, 'teacher-1');
    renderPage('/library/m1?mode=express&tab=podcast');
    expect(await screen.findByRole('button', { name: 'Слушать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить схемы/ })).not.toBeInTheDocument();
  });
});

/** «Поделиться» lives in «⋯» (design critique 12): open the menu, pick the item. */
async function chooseFromMenu(item: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Действия с лекцией' }));
  fireEvent.click(within(screen.getByRole('menu', { name: 'Действия с лекцией' })).getByRole('menuitem', { name: item }));
}

describe('sharing a material', () => {
  it('asks before publishing and does nothing when the user cancels', async () => {
    state.confirm = vi.fn(async () => false);
    renderPage('/library/m1');
    await chooseFromMenu('Поделиться');
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    // A public material is readable without an account: the question says what the link shows (jury memo 13, F5).
    expect(state.confirm.mock.calls[0][0].message).toBe(
      'По ссылке любой сможет открыть название и конспект этого материала, без входа в Meldy. Исходный текст лекции по ссылке не показывается. Закрыть доступ можно в любой момент.',
    );
    expect(state.confirm.mock.calls[0][0].message).not.toMatch(/другие студенты/);
    expect(state.writes).toHaveLength(0);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByText(/только для меня/, { selector: '.md-meta' })).toBeInTheDocument();
  });

  it('does not claim success when the update fails', async () => {
    state.updateError = true;
    renderPage('/library/m1');
    await chooseFromMenu('Поделиться');
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Не удалось открыть доступ. Попробуйте ещё раз.'));
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByText(/только для меня/, { selector: '.md-meta' })).toBeInTheDocument();
  });

  it('publishes, then copies the link', async () => {
    renderPage('/library/m1');
    await chooseFromMenu('Поделиться');
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith('Доступ открыт, ссылка скопирована'));
    expect(state.writes).toEqual([{ is_public: true }]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/shared/m1`);
    expect(screen.getByText(/открыт по ссылке/, { selector: '.md-meta' })).toBeInTheDocument();
    // The menu closed and gave the focus back to «⋯».
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Действия с лекцией' })).toHaveFocus();

    // Уже открытый материал: ссылка копируется без второго вопроса.
    await chooseFromMenu('Поделиться');
    await waitFor(() => expect(state.toastSuccess).toHaveBeenLastCalledWith('Ссылка скопирована'));
    expect(state.confirm).toHaveBeenCalledTimes(1);

    // «Закрыть доступ» appears only for a public material and makes it private again.
    await chooseFromMenu('Закрыть доступ');
    await waitFor(() => expect(state.writes).toEqual([{ is_public: true }, { is_public: false }]));
    expect(await screen.findByText(/только для меня/, { selector: '.md-meta' })).toBeInTheDocument();
  });
});

describe('the lecture header (design critique 12)', () => {
  it('says subject, who sees it and when it was added in one line, without chips or a numeric date', async () => {
    renderPage('/library/m1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Энтропия' })).toBeInTheDocument();
    expect(screen.getByText(/^Физика · только для меня · 1 октября, \d{1,2}:00$/, { selector: '.md-meta' })).toBeInTheDocument();
    expect(screen.queryByText(/\d{2}\.\d{2}\.\d{4}/)).not.toBeInTheDocument();
  });

  it('repeats the meta line in the row of the tabs for a low window, hidden from screen readers', async () => {
    const { container } = renderPage('/library/m1');
    await screen.findByRole('heading', { level: 1, name: 'Энтропия' });
    const copy = container.querySelector('.md-toolbar-meta') as HTMLElement;
    expect(copy).toHaveAttribute('aria-hidden', 'true');
    expect(copy.textContent).toBe((container.querySelector('.md-meta') as HTMLElement).textContent);
    expect(copy.closest('.md-toolbar')).toContainElement(screen.getByRole('tablist', { name: 'Режим' }));

    // While the subject is being edited, the field says it; the copy waits.
    await chooseFromMenu('Изменить предмет');
    expect(container.querySelector('.md-toolbar-meta')).toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Предмет' }), { key: 'Escape' });
    expect(container.querySelector('.md-toolbar-meta')).not.toBeNull();
  });

  it('has no «Новый анализ» and no second filled button; «Экспорт» is a link with a menu', async () => {
    renderPage('/library/m1');
    await screen.findByText('Конспект про энтропию');
    expect(screen.queryByRole('button', { name: /Новый анализ/ })).not.toBeInTheDocument();
    const exportButton = screen.getByRole('button', { name: 'Экспорт' });
    expect(exportButton).toHaveClass('sf-link');
    fireEvent.click(exportButton);
    expect(within(screen.getByRole('menu', { name: 'Экспорт' })).getByRole('menuitem', { name: 'Копировать' })).toBeInTheDocument();
    fireEvent.keyDown(exportButton, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Экспорт' })).not.toBeInTheDocument();
    expect(exportButton).toHaveFocus();
  });

  it('renames and changes the subject from «⋯»', async () => {
    const api = await import('../api/materials');
    renderPage('/library/m1');
    await chooseFromMenu('Переименовать');
    const title = screen.getByRole('textbox', { name: 'Название лекции' });
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: 'Энтропия и порядок' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Энтропия и порядок' })).toBeInTheDocument();
    expect(api.updateMaterialTitle).toHaveBeenCalledWith('m1', 'Энтропия и порядок');

    await chooseFromMenu('Изменить предмет');
    const subject = screen.getByRole('textbox', { name: 'Предмет' });
    fireEvent.change(subject, { target: { value: 'Термодинамика' } });
    fireEvent.keyDown(subject, { key: 'Escape' });
    expect(screen.getByText(/^Физика · /, { selector: '.md-meta' })).toBeInTheDocument();
    expect(api.updateMaterialSubject).not.toHaveBeenCalled();
  });
});

describe('mode switcher', () => {
  it('follows the tabs pattern: one tab stop, arrows, Home/End and a labelled panel', async () => {
    state.material = makeMaterial({ cheatsheet: '# Выжимка', podcast: legacyLines });
    renderPage('/library/m1');
    const material = await screen.findByRole('tab', { name: /Материал/ });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', material.id);
    expect(material).toHaveAttribute('aria-controls', panel.id);

    material.focus();
    fireEvent.keyDown(material, { key: 'ArrowRight' });
    const brief = screen.getByRole('tab', { name: /Выжимка/ });
    expect(brief).toHaveAttribute('aria-selected', 'true');
    expect(brief).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', brief.id);

    fireEvent.keyDown(brief, { key: 'End' });
    expect(screen.getByRole('tab', { name: /Подкаст/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Подкаст/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Материал/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Материал/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Подкаст/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('«Выжимка»: one name for the tab and its card, as in the picker and on the result screen (QA 2026-10-11)', () => {
  it('says «Выжимка» once, hides the old heading of a saved text and does not rewrite the text', async () => {
    const saved = '# Экспресс-шпаргалка\n\n## Суть в 3 словах\n\nЭнтропия не убывает.';
    state.material = makeMaterial({ cheatsheet: saved, podcast: [] });
    renderPage('/library/m1?mode=express');
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByRole('heading', { level: 2, name: 'Выжимка' })).toBeInTheDocument();
    expect(within(panel).getAllByText('Выжимка')).toHaveLength(1);
    expect(within(panel).getByRole('heading', { name: 'Суть в 3 словах' })).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/шпаргалк/i);
    expect(state.material.summary_json.cheatsheet).toBe(saved);
    expect(state.writes).toHaveLength(0);
  });
});

describe('section statuses saved with the material', () => {
  const quizPayload = {
    quiz: [{ id: 1, question: 'Убывает ли энтропия изолированной системы?', options: ['A) Нет', 'B) Да'], correct: 'A', explanation: 'Не убывает.', source_ids: [] }],
  };

  it('shows a failed section from summary_json.sections and recreates it for free', async () => {
    state.material = {
      ...makeMaterial({ sections: { summarizer: { status: 'ok' }, quiz: { status: 'busy', message: 'Сервис ИИ был перегружен' } } }),
      quiz_json: { quiz: [] },
    };
    renderPage('/library/m1');
    // Сценарий 11: сохранённый {quiz: busy} — страница материала говорит, что он обработан частично.
    expect(await screen.findByText('Обработан частично')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^Тест/ }));
    expect(screen.getByText('Тест не получился: сервис ИИ был перегружен.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));
    await waitFor(() => expect(pending['/api/analyze/section']).toHaveLength(1));
    // Spec 4.6: while it runs, the link says so in words; no spinner, no card around the failure.
    expect(screen.getByRole('button', { name: 'Создаём тест…' })).toBeDisabled();
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.getByText('Тест не получился: сервис ИИ был перегружен.').closest('.rounded-xl')).toBeNull();
    await act(async () => pending['/api/analyze/section'][0].resolve(jsonResponse({ section: 'quiz', status: 'ok', result: quizPayload })));

    expect(await screen.findByText(/Убывает ли энтропия изолированной системы\?/)).toBeInTheDocument();
    expect(screen.queryByText('Обработан частично')).not.toBeInTheDocument();
    expect(state.material.quiz_json).toEqual(quizPayload);
    expect((state.material.summary_json.sections as Record<string, unknown>).quiz).toEqual({ status: 'ok' });
    expect(state.material.summary_json.content).toBe('Конспект про энтропию');
    expect(state.increment).not.toHaveBeenCalled();
    const body = JSON.parse(String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === '/api/analyze/section')?.[1]?.body));
    expect(body).toMatchObject({ section: 'quiz', text: state.material.original_text });
  });

  it('a legacy material without sections shows no failure lines', async () => {
    state.material = { ...makeMaterial(), quiz_json: { quiz: [] } };
    renderPage('/library/m1');
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    expect(screen.queryByText(/не получил/)).not.toBeInTheDocument();
    expect(screen.queryByText('Обработан частично')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Тест/ })).not.toBeInTheDocument();
  });

  it('offers no recreate button on someone else’s material', async () => {
    state.material = {
      ...makeMaterial({ sections: { quiz: { status: 'failed', message: 'Модель не ответила' } } }, 'teacher-1'),
      quiz_json: { quiz: [] },
    };
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: /^Тест/ }));
    expect(screen.getByText('Тест не получился: модель не ответила.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать тест заново' })).not.toBeInTheDocument();
  });

  // Анализ записал «не получилось», а выжимку и разговор потом создали в «Выжимке» и «Подкасте».
  const madeLater = () =>
    makeMaterial({
      cheatsheet: '# Выжимка',
      podcast: legacyLines,
      sections: {
        summarizer: { status: 'ok' },
        cheatsheet: { status: 'failed', message: 'Модель не ответила' },
        podcast: { status: 'busy', message: 'Сервис ИИ был перегружен' },
      },
    });

  it('a cheat sheet and a conversation made after the analysis are not reported as failed', async () => {
    state.material = madeLater();
    renderPage('/library/m1');
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    expect(screen.queryByText(/не получил/)).not.toBeInTheDocument();
    // У разговора здесь свой режим: внутри «Материала» второй вкладки «Разговор» нет.
    expect(screen.queryByRole('button', { name: /Подкаст/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать подкаст' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: /Подкаст/ })).toHaveLength(1);
    expect(state.writes).toHaveLength(0);
  });

  it('a conversation that failed and was never made has no tab inside «Материал»; the page mode offers it', async () => {
    state.material = makeMaterial({ podcast: [], sections: { summarizer: { status: 'ok' }, podcast: { status: 'busy' } } });
    renderPage('/library/m1');
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    expect(screen.queryByText(/Разговор не получился/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Подкаст/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать подкаст' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Подкаст/ }));
    expect(await screen.findByRole('button', { name: 'Создать подкаст' })).toBeInTheDocument();
  });

  it('a cheat sheet that failed and is still missing: the line stays and «Выжимка» offers to make it', async () => {
    state.material = makeMaterial({ podcast: [], sections: { summarizer: { status: 'ok' }, cheatsheet: { status: 'failed', message: 'Модель не ответила' } } });
    renderPage('/library/m1');
    expect(await screen.findByText('Выжимка не получилась: модель не ответила.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Выжимка/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать выжимку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));
    await act(async () => pending['/api/quick-prep'][0].resolve(jsonResponse({ cheatsheet: '# Главное' })));
    expect(await screen.findByRole('heading', { name: 'Главное' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Материал/ }));
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    expect(screen.queryByText(/Выжимка не получилась/)).not.toBeInTheDocument();
  });

  it('«Создать тест заново» keeps the saved conversation and records the sections that exist', async () => {
    state.material = {
      ...madeLater(),
      quiz_json: { quiz: [] },
    };
    (state.material.summary_json.sections as Record<string, unknown>).quiz = { status: 'busy' };
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: /^Тест/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));
    await waitFor(() => expect(pending['/api/analyze/section']).toHaveLength(1));
    await act(async () => pending['/api/analyze/section'][0].resolve(jsonResponse({ section: 'quiz', status: 'ok', result: quizPayload })));
    expect(await screen.findByText(/Убывает ли энтропия изолированной системы\?/)).toBeInTheDocument();
    expect(state.material.summary_json.sections).toEqual({
      summarizer: { status: 'ok' },
      quiz: { status: 'ok' },
      cheatsheet: { status: 'ok' },
      podcast: { status: 'ok' },
    });
    expect(savedPodcast()).toEqual(legacyLines);
    expect(state.material.summary_json.cheatsheet).toBe('# Выжимка');
  });

  it('a conversation saved while a section was being re-created stays on the page', async () => {
    state.material = {
      ...makeMaterial({ podcast: [], sections: { summarizer: { status: 'ok' }, quiz: { status: 'busy' } } }),
      quiz_json: { quiz: [] },
    };
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: /^Тест/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));
    await waitFor(() => expect(pending['/api/analyze/section']).toHaveLength(1));

    // Пока тест создаётся, пользователь делает разговор в соседнем режиме.
    fireEvent.click(screen.getByRole('tab', { name: /Подкаст/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать подкаст' }));
    await waitFor(() => expect(pending['/api/podcast/generate']).toHaveLength(1));
    await act(async () => pending['/api/podcast/generate'][0].resolve(jsonResponse(generated)));
    await waitFor(() => expect(savedPodcast()).toHaveLength(2));
    expect(screen.getByText('Что такое энтропия?', { selector: 'section[aria-label="Субтитры"] p' })).toBeInTheDocument();

    // Тест готов позже: он сохраняется и виден в «Материале», а разговор остаётся на странице.
    await act(async () => pending['/api/analyze/section'][0].resolve(jsonResponse({ section: 'quiz', status: 'ok', result: quizPayload })));
    await waitFor(() => expect(state.material.quiz_json).toEqual(quizPayload));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(savedPodcast()).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: /Материал/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Тест/ }));
    expect(await screen.findByText(/Убывает ли энтропия изолированной системы\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Подкаст/ }));
    expect(await screen.findByText('Что такое энтропия?', { selector: 'section[aria-label="Субтитры"] p' })).toBeInTheDocument();
    expect(screen.queryByText('Подкаста по этой лекции ещё нет')).not.toBeInTheDocument();
    expect(state.increment).toHaveBeenCalledTimes(1);
  });
});

describe('«Текст распознан…» on the lecture page, as on the result screen (QA 2026-10-11)', () => {
  it('says the text came from a recording over the lecture’s sections', async () => {
    state.material = makeMaterial({ recognized: 'recording' });
    renderPage('/library/m1');
    expect(await screen.findByText('Текст распознан из записи — сверьте термины, числа и имена.')).toBeInTheDocument();
    expect(screen.getByText('Конспект про энтропию')).toBeInTheDocument();
  });

  it('says the same for a photo and a scan, each in its own words', async () => {
    state.material = makeMaterial({ recognized: 'photo' });
    const { unmount } = renderPage('/library/m1');
    expect(await screen.findByText('Текст распознан с фото — сверьте формулы и числа с оригиналом.')).toBeInTheDocument();
    unmount();
    state.material = makeMaterial({ recognized: 'scan' });
    renderPage('/library/m1');
    expect(await screen.findByText('Текст распознан со скана — сверьте формулы и числа с оригиналом.')).toBeInTheDocument();
  });

  it('says nothing for a typed text, a file with text or a lecture saved before it was remembered', async () => {
    state.material = makeMaterial();
    renderPage('/library/m1');
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    expect(screen.queryByText(/Текст распознан/)).toBeNull();
  });
});

describe('a recorded lecture asks for what it gets later as its analysis did (recheck of 44.2)', () => {
  const bodyOf = (url: string) =>
    JSON.parse(String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === url)?.[1]?.body));

  it('sends summary_json.recognized with the Выжимка, the podcast and a section made again', async () => {
    state.material = {
      ...makeMaterial({ recognized: 'recording', podcast: [], sections: { summarizer: { status: 'ok' }, quiz: { status: 'failed' } } }),
      quiz_json: { quiz: [] },
    };
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: /^Тест/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));
    await waitFor(() => expect(pending['/api/analyze/section']).toHaveLength(1));
    expect(bodyOf('/api/analyze/section')).toMatchObject({ section: 'quiz', recognized: 'recording' });

    fireEvent.click(screen.getByRole('tab', { name: /Подкаст/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать подкаст' }));
    await waitFor(() => expect(pending['/api/podcast/generate']).toHaveLength(1));
    expect(bodyOf('/api/podcast/generate')).toMatchObject({ recognized: 'recording' });
    await act(async () => pending['/api/podcast/generate'][0].resolve(jsonResponse(generated)));
    await waitFor(() => expect(savedPodcast()).toHaveLength(2));
    cleanup();

    renderPage('/library/m1?mode=express');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать выжимку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));
    expect(bodyOf('/api/quick-prep')).toEqual({ context: state.material.original_text, recognized: 'recording' });
  });

  it('sends nothing more for a lecture whose text was not recognised', async () => {
    renderPage('/library/m1?mode=express');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать выжимку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));
    expect(bodyOf('/api/quick-prep')).toEqual({ context: state.material.original_text });
  });
});

describe('text-only materials and review link', () => {
  it('shows the text-only notice', async () => {
    state.material = {
      ...makeMaterial({ content: '', terms: [], text_only: true }),
      flashcards_json: { flashcards: [] },
      quiz_json: { quiz: [] },
    };
    renderPage('/library/m1');
    expect(await screen.findByText('Только текст, конспекта нет. Материал участвует в сверке экзаменов с лекциями.')).toBeInTheDocument();
    expect(screen.queryByText('Нет данных для отображения')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Повторить карточки' })).not.toBeInTheDocument();
  });

  it('links to review for a material with cards: a pill in the header and, below 1024 px, a bar at the bottom', async () => {
    state.material = {
      ...makeMaterial(),
      flashcards_json: { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка' }] },
    };
    const { container } = renderPage('/library/m1');
    // An outlined pill, not a second filled button; no count, because review shows only the cards due today.
    const [pill, bottom] = await screen.findAllByRole('link', { name: 'Повторить карточки' });
    expect(pill).toHaveAttribute('href', '/review?material=m1');
    expect(pill).toHaveClass('sf-secondary', 'md-review');
    // Finding LIB-31: on a phone or a tablet the lecture keeps its one action at the bottom while it scrolls;
    // MaterialDetail.css shows the bar below 1024 px only and hides the header pill there.
    expect(bottom).toHaveAttribute('href', '/review?material=m1');
    expect(bottom).toHaveClass('sf-primary', 'md-bottom-go');
    expect(bottom.closest('.md-bottom')).not.toBeNull();
    const page = container.querySelector('.md-page') as HTMLElement;
    expect(page).toHaveAttribute('data-bottom');

    // On «Подкаст» the player's controls hold the bottom of the screen.
    fireEvent.click(screen.getByRole('tab', { name: 'Подкаст' }));
    expect(page).not.toHaveAttribute('data-bottom');
    expect(screen.getAllByRole('link', { name: 'Повторить карточки' })).toHaveLength(1);
    expect(container.querySelector('.md-bottom')).toBeNull();
  });
});

describe('«Поговорить о лекции»', () => {
  it('opens the voice tutor of the lecture, before «Повторить карточки»', async () => {
    state.material = {
      ...makeMaterial(),
      flashcards_json: { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка' }] },
    };
    renderPage('/library/m1');
    const talk = await screen.findByRole('link', { name: 'Поговорить о лекции' });
    expect(talk).toHaveAttribute('href', '/library/m1/talk');
    expect(talk).toHaveClass('sf-secondary', 'md-pill');
    const [review] = screen.getAllByRole('link', { name: 'Повторить карточки' });
    expect(talk.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is there for a lecture with text but no cards yet: the room says to analyse it first', async () => {
    renderPage('/library/m1');
    expect(await screen.findByRole('link', { name: 'Поговорить о лекции' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Повторить карточки' })).not.toBeInTheDocument();
  });

  it('is not offered without the lecture’s text, nor on someone else’s lecture', async () => {
    state.material = { ...makeMaterial(), original_text: '   ' };
    const { unmount } = renderPage('/library/m1');
    await screen.findByRole('heading', { level: 1, name: 'Энтропия' });
    expect(screen.queryByRole('link', { name: 'Поговорить о лекции' })).not.toBeInTheDocument();
    unmount();

    state.material = makeMaterial({}, 'teacher-1');
    renderPage('/library/m1');
    await screen.findByRole('heading', { level: 1, name: 'Энтропия' });
    expect(screen.queryByRole('link', { name: 'Поговорить о лекции' })).not.toBeInTheDocument();
  });
});

describe('one header for every tab (finding LIB-3)', () => {
  it('keeps the title, the meta line, the tabs and the actions in place when the tab changes', async () => {
    state.material = {
      ...makeMaterial({ podcast: legacyLines }),
      flashcards_json: { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка' }] },
    };
    const { container } = renderPage('/library/m1');
    const title = await screen.findByRole('heading', { level: 1, name: 'Энтропия' });
    const meta = screen.getByText(/^Физика · только для меня/, { selector: '.md-meta' });
    const tabs = screen.getByRole('tablist', { name: 'Режим' });
    const talk = screen.getByRole('link', { name: 'Поговорить о лекции' });
    const page = container.querySelector('.md-page') as HTMLElement;
    // The title has a row of its own; the lecture's actions share the row of the tabs.
    expect(title.closest('header')).toContainElement(meta);
    expect(title.closest('header')).not.toContainElement(tabs);
    expect(tabs.parentElement).toContainElement(talk);
    expect(page).not.toHaveAttribute('data-tab');

    fireEvent.click(screen.getByRole('tab', { name: 'Подкаст' }));
    expect(await screen.findByRole('region', { name: 'Сцена' })).toBeInTheDocument();
    // The same elements: nothing was folded or moved for the podcast.
    expect(screen.getByRole('heading', { level: 1, name: 'Энтропия' })).toBe(title);
    expect(screen.getByText(/^Физика · только для меня/, { selector: '.md-meta' })).toBe(meta);
    expect(screen.getByRole('link', { name: 'Поговорить о лекции' })).toBe(talk);
    // The podcast tab marks the page, so that a low window tightens the player (conversation.css), not the header.
    expect(page).toHaveAttribute('data-tab', 'talk');

    fireEvent.click(screen.getByRole('tab', { name: 'Материал' }));
    expect(page).not.toHaveAttribute('data-tab');
    expect(screen.getByRole('heading', { level: 1, name: 'Энтропия' })).toBe(title);
  });
});

describe('the browser tab and the meta line', () => {
  it('names the browser tab after the lecture, and «Лекция не найдена» when there is none', async () => {
    state.material = { ...makeMaterial(), title: 'Реляционная модель данных: ключи и ограничения целостности' };
    const { unmount } = renderPage('/library/m1');
    await screen.findByRole('heading', { level: 1, name: 'Реляционная модель данных: ключи и ограничения целостности' });
    expect(document.title).toBe('Реляционная модель данных: ключи и ограничения целостности — Meldy');
    unmount();

    const api = await import('../api/materials');
    vi.mocked(api.getMaterialById).mockRejectedValueOnce(new Error('not found'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = renderPage('/library/gone');
    expect(await screen.findByRole('heading', { level: 1, name: 'Лекция не найдена' })).toBeInTheDocument();
    expect(document.title).toBe('Лекция не найдена — Meldy');
    failed.unmount();
    quiet.mockClear();

    // A deleted lecture is no row (maybeSingle), not an error: the same page, and nothing in the console (QA 2026-10-11).
    vi.mocked(api.getMaterialById).mockResolvedValueOnce(null);
    renderPage('/library/deleted');
    expect(await screen.findByRole('heading', { level: 1, name: 'Лекция не найдена' })).toBeInTheDocument();
    expect(quiet).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('keeps the day with its month and never starts a line with «·» (finding LIB-21)', async () => {
    renderPage('/library/m1');
    await screen.findByRole('heading', { level: 1, name: 'Энтропия' });
    const meta = document.querySelector('.md-meta') as HTMLElement;
    expect(meta.textContent).toMatch(/^Физика · только для меня · 1 октября, \d{1,2}:00$/);
  });
});

describe('cards from ticket answers (finding LIB-6)', () => {
  it('says how many of the lecture’s cards come from ticket answers, next to «Повторить карточки»', async () => {
    const cards = await import('../lib/followupCards');
    state.followups = 4;
    state.material = {
      ...makeMaterial(),
      flashcards_json: {
        flashcards: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, question: `Вопрос ${index + 1}`, answer: 'Ответ' })),
      },
    };
    renderPage('/library/m1?section=flashcards');
    expect(await screen.findByText('В повторении: 6 карточек · ещё 4 из ответов на билеты.')).toBeInTheDocument();
    expect(cards.followupCardsOf).toHaveBeenCalledWith('user-1', 'm1');
  });

  it('does not ask for someone else’s lecture', async () => {
    const cards = await import('../lib/followupCards');
    vi.mocked(cards.followupCardsOf).mockClear();
    state.followups = 4;
    state.material = {
      ...makeMaterial({}, 'teacher-1'),
      flashcards_json: { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка' }] },
    };
    renderPage('/library/m1?section=flashcards');
    await screen.findByRole('heading', { level: 1, name: 'Энтропия' });
    expect(cards.followupCardsOf).not.toHaveBeenCalled();
    expect(screen.queryByText(/из ответов на билеты/)).not.toBeInTheDocument();
  });
});

describe('the lecture’s «⋯» moves it to a folder and deletes it (finding LIB-9)', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('says folders stay on this device, makes a folder with the lecture in it and takes it out again', async () => {
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: 'Действия с лекцией' }));
    const menu = screen.getByRole('menu', { name: 'Действия с лекцией' });
    expect(within(menu).getByText('Папка — только на этом устройстве')).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitemradio', { name: 'Без папки' })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Новая папка…' }));
    fireEvent.change(within(menu).getByRole('textbox', { name: 'Название папки' }), { target: { value: 'Термодинамика' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Создать' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Действия с лекцией' })).toHaveFocus();

    const folders = JSON.parse(window.localStorage.getItem('library_folders_user-1') ?? '[]');
    expect(folders).toEqual([expect.objectContaining({ name: 'Термодинамика' })]);
    expect(JSON.parse(window.localStorage.getItem('library_folder_assignments_user-1') ?? '{}')).toEqual({ m1: folders[0].id });

    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    const again = screen.getByRole('menu', { name: 'Действия с лекцией' });
    expect(within(again).getByRole('menuitemradio', { name: 'Термодинамика' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(again).getByRole('menuitemradio', { name: 'Без папки' }));
    expect(JSON.parse(window.localStorage.getItem('library_folder_assignments_user-1') ?? '{}')).toEqual({});
  });

  it('deletes the lecture after the question «Лекций» asks, forgets its folder and goes back to the list', async () => {
    const api = await import('../api/materials');
    vi.mocked(api.deleteMaterial).mockClear();
    state.material = {
      ...makeMaterial({ podcast: [], cheatsheet: '# Выжимка\n\nГлавное.' }),
      flashcards_json: { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка' }] },
    };
    window.localStorage.setItem('library_folder_assignments_user-1', JSON.stringify({ m1: 'folder_9', m2: 'folder_9' }));
    window.localStorage.setItem('library_entries_user-1', JSON.stringify({ items: [{ id: 'm1' }, { id: 'm2' }] }));
    render(
      <MemoryRouter initialEntries={['/library/m1']}>
        <Routes>
          <Route path="/library/:id" element={<MaterialDetail />} />
          <Route path="/library" element={<p>Список лекций</p>} />
        </Routes>
      </MemoryRouter>,
    );

    state.confirm = vi.fn(async () => false);
    await chooseFromMenu('Удалить лекцию…');
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    // What the lecture has, and nothing else (QA 2026-10-11: «карточками и тестом» was said of every lecture).
    expect(state.confirm.mock.calls[0][0]).toEqual({
      title: 'Удалить лекцию?',
      message: '«Энтропия» исчезнет из библиотеки вместе с конспектом, карточками и выжимкой. Это нельзя отменить.',
      confirmText: 'Удалить',
      cancelText: 'Оставить',
    });
    expect(api.deleteMaterial).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Энтропия' })).toBeInTheDocument();

    state.confirm = vi.fn(async () => true);
    await chooseFromMenu('Удалить лекцию…');
    expect(await screen.findByText('Список лекций')).toBeInTheDocument();
    expect(api.deleteMaterial).toHaveBeenCalledWith('m1');
    expect(state.toastSuccess).toHaveBeenCalledWith('Лекция удалена');
    expect(JSON.parse(window.localStorage.getItem('library_folder_assignments_user-1') ?? '{}')).toEqual({ m2: 'folder_9' });
    expect(JSON.parse(window.localStorage.getItem('library_entries_user-1') ?? '{}')).toEqual({ items: [{ id: 'm2' }] });
  });

  it('stays on the lecture and says so when the deletion fails', async () => {
    const api = await import('../api/materials');
    vi.mocked(api.deleteMaterial).mockRejectedValueOnce(new Error('network'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPage('/library/m1');
    await chooseFromMenu('Удалить лекцию…');
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Не удалось удалить лекцию. Повторите через минуту.'));
    expect(screen.getByRole('heading', { level: 1, name: 'Энтропия' })).toBeInTheDocument();
    expect(state.toastSuccess).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('is not there on someone else’s lecture', async () => {
    state.material = makeMaterial({}, 'teacher-1');
    renderPage('/library/m1');
    await screen.findByRole('heading', { level: 1, name: 'Энтропия' });
    expect(screen.queryByRole('button', { name: 'Действия с лекцией' })).not.toBeInTheDocument();
  });
});

/* ── A phone (10_Project/Phone_Declutter_2026-10-08, «Лекция») ───────────────── */

/** matchMedia that says «a phone» (lib/usePhone) and nothing else. */
function installPhone() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

/** The meta line with its no-break spaces as plain ones (a day keeps its month, «·» its word). */
const plainText = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ');

function lectureWithEverything(owner = 'user-1'): Material {
  return {
    ...makeMaterial({}, owner),
    flashcards_json: { flashcards: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, question: `Вопрос ${i + 1}`, answer: `Ответ ${i + 1}` })) },
    quiz_json: {
      quiz: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, question: `Тестовый вопрос ${i + 1}`, options: ['A) Да', 'B) Нет'], correct: 'A', explanation: '', source_ids: [] })),
    },
  };
}

describe('the lecture on a phone', () => {
  beforeEach(() => {
    installPhone();
    state.material = lectureWithEverything();
  });
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('has one row of tabs, «Конспект · Карточки 6 · Тест 5 · Подкаст», no «Экспорт» link and a short meta line', async () => {
    renderPage('/library/m1');
    const row = await screen.findByRole('tablist', { name: 'Разделы лекции' });
    expect(within(row).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Конспект', 'Карточки 6', 'Тест 5', 'Подкаст']);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Разделы результата' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Экспорт' })).toBeNull();
    const summary = screen.getByRole('tab', { name: 'Конспект' });
    expect(summary).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', summary.id);
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    // One line: the usual «только для меня» is left to «⋯» (Поделиться), and the day goes without its time.
    expect(plainText(document.querySelector('.md-meta')?.textContent)).toBe('Физика · 1 октября');
    // The lecture's actions stay: «Поговорить о лекции», «⋯», and «Повторить карточки» at the bottom.
    expect(screen.getByRole('link', { name: 'Поговорить о лекции' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Действия с лекцией' })).toBeInTheDocument();
    const review = screen.getAllByRole('link', { name: 'Повторить карточки' });
    expect(review[review.length - 1]).toHaveClass('md-bottom-go');
  });

  it('keeps «Текст распознан из записи…» over the sections of a recorded lecture (QA 2026-10-11)', async () => {
    state.material = { ...lectureWithEverything(), summary_json: { ...lectureWithEverything().summary_json, recognized: 'recording' } };
    renderPage('/library/m1');
    expect(await screen.findByText('Текст распознан из записи — сверьте термины, числа и имена.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Карточки 6' }));
    expect(screen.getByText('Текст распознан из записи — сверьте термины, числа и имена.')).toBeInTheDocument();
  });

  it('follows the tabs pattern across the sections and the podcast: one tab stop, arrows, Home and End', async () => {
    renderPage('/library/m1');
    const summary = await screen.findByRole('tab', { name: 'Конспект' });
    summary.focus();
    fireEvent.keyDown(summary, { key: 'ArrowRight' });
    const cards = screen.getByRole('tab', { name: 'Карточки 6' });
    expect(cards).toHaveAttribute('aria-selected', 'true');
    expect(cards).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', cards.id);
    expect(await screen.findByText('Вопрос 1')).toBeInTheDocument();

    fireEvent.keyDown(cards, { key: 'End' });
    const podcast = screen.getByRole('tab', { name: 'Подкаст' });
    expect(podcast).toHaveFocus();
    expect(podcast).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0']);
    expect(await screen.findByText('Подкаста по этой лекции ещё нет')).toBeInTheDocument();
    // On «Подкаст» the player holds the bottom of the screen.
    expect(document.querySelector('.md-bottom')).toBeNull();

    fireEvent.keyDown(podcast, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Конспект' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Конспект' }), { key: 'Home' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Конспект' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Подкаст' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Тест 5' }));
    expect(await screen.findByText(/Тестовый вопрос 1/)).toBeInTheDocument();
  });

  it('opens on the tab a link asks for: ?section=…, ?mode=express&tab=podcast, ?mode=express', async () => {
    const first = renderPage('/library/m1?section=quiz');
    expect(await screen.findByRole('tab', { name: 'Тест 5' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/Тестовый вопрос 1/)).toBeInTheDocument();
    first.unmount();

    const second = renderPage('/library/m1?mode=express&tab=podcast');
    expect(await screen.findByRole('tab', { name: 'Подкаст' })).toHaveAttribute('aria-selected', 'true');
    second.unmount();

    renderPage('/library/m1?mode=express');
    const brief = await screen.findByRole('tab', { name: 'Выжимка' });
    expect(brief).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Конспект', 'Карточки 6', 'Тест 5', 'Выжимка', 'Подкаст']);
    expect(await screen.findByRole('button', { name: 'Создать выжимку' })).toBeInTheDocument();
  });

  it('keeps «Экспорт» in «⋯»: «Экспорт…» turns the menu into the formats of the section on screen', async () => {
    renderPage('/library/m1');
    await screen.findByText('Конспект про энтропию');
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Действия с лекцией' })).getByRole('menuitem', { name: 'Экспорт…' }));
    const formats = screen.getByRole('menu', { name: 'Экспорт' });
    expect(within(formats).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Копировать', 'Печать или PDF', 'Скачать HTML']);
    expect(within(formats).getByRole('menuitem', { name: 'Копировать' })).toHaveFocus();
    fireEvent.click(within(formats).getByRole('menuitem', { name: 'Копировать' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Конспект про энтропию');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Действия с лекцией' })).toHaveFocus();

    // Escape leaves the formats and gives the focus back to «⋯»; the menu opens on the actions again.
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Экспорт…' }));
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Экспорт' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Действия с лекцией' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    expect(screen.getByRole('menu', { name: 'Действия с лекцией' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // On «Тест» the test can be shown on a screen for an audience, as from «Экспорт» on a computer.
    fireEvent.click(screen.getByRole('tab', { name: 'Тест 5' }));
    await screen.findByText(/Тестовый вопрос 1/);
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Экспорт…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Показать тест на экране' }));
    expect(screen.getByRole('dialog', { name: 'Режим презентации' })).toBeInTheDocument();
  });

  it('gives someone else’s lecture a «⋯» with «Экспорт» only', async () => {
    state.material = lectureWithEverything('teacher-1');
    renderPage('/library/m1');
    await screen.findByText('Конспект про энтропию');
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    const menu = screen.getByRole('menu', { name: 'Экспорт' });
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Копировать', 'Печать или PDF', 'Скачать HTML']);
    expect(screen.queryByRole('menuitem', { name: 'Переименовать' })).toBeNull();
    expect(plainText(document.querySelector('.md-meta')?.textContent)).toMatch(/^Физика · материал другого автора · /);
  });

  it('a section that failed is a tab with its line and «Создать … заново»; the new test shows under its tab', async () => {
    const quizPayload = { quiz: [{ id: 1, question: 'Убывает ли энтропия изолированной системы?', options: ['A) Нет', 'B) Да'], correct: 'A', explanation: '', source_ids: [] }] };
    state.material = { ...makeMaterial({ sections: { summarizer: { status: 'ok' }, quiz: { status: 'busy', message: 'Сервис ИИ был перегружен' } } }), quiz_json: { quiz: [] } };
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('tab', { name: 'Тест' }));
    expect(screen.getByText('Тест не получился: сервис ИИ был перегружен.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));
    await waitFor(() => expect(pending['/api/analyze/section']).toHaveLength(1));
    await act(async () => pending['/api/analyze/section'][0].resolve(jsonResponse({ section: 'quiz', status: 'ok', result: quizPayload })));
    expect(await screen.findByText(/Убывает ли энтропия изолированной системы\?/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Тест 1' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows «Материал» for a lecture loaded only as text', async () => {
    state.material = { ...makeMaterial({ content: '', terms: [], text_only: true }), flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] } };
    renderPage('/library/m1');
    expect(await screen.findByText('Только текст, конспекта нет. Материал участвует в сверке экзаменов с лекциями.')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Материал', 'Подкаст']);
    // Nothing to export from a text: no «⋯» items for it.
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    expect(screen.queryByRole('menuitem', { name: 'Экспорт…' })).toBeNull();
  });
});

describe('the lecture on a computer keeps its layout', () => {
  it('has the modes and the results’ row, «Экспорт» by the tabs and no «Экспорт…» in «⋯»', async () => {
    state.material = lectureWithEverything();
    renderPage('/library/m1');
    expect(await screen.findByRole('tablist', { name: 'Режим' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Разделы результата' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Экспорт' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Действия с лекцией' }));
    expect(screen.queryByRole('menuitem', { name: 'Экспорт…' })).toBeNull();
  });
});

describe('materialMeta', () => {
  it('leaves out the usual «только для меня» and the time of day on a phone, and still names a link or another author', () => {
    const base = { subject: 'Физика', createdAt: '2026-10-01T10:00:00Z' };
    expect(plainText(materialMeta({ ...base, isPublic: false, own: true, short: true }))).toBe('Физика · 1 октября');
    expect(plainText(materialMeta({ ...base, isPublic: false, own: true }))).toMatch(/^Физика · только для меня · 1 октября, \d{1,2}:00$/);
    expect(plainText(materialMeta({ ...base, isPublic: true, own: true, short: true }))).toBe('Физика · открыт по ссылке · 1 октября');
    expect(plainText(materialMeta({ ...base, isPublic: false, own: false, short: true }))).toBe('Физика · материал другого автора · 1 октября');
  });
});
