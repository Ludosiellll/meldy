/**
 * «Сегодня» and the exam container (spec decisions 2, 25, 31, 33, 47; Concept 1 §3.10).
 *
 * Part 1 — today's page to the byte. The DOM of «Сегодня» for accounts without containers was recorded from the code
 * before the container work (src/pages/__snapshots__/today/*.html). Every way the container layer can answer — no
 * containers, no container functions in the database, a read error, no answer at all, a crash — must give exactly that
 * DOM again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LearningEvent } from '../api/learning';
import type { DueCard } from '../api/flashcards';
import type { ContainersOverview } from '../types/container';
import { PHONE_QUERY } from '../lib/usePhone';
import { localDateKey } from '../utils/streak';

type Query = { table: string; select: string; calls: Array<[string, unknown[]]> };

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, (query: { select: string; calls: Array<[string, unknown[]]> }) => { data?: unknown; error?: unknown }>,
    queries: [] as Array<{ table: string; select: string; calls: Array<[string, unknown[]]> }>,
    countDueCards: vi.fn(),
    getDueCards: vi.fn(),
    syncFlashcards: vi.fn(),
    fetchQuestionEvents: vi.fn(),
    fetchSheetEvents: vi.fn(),
    fetchSheet: vi.fn(),
    user: { id: 'user-1', user_metadata: { full_name: 'Алина Соколова' } } as { id: string; user_metadata: Record<string, unknown> },
  };
  const from = (table: string) => {
    const entry = { table, select: '', calls: [] as Array<[string, unknown[]]> };
    state.queries.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'order', 'limit']) {
      builder[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        if (method === 'select') entry.select = String(args[0]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const result = { data: [], error: null, ...(state.tables[table]?.(entry) ?? {}) } as { data: unknown; error: unknown };
      const limit = entry.calls.find(([name]) => name === 'limit')?.[1][0];
      if (Array.isArray(result.data) && typeof limit === 'number') result.data = result.data.slice(0, limit);
      return Promise.resolve(result).then(resolve, reject);
    };
    return builder;
  };
  return Object.assign(state, { from });
});

/** The container layer as package D1's hooks would answer (mocked: D1 builds them in parallel). */
const layer = vi.hoisted(() => ({
  overview: null as null | (() => unknown),
}));

vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => db.from(table) } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: db.user, loading: false }) }));
vi.mock('../api/flashcards', () => ({
  countDueCards: (...args: unknown[]) => db.countDueCards(...args),
  getDueCards: (...args: unknown[]) => db.getDueCards(...args),
  syncFlashcards: (...args: unknown[]) => db.syncFlashcards(...args),
}));
vi.mock('../api/learning', () => ({
  fetchQuestionEvents: (...args: unknown[]) => db.fetchQuestionEvents(...args),
  fetchSheetEvents: (...args: unknown[]) => db.fetchSheetEvents(...args),
}));
vi.mock('../api/cheatSheet', () => ({ fetchSheet: (...args: unknown[]) => db.fetchSheet(...args) }));
vi.mock('../lib/containers/hooks', () => ({
  useContainersOverview: () => {
    if (!layer.overview) throw new Error('useContainersOverview: not mocked');
    return layer.overview();
  },
  useContainerData: () => ({ data: null, loading: true, offline: false, unavailable: false, error: null, reload: () => undefined }),
}));

import Dashboard from './Dashboard';

// ------------------------------------------------------------------------------------------------
// Fixtures: Saturday, 3 October 2026; an oral exam of 40 questions on 15 October (the demo's shape).

const NOW = new Date(2026, 9, 3, 12, 0);
const NONE = new Set([5, 8, 17, 22, 26, 29, 35, 38, 40]);
const PARTIAL = new Set([3, 9, 14, 19, 24, 33, 37]);
const hash = (position: number) => position.toString(16).padStart(32, '0');

function questionRows() {
  return Array.from({ length: 40 }, (_, index) => {
    const position = index + 1;
    return {
      id: `q${position}`,
      exam_id: 'e-1',
      position,
      label: String(position),
      section: position <= 20 ? 1 : 2,
      question_hash: hash(position),
      coverage: NONE.has(position) ? 'none' : PARTIAL.has(position) ? 'partial' : 'full',
    };
  });
}

function examRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e-1',
    title: 'Экзамен: цифровая экономика',
    kind: 'exam',
    exam_date: '2026-10-15',
    mapped_at: '2026-10-03T06:40:00Z',
    ticket_layout: { mode: 'random', per_ticket: 2 },
    created_at: '2026-09-30T09:30:00Z',
    ...overrides,
  };
}

function answer(position: number, day: number, hour: number, grade: number, id: string): LearningEvent {
  const at = new Date(2026, 9, day, hour, 0);
  return {
    id,
    created_at: at.toISOString(),
    local_date: localDateKey(at),
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${hash(position)}`,
    correct: grade >= 4,
    score: grade >= 4 ? 0.8 : 0.4,
    confidence: null,
    source_ids: [],
    session_id: `s-${id}`,
    payload: { grade },
  };
}

const HISTORY = [answer(31, -2, 10, 4, 'a1'), answer(31, -1, 12, 5, 'a2'), answer(23, 1, 10, 4, 'a3'), answer(23, 2, 11, 5, 'a4'), answer(7, 2, 12, 4, 'a5')];

const LECTURES = [
  {
    id: 'm1',
    title: 'Эластичность спроса',
    created_at: '2026-10-02T10:00:00Z',
    summary_json: { content: 'Конспект', podcast: [{ speaker: 'Анна', text: '…' }] },
    flashcards_json: { flashcards: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, question: `Вопрос ${i + 1}`, answer: 'Ответ' })) },
    quiz_json: { quiz: [{ id: 1 }] },
  },
  { id: 'm2', title: 'Поведение потребителя', created_at: '2026-10-01T10:00:00Z', summary_json: { text_only: true }, flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] } },
  {
    id: 'm3',
    title: 'Спрос и предложение',
    created_at: '2026-09-29T10:00:00Z',
    summary_json: { content: 'Конспект' },
    flashcards_json: { flashcards: [{ id: 1, question: 'Что такое спрос?', answer: 'Желание и возможность купить' }] },
    quiz_json: { quiz: [{ id: 1 }] },
  },
  {
    id: 'm4',
    title: 'Издержки производства',
    created_at: '2026-09-24T10:00:00Z',
    summary_json: { content: 'Конспект' },
    flashcards_json: { flashcards: [{ id: 1, question: 'Что такое издержки?', answer: 'Затраты' }] },
    quiz_json: { quiz: [] },
  },
  { id: 'm5', title: 'Рынок труда', created_at: '2026-09-20T10:00:00Z', summary_json: { text_only: true }, flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] } },
];

function dueCards(count = 11): DueCard[] {
  const lectures = ['m1', 'm3', 'm4'];
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index + 1}`,
    material_id: lectures[Math.min(2, Math.floor(index / 4))],
    question: index === 0 ? 'Почему спрос на хлеб неэластичен?' : `Карточка ${index + 1}`,
    answer: 'Ответ',
  }));
}

function setPhone() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/** The account's «Первые шаги» as remembered on this device ('done': not read again, as for the demo account). */
function remember(steps: 'done' | null) {
  if (steps) window.localStorage.setItem('meldy_first_steps_user-1', steps);
}

// ------------------------------------------------------------------------------------------------
// The layer's answers

const EMPTY: ContainersOverview = { v: 1, day: '2026-10-03', containers: [], attached_exam_ids: [] };
const loadable = (over: Record<string, unknown>) => () => ({ data: null, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined, ...over });

const LAYER_VARIANTS: Record<string, () => unknown> = {
  'no containers': loadable({ data: EMPTY }),
  'no container functions in the database': loadable({ unavailable: true }),
  'a read error': loadable({ error: 'Не получилось. Попробуйте ещё раз.' }),
  'offline without a saved copy': loadable({ offline: true, error: 'Нет сети.' }),
  'no answer yet (too slow)': loadable({ loading: true }),
  'a crash in the hook': () => {
    throw new Error('the hook broke');
  },
};

// ------------------------------------------------------------------------------------------------
// The scenarios of today's page

interface Scenario {
  phone?: boolean;
  steps?: 'done' | null;
  setup: () => void;
  /** Something on the page once it has loaded. */
  ready: () => Promise<unknown>;
}

const seededExam = () => {
  db.tables.exams = () => ({ data: [examRow()] });
};

