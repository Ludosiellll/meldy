import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Dashboard, { cardsMissingFromReview, examAnswersText, examCoverageText, examWhen, mappingDateText } from './Dashboard';
import { localDateKey, shiftDateKey } from '../utils/streak';

type Result = { data?: unknown; error?: unknown };
type Call = [string, unknown[]];

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, () => { data?: unknown; error?: unknown }>,
    queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
    getMaterials: vi.fn(),
    countDueCards: vi.fn(),
    syncFlashcards: vi.fn(),
    fetchQuestionEvents: vi.fn(),
  };
  const from = (table: string) => {
    const entry = { table, calls: [] as Array<[string, unknown[]]> };
    state.queries.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'order', 'limit']) {
      builder[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, ...(state.tables[table]?.() ?? {}) }).then(resolve, reject);
    return builder;
  };
  return Object.assign(state, { from });
});

vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => db.from(table) } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1', user_metadata: { full_name: 'Анна Иванова' } } }) }));
vi.mock('../api/materials', () => ({ getMaterials: (...args: unknown[]) => db.getMaterials(...args) }));
vi.mock('../api/flashcards', () => ({
  countDueCards: (...args: unknown[]) => db.countDueCards(...args),
  syncFlashcards: (...args: unknown[]) => db.syncFlashcards(...args),
}));
vi.mock('../api/learning', () => ({ fetchQuestionEvents: (...args: unknown[]) => db.fetchQuestionEvents(...args) }));

const today = localDateKey();
const lecture = {
  id: 'm-1',
  title: 'Денежный рынок',
  created_at: '2026-10-01T10:00:00Z',
  summary_json: { content: 'Конспект' },
  flashcards_json: { flashcards: [{ id: 1, question: 'Что такое ставка?', answer: 'Цена денег' }] },
};
const textOnly = {
  id: 'm-2',
  title: 'Лекция только текстом',
  created_at: '2026-10-01T09:00:00Z',
  summary_json: { text_only: true },
  flashcards_json: { flashcards: [] },
};

function args(table: string, method: string): unknown[][] {
  return db.queries
    .filter((query) => query.table === table)
    .flatMap((query) => query.calls.filter(([name]) => name === method).map(([, a]) => a));
}

function answer(hash: string, day: string, correct: boolean, id: string) {
  return {
    id, created_at: `${day}T10:00:00Z`, local_date: day, material_id: null, kind: 'exam_answer',
    item_key: `q:${hash}`, correct, score: correct ? 0.8 : 0.3, confidence: null, source_ids: [], session_id: `s-${id}`, payload: {},
  };
}

function renderDashboard() {
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
}

