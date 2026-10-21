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
  /** Per container id: what useContainerData answers. */
  data: {} as Record<string, () => unknown>,
  planCalls: 0,
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
  useContainerData: (id: string) =>
    layer.data[id]?.() ?? { data: null, loading: true, offline: false, unavailable: false, error: null, reload: () => undefined },
}));
// Package D2's planDay: the tests hand the day's plan in through the plan input.
vi.mock('../lib/containers/plan', () => ({
  planDay: (input: { plan?: unknown; broken?: boolean }) => {
    layer.planCalls += 1;
    if (input.broken) throw new Error('planDay broke');
    return input.plan;
  },
}));
// Package D3b's card (spec decision 47): a stand-in that shows what «Сегодня» hands it.
const card = vi.hoisted(() => ({ crash: false }));
vi.mock('../components/containers/TodayExamCard', () => ({
  default: (props: { container: { id: string; title: string }; plan: { state: string } | null; questions?: number | null; offline?: boolean; lead: boolean; onMove?: () => void }) => {
    if (card.crash) throw new Error('the card broke');
    return (
      <article
        className="td-card td-exam"
        data-testid="today-card"
        data-id={props.container.id}
        data-plan={props.plan?.state ?? 'none'}
        data-questions={props.questions ?? 'none'}
        data-offline={props.offline ? '' : undefined}
      >
        <h2>{props.container.title}</h2>
        <a className={props.lead ? 'sf-primary' : 'sf-link'} href={`/exams/c/${props.container.id}/study`}>
          Начать
        </a>
        {/* Release 47: the real card's quiet «Перенести» on the exam's day (TodayExamCard.test). */}
        {props.onMove && props.plan?.state === 'exam_today' ? (
          <button type="button" className="sf-link" onClick={props.onMove}>
            Перенести
          </button>
        ) : null}
      </article>
    );
  },
}));
// «Перенести экзамен» (release 47): the dialog reads the exam and saves the move through these.
const move = vi.hoisted(() => ({ fetchSummary: vi.fn(), moveExamDate: vi.fn() }));
vi.mock('../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/containers')>()),
  fetchSummary: move.fetchSummary,
  moveExamDate: move.moveExamDate,
}));

import Dashboard from './Dashboard';
import { LAYER_WAIT } from './containerLayer';
import { PLAN_WAIT } from './Dashboard';

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

/** React re-throws a caught render error once in development; jsdom would print it for the crash variant. */
const quiet = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  // The layer waits this long for an answer before it draws today's page.
  LAYER_WAIT.ms = 40;
  window.addEventListener('error', quiet);
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
  layer.data = {};
  layer.planCalls = 0;
  card.crash = false;
  PLAN_WAIT.ms = 300;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.removeEventListener('error', quiet);
  LAYER_WAIT.ms = 2500;
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


// ------------------------------------------------------------------------------------------------
// Part 2 — accounts with exam containers.

import { fireEvent, waitFor, within } from '@testing-library/react';
import type { DayPlan, OverviewContainer, OverviewSubject } from '../types/container';
import { aboutMinutes, containerRowMeta, firstStepViews, firstStepsDone, recentlyPassed, todayLayout, type TodayContainer } from './Dashboard';

const plainText = (text: string | null | undefined) => (text ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

function dayPlan(state: DayPlan['state'], over: Partial<DayPlan> = {}): DayPlan {
  return {
    day: '2026-10-03',
    state,
    sessions: state === 'study' ? [{ subjectId: 's-1', kind: 'answer', ids: ['i1'], estSec: 540 }] : [],
    counts: { newItems: 30, reviews: 60, oral: 0, aiChecks: 0, estSec: 2700, leftSec: state === 'study' ? 2700 : 0, doneSec: 0 },
    postponed: {},
    coverage: { unseen: 550, floor: 30, lastNewDay: null, seenByDateEst: 960, neededMin: 45 },
    window: { from: null, days: 4, inWindow: false },
    units: null,
    figure: { inPlan: 960, twoDays: 143, seen: 410, errors: 37, selfKnow: 0 },
    perSubject: [],
    next: null,
    firstCountDay: null,
    lines: [],
    ...over,
  };
}

function subjectOf(n: number, over: Partial<OverviewSubject> = {}): OverviewSubject {
  return { id: `s-${n}`, position: n, title: `Предмет ${n}`, exam_date: '2026-10-22', oral_exam_id: null, has_oral: false, keyed: 240, no_key: 0, seen: 100, two_days: 35, open_errors: 9, seen_today: 0, doubted: 0, stale: 0, ...over };
}

function container(id: string, title: string, date: string | null, over: Partial<OverviewContainer> = {}): OverviewContainer {
  return {
    id,
    title,
    exam_date: date,
    created_at: '2026-10-01T10:00:00Z',
    role: 'owner',
    items: 960,
    items_updated_at: null,
    subjects: [1, 2, 3, 4].map((n) => subjectOf(n, { exam_date: date })),
    answers_today: 0,
    settings: null,
    ...over,
  };
}

/** The account's containers and attached oral exams; each container's plan for today (or a read that fails). */
function withContainers(list: OverviewContainer[], plans: Record<string, DayPlan | 'fails' | 'broken' | 'loading'>, attached: string[] = [], offline = false) {
  layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: list, attached_exam_ids: attached }, offline });
  for (const [id, plan] of Object.entries(plans)) {
    layer.data[id] =
      plan === 'fails'
        ? loadable({ error: 'Не получилось.' })
        : plan === 'loading'
          ? loadable({ loading: true })
          : loadable({ data: { summary: {}, planInput: plan === 'broken' ? { broken: true } : { plan }, items: new Map(), oralWithoutPoints: 0 }, offline });
  }
}

