/**
 * «Подкаст»'s render budget (smoothness debt: a tap on «Подкаст» took ≈ 490 ms on a mid phone, CPU ×4 — the player drew
 * an invisible copy of each of the conversation's 13 pictures in the tap's own task, so the sheet would get the height
 * of the tallest). Counts, not times: what each React commit put on the page, read through a DevTools-style hook.
 *
 * - the lecture page: the tap's own commit moves the tab and leaves the player for a later commit (a transition);
 * - the player: its first commit draws only the picture in view, no copy; the copies follow a few per commit
 *   (COPIES_PER_FRAME), each in its own frame, until every picture has one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const budget = vi.hoisted(() => {
  const state = { on: false, commits: [] as Array<{ tab: string | null; player: boolean; copies: number; active: number }> };
  (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => undefined,
    onScheduleFiberRoot: () => undefined,
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    setStrictMode: () => undefined,
    // What the page shows right after each commit (the DOM is updated before this hook is told).
    onCommitFiberRoot: () => {
      if (!state.on) return;
      state.commits.push({
        tab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
        player: Boolean(document.querySelector('[data-scene-layer="active"]')),
        copies: document.querySelectorAll('[data-scene-layer="measure"]').length,
        active: document.querySelectorAll('[data-scene-layer="active"]').length,
      });
    },
  };
  return state;
});

const page = vi.hoisted(() => ({ material: null as unknown }));

vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert', 'upsert', 'delete', 'gte', 'lte', 'is', 'not', 'match'])
    chain[name] = () => chain;
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    },
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon',
    supabaseFetch: async () => new Response('{}'),
  };
});
vi.mock('../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/materials')>()),
  getMaterialById: vi.fn(async () => JSON.parse(JSON.stringify(page.material))),
}));
vi.mock('../lib/followupCards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/followupCards')>()),
  followupCardsOf: vi.fn(async () => 0),
}));
vi.mock('../api/limits', () => ({ notifyAIUsageChanged: vi.fn(), formatLimitReset: () => '3:00', nextLimitReset: () => new Date() }));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: vi.fn(async () => true) }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn(async () => undefined) }) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConversationPlayer from '../components/conversation/ConversationPlayer';
import MaterialDetail from '../pages/MaterialDetail';
import type { PodcastLine } from '../components/conversation/types';

/** Thirteen pictures of every kind, as the audit's conversation. */
const LINES: PodcastLine[] = [
  { speaker: 'Макс', text: 'Привет! Сегодня термодинамика.', visual: { type: 'scene', title: 'Термодинамика', icon: 'flask', caption: 'Тепло и порядок' } },
  { speaker: 'Софья', text: 'Главное понятие.', visual: { type: 'term', term: 'Энтропия', definition: 'Мера беспорядка системы.' } },
  { speaker: 'Макс', text: 'Формула.', visual: { type: 'formula', title: 'Изменение энтропии', latex: '\\Delta S = Q / T' } },
  { speaker: 'Софья', text: 'Схема.', visual: { type: 'diagram', title: 'Цикл', nodes: [{ id: 'a', label: 'Нагреватель' }, { id: 'b', label: 'Тело' }, { id: 'c', label: 'Холодильник' }], edges: [{ from: 'a', to: 'b', label: 'тепло' }, { from: 'b', to: 'c', label: 'остаток' }] } },
  { speaker: 'Макс', text: 'Цифры.', visual: { type: 'chart', title: 'КПД', kind: 'bar', unit: '%', data: [{ label: 'Пар', value: 15 }, { label: 'Дизель', value: 42 }] } },
  { speaker: 'Софья', text: 'Сравним.', visual: { type: 'compare', title: 'Процессы', left: { label: 'Обратимый', points: ['В обе стороны'] }, right: { label: 'Необратимый', points: ['В одну сторону'] } } },
  { speaker: 'Макс', text: 'История.', visual: { type: 'timeline', title: 'История', events: [{ date: '1824', label: 'Карно' }, { date: '1850', label: 'Клаузиус' }] } },
  { speaker: 'Софья', text: 'По шагам.', visual: { type: 'steps', title: 'Задача', items: ['Система', 'Процесс', 'Формула'] } },
  { speaker: 'Макс', text: 'Факт.', visual: { type: 'fact', title: 'Тепловая смерть', text: 'Энтропия изолированной системы растёт.' } },
  { speaker: 'Софья', text: 'Проверка.', visual: { type: 'question', question: 'Что растёт?', answer: 'Энтропия.' } },
  { speaker: 'Макс', text: 'Ещё схема.', visual: { type: 'diagram', title: 'Начала', nodes: [{ id: 'z', label: 'Нулевое' }, { id: 'f', label: 'Первое' }], edges: [{ from: 'z', to: 'f', label: 'температура' }] } },
  { speaker: 'Софья', text: 'График.', visual: { type: 'chart', title: 'Нагрев', kind: 'line', unit: 'Дж/К', data: [{ label: '0', value: 0 }, { label: '100', value: 23 }] } },
  { speaker: 'Макс', text: 'Термин.', visual: { type: 'term', term: 'Изотерма', definition: 'Процесс при постоянной температуре.' } },
];

/** What the actions put on the page, commit by commit. */
function watch(action: () => void) {
  budget.commits = [];
  budget.on = true;
  try {
    action();
  } finally {
    budget.on = false;
  }
  return budget.commits;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('render budget: «Подкаст» (smoothness debt: the tap took ≈ 490 ms with 13 hidden copies)', () => {
  it('the player’s first commit draws only the picture in view; the copies follow at most 3 a commit, one step a frame', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const first = watch(() => {
      render(<ConversationPlayer lines={LINES} title="Термодинамика" />);
    });
    expect(first[0]).toMatchObject({ player: true, active: 1, copies: 0 });
    expect(first.every((commit) => commit.copies === 0)).toBe(true);
    let shown = 0;
    for (let frame = 0; frame < 12 && shown < 13; frame += 1) {
      const commits = watch(() => {
        act(() => {
          vi.advanceTimersByTime(17);
        });
      });
      for (const commit of commits) {
        expect(commit.copies - shown).toBeLessThanOrEqual(3);
        shown = Math.max(shown, commit.copies);
      }
    }
    // Every picture of the conversation has its copy in the end (the sheet's height is the tallest one's).
    expect(document.querySelectorAll('[data-scene-layer="measure"]')).toHaveLength(13);
  });

  it('the lecture page: the tap’s own commit moves the tab; the player comes in a later commit', async () => {
    page.material = {
      id: 'm1', user_id: 'user-1', title: 'Термодинамика', subject: 'Физика', is_public: false, created_at: '2026-10-20T10:00:00Z',
      original_text: 'Энтропия — мера беспорядка.', summary_json: { content: '## Энтропия\n\nМера беспорядка.', podcast: LINES },
      flashcards_json: null, quiz_json: null,
    };
    render(
      <MemoryRouter initialEntries={['/library/m1']}>
        <Routes>
          <Route path="/library/:id" element={<MaterialDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    const tab = await screen.findByRole('tab', { name: 'Подкаст' });
    const commits = watch(() => fireEvent.click(tab));
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0]).toMatchObject({ tab: 'Подкаст', player: false });
    expect(commits.some((commit) => commit.player)).toBe(true);
    expect(screen.getByRole('region', { name: 'Подкаст по лекции' })).toBeInTheDocument();
  });
});
