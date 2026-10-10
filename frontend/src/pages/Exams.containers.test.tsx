/**
 * «Экзамены» and the exam container (spec decisions 2, 28, 31, 48; Concept 1 §3.1).
 *
 * Part 1 — today's page to the byte. The DOM of «Экзамены» for accounts without containers was recorded from the code
 * before the container work (src/pages/__snapshots__/exams/*.html). Every way the container layer can answer — no
 * containers, no container functions in the database, a read error, no answer at all, a crash — must give exactly that
 * DOM again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ExamListItem } from '../api/exams';
import type { LearningEvent } from '../api/learning';
import type { ContainersOverview } from '../types/container';
import { PHONE_QUERY } from '../lib/usePhone';

const mocks = vi.hoisted(() => ({ listExams: vi.fn(), fetchQuestionEvents: vi.fn() }));
const layer = vi.hoisted(() => ({ overview: null as null | (() => unknown) }));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/exams')>();
  return { ...actual, listExams: mocks.listExams };
});
vi.mock('../api/learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/learning')>();
  return { ...actual, fetchQuestionEvents: mocks.fetchQuestionEvents };
});
vi.mock('../lib/containers/hooks', () => ({
  useContainersOverview: () => {
    if (!layer.overview) throw new Error('useContainersOverview: not mocked');
    return layer.overview();
  },
  useContainerData: () => ({ data: null, loading: true, offline: false, unavailable: false, error: null, reload: () => undefined }),
}));

import Exams from './Exams';

// Saturday, 3 October 2026.
const NOW = new Date(2026, 9, 3, 12, 0);
const hash = (n: number) => n.toString(16).padStart(32, 'c');

function item(overrides: Partial<ExamListItem> = {}): ExamListItem {
  return {
    id: 'exam-1',
    title: 'Микроэкономика',
    kind: 'exam',
    exam_date: '2026-10-15',
    mapping_state: 'done',
    mapped_at: '2026-10-03T06:40:00Z',
    created_at: '2026-10-01T06:40:00Z',
    total: 40,
    coverage: { full: 24, partial: 7, none: 9, unverified: 0, unmapped: 0 },
    hashes: Array.from({ length: 40 }, (_, index) => hash(index + 1)),
    ...overrides,
  };
}

function passes(n: number): LearningEvent[] {
  return ['2026-09-20', '2026-09-27'].map((day, index) => ({
    id: `e${n}-${index}`,
    created_at: `${day}T10:00:00Z`,
    local_date: day,
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${hash(n)}`,
    correct: true,
    score: 0.9,
    confidence: null,
    source_ids: [],
    session_id: `s${n}${index}`,
    payload: { grade: 5 },
  }));
}

const THREE = () => [
  item(),
  item({ id: 'exam-2', title: 'Макроэкономика', kind: 'credit', exam_date: null, mapping_state: 'none', mapped_at: null, total: 25, coverage: { full: 0, partial: 0, none: 0, unverified: 0, unmapped: 25 }, hashes: [] }),
  item({ id: 'exam-3', title: 'История экономических учений', kind: 'colloquium', exam_date: '2026-09-13', total: 12, coverage: { full: 8, partial: 0, none: 4, unverified: 0, unmapped: 0 }, hashes: [] }),
];

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

interface Scenario {
  phone?: boolean;
  setup: () => void;
  ready: () => Promise<unknown>;
}

const SCENARIOS: Record<string, Scenario> = {
  'list-desk': {
    setup: () => {
      mocks.listExams.mockResolvedValue(THREE());
      mocks.fetchQuestionEvents.mockResolvedValue(Array.from({ length: 6 }, (_, index) => passes(index + 1)).flat());
    },
    ready: () => screen.findByText(/подтверждено 6/),
  },
  'list-phone': {
    phone: true,
    setup: () => {
      mocks.listExams.mockResolvedValue(THREE().slice(0, 2));
      mocks.fetchQuestionEvents.mockResolvedValue(Array.from({ length: 6 }, (_, index) => passes(index + 1)).flat());
    },
    ready: () => screen.findByText(/подтверждено 6/),
  },
  'error-desk': {
    setup: () => {
      mocks.listExams.mockRejectedValue(new Error('boom'));
    },
    ready: () => screen.findByRole('heading', { name: 'Не удалось загрузить экзамены' }),
  },
};

/** The empty list changes on purpose when the layer is on (Concept 1 §3.1); with the layer off it is today's to the byte. */
const OFF_ONLY_SCENARIOS: Record<string, Scenario> = {
  'empty-desk': {
    setup: () => {
      mocks.listExams.mockResolvedValue([]);
    },
    ready: () => screen.findByRole('heading', { level: 2 }),
  },
};

async function renderExams(scenario: Scenario): Promise<string> {
  if (scenario.phone) setPhone();
  scenario.setup();
  const { container } = render(
    <MemoryRouter initialEntries={['/exams']}>
      <Routes>
        <Route path="/exams" element={<Exams />} />
      </Routes>
    </MemoryRouter>,
  );
  await scenario.ready();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  return container.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mocks.listExams.mockReset();
  mocks.fetchQuestionEvents.mockReset().mockResolvedValue([]);
  layer.overview = LAYER_VARIANTS['no containers'];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('«Экзамены» without containers is today’s page to the byte', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const [variant, overview] of Object.entries(LAYER_VARIANTS)) {
      it(`${name}: ${variant}`, async () => {
        layer.overview = overview;
        const html = await renderExams(scenario);
        await expect(html).toMatchFileSnapshot(`./__snapshots__/exams/${name}.html`);
      });
    }
  }
  for (const [name, scenario] of Object.entries(OFF_ONLY_SCENARIOS)) {
    for (const variant of Object.keys(LAYER_VARIANTS).filter((key) => key !== 'no containers')) {
      it(`${name}: ${variant}`, async () => {
        layer.overview = LAYER_VARIANTS[variant];
        const html = await renderExams(scenario);
        await expect(html).toMatchFileSnapshot(`./__snapshots__/exams/${name}.html`);
      });
    }
  }
});
