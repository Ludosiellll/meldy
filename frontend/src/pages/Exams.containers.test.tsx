/**
 * «Экзамены» and the exam container (spec decisions 2, 28, 31, 48; Concept 1 §3.1).
 *
 * Part 1 — today's page to the byte. The DOM of «Экзамены» for accounts without containers was recorded from the code
 * before the container work (src/pages/__snapshots__/exams/*.html). Every way the container layer can answer — no
 * containers, no container functions in the database, a read error, no answer at all, a crash — must give exactly that
 * DOM again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { LAYER_WAIT } from './containerLayer';

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

/** React re-throws a caught render error once in development; jsdom would print it for the crash variant. */
const quiet = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  // The layer waits this long for an answer before it draws today's page.
  LAYER_WAIT.ms = 40;
  window.addEventListener('error', quiet);
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mocks.listExams.mockReset();
  mocks.fetchQuestionEvents.mockReset().mockResolvedValue([]);
  layer.overview = LAYER_VARIANTS['no containers'];
});

afterEach(() => {
  cleanup();
  window.removeEventListener('error', quiet);
  LAYER_WAIT.ms = 2500;
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

// ------------------------------------------------------------------------------------------------
// Part 2 — accounts with exam containers.

import { within } from '@testing-library/react';
import type { OverviewContainer, OverviewSubject } from '../types/container';
import {
  containerDateLine,
  containerDays,
  containerFigure,
  containerFigureLine,
  containerQuestions,
  containerSizeLine,
  listRows,
} from './Exams';

const plain = (text: string | null | undefined) => (text ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

function subject(n: number, overrides: Partial<OverviewSubject> = {}): OverviewSubject {
  return {
    id: `s-${n}`,
    position: n,
    title: ['Программирование на C#', 'Базы данных', 'Компьютерные сети', 'Операционные системы'][n - 1] ?? `Предмет ${n}`,
    exam_date: '2026-10-22',
    oral_exam_id: null,
    has_oral: false,
    keyed: 240,
    no_key: 0,
    seen: 0,
    two_days: 0,
    open_errors: 0,
    seen_today: 0,
    doubted: 0,
    stale: 0,
    ...overrides,
  };
}

/** «Аккредитация»: 4 × 240 questions with a key on 22 October; 410 seen, 143 «верно в два разных дня». */
function accreditation(overrides: Partial<OverviewContainer> = {}): OverviewContainer {
  return {
    id: 'c-1',
    title: 'Аккредитация',
    exam_date: '2026-10-22',
    created_at: '2026-10-01T10:00:00Z',
    role: 'owner',
    items: 960,
    items_updated_at: '2026-10-01T10:05:00Z',
    subjects: [
      subject(1, { seen: 180, two_days: 61 }),
      subject(2, { seen: 120, two_days: 40 }),
      subject(3, { seen: 60, two_days: 22 }),
      subject(4, { seen: 50, two_days: 20 }),
    ],
    answers_today: 20,
    settings: null,
    ...overrides,
  };
}

/** «Зимняя сессия»: one subject with variants (12 января) and one oral subject (20 января), the oral part an exam of 60. */
function winter(): OverviewContainer {
  return {
    id: 'c-2',
    title: 'Зимняя сессия',
    exam_date: null,
    created_at: '2026-09-20T10:00:00Z',
    role: 'member',
    items: 240,
    items_updated_at: null,
    subjects: [subject(1, { exam_date: '2027-01-12' }), subject(2, { title: 'История', exam_date: '2027-01-20', keyed: 0, oral_exam_id: 'exam-oral', has_oral: true })],
    answers_today: 0,
    settings: null,
  };
}

const ORAL_HASHES = Array.from({ length: 60 }, (_, index) => hash(500 + index));

function mixedAccount() {
  mocks.listExams.mockResolvedValue([
    item(),
    item({ id: 'exam-2', title: 'Макроэкономика', kind: 'credit', exam_date: null, created_at: '2026-09-02T00:00:00Z', mapping_state: 'none', mapped_at: null, total: 25, coverage: { full: 0, partial: 0, none: 0, unverified: 0, unmapped: 25 }, hashes: [] }),
    item({ id: 'exam-3', title: 'История экономических учений', kind: 'colloquium', exam_date: '2026-09-13', total: 12, coverage: { full: 8, partial: 0, none: 4, unverified: 0, unmapped: 0 }, hashes: [] }),
    // The oral part of «Зимняя сессия»: shown inside it, never as a row of its own.
    item({ id: 'exam-oral', title: 'История', exam_date: '2027-01-20', total: 60, hashes: ORAL_HASHES }),
  ]);
  mocks.fetchQuestionEvents.mockResolvedValue(Array.from({ length: 6 }, (_, index) => passes(index + 1)).flat());
  layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [winter(), accreditation()], attached_exam_ids: ['exam-oral'] } });
}

