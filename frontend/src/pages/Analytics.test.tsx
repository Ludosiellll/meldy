import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Analytics, { ledgerFoot, mappingDateText } from './Analytics';

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Array<() => { data?: unknown; error?: unknown }>>,
    queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
    fetchMaterialEvents: vi.fn(),
    fetchQuestionEvents: vi.fn(),
    syncFlashcards: vi.fn(),
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
vi.mock('../api/flashcards', () => ({ syncFlashcards: (...args: unknown[]) => db.syncFlashcards(...args) }));

const cardsOf = (n: number) => ({ flashcards: Array.from({ length: n }, (_, i) => ({ question: `Вопрос ${i + 1}?`, answer: `Ответ ${i + 1}` })) });
const quizOf = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `Тест ${i + 1}` }));

const materials = [
  { id: 'm1', title: 'Энтропия', subject: 'Физика', created_at: '2026-10-01T10:00:00Z', text_only: null, flashcards_json: cardsOf(6), quiz: quizOf(5) },
  { id: 'm2', title: 'Новая лекция', subject: '', created_at: '2026-10-02T10:00:00Z', text_only: null, flashcards_json: cardsOf(2), quiz: quizOf(2) },
  { id: 'm3', title: 'Лекция текстом', subject: '', created_at: '2026-09-30T10:00:00Z', text_only: true, flashcards_json: { flashcards: [] }, quiz: null },
  { id: 'm4', title: 'Инфляция', subject: '', created_at: '2026-09-29T10:00:00Z', text_only: null, flashcards_json: cardsOf(2), quiz: quizOf(2) },
];

// Now is 3 October 2026, 12:00 local: three cards of «Энтропия» are consolidated, two are learning
// (one forgotten after a success), one is new and due; «Инфляция» is all consolidated; «Новая
// лекция» has cards that never reached review.
const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const demoCards = [
  ...[0, 1, 2].map((i) => ({ id: `c${i}`, material_id: 'm1', repetitions: 2, next_review: local(9, 9), last_reviewed_at: local(2, 9) })),
  { id: 'c3', material_id: 'm1', repetitions: 1, next_review: local(4, 9), last_reviewed_at: local(3, 9) },
  { id: 'c4', material_id: 'm1', repetitions: 0, next_review: local(4, 9), last_reviewed_at: local(3, 9) },
  { id: 'c5', material_id: 'm1', repetitions: 0, next_review: local(1, 9), last_reviewed_at: null },
  { id: 'c6', material_id: 'm4', repetitions: 3, next_review: local(20, 9), last_reviewed_at: local(1, 9) },
  { id: 'c7', material_id: 'm4', repetitions: 3, next_review: local(20, 9), last_reviewed_at: local(1, 9) },
];

function event(kind: string, day: string, correct: boolean | null, material: string | null, id: string, extra: Record<string, unknown> = {}) {
  return { id, created_at: `${day}T10:00:00Z`, local_date: day, material_id: material, kind, item_key: `${kind}:${id}`, correct, score: correct ? 1 : 0, confidence: null, source_ids: [], session_id: null, payload: {}, ...extra };
}

function quizEvent(session: string, index: number, correct: boolean, day: string, retake: boolean) {
  return { ...event('quiz_answer', day, correct, 'm1', `${session}-${index}`), item_key: `quiz:m1:${index}`, session_id: session, payload: { v: 1, index, retake } };
}

const demoQuiz = [
  ...[true, true, true, true, false].map((ok, i) => quizEvent('s1', i, ok, '2026-10-02', false)),
  ...[true, true, true, true, true].map((ok, i) => quizEvent('s2', i, ok, '2026-10-03', true)),
];

// Twelve card answers to «Энтропия» on 3 October, the first day of the journal, six recalled: 50 %.
const demoJournal = Array.from({ length: 12 }, (_, i) => event('card_review', '2026-10-03', i % 2 === 0, 'm1', `r${i}`));

function examAnswer(hash: string, day: string, correct: boolean, id: string, createdAt = `${day}T12:00:00Z`) {
  return {
    id, created_at: createdAt, local_date: day, material_id: null, kind: 'exam_answer', item_key: `q:${hash}`,
    correct, score: correct ? 0.8 : 0.3, confidence: null, source_ids: [], session_id: `session-${id}`, payload: { grade: correct ? 4 : 2 },
  };
}

