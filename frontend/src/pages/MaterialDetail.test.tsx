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
}));
// The server charges the AI jobs; the page only refreshes the meter afterwards.
vi.mock('../api/limits', () => ({ notifyAIUsageChanged: (...args: unknown[]) => state.increment(...args) }));
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

import MaterialDetail from './MaterialDetail';
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
    fireEvent.click(await screen.findByRole('tab', { name: /Разговор/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать разговор' }));
    await waitFor(() => expect(pending['/api/podcast/generate']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Кратко/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать шпаргалку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));

    // Разговор готов первым и сохраняется…
    await act(async () => pending['/api/podcast/generate'][0].resolve(jsonResponse(generated)));
    await waitFor(() => expect(savedPodcast()).toHaveLength(2));
    // …а шпаргалка, начатая раньше, не возвращает старый пустой разговор.
    await act(async () => pending['/api/quick-prep'][0].resolve(jsonResponse({ cheatsheet: '# Главное' })));
    await waitFor(() => expect(state.material.summary_json.cheatsheet).toBe('# Главное'));
    expect(savedPodcast()).toHaveLength(2);
    expect(state.increment).toHaveBeenCalledTimes(2); // both jobs refreshed the meter (the server charged them)

    expect(await screen.findByRole('heading', { name: 'Главное' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Разговор/ }));
    expect(screen.queryByText('Для этого материала разговор ещё не создан')).not.toBeInTheDocument();
    expect(screen.getByText('Что такое энтропия?', { selector: 'section[aria-label="Субтитры"] p' })).toBeInTheDocument();
  });

  it('does not charge energy for a cheatsheet the user cannot save', async () => {
    state.material = makeMaterial({}, 'teacher-1');
    state.userId = 'user-1';
    renderPage('/library/m1?mode=express');
    expect(await screen.findByText('Шпаргалку может создать только автор материала.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать шпаргалку' })).not.toBeInTheDocument();
  });
});

describe('model jobs outlive the tab that started them', () => {
  it('keeps «Добавить схемы» busy after a tab switch and runs the paid job once', async () => {
    state.material = makeMaterial({ cheatsheet: '# Шпаргалка', podcast: legacyLines });
    renderPage('/library/m1?mode=express&tab=podcast');
    fireEvent.click(await screen.findByRole('button', { name: /Добавить схемы/ }));
    await waitFor(() => expect(pending['/api/podcast/visuals']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Кратко/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Разговор/ }));

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
    state.material = makeMaterial({ cheatsheet: '# Шпаргалка', podcast: legacyLines });
    renderPage('/library/m1?mode=express&tab=podcast');
    fireEvent.click(await screen.findByRole('button', { name: /Добавить схемы/ }));
    await waitFor(() => expect(pending['/api/podcast/visuals']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Кратко/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Разговор/ }));
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

  it('keeps «Создать шпаргалку» busy after switching to «Материал» and back', async () => {
    renderPage('/library/m1?mode=express');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать шпаргалку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));

    fireEvent.click(screen.getByRole('tab', { name: /Материал/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Кратко/ }));
    expect(await screen.findByRole('button', { name: /Составляем шпаргалку/ })).toBeDisabled();

    await act(async () => pending['/api/quick-prep'][0].resolve(jsonResponse({ cheatsheet: '# Готово' })));
    expect(await screen.findByRole('heading', { name: 'Шпаргалка' })).toBeInTheDocument();
    expect(pending['/api/quick-prep']).toHaveLength(1);
    expect(state.increment).toHaveBeenCalledTimes(1);
  });

  it('shows the cheatsheet error inline and does not charge for a failed answer', async () => {
    renderPage('/library/m1?mode=express');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать шпаргалку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));
    await act(async () =>
      pending['/api/quick-prep'][0].resolve({
        ok: false,
        status: 502,
        json: async () => ({ detail: 'Не удалось создать шпаргалку. Попробуйте ещё раз.' }),
      } as unknown as Response),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось создать шпаргалку. Попробуйте ещё раз.');
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
    fireEvent.click(screen.getByRole('button', { name: /Разговор/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Добавить схемы/ }));
    await waitFor(() => expect(pending['/api/podcast/visuals']).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Конспект/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Разговор/ }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Создать разговор' }));
    await waitFor(() => expect(pending['/api/podcast/generate']).toHaveLength(1));

    act(() => go('/library/m2?mode=express&tab=podcast'));
    expect(await screen.findByRole('heading', { name: 'Второй материал' })).toBeInTheDocument();

    await act(async () => pending['/api/podcast/generate'][0].resolve(jsonResponse(generated)));
    await waitFor(() => expect(state.increment).toHaveBeenCalledTimes(1));
    expect(savedPodcast()).toHaveLength(2);
    expect(second.summary_json.podcast).toEqual([]);
    expect(screen.getByText('Для этого материала разговор ещё не создан')).toBeInTheDocument();
  });
});