async function renderMixed() {
  render(
    <MemoryRouter initialEntries={['/exams']}>
      <Routes>
        <Route path="/exams" element={<Exams />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByRole('list', { name: 'Ваши экзамены' });
}

describe('«Экзамены» with exam containers', () => {
  it('lists containers and plain exams together by date; an exam inside a container is not a row', async () => {
    mixedAccount();
    const list = await renderMixed();
    const links = within(list).getAllByRole('link').filter((link) => link.classList.contains('ex-row'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/exams/exam-1', '/exams/c/c-1', '/exams/c/c-2', '/exams/exam-2', '/exams/exam-3']);
    expect(within(list).queryByRole('link', { name: /^История\b/ })).toBeNull();
    // «Новый экзамен» leads straight to the one door.
    expect(screen.getByRole('link', { name: 'Новый экзамен' })).toHaveAttribute('href', '/exams/import');
  });

  it('reads «подтверждено» for the plain exams only: no hash of an exam inside a container is sent', async () => {
    mixedAccount();
    await renderMixed();
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalledTimes(1));
    const hashes = mocks.fetchQuestionEvents.mock.calls[0][0] as string[];
    expect(hashes).toHaveLength(40);
    expect(hashes.some((sent) => ORAL_HASHES.includes(sent))).toBe(false);
    const first = await screen.findByRole('link', { name: /^Микроэкономика/ });
    await waitFor(() => expect(plain(first.textContent)).toContain('подтверждено 6'));
  });

  it('a computer: the name, one meta line with the subjects and the figure, the bar, no pill', async () => {
    mixedAccount();
    const list = await renderMixed();
    const card = within(list).getByRole('link', { name: /^Аккредитация/ }).closest('li')!;
    expect(plain(card.querySelector('.ex-row-title')?.textContent)).toBe('Аккредитация');
    expect(plain(card.querySelector('.ex-row-meta')?.textContent)).toBe('22 октября, через 19 дней · 4 предмета, 960 вопросов · верно в два разных дня: 143 из 960');
    const bar = card.querySelector('.ex-bar')!;
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(Array.from(bar.querySelectorAll('i')).map((part) => [part.getAttribute('data-k'), (part as HTMLElement).style.flexGrow])).toEqual([
      ['full', '143'],
      ['seen', '267'],
      ['unmapped', '550'],
    ]);
    expect(within(card).queryByRole('link', { name: /Тянуть билет/ })).toBeNull();
    expect(card.querySelector('.sf-primary')).toBeNull();
    // Several dates ahead: «с …»; the oral part's 60 questions count in the size, not in the figure; before any
    // answer there is no bar.
    const second = within(list).getByRole('link', { name: /^Зимняя сессия/ }).closest('li')!;
    expect(plain(second.querySelector('.ex-row-meta')?.textContent)).toBe('с 12 января 2027, через 101 день · 2 предмета, 300 вопросов');
    expect(second.querySelector('.ex-bar')).toBeNull();
  });

  it('a phone: one meta line «дата, через N дней · N вопросов», the bar, then «Верно в два разных дня: 143 из 960»', async () => {
    setPhone();
    mixedAccount();
    const list = await renderMixed();
    const card = within(list).getByRole('link', { name: /^Аккредитация/ }).closest('li')!;
    expect(plain(card.querySelector('.ex-row-meta')?.textContent)).toBe('22 октября, через 19 дней · 960 вопросов');
    expect(plain(card.querySelector('.ex-row-counts')?.textContent)).toBe('Верно в два разных дня: 143 из 960');
    const bar = card.querySelector('.ex-bar')!;
    expect(bar.compareDocumentPosition(card.querySelector('.ex-row-counts')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The oral rows keep today's phone lines.
    const oral = within(list).getByRole('link', { name: /^Микроэкономика/ }).closest('li')!;
    expect(plain(oral.querySelector('.ex-row-meta')?.textContent)).toBe('15 октября, через 12 дней');
    await waitFor(() => expect(plain(oral.querySelector('.ex-row-counts')?.textContent)).toBe('В лекциях: есть 24 · частично 7 · нет 9 · подтверждено 6'));
  });

  it('an account with containers only: «Новый экзамен» is there, no empty page', async () => {
    mocks.listExams.mockResolvedValue([]);
    layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [accreditation()], attached_exam_ids: [] } });
    const list = await renderMixed();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Новый экзамен' })).toHaveAttribute('href', '/exams/import');
    // «Новый тест» (spec 2026-10-18 §47.2) beside it, a white pill too: the page keeps no blue pill at the top.
    const entry = screen.getByRole('link', { name: 'Новый тест' });
    expect(entry).toHaveAttribute('href', '/tests/new');
    expect(entry).toHaveClass('ex-secondary');
    const door = screen.getByRole('link', { name: 'Новый экзамен' });
    expect(entry.closest('[data-pair]')).not.toBeNull();
    expect(entry.closest('[data-pair]')).toBe(door.closest('[data-pair]'));
    // Each door says in one quiet line what it makes (release 47, M11).
    expect(door).toHaveAccessibleDescription('Для себя: план по вопросам и лекциям');
    expect(entry).toHaveAccessibleDescription('Для учеников: по ссылке, можно без входа');
    expect(screen.queryByRole('heading', { name: 'Загрузите вопросы к экзамену' })).toBeNull();
    expect(mocks.fetchQuestionEvents).not.toHaveBeenCalled();
  });

  it('without network draws the containers from the device’s copy and says in one quiet line the rest did not load', async () => {
    mocks.listExams.mockRejectedValue(new Error('Failed to fetch'));
    layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [accreditation()], attached_exam_ids: [] }, offline: true });
    const list = await renderMixed();
    expect(within(list).getByRole('link', { name: /^Аккредитация/ })).toHaveAttribute('href', '/exams/c/c-1');
    const line = await screen.findByText(/^Остальные экзамены не загрузились\./);
    expect(line).toHaveClass('exc-rest');
    expect(screen.queryByRole('heading', { name: 'Не удалось загрузить экзамены' })).toBeNull();
    expect(list.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // «Повторить» reads the other exams again.
    mocks.listExams.mockClear();
    within(line).getByRole('button', { name: 'Повторить' }).click();
    await waitFor(() => expect(mocks.listExams).toHaveBeenCalledTimes(1));
  });

  it('without network the containers’ rows come at once, before the other exams’ read gives up (m5)', async () => {
    mocks.listExams.mockReturnValue(new Promise(() => undefined));
    layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [accreditation()], attached_exam_ids: [] }, offline: true });
    const list = await renderMixed();
    expect(within(list).getByRole('link', { name: /^Аккредитация/ })).toHaveAttribute('href', '/exams/c/c-1');
    expect(screen.queryByText('Загружаем экзамены…')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Новый экзамен' })).toHaveAttribute('href', '/exams/import');
  });

  it('with the network the rows still wait for the other exams, as before', async () => {
    mocks.listExams.mockReturnValue(new Promise(() => undefined));
    layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [accreditation()], attached_exam_ids: [] } });
    render(
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route path="/exams" element={<Exams />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.queryByRole('list', { name: 'Ваши экзамены' })).toBeNull();
    expect(screen.getByText('Загружаем экзамены…')).toBeInTheDocument();
  });

  it('a read error of the other exams with the network: the containers’ rows and the same quiet line', async () => {
    mocks.listExams.mockRejectedValue(new Error('boom'));
    layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [accreditation()], attached_exam_ids: [] } });
    await renderMixed();
    expect(await screen.findByText(/^Остальные экзамены не загрузились\./)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Не удалось загрузить экзамены' })).toBeNull();
  });

  it('waits for the layer before any row: an exam inside a container never flashes as a row of its own', async () => {
    mixedAccount();
    let answer: () => unknown = loadable({ loading: true });
    layer.overview = () => answer();
    LAYER_WAIT.ms = 5000;
    const view = render(
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route path="/exams" element={<Exams />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.queryByRole('list', { name: 'Ваши экзамены' })).toBeNull();
    answer = loadable({ data: { v: 1, day: '2026-10-03', containers: [winter()], attached_exam_ids: ['exam-oral'] } });
    view.rerender(
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route path="/exams" element={<Exams />} />
        </Routes>
      </MemoryRouter>,
    );
    const list = await screen.findByRole('list', { name: 'Ваши экзамены' });
    expect(within(list).queryByRole('link', { name: /^История\b/ })).toBeNull();
  });
});

