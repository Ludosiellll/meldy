import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { LearningEvent } from '../api/learning';
import type { DueCard } from '../api/flashcards';
import Dashboard, {
  activityLine,
  answersSentence,
  cardsMissingFromReview,
  dueLecturesText,
  dueLine,
  erasableShort,
  examFlag,
  examHeading,
  examHeadingParts,
  examMeta,
  examMetaShort,
  examWhen,
  firstStepViews,
  firstStepsDone,
  greeting,
  lectureMeta,
  lectureMetaShort,
  lecturePlace,
  pickExam,
  recentNote,
  reviewTime,
  shareFigure,
  shareSentence,
  startGreeting,
  todayLine,
  withoutMaterialLine,
  type TodayQuestion,
} from './Dashboard';
import { PHONE_QUERY } from '../lib/usePhone';
import { localDateKey } from '../utils/streak';
import { rememberGroupLink } from '../lib/groups/groupLinks';
import { sha256Hex } from '../lib/sha256';

type TableResult = { data?: unknown; error?: unknown };
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
// The exam's cheat sheet (GET /api/oral/sheet): empty unless a test writes one.
vi.mock('../api/cheatSheet', () => ({ fetchSheet: (...args: unknown[]) => db.fetchSheet(...args) }));
// A database without the exam container's functions: today's «Сегодня» (package D1's hook; the container cases and the
// same page with no containers are in Dashboard.containers.test.tsx).
vi.mock('../lib/containers/hooks', () => ({
  useContainersOverview: () => ({ data: null, loading: false, offline: false, unavailable: true, error: null, reload: () => undefined }),
  useContainerData: () => ({ data: null, loading: false, offline: false, unavailable: true, error: null, reload: () => undefined }),
}));

// ------------------------------------------------------------------------------------------------
// Fixtures: Saturday, 3 October 2026; the seeded list of 40 questions in two sections
// (24 есть · 7 частично · 9 нет), the exam on 15 October.

const NOW = new Date(2026, 9, 3, 12, 0);
const TODAY = '2026-10-03';
const NONE = new Set([5, 8, 17, 22, 26, 29, 35, 38, 40]);
const PARTIAL = new Set([3, 9, 14, 19, 24, 33, 37]);
const hash = (position: number) => position.toString(16).padStart(32, '0');

function questionRows(coverageOf: (position: number) => string | null = (p) => (NONE.has(p) ? 'none' : PARTIAL.has(p) ? 'partial' : 'full')) {
  return Array.from({ length: 40 }, (_, index) => {
    const position = index + 1;
    return { id: `q${position}`, exam_id: 'e-1', position, label: String(position), section: position <= 20 ? 1 : 2, question_hash: hash(position), coverage: coverageOf(position) };
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

/** An answer at a local wall-clock time of October (day < 1 goes back into September). */
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

/** Question 23 confirmed yesterday (25 h after its first pass), question 31 confirmed last week, question 7 answered last. */
const HISTORY = [
  answer(31, -2, 10, 4, 'a1'),
  answer(31, -1, 12, 5, 'a2'),
  answer(23, 1, 10, 4, 'a3'),
  answer(23, 2, 11, 5, 'a4'),
  answer(7, 2, 12, 4, 'a5'),
];

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

const plain = (text: string | null | undefined) => (text ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

/** An accessible name equal to `text` once no-break spaces are plain spaces (the page typesets with them). */
const named = (text: string) => (name: string) => plain(name) === text;

/** An element whose own text (spaces normalised) is exactly `text`. */
function byText(text: string) {
  return (_: string, node: Element | null) =>
    Boolean(node) && plain(node!.textContent) === text && Array.from(node!.children).every((child) => plain(child.textContent) !== text);
}

function args(table: string, method: string): unknown[][] {
  return db.queries.filter((query) => query.table === table).flatMap((query) => query.calls.filter(([name]) => name === method).map(([, a]) => a));
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

const exam = (overrides: Record<string, unknown> = {}) => {
  db.tables.exams = () => ({ data: [examRow(overrides)] });
};

let innerWidth: number;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  innerWidth = window.innerWidth;
  window.localStorage.clear();
  db.queries.length = 0;
  for (const table of Object.keys(db.tables)) delete db.tables[table];
  db.user = { id: 'user-1', user_metadata: { full_name: 'Алина Соколова' } };
  db.tables.materials = (query: Query | { select: string }) => ({ data: query.select.includes('summary_json') ? LECTURES : LECTURES.map(({ id, title, created_at }) => ({ id, title, created_at })) });
  db.tables.flashcard_progress = () => ({ data: [{ material_id: 'm1' }, { material_id: 'm3' }, { material_id: 'm4' }] });
  db.tables.exam_questions = () => ({ data: questionRows() });
  db.countDueCards.mockReset().mockResolvedValue(11);
  db.getDueCards.mockReset().mockResolvedValue(dueCards());
  db.syncFlashcards.mockReset().mockResolvedValue({ inserted: 1, skipped: 0 });
  db.fetchQuestionEvents.mockReset().mockResolvedValue(HISTORY);
  db.fetchSheet.mockReset().mockResolvedValue({ examId: 'e-1', mappingState: 'done', questions: [], toWrite: 0, units: 0, job: null });
  db.fetchSheetEvents.mockReset().mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: innerWidth });
});

// ------------------------------------------------------------------------------------------------

describe('«Сегодня»: the header', () => {
  it('dates the page and greets by the first name, the first letter capitalised in code', async () => {
    exam();
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 1, name: named('Алина, что повторим?') })).toBeInTheDocument();
    expect(screen.getByText('Суббота, 3 октября')).toBeInTheDocument();
    // No caps eyebrow, no «Добавить материал» pill: the top bar has «Разобрать лекцию».
    expect(screen.queryByText(/^Сегодня,/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Добавить материал/)).not.toBeInTheDocument();
  });

  it('asks without a name when the account has none', async () => {
    db.user = { id: 'user-1', user_metadata: {} };
    exam();
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 1, name: named('Что повторим сегодня?') })).toBeInTheDocument();
  });

  it('words the date, the greeting and the time to the exam', () => {
    expect(todayLine(new Date(2026, 9, 3, 9))).toBe('Суббота, 3 октября');
    expect(todayLine(new Date(2026, 9, 5, 9))).toBe('Понедельник, 5 октября');
    expect(greeting('  Алина   Соколова ')).toBe('Алина, что повторим?');
    expect(greeting('')).toBe('Что повторим сегодня?');
    expect(greeting(undefined)).toBe('Что повторим сегодня?');
    expect(examWhen(0)).toBe('сегодня');
    expect(examWhen(1)).toBe('завтра');
    expect(examWhen(2)).toBe('через 2 дня');
    expect(examWhen(21)).toBe('через 21 день');
  });
});

