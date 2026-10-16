import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../contracts/container/summary.json';
import itemsJson from '../../../../contracts/container/items_page.json';
import doubtsJson from '../../../../contracts/container/doubts.json';
import type { ContainerSummary, DoubtRow, TestItem } from '../../types/container';

const api = vi.hoisted(() => ({
  updateItem: vi.fn(),
  addItems: vi.fn(),
  keepKey: vi.fn(),
  deleteItem: vi.fn(),
  fetchDoubts: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown, loading: false, error: null as string | null, gone: false },
}));

vi.mock('../../api/containers', () => ({
  updateItem: api.updateItem,
  addItems: api.addItems,
  keepKey: api.keepKey,
  deleteItem: api.deleteItem,
  fetchDoubts: api.fetchDoubts,
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: api.state.summary ? { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 } : null,
    loading: api.state.loading,
    offline: false,
    unavailable: false,
    error: api.state.error,
    gone: api.state.gone,
    reload: api.reload,
  }),
}));

import KeysPage from './KeysPage';
import { EDITOR, GONE, KEYS, QUEUE } from '../../components/containers/copyImport';

const SUMMARY = summaryJson as unknown as ContainerSummary;
const BASE_ITEMS = itemsJson as unknown as TestItem[];
const ID = SUMMARY.id;
const SUBJECT_1 = SUMMARY.subjects[0].id;
const SUBJECT_2 = SUMMARY.subjects[1].id;

function itemsFor(): Map<string, TestItem> {
  const list: TestItem[] = BASE_ITEMS.map((item) => ({ ...item }));
  // № 2 has no key (the file marked nothing), № 5 was set by the author, № 6 is doubted (doubts.json).
  list[1] = { ...list[1], correct: [], key_source: 'none', flags: ['no_key'] };
  list[4] = { ...list[4], key_source: 'manual' };
  list.push({
    ...list[0],
    id: 'acddd718-39fa-4cc3-873f-f0c326505fa2',
    subject_id: SUBJECT_2,
    position: 3,
    file_no: '3',
    topic: 1,
    kind: 'multiple',
    stem: 'Какие события относятся к истории ВКЛ?',
    options: ['Грюнвальдская битва', 'Крещение Руси', 'Люблинская уния', 'Ледовое побоище', 'Статут 1588 года'],
    correct: [0, 2, 4],
  });
  return new Map(list.map((item) => [item.id, item]));
}

function renderAt(path = `/exams/c/${ID}/keys`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/c/:id/keys" element={<KeysPage />} />
        <Route path="/exams/c/:id" element={<p>Экзамен</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const withMembers = (members: number): ContainerSummary => ({ ...SUMMARY, owner: { ...SUMMARY.owner!, members } });

beforeEach(() => {
  api.state.summary = withMembers(5);
  api.state.items = itemsFor();
  api.state.loading = false;
  api.state.error = null;
  api.state.gone = false;
  api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: true, doubts_resolved: 0 }));
  api.keepKey.mockReset().mockResolvedValue(2);
  api.deleteItem.mockReset().mockResolvedValue(undefined);
  api.fetchDoubts.mockReset().mockResolvedValue(doubtsJson as unknown as DoubtRow[]);
  api.reload.mockReset();
  api.addItems.mockReset().mockResolvedValue([{ subject_id: SUBJECT_1, added: 1, in_container: 9, items: [{ ref: 'man:x', id: 'new-item', position: 9 }] }]);
});
afterEach(() => cleanup());