const SCENARIOS: Record<string, Scenario> = {
  'exam-desk': {
    steps: 'done',
    setup: seededExam,
    ready: () => screen.findByText(/Вчера: ответ на вопрос 7/),
  },
  'exam-phone': {
    phone: true,
    steps: 'done',
    setup: seededExam,
    ready: () => screen.findByText(/35\s%/),
  },
  'later-exam-desk': {
    steps: 'done',
    setup: () => {
      db.tables.exams = () => ({ data: [examRow({ exam_date: '2026-11-30' })] });
    },
    ready: () => screen.findByRole('link', { name: /^Экзамены/ }),
  },
  'error-desk': {
    steps: 'done',
    setup: () => {
      seededExam();
      db.tables.study_sessions = () => ({ data: null, error: { message: 'down' } });
    },
    ready: () => screen.findByText('Не удалось загрузить данные'),
  },
};

/**
 * Accounts that change on purpose when the container layer is on (decision 25: a neutral first step); with the layer
 * off they stay today's page to the byte.
 */
const OFF_ONLY_SCENARIOS: Record<string, Scenario> = {
  'steps-desk': {
    steps: null,
    setup: () => {
      seededExam();
      db.fetchQuestionEvents.mockResolvedValue([]);
    },
    ready: () => screen.findByRole('heading', { name: 'Первые шаги' }),
  },
  'new-account-desk': {
    steps: null,
    setup: () => {
      db.tables.materials = () => ({ data: [] });
      db.tables.exams = () => ({ data: [] });
      db.countDueCards.mockResolvedValue(0);
      db.getDueCards.mockResolvedValue([]);
    },
    ready: () => screen.findByRole('heading', { name: 'Первые шаги' }),
  },
};

/** The page's DOM once everything has loaded; React's generated ids are the only thing normalised. */
async function renderToday(scenario: Scenario): Promise<string> {
  if (scenario.phone) setPhone();
  remember(scenario.steps ?? null);
  scenario.setup();
  const { container } = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await scenario.ready();
  // The cheat sheet, the history and the layer's wait all settle within this.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  return container.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  window.localStorage.clear();
  db.queries.length = 0;
  for (const table of Object.keys(db.tables)) delete db.tables[table];
  db.user = { id: 'user-1', user_metadata: { full_name: 'Алина Соколова' } };
  db.tables.materials = (query: Query | { select: string }) => ({
    data: query.select.includes('summary_json') ? LECTURES : LECTURES.map(({ id, title, created_at }) => ({ id, title, created_at })),
  });
  db.tables.flashcard_progress = () => ({ data: [{ material_id: 'm1' }, { material_id: 'm3' }, { material_id: 'm4' }] });
  db.tables.exam_questions = () => ({ data: questionRows() });
  db.countDueCards.mockReset().mockResolvedValue(11);
  db.getDueCards.mockReset().mockResolvedValue(dueCards());
  db.syncFlashcards.mockReset().mockResolvedValue({ inserted: 1, skipped: 0 });
  db.fetchQuestionEvents.mockReset().mockResolvedValue(HISTORY);
  db.fetchSheet.mockReset().mockResolvedValue({ examId: 'e-1', mappingState: 'done', questions: [], toWrite: 0, units: 0, job: null });
  db.fetchSheetEvents.mockReset().mockResolvedValue([]);
  layer.overview = LAYER_VARIANTS['no containers'];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('«Сегодня» without containers is today’s page to the byte', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const [variant, overview] of Object.entries(LAYER_VARIANTS)) {
      it(`${name}: ${variant}`, async () => {
        layer.overview = overview;
        const html = await renderToday(scenario);
        await expect(html).toMatchFileSnapshot(`./__snapshots__/today/${name}.html`);
      });
    }
  }
  for (const [name, scenario] of Object.entries(OFF_ONLY_SCENARIOS)) {
    for (const variant of Object.keys(LAYER_VARIANTS).filter((key) => key !== 'no containers')) {
      it(`${name}: ${variant}`, async () => {
        layer.overview = LAYER_VARIANTS[variant];
        const html = await renderToday(scenario);
        await expect(html).toMatchFileSnapshot(`./__snapshots__/today/${name}.html`);
      });
    }
  }
});

