import { StrictMode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ExamBundle, ExamQuestion, ExamRow } from '../api/exams';
import type { LearningEvent } from '../api/learning';
import { formatDay, formatShortDay } from '../lib/exams/format';

const mocks = vi.hoisted(() => ({
  loadExamBundle: vi.fn(),
  markQuestionManual: vi.fn(),
  fetchExamMappingState: vi.fn(),
  fetchQuestionEvents: vi.fn(),
  fetchSessionPoints: vi.fn(),
  recordSelfRating: vi.fn(),
  incrementAIUsage: vi.fn(),
  checkAILimit: vi.fn(),
  verifyEnergy: vi.fn(),
  confirm: vi.fn(),
  fetchSheet: vi.fn(),
  fetchSheetEvents: vi.fn(),
  recordSheetPeek: vi.fn(),
  getProfile: vi.fn(),
  markOnboardingTourSeen: vi.fn(),
  startSheetWrite: vi.fn(),
  listLectureTitles: vi.fn(),
  fetchLectureFit: vi.fn(),
  useLearnLeft: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
// «Осталось выучить» (public.learn_left): what the page reads instead of the cheat sheet.
vi.mock('../api/learnLeft', () => ({
  useLearnLeft: (ids: readonly string[] | null, enabled?: boolean) => mocks.useLearnLeft(ids, enabled),
  fetchLearnLeft: () => Promise.resolve([]),
  forgetLearnLeft: () => undefined,
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: mocks.verifyEnergy }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: vi.fn() }) }));
vi.mock('../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/exams')>();
  return {
    ...actual,
    loadExamBundle: mocks.loadExamBundle,
    markQuestionManual: mocks.markQuestionManual,
    fetchExamMappingState: mocks.fetchExamMappingState,
    listLectureTitles: mocks.listLectureTitles,
    fetchLectureFit: mocks.fetchLectureFit,
  };
});
vi.mock('../api/learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/learning')>();
  return {
    ...actual,
    fetchQuestionEvents: mocks.fetchQuestionEvents,
    fetchSessionPoints: mocks.fetchSessionPoints,
    recordSelfRating: mocks.recordSelfRating,
    fetchSheetEvents: mocks.fetchSheetEvents,
    recordSheetPeek: mocks.recordSheetPeek,
  };
});
// The cheat sheet's read (GET /api/oral/sheet); the mapping tests count the page's own fetches.
vi.mock('../api/cheatSheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/cheatSheet')>();
  // «Написать шпаргалку» starts the server's writer: counted here, the real one for every other call.
  return {
    ...actual,
    fetchSheet: mocks.fetchSheet,
    startSheetWrite: (...args: Parameters<typeof actual.startSheetWrite>) => (mocks.startSheetWrite.getMockImplementation() ? mocks.startSheetWrite(...args) : actual.startSheetWrite(...args)),
  };
});
vi.mock('../api/limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/limits')>();
  // The server charges the check of the list; the page only refreshes the meter (counted by incrementAIUsage here).
  return { ...actual, notifyAIUsageChanged: mocks.incrementAIUsage, checkAILimit: mocks.checkAILimit };
});
// The first-use tip of the cheat sheet reads the profile (the guide seen, the tip seen); none by default.
vi.mock('../api/social', () => ({
  getProfile: (...args: unknown[]) => mocks.getProfile(...args),
  markOnboardingTourSeen: (...args: unknown[]) => mocks.markOnboardingTourSeen(...args),
}));
vi.mock('../components/tips/clipPart', async () => {
  const { lazyPart } = await import('../lib/lazyPart');
  return { tipClipPart: lazyPart(async () => () => <div data-testid="clip" />) };
});
// The draw and answer screens are preloaded while the sheet is idle; not in these tests.
vi.mock('../components/exams/preload', () => ({
  preloadDrawScreen: vi.fn(),
  preloadTicketScreen: vi.fn(),
  whenIdle: () => () => undefined,
}));

import ExamDetail, { BAR_WAIT_MS, phoneMetaLine, ROW_HINT } from './ExamDetail';
import { resetMapJobsForTests } from '../components/exams/mapJobs';
import { PHONE_QUERY } from '../lib/usePhone';
import { ATTACHED_EXAMS_KEY, rememberAttachedExams, rememberContainerTitle } from '../lib/containers/titleCache';

// ------------------------------------------------------------------------------------ fixtures

const hash = (n: number) => n.toString(16).padStart(32, 'e');
const year = new Date().getFullYear();
/** exams.mapped_at: «21 января, 9:40» in local time. */
const EXAM_MAPPED_AT = new Date(year, 0, 21, 9, 40).toISOString();
/** A row's own mapped_at, different on purpose: the sheet dates the mapping by the exam. */
const ROW_MAPPED_AT = new Date(year, 0, 25, 18, 5).toISOString();

