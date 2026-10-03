import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Analytics, { accuracyLabel, cardsCell, mappingDateText, progressLede } from './Analytics';

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Array<() => { data?: unknown; error?: unknown }>>,
    queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
    fetchMaterialEvents: vi.fn(),
    fetchQuestionEvents: vi.fn(),
  };
  const from = (table: string) => {
    const entry = { table, calls: [] as Array<[string, unknown[]]> };
    state.queries.push(entry);
    const handlers = state.tables[table] ?? [];
    // Each query of a table takes the next scripted answer; the last one repeats.
    const answer = handlers.length > 1 ? handlers.shift()! : handlers[0];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'in', 'order', 'limit', 'range']) {
      builder[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, ...(answer?.() ?? {}) }).then(resolve, reject);
    return builder;
  };
  return Object.assign(state, { from });
});

vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => db.from(table) } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../components/Gradebook', () => ({ default: () => <div>Зачётка на экране</div> }));
vi.mock('../api/learning', () => ({
  fetchMaterialEvents: (...args: unknown[]) => db.fetchMaterialEvents(...args),
  fetchQuestionEvents: (...args: unknown[]) => db.fetchQuestionEvents(...args),
}));

const materials = [
  { id: 'm1', title: 'Энтропия', subject: 'Физика', created_at: '2026-10-01T10:00:00Z' },
  { id: 'm2', title: 'Новая лекция', subject: '', created_at: '2026-10-02T10:00:00Z' },
];

const reviewed = { last_reviewed_at: '2026-10-03T09:00:00Z' };
const demoCards = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, material_id: 'm1', repetitions: 1, next_review: '2026-10-04T09:00:00Z', ...reviewed })),
  { id: 'c5', material_id: 'm1', repetitions: 0, next_review: '2026-10-04T09:00:00Z', ...reviewed },
];

function quizEvent(session: string, index: number, correct: boolean, day: string, retake: boolean) {
  return {
    id: `${session}-${index}`, created_at: `${day}T10:00:0${index}Z`, local_date: day, material_id: 'm1', kind: 'quiz_answer',
    item_key: `quiz:m1:${index}`, correct, score: correct ? 1 : 0, confidence: null, source_ids: [], session_id: session,
    payload: { v: 1, index, retake },
  };
}

const demoQuiz = [
  ...[true, true, true, true, false].map((ok, i) => quizEvent('s1', i, ok, '2026-10-02', false)),
  ...[true, true, true, true, true].map((ok, i) => quizEvent('s2', i, ok, '2026-10-03', true)),
];

function examAnswer(hash: string, day: string, correct: boolean, id: string) {
  return {
    id, created_at: `${day}T12:00:00Z`, local_date: day, material_id: null, kind: 'exam_answer', item_key: `q:${hash}`,
    correct, score: correct ? 0.8 : 0.3, confidence: null, source_ids: [], session_id: `session-${id}`, payload: { grade: correct ? 4 : 2 },
  };
}

function setTable(table: string, ...answers: Array<() => { data?: unknown; error?: unknown }>) {
  db.tables[table] = answers;
}

function args(table: string, method: string): unknown[][] {
  return db.queries
    .filter((query) => query.table === table)
    .flatMap((query) => query.calls.filter(([name]) => name === method).map(([, a]) => a));
}

function renderProgress(url = '/analytics') {
  return render(<MemoryRouter initialEntries={[url]}><Analytics /></MemoryRouter>);
}