describe('«Экзамены» empty, with the exam container in the database (Concept 1 §3.1)', () => {
  const ua = navigator.userAgent;
  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: ua });
  });

  async function renderEmpty() {
    mocks.listExams.mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route path="/exams" element={<Exams />} />
        </Routes>
      </MemoryRouter>,
    );
    return screen.findByRole('heading', { name: 'Загрузите вопросы к экзамену' });
  }

  it('one door: «Выбрать файлы» and «Вставить список текстом» into the import page, the example one link away', async () => {
    await renderEmpty();
    expect(screen.getByText('Один общий файл или по файлу на предмет. С вариантами ответов Meldy возьмёт ключ из файла, а без вариантов напишет шпаргалку по вашим лекциям.')).toBeInTheDocument();
    const files = screen.getByRole('link', { name: 'Выбрать файлы' });
    expect(files).toHaveAttribute('href', '/exams/import');
    expect(files).toHaveClass('sf-primary');
    expect(screen.getByRole('link', { name: 'Вставить список текстом' })).toHaveAttribute('href', '/exams/import');
    expect(screen.getByRole('link', { name: 'Попробовать на примере' })).toHaveAttribute('href', '/try');
    // No second entry at the top (design critique I14), no old editor, no «150».
    expect(screen.queryByRole('link', { name: 'Новый экзамен' })).toBeNull();
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/кафедр|150|Вставить список вопросов/);
    // Not an iPhone: no Telegram line.
    expect(screen.queryByText(/Telegram/)).toBeNull();
  });

  it('a phone: one line of lede; an iPhone adds the Telegram line', async () => {
    setPhone();
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1' });
    await renderEmpty();
    expect(screen.getByText('Один общий файл или по файлу на предмет.')).toBeInTheDocument();
    expect(plain(screen.getByText(/Telegram/).textContent)).toBe('Файл из Telegram сначала сохраните в «Файлы».');
  });
});