describe('«Сегодня»: the exam on the desk', () => {
  it('builds the heading from the subject and the kind, never repeating the kind and without a period', () => {
    expect(examHeading({ title: 'Экзамен: цифровая экономика', kind: 'exam', daysLeft: 12 })).toBe('Цифровая экономика — экзамен через 12 дней');
    expect(examHeading({ title: 'Микроэкономика', kind: 'exam', daysLeft: 12 })).toBe('Микроэкономика — экзамен через 12 дней');
    expect(examHeading({ title: 'Зачёт. Финансы', kind: 'credit', daysLeft: 1 })).toBe('Финансы — зачёт завтра');
    expect(examHeading({ title: 'Экзамен по микроэкономике', kind: 'exam', daysLeft: 0 })).toBe('Экзамен по микроэкономике — сегодня');
    // Without a date: the sheet's own header.
    expect(examHeading({ title: 'Экзамен: цифровая экономика', kind: 'exam', daysLeft: null })).toBe('Цифровая экономика: вопросы к экзамену');
    // The card sets the subject large and shows the rest on its flag.
    expect(examHeadingParts({ title: 'Экзамен: цифровая экономика', kind: 'exam', daysLeft: 12 })).toEqual({ subject: 'Цифровая экономика', when: 'экзамен через 12 дней' });
    expect(examHeadingParts({ title: 'Экзамен по микроэкономике', kind: 'exam', daysLeft: 0 })).toEqual({ subject: 'Экзамен по микроэкономике', when: 'сегодня' });
    expect(examHeadingParts({ title: 'Экзамен: цифровая экономика', kind: 'exam', daysLeft: null })).toEqual({ subject: 'Цифровая экономика: вопросы к экзамену', when: null });
    expect(examFlag('экзамен через 12 дней')).toBe('Экзамен через 12 дней');
    expect(examFlag('сегодня')).toBe('Сегодня');
    expect(examMeta({ examDate: '2026-10-15', layout: { mode: 'random', per_ticket: 2 }, total: 40 })).toBe('15 октября · 40 вопросов, в билете два');
    expect(examMeta({ examDate: null, layout: { mode: 'sections', per_ticket: 2 }, total: 40 })).toBe('40 вопросов, в билете по вопросу из каждого раздела');
  });

  it('leads with the seeded exam: flag, heading, meta, the actions, then «9 вопросов без материала», share, ribbon, legend, answers, note', async () => {
    exam();
    renderDashboard();
    const heading = await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') });
    expect(document.title).toBe('Сегодня — Meldy');
    expect(heading.textContent).not.toMatch(/Экзамен:|\.$/);
    const block = heading.closest('article')!;
    // The flag shows the end of the heading; screen readers read it in the heading.
    const flag = within(block).getByText('Экзамен через 12 дней');
    expect(flag).toHaveAttribute('aria-hidden', 'true');
    expect(flag.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).getByText(byText('15 октября · 40 вопросов, в билете два'))).toBeInTheDocument();

    const gap = within(block).getByRole('link', { name: named('9 вопросов без материала') });
    expect(gap).toHaveAttribute('href', '/exams/e-1?filter=cov:none');
    expect(within(block).getByText(byText('Добавьте к ним лекции. После сверки с ними они снова будут в тренировке.'))).toBeInTheDocument();

    const ribbon = within(block).getByRole('img', { name: /Пометки у 40 вопросов списка/ });
    const legend = within(block).getByText(byText('24 есть в лекциях, 7 частично, 9 нет ни в одной'));
    const share = within(block).getByText(byText('35 % билетов, где оба вопроса есть в ваших лекциях'));
    const answers = within(block).getByText(byText('Выучено 2 вопроса из 40.'));
    const note = within(block).getByText(byText('Вчера: ответ на вопрос 7. Вопрос 23 выучен.'));
    const draw = within(block).getByRole('link', { name: named('Тянуть билет') });
    const sheet = within(block).getByRole('link', { name: named('Лист экзамена') });
    expect(draw).toHaveAttribute('href', '/exams/e-1/draw');
    expect(draw).toHaveClass('sf-primary');
    expect(sheet).toHaveAttribute('href', '/exams/e-1');

    // Reading order: the next step right under the meta, so it is on the first screen at every size (audit of 2026-10-08:
    // below the readiness it stood at y 1053 in a 734 px window); then the gap, the share, the ribbon, the legend, the
    // answers and the note.
    const meta = within(block).getByText(byText('15 октября · 40 вопросов, в билете два'));
    const order = [heading, meta, draw, sheet, gap, share, ribbon, legend, answers, note];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // One tactile primary on the screen.
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(args('exam_questions', 'eq')).toEqual([['exam_id', 'e-1']]);
    expect(db.fetchQuestionEvents).toHaveBeenCalledWith(Array.from({ length: 40 }, (_, i) => hash(i + 1)), ['exam_answer']);
  });

  it('adds «Шпаргалка: N строк осталось из M» once the cheat sheet has lines, into its view', async () => {
    exam();
    const written = (position: number) => ({
      question_id: `q${position}`,
      position,
      label: String(position),
      section: null,
      text: `Вопрос ${position}`,
      question_hash: hash(position),
      coverage: 'full',
      coverage_method: 'llm',
      coverage_reason: '',
      missing_note: '',
      rebuilt: false,
      rubric: {
        rubric_id: `r${position}`,
        built_at: null,
        coverage: 'full',
        coverage_note: '',
        materials: [],
        points: [1, 2, 3].map((n) => ({ id: `p${n}`, title: `Пункт ${n} вопроса ${position}`, short: '', essential: n === 1, source_quote: '', source_ids: [] })),
      },
    });
    // Point 1 of question 1 named on two days: erased; one line of six is gone.
    const named = (day: number, session: string) => ({
      id: `${session}-p1`,
      created_at: new Date(2026, 9, day, 10, 0).toISOString(),
      local_date: localDateKey(new Date(2026, 9, day, 10, 0)),
      material_id: null,
      kind: 'oral_point',
      item_key: 'oral:r1:p1',
      correct: true,
      score: null,
      confidence: null,
      source_ids: [],
      session_id: session,
      payload: { v: 1, question_hash: hash(1), rubric_id: 'r1', point_id: 'p1', title: 'Пункт 1 вопроса 1', status: 'covered' },
    });
    db.fetchSheet.mockResolvedValue({ examId: 'e-1', mappingState: 'done', questions: [written(1), written(2)], toWrite: 0, units: 0, job: null });
    db.fetchSheetEvents.mockResolvedValue([named(1, 's-a'), named(2, 's-b')]);
    renderDashboard();
    const heading = await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ });
    const block = heading.closest('article')!;
    const line = await within(block).findByRole('link', { name: (name) => plain(name) === 'Шпаргалка: 5 строк осталось из 6' });
    expect(line).toHaveAttribute('href', '/exams/e-1?view=sheet');
    expect(db.fetchSheet).toHaveBeenCalledWith('e-1');
    expect(db.fetchSheetEvents).toHaveBeenCalledWith([hash(1), hash(2)]);
    // Under the next step, which leads the card; still one tactile primary.
    const draw = within(block).getByRole('link', { name: (name) => plain(name) === 'Тянуть билет' });
    expect(draw.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('has no cheat sheet line before anything is written, or when the sheet cannot be read', async () => {
    exam();
    renderDashboard();
    const heading = await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ });
    await waitFor(() => expect(db.fetchSheet).toHaveBeenCalledWith('e-1'));
    expect(within(heading.closest('article')!).queryByRole('link', { name: /Шпаргалка/ })).toBeNull();
    expect(db.fetchSheetEvents).not.toHaveBeenCalled();
    cleanup();
    db.fetchSheet.mockRejectedValue(new Error('offline'));
    renderDashboard();
    const again = await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ });
    await waitFor(() => expect(db.fetchSheet).toHaveBeenCalledTimes(2));
    expect(within(again.closest('article')!).queryByRole('link', { name: /Шпаргалка/ })).toBeNull();
  });

  describe('«Сегодня-lite»: the lines an answer can erase today, over the draw «Ждут подтверждения»', () => {
    const written = (position: number) => ({
      question_id: `q${position}`,
      position,
      label: String(position),
      section: null,
      text: `Вопрос ${position}`,
      question_hash: hash(position),
      coverage: 'full',
      coverage_method: 'llm',
      coverage_reason: '',
      missing_note: '',
      rebuilt: false,
      rubric: {
        rubric_id: `r${position}`,
        built_at: null,
        coverage: 'full',
        coverage_note: '',
        materials: [],
        points: [1, 2, 3].map((n) => ({ id: `p${n}`, title: `Пункт ${n} вопроса ${position}`, short: '', essential: n === 1, source_quote: '', source_ids: [] })),
      },
    });
    /** Point 1 of a question named in an answer at a local moment. */
    const named = (position: number, at: Date) => ({
      id: `e-${position}-${at.getTime()}`,
      created_at: at.toISOString(),
      local_date: localDateKey(at),
      material_id: null,
      kind: 'oral_point',
      item_key: `oral:r${position}:p1`,
      correct: true,
      score: null,
      confidence: null,
      source_ids: [],
      session_id: `s-${position}-${at.getTime()}`,
      payload: { v: 1, question_hash: hash(position), rubric_id: `r${position}`, point_id: 'p1', title: `Пункт 1 вопроса ${position}`, status: 'covered' },
    });
    const sheetOf = (events: unknown[]) => {
      db.fetchSheet.mockResolvedValue({ examId: 'e-1', mappingState: 'done', questions: [written(1), written(2), written(3)], toWrite: 0, units: 0, job: null });
      db.fetchSheetEvents.mockResolvedValue(events);
    };
    // 1: named yesterday — the other day and 20 hours have come; 2: named an hour ago; 3: erased in
    // September and due for its check since.
    const YESTERDAY = named(1, new Date(2026, 9, 2, 10, 0));
    const HOUR_AGO = named(2, new Date(2026, 9, 3, 11, 0));
    const DUE = [named(3, new Date(2026, 8, 20, 10, 0)), named(3, new Date(2026, 8, 21, 10, 0))];

    it('counts the questions an answer can erase now by the sheet’s rules and leads to the draw from exactly them', async () => {
      exam();
      sheetOf([YESTERDAY, HOUR_AGO, ...DUE]);
      renderDashboard();
      const block = (await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ })).closest('article')!;
      // Audit of 2026-10-08: «Можно стереть: 4 вопроса» read as «удалить 4 вопроса», and its «Ответить» beside
      // «Тянуть билет» gave two look-alike buttons. The line says whose lines, and the card has one main action.
      const line = await within(block).findByText((_, node) => node?.classList.contains('td-erase-t') === true);
      expect(plain(line.textContent)).toBe('Сегодня можно стереть строки шпаргалки у 2 вопросов — назовите их пункты снова.');
      const answer = within(block).getByRole('link', { name: (name) => plain(name) === 'Тянуть билет из них' });
      expect(answer).toHaveAttribute('href', '/exams/e-1/draw?mode=awaiting');
      expect(answer).toHaveClass('sf-primary');
      // Screen readers hear the line with the action.
      expect(document.getElementById(answer.getAttribute('aria-describedby') ?? '')).toBe(line);
      expect(within(block).queryByRole('link', { name: (name) => plain(name) === 'Ответить' })).toBeNull();
      // Any ticket stays one quiet click away.
      const any = within(block).getByRole('link', { name: (name) => plain(name) === 'Тянуть билет' });
      expect(any).toHaveAttribute('href', '/exams/e-1/draw');
      expect(any).not.toHaveClass('sf-primary');
      // The next step under the meta, above the sheet's count; the card keeps one blue pill.
      const sheet = within(block).getByRole('link', { name: (name) => plain(name).startsWith('Шпаргалка:') });
      expect(line.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(answer.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
      expect(within(block).queryByText(/Следующие строки/)).toBeNull();
    });

    it('with nothing to erase now says when the next lines can be, and says nothing when no line waits', async () => {
      exam();
      sheetOf([HOUR_AGO]);
      renderDashboard();
      const block = (await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ })).closest('article')!;
      // Named at 11:00: from 20 hours on, the next morning.
      const next = await within(block).findByText((_, node) => node?.classList.contains('td-erase-next') === true);
      expect(plain(next.textContent)).toBe('Следующие строки можно стереть после 4 окт., 7:00.');
      expect(within(block).queryByRole('link', { name: (name) => plain(name) === 'Тянуть билет из них' })).toBeNull();
      expect(within(block).getByRole('link', { name: (name) => plain(name) === 'Тянуть билет' })).toHaveAttribute('href', '/exams/e-1/draw');
      cleanup();

      // Lines written, nothing named yet: neither line (the count of lines stays).
      exam();
      sheetOf([]);
      renderDashboard();
      const again = (await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ })).closest('article')!;
      expect(await within(again).findByRole('link', { name: (name) => plain(name) === 'Шпаргалка: 9 строк осталось из 9' })).toBeInTheDocument();
      expect(again.querySelector('.td-erase-t, .td-erase-next')).toBeNull();
    });

    // Week 2 of the plan: the sheet erases lines only with answers on different days, so «Сегодня» offers two ways
    // back — the student's own calendar and, for the author of an open group link, «Вопрос дня» for the chat.
    it('offers «Напоминать каждый день» under the sheet’s count, quietly: the card keeps one blue pill', async () => {
      exam();
      sheetOf([YESTERDAY, HOUR_AGO, ...DUE]);
      renderDashboard();
      const block = (await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ })).closest('article')!;
      await within(block).findByText((_, node) => node?.classList.contains('td-erase-t') === true);
      const sheet = within(block).getByRole('link', { name: (name) => plain(name).startsWith('Шпаргалка:') });
      const remind = within(block).getByRole('button', { name: 'Напоминать каждый день' });
      expect(sheet.compareDocumentPosition(remind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const draw = within(block).getByRole('link', { name: (name) => plain(name) === 'Тянуть билет из них' });
      expect(draw.compareDocumentPosition(remind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
      fireEvent.click(remind);
      expect(within(block).getByRole('group', { name: 'Во сколько напоминать' })).toBeInTheDocument();
      // No group link of this account: no «Вопрос дня».
      await waitFor(() => expect(db.queries.some((query) => query.table === 'exam_shares')).toBe(true));
      expect(within(block).queryByRole('button', { name: /вопрос дня/ })).toBeNull();
    });

    it('reads «Напоминание в 20:00 — изменить» once a file was downloaded on this device', async () => {
      window.localStorage.setItem('meldy_daily_reminder_user-1', JSON.stringify({ time: '20:00', exam: 'e-1', at: '2026-10-02T17:00:00.000Z' }));
      exam();
      sheetOf([HOUR_AGO]);
      renderDashboard();
      const block = (await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ })).closest('article')!;
      const change = await within(block).findByRole('button', { name: 'Изменить время напоминания' });
      expect(plain(change.closest('p')?.textContent)).toBe('Напоминание в 20:00 — изменить');
    });

    it('gives the author of an open group link «Скопировать вопрос дня» with the link kept on this device', async () => {
      const code = 'k7m2pq9rst4v';
      const share = '5a000000-0000-4000-8000-000000000001';
      rememberGroupLink('e-1', code, share);
      db.tables.exam_shares = () => ({ data: [{ id: share, code_hash: sha256Hex(code), expires_at: '2027-01-05T09:00:00Z', revoked_at: null }] });
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
      exam();
      sheetOf([YESTERDAY]);
      renderDashboard();
      const block = (await screen.findByRole('heading', { level: 2, name: /Цифровая экономика/ })).closest('article')!;
      const copy = await within(block).findByRole('button', { name: 'Скопировать вопрос дня' });
      expect(args('exam_shares', 'eq')).toEqual([['exam_id', 'e-1']]);
      // The sheet the card has read already: not read a second time.
      expect(db.fetchSheet).toHaveBeenCalledTimes(1);
      fireEvent.click(copy);
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const [message] = writeText.mock.calls[0] as unknown as [string];
      const lines = message.split('\n');
      expect(lines[0]).toBe('Вопрос дня — «Цифровая экономика»');
      expect(lines[1]).toMatch(/^[123]\. Вопрос [123]$/);
      expect(lines[2]).toBe(`Ответить в Meldy: ${window.location.origin}/join/${code}`);
    });
  });

  it('leads where the exam page leads: no «0 %» and the exam’s lectures when (almost) nothing is in them; the sheet before the first mapping', async () => {
    // The owner's case of 2026-10-07: every question checked, none in the chosen lecture.
    db.tables.exam_questions = () => ({ data: questionRows(() => 'none') });
    exam();
    const first = renderDashboard();
    const heading = await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') });
    const block = heading.closest('article')!;
    const lectures = await within(block).findByRole('link', { name: named('Выбрать или добавить лекции') });
    expect(lectures).toHaveAttribute('href', '/exams/e-1/edit#lectures');
    expect(lectures).toHaveClass('sf-primary');
    expect(within(block).queryByRole('link', { name: named('Тянуть билет') })).toBeNull();
    expect(plain(block.textContent)).not.toMatch(/0\s%|билетов, где/);
    expect(within(block).getByRole('link', { name: named('40 вопросов без материала') })).toHaveAttribute('href', '/exams/e-1?filter=cov:none');
    first.unmount();

    // Never checked against the lectures: the exam's sheet says what to do («Сверить с лекциями»).
    db.tables.exam_questions = () => ({ data: questionRows(() => null) });
    renderDashboard();
    const again = (await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') })).closest('article')!;
    const sheet = await within(again).findByRole('link', { name: named('Лист экзамена') });
    expect(sheet).toHaveClass('sf-primary');
    expect(within(again).queryByRole('link', { name: named('Тянуть билет') })).toBeNull();
    expect(plain(again.textContent)).toContain('Сверки с лекциями ещё не было.');
  });

  it('draws one mark per question in list order: 2 rows of 20 on a computer, numbers 1, 20, 21, 40', async () => {
    db.tables.exam_questions = () => ({
      data: questionRows((p) => (p === 2 ? null : p === 4 ? 'unverified' : NONE.has(p) ? 'none' : PARTIAL.has(p) ? 'partial' : 'full')),
    });
    exam();
    renderDashboard();
    const ribbon = await screen.findByRole('img', { name: /Пометки у 40 вопросов списка/ });
    expect(ribbon).toHaveClass('sf-sheet');
    expect(ribbon.querySelectorAll('svg[data-mark="tick"]')).toHaveLength(22);
    expect(ribbon.querySelectorAll('svg[data-mark="cup"]')).toHaveLength(7);
    expect(ribbon.querySelectorAll('svg[data-mark="dash"]')).toHaveLength(9);
    expect(ribbon.querySelectorAll('svg[data-mark="dtick"]')).toHaveLength(1);
    const cells = Array.from(ribbon.querySelectorAll('.td-strip-cell'));
    expect(cells.map((cell) => cell.getAttribute('data-coverage')).slice(0, 5)).toEqual(['full', 'unmapped', 'partial', 'unverified', 'none']);
    // A question not mapped yet is an empty slot.
    expect(cells[1].querySelector('svg')).toBeNull();
    const rows = ribbon.querySelectorAll('.td-strip-row');
    expect(rows).toHaveLength(2);
    expect(Array.from(ribbon.querySelectorAll('.td-strip-n')).map((n) => n.textContent)).toEqual(['1', '20', '21', '40']);
    // The legend names every mark that is on the ribbon.
    expect(screen.getByText(byText('22 есть в лекциях, 7 частично, 9 нет ни в одной, 1 только по словам, 1 ещё не сверен'))).toBeInTheDocument();
  });

  it('lays the ribbon in rows of 10 on a phone', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    exam();
    renderDashboard();
    const ribbon = await screen.findByRole('img', { name: /Пометки у 40 вопросов списка/ });
    expect(ribbon.querySelectorAll('.td-strip-row')).toHaveLength(4);
    expect(Array.from(ribbon.querySelectorAll('.td-strip-n')).map((n) => n.textContent)).toEqual(['1', '10', '11', '20', '21', '30', '31', '40']);
  });

  it('counts the share of tickets for the exam’s own layout: one per section is 36 % on the seeded list', async () => {
    exam({ ticket_layout: { mode: 'sections', per_ticket: 2, section_titles: ['Нейронные сети', 'Денежный рынок'] } });
    renderDashboard();
    expect(await screen.findByText(byText('36 % билетов, где оба вопроса есть в ваших лекциях'))).toBeInTheDocument();
    expect(screen.getByText(byText('Выучено 2 вопроса из 40.'))).toBeInTheDocument();
    expect(screen.getByText(byText('15 октября · 40 вопросов, в билете по вопросу из каждого раздела'))).toBeInTheDocument();
  });

  it('gives a range while some questions were checked only by words', async () => {
    // Three «частично» checked only by words instead: 24 есть, 3 unknown → 276/780 … 351/780.
    db.tables.exam_questions = () => ({
      data: questionRows((p) => ([3, 9, 14].includes(p) ? 'unverified' : NONE.has(p) ? 'none' : PARTIAL.has(p) ? 'partial' : 'full')),
    });
    db.fetchQuestionEvents.mockResolvedValue([]);
    exam();
    renderDashboard();
    expect(await screen.findByText(byText('35–45 % билетов, где оба вопроса есть в ваших лекциях'))).toBeInTheDocument();
    expect(screen.getByText(byText('Ответов по билетам ещё не было.'))).toBeInTheDocument();
    expect(screen.queryByText(/вслух/)).not.toBeInTheDocument();
  });

  it('says that the list is not mapped yet instead of shares, a ribbon or «без материала»', async () => {
    db.tables.exam_questions = () => ({ data: questionRows(() => null) });
    db.fetchQuestionEvents.mockResolvedValue([]);
    exam({ mapped_at: null });
    renderDashboard();
    expect(await screen.findByText(byText('Сверки с лекциями ещё не было. Ответов по билетам ещё не было.'))).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Пометки/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/без материала/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 из 40/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: named('Лист экзамена') })).toHaveAttribute('href', '/exams/e-1');
  });

  it('leaves out «без материала» when every question has material', async () => {
    db.tables.exam_questions = () => ({ data: questionRows(() => 'full') });
    exam();
    renderDashboard();
    await screen.findByRole('img', { name: /Пометки/ });
    expect(screen.queryByText(/без материала/)).not.toBeInTheDocument();
  });

  it('shows an exam without a date under the sheet’s header when no exam is dated within three weeks', async () => {
    db.tables.exams = () => ({ data: [examRow({ id: 'e-far', exam_date: '2026-12-20' }), examRow({ id: 'e-2', exam_date: null })] });
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика: вопросы к экзамену') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: named('Тянуть билет') })).toHaveAttribute('href', '/exams/e-2/draw');
    expect(screen.getByText(byText('40 вопросов, в билете два'))).toBeInTheDocument();
  });

  it('picks the nearest exam within 21 days, then the newest one without a date', () => {
    const exams = [
      { id: 'far', exam_date: '2026-10-30', created_at: '2026-09-01' },
      { id: 'past', exam_date: '2026-10-01', created_at: '2026-09-02' },
      { id: 'near', exam_date: '2026-10-15', created_at: '2026-09-03' },
      { id: 'nearer', exam_date: '2026-10-10', created_at: '2026-09-04' },
      { id: 'undated-old', exam_date: null, created_at: '2026-09-05' },
      { id: 'undated-new', exam_date: null, created_at: '2026-09-06' },
    ];
    expect(pickExam(exams, TODAY)).toBe('nearer');
    expect(pickExam(exams.filter((e) => !e.id.startsWith('near')), TODAY)).toBe('undated-new');
    expect(pickExam([exams[0], exams[1]], TODAY)).toBeNull();
    expect(pickExam([{ id: 'today', exam_date: TODAY, created_at: '2026-09-01' }], TODAY)).toBe('today');
  });

  it('calls a single-question ticket «Тянуть вопрос»', async () => {
    exam({ ticket_layout: { mode: 'random', per_ticket: 1 } });
    renderDashboard();
    expect(await screen.findByRole('link', { name: named('Тянуть вопрос') })).toHaveAttribute('href', '/exams/e-1/draw');
    expect(screen.getByText(byText('60 % вопросов есть в ваших лекциях'))).toBeInTheDocument();
    expect(screen.getByText(byText('Выучено 2 вопроса из 40.'))).toBeInTheDocument();
  });
});

