import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExamShelf } from '../api/exams';

const data = vi.hoisted(() => ({
  materials: [] as unknown[],
  shelves: [] as unknown[],
  failMaterials: false,
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

import Library, { lectureMeta, lecturesLine, libraryLayout, SEARCH_FROM, shortDate, toEntry, type LibraryEntry } from './Library';

function material(id: string, title: string, created: string, extra: Record<string, unknown> = {}) {
  return { id, title, subject: '', created_at: created, summary_json: { content: 'Конспект' }, flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] }, ...extra };
}

function entry(id: string, created: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return { id, title: id, created_at: created, textOnly: false, summary: true, cards: 0, quiz: false, talk: false, ...extra };
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
    const layout = libraryLayout([a, b, c], [shelf('e1', [['a', '1'], ['b', '2']]), shelf('e2', [['b', '1']])]);
    expect(layout.mode).toBe('sections');
    if (layout.mode !== 'sections') return;
    expect(layout.groups.map((group) => [group.key, group.entries.map((item) => item.id)])).toEqual([
      ['e1', ['a', 'b']],
      ['e2', ['b']],
      ['other', ['c']],
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
    expect(data.confirm).toHaveBeenCalledWith({
      title: 'Удалить лекцию?',
      message: '«Предложение» исчезнет из библиотеки вместе с конспектом, карточками и тестом. Это нельзя отменить.',
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