describe('a container row’s words', () => {
  const now = new Date(2026, 9, 3, 12, 0);
  it('dates a container: the nearest date ahead, «с» for several, the last one passed, or none', () => {
    expect(containerDateLine(accreditation(), now)).toBe('22 октября, через 19 дней');
    expect(containerDateLine(winter(), now)).toBe('с 12 января 2027, через 101 день');
    expect(containerDateLine(accreditation({ subjects: [subject(1, { exam_date: '2026-10-03' })] }), now)).toBe('3 октября, сегодня');
    expect(containerDateLine(accreditation({ subjects: [subject(1, { exam_date: '2026-09-28' }), subject(2, { exam_date: '2026-09-30' })] }), now)).toBe('Экзамен прошёл 30 сентября');
    expect(containerDateLine(accreditation({ exam_date: null, subjects: [subject(1, { exam_date: null })] }), now)).toBe('Дата не указана');
    // No subjects yet: the container's own date.
    expect(containerDays({ exam_date: '2026-10-28', subjects: [] }, '2026-10-03')).toEqual({ day: '2026-10-28', several: false, past: false });
  });

  it('counts the questions with the oral parts, and the figure over the questions with a key only', () => {
    expect(containerQuestions(winter(), new Map([['exam-oral', 60]]))).toBe(300);
    expect(containerQuestions(winter(), new Map())).toBe(240);
    expect(containerSizeLine(winter(), 300, true)).toBe('2 предмета, 300 вопросов');
    expect(containerSizeLine(winter(), 300, false)).toBe('300 вопросов');
    expect(containerSizeLine(accreditation({ subjects: [subject(1)] }), 241, true)).toBe('241 вопрос');
    expect(containerSizeLine(winter(), 0, true)).toBe('вопросов пока нет');
    expect(containerFigure(accreditation())).toEqual({ twoDays: 143, seen: 410, keyed: 960 });
    expect(containerFigure(winter())).toBeNull();
    expect(containerFigureLine({ twoDays: 143, seen: 410, keyed: 960 })).toBe('Верно в два разных дня: 143 из 960');
    expect(containerFigureLine({ twoDays: 0, seen: 60, keyed: 960 })).toBe('Верно в два разных дня: 0 из 960 · видели 60');
  });

  it('orders the list as listExams does: dates ahead, then without a date (newest first), then the past', () => {
    const exams = [
      item({ id: 'ahead', exam_date: '2026-10-20', created_at: '2026-09-01T00:00:00Z' }),
      item({ id: 'undated-new', exam_date: null, created_at: '2026-09-25T00:00:00Z' }),
      item({ id: 'undated-old', exam_date: null, created_at: '2026-09-02T00:00:00Z' }),
      item({ id: 'past', exam_date: '2026-09-20', created_at: '2026-09-01T00:00:00Z' }),
    ];
    const ids = (rows: ReturnType<typeof listRows>) => rows.map((row) => (row.kind === 'exam' ? row.item.id : `c:${row.container.id}`));
    // Without containers the plain order is kept as it is.
    expect(ids(listRows(exams, [], '2026-10-03'))).toEqual(['ahead', 'undated-new', 'undated-old', 'past']);
    const undated = accreditation({ id: 'none', exam_date: null, created_at: '2026-09-10T00:00:00Z', subjects: [subject(1, { exam_date: null })] });
    const passed = accreditation({ id: 'gone', exam_date: null, subjects: [subject(1, { exam_date: '2026-09-25' })] });
    expect(ids(listRows(exams, [winter(), accreditation(), undated, passed], '2026-10-03'))).toEqual([
      'ahead',
      'c:c-1',
      'c:c-2',
      'undated-new',
      'c:none',
      'undated-old',
      'c:gone',
      'past',
    ]);
  });
});