describe('«Сегодня»: the sentences, unit by unit', () => {
  const q = (position: number, coverage: TodayQuestion['coverage'], section: number | null = null): TodayQuestion => ({
    id: `q${position}`,
    position,
    label: String(position),
    section,
    hash: hash(position),
    coverage,
  });

  it('words the share for random pairs, sections, the department’s tickets and a range', () => {
    const list = [q(1, 'full', 1), q(2, 'full', 1), q(3, 'none', 2), q(4, 'full', 2)];
    expect(shareSentence(list, { mode: 'random', per_ticket: 2 })).toBe('В 50 % билетов оба вопроса есть в ваших лекциях.');
    expect(shareSentence(list, { mode: 'sections', per_ticket: 2 })).toBe('В 50 % билетов оба вопроса есть в ваших лекциях.');
    expect(
      shareSentence(list, {
        mode: 'fixed',
        per_ticket: 2,
        tickets: [
          { number: 1, question_ids: ['q1', 'q4'] },
          { number: 2, question_ids: ['q2', 'q3'] },
        ],
      }),
    ).toBe('В 1 из 2 билетов кафедры оба вопроса есть в ваших лекциях.');
    expect(shareSentence([q(1, 'full'), q(2, 'unverified'), q(3, 'none')], { mode: 'random', per_ticket: 2 })).toBe(
      'В 0–33 % билетов оба вопроса есть в ваших лекциях.',
    );
    expect(shareSentence([q(1, 'unmapped'), q(2, 'unmapped')], { mode: 'random', per_ticket: 2 })).toBe('Сверки с лекциями ещё не было.');
    expect(shareSentence([], { mode: 'random', per_ticket: 2 })).toBe('');
  });

  it('sets the same share as the large figure with its caption, and none before the first mapping', () => {
    const list = [q(1, 'full', 1), q(2, 'full', 1), q(3, 'none', 2), q(4, 'full', 2)];
    const nb = (text: string | undefined) => (text ?? '').replace(/\u00a0/g, ' ');
    const random = shareFigure(list, { mode: 'random', per_ticket: 2 });
    expect(nb(random?.figure)).toBe('50 %');
    expect(random?.caption).toBe('билетов, где оба вопроса есть в ваших лекциях');
    expect(
      shareFigure(list, {
        mode: 'fixed',
        per_ticket: 2,
        tickets: [
          { number: 1, question_ids: ['q1', 'q4'] },
          { number: 2, question_ids: ['q2', 'q3'] },
        ],
      }),
    ).toEqual({ figure: '1 из 2', caption: 'билетов кафедры, где оба вопроса есть в ваших лекциях' });
    const single = shareFigure(list, { mode: 'random', per_ticket: 1 });
    expect(nb(single?.figure)).toBe('75 %');
    expect(single?.caption).toBe('вопросов есть в ваших лекциях');
    expect(nb(shareFigure([q(1, 'full'), q(2, 'unverified'), q(3, 'none')], { mode: 'random', per_ticket: 2 })?.figure)).toBe('0–33 %');
    expect(shareFigure([q(1, 'unmapped'), q(2, 'unmapped')], { mode: 'random', per_ticket: 2 })).toBeNull();
    expect(shareFigure([], { mode: 'random', per_ticket: 2 })).toBeNull();
  });

  it('counts confirmed questions over all answers, says plainly when there were none or the history did not load', () => {
    const list = [q(7, 'full'), q(23, 'full'), q(31, 'full')];
    expect(answersSentence(list, HISTORY)).toBe('Выучено 2 вопроса из 3.');
    expect(answersSentence(list, [answer(7, 2, 12, 4, 'x')])).toBe('Выучено 0 вопросов из 3.');
    expect(answersSentence(list, [])).toBe('Ответов по билетам ещё не было.');
    expect(answersSentence(list, null)).toBe('История ответов не загрузилась.');
  });

  it('dates the note by question numbers and says «подтверждён» only for a question confirmed in these two days, with no grade word (Ф1)', () => {
    const list = [q(7, 'full'), q(23, 'full'), q(31, 'full')];
    expect(recentNote(list, HISTORY, TODAY)).toBe('Вчера: ответ на вопрос 7. Вопрос 23 выучен.');
    // Question 31 was confirmed before yesterday: answering it again yesterday is not news.
    expect(recentNote(list, [...HISTORY.slice(0, 2), answer(31, 2, 18, 5, 'b1')], TODAY)).toBe('Вчера: ответ на вопрос 31.');
    // Two passes on different days but 11 hours apart: not confirmed (the 20-hour rule).
    expect(recentNote(list, [answer(23, 1, 22, 4, 'c1'), answer(23, 2, 9, 5, 'c2')], TODAY)).toBe('Вчера: ответ на вопрос 23.');
    // Today's answer leads; a failed one is said as it is.
    expect(recentNote(list, [...HISTORY, answer(7, 3, 9, 3, 'd1')], TODAY)).toBe(
      'Сегодня: ответ на вопрос 7. Вопрос 23 выучен.',
    );
    // Two confirmations in the window.
    expect(
      recentNote(list, [answer(7, 1, 9, 4, 'e1'), answer(7, 2, 10, 5, 'e2'), answer(23, 1, 10, 4, 'e3'), answer(23, 2, 11, 4, 'e4')], TODAY),
    ).toBe('Вчера: ответ на вопрос 23. Вопросы 7 и 23 выучены.');
    // Nothing answered yesterday or today: no note.
    expect(recentNote(list, HISTORY.slice(0, 3), TODAY)).toBeNull();
    expect(recentNote(list, null, TODAY)).toBeNull();
  });

  it('words «без материала» for one question and for many', () => {
    expect(withoutMaterialLine(9)).toEqual({
      link: '9 вопросов без материала',
      note: 'Добавьте к ним лекции. После сверки с ними они снова будут в тренировке.',
    });
    expect(withoutMaterialLine(1)).toEqual({
      link: '1 вопрос без материала',
      note: 'Добавьте к нему лекцию. После сверки с ней он снова будет в тренировке.',
    });
    expect(withoutMaterialLine(3).link).toBe('3 вопроса без материала');
  });
});

