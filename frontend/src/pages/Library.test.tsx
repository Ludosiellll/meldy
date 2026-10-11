import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExamShelf } from '../api/exams';

const data = vi.hoisted(() => ({
  materials: [] as unknown[],
  shelves: [] as unknown[],
  failMaterials: false,
  /** The request for the lectures never answers (the page stays in its loading state). */
  hangMaterials: false,
  confirm: vi.fn(async () => true),
  deleteMaterial: vi.fn(async () => undefined),
  updateMaterialTitle: vi.fn(async () => undefined),
  /** Cards each lecture got from ticket answers (lib/followupCards). */
  followups: new Map<string, number>(),
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: data.confirm }) }));
vi.mock('../api/materials', () => ({
  getMaterials: vi.fn(async () => {
    if (data.hangMaterials) return new Promise<never>(() => undefined);
    if (data.failMaterials) throw new Error('offline');
    return data.materials;
  }),
  deleteMaterial: (...args: unknown[]) => data.deleteMaterial(...(args as [])),
  updateMaterialTitle: (...args: unknown[]) => data.updateMaterialTitle(...(args as [])),
}));
vi.mock('../api/exams', () => ({ listExamShelves: vi.fn(async () => data.shelves) }));
// One request to flashcard_progress: the tests say what it returns, and nothing reaches the network.
vi.mock('../lib/followupCards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/followupCards')>()),
  followupCardsByLecture: vi.fn(async () => data.followups),
}));

import Library, { lectureMeta, lecturesLine, libraryLayout, phoneExamWhen, SEARCH_FROM, shortDate, toEntry, type LibraryEntry } from './Library';
import { PHONE_QUERY } from '../lib/usePhone';

function material(id: string, title: string, created: string, extra: Record<string, unknown> = {}) {
  return { id, title, subject: '', created_at: created, summary_json: { content: 'Конспект' }, flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] }, ...extra };
}

function entry(id: string, created: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return { id, title: id, created_at: created, textOnly: false, summary: true, cards: 0, quiz: false, cheatsheet: false, talk: false, ...extra };
}

function shelf(id: string, links: Array<[string, string]>, extra: Partial<ExamShelf> = {}): ExamShelf {
  return { id, title: `Экзамен ${id}`, kind: 'exam', exam_date: null, created_at: '2026-10-01T00:00:00Z', materials: links.map(([materialId, addedAt]) => ({ id: materialId, addedAt })), ...extra };
}

/** The text with its no-break spaces as plain ones (the lists keep a number with its word). */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={['/library']}>
      <Library />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  data.materials = [];
  data.shelves = [];
  data.failMaterials = false;
  data.hangMaterials = false;
  data.followups = new Map();
  data.confirm = vi.fn(async () => true);
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('what a lecture row says', () => {
  it('names only what the lecture has, and says plainly when it is text only', () => {
    expect(plain(lectureMeta(toEntry(material('a', 'A', '2026-09-01', { flashcards_json: { flashcards: [{}, {}, {}, {}, {}, {}, {}, {}] }, quiz_json: { quiz: [{}] }, summary_json: { content: 'x', podcast: [{}] } }))!))).toBe(
      'конспект · 8 карточек · тест · подкаст',
    );
    expect(plain(lectureMeta(toEntry(material('b', 'B', '2026-09-01', { summary_json: { text_only: true } }))!))).toBe('только текст, конспекта нет');
    expect(plain(lectureMeta(entry('c', '2026-09-01', { summary: false })))).toBe('');
  });

  it('names the выжимка too, in the order of the lecture’s tabs (QA 2026-10-11)', () => {
    const all = toEntry(
      material('a', 'A', '2026-09-01', {
        flashcards_json: { flashcards: [{}, {}, {}, {}, {}, {}] },
        quiz_json: { quiz: [{}] },
        summary_json: { content: 'x', cheatsheet: '# Выжимка\n\nГлавное.', podcast: [{}] },
      }),
    )!;
    expect(all.cheatsheet).toBe(true);
    expect(plain(lectureMeta(all))).toBe('конспект · 6 карточек · тест · выжимка · подкаст');
    expect(plain(lectureMeta(all, 0, true))).toBe('6 карточек · тест · выжимка · подкаст');
    // An empty one is not there.
    expect(toEntry(material('b', 'B', '2026-09-01', { summary_json: { content: 'x', cheatsheet: '  ' } }))!.cheatsheet).toBe(false);
    // The light entry this device keeps says it as well.
    expect(toEntry(JSON.parse(JSON.stringify(all)))!.cheatsheet).toBe(true);
  });

  it('names the cards from ticket answers apart from the lecture’s own (finding LIB-6)', () => {
    expect(plain(lectureMeta(entry('a', '2026-09-01', { cards: 6, quiz: true }), 4))).toBe('конспект · 6 карточек · ещё 4 из ответов на билеты · тест');
    expect(plain(lectureMeta(entry('b', '2026-09-01', { cards: 6 }), 0))).toBe('конспект · 6 карточек');
    expect(plain(lectureMeta(entry('c', '2026-09-01', { textOnly: true, summary: false }), 2))).toBe('только текст, конспекта нет · 2 карточки из ответов на билеты');
  });

  it('keeps the day with its month and «·» with the word before it (finding LIB-21)', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    expect(shortDate('2026-10-05T10:00:00Z', now)).toBe('5\u00a0окт.');
    expect(shortDate('2025-10-05T10:00:00Z', now)).toBe('5\u00a0окт. 2025');
    expect(lectureMeta(entry('a', '2026-09-01', { cards: 6, quiz: true }))).toBe('конспект\u00a0· 6\u00a0карточек\u00a0· тест');
  });

  it('counts the lectures of an exam: analysed and text only', () => {
    const list = [entry('a', '1'), entry('b', '2', { textOnly: true }), entry('c', '3', { textOnly: true })];
    expect(plain(lecturesLine(list))).toBe('3 лекции: 1 разобрана, 2 загружены только текстом');
    expect(plain(lecturesLine([entry('a', '1')]))).toBe('1 лекция');
    expect(plain(lecturesLine([entry('a', '1', { textOnly: true })]))).toBe('1 лекция, загружена только текстом');
  });
});