const ACCR = () => container('c-1', 'Аккредитация', '2026-10-10');
const WINTER = () => container('c-2', 'Зимняя сессия', '2027-01-12', { created_at: '2026-09-20T10:00:00Z' });

async function renderPage(options: { phone?: boolean; steps?: 'done' | null } = {}) {
  if (options.phone) setPhone();
  remember(options.steps === undefined ? 'done' : options.steps);
  const view = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return view;
}

const blues = () => Array.from(document.querySelectorAll('.sf-primary'));

describe('«Сегодня» with exam containers: who leads', () => {
  it('a container with the nearest date and work today leads with the page’s one blue button; the oral exam is a quiet row', async () => {
    seededExam();
    withContainers([ACCR()], { 'c-1': dayPlan('study') });
    await renderPage();
    const cardEl = await screen.findByTestId('today-card');
    expect(cardEl).toHaveAttribute('data-id', 'c-1');
    expect(cardEl).toHaveAttribute('data-plan', 'study');
    // One blue button on the whole page: the card's.
    expect(blues()).toEqual([within(cardEl).getByRole('link', { name: 'Начать' })]);
    // The oral exam is one quiet row: its name, its day and its size; no ExamBlock, no second «Тянуть билет».
    const rows = screen.getByRole('region', { name: 'Другие экзамены' });
    const oral = within(rows).getByRole('link', { name: /Цифровая экономика/ });
    expect(oral).toHaveAttribute('href', '/exams/e-1');
    expect(plainText(oral.textContent)).toBe('Цифровая экономика15 октября · 40 вопросов');
    expect(screen.queryByRole('link', { name: 'Тянуть билет' })).toBeNull();
    // The review card steps back to a white pill.
    expect(screen.getByRole('link', { name: /Начать повторение/ })).not.toHaveClass('sf-primary');
    // The card and the rows share the main column, above the side.
    const main = cardEl.closest('.td-main')!;
    expect(main.parentElement).toHaveClass('td-grid');
    expect(main.contains(rows)).toBe(true);
  });

  it('the card gets the exam’s size from its own page’s data, oral questions included (usability check 2026-10-10, m6)', async () => {
    // 34 questions with variants and an oral part of 20: the overview knows only the 34.
    const exam = container('c-1', 'Проверка удаления', '2026-10-10', {
      items: 34,
      subjects: [subjectOf(1, { oral_exam_id: 'e-9', has_oral: true, keyed: 0 }), subjectOf(2, { keyed: 14 }), subjectOf(3, { keyed: 20 })],
    });
    layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [exam], attached_exam_ids: ['e-9'] } });
    const summary = { items_version: { count: 34 }, subjects: [{ oral: { exam_id: 'e-9', questions: 20 } }, { oral: null }, { oral: null }] };
    layer.data['c-1'] = loadable({ data: { summary, planInput: { plan: dayPlan('study') }, items: new Map(), oralWithoutPoints: 0 } });
    await renderPage();
    expect(await screen.findByTestId('today-card')).toHaveAttribute('data-questions', '54');
  });

  it('an oral exam with a nearer date leads as today; the container is a quiet row with today’s minutes', async () => {
    seededExam();
    withContainers([container('c-1', 'Аккредитация', '2026-10-22')], { 'c-1': dayPlan('study') });
    await renderPage();
    const draw = await screen.findByRole('link', { name: 'Тянуть билет' });
    expect(blues()).toEqual([draw]);
    expect(screen.queryByTestId('today-card')).toBeNull();
    const row = within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Аккредитация/ });
    expect(row).toHaveAttribute('href', '/exams/c/c-1');
    expect(plainText(row.textContent)).toBe('Аккредитация22 октября · сегодня около 45 минут');
  });

  it('never leads with an exam inside a container: pickExam gets only the exams outside them', async () => {
    // e-1 lives inside «Аккредитация» (its oral part); the account's other exam is e-2.
    db.tables.exams = () => ({ data: [examRow(), examRow({ id: 'e-2', title: 'Экзамен: статистика', exam_date: '2026-10-20' })] });
    withContainers([container('c-1', 'Аккредитация', '2026-10-22')], { 'c-1': dayPlan('study') }, ['e-1']);
    await renderPage();
    await screen.findByRole('link', { name: 'Тянуть билет' });
    expect(screen.getByRole('heading', { level: 2, name: /Статистика/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /Цифровая экономика/ })).toBeNull();
    // Only the picked exam's questions are read for the card.
    const questionReads = db.queries.filter((query) => query.table === 'exam_questions' && query.calls.some(([name, a]) => name === 'eq' && a[0] === 'exam_id'));
    expect(questionReads.map((query) => query.calls.find(([name]) => name === 'eq')![1][1])).toEqual(['e-2']);
  });

  it('a container whose day is done: an oral exam with work leads; the container says «на сегодня всё» in its row', async () => {
    seededExam();
    withContainers([ACCR()], { 'c-1': dayPlan('done') });
    await renderPage();
    expect(blues()).toEqual([await screen.findByRole('link', { name: 'Тянуть билет' })]);
    const row = within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Аккредитация/ });
    expect(plainText(row.textContent)).toBe('Аккредитация10 октября · на сегодня всё');
  });

  it('only a container, its day done: its card still leads, without the blue; «Начать повторение» takes it', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([ACCR()], { 'c-1': dayPlan('done') });
    await renderPage();
    const cardEl = await screen.findByTestId('today-card');
    expect(cardEl).toHaveAttribute('data-plan', 'done');
    expect(within(cardEl).getByRole('link', { name: 'Начать' })).not.toHaveClass('sf-primary');
    expect(blues().map((link) => plainText(link.textContent))).toEqual(['Начать повторение']);
    // An account with an exam: never the «new account» page, the cards beside the exam card.
    expect(screen.queryByRole('heading', { name: 'Первые шаги' })).toBeNull();
  });

  it('two containers with work today: the nearer leads, the other is a quiet row', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([WINTER(), ACCR()], { 'c-1': dayPlan('study'), 'c-2': dayPlan('study', { counts: { ...dayPlan('study').counts, leftSec: 1180 } }) });
    await renderPage();
    expect(await screen.findByTestId('today-card')).toHaveAttribute('data-id', 'c-1');
    const row = within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Зимняя сессия/ });
    expect(plainText(row.textContent)).toBe('Зимняя сессия12 января 2027 · сегодня около 20 минут');
    expect(blues()).toHaveLength(1);
  });

  it('the author’s own test is given, not studied (release 47.3): no card, no row; a test they joined is studied', async () => {
    db.tables.exams = () => ({ data: [] });
    const own = container('c-2', 'Кислоты и основания', null, { kind: 'test', created_at: '2026-10-02T10:00:00Z' });
    const joined = container('c-3', 'Тест соседа', null, { kind: 'test', role: 'member', created_at: '2026-09-20T10:00:00Z' });
    withContainers([own, ACCR(), joined], { 'c-1': dayPlan('study'), 'c-2': dayPlan('study'), 'c-3': dayPlan('study') });
    await renderPage();
    expect(await screen.findByTestId('today-card')).toHaveAttribute('data-id', 'c-1');
    expect(plainText(document.body.textContent)).not.toContain('Кислоты и основания');
    expect(within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Тест соседа/ })).toBeInTheDocument();
  });

  it('an exam on its day off is a quiet row «… · сегодня выходной» while another one has work (D1)', async () => {
    db.tables.exams = () => ({ data: [] });
    // The nearer exam is the one on its day off: the other, with work, still leads.
    withContainers([WINTER(), ACCR()], { 'c-1': dayPlan('nothing', { lines: [{ key: 'day_off', n: [2], day: '2026-10-05' }] }), 'c-2': dayPlan('study') });
    await renderPage();
    expect(await screen.findByTestId('today-card')).toHaveAttribute('data-id', 'c-2');
    const row = within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Аккредитация/ });
    expect(plainText(row.textContent)).toBe('Аккредитация10 октября · сегодня выходной');
    expect(row).toHaveAttribute('href', '/exams/c/c-1');
    expect(blues()).toHaveLength(1);
  });

  it('on a phone: the same order, one blue, the rows as one card', async () => {
    seededExam();
    withContainers([ACCR()], { 'c-1': dayPlan('study') });
    await renderPage({ phone: true });
    const cardEl = await screen.findByTestId('today-card');
    expect(blues()).toEqual([within(cardEl).getByRole('link', { name: 'Начать' })]);
    const rows = screen.getByRole('region', { name: 'Другие экзамены' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(1);
    expect(cardEl.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // «Начать повторение» is a quiet link under them.
    expect(screen.getByRole('link', { name: 'Начать повторение' })).toHaveClass('sf-link');
  });
});

describe('«Сегодня»: an exam passed in the last 14 days stays with «Перенести» (release 47)', () => {
  const SUMMER = (date = '2026-09-30') => container('c-5', 'Летняя сессия', date);
  beforeEach(() => {
    move.fetchSummary.mockReset().mockResolvedValue({ role: 'owner', owner: { members: 0 }, exam_date: '2026-09-30', subjects: [] });
    move.moveExamDate.mockReset().mockImplementation(async (id: string, date: string) => ({ for: 'all', container_id: id, exam_date: date, own_exam_date: null, subjects: [] }));
  });

  it('a quiet row under the others: «Экзамен «Летняя сессия» прошёл 30 сентября · Перенести» (it used to leave the page)', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([ACCR(), SUMMER()], { 'c-1': dayPlan('study') });
    await renderPage();
    await screen.findByTestId('today-card');
    const rows = screen.getByRole('region', { name: 'Другие экзамены' });
    const items = within(rows).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(plainText(items[0].textContent)).toBe('Экзамен «Летняя сессия» прошёл 30 сентября · Перенести');
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/exams/c/c-5');
    const button = within(items[0]).getByRole('button', { name: 'Перенести' });
    expect(button).toHaveClass('sf-link');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(plainText(button.getAttribute('aria-describedby') ? document.getElementById(button.getAttribute('aria-describedby')!)?.textContent : '')).toBe('Экзамен «Летняя сессия» прошёл 30 сентября');
    // Still one blue button: the card's.
    expect(blues()).toHaveLength(1);
  });

  it('with no other exam the row stands under «Сегодня»’s own first card', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([SUMMER('2026-10-02')], {});
    await renderPage();
    const rows = await screen.findByRole('region', { name: 'Другие экзамены' });
    expect(plainText(rows.textContent)).toBe('Экзамен «Летняя сессия» прошёл 2 октября · Перенести');
    expect(screen.queryByTestId('today-card')).toBeNull();
  });

  it('an exam passed more than 14 days ago is not on «Сегодня»', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([ACCR(), SUMMER('2026-09-18')], { 'c-1': dayPlan('study') });
    await renderPage();
    await screen.findByTestId('today-card');
    expect(screen.queryByRole('region', { name: 'Другие экзамены' })).toBeNull();
    expect(plainText(document.body.textContent)).not.toContain('Летняя сессия');
  });

  it('«Перенести» opens the dialog; saved, the overview and the plans are read again and the page says the new date', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([ACCR(), SUMMER()], { 'c-1': dayPlan('study') });
    const overviewReload = vi.fn();
    const planReload = vi.fn();
    const overview = layer.overview!;
    layer.overview = () => ({ ...(overview() as object), reload: overviewReload });
    const plan = layer.data['c-1'];
    layer.data['c-1'] = () => ({ ...(plan() as object), reload: planReload });
    await renderPage();
    const opener = await screen.findByRole('button', { name: 'Перенести' });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Перенести экзамен' });
    await waitFor(() => expect(move.fetchSummary).toHaveBeenCalledWith('c-5', '2026-10-03'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(move.moveExamDate).toHaveBeenCalledWith('c-5', '2026-10-10', 'all', null));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const line = screen.getByRole('status', { name: '' });
    expect(plainText(line.textContent)).toBe('Экзамен перенесён на 10 октября.');
    await waitFor(() => expect(document.activeElement).toBe(line));
    expect(overviewReload).toHaveBeenCalledTimes(1);
    expect(planReload).toHaveBeenCalledTimes(1);
    // The page did not go back to waiting for the plans.
    expect(screen.getByTestId('today-card')).toBeInTheDocument();
  });

  it('the exam-day card’s «Перенести» opens the same dialog for its exam; «Закрыть» changes nothing', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([container('c-1', 'Аккредитация', '2026-10-03')], { 'c-1': dayPlan('exam_today') });
    await renderPage();
    const cardEl = await screen.findByTestId('today-card');
    fireEvent.click(within(cardEl).getByRole('button', { name: 'Перенести' }));
    const dialog = screen.getByRole('dialog', { name: 'Перенести экзамен' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(move.moveExamDate).not.toHaveBeenCalled();
    fireEvent.click(within(cardEl).getByRole('button', { name: 'Перенести' }));
    // The dialog reads the exam first (its members): «Перенести» waits for it.
    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'Перенести' });
    await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(save);
    await waitFor(() => expect(move.moveExamDate).toHaveBeenCalledWith('c-1', '2026-10-10', 'all', null));
  });

  it('which exams count as passed lately: the last date within 14 days, the latest first', () => {
    const today = '2026-10-03';
    const list = [
      container('a', 'Две недели назад', '2026-09-19'),
      container('b', 'Пятнадцать дней назад', '2026-09-18'),
      container('c', 'Вчера', '2026-10-02'),
      container('d', 'Сегодня', '2026-10-03'),
      container('e', 'Без даты', null),
      // One subject passed, another ahead: not passed.
      container('f', 'Частично', null, { subjects: [subjectOf(1, { exam_date: '2026-09-30' }), subjectOf(2, { exam_date: '2026-10-20' })] }),
    ];
    expect(recentlyPassed(list, today).map((entry) => entry.id)).toEqual(['c', 'a']);
    expect(recentlyPassed(list, 'not a day')).toEqual([]);
  });
});