describe('«Сегодня»: today’s cards', () => {
  it('stacks three index cards with the first due question and words the time and the lectures', async () => {
    exam();
    renderDashboard();
    const title = await screen.findByRole('heading', { level: 2, name: named('11 карточек на сегодня') });
    const column = title.closest('article')!;
    expect(column.querySelectorAll('.sf-index-card')).toHaveLength(3);
    expect(within(column).getByText('Почему спрос на хлеб неэластичен?')).toBeInTheDocument();
    expect(
      within(column).getByText(
        byText('Около 6 минут. Из лекций «Эластичность спроса», «Спрос и предложение» и «Издержки производства».'),
      ),
    ).toBeInTheDocument();
    const start = within(column).getByRole('link', { name: named('Начать повторение') });
    expect(start).toHaveAttribute('href', '/review');
    expect(start).toHaveClass('sf-secondary');
    expect(db.getDueCards).toHaveBeenCalledWith('user-1', expect.objectContaining({ limit: expect.any(Number) }));
  });

  it('says plainly that nothing is due, without a stack', async () => {
    db.countDueCards.mockResolvedValue(0);
    db.getDueCards.mockResolvedValue([]);
    exam();
    renderDashboard();
    expect(await screen.findByText('Карточек к повторению на сегодня нет.')).toBeInTheDocument();
    expect(document.querySelectorAll('.sf-index-card')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: named('Начать повторение') })).not.toBeInTheDocument();
  });

  it('words the review time and the lectures of the due cards', () => {
    expect(reviewTime(11)).toBe('Около 6 минут.');
    expect(reviewTime(1)).toBe('Около минуты.');
    expect(reviewTime(2)).toBe('Около минуты.');
    expect(reviewTime(41)).toBe('Около 21 минуты.');
    const titles = new Map([
      ['m1', 'Эластичность спроса'],
      ['m3', 'Спрос и предложение'],
      ['m4', 'Издержки производства'],
      ['m5', 'Рынок труда'],
    ]);
    const card = (id: string, material: string | null, origin?: string): DueCard => ({ id, material_id: material, question: 'В', answer: 'О', origin });
    expect(dueLecturesText([card('1', 'm1')], titles, 1)).toBe('Из лекции «Эластичность спроса».');
    expect(dueLecturesText([card('1', 'm1'), card('2', 'm3')], titles, 2)).toBe('Из лекций «Эластичность спроса» и «Спрос и предложение».');
    expect(dueLecturesText([card('1', 'm1'), card('2', 'm3'), card('3', 'm4'), card('4', 'm5')], titles, 4)).toBe(
      'Из лекций «Эластичность спроса», «Спрос и предложение», «Издержки производства» и других.',
    );
    // More cards are due than were read: the names are not the whole list.
    expect(dueLecturesText([card('1', 'm1')], titles, 30)).toBe('Из лекций «Эластичность спроса» и других.');
    expect(dueLecturesText([card('1', null, 'oral_followup')], titles, 1)).toBe('Из ответов на билеты.');
    expect(dueLecturesText([], titles, 0)).toBe('');
  });
});