const pad = (n: number) => String(n).padStart(2, '0');
function dayKey(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function question(n: number, coverage: ExamQuestion['coverage'], overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  const covered = coverage === 'full' || coverage === 'partial';
  return {
    id: `q${n}`,
    exam_id: 'exam-1',
    position: n,
    label: String(n),
    section: null,
    text: `Вопрос ${n} о денежном рынке`,
    question_hash: hash(n),
    coverage,
    coverage_method: coverage === null ? null : coverage === 'unverified' ? 'lexical' : 'llm',
    coverage_reason: coverage === 'full' ? 'Во фрагменте есть определение' : '',
    missing_note: coverage === 'partial' ? 'нет примеров' : '',
    evidence: covered
      ? [{ material_id: 'm1', material_title: 'Денежный рынок', source_id: `S${pad(n)}`, excerpt: `Фрагмент о вопросе ${n}.` }]
      : [],
    nearest: [],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: coverage === null ? null : ROW_MAPPED_AT,
    created_at: '2026-01-20T10:00:00Z',
    ...overrides,
  };
}

const LECTURES = [
  { id: 'm1', title: 'Денежный рынок' },
  { id: 'm2', title: 'Инфляция' },
];

function bundle(questions: ExamQuestion[], exam: Partial<ExamRow> = {}, materials = LECTURES): ExamBundle {
  return {
    exam: {
      id: 'exam-1',
      title: 'Макроэкономика',
      kind: 'exam',
      exam_date: null,
      source_kind: 'paste',
      source_text: '',
      ticket_layout: { mode: 'random', per_ticket: 2 },
      mapping_state: 'done',
      mapping_started_at: null,
      mapped_at: EXAM_MAPPED_AT,
      mapped_material_ids: materials.map((item) => item.id),
      created_at: '2026-01-20T10:00:00Z',
      ...exam,
    },
    questions,
    materialIds: materials.map((item) => item.id),
    materials,
  };
}

/** 40 questions: 24 in the lectures, 7 partly, 9 not at all (the spec's example). */
function forty(): ExamQuestion[] {
  return Array.from({ length: 40 }, (_, index) => question(index + 1, index < 24 ? 'full' : index < 31 ? 'partial' : 'none'));
}

/** One question per coverage state. */
function mixed(): ExamQuestion[] {
  return [
    question(1, 'full'),
    question(2, 'partial'),
    question(3, 'none', {
      nearest: [{ material_id: 'm2', material_title: 'Инфляция', source_id: 'S07', excerpt: 'Инфляцию измеряют индексом цен.', matched: ['цен'] }],
    }),
    question(4, 'unverified'),
    question(5, null),
    question(6, 'full', { coverage_method: 'manual', coverage_reason: 'Отмечено вами', evidence: [] }),
  ];
}

function answer(n: number, day: string, correct: boolean, session: string | null, extra: Partial<LearningEvent> = {}): LearningEvent {
  return {
    id: `a${n}-${day}`,
    created_at: `${day}T10:00:00Z`,
    local_date: day,
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${hash(n)}`,
    correct,
    score: correct ? 0.8 : 0.3,
    confidence: null,
    source_ids: [],
    session_id: session,
    payload: { grade: correct ? 4 : 2 },
    ...extra,
  };
}

function rating(n: number, day: string, confidence: 1 | 2 | 3): LearningEvent {
  return {
    id: `r${n}-${day}`,
    created_at: `${day}T09:00:00Z`,
    local_date: day,
    material_id: null,
    kind: 'self_rating',
    item_key: `q:${hash(n)}`,
    correct: null,
    score: null,
    confidence,
    source_ids: [],
    session_id: null,
    payload: {},
  };
}

// ------------------------------------------------------------------------------------ helpers

let location = '';
function Where() {
  const current = useLocation();
  location = `${current.pathname}${current.search}${current.hash}`;
  return null;
}

function renderDetail(options: { strict?: boolean; path?: string } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[options.path ?? '/exams/exam-1']}>
      <Routes>
        <Route path="/exams/:id" element={<ExamDetail />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <Where />
    </MemoryRouter>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

async function opened() {
  await screen.findByRole('heading', { level: 1, name: 'Макроэкономика' });
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
/** Accessible names keep the no-break spaces of Russian typesetting; compare them as plain spaces. */
const named = (text: string) => (name: string) => plain(name) === text;
const row = (id: string) => document.getElementById(`exam-q-${id}`) as HTMLElement;
const column = () => screen.getByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' });
/** The status block at the top: what Meldy did, what it found, the one thing to do next. */
const statusCard = () => document.querySelector('.ex-st') as HTMLElement;
const statusText = () => plain(statusCard()?.querySelector('.ex-st-text')?.textContent);
const statusNotes = () => Array.from(document.querySelectorAll('.ex-st .ex-st-note')).map((note) => plain(note.textContent));
const statusBlocked = () => plain(document.querySelector('.ex-st .ex-st-blocked')?.textContent);
/** Waits until the status's headline says this. */
const statusSays = (title: string) => screen.findByRole('heading', { level: 2, name: named(title) }, { timeout: 3000 });
const statusTitle = () => plain(statusCard()?.querySelector('.ex-st-title')?.textContent);

const enc = new TextEncoder();

/** An SSE response the test feeds event by event. */
function liveStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    send: (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)),
    close: () => controller.close(),
  };
}

/**
 * The page also reads through Supabase REST over the same fetch (the answer-text consent, lib/oral/answerTexts), in an
 * order that depends on timing: those reads get an empty list, and the mapping assertions count only the calls to /api/
 * (one full run once saw the consent read land first and take the place of the mapping call).
 */
function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
function apiFetch(answer: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    return url.startsWith('/api/') ? answer(url) : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });
}
function apiCalls(fetchMock: { mock: { calls: unknown[][] } }): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit]>)
    .map(([input, init]): [string, RequestInit] => [urlOf(input), init])
    .filter(([url]) => url.startsWith('/api/'));
}

function item(id: string, coverage: string, extra: Record<string, unknown> = {}) {
  return { question_id: id, coverage, method: 'llm', reason: '', missing: '', evidence: [], nearest: [], mapped_at: new Date().toISOString(), reused: false, ...extra };
}

const RUNNING = () => ({ mapping_state: 'running', mapping_started_at: new Date().toISOString(), mapped_at: null });
const FINISHED = () => ({ mapping_state: 'done', mapping_started_at: new Date().toISOString(), mapped_at: new Date().toISOString() });

const originalWidth = window.innerWidth;
function setWidth(value: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value });
}

/**
 * A phone as the stylesheets say it (lib/usePhone.ts: max-width 639px): the 390 px frame and the media query. jsdom
 * has no matchMedia of its own; afterEach takes it away again.
 */
function setPhone() {
  setWidth(390);
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

beforeEach(() => {
  resetMapJobsForTests({ pollIntervalMs: 5, pollLimitMs: 2000 });
  window.sessionStorage.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.fetchQuestionEvents.mockResolvedValue([]);
  mocks.fetchSessionPoints.mockResolvedValue([]);
  mocks.recordSelfRating.mockResolvedValue(undefined);
  mocks.incrementAIUsage.mockResolvedValue(undefined);
  mocks.verifyEnergy.mockResolvedValue(true);
  mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: false, count: 0, ok: true });
  mocks.fetchSheet.mockResolvedValue({ examId: 'exam-1', mappingState: 'none', questions: [], toWrite: 0, units: 0, job: null });
  mocks.fetchSheetEvents.mockResolvedValue([]);
  mocks.recordSheetPeek.mockResolvedValue(undefined);
  mocks.getProfile.mockResolvedValue(null);
  mocks.markOnboardingTourSeen.mockResolvedValue(undefined);
  mocks.confirm.mockResolvedValue(true);
  mocks.markQuestionManual.mockResolvedValue(undefined);
  // The student's other lectures are unknown unless a test says which there are (examLectureFit.ts).
  mocks.listLectureTitles.mockRejectedValue(new Error('no library in this test'));
  mocks.fetchLectureFit.mockResolvedValue({ questions: [], lectures: new Map(), unmatched: [], skipped: [] });
  mocks.useLearnLeft.mockReturnValue({ status: 'ready', exams: [], reload: () => undefined });
  setWidth(1280);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setWidth(originalWidth);
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

// ------------------------------------------------------------------------------------ the sheet

// What public.learn_left says of these questions (see the «Осталось выучить» describe).
type Fact = { state?: 0 | 1 | 2 | 3; ready?: boolean; missed?: boolean };
/** learn_left's exam of these questions: one lecture, the listed facts by position; «нет» not counted. */
function learnOf(questions: ExamQuestion[], facts: Record<number, Fact> = {}, extra: Record<string, unknown> = {}) {
  return {
    examId: 'exam-1', title: 'Макроэкономика', mappingState: 'done', lectures: [{ id: 'm1', title: 'Денежный рынок' }], sectionTitles: [], toWrite: 0, units: 0,
    questions: questions.map((q) => {
      const fact = facts[q.position] ?? {};
      const state = fact.state ?? 0;
      return {
        id: q.id, position: q.position, label: q.label ?? '', section: q.section, lecture: q.coverage === 'none' ? null : 0,
        kind: q.coverage === 'none' ? 'none' : q.coverage === null ? 'unmapped' : q.coverage === 'unverified' ? 'unverified' : 'lines', state, named: state === 3 || state === 2 ? 2 : state, of: 2,
        learnedAt: state === 3 ? Date.now() - 86_400_000 : null, readyAt: state === 2 ? Date.now() + (fact.ready ? -60_000 : 3_600_000) : null, missed: fact.missed ?? false,
      };
    }),
    ...extra,
  };
}
const learning = (exam: ReturnType<typeof learnOf>) => mocks.useLearnLeft.mockReturnValue({ status: 'ready', exams: [exam], reload: () => undefined });
/** learn_left read slowly: the hook says «loading» until the returned function hands it what it read. */
function slowLearn() {
  type Value = { status: 'loading' | 'ready' | 'error'; exams: unknown[]; reload: () => void };
  let value: Value = { status: 'loading', exams: [], reload: () => undefined };
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  mocks.useLearnLeft.mockImplementation(() => useSyncExternalStore(subscribe, () => value));
  return (exams: unknown[] = []) =>
    act(() => {
      value = { status: 'ready', exams, reload: () => undefined };
      for (const listener of listeners) listener();
    });
}

describe('ExamDetail: the sheet', () => {
  it('marks every coverage state in pencil, with words for screen readers, and every readiness on the number', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    mocks.fetchQuestionEvents.mockResolvedValue([
      answer(1, dayKey(-3), true, 's1'),
      answer(1, dayKey(-1), true, 's2'),
      answer(2, dayKey(-1), true, 's3'),
      answer(4, dayKey(-2), false, 's4'),
    ]);
    // The dots say what «Осталось выучить» says (decision 2026-10-21), not the answers' grades.
    learning(learnOf(mixed(), { 1: { state: 3 }, 2: { state: 1 }, 4: { missed: true } }));
    renderDetail();
    await opened();
    expect(screen.getByRole('heading', { level: 2, name: 'Макроэкономика: вопросы к экзамену' })).toBeInTheDocument();
    expect(document.title).toBe('Макроэкономика — Meldy');

    const coverage: Array<[string, string, string | null, string]> = [
      ['q1', 'full', 'tick', 'есть в лекциях'],
      ['q2', 'partial', 'cup', 'есть частично'],
      ['q3', 'none', 'dash', 'нет ни в одной лекции'],
      ['q4', 'unverified', 'dtick', 'найдено только по словам'],
      ['q5', 'unmapped', null, 'ещё не сверено с лекциями'],
      ['q6', 'full', 'tick', 'есть в лекциях'],
    ];
    for (const [id, state, mark, words] of coverage) {
      expect(row(id)).toHaveAttribute('data-coverage', state);
      // The pill sits at the top right of the question, inside its button, for the eye (owner's example of
      // 2026-10-08: a column of its own held 176 px beside every line); a screen reader hears the long words first.
      const pill = row(id).querySelector('.ex-open .ex-cov') as HTMLElement;
      expect(pill).toHaveAttribute('aria-hidden', 'true');
      expect(pill.querySelector('svg')?.getAttribute('data-mark') ?? null).toBe(mark);
      expect(row(id).firstElementChild).toHaveClass('ex-cov-sr');
      expect(row(id).firstElementChild).toHaveTextContent(words);
    }
    // Stored marks are simply there: nothing is drawn in on opening the sheet.
    expect(document.querySelectorAll('.ex-cov svg[data-drawn="live"]')).toHaveLength(0);

    await waitFor(() => expect(row('q1')).toHaveAttribute('data-readiness', 'confirmed'));
    expect(row('q1').querySelector('.ex-qn [data-mark="ring"]')).not.toBeNull();
    // The screen reader hears the same words as the key to the dots.
    expect(plain(row('q1').querySelector('.ex-qn')?.textContent)).toBe('1, выучен');
    expect(plain(row('q2').querySelector('.ex-qn')?.textContent)).toBe('2, начат');
    expect(plain(row('q4').querySelector('.ex-qn')?.textContent)).toBe('4, в прошлый раз ответ был неполным');
    expect(row('q2')).toHaveAttribute('data-readiness', 'once');
    expect(row('q2').querySelector('.ex-qn [data-mark="under"]')).not.toBeNull();
    expect(row('q4')).toHaveAttribute('data-readiness', 'not_passed');
    expect(row('q4').querySelector('.ex-qn [data-mark="wave"]')).not.toBeNull();
    expect(row('q3')).toHaveAttribute('data-readiness', 'untested');
    expect(row('q3').querySelector('.ex-qn [data-mark]')).toBeNull();

    // The right margin: the lecture and its fragment, then «там же» for the same lecture,
    // «отмечено вами», nothing for a gap.
    expect(plain(row('q1').querySelector('.ex-qnote')?.textContent)).toBe('Денежный рынок, фрагмент 1');
    expect(plain(row('q2').querySelector('.ex-qnote')?.textContent)).toBe('там же, фрагмент 2');
    expect(row('q2').querySelector('.ex-qnote')).toHaveAttribute('title', 'Денежный рынок, фрагмент 2');
    expect(plain(row('q6').querySelector('.ex-qnote')?.textContent)).toBe('отмечено вами');
    expect(row('q3').querySelector('.ex-qnote')).toBeNull();
  });

  it('shows one figure in the column — the ticket share — and keeps the rest behind «Как считается» (owner, 2026-10-07)', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const side = column();
    expect(plain(side.querySelector('.ex-figs-now')?.textContent)).toBe('35 %');
    expect(side.querySelectorAll('.ex-big')).toHaveLength(1);
    expect(within(side).getByText('билетов, где оба вопроса есть в лекциях')).toBeInTheDocument();
    // No struck share, no figure of the gap, no line (c) on the card: the legend above the list counts the gap.
    expect(side.querySelector('.ex-figs-was, .ex-gap-n, .ex-gapline')).toBeNull();
    expect(plain(side.textContent)).not.toMatch(/в 15 % билетов|вопросов нет ни в одной лекции/);
    const how = within(side).getByRole('button', { name: 'Как считается' });
    expect(plain(how.closest('.ex-caveat')?.textContent)).toBe('Это доля билетов, а не вероятность сдать. Как считается');
    const action = side.querySelector('.ex-act') as HTMLElement;
    expect(plain(action.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
    // Nothing about answers before the first one: the status at the top says what to do.
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalled());
    expect(plain(side.textContent)).not.toMatch(/Ответов по билетам ещё не было|Сравнить уверенность|Выучено/);
    expect(document.body.textContent).not.toMatch(/шанс сдать|вы выучили|ИИ понимает/i);

    fireEvent.click(how);
    const calc = side.querySelector('.ex-calc') as HTMLElement;
    expect(plain(calc.querySelector('.ex-calc-q')?.textContent)).toBe('В лекциях есть 24 вопроса из 40 (60 %), частично — 7, ни в одной лекции — 9.');
    expect(within(calc).getByText(named('В 15 % билетов нет ни одного вопроса с отметкой «есть».'))).toBeInTheDocument();
    expect(within(calc).getByText('Это доля билетов, а не вероятность сдать: считаем, что билет — два случайных вопроса из 40.')).toBeInTheDocument();
    const formulas = within(side).getAllByRole('math');
    expect(plain(formulas[0].getAttribute('aria-label'))).toBe('Сочетания из 24 по 2, делённые на сочетания из 40 по 2: 276 из 780, примерно 35 %');
    expect(plain(formulas[1].textContent)).toContain('120780≈15 %');
  });
  it('filters the sheet from the legend and from «7 вопросов «частично»» of the action line', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const side = column();
    const legend = screen.getByRole('list', { name: 'Показать вопросы' });
    fireEvent.click(within(legend).getByRole('button', { name: 'нет ни в одной 9' }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(9);
    expect(Array.from(document.querySelectorAll('.ex-q')).every((item) => item.getAttribute('data-coverage') === 'none')).toBe(true);
    expect(within(legend).getByRole('button', { name: 'нет ни в одной 9' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(side).getByRole('button', { name: named('7 вопросов «частично»') }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(7);
    expect(within(legend).getByRole('button', { name: 'частично 7' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(side).getByRole('button', { name: named('7 вопросов «частично»') }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(40);
  });
  it('counts the numbers by the exam’s own layout: one question from each section', async () => {
    // Section 1: 13 «есть» · 4 «частично» · 3 «нет»; section 2: 11 · 3 · 6 (the seeded stage list).
    const none = new Set([5, 8, 17, 22, 26, 29, 35, 38, 40]);
    const partial = new Set([3, 9, 14, 19, 24, 33, 37]);
    const list = Array.from({ length: 40 }, (_, index) => {
      const n = index + 1;
      return question(n, none.has(n) ? 'none' : partial.has(n) ? 'partial' : 'full', { section: n <= 20 ? 1 : 2 });
    });
    mocks.loadExamBundle.mockResolvedValue(bundle(list, { ticket_layout: { mode: 'sections', per_ticket: 2, section_titles: ['Первый', 'Второй'] } }));
    renderDetail();
    await opened();
    const side = column();
    expect(plain(side.querySelector('.ex-figs-now')?.textContent)).toBe('36 %');
    expect(plain(side.querySelector('.ex-act')?.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
    fireEvent.click(within(side).getByRole('button', { name: 'Как считается' }));
    expect(within(side).getByText(named('В 16 % билетов нет ни одного вопроса с отметкой «есть».'))).toBeInTheDocument();
    const [main, gap] = within(side).getAllByRole('math').map((formula) => plain(formula.textContent));
    expect(main).toBe('1320×1120≈36 %');
    expect(gap).toBe('ни одного с отметкой «есть»:720×920≈16 %');
  });
  it('gives the figure as a range while questions are found only by words: 17 «есть», 10 «только по словам» → 43–68 % of questions', async () => {
    const list = Array.from({ length: 40 }, (_, index) => question(index + 1, index < 17 ? 'full' : index < 27 ? 'unverified' : 'none'));
    mocks.loadExamBundle.mockResolvedValue(bundle(list));
    renderDetail();
    await opened();
    const side = column();
    expect(side.querySelector('.ex-figs')).toHaveAttribute('data-range');
    fireEvent.click(within(side).getByRole('button', { name: 'Как считается' }));
    expect(plain(side.querySelector('.ex-calc-q')?.textContent)).toBe('В лекциях есть 17 вопросов из 40 (43–68 %), ни в одной лекции — 13, только по словам — 10.');
  });
  it('opens the sheet filtered by ?filter=cov:none with the legend item pressed; anything else shows all', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    const first = renderDetail({ path: '/exams/exam-1?filter=cov:none' });
    await opened();
    expect(document.querySelectorAll('.ex-q')).toHaveLength(9);
    expect(within(screen.getByRole('list', { name: 'Показать вопросы' })).getByRole('button', { name: 'нет ни в одной 9' })).toHaveAttribute('aria-pressed', 'true');
    first.unmount();
    renderDetail({ path: '/exams/exam-1?filter=garbage' });
    await opened();
    expect(document.querySelectorAll('.ex-q')).toHaveLength(40);
    expect(within(screen.getByRole('list', { name: 'Показать вопросы' })).getByRole('button', { name: 'Все 40' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('owner 21.10: a reload keeps the filter pressed and the question open (?filter=, ?open=)', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    window.history.replaceState(null, '', '/exams/exam-1');
    try {
      const first = renderDetail({ path: '/exams/exam-1' });
      await opened();
      const legend = screen.getByRole('list', { name: 'Показать вопросы' });
      const chip = within(legend).getAllByRole('button').find((button) => button.getAttribute('data-cov')) as HTMLElement;
      fireEvent.click(chip);
      const shown = document.querySelectorAll('.ex-q').length;
      const filter = new URLSearchParams(window.location.search).get('filter');
      expect(filter).toMatch(/^cov:/);
      const open = document.querySelector<HTMLButtonElement>('.ex-q .ex-open') as HTMLButtonElement;
      fireEvent.click(open);
      const openId = new URLSearchParams(window.location.search).get('open');
      expect(openId).toBeTruthy();
      first.unmount();

      renderDetail({ path: `${window.location.pathname}${window.location.search}` });
      await opened();
      expect(document.querySelectorAll('.ex-q')).toHaveLength(shown);
      expect(within(screen.getByRole('list', { name: 'Показать вопросы' })).getAllByRole('button').find((button) => button.getAttribute('aria-pressed') === 'true')?.getAttribute('data-cov')).toBe(
        chip.getAttribute('data-cov'),
      );
      await waitFor(() => expect(row(openId as string)).toHaveAttribute('data-selected'));
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('opens a readiness filter from the address too', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(3, dayKey(-1), false, 's3')]);
    learning(learnOf(forty(), { 3: { missed: true } }));
    renderDetail({ path: '/exams/exam-1?filter=rd:not_passed' });
    await opened();
    await waitFor(() => expect(document.querySelectorAll('.ex-q')).toHaveLength(1));
    const legend = await within(column()).findByRole('list', { name: 'Показать вопросы по ответам' });
    expect(within(legend).getByRole('button', { name: 'в прошлый раз ответ был неполным 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the key to the dots counts them by «Осталось выучить», and its rows filter the list (owner, 2026-10-21)', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue(
      [1, 2, 3, 4, 5, 6].flatMap((n) => [answer(n, dayKey(-9), true, `s${n}a`), answer(n, dayKey(-2), true, `s${n}b`)]),
    );
    learning(learnOf(forty(), { 1: { state: 3 }, 2: { state: 3 }, 3: { state: 3 }, 4: { state: 3 }, 5: { state: 3 }, 6: { state: 3 } }));
    renderDetail();
    await opened();
    // «Осталось выучить» took the place of «Подтверждено ответами» and its history.
    expect(plain(column().textContent)).not.toMatch(/Подтверждено|подтвержд|0 → 6/);
    const legend = await within(column()).findByRole('list', { name: 'Показать вопросы по ответам' });
    expect(within(legend).getAllByRole('button').map((item) => plain(item.textContent).replace(/^12/, ''))).toEqual([
      'выучен 6',
      'начат 0',
      'в прошлый раз ответ был неполным 0',
      'ещё не отвечали 34',
    ]);
    fireEvent.click(within(legend).getByRole('button', { name: 'выучен 6' }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(6);
    fireEvent.click(within(legend).getByRole('button', { name: 'ещё не отвечали 34' }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(34);
  });

  it('«почему» says where the question stands by the same rule as its dot', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-30), true, 's1a'), answer(1, dayKey(-20), true, 's1b'), answer(2, dayKey(-1), true, 's2')]);
    learning(learnOf(forty(), { 1: { state: 3 }, 2: { state: 1 } }));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 1 о денежном рынке' }));
    expect(await within(column()).findByText('Выучен.')).toBeInTheDocument();
    expect(plain(column().textContent)).not.toMatch(/пора проверить|Подтверждено/);
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 2 о денежном рынке' }));
    expect(await within(column()).findByText(named('В ответе 1 главный пункт из 2.'))).toBeInTheDocument();
  });

  it('filters the sheet by a coverage mark and back', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    renderDetail();
    await opened();
    const filters = screen.getByRole('list', { name: 'Показать вопросы' });
    expect(within(filters).getAllByRole('button').map((button) => plain(button.textContent))).toEqual([
      'Все 6',
      'есть в лекциях 2',
      'частично 1',
      'нет ни в одной 1',
      'только по словам 1',
      'не сверено 1',
    ]);
    const none = within(filters).getByRole('button', { name: 'нет ни в одной 1' });
    fireEvent.click(none);
    expect(none).toHaveAttribute('aria-pressed', 'true');
    expect(Array.from(document.querySelectorAll('.ex-q')).map((item) => item.id)).toEqual(['exam-q-q3']);
    fireEvent.click(none);
    expect(none).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelectorAll('.ex-q')).toHaveLength(6);
  });

  it('names the lecture again after a section heading, a row without a note and a filter change, «там же» in between', async () => {
    const list = [
      question(1, 'full', { section: 1 }),
      question(2, 'full', { section: 1 }),
      question(3, 'none', { section: 1 }),
      question(4, 'partial', { section: 1 }),
      question(5, 'full', { section: 2 }),
      question(6, 'full', {
        section: 2,
        evidence: [{ material_id: 'm2', material_title: 'Инфляция', source_id: 'S03', excerpt: 'Фрагмент.' }],
      }),
      question(7, 'full', { section: 2 }),
    ];
    mocks.loadExamBundle.mockResolvedValue(bundle(list, { ticket_layout: { mode: 'random', per_ticket: 2, section_titles: ['Деньги', 'Цены'] } }));
    renderDetail();
    await opened();
    const note = (id: string) => plain(row(id).querySelector('.ex-qnote')?.textContent);
    expect(note('q1')).toBe('Денежный рынок, фрагмент 1');
    expect(note('q2')).toBe('там же, фрагмент 2');
    // «Там же» means the line right above: after the dash of q3 the lecture is named again
    // (redesign critique 7, round 2).
    expect(row('q3').querySelector('.ex-qnote')).toBeNull();
    expect(note('q4')).toBe('Денежный рынок, фрагмент 4');
    // A new section names the lecture again; another lecture is named; back to the first — named.
    expect(note('q5')).toBe('Денежный рынок, фрагмент 5');
    expect(note('q6')).toBe('Инфляция, фрагмент 3');
    expect(note('q7')).toBe('Денежный рынок, фрагмент 7');

    fireEvent.click(within(screen.getByRole('list', { name: 'Показать вопросы' })).getByRole('button', { name: 'частично 1' }));
    expect(note('q4')).toBe('Денежный рынок, фрагмент 4');
  });

  it('keeps the fragment of a long lecture name on its own line, so the two-line name never cuts it off', async () => {
    const long = 'Нейронные сети и глубокое обучение';
    const list = [
      question(1, 'full', { section: 1, evidence: [{ material_id: 'm9', material_title: long, source_id: 'S03', excerpt: 'Фрагмент.' }] }),
      question(2, 'full', { section: 1, evidence: [{ material_id: 'm9', material_title: long, source_id: 'S04', excerpt: 'Фрагмент.' }] }),
      question(3, 'full', { section: 1, evidence: [{ material_id: 'm2', material_title: 'Инфляция', source_id: 'S01', excerpt: 'Фрагмент.' }] }),
    ];
    mocks.loadExamBundle.mockResolvedValue(bundle(list));
    renderDetail();
    await opened();
    const first = row('q1').querySelector('.ex-qnote') as HTMLElement;
    expect(plain(first.textContent)).toBe(`${long}, фрагмент 3`);
    expect(first.querySelector('.ex-qnote-lead')?.textContent).toBe(`${long},`);
    expect(first.querySelector('.ex-qnote-frag')?.textContent).toBe('фрагмент 3');
    expect(first).not.toHaveAttribute('data-short');
    // «там же» is one line; a short first mention stays on one line too.
    expect(row('q2').querySelector('.ex-qnote-frag')).toBeNull();
    expect(plain(row('q2').querySelector('.ex-qnote')?.textContent)).toBe('там же, фрагмент 4');
    expect(row('q3').querySelector('.ex-qnote')).toHaveAttribute('data-short');
  });

  it('heads the sheet with the subject, not «Экзамен: … : вопросы к экзамену»', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed(), { title: 'Экзамен: цифровая экономика' }));
    renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'Цифровая экономика' })).toHaveAttribute('title', 'Экзамен: цифровая экономика');
    expect(screen.getByRole('heading', { level: 2, name: 'Цифровая экономика: вопросы к экзамену' })).toBeInTheDocument();
  });

  it('dates the mapping by exams.mapped_at and says when lectures changed after it', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty(), { mapped_material_ids: ['m1'] }));
    renderDetail();
    await opened();
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toBe(
      'Экзамен · 40 вопросов, в билете два · 2 лекции · сверка от 21 января, 9:40',
    );
    expect(document.body.textContent).not.toContain('25 января');
    await statusSays('После сверки добавлена 1 лекция');
    expect(statusText()).toBe('Пометки в списке сделаны без неё. Сверьте заново — Meldy проверит вопросы и по новой лекции. Это стоит 10 единиц ИИ.');
    expect(within(statusCard()).getByRole('button', { name: 'Сверить заново' })).toHaveClass('sf-primary');
  });
  it('asks for lectures when the exam has none', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, null), question(2, null)], { mapping_state: 'none', mapped_at: null, mapped_material_ids: [] }, []));
    renderDetail();
    await opened();
    await statusSays('К экзамену не добавлены лекции');
    expect(statusText()).toBe('Meldy ищет ответы на вопросы в ваших лекциях. Добавьте лекции по этому предмету, и он отметит, на какие вопросы в них есть ответ.');
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toContain('сверки ещё нет');
    // Nothing to say beside the list before a question is checked.
    expect(screen.queryByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' })).toBeNull();
    const add = within(statusCard()).getByRole('link', { name: 'Добавить лекции' });
    expect(add).toHaveClass('sf-primary');
    fireEvent.click(add);
    expect(location).toBe('/exams/exam-1/edit#lectures');
  });
  it('says plainly when the exam is gone or could not be read', async () => {
    mocks.loadExamBundle.mockResolvedValueOnce(null);
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Экзамен не найден' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    cleanup();

    mocks.loadExamBundle.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(bundle(mixed()));
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Не удалось открыть лист экзамена' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await opened();
  });

  it('says nothing about answers until the history is read: no «ответов ещё не было», no counts, no confidence', async () => {
    let answer!: (events: LearningEvent[]) => void;
    mocks.fetchQuestionEvents.mockReturnValue(new Promise<LearningEvent[]>((resolve) => (answer = resolve)));
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const side = column();
    expect(within(side).getByText('билетов, где оба вопроса есть в лекциях')).toBeInTheDocument();
    expect(plain(document.body.textContent)).not.toMatch(/Ответов по билетам ещё не было|Выучено|Сравнить уверенность|Вы отметили/);
    expect(within(side).queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
    // The status waits for the answers too; after 300 ms one quiet line says what is going on.
    expect(statusCard()).toHaveAttribute('aria-busy', 'true');
    expect(await within(statusCard()).findByText('Загружаем темы и ответы…')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Самооценка' })[0]);
    expect(screen.queryByRole('button', { name: /Знаю: \d+\. Показать эти вопросы/ })).toBeNull();
    expect(await within(column()).findByText('Загружаем историю ответов…')).toBeInTheDocument();

    answer([rating(2, dayKey(-1), 3)]);
    expect(await screen.findByRole('button', { name: 'Знаю: 1. Показать эти вопросы' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Готово' })[0]);
    await statusSays('Можно отвечать на билеты');
    // No answers yet: no answers card at all, and the status leads to the first ticket.
    expect(plain(column().textContent)).not.toMatch(/Ответов по билетам ещё не было|Выучено|Загружаем историю ответов/);
    expect(within(statusCard()).getByRole('link', { name: 'Тянуть билет' })).toHaveClass('sf-primary');
  });
  it('reads the answer history next to the lecture titles, not after them', async () => {
    let titles!: () => void;
    mocks.loadExamBundle.mockImplementation(async (_id: string, options?: { onQuestions?: (questions: ExamQuestion[]) => void }) => {
      const value = bundle(mixed());
      options?.onQuestions?.(value.questions);
      await new Promise<void>((resolve) => (titles = resolve));
      return value;
    });
    renderDetail();
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalledTimes(1));
    expect(mocks.fetchQuestionEvents.mock.calls[0][0]).toEqual(mixed().map((item) => item.question_hash));
    titles();
    await opened();
    expect(mocks.fetchQuestionEvents).toHaveBeenCalledTimes(1);
  });

  it('still shows the sheet when the answer history cannot be read', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    mocks.fetchQuestionEvents.mockRejectedValueOnce(new Error('Не удалось загрузить историю ответов. Повторите попытку.')).mockResolvedValue([]);
    renderDetail();
    await opened();
    await waitFor(() => expect(statusNotes()).toContain('Не удалось загрузить историю ответов. Повторите попытку. Повторить'));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(6);
    // Nothing is said about answers or confidence that the journal would have to back.
    expect(plain(column().textContent)).not.toMatch(/Ответов по билетам ещё не было|Сравнить уверенность/);
    fireEvent.click(within(statusCard()).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalledTimes(2));
  });
});

// ------------------------------------------------------------------------------------ the status block

/** The owner's exam of 2026-10-07: 18 general-informatics questions mapped against one lab-work file, all «нет». */
const INFORMATICS = [
  'Информация и информационные процессы.',
  'Свойства информации.',
  'Измерение информации: алфавитный и содержательный подходы.',
  'Единицы измерения информации.',
  'Системы счисления: позиционные и непозиционные.',
  'Перевод чисел из одной системы счисления в другую.',
  'Двоичная арифметика.',
  'Кодирование текстовой информации.',
  'Кодирование графической информации.',
  'Кодирование звуковой информации.',
  'Архитектура компьютера: принципы фон Неймана.',
  'Поколения ЭВМ.',
  'Процессор и его характеристики.',
  'Память компьютера: виды и характеристики.',
  'Устройства ввода и вывода информации.',
  'Программное обеспечение: классификация.',
  'Операционные системы и их функции.',
  'Файловая система и файлы.',
];
const PR9 = [{ id: 'pr9', title: 'ПР 9' }];
function informatics(coverage: (index: number) => ExamQuestion['coverage'] = () => 'none'): ExamQuestion[] {
  return INFORMATICS.map((text, index) => question(index + 1, coverage(index), { text, coverage_reason: coverage(index) === 'none' ? 'Нет подтверждающего фрагмента' : '' }));
}
function ownerBundle(extra: Partial<ExamBundle> = {}, coverage?: (index: number) => ExamQuestion['coverage']): ExamBundle {
  return { ...bundle(informatics(coverage), { title: 'Информатика', mapped_material_ids: ['pr9'] }, PR9), ...extra };
}

describe('ExamDetail: the status block (owner, 2026-10-07)', () => {
  // A written sheet makes the page remember «Шпаргалка» for the next visit: not for the next test.
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('the owner’s exam: says the lecture has no answers and why, sends to the exam’s lectures; «Тянуть билет» steps down, the empty column goes', async () => {
    mocks.loadExamBundle.mockResolvedValue(ownerBundle());
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: 'Информатика' });
    const heading = await statusSays('В лекции «ПР 9» нет ответов на эти вопросы');
    expect(heading).toBe(document.querySelector('.ex-st .ex-st-title'));
    expect(plain(statusCard().querySelector('.ex-st-mark')?.textContent)).toBe('нет ответов');
    expect(statusText()).toBe(
      'Meldy сверил с ней все 18 вопросов и не нашёл ни одного ответа. Выберите лекции по темам вопросов или добавьте новые, потом сверьте заново.',
    );
    const action = within(statusCard()).getByRole('link', { name: 'Выбрать или добавить лекции' });
    expect(action).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(action).toHaveClass('sf-primary');
    // No ticket, not even a quiet one: none of the questions has points to check an answer against (live check 07.10).
    expect(within(statusCard()).queryByRole('link', { name: 'Тянуть билет' })).toBeNull();
    expect(document.querySelectorAll('.sf-page .sf-primary')).toHaveLength(1);
    // The status comes before the views and the list.
    expect(statusCard().compareDocumentPosition(document.querySelector('.ex-sheet') as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing beside the list: «0 % билетов…» and «Ответов ещё не было» said nothing.
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalled());
    expect(screen.queryByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/0\s%|Ответов по билетам ещё не было|Сравнить уверенность/);
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toBe('Экзамен · 18 вопросов, в билете два · 1 лекция · сверка от 21 января, 9:40');
  });

  it('the owner’s exam on a phone: the action rides in the bar at the bottom, no ticket anywhere, nothing above the list says «0 %»', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(ownerBundle());
    renderDetail();
    await statusSays('В лекции «ПР 9» нет ответов на эти вопросы');
    const cta = document.querySelector('.ex-cta') as HTMLElement;
    expect(within(cta).getByRole('link', { name: 'Выбрать или добавить лекции' })).toHaveClass('sf-primary');
    expect(within(cta).queryByRole('link', { name: 'Тянуть билет' })).toBeNull();
    expect(within(statusCard()).queryByRole('link', { name: 'Тянуть билет' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Сводка' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ответы по билетам' })).toBeNull();
  });

  it('almost nothing found with several lectures: «почти нет ответов», how many were found', async () => {
    const lectures = [
      { id: 'a', title: 'Тема 4.3 Использование роли пользователей и формальные цели' },
      { id: 'b', title: 'Вар 1' },
      { id: 'c', title: 'Что такое PGP' },
    ];
    mocks.loadExamBundle.mockResolvedValue(bundle(informatics((index) => (index < 2 ? 'full' : index === 2 ? 'partial' : 'none')), { mapped_material_ids: ['a', 'b', 'c'] }, lectures));
    renderDetail();
    await statusSays('В выбранных лекциях почти нет ответов на эти вопросы');
    expect(statusText()).toBe('Ответ нашёлся только для 3 вопросов из 18. Выберите лекции по темам остальных или добавьте новые, потом сверьте заново.');
    expect(screen.queryByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' })).toBeNull();
  });

  it('nothing found: names the student’s other lecture that fits the questions (two or more), not the exam’s own one', async () => {
    mocks.loadExamBundle.mockResolvedValue(ownerBundle());
    mocks.listLectureTitles.mockResolvedValue([
      { id: 'pr9', title: 'ПР 9' },
      { id: 't1', title: 'Тема 1. Информация' },
      { id: 'econ', title: 'Эластичность спроса' },
    ]);
    mocks.fetchLectureFit.mockResolvedValue({ questions: [], lectures: new Map([['t1', [0, 1, 2]], ['econ', [5]]]), unmatched: [], skipped: [] });
    renderDetail();
    await statusSays('В лекции «ПР 9» нет ответов на эти вопросы');
    await waitFor(() =>
      expect(statusText()).toBe(
        'Meldy сверил с ней все 18 вопросов и не нашёл ни одного ответа. Подходит ваша лекция «Тема 1. Информация»: выберите её и сверьте заново.',
      ),
    );
    expect(within(statusCard()).getByRole('link', { name: 'Выбрать лекцию' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(mocks.fetchLectureFit).toHaveBeenCalledTimes(1);
    const [request] = mocks.fetchLectureFit.mock.calls[0];
    expect(request.materialIds).toEqual(['t1', 'econ']);
    expect(request.questions).toHaveLength(18);
  });

  it('nothing found and no other lecture: says that none of the student’s lectures fits, without asking the server', async () => {
    mocks.loadExamBundle.mockResolvedValue(ownerBundle());
    mocks.listLectureTitles.mockResolvedValue([{ id: 'pr9', title: 'ПР 9' }]);
    renderDetail();
    await waitFor(() =>
      expect(statusText()).toBe(
        'Meldy сверил с ней все 18 вопросов и не нашёл ни одного ответа. Среди ваших лекций подходящих нет. Добавьте лекции по темам вопросов и сверьте заново.',
      ),
    );
    expect(within(statusCard()).getByRole('link', { name: 'Добавить лекции' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(mocks.fetchLectureFit).not.toHaveBeenCalled();
  });

  it('a mapped exam does not ask which lectures fit', async () => {
    mocks.loadExamBundle.mockResolvedValue(ownerBundle({}, (index) => (index < 14 ? 'full' : 'none')));
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: 'Информатика' });
    await waitFor(() => expect(statusCard()).toBeTruthy());
    expect(mocks.listLectureTitles).not.toHaveBeenCalled();
    expect(mocks.fetchLectureFit).not.toHaveBeenCalled();
  });

  it('a copy from a group link: no list editing or inviting, «копия из ссылки группы», the member’s words when the author’s lecture has nothing', async () => {
    mocks.loadExamBundle.mockResolvedValue(ownerBundle({ copy: true }));
    renderDetail();
    await statusSays('В лекции «ПР 9» нет ответов на эти вопросы');
    expect(statusText()).toBe(
      'Эту лекцию выбрал автор ссылки, и Meldy не нашёл в ней ни одного ответа. Добавьте свои лекции по темам вопросов и сверьте заново (10 единиц ИИ) — или попросите у автора новую ссылку.',
    );
    expect(within(statusCard()).getByRole('link', { name: 'Добавить свои лекции' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toBe('Экзамен · 18 вопросов, в билете два · 1 лекция · копия из ссылки группы');
    const links = document.querySelector('.ex-links') as HTMLElement;
    expect(within(links).queryByText('Изменить список')).toBeNull();
    expect(within(links).queryByRole('button', { name: 'Пригласить группу' })).toBeNull();
    expect(within(links).getByRole('link', { name: 'Лекции' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
  });

  it('a copy from a group link, ready: its own words, «Тянуть билет», no mapping and no units', async () => {
    mocks.loadExamBundle.mockResolvedValue({ ...bundle(forty()), copy: true });
    renderDetail();
    await statusSays('Экзамен из ссылки группы готов');
    expect(statusText()).toBe('Вопросы уже сверены с лекциями автора. Тяните билет и отвечайте вслух.');
    expect(mocks.fetchSheet).not.toHaveBeenCalled();
    expect(within(statusCard()).getByRole('link', { name: 'Тянуть билет' })).toHaveClass('sf-primary');
    expect(plain(statusCard().textContent)).not.toMatch(/единиц|Сверить|сверьте/);
  });

  it('shows the key to the dots only after the first answer, and the confidence line only after «Самооценка»', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-3), true, 's1'), answer(1, dayKey(-1), true, 's2')]);
    const first = renderDetail();
    await opened();
    expect(within(column()).queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
    first.unmount();

    learning(learnOf(forty(), { 1: { state: 3 } }));
    const second = renderDetail();
    await opened();
    await within(column()).findByRole('list', { name: 'Показать вопросы по ответам' });
    expect(plain(column().textContent)).not.toContain('Сравнить уверенность');
    expect(within(column()).queryByRole('button', { name: 'Самооценка' })).toBeNull();
    second.unmount();

    mocks.fetchQuestionEvents.mockResolvedValue([rating(2, dayKey(-2), 3), answer(1, dayKey(-3), true, 's1'), answer(1, dayKey(-1), true, 's2')]);
    renderDetail();
    await opened();
    expect(await within(column()).findByText(/Пока мало ответов, чтобы сравнить их/)).toBeInTheDocument();
    expect(within(column()).getByRole('button', { name: 'Самооценка' })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------------ «почему»

describe('ExamDetail: «почему»', () => {
  it('opens the evidence of a question in the lectures; each attempt opens its protocol', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-3), true, 'session-a'), answer(1, dayKey(-1), false, 'session-b')]);
    renderDetail();
    await opened();
    const open = screen.getByRole('button', { name: 'Вопрос 1 о денежном рынке' });
    fireEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(row('q1')).toHaveAttribute('data-selected');

    const side = column();
    expect(within(side).getByRole('heading', { name: named('Есть в ваших лекциях') })).toBeInTheDocument();
    expect(within(side).getByText('Во фрагменте есть определение')).toBeInTheDocument();
    expect(within(side).getByText('Фрагмент о вопросе 1.')).toBeInTheDocument();
    await waitFor(() => expect(within(side).getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('session='))).toHaveLength(2));
    const protocols = within(side)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.includes('session='));
    expect(protocols).toEqual(['/exams/exam-1/ticket?session=session-b', '/exams/exam-1/ticket?session=session-a']);
    expect(within(side).getByRole('link', { name: 'Ответить на этот вопрос' })).toHaveAttribute('href', '/exams/exam-1/ticket?q=q1');
    // One filled pill while «почему» is open: its answer link; the status's own action steps down to the white
    // pill (redesign critique 6, round 2). The answers are «Ответы», a written one counts too.
    expect(within(side).getByRole('link', { name: 'Ответить на этот вопрос' })).toHaveClass('sf-primary');
    expect(within(statusCard()).getByRole('button', { name: 'Сверить с лекциями' })).toHaveClass('ex-secondary');
    expect(document.querySelectorAll('.sf-page .sf-primary')).toHaveLength(1);
    expect(within(side).getByText('Ответы')).toBeInTheDocument();
    expect(within(side).queryByText('Ответы вслух')).toBeNull();

    fireEvent.click(within(side).getByRole('button', { name: 'Закрыть' }));
    expect(within(statusCard()).getByRole('button', { name: 'Сверить с лекциями' })).toHaveClass('sf-primary');
    expect(screen.queryByRole('heading', { name: named('Есть в ваших лекциях') })).toBeNull();
    expect(within(column()).getByText('билетов, где оба вопроса есть в лекциях')).toBeInTheDocument();
  });

  it('keeps the status’s pill filled while the panel’s «Ответить на этот вопрос» is out of the window', async () => {
    // Audit of 2026-10-08 at 1532×734: the status stepped down to white for a link 1 482 px down the column, and the
    // window had no filled pill at all.
    type Report = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
    const watched: Array<{ element: Element; report: Report }> = [];
    class FakeObserver {
      private report: Report;
      constructor(report: Report) {
        this.report = report;
      }
      observe(element: Element) {
        watched.push({ element, report: this.report });
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    try {
      mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
      renderDetail();
      await opened();
      fireEvent.click(screen.getByRole('button', { name: 'Вопрос 1 о денежном рынке' }));
      const go = within(column()).getByRole('link', { name: 'Ответить на этот вопрос' });
      const seen = watched.find((entry) => entry.element === go)!;
      act(() => seen.report([{ isIntersecting: false, intersectionRatio: 0 }]));
      expect(within(statusCard()).getByRole('button', { name: 'Сверить с лекциями' })).toHaveClass('sf-primary');
      act(() => seen.report([{ isIntersecting: true, intersectionRatio: 1 }]));
      expect(within(statusCard()).getByRole('button', { name: 'Сверить с лекциями' })).toHaveClass('ex-secondary');
      expect(document.querySelectorAll('.sf-page .sf-primary')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('explains a gap with the nearest fragment and marks it by hand only after a confirmation', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 3 о денежном рынке' }));
    const side = column();
    expect(within(side).getByRole('heading', { name: named('Ни в одной из 2 лекций нет фрагмента об этом') })).toBeInTheDocument();
    expect(within(side).getByText(/Ближе всего — «Инфляция», фрагмент.7: совпало только слово «цен»/)).toBeInTheDocument();
    expect(within(side).queryByRole('link', { name: 'Ответить на этот вопрос' })).toBeNull();
    // No answer to offer here: the status's action stays the filled pill.
    expect(within(statusCard()).getByRole('button', { name: 'Сверить с лекциями' })).toHaveClass('sf-primary');
    expect(within(side).getByRole('link', { name: 'Добавить материал к вопросу' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');

    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(within(side).getByRole('button', { name: 'Это есть в лекции…' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.markQuestionManual).not.toHaveBeenCalled();

    fireEvent.click(within(side).getByRole('button', { name: 'Это есть в лекции…' }));
    await waitFor(() => expect(mocks.markQuestionManual).toHaveBeenCalledWith('q3'));
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Отметить вручную?' }));
    await waitFor(() => expect(row('q3')).toHaveAttribute('data-coverage', 'full'));
    expect(plain(row('q3').querySelector('.ex-qnote')?.textContent)).toBe('отмечено вами');
    expect(within(column()).getByRole('heading', { name: named('Отмечено вами') })).toBeInTheDocument();
  });

  it('keeps the gap when the manual mark is not saved', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    const { ExamApiError } = await import('../api/exams');
    mocks.markQuestionManual.mockRejectedValue(new ExamApiError('Отметка не сохранена. Проверьте связь и повторите.'));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 3 о денежном рынке' }));
    fireEvent.click(within(column()).getByRole('button', { name: 'Это есть в лекции…' }));
    expect(await within(column()).findByRole('alert')).toHaveTextContent('Отметка не сохранена');
    expect(row('q3')).toHaveAttribute('data-coverage', 'none');
  });
});

// ------------------------------------------------------------------------------------ self-rating

describe('ExamDetail: self-rating', () => {
  it('stores a rating at once and takes it back when saving fails', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    mocks.recordSelfRating
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Отметка не сохранена. Проверьте связь и повторите.'));
    renderDetail();
    await opened();
    const toggle = screen.getAllByRole('button', { name: 'Самооценка' })[0];
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Отметьте, насколько уверенно вы ответили бы на каждый вопрос.')).toBeInTheDocument();

    const first = screen.getByRole('group', { name: 'Самооценка, вопрос 1' });
    fireEvent.click(within(first).getByRole('button', { name: 'знаю' }));
    expect(within(first).getByRole('button', { name: 'знаю' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(mocks.recordSelfRating).toHaveBeenCalledWith({ questionHash: hash(1), rating: 'know', examId: 'exam-1', examQuestionId: 'q1', materialId: 'm1' }),
    );
    expect(screen.getByRole('button', { name: 'Знаю: 1. Показать эти вопросы' })).toBeInTheDocument();

    const second = screen.getByRole('group', { name: 'Самооценка, вопрос 2' });
    fireEvent.click(within(second).getByRole('button', { name: 'плаваю' }));
    expect(await within(second).findByRole('alert')).toHaveTextContent('Отметка не сохранена. Проверьте связь и повторите.');
    expect(within(second).getByRole('button', { name: 'плаваю' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'плаваю: 0. Показать эти вопросы' })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'знаю' })).toHaveAttribute('aria-pressed', 'true');

    // The counts filter the sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Знаю: 1. Показать эти вопросы' }));
    expect(Array.from(document.querySelectorAll('.ex-q')).map((item) => item.id)).toEqual(['exam-q-q1']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Готово' })[0]);
    expect(document.querySelectorAll('.ex-q')).toHaveLength(6);
    expect(screen.queryByRole('group', { name: 'Самооценка, вопрос 1' })).toBeNull();
  });

  it('shows the journal’s latest rating of each question', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    mocks.fetchQuestionEvents.mockResolvedValue([rating(2, dayKey(-3), 3), rating(2, dayKey(-1), 1)]);
    renderDetail();
    await opened();
    fireEvent.click(screen.getAllByRole('button', { name: 'Самооценка' })[0]);
    const second = await screen.findByRole('group', { name: 'Самооценка, вопрос 2' });
    await waitFor(() => expect(within(second).getByRole('button', { name: 'не знаю' })).toHaveAttribute('aria-pressed', 'true'));
    expect(within(second).getByRole('button', { name: 'знаю' })).toHaveAttribute('aria-pressed', 'false');
  });
});

// ------------------------------------------------------------------------------------ peak 3

describe('ExamDetail: mapping by lectures', () => {
  const unmapped = () => [question(1, null), question(2, null), question(3, null)];
  const notMapped = { mapping_state: 'none' as const, mapped_at: null };

  it('marks rows batch by batch, reused ones without animation, then reloads and charges the limit once', async () => {
    const learnReload = vi.fn();
    mocks.useLearnLeft.mockReturnValue({ status: 'ready', exams: [], reload: learnReload });
    const stream = liveStream();
    const fetchMock = apiFetch(() => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), notMapped))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, 'none'), question(3, 'partial')]));
    renderDetail();
    await opened();
    await statusSays('Вопросы ещё не сверены с лекциями');
    expect(statusText()).toBe('Meldy проверит каждый из 3 вопросов по 2 лекциям и отметит, где в них есть ответ. Это стоит 10 единиц ИИ.');
    fireEvent.click(screen.getByRole('button', { name: 'Сверить с лекциями' }));
    await waitFor(() => expect(apiCalls(fetchMock)).toHaveLength(1));
    expect(mocks.checkAILimit).toHaveBeenCalledWith('user-1', 10);
    expect(mocks.verifyEnergy).not.toHaveBeenCalled();
    const [url, init] = apiCalls(fetchMock)[0];
    expect(url).toBe('/api/exams/exam-1/map');
    expect(JSON.parse(String(init.body))).toEqual({ question_ids: null, force: false });

    stream.send({ type: 'start', questions: 3, to_check: 3, materials: [{ id: 'm1', title: 'Денежный рынок', fragments: 12 }], skipped: [] });
    await waitFor(() => expect(row('q1')).toHaveAttribute('data-coverage', 'checking'));
    await statusSays('Meldy сверяет вопросы с лекциями');
    expect(statusText()).toBe('Проверено 0 из 3. Пометки появляются в списке по ходу проверки; не закрывайте вкладку, пока сверка не закончится.');
    // The shares wait for the end of the run: no column beside the list now.
    expect(screen.queryByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' })).toBeNull();
    expect(screen.getByText('Изменить список').tagName).toBe('SPAN');

    stream.send({ type: 'reused', items: [item('q1', 'full', { reused: true })] });
    await waitFor(() => expect(row('q1')).toHaveAttribute('data-coverage', 'full'));
    expect(row('q1').querySelector('svg[data-mark="tick"]')).toHaveAttribute('data-drawn', 'still');
    expect(row('q2')).toHaveAttribute('data-coverage', 'checking');

    stream.send({ type: 'batch', index: 1, total: 1, items: [item('q2', 'none'), item('q3', 'partial')] });
    await waitFor(() => expect(row('q2')).toHaveAttribute('data-coverage', 'none'));
    expect(row('q2').querySelector('svg[data-mark="dash"]')).toHaveAttribute('data-drawn', 'live');
    expect(row('q3').querySelector('svg[data-mark="cup"]')).toHaveAttribute('data-drawn', 'live');
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toContain('проверено 3 из 3');
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();

    stream.send({
      type: 'done',
      state: 'done',
      counts: { full: 1, partial: 1, none: 1, unverified: 0 },
      reused: 1,
      oldest_mapped_at: EXAM_MAPPED_AT,
      mapped_at: new Date().toISOString(),
      used_ai: true,
    });
    stream.close();
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(statusNotes()).toContain('Часть сверки от 9:40, остальное сейчас.'));
    // The run found something: the column comes back with its one figure; «Осталось выучить» is read again.
    await waitFor(() => expect(column().querySelector('.ex-figs-now')).not.toBeNull());
    await waitFor(() => expect(learnReload).toHaveBeenCalledTimes(1));
    expect(mocks.fetchSheet).not.toHaveBeenCalled();
    expect(mocks.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementAIUsage).toHaveBeenCalledWith();
    expect(document.querySelectorAll('.ex-cov svg[data-drawn="live"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Изменить список' })).toHaveAttribute('href', '/exams/exam-1/edit');
  });

  it('charges nothing when the run did not use the model', async () => {
    const stream = liveStream();
    vi.stubGlobal('fetch', apiFetch(() => stream.response));
    mocks.loadExamBundle.mockResolvedValueOnce(bundle(unmapped(), notMapped)).mockResolvedValue(bundle([question(1, 'full'), question(2, 'full'), question(3, 'full')]));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Сверить с лекциями' }));
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
    stream.send({ type: 'start', questions: 3, to_check: 3, materials: [], skipped: [] });
    stream.send({ type: 'reused', items: ['q1', 'q2', 'q3'].map((id) => item(id, 'full', { reused: true })) });
    stream.send({ type: 'done', state: 'done', counts: { full: 3 }, reused: 3, used_ai: false });
    stream.close();
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('says in the header that the daily limit is used up — no dialog — and keeps the focus on the button (stage QA round 2)', async () => {
    const fetchMock = apiFetch(() => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    mocks.loadExamBundle.mockResolvedValue(bundle(unmapped(), notMapped));
    renderDetail();
    await opened();
    const button = screen.getByRole('button', { name: 'Сверить с лекциями' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(statusBlocked()).toMatch(/^Дневной лимит ИИ на сегодня исчерпан\. Он обновится в \d{1,2}:\d{2}\.$/));
    expect(statusBlocked()).not.toMatch(/в 0\d:/);
    expect(document.querySelector('.ex-st .ex-st-blocked[role="status"]')).toHaveTextContent('Дневной лимит ИИ на сегодня исчерпан');
    // The same button, still there, unavailable and focused: nothing to close, nothing to lose the focus to.
    expect(screen.getByRole('button', { name: 'Сверить с лекциями' })).toBe(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    expect(mocks.verifyEnergy).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.checkAILimit).toHaveBeenCalledTimes(1);
    expect(apiCalls(fetchMock)).toHaveLength(0);
  });

  it('says how much is left when the limit is not enough for a run', async () => {
    vi.stubGlobal('fetch', vi.fn());
    mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: false, count: 96, ok: true });
    mocks.loadExamBundle.mockResolvedValue(bundle(unmapped(), notMapped));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Сверить с лекциями' }));
    await waitFor(() => expect(statusBlocked()).toMatch(/^Сегодня осталось 4 единицы ИИ, а сверка расходует 10\. Лимит обновится в \d{1,2}:\d{2}\.$/));
  });

  it('keeps «Сверить с лекциями» in place while the limit is checked and hands the focus to the status’s headline when the run starts', async () => {
    const stream = liveStream();
    vi.stubGlobal('fetch', apiFetch(() => stream.response));
    let allow!: (value: unknown) => void;
    mocks.checkAILimit.mockReturnValue(new Promise((resolve) => (allow = resolve)));
    mocks.loadExamBundle.mockResolvedValue(bundle(unmapped(), notMapped));
    renderDetail();
    await opened();
    const button = screen.getByRole('button', { name: 'Сверить с лекциями' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toBeInTheDocument();
    expect(button).toHaveFocus();
    allow({ allowed: true, isPro: false, count: 0, ok: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сверить с лекциями' })).toBeNull());
    // The headline that now says what is going on takes the keyboard — never the page's body.
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: named('Meldy сверяет вопросы с лекциями') })).toHaveFocus());
    stream.close();
  });

  it('before the first run: the status holds the one filled pill «Сверить с лекциями», «Тянуть билет» is a quiet link, only «Все» in the filter (redesign critique 7)', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(unmapped(), notMapped));
    renderDetail();
    await opened();
    await statusSays('Вопросы ещё не сверены с лекциями');
    expect(document.querySelectorAll('.sf-page .sf-primary')).toHaveLength(1);
    expect(within(statusCard()).getByRole('button', { name: 'Сверить с лекциями' })).toHaveClass('sf-primary');
    const draw = within(statusCard()).getByRole('link', { name: 'Тянуть билет' });
    expect(draw).toHaveClass('sf-link');
    expect(draw).not.toHaveClass('sf-primary');
    // The header holds no pill of its own any more.
    expect(document.querySelector('.ex-head .sf-primary, .ex-head .ex-draw')).toBeNull();
    const filter = screen.getByRole('list', { name: 'Показать вопросы' });
    expect(within(filter).getAllByRole('button').map((item) => plain(item.textContent))).toEqual(['Все 3']);
    // Nothing is checked: nothing beside the list either.
    expect(screen.queryByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' })).toBeNull();
    expect(document.body.textContent).not.toContain('Доля билетов появится');
  });
  it('offers «Продолжить» after a dropped stream; a 409 then shows «Сверка ещё идёт» and polls until the exam is free', async () => {
    const first = liveStream();
    const answers = [
      first.response,
      new Response(JSON.stringify({ detail: 'Сверка с лекциями уже идёт' }), { status: 409, headers: { 'content-type': 'application/json' } }),
    ];
    const fetchMock = apiFetch(() => answers.shift() ?? new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    // The server wrote q1 before it sent it, then the stream broke (the lock is released as failed).
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), notMapped))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'failed' }));
    mocks.fetchExamMappingState.mockResolvedValueOnce(RUNNING()).mockResolvedValueOnce(RUNNING()).mockResolvedValue(FINISHED());
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Сверить с лекциями' }));
    await waitFor(() => expect(apiCalls(fetchMock)).toHaveLength(1));
    first.send({ type: 'start', questions: 3, to_check: 3, materials: [], skipped: [] });
    first.send({ type: 'batch', index: 1, total: 2, items: [item('q1', 'full')] });
    first.close();

    await statusSays('Сверка прервалась');
    expect(statusText()).toBe('Проверено 1 из 3. Продолжите — Meldy проверит оставшиеся 2 вопроса за 10 единиц ИИ.');
    expect(row('q1')).toHaveAttribute('data-coverage', 'full');
    // One status with one action: not also «2 вопроса ещё не сверены… Сверить».
    expect(within(statusCard()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Продолжить сверку']);
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Продолжить сверку' }));
    await waitFor(() => expect(apiCalls(fetchMock)).toHaveLength(2));
    await statusSays('Сверка уже идёт');
    expect(statusText()).toBe('Её запустили в другой вкладке или на другом устройстве. Список обновится сам, когда она закончится.');
    expect(screen.getByText('Изменить список').tagName).toBe('SPAN');
    await waitFor(() => expect(mocks.fetchExamMappingState).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(statusTitle()).not.toBe('Сверка уже идёт'));
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(3));
    expect(apiCalls(fetchMock)).toHaveLength(2);
  });

  it('waits for a run started elsewhere instead of starting another', async () => {
    const fetchMock = apiFetch(() => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), { mapping_state: 'running', mapping_started_at: new Date().toISOString(), mapped_at: null }))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, 'full'), question(3, 'none')]));
    mocks.fetchExamMappingState.mockResolvedValueOnce(RUNNING()).mockResolvedValue(FINISHED());
    renderDetail();
    await opened();
    await statusSays('Сверка уже идёт');
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(row('q3')).toHaveAttribute('data-coverage', 'none'));
    expect(apiCalls(fetchMock)).toHaveLength(0);
  });

  it('offers «Продолжить» for a run that stopped long ago', async () => {
    const stream = liveStream();
    const fetchMock = apiFetch(() => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'running', mapping_started_at: old, mapped_at: null }),
    );
    renderDetail();
    await opened();
    await statusSays('Сверка прервалась');
    expect(statusText()).toBe('Проверено 1 из 3. Продолжите — Meldy проверит оставшиеся 2 вопроса за 10 единиц ИИ.');
    // The meta line agrees with the status: how far the run got, never «сверки ещё нет».
    const meta = plain(document.querySelector('.ex-head .ex-meta')?.textContent);
    expect(meta).toContain('проверено 1 из 3, сверка прервалась');
    expect(meta).not.toContain('сверки ещё нет');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить сверку' }));
    await waitFor(() => expect(apiCalls(fetchMock)).toHaveLength(1));
    stream.close();
  });

  it('a run with nothing for the model (a group copy) is not held back by the units; one that needs it is', async () => {
    // Live run of 2026-10-07: «Сверить» on a copy asked for 10 free units, though the server answered to_check 0
    // and used_ai false. Every question here is checked against the lectures the exam has now.
    const stream = liveStream();
    const fetchMock = apiFetch(() => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'full'), question(2, 'partial'), question(3, 'none')], { mapping_state: 'running', mapping_started_at: old }),
    );
    renderDetail();
    await opened();
    // Every question was checked before the lock went stale: nothing goes to the model, nothing is charged.
    await statusSays('Сверка прервалась');
    expect(statusText()).toBe('Проверено 3 из 3, но сверка не успела завершиться. Запустите её ещё раз.');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить сверку' }));
    await waitFor(() => expect(apiCalls(fetchMock)).toHaveLength(1));
    expect(mocks.checkAILimit).not.toHaveBeenCalled();
    expect(plain(statusCard().textContent)).not.toMatch(/лимит/);
    stream.send({ type: 'start', questions: 3, to_check: 0, materials: [], skipped: [] });
    stream.send({ type: 'done', state: 'done', counts: { full: 1, partial: 1, none: 1 }, reused: 0, used_ai: false });
    stream.close();
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    cleanup();
    vi.unstubAllGlobals();
    resetMapJobsForTests({ pollIntervalMs: 5, pollLimitMs: 2000 });

    // A question not checked yet goes to the model: the units are checked first, as before.
    const refused = apiFetch(() => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', refused);
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'full'), question(2, null)], { mapping_state: 'running', mapping_started_at: old }),
    );
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить сверку' }));
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalledWith('user-1', 10));
    await waitFor(() => expect(statusBlocked()).toMatch(/^Дневной лимит ИИ на сегодня исчерпан/));
    expect(apiCalls(refused)).toHaveLength(0);
  });

  it('checks again only the questions found by words', async () => {
    const stream = liveStream();
    const fetchMock = apiFetch(() => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    const list = forty().map((item, index) => (index >= 20 && index < 24 ? question(index + 1, 'unverified') : item));
    mocks.loadExamBundle.mockResolvedValue(bundle(list));
    renderDetail();
    await opened();
    await statusSays('4 вопроса проверены только по словам');
    expect(statusText()).toBe('Сервис был занят, и Meldy сравнил их с лекциями только по совпадению слов. Проверьте их снова, это стоит 10 единиц ИИ.');
    // The action lives in the status; the column keeps its one figure.
    expect(within(column()).queryByRole('button', { name: 'Проверить снова' })).toBeNull();
    fireEvent.click(within(statusCard()).getByRole('button', { name: 'Проверить снова' }));
    await waitFor(() => expect(apiCalls(fetchMock)).toHaveLength(1));
    const [, init] = apiCalls(fetchMock)[0];
    expect(JSON.parse(String(init.body))).toEqual({ question_ids: ['q21', 'q22', 'q23', 'q24'], force: false });
    stream.close();
  });

  /** Runs one mapping of the three unmapped questions to the end: q1 «есть», q2 «нет», q3 «частично». */
  async function mapToTheEnd(afterRun: () => void) {
    const stream = liveStream();
    const fetchMock = apiFetch(() => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    mocks.loadExamBundle.mockResolvedValueOnce(bundle(unmapped(), notMapped));
    afterRun();
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Сверить с лекциями' }));
    await waitFor(() => expect(apiCalls(fetchMock)).toHaveLength(1));
    stream.send({ type: 'start', questions: 3, to_check: 3, materials: [], skipped: [] });
    stream.send({ type: 'reused', items: [item('q1', 'full', { reused: true })] });
    stream.send({ type: 'batch', index: 1, total: 1, items: [item('q2', 'none'), item('q3', 'partial')] });
    stream.send({ type: 'done', state: 'done', counts: { full: 1, partial: 1, none: 1, unverified: 0 }, reused: 1, oldest_mapped_at: EXAM_MAPPED_AT, mapped_at: EXAM_MAPPED_AT, used_ai: true });
    stream.close();
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(row('q2')).toHaveAttribute('data-coverage', 'none'));
  }
  const mappedRows = () => [question(1, 'full'), question(2, 'none'), question(3, 'partial')];

  it('shows a hand mark made after a finished run', async () => {
    await mapToTheEnd(() => mocks.loadExamBundle.mockResolvedValue(bundle(mappedRows())));
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 2 о денежном рынке' }));
    fireEvent.click(within(column()).getByRole('button', { name: 'Это есть в лекции…' }));
    await waitFor(() => expect(mocks.markQuestionManual).toHaveBeenCalledWith('q2'));
    await waitFor(() => expect(row('q2')).toHaveAttribute('data-coverage', 'full'));
    expect(plain(row('q2').querySelector('.ex-qnote')?.textContent)).toBe('отмечено вами');
    expect(within(column()).queryByRole('button', { name: 'Это есть в лекции…' })).toBeNull();
  });

  it('keeps the marks of a run when the sheet cannot be read again, and a hand mark still shows', async () => {
    await mapToTheEnd(() => mocks.loadExamBundle.mockRejectedValue(new Error('offline')));
    expect(row('q1')).toHaveAttribute('data-coverage', 'full');
    expect(row('q3')).toHaveAttribute('data-coverage', 'partial');
    expect(screen.queryByRole('heading', { name: 'Не удалось открыть лист экзамена' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 2 о денежном рынке' }));
    fireEvent.click(within(column()).getByRole('button', { name: 'Это есть в лекции…' }));
    await waitFor(() => expect(row('q2')).toHaveAttribute('data-coverage', 'full'));
  });

  it('opens the sheet again from the database: a question reworded since the run is not checked, the run’s notes are gone', async () => {
    await mapToTheEnd(() => mocks.loadExamBundle.mockResolvedValue(bundle(mappedRows())));
    await waitFor(() => expect(statusNotes()).toContain('Часть сверки от 9:40, остальное сейчас.'));
    cleanup();

    // Question 2 was reworded in the editor (its coverage reset); no new run started.
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, 'partial')]));
    renderDetail();
    await opened();
    expect(row('q2')).toHaveAttribute('data-coverage', 'unmapped');
    expect(row('q1')).toHaveAttribute('data-coverage', 'full');
    await statusSays('1 вопрос ещё не сверен с лекциями');
    expect(statusNotes()).not.toContain('Часть сверки от 9:40, остальное сейчас.');
    // The ticket shares count question 2 as unknown, not as «нет».
    fireEvent.click(within(column()).getByRole('button', { name: 'Как считается' }));
    expect(plain(column().querySelector('.ex-calc-q')?.textContent)).toContain('не сверено — 1');
  });

  it('does not repeat «Сверка прервалась» on a later visit when the exam was mapped since', async () => {
    const stream = liveStream();
    vi.stubGlobal('fetch', apiFetch(() => stream.response));
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), notMapped))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'failed' }));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Сверить с лекциями' }));
    await waitFor(() => expect(mocks.checkAILimit).toHaveBeenCalled());
    stream.send({ type: 'start', questions: 3, to_check: 3, materials: [], skipped: [] });
    stream.send({ type: 'batch', index: 1, total: 2, items: [item('q1', 'full')] });
    stream.close();
    await statusSays('Сверка прервалась');
    cleanup();

    // Mapped to the end in another tab meanwhile.
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'full'), question(2, 'none'), question(3, 'partial')]));
    renderDetail();
    await opened();
    await statusSays('Можно отвечать на билеты');
    expect(plain(statusCard().textContent)).not.toContain('прервалась');
    expect(row('q3')).toHaveAttribute('data-coverage', 'partial');
  });
});

// ------------------------------------------------------------------------------------ drawing

describe('ExamDetail: the draw button', () => {
  it('draws a question when a ticket holds one, and keeps the chosen way of drawing in the link', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty(), { ticket_layout: { mode: 'random', per_ticket: 1 } }));
    renderDetail();
    await opened();
    const draw = screen.getByRole('link', { name: 'Тянуть вопрос' });
    expect(draw).toHaveAttribute('href', '/exams/exam-1/draw');
    expect(screen.queryByRole('link', { name: 'Тянуть билет' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'изменить' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Чаще слабые/ }));
    expect(screen.getByRole('link', { name: 'Тянуть вопрос' })).toHaveAttribute('href', '/exams/exam-1/draw?mode=weak');
    expect(plain(document.querySelector('.ex-draw-mode')?.textContent)).toBe('Чаще слабые · изменить');
  });

  it('says «Тянуть билет» for tickets of two questions', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(screen.getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/exams/exam-1/draw');
  });
});

describe('ExamDetail on a phone', () => {
  it.each([
    ['a phone (390 px)', 390],
    ['a portrait tablet (768 px)', 768],
  ])('changes the way of drawing under the fixed «Тянуть билет» on %s (stage QA round 2)', async (_label, width) => {
    if (width < 640) setPhone();
    else setWidth(width);
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const cta = document.querySelector('.ex-cta') as HTMLElement;
    expect(plain(within(cta).getByText('Как на экзамене').closest('.ex-draw-mode')?.textContent)).toBe('Как на экзамене · изменить');
    const change = within(cta).getByRole('button', { name: 'изменить' });
    fireEvent.click(change);
    const menu = screen.getByRole('menu', { name: 'Как тянуть билет' });
    // A bottom sheet over the page, not inside the fixed bar.
    expect(menu).toHaveClass('ex-mode-sheet');
    expect(cta.contains(menu)).toBe(false);
    await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: /Как на экзамене/ })).toHaveFocus());
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Из вопросов, на которые вы уже отвечали/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(within(cta).getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/exams/exam-1/draw?mode=answered');
    expect(plain(cta.querySelector('.ex-draw-mode')?.textContent)).toBe('Из вопросов, на которые вы уже отвечали · изменить');
    await waitFor(() => expect(change).toHaveFocus());
  });

  it('keeps the bar empty while the first status is read, so «Тянуть билет» does not turn into another action a moment later', async () => {
    setPhone();
    const release = slowLearn();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(document.querySelector('.ex-cta')).toHaveAttribute('data-wait');
    release();
    await waitFor(() => expect(document.querySelector('.ex-cta')).not.toHaveAttribute('data-wait'));
    expect(within(document.querySelector('.ex-cta') as HTMLElement).getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/exams/exam-1/draw');
  });

  it('shows «Тянуть билет» after a while when what is left to learn is slow to read', async () => {
    setPhone();
    slowLearn();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(document.querySelector('.ex-cta')).toHaveAttribute('data-wait');
    await waitFor(() => expect(document.querySelector('.ex-cta')).not.toHaveAttribute('data-wait'), { timeout: BAR_WAIT_MS + 1500 });
    expect(within(document.querySelector('.ex-cta') as HTMLElement).getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/exams/exam-1/draw');
  });

  it('keeps the one figure with «Как считается» above the sheet on a tablet, the action line under it (redesign critique 10)', async () => {
    setWidth(768);
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const summary = screen.getByRole('region', { name: 'Сводка' });
    expect(plain(summary.querySelector('.ex-figs-now')?.textContent)).toBe('35 %');
    expect(plain(summary.querySelector('.ex-caveat[data-inline]')?.textContent)).toBe('Это доля билетов, а не вероятность сдать. Как считается');
    expect(summary.querySelector('.ex-act')).toBeNull();
    const after = screen.getByRole('region', { name: 'Ответы по билетам' });
    const sheet = document.querySelector('.ex-sheet') as HTMLElement;
    expect(sheet.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plain(after.querySelector('.ex-act')?.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
  });
  it('closes the phone menu with Escape and gives the focus back', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const change = within(document.querySelector('.ex-cta') as HTMLElement).getByRole('button', { name: 'изменить' });
    fireEvent.click(change);
    const menu = screen.getByRole('menu', { name: 'Как тянуть билет' });
    await waitFor(() => expect(within(menu).getAllByRole('menuitemradio')[0]).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitemradio', { name: /Чаще слабые/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(change).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/exams/exam-1/draw');
  });

  it('lists the readiness legend after the sheet on a tablet, above «Тянуть билет»', async () => {
    setWidth(768);
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-3), true, 's1'), answer(1, dayKey(-1), true, 's2')]);
    learning(learnOf(forty(), { 1: { state: 3 } }));
    renderDetail();
    await opened();
    const legend = await screen.findByRole('list', { name: 'Показать вопросы по ответам' });
    const sheet = document.querySelector('.ex-sheet') as HTMLElement;
    expect(sheet.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(legend.closest('.ex-rl')).not.toBeNull();
    // «Осталось выучить» stays over the list.
    const card = screen.getByRole('region', { name: 'Осталось выучить' });
    expect(card.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cta = document.querySelector('.ex-cta') as HTMLElement;
    expect(legend.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts the summary above the sheet on a tablet, the draw button at the bottom and «почему» in a bottom sheet', async () => {
    setWidth(768);
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    renderDetail();
    await opened();
    expect(screen.getByRole('region', { name: 'Сводка' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' })).toBeNull();
    // The bar at the bottom holds the status's action (question 5 is not checked yet); «Тянуть билет» stays in the status.
    await statusSays('1 вопрос ещё не сверен с лекциями');
    const cta = document.querySelector('.ex-cta') as HTMLElement;
    expect(within(cta).getByRole('button', { name: 'Сверить с лекциями' })).toHaveClass('sf-primary');
    expect(within(statusCard()).getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/exams/exam-1/draw');
    expect(document.querySelectorAll('.sf-page .sf-primary')).toHaveLength(1);

    // The paper comes first: only the pair, the short caveat and the confirmed line are above it;
    // the readiness legend and the confidence line are under the sheet.
    expect(await screen.findByText('Это доля билетов, а не вероятность сдать.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/считаем, что билет — два случайных вопроса/)).toBeNull();
    const summary = screen.getByRole('region', { name: 'Сводка' });
    expect(within(summary).getByRole('button', { name: 'Как считается' })).toBeInTheDocument();
    expect(within(summary).queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 3 о денежном рынке' }));
    const dialog = screen.getByRole('dialog', { name: named('Ни в одной из 2 лекций нет фрагмента об этом') });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ExamDetail on a phone: one line of each thing (Phone_Declutter_2026-10-08)', () => {
  it('says the day, the number of questions and the ticket’s size; the lectures and the mapping wait behind «Как считается»', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty(), { exam_date: dayKey(13) }));
    renderDetail();
    await opened();
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toBe(`${formatDay(dayKey(13))}, через 13 дней · 40 вопросов, в билете два`);
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    const panel = document.querySelector('.ex-psum-calc') as HTMLElement;
    expect(plain(panel.querySelector('.ex-psum-facts')?.textContent)).toBe('2 лекции · сверка от 21 января, 9:40');
    // The ticket's size, which the meta line said on a computer.
    expect(plain(panel.textContent)).toContain('Это доля билетов, а не вероятность сдать: считаем, что билет — два случайных вопроса из 40.');
  });

  it('words the meta line: an exam by its day, another kind by name, no day, a day gone by — with the ticket’s size', () => {
    const now = new Date(2026, 9, 8, 12, 0, 0);
    const two = { mode: 'random' as const, per_ticket: 2 };
    expect(phoneMetaLine('exam', '2026-10-21', 20, two, now)).toBe('21 октября, через 13 дней · 20 вопросов, в билете два');
    expect(phoneMetaLine('credit', '2026-10-09', 1, { mode: 'random', per_ticket: 1 }, now)).toBe('Зачёт 9 октября, завтра · 1 вопрос, в билете один');
    expect(phoneMetaLine('exam', null, 18, two, now)).toBe('Экзамен · 18 вопросов, в билете два');
    expect(phoneMetaLine('colloquium', '2026-10-01', 3, { mode: 'sections', per_ticket: 3 }, now)).toBe(
      'Коллоквиум прошёл 1 октября · 3 вопроса, в билете по вопросу из каждого раздела',
    );
  });

  it('the figure in one line with «Как считается»; behind it the action line and the formulas', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-3), true, 's1'), answer(1, dayKey(-1), true, 's2')]);
    renderDetail();
    await opened();
    const summary = screen.getByRole('region', { name: 'Сводка' });
    expect(plain(summary.querySelector('.ex-psum-fig')?.textContent)).toBe('35 % билетов, где оба вопроса есть в лекциях. Как считается');
    // What is learned is «Осталось выучить»'s: no «Подтверждено ответами» line here.
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalled());
    expect(summary.querySelector('.ex-psum-line')).toBeNull();
    // Until «Как считается» opens: no caveat, no action line, no legend, nothing under the list.
    expect(screen.queryByText(/Это доля билетов, а не вероятность сдать/)).toBeNull();
    expect(document.querySelector('.ex-act')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ответы по билетам' })).toBeNull();
    const how = within(summary).getByRole('button', { name: 'Как считается' });
    fireEvent.click(how);
    expect(how).toHaveAttribute('aria-expanded', 'true');
    const panel = summary.querySelector('.ex-psum-calc') as HTMLElement;
    expect(how).toHaveAttribute('aria-controls', panel.id);
    expect(plain(panel.querySelector('.ex-act')?.textContent)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
    expect(panel.querySelector('.ex-formula')).not.toBeNull();
    expect(plain(panel.textContent)).not.toMatch(/Подтверждено/);
    // The legend of the number circles is «Обозначения» over the list, not here.
    expect(within(panel).queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: named('7 вопросов «частично»') }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(7);
  });

  it('the list: the filter keeps its whole words for a screen reader, one line says a question opens, «почему» is a bottom sheet with the lecture and its fragment', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const none = screen.getByRole('button', { name: 'нет ни в одной 9' });
    expect(none.querySelector('.ex-filter-long')?.textContent).toBe('ни в одной');
    fireEvent.click(none);
    expect(document.querySelectorAll('.ex-q')).toHaveLength(9);
    fireEvent.click(screen.getByRole('button', { name: 'Все 40' }));
    expect(plain(document.querySelector('.ex-sheet-hint')?.textContent)).toBe(ROW_HINT);
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 2 о денежном рынке' }));
    const dialog = screen.getByRole('dialog', { name: named('Есть в ваших лекциях') });
    expect(plain(dialog.querySelector('.ex-slip-cap')?.textContent)).toBe('Лекция «Денежный рынок», фрагмент 2');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the round «⋯» on the heading’s row holds the five links: the list, the lectures, the self-rating, the group and the report', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    renderDetail();
    await opened();
    expect(document.querySelector('.ex-links')).toBeNull();
    const more = screen.getByRole('button', { name: 'Ещё: лист экзамена' });
    // Beside the heading, before the status and the list (a newcomer did not find «Изменить список» under the list).
    expect(more).toHaveClass('sf-more');
    expect(more.closest('.ex-titlerow')?.querySelector('h1')).toHaveTextContent('Макроэкономика');
    const sheet = document.querySelector('.ex-sheet') as HTMLElement;
    expect(more.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(more.compareDocumentPosition(statusCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One «Ещё» on the page: none under the list.
    expect(screen.getAllByRole('button', { name: 'Ещё: лист экзамена' })).toHaveLength(1);
    expect(document.querySelector('.ex-links-after')).toBeNull();
    fireEvent.click(more);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Изменить список', 'Лекции', 'Самооценка', 'Пригласить группу', 'Отчёт для преподавателя']);
    expect(screen.getByRole('menuitem', { name: 'Изменить список' })).toHaveAttribute('href', '/exams/exam-1/edit');
    expect(screen.getByRole('menuitem', { name: 'Лекции' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(screen.getByRole('menuitem', { name: 'Отчёт для преподавателя' })).toHaveAttribute('href', '/exams/exam-1/report');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Пригласить группу' }));
    expect(await screen.findByRole('dialog', { name: 'Пригласить группу' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
    // «Самооценка»: the list asks for the marks, and the hint about opening a question steps aside.
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Самооценка' }));
    expect(screen.getByText('Отметьте, насколько уверенно вы ответили бы на каждый вопрос.')).toBeInTheDocument();
    expect(document.querySelector('.ex-sheet-hint')).toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole('menuitem', { name: 'Закончить самооценку' })).toBeInTheDocument();
  });

  it('a group link’s copy: «⋯» has no list editing and no invitation; a running mapping takes «Изменить список» out', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue({ ...bundle(forty()), copy: true });
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Лекции', 'Самооценка', 'Отчёт для преподавателя']);
    cleanup();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty(), { mapping_state: 'running', mapping_started_at: new Date().toISOString() }));
    mocks.fetchExamMappingState.mockResolvedValue({ mapping_state: 'running', mapping_started_at: new Date().toISOString(), mapped_at: null });
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    expect(screen.queryByRole('menuitem', { name: 'Изменить список' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Пригласить группу' })).toBeInTheDocument();
  });
});

describe('ExamDetail on a phone: what the critics found (2026-10-08)', () => {
  /** An oral point of an answer's session: «Второй ответ после разбора» pools them. */
  function point(session: string, id: string, status: 'covered' | 'missing'): LearningEvent {
    return {
      id: `pt-${session}-${id}`,
      created_at: '2026-01-01T10:00:00Z',
      local_date: '2026-01-01',
      material_id: null,
      kind: 'oral_point',
      item_key: `oral:r1:${id}`,
      correct: status === 'covered',
      score: null,
      confidence: null,
      source_ids: [],
      session_id: session,
      payload: { v: 1, question_hash: hash(1), rubric_id: 'r1', point_id: id, title: id, status, essential: true, live: true, followup_status: null },
    };
  }
  const header = () => document.querySelector('.ex-sheet-h') as HTMLElement;

  it('«Обозначения» at the end of the hint opens the key to the number circles; its rows still filter the list', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-3), true, 's1'), answer(1, dayKey(-1), true, 's2'), answer(2, dayKey(-1), false, 's3')]);
    learning(learnOf(forty(), { 1: { state: 3 }, 2: { missed: true } }));
    renderDetail();
    await opened();
    const keys = await screen.findByRole('button', { name: 'Обозначения' });
    expect(plain(header().querySelector('.ex-sheet-hint')?.textContent)).toBe('Нажмите на вопрос — увидите, где он в лекциях. Обозначения');
    // A quiet disclosure: muted, a 44 px target in the stylesheet, aria-controls only while open.
    expect(keys).toHaveClass('sf-link');
    expect(keys).toHaveAttribute('data-muted');
    expect(keys).toHaveAttribute('aria-expanded', 'false');
    expect(keys).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
    fireEvent.click(keys);
    expect(keys).toHaveAttribute('aria-expanded', 'true');
    const legend = screen.getByRole('list', { name: 'Показать вопросы по ответам' });
    const panel = legend.closest('.ex-keys') as HTMLElement;
    expect(keys).toHaveAttribute('aria-controls', panel.id);
    expect(header().contains(panel)).toBe(true);
    expect(within(legend).getAllByRole('button').map((item) => plain(item.textContent))).toEqual([
      'выучен 1',
      'начат 0',
      'в прошлый раз ответ был неполным 1',
      'ещё не отвечали 38',
    ]);
    fireEvent.click(within(legend).getByRole('button', { name: /^в прошлый раз/ }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(1);
    expect(row('q2')).toBeInTheDocument();
    fireEvent.click(within(legend).getByRole('button', { name: /^в прошлый раз/ }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(40);
    fireEvent.click(keys);
    expect(screen.queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
  });

  it('no «Обозначения» before the first answer, nor while rating; the computer keeps its legend in the column', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(plain(header().querySelector('.ex-sheet-hint')?.textContent)).toBe(ROW_HINT);
    expect(screen.queryByRole('button', { name: 'Обозначения' })).toBeNull();
    cleanup();
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-3), true, 's1')]);
    learning(learnOf(forty(), { 1: { state: 1 } }));
    renderDetail();
    await opened();
    await screen.findByRole('button', { name: 'Обозначения' });
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Самооценка' }));
    expect(screen.queryByRole('button', { name: 'Обозначения' })).toBeNull();
    expect(document.querySelector('.ex-sheet-hint')).toBeNull();
    cleanup();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    setWidth(1280);
    renderDetail();
    await opened();
    expect(await within(column()).findByRole('list', { name: 'Показать вопросы по ответам' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обозначения' })).toBeNull();
    expect(document.querySelector('.ex-sheet-hint')).toBeNull();
  });

  it('the hint speaks of the lectures only once something was found there', async () => {
    setPhone();
    // Not checked yet: a tap shows no lecture.
    mocks.loadExamBundle.mockResolvedValue(bundle(Array.from({ length: 6 }, (_, index) => question(index + 1, null))));
    renderDetail();
    await opened();
    expect(document.querySelector('.ex-sheet-hint')).toBeNull();
    expect(header()).not.toHaveAttribute('data-hint');
    cleanup();
    // Checked, and in no lecture at all.
    mocks.loadExamBundle.mockResolvedValue(bundle(Array.from({ length: 6 }, (_, index) => question(index + 1, 'none'))));
    renderDetail();
    await opened();
    expect(document.querySelector('.ex-sheet-hint')).toBeNull();
    cleanup();
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    renderDetail();
    await opened();
    expect(plain(document.querySelector('.ex-sheet-hint')?.textContent)).toBe('Нажмите на вопрос — увидите, где он в лекциях');
  });

  it('a question learned stays learned: no «Пора проверить» under the figure, the topics card over the list (owner, 2026-10-21)', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-20), true, 's1'), answer(1, dayKey(-18), true, 's2')]);
    learning(learnOf(forty(), { 1: { state: 3 } }));
    renderDetail();
    await opened();
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalled());
    const summary = screen.getByRole('region', { name: 'Сводка' });
    expect(summary.querySelector('.ex-psum-line')).toBeNull();
    expect(plain(document.body.textContent)).not.toMatch(/Пора проверить|Подтверждено ответами/);
    const card = screen.getByRole('region', { name: 'Осталось выучить' });
    expect(card.compareDocumentPosition(document.querySelector('.ex-sheet') as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the filter shows no tab with 0 on a phone and keeps the marks before its words; the computer keeps «нет … 0»', async () => {
    setPhone();
    const noNone = Array.from({ length: 10 }, (_, index) => question(index + 1, index < 7 ? 'full' : 'partial'));
    mocks.loadExamBundle.mockResolvedValue(bundle(noNone));
    renderDetail();
    await opened();
    const filters = screen.getByRole('list', { name: 'Показать вопросы' });
    expect(within(filters).getAllByRole('button').map((item) => plain(item.textContent))).toEqual(['Все 10', 'есть в лекциях 7', 'частично 3']);
    expect(within(filters).getByRole('button', { name: 'есть в лекциях 7' }).querySelector('.ex-filter-mark svg')).not.toBeNull();
    expect(within(filters).getByRole('button', { name: 'частично 3' }).querySelector('.ex-filter-mark svg')).not.toBeNull();
    cleanup();
    // A link to a filter with nothing in it keeps its tab, pressed.
    renderDetail({ path: '/exams/exam-1?filter=cov:none' });
    await opened();
    expect(within(screen.getByRole('list', { name: 'Показать вопросы' })).getByRole('button', { name: 'нет ни в одной 0' })).toHaveAttribute('aria-pressed', 'true');
    cleanup();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    setWidth(1280);
    renderDetail();
    await opened();
    expect(within(screen.getByRole('list', { name: 'Показать вопросы' })).getByRole('button', { name: 'нет ни в одной 0' })).toBeInTheDocument();
  });

  it('an exam with no questions: the heading, the status and its button — no views, no filter, no list, no «⋯», no meta', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle([], { exam_date: dayKey(13) }));
    renderDetail();
    await opened();
    await statusSays('В экзамене пока нет вопросов');
    expect(statusText()).toBe('Вставьте список вопросов кафедры.');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Показать вопросы' })).toBeNull();
    expect(document.querySelector('.ex-sheet')).toBeNull();
    expect(screen.queryByText('В списке пока нет вопросов.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ещё: лист экзамена' })).toBeNull();
    expect(document.querySelector('.ex-meta')).toBeNull();
    expect(within(document.querySelector('.ex-cta') as HTMLElement).getByRole('link', { name: 'Добавить вопросы' })).toHaveAttribute('href', '/exams/exam-1/edit');
    cleanup();
    // The computer keeps its page as it was.
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    setWidth(1280);
    renderDetail();
    await opened();
    expect(document.querySelector('.ex-sheet')).not.toBeNull();
    expect(screen.getByText('В списке пока нет вопросов.')).toBeInTheDocument();
    expect(document.querySelector('.ex-meta')).not.toBeNull();
  });

  it('the heading sizes itself to its longest word beside the «⋯»; the computer’s heading has no such style', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty(), { title: 'Теория вероятностей и математическая статистика' }));
    renderDetail();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('heading', { level: 1 }).style.getPropertyValue('--ex-h1-word')).toBe('14');
    cleanup();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    setWidth(1280);
    renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'Теория вероятностей и математическая статистика' })).not.toHaveAttribute('style');
  });
});

// ------------------------------------------------------------------------------------ «Осталось выучить»

describe('ExamDetail: «Осталось выучить» (owner, 2026-10-21)', () => {

  it('the page is the list: no «Шпаргалка · Вопросы» switch, no sheet read, one learn_left read of this exam', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    learning(learnOf(forty(), { 1: { state: 3 }, 2: { state: 3 } }));
    renderDetail();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Шпаргалка')).toBeNull();
    expect(mocks.fetchSheet).not.toHaveBeenCalled();
    expect(mocks.useLearnLeft).toHaveBeenCalledWith(['exam-1'], true);
  });

  it('the card heads the column: the topics left, the questions not counted, «Как считается»', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    learning(learnOf(forty(), { 1: { state: 3 }, 2: { state: 2 } }));
    renderDetail();
    const card = await within(await screen.findByRole('complementary', { name: 'Что осталось выучить и что это значит для билетов' })).findByRole('region', { name: 'Осталось выучить' });
    // One lecture of 31 questions: four parts of at most 10.
    expect(plain(card.querySelector('.ll-n')?.textContent)).toBe('4 темы из 4');
    expect(plain(card.textContent)).toContain('9 вопросов не считаем, их нет в лекциях.');
    expect(within(card).getByRole('link', { name: 'Добавить лекции' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(within(card).getByRole('button', { name: 'Как считается' })).toBeInTheDocument();
    // The open row: the questions left with «Ответить» into a ticket of that question.
    expect(within(card).getByRole('link', { name: 'Ответить на вопрос 3' })).toHaveAttribute('href', '/exams/exam-1/ticket?q=q3');
  });

  it('the dots follow the same rule: learned — the ring, started — the line, a miss — the wave', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    learning(learnOf(forty(), { 1: { state: 3 }, 2: { state: 1 }, 3: { missed: true } }));
    renderDetail();
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(row('q1')).toHaveAttribute('data-readiness', 'confirmed'));
    expect(row('q2')).toHaveAttribute('data-readiness', 'once');
    expect(row('q3')).toHaveAttribute('data-readiness', 'not_passed');
    expect(row('q4')).toHaveAttribute('data-readiness', 'untested');
    expect(plain(row('q1').textContent)).toContain('выучен');
  });

  it('the status says what can be learned today and draws from those questions', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([answer(1, dayKey(-1), true, 's1'), answer(2, dayKey(-1), true, 's1')]);
    learning(learnOf(forty(), { 1: { state: 2, ready: true }, 2: { state: 2, ready: true }, 3: { state: 3 } }));
    renderDetail();
    await statusSays('Сегодня можно выучить 2 вопроса');
    expect(statusText()).toBe('Вы уже отвечали на них полностью в другой день. Ответьте снова, и они будут выучены.');
    expect(screen.getByRole('link', { name: 'Тянуть билет из 2 вопросов' })).toHaveAttribute('href', '/exams/exam-1/draw?mode=awaiting');
  });

  it('questions without points: one quiet line starts the existing writing job, no step of the status', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    learning(learnOf(forty(), {}, { toWrite: 10, units: 10 }));
    mocks.startSheetWrite.mockImplementation(() => Promise.resolve());
    renderDetail();
    const prepare = await screen.findByRole('button', { name: named('Подготовить за 10 единиц ИИ') });
    expect(plain(prepare.closest('p')?.textContent)).toContain('У 10 вопросов пока нет пунктов ответа.');
    expect(statusTitle()).not.toMatch(/шпаргал|Написать/i);
    fireEvent.click(prepare);
    await waitFor(() => expect(mocks.startSheetWrite).toHaveBeenCalledWith('exam-1'));
  });

  it('a phone: the card over the list with every row folded', async () => {
    setPhone();
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    learning(learnOf(forty(), { 1: { state: 3 } }));
    renderDetail();
    const card = await screen.findByRole('region', { name: 'Осталось выучить' });
    for (const button of within(card).getAllByRole('button', { expanded: false })) expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByRole('link', { name: /Ответить/ })).toBeNull();
    // Above the list in the page's order.
    expect(card.compareDocumentPosition(document.querySelector('.ex-sheet') as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('while it is read, a quiet card of the same frame holds the place', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.useLearnLeft.mockReturnValue({ status: 'loading', exams: [], reload: () => undefined });
    renderDetail();
    const card = await screen.findByRole('region', { name: 'Осталось выучить' });
    expect(card).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ExamDetail: «Отчёт для преподавателя»', () => {
  it('is a quiet link with the exam’s links to the printable report of this exam', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const link = screen.getByRole('link', { name: 'Отчёт для преподавателя' });
    expect(link).toHaveAttribute('href', '/exams/exam-1/report');
    expect(link.closest('.ex-links')).not.toBeNull();
    expect(link).toHaveClass('sf-link');
    expect(link).not.toHaveClass('sf-primary');
  });
});

describe('ExamDetail: «Пригласить группу»', () => {
  it('stands with the exam’s links and opens the invitation of this exam, asking nothing before the click', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/exam-shares?exam_id=exam-1') {
        return new Response(
          JSON.stringify({
            exam_id: 'exam-1',
            ready: false,
            copy: false,
            reason: { code: 'not_ready', reason: 'needs_sheet', questions: 2, detail: 'У 2 вопросов ещё нет пунктов ответа. Подготовьте их на странице экзамена.' },
            consent: 'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа. Мои ответы и прогресс никто не увидит.',
            max_members: 80,
            shares: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetail();
    await opened();
    const invite = screen.getByRole('button', { name: 'Пригласить группу' });
    expect(invite.closest('.ex-links')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/exam-shares?exam_id=exam-1', undefined);
    fireEvent.click(invite);
    const dialog = await screen.findByRole('dialog', { name: 'Пригласить группу' });
    expect(await within(dialog).findByText('У 2 вопросов ещё нет пунктов ответа. Подготовьте их на странице экзамена.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/exam-shares?exam_id=exam-1', undefined);
  });
});

// ------------------------------------------------------------------------------------ inside an exam container

describe('ExamDetail inside an exam container (spec decisions 29б, 38): guarded, nothing changes for other exams', () => {
  beforeEach(() => {
    window.localStorage.removeItem(ATTACHED_EXAMS_KEY);
  });
  afterEach(() => {
    window.localStorage.removeItem(ATTACHED_EXAMS_KEY);
    window.sessionStorage.clear();
  });

  const crumb = () => document.querySelector('.ex-crumb a') as HTMLAnchorElement;
  const linkNames = () => Array.from(document.querySelectorAll('.ex-links > a, .ex-links > button, .ex-links > span')).map((el) => plain(el.textContent));

  it('a plain exam: the crumb leads to «Экзамены» and the group link stays, even when another exam lives in a container', async () => {
    rememberAttachedExams({ 'exam-9': { containerId: 'c-1', title: 'Аккредитация' } });
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(crumb()).toHaveAttribute('href', '/exams');
    expect(crumb()).toHaveTextContent(/^Экзамены$/);
    expect(screen.getByRole('button', { name: 'Пригласить группу' })).toBeInTheDocument();
  });

  it('an exam inside a container: the crumb leads to that exam by its title; its own group link is gone, the rest stays', async () => {
    rememberAttachedExams({ 'exam-1': { containerId: 'c-1', title: 'Аккредитация' } });
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(crumb()).toHaveAttribute('href', '/exams/c/c-1');
    expect(crumb()).toHaveTextContent(/^Аккредитация$/);
    expect(screen.queryByRole('button', { name: 'Пригласить группу' })).toBeNull();
    expect(linkNames()).toEqual(['Изменить список', 'Лекции', 'Самооценка', 'Отчёт для преподавателя']);
  });

  it('names the container as this tab knows it (a title read on its own page wins)', async () => {
    rememberAttachedExams({ 'exam-1': { containerId: 'c-1', title: 'Аккредитация' } });
    rememberContainerTitle('c-1', 'Зимняя сессия');
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(crumb()).toHaveTextContent(/^Зимняя сессия$/);
  });

  it('on a phone «⋯» has no «Пригласить группу» inside a container, and keeps it for a plain exam', async () => {
    setPhone();
    rememberAttachedExams({ 'exam-1': { containerId: 'c-1', title: 'Аккредитация' } });
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Изменить список', 'Лекции', 'Самооценка', 'Отчёт для преподавателя']);
    cleanup();
    rememberAttachedExams({});
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Изменить список', 'Лекции', 'Самооценка', 'Пригласить группу', 'Отчёт для преподавателя']);
  });

  it('follows the attached exams when they arrive after the page opened (the overview read elsewhere)', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    expect(crumb()).toHaveAttribute('href', '/exams');
    act(() => {
      rememberAttachedExams({ 'exam-1': { containerId: 'c-1', title: 'Аккредитация' } });
    });
    await waitFor(() => expect(crumb()).toHaveAttribute('href', '/exams/c/c-1'));
    expect(screen.queryByRole('button', { name: 'Пригласить группу' })).toBeNull();
  });
});