beforeEach(() => {
  db.queries.length = 0;
  for (const table of Object.keys(db.tables)) delete db.tables[table];
  setTable('materials', () => ({ data: materials }));
  setTable('flashcard_progress', () => ({ data: demoCards }));
  setTable('study_sessions', () => ({ data: [] }));
  setTable('exam_sessions', () => ({ data: [] }));
  setTable('mistake_diary', () => ({ data: [] }));
  setTable('exams', () => ({ data: [] }));
  setTable('exam_questions', () => ({ data: [] }));
  db.fetchMaterialEvents.mockReset().mockResolvedValue(demoQuiz);
  db.fetchQuestionEvents.mockReset().mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The demo data is dated 1–3 October 2026; only Date is faked, so timers and waitFor stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T12:00:00'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The table row of a lecture. */
async function lectureRow(title: string) {
  return (await screen.findByRole('link', { name: title })).closest('tr') as HTMLElement;
}

function todayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

describe('Progress per lecture', () => {
  it('shows measured counters for the demo run as a table instead of a mastery percentage', async () => {
    renderProgress();

    const row = await lectureRow('Энтропия');
    expect(within(row).getByText('5 из 6 вспомнили')).toBeInTheDocument();
    expect(within(row).getByText('закреплённых пока нет, следующая проверка 4 окт.')).toBeInTheDocument();
    expect(within(row).getByText('4 из 5, 2 окт.')).toBeInTheDocument();
    expect(within(row).getByText('повторно 3 окт.: 5 из 5')).toBeInTheDocument();
    expect(within(row).getByText('9 из 11')).toBeInTheDocument();
    expect(within(row).getByText('82 %')).toBeInTheDocument();
    expect(within(row.closest('table')!).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Лекция', 'Карточки', 'Тест, первая попытка', 'Верно при последней проверке']);
    expect(screen.getByRole('button', { name: 'Как считается' })).toHaveAttribute('aria-expanded', 'false');
    expect(db.fetchMaterialEvents).toHaveBeenCalledWith({ kinds: ['quiz_answer'] });
  });

  it('marks an untouched lecture as not checked, never as a red 0%', async () => {
    renderProgress();

    const row = await lectureRow('Новая лекция');
    expect(within(row).getByText('не проверялось')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/(^|\s)0%/);
    expect(screen.queryByText('Профиль навыков')).not.toBeInTheDocument();
    expect(screen.queryByText(/Освоено|освоения/)).not.toBeInTheDocument();
  });

  it('says «мало данных» below three measured answers', async () => {
    setTable('flashcard_progress', () => ({ data: [demoCards[0]] }));
    db.fetchMaterialEvents.mockResolvedValue([]);
    renderProgress();

    const row = await lectureRow('Энтропия');
    expect(within(row).getByText('мало данных')).toBeInTheDocument();
    expect(within(row).getByText('теста не было')).toBeInTheDocument();
  });

  it('shows an error line instead of zeros when the cards cannot be read, and retries', async () => {
    setTable('flashcard_progress', () => ({ data: null, error: { code: '08006', message: 'offline' } }), () => ({ data: demoCards }));
    const user = userEvent.setup();
    renderProgress();

    const alert = await screen.findByText(/Карточки не загрузились/);
    expect(screen.queryByText(/вспомнили/)).not.toBeInTheDocument();
    expect(screen.queryByText('9 из 11')).not.toBeInTheDocument();
    expect(screen.getByText('4 из 5, 2 окт.')).toBeInTheDocument();

    await user.click(within(alert.closest('p')!).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('5 из 6 вспомнили')).toBeInTheDocument();
  });

  it('words the card cell for cards that were never reviewed', () => {
    expect(cardsCell({ total: 6, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null })).toEqual({ main: '6 карточек, ещё не повторялись', sub: null, quiet: true });
    expect(cardsCell({ total: 1, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null })?.main).toBe('1 карточка, ещё не повторялась');
    expect(cardsCell({ total: 0, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null })).toBeNull();
  });

  it('counts «вспомнили» among reviewed cards and names the ones still waiting for review', () => {
    expect(cardsCell({ total: 20, reviewed: 3, recalled: 3, consolidated: 0, nextCheck: null })).toEqual({
      main: '3 из 3 вспомнили',
      sub: 'ещё 17 не повторялись, закреплённых пока нет',
      quiet: false,
    });
    expect(cardsCell({ total: 8, reviewed: 8, recalled: 6, consolidated: 2, nextCheck: '2026-10-05T09:00:00Z' })).toEqual({
      main: '6 из 8 вспомнили',
      sub: '2 закреплены, следующая проверка 5 окт.',
      quiet: false,
    });
  });

  it('does not count an examiner follow-up card waiting for its first review as forgotten', async () => {
    const recalledCards = demoCards.slice(0, 5);
    const followUp = { id: 'c-follow', material_id: 'm1', repetitions: 0, next_review: '2026-10-04T09:00:00Z', last_reviewed_at: null, origin: 'oral_followup' };
    setTable('flashcard_progress', () => ({ data: [...recalledCards, followUp] }));
    renderProgress();

    const row = await lectureRow('Энтропия');
    expect(within(row).getByText('5 из 5 вспомнили')).toBeInTheDocument();
    expect(within(row).getByText('ещё 1 не повторялась, закреплённых пока нет, следующая проверка 4 окт.')).toBeInTheDocument();
    // The share counts the same reviewed cards: (5 + 4) / (5 + 5).
    expect(within(row).getByText('9 из 10')).toBeInTheDocument();
    expect(within(row).getByText('90 %')).toBeInTheDocument();
  });

  it('names the share after what it is made of', () => {
    const cards = (reviewed: number) => ({ total: 6, reviewed, recalled: 0, consolidated: 0, nextCheck: null });
    const quiz = { date: '2026-10-02', correct: 4, total: 5 };
    expect(accuracyLabel({ cards: cards(6), quiz })).toBe('Верно по карточкам и первому тесту');
    expect(accuracyLabel({ cards: cards(6), quiz: null })).toBe('Верно по карточкам');
    expect(accuracyLabel({ cards: cards(0), quiz })).toBe('Верно в первом тесте');
  });
});

describe('Progress page (redesign spec 5.17)', () => {
  it('puts «Экзамены» first, with no tabs and no spinner', async () => {
    const { container } = renderProgress();
    expect(container.querySelector('[role="tablist"], .animate-spin')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'По лекциям' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings.slice(0, 4)).toEqual(['Экзамены', 'По лекциям', 'Ответы по дням', 'Темы с открытыми ошибками']);
    expect(screen.getByRole('link', { name: 'Оценки из зачётки' })).toHaveAttribute('href', '/analytics?tab=gradebook');
  });

  it('says what the numbers are made of and since when', async () => {
    setTable('study_sessions', () => ({ data: [{ date: todayKey(), cards_reviewed: 6 }] }));
    renderProgress();
    // Ten answers in the two demo tests (2 and 3 October) and six card reviews today.
    expect(await screen.findByText('По 10 ответам в тестах и 6 повторениям карточек с 2 октября.')).toBeInTheDocument();
    expect(progressLede({ ticketAnswers: 46, cardReviews: 212, since: '2026-09-27' })).toBe('По 46 ответам на билеты и 212 повторениям карточек с 27 сентября.');
    expect(progressLede({ ticketAnswers: 1, cardReviews: 0, since: '2026-09-27' })).toBe('По 1 ответу на билеты с 27 сентября.');
    expect(progressLede({ ticketAnswers: 0, cardReviews: 0, since: null })).toBe('Ответов на билеты, тестов и повторений карточек пока нет.');
    // Test answers are named as well, so the line never says «nothing yet» above a table with test results.
    expect(progressLede({ ticketAnswers: 0, testAnswers: 5, cardReviews: 0, since: '2026-10-03' })).toBe('По 5 ответам в тестах с 3 октября.');
    expect(progressLede({ ticketAnswers: 2, testAnswers: 21, cardReviews: 5, since: '2026-10-01' })).toBe(
      'По 2 ответам на билеты, 21 ответу в тестах и 5 повторениям карточек с 1 октября.',
    );
  });

  it('opens the gradebook from the link at the end', async () => {
    renderProgress('/analytics?tab=gradebook');
    expect(await screen.findByText('Зачётка на экране')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Оценки из зачётки' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('Progress sources', () => {
  it('keeps answers to exam tickets out of the old oral exam statistics', async () => {
    setTable('exam_sessions', () => ({
      data: [
        { id: 'x1', kind: 'professor', score: 72, subject: 'Физика', completed_at: '2026-09-30T10:00:00Z' },
        { id: 'x2', kind: 'oral_ticket', score: 90, subject: 'Макроэкономика', completed_at: '2026-10-02T10:00:00Z' },
      ],
    }));
    renderProgress();

    expect(await screen.findByRole('heading', { name: 'Устные экзамены (прежний формат)' })).toBeInTheDocument();
    expect(screen.getByText('Пройдено: 1. Последний 30 сент.: 72 балла из 100.')).toBeInTheDocument();
    expect(screen.queryByText(/Макроэкономика/)).not.toBeInTheDocument();
    expect(args('exam_sessions', 'eq')).toContainEqual(['kind', 'professor']);
  });

  it('lists only open mistakes by topic', async () => {
    setTable('mistake_diary', () => ({ data: [{ topic: 'Физика' }, { topic: 'Физика' }, { topic: 'Химия' }, { topic: '' }] }));
    renderProgress();

    expect(await screen.findByText('Открытых ошибок: 4.')).toBeInTheDocument();
    expect(screen.getByText('2 ошибки')).toBeInTheDocument();
    expect(screen.getByText('Без темы: 1.')).toBeInTheDocument();
    expect(args('mistake_diary', 'eq')).toContainEqual(['is_resolved', false]);
  });

  it('sums the activity of a day and labels the chart', async () => {
    const key = todayKey();
    setTable('study_sessions', () => ({ data: [{ date: key, cards_reviewed: 3 }, { date: key, cards_reviewed: 4 }] }));
    renderProgress();

    expect(await screen.findByRole('heading', { name: 'Ответы по дням' })).toBeInTheDocument();
    expect(screen.getByText(/^Ответы на карточки по дням; больше всего 7 — /)).toBeInTheDocument();
    // Today's cards (3 October) and the two demo tests (2 and 3 October): two days of study.
    expect(screen.getByText('За 30 дней: 7 ответов на карточки, 2 теста, занятия в 2 из 30 дней, сейчас 1 день подряд.')).toBeInTheDocument();
    expect(screen.getByText('сегодня')).toBeInTheDocument();
  });

  it('names only what happened in 30 days and draws no empty axis', async () => {
    db.fetchMaterialEvents.mockResolvedValue([]);
    setTable('flashcard_progress', () => ({ data: [] }));
    renderProgress();

    expect(await screen.findByText('За 30 дней ответов на карточки и тестов не было.')).toBeInTheDocument();
    expect(screen.queryByText('сегодня')).toBeNull();
    expect(screen.queryByText(/0 ответов|0 дней подряд|занятия в 0/)).toBeNull();
  });

  it('says that an exam list was not mapped yet instead of «0 из N»', async () => {
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Макроэкономика', exam_date: '2026-10-15', mapped_at: null }] }));
    setTable('exam_questions', () => ({
      data: ['a', 'b', 'c'].map((ch, index) => ({ id: `q${index}`, exam_id: 'e1', section: null, question_hash: ch.repeat(32), coverage: null })),
    }));
    renderProgress();

    const row = (await screen.findByRole('link', { name: 'Макроэкономика' })).closest('li')!;
    expect(within(row).getByText('Разметки по лекциям ещё нет.')).toBeInTheDocument();
    expect(within(row).queryByText(/Есть в ваших лекциях/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Разметка от/)).not.toBeInTheDocument();
    expect(args('exams', 'select')).toEqual([['id, title, kind, exam_date, mapped_at, ticket_layout']]);
  });

  it('names unmapped and word-only questions of an interrupted mapping and dates the mapping', async () => {
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Макроэкономика', exam_date: '2026-10-15', mapped_at: '2026-09-30T12:40:00Z' }] }));
    setTable('exam_questions', () => ({
      data: [
        { id: 'q1', exam_id: 'e1', section: null, question_hash: 'a'.repeat(32), coverage: 'full' },
        { id: 'q2', exam_id: 'e1', section: null, question_hash: 'b'.repeat(32), coverage: 'unverified' },
        { id: 'q3', exam_id: 'e1', section: null, question_hash: 'c'.repeat(32), coverage: null },
      ],
    }));
    renderProgress();

    const row = (await screen.findByRole('link', { name: 'Макроэкономика' })).closest('li')!;
    expect(
      within(row).getByText(/^Есть в ваших лекциях: 1 из 3 · частично 0 · нет 0 · только по словам 1 · не размечено 1\. Разметка от 30 сентября, \d{1,2}:\d{2}\.$/),
    ).toBeInTheDocument();
  });

  it('dates a mapping in the words of the exam sheet', () => {
    expect(mappingDateText(null)).toBeNull();
    expect(mappingDateText('garbage')).toBeNull();
    expect(mappingDateText('2026-01-21T12:40:00Z')).toMatch(/^Разметка от 21 января, \d{1,2}:\d{2}\.$/);
  });

  it('shows the exam ledger row: confirmed questions, what it means for tickets, answers since', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map((ch) => ch.repeat(32));
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Экзамен: макроэкономика', kind: 'exam', exam_date: '2026-10-15', ticket_layout: { mode: 'random', per_ticket: 2 } }] }));
    setTable('exam_questions', () => ({
      data: [
        { id: 'q1', exam_id: 'e1', section: null, question_hash: a, coverage: 'full' },
        { id: 'q2', exam_id: 'e1', section: null, question_hash: b, coverage: 'partial' },
        { id: 'q3', exam_id: 'e1', section: null, question_hash: c, coverage: 'none' },
      ],
    }));
    db.fetchQuestionEvents.mockResolvedValue([
      examAnswer(a, '2026-10-01', true, '1'),
      examAnswer(a, '2026-10-02', true, '2'),
      examAnswer(b, '2026-10-02', false, '3'),
    ]);
    renderProgress();

    const link = await screen.findByRole('link', { name: 'Макроэкономика' });
    expect(link).toHaveAttribute('href', '/exams/e1');
    const row = link.closest('li') as HTMLElement;
    expect(within(row).getByText(/ответы на билеты с 1 октября$/)).toBeInTheDocument();
    expect(within(row).getByText('Есть в ваших лекциях: 1 из 3 · частично 1 · нет 1.')).toBeInTheDocument();
    expect(row.querySelector('.sf-ledger-fig')?.textContent).toBe('1 из 3');
    expect(within(row).getByText('вопросов подтверждено ответами')).toBeInTheDocument();
    // C(1, 2) / C(3, 2): no ticket has both questions confirmed yet.
    expect(within(row).getByText('0 %')).toBeInTheDocument();
    expect(within(row).getByText('билетов, где подтверждены оба вопроса')).toBeInTheDocument();
    expect(within(row).getByText(/Зачтено в один день — 0, не зачтено — 1\. Самооценка против ответов вслух: мало данных\./)).toBeInTheDocument();
    // Three answers aloud in the lede, next to the ten test answers of the demo tests.
    expect(screen.getByText(/^По 3 ответам на билеты и 10 ответам в тестах с 1 октября\.$/)).toBeInTheDocument();
    expect(db.fetchQuestionEvents).toHaveBeenCalledWith([a, b, c]);
  });

  it('keeps the other blocks when exams fail', async () => {
    setTable('exams', () => ({ data: null, error: { code: '42P01', message: 'missing' } }));
    renderProgress();

    expect(await screen.findByText(/Экзамены не загрузились/)).toBeInTheDocument();
    expect(screen.getByText('4 из 5, 2 окт.')).toBeInTheDocument();
  });
});