const stepsCard = () => screen.queryByRole('region', { name: 'Первые шаги' });
const stepItem = (title: string) => within(stepsCard()!).getByRole('heading', { level: 3, name: (name) => plain(name).startsWith(title) }).closest('li') as HTMLElement;
const stepQueries = (table: string, select: string) => db.queries.filter((query) => query.table === table && query.select === select);

describe('«Сегодня»: without an exam, and a new account', () => {
  it('leads with the cards; the question list is the next first step', async () => {
    renderDashboard();
    expect(await screen.findByText(byText('11 карточек ждут повторения. Около 6 минут.'))).toBeInTheDocument();
    const start = screen.getByRole('link', { name: named('Начать повторение') });
    expect(start).toHaveAttribute('href', '/review');
    // «Первые шаги» lead: their next step holds the one blue pill, the cards' pill is white.
    expect(start).toHaveClass('sf-secondary');
    const create = within(stepItem('Вставьте список вопросов к экзамену')).getByRole('link', { name: named('Создать экзамен') });
    expect(create).toHaveAttribute('href', '/exams/new');
    expect(create).toHaveClass('sf-primary');
    // The cards' card does not repeat the step.
    expect(screen.queryByRole('link', { name: named('Вставить список вопросов к экзамену') })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: named('Тянуть билет') })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.sf-index-card')).toHaveLength(3);
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('links to «Экзамены» when the account has exams outside the three weeks', async () => {
    db.tables.exams = () => ({ data: [examRow({ exam_date: '2026-12-20' })] });
    renderDashboard();
    await screen.findByText(byText('11 карточек ждут повторения. Около 6 минут.'));
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('link', { name: named('Вставить список вопросов к экзамену') })).not.toBeInTheDocument();
    // The exam far ahead has questions: the ticket step draws from it.
    expect(within(stepItem('Вытяните билет и ответьте')).getByRole('link', { name: named('Тянуть билет') })).toHaveAttribute('href', '/exams/e-1/draw');
  });

  it('shows a new account only the first steps: no desk, no zeros, no chart', async () => {
    db.tables.materials = () => ({ data: [] });
    db.countDueCards.mockResolvedValue(0);
    db.getDueCards.mockResolvedValue([]);
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 1, name: named('Алина, с чего начнём?') })).toBeInTheDocument();
    const card = stepsCard()!;
    expect(within(card).getByText('Сделано 0 из 3')).toBeInTheDocument();
    // In the order of «Новый экзамен»: the list first, its lectures right after it (audit of 2026-10-08: «Добавить
    // лекцию» as step 1 opened the list step of a new exam, which has no lectures block).
    const list = stepItem('Вставьте список вопросов к экзамену');
    const create = within(list).getByRole('link', { name: named('Создать экзамен') });
    expect(create).toHaveAttribute('href', '/exams/new');
    expect(create).toHaveClass('sf-primary');
    expect(within(list).getByRole('link', { name: 'Попробовать на примере' })).toHaveAttribute('href', '/try');
    // No exam yet: the lectures come in the new exam itself, after its list — free, not the analysis (20 units a lecture).
    const lectures = stepItem('Добавьте лекции');
    expect(within(lectures).queryByRole('link')).toBeNull();
    expect(within(lectures).getByText(byText('Их добавляют в новом экзамене, сразу после списка вопросов.'))).toBeInTheDocument();
    expect(list.compareDocumentPosition(lectures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ticket = stepItem('Вытяните билет и ответьте');
    expect(within(ticket).queryByRole('link')).toBeNull();
    expect(within(ticket).getByText(byText('Станет доступно, когда появится список вопросов.'))).toBeInTheDocument();
    expect(screen.queryByText(/за две недели/)).not.toBeInTheDocument();
    expect(screen.queryByText('Карточек к повторению на сегодня нет.')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    // Nothing to ask without lectures and exams: no extra reads for the steps.
    expect(stepQueries('materials', 'id')).toHaveLength(0);
    expect(db.queries.some((query) => query.table === 'learning_events' || query.table === 'exam_questions')).toBe(false);
  });

  it('keeps the rest of the page when exams cannot be read, and claims no steps then', async () => {
    db.tables.exams = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    const user = userEvent.setup();
    renderDashboard();
    expect(await screen.findByText(byText('11 карточек ждут повторения. Около 6 минут.'))).toBeInTheDocument();
    expect(screen.getByText(/Экзамены не загрузились/)).toBeInTheDocument();
    expect(stepsCard()).toBeNull();
    expect(screen.getByRole('link', { name: named('Начать повторение') })).toHaveClass('sf-primary');

    exam();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') })).toBeInTheDocument();
  });
});