describe('materials of other authors', () => {
  it('offers no paid model work and no sharing to a student on a teacher material', async () => {
    state.material = makeMaterial({ podcast: [] }, 'teacher-1');
    renderPage('/library/m1?mode=express&tab=podcast');
    expect(await screen.findByText('Разговор может создать только автор материала.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать разговор' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).not.toBeInTheDocument();
    // Only the author gets «⋯» (rename, subject, sharing); the meta line says whose it is.
    expect(screen.queryByRole('button', { name: 'Действия с лекцией' })).not.toBeInTheDocument();
    expect(screen.getByText(/материал другого автора/)).toBeInTheDocument();
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
    expect(screen.getByText(/только для меня/)).toBeInTheDocument();
  });

  it('does not claim success when the update fails', async () => {
    state.updateError = true;
    renderPage('/library/m1');
    await chooseFromMenu('Поделиться');
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Не удалось открыть доступ. Попробуйте ещё раз.'));
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByText(/только для меня/)).toBeInTheDocument();
  });

  it('publishes, then copies the link', async () => {
    renderPage('/library/m1');
    await chooseFromMenu('Поделиться');
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith('Доступ открыт, ссылка скопирована'));
    expect(state.writes).toEqual([{ is_public: true }]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/shared/m1`);
    expect(screen.getByText(/открыт по ссылке/)).toBeInTheDocument();
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
    expect(await screen.findByText(/только для меня/)).toBeInTheDocument();
  });
});

describe('the lecture header (design critique 12)', () => {
  it('says subject, who sees it and when it was added in one line, without chips or a numeric date', async () => {
    renderPage('/library/m1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Энтропия' })).toBeInTheDocument();
    expect(screen.getByText(/^Физика · только для меня · 1 октября, \d{1,2}:00$/)).toBeInTheDocument();
    expect(screen.queryByText(/\d{2}\.\d{2}\.\d{4}/)).not.toBeInTheDocument();
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
    expect(screen.getByText(/^Физика · /)).toBeInTheDocument();
    expect(api.updateMaterialSubject).not.toHaveBeenCalled();
  });
});

describe('mode switcher', () => {
  it('follows the tabs pattern: one tab stop, arrows, Home/End and a labelled panel', async () => {
    state.material = makeMaterial({ cheatsheet: '# Шпаргалка', podcast: legacyLines });
    renderPage('/library/m1');
    const material = await screen.findByRole('tab', { name: /Материал/ });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', material.id);
    expect(material).toHaveAttribute('aria-controls', panel.id);

    material.focus();
    fireEvent.keyDown(material, { key: 'ArrowRight' });
    const brief = screen.getByRole('tab', { name: /Кратко/ });
    expect(brief).toHaveAttribute('aria-selected', 'true');
    expect(brief).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', brief.id);

    fireEvent.keyDown(brief, { key: 'End' });
    expect(screen.getByRole('tab', { name: /Разговор/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Разговор/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Материал/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Материал/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Разговор/ })).toHaveAttribute('aria-selected', 'true');
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

  // Анализ записал «не получилось», а шпаргалку и разговор потом создали в «Кратко» и «Разговоре».
  const madeLater = () =>
    makeMaterial({
      cheatsheet: '# Шпаргалка',
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
    expect(screen.queryByRole('button', { name: /Разговор/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать разговор' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: /Разговор/ })).toHaveLength(1);
    expect(state.writes).toHaveLength(0);
  });

  it('a conversation that failed and was never made has no tab inside «Материал»; the page mode offers it', async () => {
    state.material = makeMaterial({ podcast: [], sections: { summarizer: { status: 'ok' }, podcast: { status: 'busy' } } });
    renderPage('/library/m1');
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    expect(screen.queryByText(/Разговор не получился/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Разговор/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать разговор' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Разговор/ }));
    expect(await screen.findByRole('button', { name: 'Создать разговор' })).toBeInTheDocument();
  });

  it('a cheat sheet that failed and is still missing: the line stays and «Кратко» offers to make it', async () => {
    state.material = makeMaterial({ podcast: [], sections: { summarizer: { status: 'ok' }, cheatsheet: { status: 'failed', message: 'Модель не ответила' } } });
    renderPage('/library/m1');
    expect(await screen.findByText('Шпаргалка не получилась: модель не ответила.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Кратко/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать шпаргалку' }));
    await waitFor(() => expect(pending['/api/quick-prep']).toHaveLength(1));
    await act(async () => pending['/api/quick-prep'][0].resolve(jsonResponse({ cheatsheet: '# Главное' })));
    expect(await screen.findByRole('heading', { name: 'Главное' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Материал/ }));
    expect(await screen.findByText('Конспект про энтропию')).toBeInTheDocument();
    expect(screen.queryByText(/Шпаргалка не получилась/)).not.toBeInTheDocument();
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
    expect(state.material.summary_json.cheatsheet).toBe('# Шпаргалка');
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
    fireEvent.click(screen.getByRole('tab', { name: /Разговор/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать разговор' }));
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

    fireEvent.click(screen.getByRole('tab', { name: /Разговор/ }));
    expect(await screen.findByText('Что такое энтропия?', { selector: 'section[aria-label="Субтитры"] p' })).toBeInTheDocument();
    expect(screen.queryByText('Для этого материала разговор ещё не создан')).not.toBeInTheDocument();
    expect(state.increment).toHaveBeenCalledTimes(1);
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

  it('links to review for a material with cards', async () => {
    state.material = {
      ...makeMaterial(),
      flashcards_json: { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка' }] },
    };
    renderPage('/library/m1');
    // An outlined pill, not a second filled button; no count, because review shows only the cards due today.
    const link = await screen.findByRole('link', { name: 'Повторить карточки' });
    expect(link).toHaveAttribute('href', '/review?material=m1');
    expect(link).toHaveClass('sf-secondary');
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
    const review = screen.getByRole('link', { name: 'Повторить карточки' });
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

describe('«Разговор» on the 1280×720 projector window (spec 5.7)', () => {
  it('marks only the talk tab, so that the low window folds the header there and nowhere else', async () => {
    state.material = makeMaterial({ podcast: legacyLines });
    const { container } = renderPage('/library/m1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Энтропия' })).toBeInTheDocument();
    const page = container.querySelector('.sf-page') as HTMLElement;
    expect(page).not.toHaveAttribute('data-tab');

    fireEvent.click(screen.getByRole('tab', { name: 'Разговор' }));
    expect(page).toHaveAttribute('data-tab', 'talk');
    expect(await screen.findByRole('region', { name: 'Сцена' })).toBeInTheDocument();
    // The meta line stays in the page for screen readers; only the low window hides it from sight.
    expect(screen.getByText(/Физика · только для меня/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Материал' }));
    expect(page).not.toHaveAttribute('data-tab');
  });
});
