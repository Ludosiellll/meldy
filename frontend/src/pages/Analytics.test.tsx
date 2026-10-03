import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Analytics, { accuracyLabel, cardsLine, mappingDateText } from './Analytics';

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
});

afterEach(cleanup);

describe('Progress per material', () => {
  it('shows measured counters for the demo run instead of a mastery percentage', async () => {
    renderProgress();

    expect(await screen.findByText('Карточки: вспомнили 5 из 6 при последнем повторе. Закреплено 0 из 6, следующая проверка 4 окт.')).toBeInTheDocument();
    expect(screen.getByText('Тест 2 окт.: 4 из 5.')).toBeInTheDocument();
    expect(screen.getByText('Повторно 3 окт.: 5 из 5.')).toBeInTheDocument();
    expect(screen.getByText('Верно по карточкам и первому тесту: 82% (9 из 11).')).toBeInTheDocument();
    expect(screen.getByText(/Посчитано .* по вашим ответам\./)).toBeInTheDocument();
    expect(screen.getByText(/Как считается/)).toBeInTheDocument();
    expect(db.fetchMaterialEvents).toHaveBeenCalledWith({ kinds: ['quiz_answer'] });
  });

  it('marks an untouched material as not checked, never as a red 0%', async () => {
    renderProgress();

    const row = (await screen.findByRole('link', { name: 'Новая лекция' })).closest('li')!;
    expect(within(row).getByText('Не проверялось')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/(^|\s)0%/);
    expect(screen.queryByText('Профиль навыков')).not.toBeInTheDocument();
    expect(screen.queryByText(/Освоено|освоения/)).not.toBeInTheDocument();
  });

  it('says «мало данных» below three measured answers', async () => {
    setTable('flashcard_progress', () => ({ data: [demoCards[0]] }));
    db.fetchMaterialEvents.mockResolvedValue([]);
    renderProgress();

    const row = (await screen.findByRole('link', { name: 'Энтропия' })).closest('li')!;
    expect(within(row).getByText('Верно по карточкам: мало данных.')).toBeInTheDocument();
  });

  it('shows an error line instead of zeros when the cards cannot be read, and retries', async () => {
    setTable('flashcard_progress', () => ({ data: null, error: { code: '08006', message: 'offline' } }), () => ({ data: demoCards }));
    const user = userEvent.setup();
    renderProgress();

    const alert = await screen.findByText(/Карточки не загрузились/);
    expect(screen.queryByText(/вспомнили 0 из/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Верно по/)).not.toBeInTheDocument();
    expect(screen.getByText('Тест 2 окт.: 4 из 5.')).toBeInTheDocument();

    await user.click(within(alert.closest('p')!).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText(/вспомнили 5 из 6/)).toBeInTheDocument();
  });

  it('formats card lines for cards that were never reviewed', () => {
    expect(cardsLine({ total: 6, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null })).toBe('Карточки: 6, ещё не повторялись.');
    expect(cardsLine({ total: 1, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null })).toBe('Карточки: 1, ещё не повторялась.');
    expect(cardsLine({ total: 0, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null })).toBeNull();
  });

  it('counts «вспомнили» among reviewed cards and names the ones still waiting for review', () => {
    expect(cardsLine({ total: 20, reviewed: 3, recalled: 3, consolidated: 0, nextCheck: null })).toBe(
      'Карточки: вспомнили 3 из 3 при последнем повторе, ещё 17 не повторялись. Закреплено 0 из 20.',
    );
    expect(cardsLine({ total: 6, reviewed: 6, recalled: 5, consolidated: 0, nextCheck: null })).toBe(
      'Карточки: вспомнили 5 из 6 при последнем повторе. Закреплено 0 из 6.',
    );
  });

  it('does not count an examiner follow-up card waiting for its first review as forgotten', async () => {
    const recalledCards = demoCards.slice(0, 5);
    const followUp = { id: 'c-follow', material_id: 'm1', repetitions: 0, next_review: '2026-10-04T09:00:00Z', last_reviewed_at: null, origin: 'oral_followup' };
    setTable('flashcard_progress', () => ({ data: [...recalledCards, followUp] }));
    renderProgress();

    expect(
      await screen.findByText('Карточки: вспомнили 5 из 5 при последнем повторе, ещё 1 не повторялась. Закреплено 0 из 6, следующая проверка 4 окт.'),
    ).toBeInTheDocument();
    // The share counts the same reviewed cards: (5 + 4) / (5 + 5).
    expect(screen.getByText('Верно по карточкам и первому тесту: 90% (9 из 10).')).toBeInTheDocument();
  });

  it('names the share after what it is made of', () => {
    const cards = (reviewed: number) => ({ total: 6, reviewed, recalled: 0, consolidated: 0, nextCheck: null });
    const quiz = { date: '2026-10-02', correct: 4, total: 5 };
    expect(accuracyLabel({ cards: cards(6), quiz })).toBe('Верно по карточкам и первому тесту');
    expect(accuracyLabel({ cards: cards(6), quiz: null })).toBe('Верно по карточкам');
    expect(accuracyLabel({ cards: cards(0), quiz })).toBe('Верно в первом тесте');
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
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setTable('study_sessions', () => ({ data: [{ date: key, cards_reviewed: 3 }, { date: key, cards_reviewed: 4 }] }));
    renderProgress();

    expect(await screen.findByRole('heading', { name: 'Ответов на карточки по дням, 30 дней' })).toBeInTheDocument();
    expect(screen.getByText(/За 30 дней: 7 ответов, больше всего 7/)).toBeInTheDocument();
    expect(screen.getByText(/За 30 дней: 7 ответов на карточки, 2 теста, занятия в 1 из 30 дней, сейчас 1 день подряд\./)).toBeInTheDocument();
  });

  it('says that an exam list was not mapped yet instead of «0 из N»', async () => {
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Макроэкономика', exam_date: '2026-10-15', mapped_at: null }] }));
    setTable('exam_questions', () => ({
      data: ['a', 'b', 'c'].map((ch) => ({ exam_id: 'e1', question_hash: ch.repeat(32), coverage: null })),
    }));
    renderProgress();

    const row = (await screen.findByRole('link', { name: 'Макроэкономика' })).closest('li')!;
    expect(within(row).getByText('Разметки по лекциям ещё нет.')).toBeInTheDocument();
    expect(within(row).queryByText(/Есть в ваших лекциях/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Не размечено/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^Разметка от/)).not.toBeInTheDocument();
    expect(args('exams', 'select')).toEqual([['id, title, exam_date, mapped_at']]);
  });

  it('names unmapped and word-only questions of an interrupted mapping and dates the mapping', async () => {
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Макроэкономика', exam_date: '2026-10-15', mapped_at: '2026-09-30T12:40:00Z' }] }));
    setTable('exam_questions', () => ({
      data: [
        { exam_id: 'e1', question_hash: 'a'.repeat(32), coverage: 'full' },
        { exam_id: 'e1', question_hash: 'b'.repeat(32), coverage: 'unverified' },
        { exam_id: 'e1', question_hash: 'c'.repeat(32), coverage: null },
      ],
    }));
    renderProgress();

    const row = (await screen.findByRole('link', { name: 'Макроэкономика' })).closest('li')!;
    expect(
      within(row).getByText('Есть в ваших лекциях: 1 из 3. Частично: 0. Нет: 0. Проверено только по словам: 1. Не размечено: 1.'),
    ).toBeInTheDocument();
    expect(within(row).getByText(/^Разметка от 30 сентября, \d{1,2}:\d{2}\.$/)).toBeInTheDocument();
  });

  it('dates a mapping in the words of the exam sheet', () => {
    expect(mappingDateText(null)).toBeNull();
    expect(mappingDateText('garbage')).toBeNull();
    expect(mappingDateText('2026-01-21T12:40:00Z')).toMatch(/^Разметка от 21 января, \d{1,2}:\d{2}\.$/);
  });

  it('shows the exam block from coverage, answers aloud and self-ratings', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map((ch) => ch.repeat(32));
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Макроэкономика', exam_date: '2026-10-15' }] }));
    setTable('exam_questions', () => ({
      data: [
        { exam_id: 'e1', question_hash: a, coverage: 'full' },
        { exam_id: 'e1', question_hash: b, coverage: 'partial' },
        { exam_id: 'e1', question_hash: c, coverage: 'none' },
      ],
    }));
    db.fetchQuestionEvents.mockResolvedValue([
      examAnswer(a, '2026-10-01', true, '1'),
      examAnswer(a, '2026-10-02', true, '2'),
      examAnswer(b, '2026-10-02', false, '3'),
    ]);
    renderProgress();

    expect(await screen.findByRole('link', { name: 'Макроэкономика' })).toHaveAttribute('href', '/exams/e1');
    expect(screen.getByText('Есть в ваших лекциях: 1 из 3. Частично: 1. Нет: 1.')).toBeInTheDocument();
    expect(screen.getByText('Подтверждено ответами: 1 из 3, с 1 окт.')).toBeInTheDocument();
    expect(screen.getByText('Самооценка против ответов вслух: мало данных.')).toBeInTheDocument();
    expect(db.fetchQuestionEvents).toHaveBeenCalledWith([a, b, c]);
  });

  it('keeps the other blocks when exams fail', async () => {
    setTable('exams', () => ({ data: null, error: { code: '42P01', message: 'missing' } }));
    renderProgress();

    expect(await screen.findByText(/Экзамены не загрузились/)).toBeInTheDocument();
    expect(screen.getByText('Тест 2 окт.: 4 из 5.')).toBeInTheDocument();
  });

  it('keeps the gradebook tab as it was', async () => {
    renderProgress('/analytics?tab=gradebook');
    expect(await screen.findByText('Зачётка на экране')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Оценки' })).toHaveAttribute('aria-selected', 'true');
  });
});