function setTable(table: string, ...answers: Array<() => { data?: unknown; error?: unknown }>) {
  db.tables[table] = answers;
}

function setJournal(journal: unknown[], quiz: unknown[] = demoQuiz) {
  db.fetchMaterialEvents.mockReset().mockImplementation(async ({ kinds }: { kinds: string[] }) => (kinds.includes('quiz_answer') ? quiz : journal));
}

function args(table: string, method: string): unknown[][] {
  return db.queries
    .filter((query) => query.table === table)
    .flatMap((query) => query.calls.filter(([name]) => name === method).map(([, a]) => a));
}

function renderProgress(url = '/analytics') {
  return render(<MemoryRouter initialEntries={[url]}><Analytics /></MemoryRouter>);
}

const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

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
  setJournal(demoJournal);
  db.fetchQuestionEvents.mockReset().mockResolvedValue([]);
  db.syncFlashcards.mockReset().mockResolvedValue({ inserted: 2, skipped: 0 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The demo data is dated 1–3 October 2026; only Date is faked, so timers and waitFor stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function todayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

/** The row of a lecture in «Лекции». */
async function lectureRow(title: string) {
  const list = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section') as HTMLElement;
  return within(list).getByRole('link', { name: title }).closest('li') as HTMLElement;
}

function tile(name: string) {
  return screen.getByRole('heading', { name }).closest('article') as HTMLElement;
}

describe('Progress page', () => {
  it('answers three questions first, then the gaps, exams, lectures and days; no tabs, no spinner', async () => {
    const { container } = renderProgress();
    expect(await screen.findByRole('heading', { name: 'Что подтянуть' })).toBeInTheDocument();
    expect(container.querySelector('[role="tablist"], .animate-spin')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Карточки',
      'Вспомнили с 3 октября',
      'Повторения на неделю',
      'Что подтянуть',
      'Экзамены',
      'Карта знаний',
      'Лекции',
      'Занятия по дням',
    ]);
    expect(screen.getByRole('link', { name: 'Оценки из зачётки' })).toHaveAttribute('href', '/analytics?tab=gradebook');
  });

  it('opens the knowledge map from its own card: what the map shows, and one button', async () => {
    renderProgress();
    const section = (await screen.findByRole('heading', { level: 2, name: 'Карта знаний' })).closest('section') as HTMLElement;
    expect(within(section).getByText(/понятия, которые встречаются в нескольких лекциях/)).toBeInTheDocument();
    expect(within(section).getByText(/какие вопросы экзамена в ней есть/)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Открыть карту знаний' })).toHaveAttribute('href', '/knowledge-map');
    // The picture says nothing a screen reader needs.
    expect(section.querySelector('.pg-map-art')).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls the lectures section by the menu’s word: «Все лекции», not «Библиотека»', async () => {
    renderProgress();
    const section = (await screen.findByRole('heading', { level: 2, name: 'Лекции' })).closest('section') as HTMLElement;
    expect(within(section).getByRole('link', { name: 'Все лекции' })).toHaveAttribute('href', '/library');
    expect(screen.queryByText('Библиотека')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/разметк/i);
  });

  it('says what happened in the last 7 days under the title', async () => {
    setTable('study_sessions', () => ({ data: [{ date: todayKey(), cards_reviewed: 6 }] }));
    renderProgress();
    expect(await screen.findByText('За 7 дней: 6 ответов на карточки и 2 теста.')).toBeInTheDocument();
  });

  it('names the day of the last study when the week was empty', async () => {
    setTable('study_sessions', () => ({ data: [{ date: '2026-09-20', cards_reviewed: 4 }] }));
    setJournal([], []);
    renderProgress();
    expect(await screen.findByText('За 7 дней занятий не было. Последние — 20 сентября.')).toBeInTheDocument();
  });

  it('shows the cards by state: consolidated, learning, new', async () => {
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    const cards = tile('Карточки');
    expect(plain(cards.querySelector('.pg-big')?.textContent)).toBe('5 из 8');
    expect(within(cards).getByText('закреплены')).toBeInTheDocument();
    expect(Array.from(cards.querySelectorAll('.pg-keys li')).map((li) => plain(li.textContent))).toEqual(['закреплены 5', 'учатся 2', 'новые 1']);
  });

  it('shows the share of recalled card answers only from ten answers', async () => {
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    const memory = tile('Вспомнили с 3 октября');
    expect(plain(memory.querySelector('.pg-big')?.textContent)).toBe('50 %');
    expect(within(memory).getByText('6 из 12 ответов на карточки')).toBeInTheDocument();
    expect(Array.from(memory.querySelectorAll('.pg-keys li')).map((li) => plain(li.textContent))).toEqual(['вспомнили 6', 'не вспомнили 6']);
    cleanup();

    setJournal(demoJournal.slice(0, 4));
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    const few = tile('Вспомнили с 3 октября');
    expect(few.querySelector('.pg-big, .pg-state')).toBeNull();
    expect(within(few).getByText('Пока 4 ответа на карточки — долю покажем с 10, осталось 6.')).toBeInTheDocument();
    cleanup();

    setJournal([]);
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    const none = tile('Вспомнили с 3 октября');
    expect(within(none).getByText('Ответов на карточки с 3 октября пока нет.')).toBeInTheDocument();
    expect(none.textContent).not.toMatch(/\b0\b/);
  });

  it('counts recall from the first day of the journal, then over 30 days', async () => {
    // Answers of 2 October predate the journal and cannot exist; the tile starts on 3 October.
    setJournal([event('card_review', '2026-10-02', true, 'm1', 'old'), ...demoJournal]);
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    expect(within(tile('Вспомнили с 3 октября')).getByText('6 из 12 ответов на карточки')).toBeInTheDocument();
    cleanup();

    vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
    setJournal(Array.from({ length: 10 }, (_, i) => event('card_review', i < 5 ? '2026-10-12' : '2026-11-10', i < 9, 'm1', `n${i}`)));
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    const memory = tile('Вспомнили за 30 дней');
    expect(plain(memory.querySelector('.pg-big')?.textContent)).toBe('90 %');
    expect(within(memory).getByText('9 из 10 ответов на карточки')).toBeInTheDocument();
  });

  it('shows the reviews of the coming week by the cards’ schedule and sends to review', async () => {
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    const ahead = tile('Повторения на неделю');
    expect(plain(ahead.querySelector('.pg-big')?.textContent)).toBe('1');
    expect(within(ahead).getByText('карточка ждёт сейчас')).toBeInTheDocument();
    expect(Array.from(ahead.querySelectorAll('.pg-mini-val')).map((v) => v.textContent)).toEqual(['1', '2', '3']);
    expect(within(ahead).getByText('Завтра — 2, всего на неделю — 6.')).toBeInTheDocument();
    expect(within(ahead).getByRole('link', { name: 'Повторить' })).toHaveAttribute('href', '/review');
  });

  it('lists what to work on with one action each, the most telling first', async () => {
    renderProgress();
    const todo = (await screen.findByRole('heading', { name: 'Что подтянуть' })).closest('section') as HTMLElement;
    const rows = Array.from(todo.querySelectorAll('.pg-todo-row'));
    expect(rows.map((row) => plain(row.querySelector('.pg-todo-t')?.textContent))).toEqual([
      '«Энтропия»: вспомнили 6 из 12 ответов с 3 октября',
      '«Новая лекция»: 2 карточки не добавлены в повторение',
      'Тесты не пройдены в 2 лекциях. Начните с «Новая лекция»',
    ]);
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Повторить' })).toHaveAttribute('href', '/review?material=m1');
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'Добавить' })).toBeEnabled();
    expect(within(rows[2] as HTMLElement).getByRole('link', { name: 'Пройти тест: Новая лекция' })).toHaveAttribute('href', '/library/m2?section=quiz');
  });

  it('adds cards that never reached review and then offers to repeat them', async () => {
    const added = { id: 'n1', material_id: 'm2', repetitions: 0, next_review: local(3, 8), last_reviewed_at: null };
    setTable('flashcard_progress', () => ({ data: demoCards }), () => ({ data: [...demoCards, added] }));
    const user = userEvent.setup();
    renderProgress();
    const todo = (await screen.findByRole('heading', { name: 'Что подтянуть' })).closest('section') as HTMLElement;

    await user.click(within(todo).getByRole('button', { name: 'Добавить' }));
    expect(db.syncFlashcards).toHaveBeenCalledWith('user-1', 'm2', cardsOf(2).flashcards);
    const row = await lectureRow('Новая лекция');
    expect(await within(row).findByRole('link', { name: 'Повторить 1 карточку: Новая лекция' })).toHaveAttribute('href', '/review?material=m2');
  });

  it('says that adding failed without losing the row', async () => {
    db.syncFlashcards.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderProgress();
    const todo = (await screen.findByRole('heading', { name: 'Что подтянуть' })).closest('section') as HTMLElement;
    await user.click(within(todo).getByRole('button', { name: 'Добавить' }));
    expect(await within(todo).findByText(/Не получилось добавить/)).toBeInTheDocument();
    expect(within(todo).getByRole('button', { name: 'Добавить' })).toBeEnabled();
  });

  it('says there are no gaps only when every source was read', async () => {
    setTable('materials', () => ({ data: [materials[0]] }));
    setTable('flashcard_progress', () => ({ data: demoCards.slice(0, 3) }));
    setJournal([], [...demoQuiz]);
    renderProgress();
    expect(await screen.findByText('Пробелов не видно: карточки в повторении, тесты пройдены, открытых ошибок нет.')).toBeInTheDocument();
    cleanup();

    setTable('mistake_diary', () => ({ data: null, error: { code: '08006', message: 'offline' } }));
    renderProgress();
    expect(await screen.findByText('Часть данных не загрузилась, поэтому список может быть неполным.')).toBeInTheDocument();
  });

  it('opens the gradebook from the link in the header', async () => {
    renderProgress('/analytics?tab=gradebook');
    expect(await screen.findByText('Зачётка на экране')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Оценки из зачётки' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('explains how the numbers are made', async () => {
    const user = userEvent.setup();
    renderProgress();
    const how = await screen.findByRole('button', { name: 'Как считается' });
    expect(how).toHaveAttribute('aria-expanded', 'false');
    await user.click(how);
    expect(screen.getByText(/«Закреплены» — карточки, которые вы вспомнили два раза подряд в разные дни/)).toBeInTheDocument();
    expect(screen.getByText(/Долю показываем от 10 ответов, у лекции — от 5/)).toBeInTheDocument();
  });
});

