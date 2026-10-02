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
vi.mock('../api/limits', () => ({ incrementAIUsage: (...args: unknown[]) => state.increment(...args) }));
vi.mock('../api/quests', () => ({ updateQuestProgress: vi.fn(() => Promise.resolve(true)) }));
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
    expect(state.increment.mock.calls.map(call => call[1])).toEqual([5, 5]);

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
    expect(screen.getByText('Материал другого автора')).toBeInTheDocument();
  });

  it('hides «Добавить схемы» on someone else’s legacy conversation', async () => {
    state.material = makeMaterial({ podcast: legacyLines }, 'teacher-1');
    renderPage('/library/m1?mode=express&tab=podcast');
    expect(await screen.findByRole('button', { name: 'Слушать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить схемы/ })).not.toBeInTheDocument();
  });
});

describe('sharing a material', () => {
  it('asks before publishing and does nothing when the user cancels', async () => {
    state.confirm = vi.fn(async () => false);
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
    expect(state.confirm.mock.calls[0][0].message).toMatch(/смогут открыть и скопировать другие студенты/);
    expect(state.writes).toHaveLength(0);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByText('Только для меня')).toBeInTheDocument();
  });

  it('does not claim success when the update fails', async () => {
    state.updateError = true;
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Не удалось открыть доступ. Попробуйте ещё раз.'));
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByText('Только для меня')).toBeInTheDocument();
  });

  it('publishes, then copies the link', async () => {
    renderPage('/library/m1');
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith('Доступ открыт, ссылка скопирована'));
    expect(state.writes).toEqual([{ is_public: true }]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/shared/m1`);
    expect(screen.getByText('В открытых материалах')).toBeInTheDocument();

    // Уже открытый материал: ссылка копируется без второго вопроса.
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(state.toastSuccess).toHaveBeenLastCalledWith('Ссылка скопирована'));
    expect(state.confirm).toHaveBeenCalledTimes(1);
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
