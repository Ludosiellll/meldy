import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../contracts/container/summary.json';
import itemsJson from '../../../../contracts/container/items_page.json';
import doubtsJson from '../../../../contracts/container/doubts.json';
import type { ContainerSummary, DoubtRow, TestItem } from '../../types/container';

const api = vi.hoisted(() => ({
  updateItem: vi.fn(),
  keysAi: vi.fn(),
  addItems: vi.fn(),
  keepKey: vi.fn(),
  deleteItem: vi.fn(),
  fetchDoubts: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown, planInput: null as unknown, loading: false, error: null as string | null, gone: false },
}));

vi.mock('../../api/containers', () => ({
  updateItem: api.updateItem,
  keysAi: api.keysAi,
  addItems: api.addItems,
  keepKey: api.keepKey,
  deleteItem: api.deleteItem,
  fetchDoubts: api.fetchDoubts,
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: api.state.summary ? { summary: api.state.summary, items: api.state.items, planInput: api.state.planInput, oralWithoutPoints: 0 } : null,
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
  api.state.planInput = null;
  api.state.loading = false;
  api.state.error = null;
  api.state.gone = false;
  // the database's answer carries the mark as stored (migration 20261107090300): set by ai_key true, kept by a change
  // that is not the key, dropped by a key change
  api.updateItem.mockReset().mockImplementation(async (id: string, patch: { ai_key?: boolean; correct?: number[]; answers?: string[] } = {}) => {
    const flags = ((api.state.items as Map<string, TestItem> | null)?.get(id)?.flags ?? []) as string[];
    const kept = patch.correct === undefined && patch.answers === undefined && patch.ai_key === undefined && flags.includes('ai_key');
    return { id, rev: 2, rev_changed: true, doubts_resolved: 0, ai_key: patch.ai_key === true || kept };
  });
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

  it('a key «Подобрать ключи с ИИ» suggested is labelled where it shows; a key without the mark is not', async () => {
    const items = itemsFor();
    const five = BASE_ITEMS[4];
    items.set(five.id, { ...items.get(five.id)!, flags: ['ai_key'], rev: 2 });
    api.state.items = items;
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /Ключи подобрал ИИ\s*1\sвопрос/ }));
    expect(await screen.findByText(/Ключ подобран ИИ, не из файла\./)).toBeInTheDocument();
    // the author changes it: the patch takes the mark off (migration 20261107090300), and so does the card
    fireEvent.click(screen.getByRole('button', { name: /^Б\.\s?/ }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(five.id, { correct: [1] }));
    await waitFor(() => expect(screen.queryByText(/Ключ подобран ИИ/)).toBeNull());
    cleanup();
    items.set(five.id, { ...items.get(five.id)!, flags: [] });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: /Ключ поставили вы/ }));
    expect(await screen.findByText(/Ключ сейчас:/)).toBeInTheDocument();
    expect(screen.queryByText(/Ключ подобран ИИ/)).toBeNull();
  });

  it('«Подобрать ключи с ИИ»: keyless choice questions without pictures go; an agreed key is written with ai_key true', async () => {
    const items = itemsFor();
    const two = BASE_ITEMS[1];
    // a keyless question with a picture: it does not go (the model would answer blind)
    items.set('pic-item', { ...items.get(two.id)!, id: 'pic-item', position: 40, file_no: '40', images: { stem: ['c/a.png'], options: [] } });
    api.state.items = items;
    api.keysAi.mockImplementation(async (input: { questions: Array<{ id: string }> }) => ({
      results: input.questions.map((question) => ({ id: question.id, correct: [1], agree: true, sure: 'high' })),
      units: 5,
      spent_questions: input.questions.length,
    }));
    renderAt();
    const go = await screen.findByRole('button', { name: 'Подобрать ключи с ИИ' });
    expect(screen.getByText((text) => text.replace(/\u00a0/g, ' ') === '1 вопрос без ключа · 5 единиц')).toBeInTheDocument();
    fireEvent.click(go);
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(two.id, { correct: [1], ai_key: true }));
    const [request] = api.keysAi.mock.calls[0];
    expect(request.questions.map((question: { id: string; options: string[]; kind: string }) => [question.id, question.kind])).toEqual([[two.id, 'single']]);
    expect(request.subject).toBe(SUMMARY.subjects[0].title);
    expect(await screen.findByText(/Ключи подобраны для 1 из 1 вопроса\./)).toBeInTheDocument();
    // the key is there, with its mark, in «Ключи подобрал ИИ»
    fireEvent.click(screen.getByRole('button', { name: /Ключи подобрал ИИ/ }));
    expect(await screen.findByText(/Ключ подобран ИИ, не из файла\./)).toBeInTheDocument();
  });

  it('«Подобрать ключи с ИИ»: a key the author set meanwhile stays, a failed write is counted, the run goes on', async () => {
    const items = itemsFor();
    const two = BASE_ITEMS[1];
    // two more keyless questions: the author keys one by hand during the run, the write of the other fails
    items.set('k-hand', { ...items.get(two.id)!, id: 'k-hand', position: 41, file_no: '41', stem: 'Вопрос, который автор отметил сам' });
    items.set('k-fail', { ...items.get(two.id)!, id: 'k-fail', position: 42, file_no: '42', stem: 'Вопрос, запись которого не прошла' });
    api.state.items = items;
    api.keysAi.mockImplementation(async (input: { questions: Array<{ id: string }> }) => ({
      results: input.questions.map((question) => ({ id: question.id, correct: [1], agree: true, sure: 'high' })),
      units: 5,
      spent_questions: input.questions.length,
    }));
    api.updateItem.mockImplementation(async (id: string) => {
      // the database's refusals as api/containers.ts gives them: SQLSTATE and detail
      if (id === 'k-hand') throw Object.assign(new Error('invalid patch'), { code: '22023', status: 400, detail: 'keyed' });
      if (id === 'k-fail') throw Object.assign(new Error('Нет сети'), { code: 'network', status: 0, detail: null });
      return { id, rev: 2, rev_changed: true, doubts_resolved: 0, ai_key: true };
    });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Подобрать ключи с ИИ' }));
    const line = await screen.findByText(/Ключи подобраны для 1 из 3 вопросов\./);
    const text = line.textContent!.replace(/\u00a0/g, ' ');
    expect(text).toContain('Не записаны 2 ключа от ИИ: уже есть ключ — 1, не удалось сохранить — 1.');
    expect(text).toContain('Списано 5 единиц.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.updateItem).toHaveBeenCalledTimes(3);
  });

  it('«Подобрать ключи с ИИ»: a database that does not keep the mark stops the run and takes the key back', async () => {
    const items = itemsFor();
    const two = BASE_ITEMS[1];
    items.set('k-next', { ...items.get(two.id)!, id: 'k-next', position: 41, file_no: '41', stem: 'Ещё один вопрос без ключа' });
    api.state.items = items;
    api.keysAi.mockImplementation(async (input: { questions: Array<{ id: string }> }) => ({
      results: input.questions.map((question) => ({ id: question.id, correct: [1], agree: true, sure: 'high' })),
      units: 5,
      spent_questions: input.questions.length,
    }));
    // an old database: no ai_key in its answer
    api.updateItem.mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: true, doubts_resolved: 0 }));
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Подобрать ключи с ИИ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ключи от ИИ пока не сохраняются с подписью');
    expect(api.updateItem.mock.calls).toEqual([
      [two.id, { correct: [1], ai_key: true }],
      [two.id, { correct: [] }], // keyless again, as before the run
    ]);
  });

  it('«Подобрать ключи с ИИ»: no key where the AI was not sure; a refusal in plain words', async () => {
    api.keysAi.mockResolvedValueOnce({ results: [{ id: BASE_ITEMS[1].id, correct: null, agree: false, sure: 'low', note: 'ИИ не уверен' }], units: 5, spent_questions: 1 });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Подобрать ключи с ИИ' }));
    expect(await screen.findByText(/Без ключа остался 1: ИИ не уверен/)).toBeInTheDocument();
    expect(api.updateItem).not.toHaveBeenCalled();
    api.keysAi.mockRejectedValueOnce(Object.assign(new Error('ИИ сейчас занят.'), { code: 'ai_busy', status: 429 }));
    fireEvent.click(screen.getByRole('button', { name: 'Подобрать ключи с ИИ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ИИ сейчас занят. Попробуйте подобрать ключи через минуту.');
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

  it('«Баллы» (20261107090700_item_points): the editor sends them alone, the card says them beside the number', async () => {
    api.updateItem.mockImplementationOnce(async (id: string) => ({ id, rev: 1, rev_changed: false, doubts_resolved: 0, points: 4 }));
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}&no=7`);
    const card = await screen.findByRole('article');
    // a question of 1 point says nothing of points
    expect(within(card).queryByText(/балл/)).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: KEYS.edit }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    expect((within(editor).getByLabelText(EDITOR.points) as HTMLInputElement).value).toBe('1');
    fireEvent.change(within(editor).getByLabelText(EDITOR.points), { target: { value: '4' } });
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.save }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(BASE_ITEMS[6].id, { points: 4 }));
    const saved = await screen.findByRole('article');
    expect(within(saved).getByText(/№\s7 · .* · 4\sбалла$/)).toBeInTheDocument();
    expect(screen.getByText(KEYS.edited)).toBeInTheDocument();
  });

  it('a new question goes with the points the author set', async () => {
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}`);
    fireEvent.click(await screen.findByRole('button', { name: KEYS.add }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    fireEvent.change(within(editor).getByLabelText(EDITOR.stem), { target: { value: 'Что такое шлюз в BPMN?' } });
    fireEvent.change(within(editor).getByLabelText(EDITOR.option('А')), { target: { value: 'Ромб ветвления' } });
    fireEvent.change(within(editor).getByLabelText(EDITOR.option('Б')), { target: { value: 'Стрелка' } });
    fireEvent.click(within(editor).getByLabelText(EDITOR.right('А')));
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.pointsMore }));
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.add }));
    await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
    const [, inputs] = api.addItems.mock.calls[0] as [string, Array<Record<string, unknown>>];
    expect(inputs[0]).toMatchObject({ stem: 'Что такое шлюз в BPMN?', points: 2 });
  });

  // Phone audit 47.3: a brand-new test's first save said «Счёт по этому вопросу начнётся заново» — nothing was counted.
  describe('the line after a save that moves the key', () => {
    const saveNewKey = async () => {
      renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}&no=7`);
      fireEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: KEYS.edit }));
      const editor = screen.getByRole('form', { name: EDITOR.label });
      fireEvent.click(within(editor).getByLabelText(EDITOR.right('А')));
      fireEvent.click(within(editor).getByRole('button', { name: EDITOR.save }));
      await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    };

    it('says only «Сохранено.» when nobody has answered the question: no members, the author never did', async () => {
      api.state.summary = withMembers(0);
      await saveNewKey();
      expect(await screen.findByText(KEYS.edited)).toBeInTheDocument();
      expect(screen.queryByText(KEYS.editedReset(false))).toBeNull();
    });

    it('says the count starts again when the author had answered it', async () => {
      api.state.summary = withMembers(0);
      api.state.planInput = { items: [{ id: BASE_ITEMS[6].id, s: SUBJECT_1, f: 't', tp: null, o: 7, u: { seen: 2, wrong: 1 } }] };
      await saveNewKey();
      expect(await screen.findByText(KEYS.editedReset(false))).toBeInTheDocument();
    });

    it('says it for the group whenever the exam has members (their answers are not the author’s to see)', async () => {
      await saveNewKey();
      expect(await screen.findByText(KEYS.editedReset(true))).toBeInTheDocument();
    });
  });

  it('hides «Проверить N вопросов» while the editor is open', async () => {
    renderAt(`/exams/c/${ID}/keys?s=${SUBJECT_1}&no=7`);
    expect(await screen.findByRole('button', { name: /^Проверить 3\sвопроса/ })).toBeInTheDocument();
    fireEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: KEYS.edit }));
    expect(screen.queryByRole('button', { name: /^Проверить 3\sвопроса/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.cancel }));
    expect(screen.getByRole('button', { name: /^Проверить 3\sвопроса/ })).toBeInTheDocument();
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
