import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ExamBundle, ExamQuestion, ExamRow } from '../api/exams';
import type { LearningEvent } from '../api/learning';
import { formatDay, formatShortDay } from '../lib/exams/format';

const mocks = vi.hoisted(() => ({
  loadExamBundle: vi.fn(),
  markQuestionManual: vi.fn(),
  fetchExamMappingState: vi.fn(),
  fetchQuestionEvents: vi.fn(),
  recordSelfRating: vi.fn(),
  incrementAIUsage: vi.fn(),
  verifyEnergy: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
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
  };
});
vi.mock('../api/learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/learning')>();
  return { ...actual, fetchQuestionEvents: mocks.fetchQuestionEvents, recordSelfRating: mocks.recordSelfRating };
});
vi.mock('../api/limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/limits')>();
  return { ...actual, incrementAIUsage: mocks.incrementAIUsage };
});
// The draw and answer screens are preloaded while the sheet is idle; not in these tests.
vi.mock('../components/exams/preload', () => ({
  preloadDrawScreen: vi.fn(),
  preloadTicketScreen: vi.fn(),
  whenIdle: () => () => undefined,
}));

import ExamDetail from './ExamDetail';
import { resetMapJobsForTests } from '../components/exams/mapJobs';

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

function renderDetail(options: { strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={['/exams/exam-1']}>
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
const notes = () => Array.from(document.querySelectorAll('.ex-notes .ex-note')).map((note) => plain(note.textContent));
const column = () => screen.getByRole('complementary', { name: 'Что это значит для билетов' });

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

function item(id: string, coverage: string, extra: Record<string, unknown> = {}) {
  return { question_id: id, coverage, method: 'llm', reason: '', missing: '', evidence: [], nearest: [], mapped_at: new Date().toISOString(), reused: false, ...extra };
}

const RUNNING = () => ({ mapping_state: 'running', mapping_started_at: new Date().toISOString(), mapped_at: null });
const FINISHED = () => ({ mapping_state: 'done', mapping_started_at: new Date().toISOString(), mapped_at: new Date().toISOString() });

const originalWidth = window.innerWidth;
function setWidth(value: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value });
}

beforeEach(() => {
  resetMapJobsForTests({ pollIntervalMs: 5, pollLimitMs: 2000 });
  window.sessionStorage.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.fetchQuestionEvents.mockResolvedValue([]);
  mocks.recordSelfRating.mockResolvedValue(undefined);
  mocks.incrementAIUsage.mockResolvedValue(undefined);
  mocks.verifyEnergy.mockResolvedValue(true);
  mocks.confirm.mockResolvedValue(true);
  mocks.markQuestionManual.mockResolvedValue(undefined);
  setWidth(1280);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setWidth(originalWidth);
});

// ------------------------------------------------------------------------------------ the sheet