describe('«Сегодня»: «Первые шаги»', () => {
  it('names the free first step and the paid analysis apart: the same words never lead to two places at two prices', async () => {
    // Live run of 2026-10-07: «Добавить лекцию» of the steps led to the free lectures-as-text of a new exam, the one in
    // the empty lectures place to the analysis (/analyze, 20 units). The analysis is «Разобрать лекцию», as in the top line.
    // Audit of 2026-10-08: the step opens the lectures of the exam with the list, in its editor.
    db.tables.materials = () => ({ data: [] });
    exam();
    renderDashboard();
    const lecture = await waitForStep('Добавьте лекции');
    expect(within(lecture).getByRole('link', { name: named('Добавить лекции') })).toHaveAttribute('href', '/exams/e-1/edit#lectures');
    for (const link of screen.getAllByRole('link', { name: /Добавить лекци/ })) expect(link).toHaveAttribute('href', '/exams/e-1/edit#lectures');
    expect(screen.getByRole('link', { name: /^Разобрать лекцию/ })).toHaveAttribute('href', '/analyze');
  });

  it('reads the lectures step as a lecture with text: a scan without text does not count', async () => {
    db.tables.materials = (query) => (query.select === 'id' ? { data: [] } : { data: query.select.includes('summary_json') ? LECTURES : LECTURES.map(({ id, title, created_at }) => ({ id, title, created_at })) });
    exam();
    renderDashboard();
    const lecture = await waitForStep('Добавьте лекции');
    expect(within(lecture).getByRole('link', { name: named('Добавить лекции') })).toHaveClass('sf-primary');
    const [text] = stepQueries('materials', 'id');
    expect(text.calls).toEqual([
      ['select', ['id']],
      ['eq', ['user_id', 'user-1']],
      ['neq', ['original_text', '']],
      ['limit', [1]],
    ]);
    // The exam card's «Тянуть билет» steps back to a white pill while the steps lead.
    const examCard = screen.getByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') }).closest('article')!;
    expect(within(examCard).getByRole('link', { name: named('Тянуть билет') })).toHaveClass('sf-secondary');
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('asks the journal for one answer when the leading exam shows none, and offers its ticket', async () => {
    db.fetchQuestionEvents.mockResolvedValue([]);
    exam();
    renderDashboard();
    const ticket = await waitForStep('Вытяните билет и ответьте');
    expect(within(stepsCard()!).getByText('Сделано 2 из 3')).toBeInTheDocument();
    const draw = within(ticket).getByRole('link', { name: named('Тянуть билет') });
    expect(draw).toHaveAttribute('href', '/exams/e-1/draw');
    expect(draw).toHaveClass('sf-primary');
    expect(within(stepItem('Добавьте лекции')).getByText('Сделано')).toBeInTheDocument();
    expect(within(stepItem('Вставьте список вопросов к экзамену')).getByText('Сделано')).toBeInTheDocument();
    const [journal] = stepQueries('learning_events', 'id');
    expect(journal.calls).toEqual([
      ['select', ['id']],
      ['eq', ['user_id', 'user-1']],
      ['eq', ['kind', 'exam_answer']],
      ['limit', [1]],
    ]);
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('counts an answer to another exam, and draws from an exam that has questions', async () => {
    db.fetchQuestionEvents.mockResolvedValue([]);
    db.tables.exams = () => ({ data: [examRow({ id: 'e-empty', exam_date: '2026-10-10' }), examRow({ id: 'e-2', exam_date: '2026-12-20' })] });
    db.tables.exam_questions = (query) => {
      const inCall = query.calls.find(([name]) => name === 'in');
      if (inCall) return { data: [{ exam_id: 'e-2' }] };
      return { data: [] };
    };
    db.tables.learning_events = () => ({ data: [{ id: 'ev-1' }] });
    renderDashboard();
    // All three are done: the card is gone and remembered as done.
    await screen.findByRole('heading', { level: 2, name: (name) => plain(name).startsWith('Цифровая экономика') });
    expect(stepsCard()).toBeNull();
    expect(window.localStorage.getItem('meldy_first_steps_user-1')).toBe('done');
    expect(args('exam_questions', 'in')).toEqual([['exam_id', ['e-2']]]);
  });

  it('is gone once all three are done, and is not read again on this device', async () => {
    exam();
    const first = renderDashboard();
    await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') });
    expect(stepsCard()).toBeNull();
    expect(window.localStorage.getItem('meldy_first_steps_user-1')).toBe('done');
    expect(stepQueries('materials', 'id')).toHaveLength(1);
    first.unmount();

    db.queries.length = 0;
    renderDashboard();
    await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') });
    expect(stepsCard()).toBeNull();
    expect(stepQueries('materials', 'id')).toHaveLength(0);
    expect(db.queries.some((query) => query.table === 'learning_events')).toBe(false);
  });

  it('folds to one line, remembers it, and gives the desk its blue pill back', async () => {
    db.fetchQuestionEvents.mockResolvedValue([]);
    exam();
    const user = userEvent.setup();
    const first = renderDashboard();
    await waitForStep('Вытяните билет и ответьте');
    const fold = within(stepsCard()!).getByRole('button', { name: 'Свернуть' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    await user.click(fold);
    const unfold = within(stepsCard()!).getByRole('button', { name: 'Развернуть' });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    expect(within(stepsCard()!).queryByRole('list')).toBeNull();
    expect(within(stepsCard()!).getByText('Сделано 2 из 3')).toBeInTheDocument();
    expect(window.localStorage.getItem('meldy_first_steps_user-1')).toBe('collapsed');
    const examCard = screen.getByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') }).closest('article')!;
    expect(within(examCard).getByRole('link', { name: named('Тянуть билет') })).toHaveClass('sf-primary');
    first.unmount();

    renderDashboard();
    await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') });
    expect(within(stepsCard()!).getByRole('button', { name: 'Развернуть' })).toBeInTheDocument();
    await user.click(within(stepsCard()!).getByRole('button', { name: 'Развернуть' }));
    expect(window.localStorage.getItem('meldy_first_steps_user-1')).toBeNull();
    expect(within(stepsCard()!).getByRole('list')).toBeInTheDocument();
  });

  it('claims nothing when a check cannot be read', async () => {
    db.fetchQuestionEvents.mockResolvedValue([]);
    db.tables.learning_events = () => ({ data: null, error: { code: '08006', message: 'offline' } });
    exam();
    renderDashboard();
    await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') });
    expect(stepsCard()).toBeNull();
    expect(window.localStorage.getItem('meldy_first_steps_user-1')).toBeNull();
    expect(screen.getByRole('link', { name: named('Тянуть билет') })).toHaveClass('sf-primary');
  });

  it('words the steps and counts them', () => {
    const steps = { lecture: true, list: false, answer: false, drawExamId: null };
    expect(firstStepsDone(steps)).toBe(1);
    expect(firstStepsDone({ lecture: true, list: true, answer: true, drawExamId: 'e-1' })).toBe(3);
    const views = firstStepViews(steps);
    // The order of «Новый экзамен»: the list, then its lectures, then a ticket.
    expect(views.map((view) => view.title)).toEqual(['Вставьте список вопросов к экзамену', 'Добавьте лекции', 'Вытяните билет и ответьте']);
    expect(views.map((view) => view.action?.to ?? null)).toEqual(['/exams/new', null, null]);
    expect(views[1].wait).toBe('Их добавляют в новом экзамене, сразу после списка вопросов.');
    // The step adds a lecture's text for free: it promises no summary and no cards.
    expect(views[1].text).not.toMatch(/конспект|карточ/i);
    expect(views[1].text).toMatch(/Это бесплатно/);
    const withList = firstStepViews({ ...steps, list: true, drawExamId: 'e-7' });
    expect(withList[1].action).toEqual({ to: '/exams/e-7/edit#lectures', label: 'Добавить лекции' });
    expect(withList[2].action).toEqual({ to: '/exams/e-7/draw', label: 'Тянуть билет' });
    expect(views.map((view) => `${view.title} ${view.text}`).join(' ')).not.toMatch(/разметк|эталон|Библиотек/i);
    expect(startGreeting('Алина Соколова')).toBe('Алина, с чего начнём?');
    expect(startGreeting(undefined)).toBe('С чего начнём?');
  });
});

/** The step's list item once «Первые шаги» are on the page. */
async function waitForStep(title: string): Promise<HTMLElement> {
  await screen.findByRole('region', { name: 'Первые шаги' });
  return stepItem(title);
}

describe('«Сегодня»: an error', () => {
  it('says what is safe and offers to try again', async () => {
    let fail = true;
    db.tables.materials = (query) => (fail ? { data: null, error: { code: '08006', message: 'offline' } } : { data: query.select.includes('summary_json') ? LECTURES : LECTURES });
    exam();
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByRole('heading', { name: named('Не удалось загрузить данные') })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Лекции и карточки на месте. Повторите через минуту.');
    expect(screen.queryByText('Начните со списка вопросов')).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') })).toBeInTheDocument();
  });

  it('treats a failed activity read as a load error too', async () => {
    db.tables.study_sessions = () => ({ data: null, error: { code: '08006', message: 'offline' } });
    renderDashboard();
    expect(await screen.findByRole('heading', { name: named('Не удалось загрузить данные') })).toBeInTheDocument();
  });
});

describe('«Сегодня»: below the desk', () => {
  it('lists the four latest lectures as in the Library, with «Все 5»', async () => {
    exam();
    renderDashboard();
    const section = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section')!;
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/library/m1');
    expect(within(rows[0]).getByText(byText('конспект · 8 карточек · самопроверка · подкаст'))).toBeInTheDocument();
    expect(within(rows[1]).getByText('только текст, конспекта нет')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: named('Все 5') })).toHaveAttribute('href', '/library');
    // The four latest with their details; the first step asks for one lecture with text at most.
    expect(db.queries.filter((query) => query.table === 'materials' && query.select.includes('summary_json')).flatMap((query) => query.calls.filter(([name]) => name === 'limit').map(([, a]) => a))).toEqual([[4]]);
    expect(stepQueries('materials', 'id').map((query) => query.calls.find(([name]) => name === 'limit')?.[1])).toEqual([[1]]);
    // No old «label — number» rows, icons or blue bars.
    expect(screen.queryByText('Карточек к повторению')).not.toBeInTheDocument();
    expect(screen.queryByText('Дней подряд')).not.toBeInTheDocument();
    expect(screen.queryByText('Материалов')).not.toBeInTheDocument();
    expect(screen.queryByText('Ответов на карточки сегодня')).not.toBeInTheDocument();
    expect(document.querySelector('dl')).toBeNull();
    expect(document.querySelector('.lucide')).toBeNull();
  });

  it('notes analysed lectures whose cards are not in review, never text-only lectures, and adds them', async () => {
    db.tables.flashcard_progress = () => ({ data: [{ material_id: 'm1' }, { material_id: 'm4' }] });
    exam();
    const user = userEvent.setup();
    renderDashboard();
    const section = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section')!;
    const notes = within(section).getAllByText(/Карточки этой лекции не добавлены в повторение/);
    expect(notes).toHaveLength(1);
    expect(notes[0].closest('li')).toHaveTextContent('Спрос и предложение');
    expect(args('flashcard_progress', 'in')).toEqual([['material_id', ['m1', 'm2', 'm3', 'm4']]]);

    await user.click(within(notes[0].closest('li')!).getByRole('button', { name: 'Добавить' }));
    expect(db.syncFlashcards).toHaveBeenCalledWith('user-1', 'm3', [{ id: 1, question: 'Что такое спрос?', answer: 'Желание и возможность купить' }]);
  });

  it('draws two weeks of reviews as ink columns with values, today in full ink, and a table for screen readers', async () => {
    const day = (offset: number) => localDateKey(new Date(2026, 9, 3 + offset, 12));
    db.tables.study_sessions = () => ({
      data: [
        { date: day(0), cards_reviewed: 3 },
        { date: day(0), cards_reviewed: 1 },
        { date: day(-1), cards_reviewed: 9 },
        { date: day(-2), cards_reviewed: 6 },
        { date: day(-3), cards_reviewed: 14 },
        { date: day(-4), cards_reviewed: 11 },
        { date: day(-5), cards_reviewed: 7 },
        { date: day(-7), cards_reviewed: 9 },
      ],
    });
    exam();
    renderDashboard();
    // Cards only (study_sessions): the answers to tickets are on the exam card (audit of 2026-10-08).
    const section = (await screen.findByRole('heading', { name: named('Карточки за две недели') })).closest('section')!;
    expect(within(section).getByText(byText('6 дней подряд. Сегодня повторили 4 карточки.'))).toBeInTheDocument();
    const bars = section.querySelectorAll('.td-bar');
    expect(bars).toHaveLength(14);
    expect(bars[13]).toHaveAttribute('data-today');
    expect(bars[13].textContent).toBe('4');
    expect(bars[12].textContent).toBe('9');
    expect(bars[7]).toHaveAttribute('data-zero');
    expect((bars[10].querySelector('.td-bar-b') as HTMLElement).style.height).toBe('100px');
    const axis = section.querySelector('.td-axis') as HTMLElement;
    expect(within(axis).getByText('20 сент.')).toBeInTheDocument();
    expect(within(axis).getByText('сегодня')).toBeInTheDocument();
    const table = within(section).getByRole('table', { name: named('Повторения карточек по дням') });
    expect(within(table).getAllByRole('row')).toHaveLength(15);
  });

  it('says that no cards were reviewed instead of an empty chart, never that nothing was done', async () => {
    // «За две недели повторений не было» beside «Сегодня: ответ на вопрос 1» read as if the answer had not counted.
    exam();
    renderDashboard();
    const section = (await screen.findByRole('heading', { name: named('Карточки за две недели') })).closest('section')!;
    expect(within(section).getByText('За две недели карточки не повторялись.')).toBeInTheDocument();
    expect(section.querySelector('.td-bars')).toBeNull();
  });

  it('words the activity line', () => {
    expect(activityLine(6, 4)).toBe('6 дней подряд. Сегодня повторили 4 карточки.');
    expect(activityLine(1, 1)).toBe('Сегодня повторили 1 карточку.');
    expect(activityLine(3, 0)).toBe('3 дня подряд. Сегодня карточки ещё не повторялись.');
  });

  it('describes a lecture as the Library does and notes missing cards only when they exist', () => {
    expect(lectureMeta(LECTURES[0])).toBe('конспект · 8 карточек · самопроверка · подкаст');
    // The выжимка is named as «Лекции» names it, in the order of the lecture's tabs (QA 2026-10-11).
    const brief = { ...LECTURES[0], summary_json: { ...LECTURES[0].summary_json, cheatsheet: '# Выжимка\n\nГлавное.' } };
    expect(lectureMeta(brief)).toBe('конспект · 8 карточек · самопроверка · выжимка · подкаст');
    expect(lectureMetaShort(brief)).toBe('8 карточек · самопроверка · выжимка · подкаст · 2 окт.');
    expect(lectureMeta({ ...LECTURES[2], summary_json: { content: 'Конспект', cheatsheet: ' ' } })).toBe('конспект · 1 карточка · самопроверка');
    expect(lectureMeta(LECTURES[1])).toBe('только текст, конспекта нет');
    expect(lectureMeta({ summary_json: null, flashcards_json: null, quiz_json: null })).toBe('');
    const inReview = new Set(['m1']);
    expect(cardsMissingFromReview(LECTURES[2], inReview)).toBe(true);
    expect(cardsMissingFromReview(LECTURES[0], inReview)).toBe(false);
    expect(cardsMissingFromReview(LECTURES[2], null)).toBe(false);
    expect(cardsMissingFromReview(LECTURES[1], new Set())).toBe(false);
  });

  it('keeps the page order the exam, today’s cards, the lectures, and leaves the place to the wide layout', async () => {
    exam();
    renderDashboard();
    const grid = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section')!.parentElement!;
    expect(grid).toHaveClass('td-grid');
    const blocks = Array.from(grid.children).map((child) => ['td-main', 'td-side', 'td-lectures'].find((name) => child.classList.contains(name)));
    expect(blocks).toEqual(['td-main', 'td-side', 'td-lectures']);
    // No wide screen here (jsdom has no matchMedia): nothing is measured, one column in the page order.
    expect(grid).not.toHaveAttribute('data-lectures');
  });

  it('puts the lectures under a short exam beside a taller side on a wide screen, and across the page under a tall one', async () => {
    // jsdom lays nothing out: the blocks get the heights measured on a 1907 px screen (QA seed, 2026-10-05).
    const SHORT = { main: 394, side: 862, lectures: 576 };
    const TALL = { main: 731, side: 862, lectures: 576 };
    let sizes = SHORT;
    const box = (node: HTMLElement): [number, number] => {
      if (!node.parentElement?.classList.contains('td-grid')) return [0, 0];
      if (node.classList.contains('td-main')) return [0, sizes.main];
      if (node.classList.contains('td-side')) return [0, sizes.side];
      // With the lectures under the exam: 24 px of gap and 16 px of margin below the exam card.
      if (node.classList.contains('td-lectures')) return [sizes.main + 40, sizes.lectures];
      return [0, 0];
    };
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return box(this)[0];
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return box(this)[1];
    });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 1200px)', media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      exam();
      const view = renderDashboard();
      const grid = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section')!.parentElement!;
      expect(grid).toHaveAttribute('data-lectures', 'main');

      sizes = TALL;
      view.rerender(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>,
      );
      expect(grid).toHaveAttribute('data-lectures', 'below');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('places the lectures where they leave the smaller hole, and does not move them for a near tie', () => {
    // Bottoms measured on a 1907 px screen with the lectures under the exam (QA seed, 2026-10-05).
    expect(lecturePlace({ main: 1053, side: 1522, column: 1669 })).toBe('main'); // a short exam beside the cards and two weeks
    expect(lecturePlace({ main: 1391, side: 1522, column: 2007 })).toBe('below'); // the exam with its ribbon, nearly as tall as the side
    expect(lecturePlace({ main: 1391, side: 1325, column: 2007 })).toBe('below'); // the exam taller than the side
    // Holes of 300 and 300: wherever the lectures were, they stay.
    expect(lecturePlace({ main: 1000, side: 1300, column: 1600 }, 'main')).toBe('main');
    expect(lecturePlace({ main: 1000, side: 1300, column: 1600 }, 'below')).toBe('below');
  });
});

// ------------------------------------------------------------------------------------------------
// A phone (usePhone: max-width 639px; 10_Project/Phone_Declutter_2026-10-08): the same page cut to its core.

describe('«Сегодня» on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === PHONE_QUERY, media: query, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Questions 1–3 of the list with three answer points each in the exam's cheat sheet. */
  const written = (position: number) => ({
    question_id: `q${position}`,
    position,
    label: String(position),
    section: null,
    text: `Вопрос ${position}`,
    question_hash: hash(position),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rebuilt: false,
    rubric: {
      rubric_id: `r${position}`,
      built_at: null,
      coverage: 'full',
      coverage_note: '',
      materials: [],
      points: [1, 2, 3].map((n) => ({ id: `p${n}`, title: `Пункт ${n} вопроса ${position}`, short: '', essential: n === 1, source_quote: '', source_ids: [] })),
    },
  });
  /** Point 1 of a question named in an answer at a local moment. */
  const pointNamed = (position: number, at: Date) => ({
    id: `e-${position}-${at.getTime()}`,
    created_at: at.toISOString(),
    local_date: localDateKey(at),
    material_id: null,
    kind: 'oral_point',
    item_key: `oral:r${position}:p1`,
    correct: true,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: `s-${position}-${at.getTime()}`,
    payload: { v: 1, question_hash: hash(position), rubric_id: `r${position}`, point_id: 'p1', title: `Пункт 1 вопроса ${position}`, status: 'covered' },
  });
  /** Two questions an answer can erase lines of now: 1 (named yesterday) and 3 (erased in September, due for its check). */
  const twoErasable = () => {
    db.fetchSheet.mockResolvedValue({ examId: 'e-1', mappingState: 'done', questions: [written(1), written(2), written(3)], toWrite: 0, units: 0, job: null });
    db.fetchSheetEvents.mockResolvedValue([
      pointNamed(1, new Date(2026, 9, 2, 10, 0)),
      pointNamed(2, new Date(2026, 9, 3, 11, 0)),
      pointNamed(3, new Date(2026, 8, 20, 10, 0)),
      pointNamed(3, new Date(2026, 8, 21, 10, 0)),
    ]);
  };
  const examCard = async () => (await screen.findByRole('heading', { level: 2, name: named('Цифровая экономика — экзамен через 12 дней') })).closest('article')!;

  it('gives the exam card one line of meta, one line about today, the one pill and «Лист экзамена» under it as a quiet link', async () => {
    exam();
    twoErasable();
    renderDashboard();
    const block = await examCard();
    const flag = within(block).getByText('Экзамен через 12 дней');
    expect(flag).toHaveAttribute('aria-hidden', 'true');
    const meta = within(block).getByText(byText('15 октября · 40 вопросов'));
    // The tickets' layout is on the exam's sheet.
    expect(within(block).queryByText(/в билете два/)).toBeNull();
    const today = await within(block).findByText(byText('Можно стереть строки шпаргалки у 2 вопросов.'));
    const draw = within(block).getByRole('link', { name: named('Тянуть билет из них') });
    expect(draw).toHaveAttribute('href', '/exams/e-1/draw?mode=awaiting');
    expect(draw).toHaveClass('sf-primary');
    expect(document.getElementById(draw.getAttribute('aria-describedby') ?? '')).toBe(today);
    const sheet = within(block).getByRole('link', { name: named('Лист экзамена') });
    expect(sheet).toHaveAttribute('href', '/exams/e-1');
    expect(sheet).toHaveClass('sf-link');
    expect(sheet).not.toHaveClass('sf-secondary');
    // One way into a ticket: no second «Тянуть билет».
    expect(within(block).queryByRole('link', { name: named('Тянуть билет') })).toBeNull();
    for (const [earlier, later] of [
      [meta, today],
      [today, draw],
      [draw, sheet],
    ]) {
      expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(document.querySelectorAll('.sf-secondary')).toHaveLength(0);
  });

  it('says the share in one line, then «без материала» and the cheat sheet as quiet links; the rest stays on the exam’s sheet and in «Профиль»', async () => {
    exam();
    twoErasable();
    renderDashboard();
    const block = await examCard();
    const share = within(block).getByText(byText('35 % билетов, где оба вопроса есть в ваших лекциях'));
    const gap = within(block).getByRole('link', { name: named('9 вопросов без материала') });
    expect(gap).toHaveAttribute('href', '/exams/e-1?filter=cov:none');
    expect(gap.querySelector('.td-gap-dot')).toBeNull();
    const sheet = await within(block).findByRole('link', { name: named('Шпаргалка: 8 строк осталось из 9') });
    expect(sheet).toHaveAttribute('href', '/exams/e-1?view=sheet');
    expect(share.compareDocumentPosition(gap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gap.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The explanation paragraph, the dots, the legend, the answers, the note and the reminder are not on the phone.
    expect(within(block).queryByText(/Добавьте к ним лекции/)).toBeNull();
    expect(within(block).queryByRole('img', { name: /Пометки у/ })).toBeNull();
    expect(block.querySelector('.td-tally')).toBeNull();
    expect(within(block).queryByText(/Подтверждено ответами/)).toBeNull();
    expect(within(block).queryByText(/ответ на вопрос/)).toBeNull();
    expect(within(block).queryByRole('button', { name: 'Напоминать каждый день' })).toBeNull();
  });

  it('keeps «Скопировать вопрос дня» for the author of an open group link', async () => {
    const code = 'k7m2pq9rst4v';
    const share = '5a000000-0000-4000-8000-000000000001';
    rememberGroupLink('e-1', code, share);
    db.tables.exam_shares = () => ({ data: [{ id: share, code_hash: sha256Hex(code), expires_at: '2027-01-05T09:00:00Z', revoked_at: null }] });
    exam();
    twoErasable();
    renderDashboard();
    const block = await examCard();
    expect(await within(block).findByRole('button', { name: 'Скопировать вопрос дня' })).toBeInTheDocument();
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('leads an exam never checked against the lectures to its sheet: the sentence over the one action, no quiet twin', async () => {
    db.tables.exam_questions = () => ({ data: questionRows(() => null) });
    exam();
    renderDashboard();
    const block = await examCard();
    const line = within(block).getByText('Сверки с лекциями ещё не было.');
    const sheet = within(block).getByRole('link', { name: named('Лист экзамена') });
    expect(sheet).toHaveClass('sf-primary');
    expect(within(block).getAllByRole('link', { name: named('Лист экзамена') })).toHaveLength(1);
    expect(line.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).queryByRole('link', { name: named('Тянуть билет') })).toBeNull();
  });

  it('sets today’s cards as «Повторение», one line and a quiet «Начать повторение»: no picture, no lectures', async () => {
    exam();
    renderDashboard();
    const card = (await screen.findByRole('heading', { level: 2, name: 'Повторение' })).closest('article')!;
    expect(within(card).getByText(byText('11 карточек · около 6 минут'))).toBeInTheDocument();
    const start = within(card).getByRole('link', { name: 'Начать повторение' });
    expect(start).toHaveAttribute('href', '/review');
    expect(start).toHaveClass('sf-link');
    expect(card.querySelectorAll('.sf-index-card')).toHaveLength(0);
    expect(within(card).queryByText(/Из лекций/)).toBeNull();
    expect(screen.queryByRole('heading', { name: named('11 карточек на сегодня') })).toBeNull();
  });

  it('says that nothing is due in one line, and shows two weeks of cards only when there were reviews', async () => {
    db.countDueCards.mockResolvedValue(0);
    db.getDueCards.mockResolvedValue([]);
    exam();
    const first = renderDashboard();
    const line = await screen.findByText('Карточек к повторению на сегодня нет.');
    expect(line.closest('article')).toBeNull();
    expect(screen.queryByText('Повторение')).toBeNull();
    // No reviews in two weeks: no block at all.
    expect(screen.queryByRole('heading', { name: named('Карточки за две недели') })).toBeNull();
    expect(screen.queryByText('За две недели карточки не повторялись.')).toBeNull();
    first.unmount();

    db.tables.study_sessions = () => ({ data: [{ date: localDateKey(new Date(2026, 9, 3, 12)), cards_reviewed: 4 }, { date: localDateKey(new Date(2026, 9, 1, 12)), cards_reviewed: 8 }] });
    renderDashboard();
    const section = (await screen.findByRole('heading', { name: named('Карточки за две недели') })).closest('section')!;
    expect(within(section).getByText(byText('Сегодня повторили 4 карточки.'))).toBeInTheDocument();
    // Low columns (48 px at most); the values are in the table.
    const bars = section.querySelectorAll('.td-bar-b');
    expect((bars[11] as HTMLElement).style.height).toBe('48px');
    expect((bars[13] as HTMLElement).style.height).toBe('24px');
    expect(within(section).getByRole('table', { name: named('Повторения карточек по дням') })).toBeInTheDocument();
  });

  it('lists the lectures as rows with a short meta, «Разобрать лекцию» into the analysis, and «Все 5» while some are not listed', async () => {
    exam();
    renderDashboard();
    const section = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section')!;
    const add = within(section).getByRole('link', { name: 'Разобрать лекцию' });
    expect(add).toHaveAttribute('href', '/analyze');
    expect(add).toHaveTextContent('Разобрать лекцию');
    expect(within(section).getByRole('link', { name: named('Все 5') })).toHaveAttribute('href', '/library');
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/library/m1');
    expect(within(rows[0]).getByText(byText('8 карточек · самопроверка · подкаст · 2 окт.'))).toBeInTheDocument();
    expect(within(rows[1]).getByText(byText('только текст · 1 окт.'))).toBeInTheDocument();
    expect(section.querySelector('.td-thumb')).toBeNull();
    expect(section.querySelector('.td-lec-date')).toBeNull();
    cleanup();

    // Four lectures or fewer: all of them are on the page, the «Лекции» tab is one tap away.
    db.tables.materials = (query: Query | { select: string }) => {
      const four = LECTURES.slice(0, 4);
      return { data: query.select.includes('summary_json') ? four : four.map(({ id, title, created_at }) => ({ id, title, created_at })) };
    };
    exam();
    renderDashboard();
    const again = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section')!;
    expect(within(again).queryByRole('link', { name: /^Все/ })).toBeNull();
    expect(within(again).getByRole('link', { name: 'Разобрать лекцию' })).toBeInTheDocument();
  });

  it('adds the cards of a lecture to review with one quiet action', async () => {
    db.tables.flashcard_progress = () => ({ data: [{ material_id: 'm1' }, { material_id: 'm4' }] });
    exam();
    const user = userEvent.setup();
    renderDashboard();
    const section = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section')!;
    const add = within(section).getByRole('button', { name: 'Добавить карточки в повторение' });
    expect(add.closest('li')).toHaveTextContent('Спрос и предложение');
    expect(within(section).getAllByRole('button', { name: 'Добавить карточки в повторение' })).toHaveLength(1);
    await user.click(add);
    expect(db.syncFlashcards).toHaveBeenCalledWith('user-1', 'm3', [{ id: 1, question: 'Что такое спрос?', answer: 'Желание и возможность купить' }]);
  });

  it('leads without an exam with the same short card: the blue pill once the steps are folded, a quiet link while they lead', async () => {
    const user = userEvent.setup();
    renderDashboard();
    const card = (await screen.findByRole('heading', { level: 2, name: 'Повторение' })).closest('article')!;
    expect(within(card).getByText(byText('11 карточек · около 6 минут'))).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Начать повторение' })).toHaveClass('sf-link');
    expect(within(stepItem('Вставьте список вопросов к экзамену')).getByRole('link', { name: named('Создать экзамен') })).toHaveClass('sf-primary');
    expect(card.querySelectorAll('.sf-index-card')).toHaveLength(0);
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);

    await user.click(within(stepsCard()!).getByRole('button', { name: 'Свернуть' }));
    const start = within(screen.getByRole('heading', { level: 2, name: 'Повторение' }).closest('article')!).getByRole('link', { name: 'Начать повторение' });
    expect(start).toHaveClass('sf-primary');
    // The way to a question list is a quiet link under it, not a second pill.
    expect(screen.getByRole('link', { name: 'Вставить список вопросов к экзамену' })).toHaveClass('sf-link');
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(document.querySelectorAll('.sf-secondary')).toHaveLength(0);
  });

  it('words the short lines', () => {
    expect(examMetaShort({ examDate: '2026-10-15', total: 40 })).toBe('15 октября · 40 вопросов');
    expect(examMetaShort({ examDate: null, total: 21 })).toBe('21 вопрос');
    expect(examMetaShort({ examDate: '2026-10-15', total: 0 })).toBe('15 октября');
    expect(plain(erasableShort(1))).toBe('Можно стереть строки шпаргалки у 1 вопроса.');
    expect(plain(erasableShort(4))).toBe('Можно стереть строки шпаргалки у 4 вопросов.');
    expect(plain(erasableShort(21))).toBe('Можно стереть строки шпаргалки у 21 вопроса.');
    expect(dueLine(26)).toBe('26 карточек · около 13 минут');
    expect(dueLine(1)).toBe('1 карточка · около минуты');
    expect(dueLine(41)).toBe('41 карточка · около 21 минуты');
    expect(lectureMetaShort(LECTURES[0])).toBe('8 карточек · самопроверка · подкаст · 2 окт.');
    expect(lectureMetaShort(LECTURES[1])).toBe('только текст · 1 окт.');
    expect(lectureMetaShort(LECTURES[3])).toBe('1 карточка · 24 сент.');
    expect(lectureMetaShort({ ...LECTURES[3], flashcards_json: null })).toBe('конспект · 24 сент.');
    expect(lectureMetaShort({ summary_json: null, flashcards_json: null, quiz_json: null, created_at: '' })).toBe('');
  });
});