describe('Lectures', () => {
  it('shows each lecture with its cards, test, recall and next step, the ones with something to do first', async () => {
    renderProgress();
    const row = await lectureRow('Энтропия');
    expect(within(row).getByText('тест 4 из 5, 2 окт. · повторно 5 из 5')).toBeInTheDocument();
    expect(within(row).getByText('закреплено 3 из 6 · новых 1')).toBeInTheDocument();
    expect(plain(row.querySelector('.pg-lec-share')?.textContent)).toBe('вспомнили 50 %');
    expect(within(row).getByText('6 из 12 с 3 окт.')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Повторить 1 карточку: Энтропия' })).toHaveAttribute('href', '/review?material=m1');

    const list = row.closest('ul') as HTMLElement;
    expect(Array.from(list.querySelectorAll('.pg-lec-t')).map((link) => link.textContent)).toEqual(['Энтропия', 'Новая лекция', 'Инфляция']);
    expect(within(await lectureRow('Новая лекция')).getByText('2 карточки не в повторении')).toBeInTheDocument();
    expect(within(await lectureRow('Инфляция')).getByRole('link', { name: 'Пройти тест: Инфляция' })).toHaveAttribute('href', '/library/m4?section=quiz');
  });

  it('keeps text-only lectures apart: they have no cards or test by design', async () => {
    renderProgress();
    const section = (await screen.findByRole('heading', { name: 'Лекции' })).closest('section') as HTMLElement;
    const group = section.querySelector('details') as HTMLElement;
    expect(plain(group.querySelector('summary')?.textContent)).toBe('Только текст — 1 лекция');
    expect(within(group).getByRole('link', { name: 'Лекция текстом' })).toHaveAttribute('href', '/library/m3');
    expect(section.querySelector('.pg-lectures')?.textContent).not.toContain('Лекция текстом');
  });

  it('never prints a red 0 % or a mastery percentage for an untouched lecture', async () => {
    renderProgress();
    const row = await lectureRow('Новая лекция');
    expect(row.querySelector('.pg-lec-share')).toBeNull();
    expect(plain(document.body.textContent)).not.toMatch(/(^|\s)0 %/);
    expect(screen.queryByText(/Освоено|освоения|Профиль навыков/)).not.toBeInTheDocument();
  });

  it('shows error lines instead of zeros when the cards cannot be read, and retries', async () => {
    setTable('flashcard_progress', () => ({ data: null, error: { code: '08006', message: 'offline' } }), () => ({ data: demoCards }));
    const user = userEvent.setup();
    renderProgress();

    const alert = await screen.findByText(/Карточки не загрузились, их счётчики не показаны/);
    expect(screen.getByText('Карточки не загрузились.')).toBeInTheDocument();
    expect(screen.getByText('Расписание карточек не загрузилось.')).toBeInTheDocument();
    expect(screen.queryByText(/закреплено \d/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Повторить \d/ })).not.toBeInTheDocument();
    // The tests still show: they come from another source.
    expect(within(await lectureRow('Энтропия')).getByText('тест 4 из 5, 2 окт. · повторно 5 из 5')).toBeInTheDocument();

    await user.click(within(alert.closest('p')!).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('закреплено 3 из 6 · новых 1')).toBeInTheDocument();
  });
});