describe('ExamDetail: the sheet', () => {
  it('marks every coverage state in pencil, with words for screen readers, and every readiness on the number', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    mocks.fetchQuestionEvents.mockResolvedValue([
      answer(1, dayKey(-3), true, 's1'),
      answer(1, dayKey(-1), true, 's2'),
      answer(2, dayKey(-1), true, 's3'),
      answer(4, dayKey(-2), false, 's4'),
    ]);
    renderDetail();
    await opened();
    expect(screen.getByRole('heading', { level: 2, name: 'Макроэкономика: вопросы к экзамену' })).toBeInTheDocument();

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
      const cell = row(id).querySelector('.ex-cov') as HTMLElement;
      expect(cell.querySelector('svg')?.getAttribute('data-mark') ?? null).toBe(mark);
      expect(cell.querySelector('svg')?.getAttribute('aria-hidden') ?? 'true').toBe('true');
      expect(cell).toHaveTextContent(words);
    }
    // Stored marks are simply there: nothing is drawn in on opening the sheet.
    expect(document.querySelectorAll('.ex-cov svg[data-drawn="live"]')).toHaveLength(0);

    await waitFor(() => expect(row('q1')).toHaveAttribute('data-readiness', 'confirmed'));
    expect(row('q1').querySelector('.ex-qn [data-mark="ring"]')).not.toBeNull();
    expect(row('q1').querySelector('.ex-qn')).toHaveTextContent('1, подтверждено');
    expect(row('q2')).toHaveAttribute('data-readiness', 'once');
    expect(row('q2').querySelector('.ex-qn [data-mark="under"]')).not.toBeNull();
    expect(row('q4')).toHaveAttribute('data-readiness', 'not_passed');
    expect(row('q4').querySelector('.ex-qn [data-mark="wave"]')).not.toBeNull();
    expect(row('q3')).toHaveAttribute('data-readiness', 'untested');
    expect(row('q3').querySelector('.ex-qn [data-mark]')).toBeNull();

    // The right margin: the lecture and its fragment, «отмечено вами», nothing for a gap.
    expect(plain(row('q1').querySelector('.ex-qnote')?.textContent)).toBe('Денежный рынокфрагмент 1');
    expect(plain(row('q6').querySelector('.ex-qnote')?.textContent)).toBe('отмечено вами');
    expect(row('q3').querySelector('.ex-qnote')).toBeNull();
  });

  it('words the shares with real numbers: 60 % of questions, 35 % of tickets, 85 % with at least one', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    const side = column();
    expect(within(side).getByText('60 %')).toBeInTheDocument();
    expect(within(side).getByText('вопросов есть в ваших лекциях')).toBeInTheDocument();
    expect(within(side).getByText('24 из 40 · частично — 7, нет ни в одной — 9')).toBeInTheDocument();
    expect(within(side).getByText('35 %')).toBeInTheDocument();
    expect(within(side).getByText('билетов, где оба вопроса есть в лекциях')).toBeInTheDocument();
    expect(within(side).getByText('хотя бы один — 85 %')).toBeInTheDocument();
    expect(within(side).getByText('Это доля билетов, а не вероятность сдать: считаем, что билет — два случайных вопроса из 40.')).toBeInTheDocument();
    expect(await within(side).findByText('Ответов по билетам ещё не было. Каждый ответ проверяется по вашим лекциям.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/шанс сдать|вы выучили|ИИ понимает/i);

    fireEvent.click(within(side).getByRole('button', { name: 'Как считается' }));
    expect(within(side).getAllByRole('math')[0]).toHaveAccessibleName(/^Сочетания из 24 по 2, делённые на сочетания из 40 по 2: 276 из 780, примерно 35\s%$/);
  });

  it('counts confirmed questions from the journal, with the date they started', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue(
      [1, 2, 3, 4, 5, 6].flatMap((n) => [answer(n, dayKey(-9), true, `s${n}a`), answer(n, dayKey(-2), true, `s${n}b`)]),
    );
    renderDetail();
    await opened();
    const since = formatShortDay(dayKey(-9));
    const statement = await within(column()).findByText((_, element) => element?.classList.contains('ex-stmt') === true && plain(element.textContent).startsWith('Подтверждено ответами'));
    expect(plain(statement.textContent)).toBe(`Подтверждено ответами — 6 из 40, с ${since}${since.endsWith('.') ? '' : '.'}`);
    expect(within(column()).getByText('Подтверждено — значит, зачтено дважды, в разные дни. Билетов, где подтверждены оба вопроса, — 2 %.')).toBeInTheDocument();

    const legend = within(column()).getByRole('list', { name: 'Показать вопросы по ответам' });
    fireEvent.click(within(legend).getByRole('button', { name: 'подтверждено 6' }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(6);
    fireEvent.click(within(legend).getByRole('button', { name: 'не проверялось 34' }));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(34);
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

  it('dates the mapping by exams.mapped_at and says when lectures changed after it', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle(forty(), { mapped_material_ids: ['m1'] }));
    renderDetail();
    await opened();
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toBe(
      'Экзамен · 40 вопросов, в билете два · 2 лекции · разметка от 21 января, 9:40',
    );
    expect(document.body.textContent).not.toContain('25 января');
    expect(notes()).toEqual(['После разметки добавлено 1 лекция.Обновить разметку']);
    expect(screen.getByRole('button', { name: 'Обновить разметку' })).toBeInTheDocument();
  });

  it('asks for lectures when the exam has none', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, null), question(2, null)], { mapping_state: 'none', mapped_at: null, mapped_material_ids: [] }, []));
    renderDetail();
    await opened();
    expect(notes()).toEqual(['Без лекций Meldy не сможет отметить покрытие. Список сохранится.Добавить лекции']);
    expect(plain(document.querySelector('.ex-head .ex-meta')?.textContent)).toContain('разметки ещё нет');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить лекции' }));
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
    expect(within(side).getByText('вопросов есть в ваших лекциях')).toBeInTheDocument();
    expect(plain(side.textContent)).not.toMatch(/Ответов по билетам ещё не было|Подтверждено ответами|Сравнить уверенность|Вы отметили/);
    expect(within(side).queryByRole('list', { name: 'Показать вопросы по ответам' })).toBeNull();
    // After 300 ms one quiet line says what is going on.
    expect(await within(side).findByText('Загружаем историю ответов…')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Самооценка' })[0]);
    expect(screen.queryByRole('button', { name: /Знаю: \d+\. Показать эти вопросы/ })).toBeNull();
    expect(await within(column()).findByText('Загружаем историю ответов…')).toBeInTheDocument();

    answer([rating(2, dayKey(-1), 3)]);
    expect(await screen.findByRole('button', { name: 'Знаю: 1. Показать эти вопросы' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Готово' })[0]);
    expect(await within(column()).findByText('Ответов по билетам ещё не было. Каждый ответ проверяется по вашим лекциям.')).toBeInTheDocument();
    expect(within(column()).queryByText('Загружаем историю ответов…')).toBeNull();
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
    await waitFor(() => expect(notes()).toContain('Не удалось загрузить историю ответов. Повторите попытку.Повторить'));
    expect(document.querySelectorAll('.ex-q')).toHaveLength(6);
    // Nothing is said about answers or confidence that the journal would have to back.
    expect(plain(column().textContent)).not.toMatch(/Ответов по билетам ещё не было|Сравнить уверенность/);
    fireEvent.click(within(document.querySelector('.ex-notes') as HTMLElement).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalledTimes(2));
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

    fireEvent.click(within(side).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('heading', { name: named('Есть в ваших лекциях') })).toBeNull();
    expect(within(column()).getByText('вопросов есть в ваших лекциях')).toBeInTheDocument();
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

describe('ExamDetail: back from an answer (peak 3)', () => {
  const confirmingAnswer = () => [answer(1, dayKey(-3), true, 's-old'), answer(1, dayKey(0), true, 's-new')];

  it('reads the flag once, scrolls to the row, draws its new mark and shows the change in the column', async () => {
    window.sessionStorage.setItem('meldy_exam_peak_exam-1', JSON.stringify({ hash: hash(1), before: 'once' }));
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue(confirmingAnswer());
    renderDetail();
    await opened();
    expect(window.sessionStorage.getItem('meldy_exam_peak_exam-1')).toBeNull();

    const side = column();
    expect(await within(side).findByText('Подтверждено ответами')).toBeInTheDocument();
    expect(within(side).getByLabelText('было 0')).toBeInTheDocument();
    expect(plain(side.querySelector('.ex-peak-big')?.textContent)).toBe('0 1 из 40');
    expect(within(side).getByText('Вопрос 1 подтверждён ответом, который вы дали только что.')).toBeInTheDocument();
    // Not enough «знаю» answers to compare confidence with results: no such line.
    expect(screen.queryByText(/Вы отметили «знаю»/)).toBeNull();
    expect(within(side).queryByText(/Сравнить уверенность с ответами пока нельзя/)).toBeNull();

    expect(row('q1')).toHaveAttribute('data-peak');
    expect(plain(row('q1').querySelector('.ex-because')?.textContent)).toBe(
      `${formatDay(dayKey(-3))} — зачтено. Сегодня снова «хорошо»: два зачёта в разные дни, вопрос подтверждён.`,
    );
    expect(screen.getByRole('article', { name: 'Список вопросов кафедры с пометками' })).toHaveAttribute('data-dim');
    // The old mark first, then the new one is drawn.
    await waitFor(() => expect(row('q1')).toHaveAttribute('data-readiness', 'confirmed'), { timeout: 2000 });
    expect(row('q1').querySelector('.ex-qn [data-mark="ring"]')).not.toBeNull();

    fireEvent.click(within(side).getByRole('button', { name: 'Вся сводка' }));
    expect(within(column()).getByText('вопросов есть в ваших лекциях')).toBeInTheDocument();
  });

  it('plays under React’s development double run of effects too (the flag is read once)', async () => {
    window.sessionStorage.setItem('meldy_exam_peak_exam-1', JSON.stringify({ hash: hash(1), before: 'once' }));
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue(confirmingAnswer());
    renderDetail({ strict: true });
    await opened();
    expect(await within(column()).findByText('Вопрос 1 подтверждён ответом, который вы дали только что.')).toBeInTheDocument();
    expect(row('q1')).toHaveAttribute('data-peak');
  });

  it('adds the confidence line only with enough «знаю» answers', async () => {
    window.sessionStorage.setItem('meldy_exam_peak_exam-1', JSON.stringify({ hash: hash(1), before: 'once' }));
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    mocks.fetchQuestionEvents.mockResolvedValue([
      ...confirmingAnswer(),
      ...[2, 3, 4].flatMap((n) => [rating(n, dayKey(-2), 3), answer(n, dayKey(-1), true, `s${n}`, { confidence: 3 })]),
    ]);
    renderDetail();
    await opened();
    expect(await within(column()).findByText('Вы отметили «знаю» у 3 вопросов. Из 3 таких, на которые вы ответили вслух, зачтено 3.')).toBeInTheDocument();
  });

  it('plays nothing without a flag or without an answer in the journal', async () => {
    window.sessionStorage.setItem('meldy_exam_peak_exam-1', JSON.stringify({ hash: hash(2) }));
    mocks.loadExamBundle.mockResolvedValue(bundle(forty()));
    renderDetail();
    await opened();
    await waitFor(() => expect(mocks.fetchQuestionEvents).toHaveBeenCalled());
    expect(document.querySelector('[data-peak]')).toBeNull();
    expect(within(column()).getByText('вопросов есть в ваших лекциях')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------------ mapping

describe('ExamDetail: mapping by lectures', () => {
  const unmapped = () => [question(1, null), question(2, null), question(3, null)];
  const notMapped = { mapping_state: 'none' as const, mapped_at: null };

  it('marks rows batch by batch, reused ones without animation, then reloads and charges the limit once', async () => {
    const stream = liveStream();
    const fetchMock = vi.fn(async () => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), notMapped))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, 'none'), question(3, 'partial')]));
    renderDetail();
    await opened();
    expect(notes()).toEqual(['Вопросы ещё не сверены с лекциями.Разметить по лекциям']);
    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(mocks.verifyEnergy).toHaveBeenCalledWith('user-1', 10, 'Разметка по лекциям');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/exams/exam-1/map');
    expect(JSON.parse(String(init.body))).toEqual({ question_ids: null, force: false });

    stream.send({ type: 'start', questions: 3, to_check: 3, materials: [{ id: 'm1', title: 'Денежный рынок', fragments: 12 }], skipped: [] });
    await waitFor(() => expect(row('q1')).toHaveAttribute('data-coverage', 'checking'));
    expect(within(column()).getByText('Разметка идёт: проверено 0 из 3.')).toBeInTheDocument();
    expect(within(column()).queryByText('35 %')).toBeNull();
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
    await waitFor(() => expect(notes()).toContain('Часть разметки от 9:40, остальное сейчас.'));
    expect(mocks.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementAIUsage).toHaveBeenCalledWith('user-1', 10);
    expect(document.querySelectorAll('.ex-cov svg[data-drawn="live"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Изменить список' })).toHaveAttribute('href', '/exams/exam-1/edit');
  });

  it('charges nothing when the run did not use the model', async () => {
    const stream = liveStream();
    vi.stubGlobal('fetch', vi.fn(async () => stream.response));
    mocks.loadExamBundle.mockResolvedValueOnce(bundle(unmapped(), notMapped)).mockResolvedValue(bundle([question(1, 'full'), question(2, 'full'), question(3, 'full')]));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(mocks.verifyEnergy).toHaveBeenCalled());
    stream.send({ type: 'start', questions: 3, to_check: 3, materials: [], skipped: [] });
    stream.send({ type: 'reused', items: ['q1', 'q2', 'q3'].map((id) => item(id, 'full', { reused: true })) });
    stream.send({ type: 'done', state: 'done', counts: { full: 3 }, reused: 3, used_ai: false });
    stream.close();
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('does not start when the daily limit is declined', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.verifyEnergy.mockResolvedValue(false);
    mocks.loadExamBundle.mockResolvedValue(bundle(unmapped(), notMapped));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(mocks.verifyEnergy).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Разметить по лекциям' })).toBeInTheDocument();
  });

  it('offers «Продолжить» after a dropped stream; a 409 then shows «Разметка ещё идёт» and polls until the exam is free', async () => {
    const first = liveStream();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Разметка уже идёт' }), { status: 409, headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    // The server wrote q1 before it sent it, then the stream broke (the lock is released as failed).
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), notMapped))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'failed' }));
    mocks.fetchExamMappingState.mockResolvedValueOnce(RUNNING()).mockResolvedValueOnce(RUNNING()).mockResolvedValue(FINISHED());
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.send({ type: 'start', questions: 3, to_check: 3, materials: [], skipped: [] });
    first.send({ type: 'batch', index: 1, total: 2, items: [item('q1', 'full')] });
    first.close();

    await waitFor(() => expect(notes()).toContain('Разметка прервалась: проверено 1 из 3.Продолжить'));
    expect(row('q1')).toHaveAttribute('data-coverage', 'full');
    // One note with one action: not also «2 вопроса ещё не сверены… Разметить».
    expect(notes()).toEqual(['Разметка прервалась: проверено 1 из 3.Продолжить']);
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(notes()).toContain('Разметка ещё идёт. Лист обновится, когда она закончится.'));
    expect(screen.getByText('Изменить список').tagName).toBe('SPAN');
    await waitFor(() => expect(mocks.fetchExamMappingState).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(notes()).not.toContain('Разметка ещё идёт. Лист обновится, когда она закончится.'));
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits for a run started elsewhere instead of starting another', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), { mapping_state: 'running', mapping_started_at: new Date().toISOString(), mapped_at: null }))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, 'full'), question(3, 'none')]));
    mocks.fetchExamMappingState.mockResolvedValueOnce(RUNNING()).mockResolvedValue(FINISHED());
    renderDetail();
    await opened();
    await waitFor(() => expect(notes()).toContain('Разметка ещё идёт. Лист обновится, когда она закончится.'));
    await waitFor(() => expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(row('q3')).toHaveAttribute('data-coverage', 'none'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers «Продолжить» for a run that stopped long ago', async () => {
    const stream = liveStream();
    const fetchMock = vi.fn(async () => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'running', mapping_started_at: old }));
    renderDetail();
    await opened();
    expect(notes()).toContain('Разметка прервалась: проверено 1 из 3.Продолжить');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    stream.close();
  });

  it('checks again only the questions found by words', async () => {
    const stream = liveStream();
    const fetchMock = vi.fn(async () => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    const list = forty().map((item, index) => (index >= 20 && index < 24 ? question(index + 1, 'unverified') : item));
    mocks.loadExamBundle.mockResolvedValue(bundle(list));
    renderDetail();
    await opened();
    const side = column();
    expect(plain(side.textContent)).toContain('4 вопроса проверены только по словам — доля билетов:');
    fireEvent.click(within(side).getByRole('button', { name: 'Проверить снова' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ question_ids: ['q21', 'q22', 'q23', 'q24'], force: false });
    stream.close();
  });

  /** Runs one mapping of the three unmapped questions to the end: q1 «есть», q2 «нет», q3 «частично». */
  async function mapToTheEnd(afterRun: () => void) {
    const stream = liveStream();
    const fetchMock = vi.fn(async () => stream.response);
    vi.stubGlobal('fetch', fetchMock);
    mocks.loadExamBundle.mockResolvedValueOnce(bundle(unmapped(), notMapped));
    afterRun();
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(notes()).toContain('Часть разметки от 9:40, остальное сейчас.'));
    cleanup();

    // Question 2 was reworded in the editor (its coverage reset); no new run started.
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, 'partial')]));
    renderDetail();
    await opened();
    expect(row('q2')).toHaveAttribute('data-coverage', 'unmapped');
    expect(row('q1')).toHaveAttribute('data-coverage', 'full');
    expect(notes().some((note) => note.startsWith('1 вопрос ещё не сверен с лекциями'))).toBe(true);
    expect(notes()).not.toContain('Часть разметки от 9:40, остальное сейчас.');
    // The ticket shares count question 2 as unknown, not as «нет».
    expect(plain(column().textContent)).toContain('не сверено — 1');
  });

  it('does not repeat «Разметка прервалась» on a later visit when the exam was mapped since', async () => {
    const stream = liveStream();
    vi.stubGlobal('fetch', vi.fn(async () => stream.response));
    mocks.loadExamBundle
      .mockResolvedValueOnce(bundle(unmapped(), notMapped))
      .mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'failed' }));
    renderDetail();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(mocks.verifyEnergy).toHaveBeenCalled());
    stream.send({ type: 'start', questions: 3, to_check: 3, materials: [], skipped: [] });
    stream.send({ type: 'batch', index: 1, total: 2, items: [item('q1', 'full')] });
    stream.close();
    await waitFor(() => expect(notes()).toContain('Разметка прервалась: проверено 1 из 3.Продолжить'));
    cleanup();

    // Mapped to the end in another tab meanwhile.
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'full'), question(2, 'none'), question(3, 'partial')]));
    renderDetail();
    await opened();
    expect(notes().filter((note) => note.includes('прервалась'))).toEqual([]);
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
  it('puts the summary above the sheet, the draw button at the bottom and «почему» in a bottom sheet', async () => {
    setWidth(390);
    mocks.loadExamBundle.mockResolvedValue(bundle(mixed()));
    renderDetail();
    await opened();
    expect(screen.getByRole('region', { name: 'Сводка' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Что это значит для билетов' })).toBeNull();
    const cta = document.querySelector('.ex-cta') as HTMLElement;
    expect(within(cta).getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/exams/exam-1/draw');
    expect(within(cta).getByText('Как на экзамене')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Вопрос 3 о денежном рынке' }));
    const dialog = screen.getByRole('dialog', { name: named('Ни в одной из 2 лекций нет фрагмента об этом') });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