describe('«Сегодня» with exam containers: failures fall back', () => {
  it('a plan that cannot be read: the container is a quiet row and the page is otherwise today’s', async () => {
    seededExam();
    withContainers([ACCR()], { 'c-1': 'fails' });
    await renderPage();
    expect(blues()).toEqual([await screen.findByRole('link', { name: 'Тянуть билет' })]);
    expect(screen.queryByTestId('today-card')).toBeNull();
    const row = within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Аккредитация/ });
    expect(plainText(row.textContent)).toBe('Аккредитация10 октября · 960 вопросов');
  });

  it('planDay throwing, or the card crashing: the same quiet row, never a broken page', async () => {
    seededExam();
    withContainers([ACCR()], { 'c-1': 'broken' });
    const first = await renderPage();
    await screen.findByRole('link', { name: 'Тянуть билет' });
    expect(screen.getByRole('region', { name: 'Другие экзамены' })).toBeInTheDocument();
    first.unmount();
    cleanup();

    card.crash = true;
    withContainers([ACCR()], { 'c-1': dayPlan('study') });
    await renderPage();
    await waitFor(() => expect(screen.queryByTestId('today-card')).toBeNull());
    expect(await screen.findByRole('link', { name: 'Тянуть билет' })).toHaveClass('sf-primary');
    expect(within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Аккредитация/ })).toBeInTheDocument();
  });

  it('a hook that hands over a new plan input on every render: the page settles, it does not render forever', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([ACCR()], {});
    layer.data['c-1'] = () => ({
      data: { summary: {}, planInput: { plan: dayPlan('study') }, items: new Map(), oralWithoutPoints: 0 },
      loading: false,
      offline: false,
      unavailable: false,
      error: null,
      reload: () => undefined,
    });
    await renderPage();
    await screen.findByTestId('today-card');
    const calls = layer.planCalls;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(layer.planCalls).toBe(calls);
    expect(calls).toBeLessThan(12);
  });

  it('a plan slower than the wait: the card leads on what the overview says and fills in later', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([ACCR()], { 'c-1': 'loading' });
    PLAN_WAIT.ms = 40;
    await renderPage();
    const cardEl = await screen.findByTestId('today-card');
    expect(cardEl).toHaveAttribute('data-plan', 'none');
    expect(within(cardEl).getByRole('link', { name: 'Начать' })).toHaveClass('sf-primary');
  });

  it('without network: the card from the device’s copy leads; the rest says it did not load, with a quiet «Повторить»', async () => {
    seededExam();
    db.tables.study_sessions = () => ({ data: null, error: { message: 'Failed to fetch' } });
    withContainers([ACCR()], { 'c-1': dayPlan('study') }, [], true);
    await renderPage();
    const cardEl = await screen.findByTestId('today-card');
    expect(cardEl).toHaveAttribute('data-offline', '');
    expect(screen.getByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(blues()).toEqual([within(cardEl).getByRole('link', { name: 'Начать' })]);
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveClass('sf-link');
  });

  it('without network the card from the device’s copy is drawn at once, while the page’s own reads still try (m5)', async () => {
    seededExam();
    // The page's reads retry for about 7 s without network: here they hang until the test lets them fail.
    let fail: (error: unknown) => void = () => undefined;
    db.countDueCards.mockReturnValue(new Promise((_, reject) => {
      fail = reject;
    }));
    withContainers([ACCR()], { 'c-1': dayPlan('study') }, [], true);
    await renderPage();
    const cardEl = await screen.findByTestId('today-card');
    expect(cardEl).toHaveAttribute('data-offline', '');
    expect(screen.queryByText('Загружаем страницу…')).toBeNull();
    expect(screen.queryByText('Не удалось загрузить данные')).toBeNull();
    expect(blues()).toEqual([within(cardEl).getByRole('link', { name: 'Начать' })]);
    // The reads give up: the rest of the page says so under the card, with a quiet «Повторить».
    await act(async () => {
      fail(new TypeError('Failed to fetch'));
    });
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.getByTestId('today-card')).toBe(cardEl);
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveClass('sf-link');
  });

  it('with the network the page still waits for its reads, as before (m5 changes only the offline page)', async () => {
    seededExam();
    db.countDueCards.mockReturnValue(new Promise(() => undefined));
    withContainers([ACCR()], { 'c-1': dayPlan('study') });
    remember('done');
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Загружаем страницу…')).toBeInTheDocument();
    expect(screen.queryByTestId('today-card')).toBeNull();
  });

  it('the overview answering late: today’s page first, then read again with the containers', async () => {
    db.tables.exams = () => ({ data: [examRow(), examRow({ id: 'e-2', title: 'Экзамен: статистика', exam_date: '2026-10-20' })] });
    let late = false;
    const answer = loadable({ data: { v: 1, day: '2026-10-03', containers: [container('c-1', 'Аккредитация', '2026-10-22')], attached_exam_ids: ['e-1'] } });
    layer.overview = () => (late ? answer() : loadable({ loading: true })());
    layer.data['c-1'] = loadable({ data: { summary: {}, planInput: { plan: dayPlan('study') }, items: new Map(), oralWithoutPoints: 0 } });
    const view = await renderPage();
    // Too slow: today's pick over every exam.
    expect(await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ })).toBeInTheDocument();
    late = true;
    view.rerender(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 2, name: /Статистика/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /Цифровая экономика/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Другие экзамены' })).getByRole('link', { name: /Аккредитация/ })).toBeInTheDocument();
  });
});