beforeEach(() => {
  db.queries.length = 0;
  for (const table of Object.keys(db.tables)) delete db.tables[table];
  db.getMaterials.mockReset().mockResolvedValue([lecture]);
  db.countDueCards.mockReset().mockResolvedValue(0);
  db.syncFlashcards.mockReset().mockResolvedValue({ inserted: 1, skipped: 0 });
  db.fetchQuestionEvents.mockReset().mockResolvedValue([]);
  db.tables.flashcard_progress = () => ({ data: [{ material_id: 'm-1' }] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(cleanup);

describe('Dashboard «Сегодня»', () => {
  it('uses the exact due count for the main action and the metric', async () => {
    db.countDueCards.mockResolvedValue(47);
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Повторить 47 карточек' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Начать повторение/ })).toHaveAttribute('href', '/review');
    const metric = screen.getByText('Карточек к повторению').parentElement!;
    expect(within(metric).getByText('47')).toBeInTheDocument();
  });

  it('keeps the streak when today has no activity yet', async () => {
    db.tables.study_sessions = () => ({
      data: [
        { date: shiftDateKey(today, -1), cards_reviewed: 4 },
        { date: shiftDateKey(today, -2), cards_reviewed: 2 },
      ],
    });
    renderDashboard();

    const metric = (await screen.findByText('Дней подряд')).parentElement!;
    expect(within(metric).getByText('2')).toBeInTheDocument();
  });

  it('sums the answers of a day across rows', async () => {
    db.tables.study_sessions = () => ({
      data: [
        { date: today, cards_reviewed: 3 },
        { date: today, cards_reviewed: 2 },
      ],
    });
    renderDashboard();

    const metric = (await screen.findByText('Ответов на карточки сегодня')).parentElement!;
    expect(within(metric).getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/За 14 дней: 5 ответов/)).toBeInTheDocument();
  });

  it('shows a load error with a retry instead of the empty library', async () => {
    db.getMaterials.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([lecture]);
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить данные' })).toBeInTheDocument();
    expect(screen.queryByText('Добавьте учебный материал')).not.toBeInTheDocument();
    expect(screen.queryByText('В библиотеке пока нет материалов.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Карточек к повторению сейчас нет' })).toBeInTheDocument();
  });

  it('treats a failed activity read as a load error too', async () => {
    db.tables.study_sessions = () => ({ data: null, error: { code: '08006', message: 'offline' } });
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить данные' })).toBeInTheDocument();
  });

  it('leads with the nearest exam within three weeks', async () => {
    db.countDueCards.mockResolvedValue(5);
    db.tables.exams = () => ({
      data: [{ id: 'e-1', title: 'Макроэкономика', exam_date: shiftDateKey(today, 12), mapped_at: '2026-09-30T12:40:00Z' }],
    });
    db.tables.exam_questions = () => ({
      data: [
        { id: 'q1', question_hash: 'a'.repeat(32), coverage: 'full' },
        { id: 'q2', question_hash: 'b'.repeat(32), coverage: 'full' },
        { id: 'q3', question_hash: 'c'.repeat(32), coverage: 'none' },
      ],
    });
    db.fetchQuestionEvents.mockResolvedValue([
      answer('a'.repeat(32), shiftDateKey(today, -2), true, '1'),
      answer('a'.repeat(32), shiftDateKey(today, -1), true, '2'),
      answer('b'.repeat(32), shiftDateKey(today, -1), false, '3'),
    ]);
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Макроэкономика — через 12 дней.' })).toBeInTheDocument();
    expect(screen.getByText('Есть в ваших лекциях: 2 из 3. Подтверждено ответами: 1 из 3.')).toBeInTheDocument();
    // The mapping is a prepared result: it carries its date, in the words of the exam sheet.
    expect(screen.getByText(/^Разметка от 30 сентября, \d{1,2}:\d{2}\.$/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Тянуть билет/ })).toHaveAttribute('href', '/exams/e-1/draw');
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/e-1');
    expect(screen.getByRole('link', { name: 'Повторить 5 карточек' })).toHaveAttribute('href', '/review');
    expect(args('exams', 'select')).toEqual([['id, title, exam_date, mapped_at']]);
    expect(args('exams', 'gte')).toEqual([['exam_date', today]]);
    expect(args('exams', 'lte')).toEqual([['exam_date', shiftDateKey(today, 21)]]);
    expect(db.fetchQuestionEvents).toHaveBeenCalledWith(['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)], ['exam_answer']);
  });

  it('says that a list was not mapped yet instead of «0 из N»', async () => {
    db.tables.exams = () => ({ data: [{ id: 'e-1', title: 'Макроэкономика', exam_date: shiftDateKey(today, 5), mapped_at: null }] });
    db.tables.exam_questions = () => ({
      data: [
        { id: 'q1', question_hash: 'a'.repeat(32), coverage: null },
        { id: 'q2', question_hash: 'b'.repeat(32), coverage: null },
        { id: 'q3', question_hash: 'c'.repeat(32), coverage: null },
      ],
    });
    renderDashboard();

    expect(await screen.findByText('Разметки по лекциям ещё нет. Ответов по билетам ещё не было.')).toBeInTheDocument();
    expect(screen.queryByText(/Есть в ваших лекциях/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 из 3/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Разметка от/)).not.toBeInTheDocument();
    // The exam sheet is where the list gets mapped.
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/e-1');
  });

  it('names questions that were checked only by words or not mapped after an interrupted run', async () => {
    db.tables.exams = () => ({
      data: [{ id: 'e-1', title: 'Макроэкономика', exam_date: shiftDateKey(today, 5), mapped_at: '2026-09-30T12:40:00Z' }],
    });
    db.tables.exam_questions = () => ({
      data: [
        { id: 'q1', question_hash: 'a'.repeat(32), coverage: 'full' },
        { id: 'q2', question_hash: 'b'.repeat(32), coverage: 'unverified' },
        { id: 'q3', question_hash: 'c'.repeat(32), coverage: null },
        { id: 'q4', question_hash: 'd'.repeat(32), coverage: null },
      ],
    });
    db.fetchQuestionEvents.mockResolvedValue([answer('a'.repeat(32), shiftDateKey(today, -1), true, '1')]);
    renderDashboard();

    expect(
      await screen.findByText(
        'Есть в ваших лекциях: 1 из 4. Проверено только по словам: 1. Не размечено: 2. Подтверждено ответами: 0 из 4.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Разметка от 30 сентября/)).toBeInTheDocument();
  });

  it('keeps the rest of the page when exams cannot be read', async () => {
    db.countDueCards.mockResolvedValue(3);
    db.tables.exams = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Повторить 3 карточки' })).toBeInTheDocument();
    expect(screen.getByText(/Экзамены не загрузились/)).toBeInTheDocument();
  });

  it('notes analysed lectures whose cards are not in review, never text-only lectures', async () => {
    const otherLecture = { ...lecture, id: 'm-3', title: 'Инфляция' };
    db.getMaterials.mockResolvedValue([otherLecture, textOnly, lecture]);
    db.tables.flashcard_progress = () => ({ data: [{ material_id: 'm-1' }] });
    renderDashboard();

    await screen.findByText('Инфляция');
    const notes = screen.getAllByText(/Карточки этой лекции не добавлены в повторение/);
    expect(notes).toHaveLength(1);
    expect(notes[0].closest('li')).toHaveTextContent('Инфляция');
    expect(screen.getByText('Лекция только текстом').closest('li')).not.toHaveTextContent('не добавлены');
    expect(args('flashcard_progress', 'in')).toEqual([['material_id', ['m-3', 'm-2', 'm-1']]]);
  });

  it('leaves the notes out when the review cards cannot be read', async () => {
    db.tables.flashcard_progress = () => ({ data: null, error: { code: '08006', message: 'offline' } });
    renderDashboard();

    expect(await screen.findByText('Денежный рынок')).toBeInTheDocument();
    expect(screen.queryByText(/не добавлены в повторение/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Не удалось загрузить данные' })).not.toBeInTheDocument();
  });

  it('adds the missing cards of a lecture to review', async () => {
    db.getMaterials.mockResolvedValue([lecture]);
    db.tables.flashcard_progress = () => ({ data: [] });
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Добавить' }));

    expect(db.syncFlashcards).toHaveBeenCalledWith('user-1', 'm-1', [{ id: 1, question: 'Что такое ставка?', answer: 'Цена денег' }]);
    expect(db.getMaterials).toHaveBeenCalledTimes(2);
  });

  it('notes missing cards only when the material has cards and none of them is in review', () => {
    const card = { id: 1, question: 'Что такое ставка?', answer: 'Цена денег' };
    const inReview = new Set(['m-1']);
    expect(cardsMissingFromReview({ ...lecture, id: 'm-3' }, inReview)).toBe(true);
    expect(cardsMissingFromReview(lecture, inReview)).toBe(false);
    // Unknown review state (the read failed): no claim either way.
    expect(cardsMissingFromReview({ ...lecture, id: 'm-3' }, null)).toBe(false);
    // A text-only import is saved without cards, so it never gets the note…
    expect(cardsMissingFromReview(textOnly, new Set())).toBe(false);
    // …and blank cards are not cards.
    expect(cardsMissingFromReview({ ...lecture, id: 'm-4', flashcards_json: { flashcards: [{ question: ' ', answer: '' }] } }, new Set())).toBe(false);
    // Cards made for it later that did not reach review are missing like any others.
    expect(cardsMissingFromReview({ ...textOnly, flashcards_json: { flashcards: [card] } }, new Set())).toBe(true);
  });

  it('words the exam line from the mapping and the answers aloud', () => {
    expect(examCoverageText({ total: 40, inLectures: 0, unverified: 0, unmapped: 40 })).toBe('Разметки по лекциям ещё нет.');
    expect(examCoverageText({ total: 40, inLectures: 24, unverified: 0, unmapped: 0 })).toBe('Есть в ваших лекциях: 24 из 40.');
    expect(examCoverageText({ total: 40, inLectures: 20, unverified: 3, unmapped: 12 })).toBe(
      'Есть в ваших лекциях: 20 из 40. Проверено только по словам: 3. Не размечено: 12.',
    );
    expect(examAnswersText({ total: 40, confirmed: 0, answered: 0 })).toBe('Ответов по билетам ещё не было.');
    expect(examAnswersText({ total: 40, confirmed: 6, answered: 9 })).toBe('Подтверждено ответами: 6 из 40.');
    expect(mappingDateText(null)).toBeNull();
    expect(mappingDateText('not a date')).toBeNull();
    expect(mappingDateText('2026-01-21T12:40:00Z')).toMatch(/^Разметка от 21 января, \d{1,2}:\d{2}\.$/);
  });

  it('says when an exam is today or tomorrow', () => {
    expect(examWhen(0)).toBe('сегодня');
    expect(examWhen(1)).toBe('завтра');
    expect(examWhen(2)).toBe('через 2 дня');
    expect(examWhen(21)).toBe('через 21 день');
  });
});