describe('KeysPage: the author’s keys (spec decision 14, §16 #44)', () => {
  it('lists what waits as rows of one card and puts «Проверить N вопросов» in the bar', async () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: KEYS.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Без ключа\s*1\sвопрос не идёт в занятия/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Сомневаются в ключе\s*2\sвопроса/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ключ поставили вы\s*1\sвопрос/ })).toBeInTheDocument();
    // The doubt with no doubters (doubts.json № 4) is not waiting.
    expect(screen.getByRole('button', { name: /^Проверить 3\sвопроса/ })).toBeInTheDocument();
  });

  it('a solo author sees their own set-aside questions as «Отложены вами»', async () => {
    api.state.summary = withMembers(0);
    renderAt();
    expect(await screen.findByRole('button', { name: /Отложены вами/ })).toBeInTheDocument();
    expect(screen.queryByText('Сомневаются в ключе')).not.toBeInTheDocument();
  });

  it('a tap on another option changes the key; the count starts again for the author and the group', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /^Проверить 3/ }));
    expect(await screen.findByText(/1 из 3/)).toBeInTheDocument();
    expect(screen.getByText(QUEUE.noKey)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Г\.\s?/ }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(BASE_ITEMS[1].id, { correct: [3] }));
    expect(await screen.findByText(KEYS.changed(true))).toBeInTheDocument();
    expect(screen.getByText('Ключ сейчас: Г.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(api.reload).toHaveBeenCalled();
  });

  it('a doubted question shows the count, the proposal, the notes and the majority; «Ключ верный» keeps it', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /Сомневаются в ключе/ }));
    const card = await screen.findByRole('article');
    expect(within(card).getByText(/Сомневаются 2\sучастника\./)).toBeInTheDocument();
    expect(within(card).getByText('Предлагают: В.')).toBeInTheDocument();
    expect(within(card).getByText('Думаю, при null будет исключение NullReferenceException.')).toBeInTheDocument();
    expect(within(card).getByText(/Больше половины ответивших впервые выбрали один и тот же неверный вариант: В\./)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Ключ верный' }));
    await waitFor(() => expect(api.keepKey).toHaveBeenCalledWith('3cadced3-cb13-43d0-ab40-36eab6e51c20'));
    expect(await screen.findByText(KEYS.kept)).toBeInTheDocument();
  });

  it('several right options are ticked, then saved', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /Сомневаются в ключе/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Пропустить' }));
    const card = await screen.findByRole('article');
    expect(within(card).getByText(/Какие события относятся к истории ВКЛ/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /Статут 1588/ }));
    fireEvent.click(within(card).getByRole('button', { name: QUEUE.saveKeys }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith('acddd718-39fa-4cc3-873f-f0c326505fa2', { correct: [0, 2] }));
  });

  it('opens a question by its number from the file, as the Telegram bot links (?s=…&no=…)', async () => {
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}&no=7`);
    const card = await screen.findByRole('article');
    expect(within(card).getByText(/Основы программирования · №\s7/)).toBeInTheDocument();
    expect(within(card).getByText('Ключ сейчас: Б.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(KEYS.findNumber), { target: { value: '999' } });
    expect(screen.getByText(/В «Основы программирования» нет №\s999\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(KEYS.findNumber), { target: { value: '№ 12' } });
    expect(await screen.findByText(/№\s12 · Тема 3\. Строки/)).toBeInTheDocument();
  });

  it('deletes a question after asking, and says so', async () => {
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}&no=7`);
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: 'Удалить вопрос' }));
    expect(within(card).getByText(/Удалить №\s7\? Ответы по нему пропадут у всех участников\./)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(BASE_ITEMS[6].id));
  });

  it('edits a question in place: only the changed words go, the card shows them', async () => {
    api.updateItem.mockImplementationOnce(async (id: string) => ({ id, rev: 1, rev_changed: false, doubts_resolved: 0 }));
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}&no=7`);
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: KEYS.edit }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    fireEvent.change(within(editor).getByLabelText(EDITOR.stem), { target: { value: 'Новая формулировка вопроса' } });
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.save }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(BASE_ITEMS[6].id, { stem: 'Новая формулировка вопроса' }));
    expect(await screen.findByText('Новая формулировка вопроса')).toBeInTheDocument();
    expect(screen.getByText(KEYS.edited)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: EDITOR.label })).toBeNull();
  });

  it('closes the editor without a request when nothing changed', async () => {
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}&no=7`);
    fireEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: KEYS.edit }));
    fireEvent.click(screen.getByRole('button', { name: EDITOR.cancel }));
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('adds a question to the chosen subject with the next number', async () => {
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}`);
    fireEvent.click(await screen.findByRole('button', { name: KEYS.add }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    fireEvent.change(within(editor).getByLabelText(EDITOR.stem), { target: { value: 'Что такое шлюз в BPMN?' } });
    fireEvent.change(within(editor).getByLabelText(EDITOR.option('А')), { target: { value: 'Ромб ветвления' } });
    fireEvent.change(within(editor).getByLabelText(EDITOR.option('Б')), { target: { value: 'Стрелка' } });
    fireEvent.click(within(editor).getByLabelText(EDITOR.right('А')));
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.add }));
    await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
    const [subject, inputs] = api.addItems.mock.calls[0] as [string, Array<Record<string, unknown>>];
    expect(subject).toBe(SUBJECT_1);
    const numbers = BASE_ITEMS.filter((item) => item.subject_id === SUBJECT_1).map((item) => Number(item.file_no)).filter(Number.isFinite);
    expect(inputs[0]).toMatchObject({ stem: 'Что такое шлюз в BPMN?', options: ['Ромб ветвления', 'Стрелка'], correct: [0], key_source: 'manual', file_no: String(Math.max(...numbers) + 1) });
    expect(String(inputs[0].ref)).toMatch(/^man:/);
    expect(api.reload).toHaveBeenCalled();
  });

  it('finds questions by words in the chosen subject', async () => {
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_2}`);
    fireEvent.change(await screen.findByLabelText(KEYS.findNumber), { target: { value: 'грюнвальдская' } });
    expect(await screen.findByText('Какие события относятся к истории ВКЛ?')).toBeInTheDocument();
    expect(screen.getByText(/Нашлось 1\sвопрос/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(KEYS.findNumber), { target: { value: 'несуществующие слова' } });
    expect(screen.getByText(/нет вопроса с этими словами/)).toBeInTheDocument();
  });

  it('shows a member that keys belong to the author', () => {
    api.state.summary = { ...SUMMARY, role: 'member', owner: null };
    renderAt();
    expect(screen.getByText(KEYS.authorOnly)).toBeInTheDocument();
    expect(api.fetchDoubts).not.toHaveBeenCalled();
  });

  it('says in Russian when the keys did not load, with a retry', () => {
    api.state.summary = null;
    api.state.error = 'Failed to fetch';
    renderAt();
    expect(screen.getByText(new RegExp(KEYS.loadFailed))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(api.reload).toHaveBeenCalled();
  });

  it('an exam that is not the user’s any more: says so, the way to «Экзамены», no retry (usability check m2)', () => {
    api.state.summary = null;
    api.state.error = 'Не нашли — возможно, его уже удалили.';
    api.state.gone = true;
    renderAt();
    expect(screen.getByText(`${GONE.title}. ${GONE.text}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });
});