describe('«Первые шаги» with the exam container in the database (spec decisions 25, 33)', () => {
  it('a new account: the goal first, an exam into /exams/import or a test into «Быстрая контрольная» (UX audit of 21.10)', async () => {
    db.tables.materials = () => ({ data: [] });
    db.tables.exams = () => ({ data: [] });
    db.countDueCards.mockResolvedValue(0);
    db.getDueCards.mockResolvedValue([]);
    await renderPage({ steps: null });
    const card = (await screen.findByRole('heading', { name: 'Первые шаги' })).closest('section')!;
    const goals = within(card).getAllByRole('listitem');
    expect(goals).toHaveLength(2);
    expect(within(goals[0]).getByRole('heading', { level: 3 })).toHaveTextContent('Готовлюсь к экзамену');
    const exam = within(goals[0]).getByRole('link', { name: 'Новый экзамен' });
    expect(exam).toHaveAttribute('href', '/exams/import');
    expect(exam).toHaveClass('sf-primary');
    expect(within(goals[1]).getByRole('heading', { level: 3 })).toHaveTextContent('Даю тест ученикам');
    const test = within(goals[1]).getByRole('link', { name: 'Быстрая контрольная' });
    expect(test).toHaveAttribute('href', '/tests/quick');
    expect(test).not.toHaveClass('sf-primary');
    expect(within(card).getByRole('link', { name: 'Попробовать на примере' })).toHaveAttribute('href', '/try');
    expect(card.textContent).not.toMatch(/Сделано|Добавьте лекции|Вытяните билет/);
  });

  it('a new account that chose «Даю тест ученикам» in the guide: the test’s door comes first and is the blue pill', async () => {
    db.tables.materials = () => ({ data: [] });
    db.tables.exams = () => ({ data: [] });
    db.countDueCards.mockResolvedValue(0);
    db.getDueCards.mockResolvedValue([]);
    window.localStorage.setItem('meldy_goal:user-1', 'test');
    await renderPage({ steps: null });
    const card = (await screen.findByRole('heading', { name: 'Первые шаги' })).closest('section')!;
    const goals = within(card).getAllByRole('listitem');
    expect(within(goals[0]).getByRole('link', { name: 'Быстрая контрольная' })).toHaveClass('sf-primary');
    expect(within(goals[1]).getByRole('link', { name: 'Новый экзамен' })).not.toHaveClass('sf-primary');
  });

  it('an account with a container only: step 1 is done, so the card is gone and remembered as done', async () => {
    db.tables.exams = () => ({ data: [] });
    withContainers([ACCR()], { 'c-1': dayPlan('study') });
    await renderPage({ steps: null });
    await screen.findByTestId('today-card');
    expect(screen.queryByRole('heading', { name: 'Первые шаги' })).toBeNull();
    expect(window.localStorage.getItem('meldy_first_steps_user-1')).toBe('done');
  });

  it('with oral questions the lecture and ticket steps stay, and never take the blue button from the exam card', async () => {
    seededExam();
    db.fetchQuestionEvents.mockResolvedValue([]);
    withContainers([ACCR()], { 'c-1': dayPlan('study') });
    await renderPage({ steps: null });
    const cardSteps = (await screen.findByRole('heading', { name: 'Первые шаги' })).closest('section')!;
    // The lectures have text (the fixture), so the next step is the ticket.
    expect(within(cardSteps).getAllByRole('listitem').map((step) => plainText(step.querySelector('h3')?.textContent))).toEqual([
      'Добавьте вопросы к экзамену — сделано',
      'Добавьте лекции — сделано',
      'Вытяните билет и ответьте — ещё не сделано',
    ]);
    expect(within(cardSteps).getByText('Сделано 2 из 3')).toBeInTheDocument();
    const examCard = screen.getByTestId('today-card');
    expect(blues()).toEqual([within(examCard).getByRole('link', { name: 'Начать' })]);
    const ticket = within(cardSteps).getByRole('link', { name: /Тянуть билет/ });
    expect(ticket).toHaveAttribute('href', '/exams/e-1/draw');
    expect(ticket).not.toHaveClass('sf-primary');
  });

  it('folding the steps does not move the blue button either', async () => {
    seededExam();
    db.fetchQuestionEvents.mockResolvedValue([]);
    withContainers([ACCR()], { 'c-1': dayPlan('study') });
    await renderPage({ steps: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Свернуть' }));
    expect(blues()).toHaveLength(1);
    expect(blues()[0].closest('[data-testid="today-card"]')).not.toBeNull();
  });

  it('words the steps: three today, one or three with the container', () => {
    const today = { lecture: false, list: true, answer: false, drawExamId: 'e-1' };
    expect(firstStepViews(today).map((view) => view.title)).toEqual(['Вставьте список вопросов к экзамену', 'Добавьте лекции', 'Вытяните билет и ответьте']);
    expect(firstStepsDone(today)).toBe(1);
    const neutral = { ...today, neutral: true, oral: true };
    expect(firstStepViews(neutral).map((view) => view.title)).toEqual(['Добавьте вопросы к экзамену', 'Добавьте лекции', 'Вытяните билет и ответьте']);
    expect(firstStepViews(neutral)[0].action).toEqual({ to: '/exams/import', label: 'Новый экзамен' });
    const testsOnly = { lecture: true, list: false, answer: true, drawExamId: null, neutral: true, oral: false };
    expect(firstStepViews(testsOnly).map((view) => view.key)).toEqual(['list']);
    expect(firstStepsDone(testsOnly)).toBe(0);
  });
});

describe('who leads «Сегодня», as a rule', () => {
  const entry = (c: OverviewContainer, plan: TodayContainer['plan']): TodayContainer => ({ container: c, plan });
  const ready = (state: DayPlan['state']): TodayContainer['plan'] => ({ status: 'ready', plan: dayPlan(state), offline: false });
  const ids = (layout: ReturnType<typeof todayLayout>) => ({
    main: layout.main ? (layout.main.kind === 'oral' ? 'oral' : layout.main.item.container.id) : null,
    leads: layout.mainLeads,
    rows: layout.rows.map((row) => (row.kind === 'oral' ? 'oral' : row.item.container.id)),
  });
  const today = '2026-10-03';

  it('the nearest date with work today leads; ties go to the newer exam', () => {
    const oral = { examDate: '2026-10-15', createdAt: '2026-09-30T09:30:00Z' };
    expect(ids(todayLayout({ oral, containers: [entry(ACCR(), ready('study'))], today }))).toEqual({ main: 'c-1', leads: true, rows: ['oral'] });
    expect(ids(todayLayout({ oral: { ...oral, examDate: '2026-10-05' }, containers: [entry(ACCR(), ready('study'))], today }))).toEqual({ main: 'oral', leads: true, rows: ['c-1'] });
    // The same day: the newer one first.
    const same = container('c-1', 'Аккредитация', '2026-10-15', { created_at: '2026-10-02T00:00:00Z' });
    expect(ids(todayLayout({ oral, containers: [entry(same, ready('study'))], today })).main).toBe('c-1');
    expect(ids(todayLayout({ oral: { ...oral, createdAt: '2026-10-02T12:00:00Z' }, containers: [entry(same, ready('study'))], today })).main).toBe('oral');
    // No date: after every dated exam.
    const undated = container('c-9', 'Без даты', null);
    expect(ids(todayLayout({ oral, containers: [entry(undated, ready('study'))], today }))).toEqual({ main: 'oral', leads: true, rows: ['c-9'] });
  });

  it('on an exam’s own day its card leads without the blue; the done, the unread and the passed are not leads', () => {
    const exam = container('c-1', 'Аккредитация', '2026-10-03');
    expect(ids(todayLayout({ oral: { examDate: '2026-10-15', createdAt: '' }, containers: [entry(exam, ready('exam_today'))], today }))).toEqual({ main: 'c-1', leads: false, rows: ['oral'] });
    expect(ids(todayLayout({ oral: null, containers: [entry(ACCR(), ready('nothing')), entry(WINTER(), ready('done'))], today }))).toEqual({ main: 'c-1', leads: false, rows: ['c-2'] });
    expect(ids(todayLayout({ oral: null, containers: [entry(ACCR(), { status: 'failed' })], today }))).toEqual({ main: null, leads: false, rows: ['c-1'] });
    const passed = container('c-0', 'Летняя', '2026-09-01');
    expect(ids(todayLayout({ oral: null, containers: [entry(passed, ready('after')), entry(passed, { status: 'loading' })], today }))).toEqual({ main: null, leads: false, rows: [] });
    // Before its plan: questions with a key mean work today.
    expect(ids(todayLayout({ oral: null, containers: [entry(ACCR(), { status: 'loading' })], today }))).toEqual({ main: 'c-1', leads: true, rows: [] });
    const empty = container('c-3', 'Пустой', '2026-10-20', { items: 0, subjects: [subjectOf(1, { keyed: 0 })] });
    expect(ids(todayLayout({ oral: null, containers: [entry(empty, { status: 'loading' })], today }))).toEqual({ main: 'c-3', leads: false, rows: [] });
  });

  it('an exam with nothing today — its day off or not — is a quiet row beside the one that leads, never its card (D1)', () => {
    const dayOff: TodayContainer['plan'] = { status: 'ready', plan: dayPlan('nothing', { lines: [{ key: 'day_off', n: [2], day: '2026-10-05' }] }), offline: false };
    const now = new Date(2026, 9, 3, 12);
    // Usability check 2026-10-11, D1: «Зимняя сессия» on its day off had no row while another exam had work.
    const winterOff = entry(WINTER(), dayOff);
    expect(ids(todayLayout({ oral: null, containers: [entry(ACCR(), ready('study')), winterOff], today }))).toEqual({ main: 'c-1', leads: true, rows: ['c-2'] });
    expect(containerRowMeta(winterOff, today, now)).toBe('12 января 2027 · сегодня выходной');
    // The nearer date does not make the day off the card: the exam with work leads.
    expect(ids(todayLayout({ oral: null, containers: [entry(ACCR(), dayOff), entry(WINTER(), ready('study'))], today }))).toEqual({ main: 'c-2', leads: true, rows: ['c-1'] });
    // The oral exam leads: the day off is a row beside it.
    const oral = { examDate: '2026-10-05', createdAt: '2026-09-30T09:30:00Z' };
    expect(ids(todayLayout({ oral, containers: [entry(ACCR(), dayOff)], today }))).toEqual({ main: 'oral', leads: true, rows: ['c-1'] });
    // A study day with nothing to do and nothing done: a row too, with the exam's size.
    expect(ids(todayLayout({ oral: null, containers: [entry(ACCR(), ready('nothing')), entry(WINTER(), ready('study'))], today }))).toEqual({ main: 'c-2', leads: true, rows: ['c-1'] });
    // Nothing to do anywhere: the nearest still leads, without the blue; the others are rows.
    expect(ids(todayLayout({ oral: null, containers: [entry(ACCR(), dayOff), entry(WINTER(), dayOff)], today }))).toEqual({ main: 'c-1', leads: false, rows: ['c-2'] });
  });

  it('words a row and the minutes', () => {
    const now = new Date(2026, 9, 3, 12);
    expect(plainText(containerRowMeta(entry(ACCR(), ready('study')), today, now))).toBe('10 октября · сегодня около 45 минут');
    expect(containerRowMeta(entry(ACCR(), ready('done')), today, now)).toBe('10 октября · на сегодня всё');
    expect(containerRowMeta(entry(container('c-1', 'А', '2026-10-03'), ready('exam_today')), today, now)).toBe('3 октября · сегодня экзамен');
    expect(containerRowMeta(entry(ACCR(), { status: 'failed' }), today, now)).toBe('10 октября · 960 вопросов');
    expect(containerRowMeta(entry(container('c-9', 'Б', null), { status: 'failed' }), today, now)).toBe('960 вопросов');
    // A day off (Saturday 3 October, Пн–Пт): nothing answered — «сегодня выходной», not the size; answered anyway — the
    // day is done. A day with nothing left that is not a day off keeps the size.
    const dayOff = (state: DayPlan['state']): TodayContainer['plan'] =>
      ({ status: 'ready', plan: dayPlan(state, { lines: [{ key: 'day_off', n: [2], day: '2026-10-05' }] }), offline: false });
    expect(containerRowMeta(entry(ACCR(), dayOff('nothing')), today, now)).toBe('10 октября · сегодня выходной');
    expect(containerRowMeta(entry(ACCR(), dayOff('done')), today, now)).toBe('10 октября · на сегодня всё');
    expect(containerRowMeta(entry(container('c-9', 'Б', null), dayOff('nothing')), today, now)).toBe('сегодня выходной');
    expect(containerRowMeta(entry(ACCR(), ready('nothing')), today, now)).toBe('10 октября · 960 вопросов');
    // An exam with an oral part (m6): the size its page says, never the overview's smaller number of questions with variants.
    const oral = container('c-5', 'Проверка удаления', '2026-10-21', {
      items: 34,
      subjects: [subjectOf(1, { oral_exam_id: 'e-9', has_oral: true, keyed: 0, exam_date: '2026-10-21' }), subjectOf(2, { exam_date: '2026-10-21' })],
    });
    expect(containerRowMeta(entry(oral, { status: 'ready', plan: dayPlan('nothing'), offline: false, questions: 54 }), today, now)).toBe('21 октября · 54 вопроса');
    expect(containerRowMeta(entry(oral, { status: 'failed' }), today, now)).toBe('21 октября');
    expect(containerRowMeta(entry(oral, { status: 'loading' }), today, now)).toBe('21 октября');
    expect(plainText(aboutMinutes(60))).toBe('около 1 минуты');
    expect(plainText(aboutMinutes(150))).toBe('около 3 минут');
    expect(plainText(aboutMinutes(1180))).toBe('около 20 минут');
    expect(plainText(aboutMinutes(1240))).toBe('около 20 минут');
    expect(plainText(aboutMinutes(2700))).toBe('около 45 минут');
    expect(plainText(aboutMinutes(20))).toBe('около 1 минуты');
  });
});