describe('how the lectures are grouped', () => {
  const a = entry('a', '2026-09-01T00:00:00Z');
  const b = entry('b', '2026-09-02T00:00:00Z');
  const c = entry('c', '2026-09-03T00:00:00Z');

  it('one list, newest first, when there are no exams', () => {
    const layout = libraryLayout([a, b, c], []);
    expect(layout.mode).toBe('plain');
    expect(layout.mode === 'plain' && layout.entries.map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('the exam is the page when every lecture is in it, in the order they were added and then uploaded', () => {
    const layout = libraryLayout([a, b, c], [shelf('e', [['c', '2026-10-01T09:00:00Z'], ['b', '2026-10-01T10:00:00Z'], ['a', '2026-10-01T10:00:00Z']])]);
    expect(layout.mode).toBe('single');
    expect(layout.mode === 'single' && layout.entries.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('sections by exam and «Другие материалы»; a lecture in two exams is in both', () => {
    const layout = libraryLayout([a, b, c], [shelf('e1', [['a', '1'], ['c', '2']]), shelf('e2', [['c', '1']])]);
    expect(layout.mode).toBe('sections');
    if (layout.mode !== 'sections') return;
    expect(layout.groups.map((group) => [group.key, group.entries.map((item) => item.id)])).toEqual([
      ['e1', ['a', 'c']],
      ['e2', ['c']],
      ['other', ['b']],
    ]);
  });

  it('puts «Другие материалы» first while it holds the newest lecture: a lecture just analysed is at the top (QA 2026-10-11)', () => {
    const d = entry('d', '2026-10-11T17:20:00Z');
    const e = entry('e', '2026-10-11T17:25:00Z');
    const layout = libraryLayout([a, b, c, d, e], [shelf('e1', [['a', '1'], ['b', '2']]), shelf('e2', [['c', '1']])]);
    if (layout.mode !== 'sections') throw new Error(layout.mode);
    expect(layout.groups.map((group) => [group.key, group.entries.map((item) => item.id)])).toEqual([
      ['other', ['e', 'd']],
      ['e1', ['a', 'b']],
      ['e2', ['c']],
    ]);
  });
});

describe('<Library>', () => {
  it('shows folders and search only when they help', async () => {
    data.materials = [material('m1', 'Спрос', '2026-09-01T00:00:00Z')];
    // The three folders the old app created for everyone, empty: not shown.
    window.localStorage.setItem(
      'library_folders_user-1',
      JSON.stringify([
        { id: 'folder_1', name: 'Гуманитарные науки' },
        { id: 'folder_2', name: 'Технические науки' },
        { id: 'folder_3', name: 'Избранное' },
      ]),
    );
    const view = renderLibrary();
    await screen.findByText('Спрос');
    expect(screen.queryByRole('list', { name: 'Папки' })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Найти лекцию' })).toBeNull();
    expect(screen.queryByText('Гуманитарные науки')).toBeNull();
    view.unmount();

    data.materials = Array.from({ length: SEARCH_FROM }, (_, index) => material(`m${index}`, `Лекция ${index + 1}`, `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`));
    window.localStorage.setItem('library_folders_user-1', JSON.stringify([{ id: 'folder_9', name: 'Семинары' }]));
    window.localStorage.setItem('library_folder_assignments_user-1', JSON.stringify({ m0: 'folder_9' }));
    renderLibrary();
    await screen.findByText('Лекция 13');
    const folders = screen.getByRole('list', { name: 'Папки' });
    expect(within(folders).getByRole('button', { name: /Семинары/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Найти лекцию' }), { target: { value: 'лекция 12' } });
    expect(screen.getAllByRole('link', { name: /Лекция/ }).map((link) => link.textContent)).toEqual([expect.stringContaining('Лекция 12')]);
  });

  it('renames and deletes from «⋯», asking before a delete', async () => {
    data.materials = [material('m1', 'Спрос', '2026-09-01T00:00:00Z'), material('m2', 'Предложение', '2026-09-02T00:00:00Z')];
    renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Действия: Спрос' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }));
    const field = screen.getByRole('textbox', { name: 'Название лекции' });
    fireEvent.change(field, { target: { value: 'Спрос и предложение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Спрос и предложение')).toBeInTheDocument();
    expect(data.updateMaterialTitle).toHaveBeenCalledWith('m1', 'Спрос и предложение');

    fireEvent.click(screen.getByRole('button', { name: 'Действия: Предложение' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить лекцию…' }));
    await waitFor(() => expect(data.deleteMaterial).toHaveBeenCalledWith('m2'));
    // It names only what the lecture has: this one, its конспект (QA 2026-10-11: «карточками и тестом» for every lecture).
    expect(data.confirm).toHaveBeenCalledWith({
      title: 'Удалить лекцию?',
      message: '«Предложение» исчезнет из библиотеки вместе с конспектом. Это нельзя отменить.',
      confirmText: 'Удалить',
      cancelText: 'Оставить',
    });
    await waitFor(() => expect(screen.queryByText('Предложение')).toBeNull());
    // This device forgets it too: no row in the list it keeps for offline.
    expect(JSON.parse(window.localStorage.getItem('library_entries_user-1') ?? '{}').items.map((item: { id: string }) => item.id)).toEqual(['m1']);
  });

  it('keeps the lecture when the question is answered «Оставить»', async () => {
    data.materials = [material('m1', 'Спрос', '2026-09-01T00:00:00Z')];
    data.confirm = vi.fn(async () => false);
    data.deleteMaterial.mockClear();
    renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Действия: Спрос' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить лекцию…' }));
    await waitFor(() => expect(data.confirm).toHaveBeenCalledTimes(1));
    expect(data.deleteMaterial).not.toHaveBeenCalled();
    expect(screen.getByText('Спрос')).toBeInTheDocument();
  });

  it('says where folders are kept: in the menu and under the folders (finding LIB-9)', async () => {
    data.materials = [material('m1', 'Спрос', '2026-09-01T00:00:00Z'), material('m2', 'Предложение', '2026-09-02T00:00:00Z')];
    renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Действия: Спрос' }));
    const menu = screen.getByRole('menu', { name: 'Спрос' });
    expect(within(menu).getByText('Папка — только на этом устройстве')).toBeInTheDocument();
    expect(screen.queryByText('Папки видны только на этом устройстве')).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Новая папка…' }));
    fireEvent.change(within(menu).getByRole('textbox', { name: 'Название папки' }), { target: { value: 'Микроэкономика' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Создать' }));

    const folders = await screen.findByRole('list', { name: 'Папки' });
    expect(within(folders).getByRole('button', { name: /Микроэкономика/ })).toBeInTheDocument();
    expect(screen.getByText('Папки видны только на этом устройстве')).toBeInTheDocument();
  });

  it('says how many cards come from ticket answers, in the row and in the heading (finding LIB-6)', async () => {
    const six = { flashcards: Array.from({ length: 6 }, () => ({})) };
    data.materials = [
      material('m1', 'Спрос', '2026-09-01T00:00:00Z', { flashcards_json: six }),
      material('m2', 'Предложение', '2026-09-02T00:00:00Z', { flashcards_json: six }),
    ];
    data.followups = new Map([['m1', 4]]);
    renderLibrary();
    const row = (await screen.findByText('Спрос')).closest('a') as HTMLElement;
    await waitFor(() => expect(plain(row.textContent ?? '')).toContain('конспект · 6 карточек · ещё 4 из ответов на билеты'));
    expect((screen.getByText('Предложение').closest('a') as HTMLElement).textContent).not.toContain('из ответов');
    expect(screen.getByText('2 лекции · 12 карточек · ещё 4 из ответов на билеты')).toBeInTheDocument();
  });

  it('names the browser tab «Лекции»', async () => {
    data.materials = [material('m1', 'Спрос', '2026-09-01T00:00:00Z')];
    renderLibrary();
    await screen.findByText('Спрос');
    expect(document.title).toBe('Лекции — Meldy');
  });

  it('says so when the library cannot be loaded and nothing is saved on this device', async () => {
    data.failMaterials = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderLibrary();
    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить библиотеку' })).toBeInTheDocument();
    expect(screen.getByText('Лекции на месте — повторите через минуту.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('keeps its own cache and never rewrites the key the older client reads', async () => {
    // What the deployed older client stored: full rows in an array.
    window.localStorage.setItem('library_cache_user-1', JSON.stringify([material('old', 'Из старой версии', '2026-09-01T00:00:00Z')]));
    data.failMaterials = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderLibrary();
    // Offline: the old rows are read once as a fallback.
    expect(await screen.findByText('Из старой версии')).toBeInTheDocument();
    view.unmount();

    data.failMaterials = false;
    data.materials = [material('m1', 'Спрос', '2026-09-01T00:00:00Z')];
    renderLibrary();
    await screen.findByText('Спрос');
    await waitFor(() => expect(window.localStorage.getItem('library_entries_user-1')).toContain('Спрос'));
    // The older client's key still holds an array of rows, as that client expects.
    expect(JSON.parse(window.localStorage.getItem('library_cache_user-1') ?? 'null')).toEqual([expect.objectContaining({ id: 'old' })]);
  });

  it('invites the first lecture when the library is empty', async () => {
    renderLibrary();
    expect(await screen.findByRole('heading', { name: 'Здесь будут ваши лекции' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Разобрать лекцию' })).toHaveAttribute('href', '/analyze');
  });
});

describe('«Лекции» on a phone (10_Project/Phone_Declutter_2026-10-08)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === PHONE_QUERY, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
    });
  });
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  const six = { flashcards: Array.from({ length: 6 }, () => ({})) };
  const lectures = () => [
    material('m1', 'Реляционная модель данных', '2026-09-01T00:00:00Z', { flashcards_json: six, quiz_json: { quiz: [{}] } }),
    material('m2', 'Язык SQL', '2026-09-02T00:00:00Z', { flashcards_json: six, quiz_json: { quiz: [{}] } }),
    material('m3', 'Нормализация', '2026-09-03T00:00:00Z', { flashcards_json: six, quiz_json: { quiz: [{}] } }),
  ];

  it('opens with «Разобрать лекцию»; «Лист экзамена» is a quiet link and the lines are short', async () => {
    data.materials = lectures();
    data.shelves = [shelf('e1', [['m1', '1'], ['m2', '2'], ['m3', '3']], { title: 'Базы данных' })];
    data.followups = new Map([['m1', 1], ['m2', 4], ['m3', 3]]);
    renderLibrary();
    const row = (await screen.findByText('Реляционная модель данных')).closest('a') as HTMLElement;
    expect(screen.getByRole('link', { name: 'Разобрать лекцию' })).toHaveAttribute('href', '/analyze');
    const sheet = screen.getByRole('link', { name: 'Лист экзамена' });
    expect(sheet).toHaveAttribute('href', '/exams/e1');
    expect(sheet).toHaveClass('sf-link');
    expect(sheet).not.toHaveClass('lib-pill');
    // «Экзамен · 3 лекции · 18 карточек»; the cards from ticket answers are on each lecture's «Карточки».
    await waitFor(() => expect(data.followups.size).toBe(3));
    expect(plain(document.querySelector('.lib-head .sf-lede')?.textContent ?? '')).toBe('Экзамен · 3 лекции · 18 карточек');
    // «6 карточек · тест · <date>»: a summary goes without saying.
    expect(plain(row.querySelector('.sf-toc-meta')?.textContent ?? '')).toMatch(/^6 карточек · тест · \d{1,2} сент\./);
    expect(row.textContent).not.toMatch(/конспект|из ответов/);
  });

  it('keeps one start on an empty «Лекции»', async () => {
    renderLibrary();
    expect(await screen.findByRole('heading', { name: 'Здесь будут ваши лекции' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Разобрать лекцию' })).toHaveLength(1);
  });

  it('names a missing summary, and the cards from ticket answers of a lecture with none of its own', () => {
    expect(plain(lectureMeta(entry('a', '2026-09-01', { cards: 6, quiz: true }), 4, true))).toBe('6 карточек · тест');
    expect(plain(lectureMeta(entry('b', '2026-09-01', { summary: false, cards: 6 }), 0, true))).toBe('без конспекта · 6 карточек');
    expect(plain(lectureMeta(entry('c', '2026-09-01', { textOnly: true, summary: false }), 2, true))).toBe('только текст, конспекта нет · 2 карточки из ответов на билеты');
  });

  /** The local day `days` from today as 'yyyy-MM-dd'. */
  const dayFromToday = (days: number) => {
    const day = new Date();
    day.setDate(day.getDate() + days);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  };

  it('starts the meta line with the exam’s day, naming its kind only when it is not an exam', async () => {
    const now = new Date(2026, 9, 8, 12);
    // The day keeps its month and «через» its number: the line breaks after the comma or at a dot.
    expect(phoneExamWhen({ kind: 'exam', exam_date: '2026-10-21' }, now)).toBe('21\u00a0октября, через\u00a013\u00a0дней');
    expect(plain(phoneExamWhen({ kind: 'credit', exam_date: '2026-10-09' }, now))).toBe('Зачёт 9 октября, завтра');
    expect(plain(phoneExamWhen({ kind: 'exam', exam_date: null }, now))).toBe('Экзамен');

    data.materials = lectures();
    data.shelves = [shelf('e1', [['m1', '1'], ['m2', '2'], ['m3', '3']], { title: 'Базы данных', exam_date: dayFromToday(13) })];
    renderLibrary();
    await screen.findByText('Реляционная модель данных');
    expect(plain(document.querySelector('.lib-head .sf-lede')?.textContent ?? '')).toMatch(/^\d{1,2} [а-я]+( \d{4})?, через 13 дней · 3 лекции · 18 карточек$/);
  });

  it('names the exam’s day over its section too', async () => {
    data.materials = [...lectures(), material('m4', 'Без экзамена', '2026-09-04T00:00:00Z')];
    data.shelves = [shelf('e1', [['m1', '1'], ['m2', '2']], { title: 'Базы данных', exam_date: dayFromToday(13) })];
    renderLibrary();
    const section = (await screen.findByRole('heading', { name: 'Базы данных' })).closest('section') as HTMLElement;
    expect(plain(section.querySelector('.sf-lede')?.textContent ?? '')).toMatch(/^\d{1,2} [а-я]+( \d{4})?, через 13 дней · 2 лекции$/);
    expect(within(section).getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/e1');
  });

  it('offers «Разобрать лекцию» while the list loads and when it cannot be loaded', async () => {
    data.hangMaterials = true;
    const view = renderLibrary();
    expect(screen.getByRole('status', { name: 'Загружаем библиотеку' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Разобрать лекцию' })).toHaveAttribute('href', '/analyze');
    view.unmount();

    data.hangMaterials = false;
    data.failMaterials = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderLibrary();
    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить библиотеку' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Разобрать лекцию' })).toHaveAttribute('href', '/analyze');
  });
});

describe('«Лекции» on a computer', () => {
  it('has no «Разобрать лекцию» of its own (the top line has it) and «Лист экзамена» is the white pill', async () => {
    data.materials = [material('m1', 'Спрос', '2026-09-01T00:00:00Z')];
    data.shelves = [shelf('e1', [['m1', '1']])];
    renderLibrary();
    await screen.findByText('Спрос');
    expect(screen.queryByRole('link', { name: 'Разобрать лекцию' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveClass('lib-pill');
    expect(plain(document.querySelector('.lib-head .sf-lede')?.textContent ?? '')).toBe('Экзамен · 1 лекция');
  });

  it('keeps its loading and failure states without a start of their own', async () => {
    data.hangMaterials = true;
    const view = renderLibrary();
    expect(screen.getByRole('status', { name: 'Загружаем библиотеку' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Разобрать лекцию' })).toBeNull();
    view.unmount();

    data.hangMaterials = false;
    data.failMaterials = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderLibrary();
    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить библиотеку' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Разобрать лекцию' })).toBeNull();
  });
});