describe('«Экзамены»: the author’s own test and the line after «Удалить» (release 47.3)', () => {
  const tests = () => {
    mocks.listExams.mockResolvedValue([]);
    const questions = [subject(1, { title: 'Вопросы', exam_date: null, keyed: 10, no_key: 2 })];
    const own = accreditation({ id: 'c-t', title: 'Кислоты и основания', kind: 'test', exam_date: null, items: 12, subjects: questions });
    const theirs = accreditation({ id: 'c-m', title: 'Тест соседа', kind: 'test', role: 'member', exam_date: null, items: 12, subjects: questions });
    layer.overview = loadable({ data: { v: 1, day: '2026-10-03', containers: [own, theirs, accreditation()], attached_exam_ids: [] } });
  };

  it('the author’s own test says «Тест · 12 вопросов» and opens the test’s page; a member’s test is a row to study', async () => {
    tests();
    const list = await renderMixed();
    const own = within(list).getByRole('link', { name: /^Кислоты и основания/ });
    expect(own).toHaveAttribute('href', '/exams/c/c-t');
    const card = own.closest('li')!;
    expect(plain(card.querySelector('.ex-row-meta')?.textContent)).toBe('Тест · 12 вопросов');
    expect(card.querySelector('.ex-bar')).toBeNull();
    expect(card).toHaveAttribute('data-kind', 'test');
    const theirs = within(list).getByRole('link', { name: /^Тест соседа/ }).closest('li')!;
    expect(plain(theirs.querySelector('.ex-row-meta')?.textContent)).toBe('Дата не указана · 12 вопросов');
    expect(theirs).not.toHaveAttribute('data-kind');
  });

  it('says the line the exam’s page handed over, once, with the focus', async () => {
    tests();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/exams', state: { notice: 'Экзамен «Аккредитация» удалён.' } }]}>
        <Routes>
          <Route path="/exams" element={<Exams />} />
        </Routes>
      </MemoryRouter>,
    );
    const line = await screen.findByText('Экзамен «Аккредитация» удалён.');
    expect(line).toHaveAttribute('role', 'status');
    expect(document.activeElement).toBe(line);
  });
});
