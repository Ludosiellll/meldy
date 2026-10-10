import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../contracts/container/summary.json';
import itemsJson from '../../../../contracts/container/items_page.json';
import doubtsJson from '../../../../contracts/container/doubts.json';
import type { ContainerSummary, DoubtRow, TestItem } from '../../types/container';

const api = vi.hoisted(() => ({
  updateItem: vi.fn(),
  keepKey: vi.fn(),
  deleteItem: vi.fn(),
  fetchDoubts: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown, loading: false, error: null as string | null },
}));

vi.mock('../../api/containers', () => ({
  updateItem: api.updateItem,
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
    reload: api.reload,
  }),
}));

import KeysPage from './KeysPage';
import { KEYS, QUEUE } from '../../components/containers/copyImport';

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
  api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: true, doubts_resolved: 0 }));
  api.keepKey.mockReset().mockResolvedValue(2);
  api.deleteItem.mockReset().mockResolvedValue(undefined);
  api.fetchDoubts.mockReset().mockResolvedValue(doubtsJson as unknown as DoubtRow[]);
  api.reload.mockReset();
});
afterEach(() => cleanup());

describe('KeysPage: the author’s keys (spec decision 14, §16 #44)', () => {
  it('lists what waits as rows of one card and puts «Проверить N вопросов» in the bar', async () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: 'Ключи' })).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Номер в файле'), { target: { value: '999' } });
    expect(screen.getByText(/В «Основы программирования» нет №\s999\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Номер в файле'), { target: { value: '№ 12' } });
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
});