describe('Progress sources', () => {
  it('reads only the small parts of the materials and the last 32 days of card answers', async () => {
    renderProgress();
    await screen.findByRole('heading', { name: 'Что подтянуть' });
    expect(args('materials', 'select')).toEqual([['id, title, subject, created_at, text_only:summary_json->text_only, flashcards_json, quiz:quiz_json->quiz']]);
    expect(db.fetchMaterialEvents).toHaveBeenCalledWith({ kinds: ['quiz_answer'] });
    expect(db.fetchMaterialEvents).toHaveBeenCalledWith({ kinds: ['card_review', 'exam_answer'], sinceDays: 32 });
  });

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

  it('names open mistakes by topic and sends to the diary', async () => {
    setTable('mistake_diary', () => ({
      data: [
        { topic: 'Физика', material_id: 'm1' },
        { topic: 'Физика', material_id: null },
        { topic: 'Химия', material_id: null },
        { topic: '', material_id: null },
      ],
    }));
    renderProgress();

    const todo = (await screen.findByRole('heading', { name: 'Что подтянуть' })).closest('section') as HTMLElement;
    const row = within(todo).getByText('4 открытые ошибки: Физика, Химия').closest('li') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Разобрать' })).toHaveAttribute('href', '/mistakes');
    expect(within(await lectureRow('Энтропия')).getByText(/1 открытая ошибка/)).toBeInTheDocument();
    expect(args('mistake_diary', 'eq')).toContainEqual(['is_resolved', false]);
  });

  it('sums the activity of a day and labels the chart', async () => {
    const key = todayKey();
    setTable('study_sessions', () => ({ data: [{ date: key, cards_reviewed: 3 }, { date: key, cards_reviewed: 4 }] }));
    renderProgress();

    expect(await screen.findByRole('heading', { name: 'Занятия по дням' })).toBeInTheDocument();
    expect(screen.getByText(/^Ответы на карточки по дням; больше всего 7 — /)).toBeInTheDocument();
    // Today's cards (3 October) and the two demo tests (2 and 3 October): two days of study.
    expect(screen.getByText('За 30 дней: 7 ответов на карточки, 2 теста, занятия в 2 из 30 дней, сейчас 1 день подряд.')).toBeInTheDocument();
    expect(screen.getByText('сегодня')).toBeInTheDocument();
  });

  it('names only what happened in 30 days and draws no empty axis', async () => {
    setJournal([], []);
    setTable('flashcard_progress', () => ({ data: [] }));
    renderProgress();

    expect(await screen.findByText('За 30 дней ответов на карточки и тестов не было.')).toBeInTheDocument();
    expect(screen.queryByText('сегодня')).toBeNull();
    expect(screen.queryByText(/0 ответов|0 дней подряд|занятия в 0/)).toBeNull();
    expect(within(tile('Карточки')).getByText('Карточек в повторении пока нет. Они появляются после разбора лекции.')).toBeInTheDocument();
    expect(within(tile('Повторения на неделю')).getByText('сейчас повторять нечего')).toBeInTheDocument();
    expect(within(tile('Повторения на неделю')).queryByRole('link', { name: 'Повторить' })).toBeNull();
  });

  it('offers to add an exam when there is none', async () => {
    renderProgress();
    const exams = (await screen.findByRole('heading', { name: 'Экзамены' })).closest('section') as HTMLElement;
    expect(within(exams).getByText(/Добавьте список вопросов к экзамену/)).toBeInTheDocument();
    expect(within(exams).getByRole('link', { name: 'Новый экзамен' })).toHaveAttribute('href', '/exams/new');
  });

  it('says that an exam list was not mapped yet instead of «0 из N»', async () => {
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Макроэкономика', exam_date: '2026-10-15', mapped_at: null }] }));
    setTable('exam_questions', () => ({
      data: ['a', 'b', 'c'].map((ch, index) => ({ id: `q${index}`, exam_id: 'e1', section: null, question_hash: ch.repeat(32), coverage: null })),
    }));
    renderProgress();

    const row = (await screen.findByRole('link', { name: 'Макроэкономика' })).closest('li')!;
    expect(within(row).getByText('Сверки с лекциями ещё не было.')).toBeInTheDocument();
    expect(within(row).queryByText(/Есть в ваших лекциях/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Сверка с лекциями от/)).not.toBeInTheDocument();
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
      within(row).getByText(/^Есть в ваших лекциях: 1 из 3 · частично 0 · нет 0 · только по словам 1 · не сверено 1\. Сверка с лекциями от 30 сентября, \d{1,2}:\d{2}\.$/),
    ).toBeInTheDocument();
  });

  it('dates a mapping in the words of the exam sheet', () => {
    expect(mappingDateText(null)).toBeNull();
    expect(mappingDateText('garbage')).toBeNull();
    expect(mappingDateText('2026-01-21T12:40:00Z')).toMatch(/^Сверка с лекциями от 21 января, \d{1,2}:\d{2}\.$/);
  });

  it('shows the exam card: confirmed questions, what it means for tickets, answers since, and the gap to fix', async () => {
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

    const exams = (await screen.findByRole('heading', { name: 'Экзамены' })).closest('section') as HTMLElement;
    const link = await within(exams).findByRole('link', { name: 'Макроэкономика' });
    expect(link).toHaveAttribute('href', '/exams/e1');
    const row = link.closest('li') as HTMLElement;
    expect(within(row).getByText(/ответы на билеты с 1 октября$/)).toBeInTheDocument();
    expect(within(row).getByText('Есть в ваших лекциях: 1 из 3 · частично 1 · нет 1.')).toBeInTheDocument();
    expect(row.querySelector('.sf-ledger-fig')?.textContent).toBe('1 из 3');
    expect(within(row).getByText('вопросов подтверждено ответами')).toBeInTheDocument();
    // C(1, 2) / C(3, 2): no ticket has both questions confirmed yet — a small line of the foot, no big «0 %».
    expect(row.querySelectorAll('.sf-ledger-fig')).toHaveLength(1);
    expect(within(row).queryByText('билетов, где подтверждены оба вопроса')).toBeNull();
    expect((row.querySelector('.sf-ledger-foot')?.textContent ?? '').replace(/ /g, ' ')).toBe(
      'Засчитано, не подтверждено — 0, не засчитано — 1. Билетов, где подтверждены оба вопроса, — 0 %. Самооценка против ответов: мало данных.',
    );
    expect(row.textContent).not.toMatch(/зачт[её]н|вслух/i);
    expect(db.fetchQuestionEvents).toHaveBeenCalledWith([a, b, c]);

    const todo = screen.getByRole('heading', { name: 'Что подтянуть' }).closest('section') as HTMLElement;
    const gap = within(todo).getByText('«Макроэкономика»: 1 вопрос нет ни в одной лекции').closest('li') as HTMLElement;
    expect(within(gap).getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/e1');
  });

  it('counts «подтверждено» by the rule: two days and 20 hours between the first and the last засчитанный answer', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map((ch) => ch.repeat(32));
    setTable('exams', () => ({ data: [{ id: 'e1', title: 'Микроэкономика', kind: 'exam', exam_date: '2026-10-15', ticket_layout: { mode: 'random', per_ticket: 2 } }] }));
    setTable('exam_questions', () => ({
      data: [a, b, c].map((hash, index) => ({ id: `q${index}`, exam_id: 'e1', section: null, question_hash: hash, coverage: 'full' })),
    }));
    db.fetchQuestionEvents.mockResolvedValue([
      // 23:59 and 0:01: two days, two minutes — засчитано, не подтверждено.
      examAnswer(a, '2026-10-01', true, '1', '2026-10-01T20:59:00Z'),
      examAnswer(a, '2026-10-02', true, '2', '2026-10-01T21:01:00Z'),
      // 1:00 and 21:00 of one day — засчитано, не подтверждено.
      examAnswer(b, '2026-10-02', true, '3', '2026-10-01T22:00:00Z'),
      examAnswer(b, '2026-10-02', true, '4', '2026-10-02T18:00:00Z'),
      // 10:00, 18:00 and 8:00 the next day — подтверждено.
      examAnswer(c, '2026-10-01', true, '5', '2026-10-01T07:00:00Z'),
      examAnswer(c, '2026-10-01', true, '6', '2026-10-01T15:00:00Z'),
      examAnswer(c, '2026-10-02', true, '7', '2026-10-02T05:00:00Z'),
    ]);
    renderProgress();
    const row = (await screen.findByRole('link', { name: 'Микроэкономика' })).closest('li') as HTMLElement;
    expect(row.querySelector('.sf-ledger-fig')?.textContent).toBe('1 из 3');
    expect(row.querySelector('.sf-ledger-foot')?.textContent).toMatch(/^Засчитано, не подтверждено — 2, не засчитано — 0\. /);
  });

  it('words the ledger foot with «засчитано» and «ответили», and the confirmed tickets as a small line', () => {
    const summary = { total: 40, confirmed: 7, once: 3, notPassed: 2, untested: 28, since: '2026-10-01', stale: 0 };
    const confidence = { ratedKnow: 18, ratedKnowAnswered: 10, ratedKnowPassed: 8, enoughData: true };
    expect(ledgerFoot({ summary, confidence, confirmedTickets: 3, perTicket: 2 }).replace(/ /g, ' ')).toBe(
      'Засчитано, не подтверждено — 3, не засчитано — 2. Билетов, где подтверждены оба вопроса, — 3 %. Вы отметили «знаю» у 18 вопросов; из 10 таких, на которые вы ответили, засчитано 8.',
    );
    expect(ledgerFoot({ summary: { ...summary, confirmed: 0 }, confidence, confirmedTickets: 0, perTicket: 2 })).not.toContain('Билетов');
    expect(ledgerFoot({ summary, confidence: { ...confidence, enoughData: false }, confirmedTickets: null, perTicket: 1 })).toBe(
      'Засчитано, не подтверждено — 3, не засчитано — 2. Самооценка против ответов: мало данных.',
    );
    expect(ledgerFoot({ summary: { ...summary, confirmed: 0, once: 0, notPassed: 0 }, confidence: { ...confidence, enoughData: false }, confirmedTickets: null, perTicket: 2 })).toBe(
      'Ответов по билетам ещё не было. Самооценка против ответов: мало данных.',
    );
  });

  it('keeps the other blocks when exams fail', async () => {
    setTable('exams', () => ({ data: null, error: { code: '42P01', message: 'missing' } }));
    renderProgress();

    expect(await screen.findByText(/Экзамены не загрузились/)).toBeInTheDocument();
    expect(within(await lectureRow('Энтропия')).getByText('тест 4 из 5, 2 окт. · повторно 5 из 5')).toBeInTheDocument();
  });
});
