import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerSummary, ItemInput, TestItem } from '../../types/container';

const api = vi.hoisted(() => ({
  addItems: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItems: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown, loading: false, error: null as string | null, gone: false },
}));

vi.mock('../../api/containers', () => ({
  addItems: api.addItems,
  updateItem: api.updateItem,
  deleteItem: api.deleteItem,
  reorderItems: api.reorderItems,
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

import BuildPage from './BuildPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { EDITOR, GONE, KEYS } from '../../components/containers/copyImport';
import { BUILD } from '../../components/test/copyTest';

const ID = 'c-test';
const SUBJ = 's-questions';
const OTHER = 's-other';

const QUESTIONS: TestItem[] = [
  item({ id: 'q-1', container_id: ID, subject_id: SUBJ, position: 1, file_no: '1', topic: null, stem: 'Сколько будет 2 + 2?', options: ['3', '4', '5', '6'], correct: [1], key_source: 'manual', explanation: 'Два плюс два — четыре.' }),
  item({ id: 'q-2', container_id: ID, subject_id: SUBJ, position: 2, file_no: '2', topic: null, kind: 'short', stem: 'Столица Франции?', options: [], correct: [], answers: ['Париж', 'Paris'], key_source: 'manual' }),
  item({ id: 'q-3', container_id: ID, subject_id: SUBJ, position: 3, file_no: '3', topic: null, kind: 'multiple', stem: 'Какие числа простые?', options: ['2', '4', '5', '9'], correct: [0, 2], key_source: 'manual' }),
  item({ id: 'q-4', container_id: ID, subject_id: SUBJ, position: 4, file_no: '4', topic: null, stem: 'Что выведет код?\nint x = 1;\nConsole.WriteLine(x);', code: true, options: ['1', '0'], correct: [0], key_source: 'manual' }),
];

const testSummary = (overrides: Partial<ContainerSummary> = {}): ContainerSummary =>
  summary({
    id: ID,
    title: 'Химия, 9 класс',
    exam_date: null,
    subjects: [subject({ id: SUBJ, title: 'Вопросы', oral: null, topic_titles: [], topics: [], kinds: { single: 2, multiple: 1, short: 1 } })],
    owner: { members: 0, doubts_open: 0, links: [] },
    ...overrides,
  });

const asMap = (list: TestItem[]) => new Map(list.map((entry) => [entry.id, entry]));

function renderAt(path = `/exams/c/${ID}/build`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/c/:id/build" element={<BuildPage />} />
        <Route path="/exams/c/:id" element={<p>Экзамен</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The cards' questions, top to bottom. */
const ids = () => screen.queryAllByRole('article').map((card) => card.querySelector('[data-act^="edit:"]')?.getAttribute('data-act')?.slice(5));
const card = (n: number) => screen.getByRole('article', { name: BUILD.number(n) });
const echoAdd = async (subjectId: string, inputs: ItemInput[]) => [
  { subject_id: subjectId, added: inputs.length, in_container: 4 + inputs.length, items: inputs.map((input, index) => ({ ref: input.ref, id: `new-${index + 1}`, position: 5 + index })) },
];
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  api.state.summary = testSummary();
  api.state.items = asMap(QUESTIONS);
  api.state.loading = false;
  api.state.error = null;
  api.state.gone = false;
  api.addItems.mockReset().mockImplementation(echoAdd);
  api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 1, rev_changed: false, doubts_resolved: 0 }));
  api.deleteItem.mockReset().mockResolvedValue(undefined);
  api.reorderItems.mockReset().mockResolvedValue(undefined);
  api.reload.mockReset();
});
afterEach(() => cleanup());

describe('BuildPage: the questions as cards (spec 2026-10-18 §47.2)', () => {
  it('shows the test’s name, its size and each question in order: kind, key, forms, explanation, code', () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: 'Химия, 9 класс' })).toBeInTheDocument();
    expect(screen.getByText(/^4\sвопроса$/)).toBeInTheDocument();
    expect(ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);

    const first = card(1);
    expect(within(first).getByText('Один ответ')).toBeInTheDocument();
    expect(within(first).getByText(BUILD.rightWord).closest('li')).toHaveTextContent(/Б\.\s*4\s*верный$/);
    expect(within(first).getByText(BUILD.explanation)).toBeInTheDocument();
    expect(within(first).getByText('Два плюс два — четыре.')).toBeInTheDocument();

    const second = card(2);
    expect(within(second).getByText('Короткий ответ')).toBeInTheDocument();
    expect(within(second).getByText(BUILD.forms)).toBeInTheDocument();
    expect(within(second).getByText('Париж')).toBeInTheDocument();
    expect(within(second).getByText('Paris')).toBeInTheDocument();
    expect(within(second).queryByText(BUILD.explanation)).toBeNull();

    const third = card(3);
    expect(within(third).getByText('Несколько ответов')).toBeInTheDocument();
    expect(within(third).getAllByText(BUILD.rightWord)).toHaveLength(2);

    const code = within(card(4)).getByRole('group', { name: 'Код' });
    expect(code).toHaveTextContent('int x = 1;');
    expect(within(card(4)).getByText('Что выведет код?')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: BUILD.quizzes })).toHaveAttribute('href', `/exams/c/${ID}/quizzes`);
    expect(screen.getByRole('link', { name: BUILD.settings })).toHaveAttribute('href', `/exams/c/${ID}/settings`);
    expect(document.title).toContain('Конструктор · Химия, 9 класс');
  });

  it('«Отправить по ссылке» opens the quiz setup with every question', () => {
    renderAt();
    const send = screen.getByRole('link', { name: BUILD.send });
    expect(send).toHaveAttribute('href', `/exams/c/${ID}/quizzes/new?all=1`);
    expect(send).toHaveClass('sf-primary');
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('says a choice question has no key yet, and keeps «Отправить по ссылке» shut while no question has one', () => {
    api.state.items = asMap([{ ...QUESTIONS[0], correct: [], key_source: 'none' }]);
    renderAt();
    expect(within(card(1)).getByText(EDITOR.noKey)).toBeInTheDocument();
    expect(screen.getByText(/без ключа: 1/)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: BUILD.send });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(BUILD.sendWhy);
    expect(screen.queryByRole('link', { name: BUILD.send })).toBeNull();
  });

  it('edits a question in place through the editor of «Вопросы и ключи»: only the change is sent', async () => {
    renderAt();
    fireEvent.click(within(card(1)).getByRole('button', { name: KEYS.edit }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    expect(within(editor).getByText(/^Вопрос 1\s·\sОдин ответ$/)).toBeInTheDocument();
    expect(within(editor).getByLabelText(EDITOR.stem)).toHaveFocus();
    // The bar would cover «Сохранить» on a phone.
    expect(screen.queryByRole('link', { name: BUILD.send })).toBeNull();
    fireEvent.change(within(editor).getByLabelText(EDITOR.stem), { target: { value: 'Сколько будет 3 + 3?' } });
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.save }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith('q-1', { stem: 'Сколько будет 3 + 3?' }));
    expect(await within(card(1)).findByText('Сколько будет 3 + 3?')).toBeInTheDocument();
    expect(within(card(1)).getByText(KEYS.edited)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: EDITOR.label })).toBeNull();
    expect(within(card(1)).getByRole('button', { name: KEYS.edit })).toHaveFocus();
    expect(screen.getByRole('link', { name: BUILD.send })).toBeInTheDocument();
  });

  it('a failed save keeps the editor open with the reason', async () => {
    api.updateItem.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42501' }));
    renderAt();
    fireEvent.click(within(card(2)).getByRole('button', { name: KEYS.edit }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    fireEvent.change(within(editor).getByLabelText(EDITOR.forms), { target: { value: 'Париж; Paris; Пари' } });
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.save }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent('Это может изменить только автор экзамена.');
    expect(screen.getByRole('form', { name: EDITOR.label })).toBeInTheDocument();
  });

  it('«Копия» adds the same question with a new ref and number, then puts it right under the original', async () => {
    renderAt();
    fireEvent.click(within(card(2)).getByRole('button', { name: BUILD.copy }));
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalledWith(SUBJ, ['q-1', 'q-2', 'new-1', 'q-3', 'q-4']));
    const [subjectId, inputs] = api.addItems.mock.calls[0] as [string, ItemInput[]];
    expect(subjectId).toBe(SUBJ);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ stem: 'Столица Франции?', kind: 'short', options: [], correct: [], answers: ['Париж', 'Paris'], key_source: 'manual', file_no: '5' });
    expect(inputs[0].ref).toMatch(/^man:[0-9a-f-]{36}$/);
    expect(ids()).toEqual(['q-1', 'q-2', 'new-1', 'q-3', 'q-4']);
    expect(await within(card(2)).findByText(BUILD.copied(3))).toBeInTheDocument();
    expect(within(card(3)).getByText('Столица Франции?')).toBeInTheDocument();
    expect(api.reload).toHaveBeenCalled();
    expect(screen.getByText(/^5\sвопросов$/)).toBeInTheDocument();
  });

  it('a copy the server would not move stays at the end, and the card says so', async () => {
    api.reorderItems.mockRejectedValueOnce(new Error('boom'));
    renderAt();
    fireEvent.click(within(card(1)).getByRole('button', { name: BUILD.copy }));
    expect(await within(card(1)).findByRole('alert')).toHaveTextContent(BUILD.copiedEnd);
    expect(ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4', 'new-1']);
  });

  it('deletes after asking, the way «Вопросы и ключи» deletes', async () => {
    renderAt();
    fireEvent.click(within(card(3)).getByRole('button', { name: BUILD.remove }));
    const third = card(3);
    expect(within(third).getByText(/^Удалить вопрос 3\? Ответы по нему пропадут\.$/)).toBeInTheDocument();
    expect(within(third).queryByRole('button', { name: KEYS.edit })).toBeNull();
    expect(within(third).getByRole('button', { name: KEYS.removeNo })).toHaveFocus();
    fireEvent.click(within(third).getByRole('button', { name: KEYS.removeNo }));
    expect(api.deleteItem).not.toHaveBeenCalled();
    expect(within(third).getByRole('button', { name: BUILD.remove })).toHaveFocus();

    fireEvent.click(within(third).getByRole('button', { name: BUILD.remove }));
    fireEvent.click(within(third).getByRole('button', { name: KEYS.removeYes }));
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith('q-3'));
    await waitFor(() => expect(ids()).toEqual(['q-1', 'q-2', 'q-4']));
    expect(within(card(3)).getByRole('button', { name: KEYS.edit })).toHaveFocus();
    expect(screen.getByText(KEYS.removed)).toBeInTheDocument();
  });

  it('in an exam with members, the question says the members’ answers go too', () => {
    api.state.summary = testSummary({ owner: { members: 3, doubts_open: 0, links: [] } });
    renderAt();
    fireEvent.click(within(card(1)).getByRole('button', { name: BUILD.remove }));
    expect(within(card(1)).getByText(/^Удалить вопрос 1\? Ответы по нему пропадут у всех участников\.$/)).toBeInTheDocument();
  });

  it('«Ниже» and «Выше» move the card at once and send the whole order', async () => {
    const pending = deferred();
    api.reorderItems.mockReturnValueOnce(pending.promise);
    renderAt();
    expect(within(card(1)).getByRole('button', { name: BUILD.up })).toBeDisabled();
    expect(within(card(4)).getByRole('button', { name: BUILD.down })).toBeDisabled();

    fireEvent.click(within(card(1)).getByRole('button', { name: BUILD.down }));
    expect(ids()).toEqual(['q-2', 'q-1', 'q-3', 'q-4']);
    expect(api.reorderItems).toHaveBeenCalledWith(SUBJ, ['q-2', 'q-1', 'q-3', 'q-4']);
    expect(within(card(2)).getByRole('button', { name: BUILD.down })).toHaveFocus();
    expect(screen.getByText(BUILD.moved(2))).toBeInTheDocument();
    // While the order is on its way the other buttons wait.
    fireEvent.click(within(card(4)).getByRole('button', { name: BUILD.up }));
    expect(api.reorderItems).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());

    fireEvent.click(within(card(4)).getByRole('button', { name: BUILD.up }));
    expect(ids()).toEqual(['q-2', 'q-1', 'q-4', 'q-3']);
    await waitFor(() => expect(api.reorderItems).toHaveBeenLastCalledWith(SUBJ, ['q-2', 'q-1', 'q-4', 'q-3']));
  });

  it('a card at the top keeps focus on «Ниже» after moving up', () => {
    renderAt();
    fireEvent.click(within(card(2)).getByRole('button', { name: BUILD.up }));
    expect(ids()).toEqual(['q-2', 'q-1', 'q-3', 'q-4']);
    expect(within(card(1)).getByRole('button', { name: BUILD.down })).toHaveFocus();
  });

  it('puts the cards back when the server refuses the order, and says why', async () => {
    const pending = deferred();
    api.reorderItems.mockReturnValueOnce(pending.promise);
    renderAt();
    fireEvent.click(within(card(3)).getByRole('button', { name: BUILD.up }));
    expect(ids()).toEqual(['q-1', 'q-3', 'q-2', 'q-4']);
    await act(async () => pending.reject(Object.assign(new Error('x'), { code: 'network' })));
    expect(ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
    const alert = within(card(3)).getByRole('alert');
    expect(alert).toHaveTextContent(BUILD.moveFailed);
    expect(alert).toHaveTextContent('Нет связи с сервером.');
  });
});

describe('BuildPage: adding a question by its kind', () => {
  it('«Верно / неверно» opens the editor with «Верно», «Неверно» kept in order; the author marks the right one', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: KEYS.add }));
    const kinds = screen.getByRole('group', { name: BUILD.typeChoice });
    expect(within(kinds).getAllByRole('button').map((button) => button.textContent)).toEqual(['Один ответ', 'Несколько ответов', 'Короткий ответ', 'Верно / неверно', 'Отмена']);
    expect(within(kinds).getByRole('button', { name: 'Один ответ' })).toHaveFocus();
    fireEvent.click(within(kinds).getByRole('button', { name: 'Верно / неверно' }));

    const editor = screen.getByRole('form', { name: EDITOR.label });
    expect(within(editor).getByText(/^Новый вопрос 5\s·\sВерно \/ неверно: отметьте, какой вариант верный$/)).toBeInTheDocument();
    expect(within(editor).getByLabelText(EDITOR.option('А'))).toHaveValue('Верно');
    expect(within(editor).getByLabelText(EDITOR.option('Б'))).toHaveValue('Неверно');
    expect(within(editor).queryByLabelText(EDITOR.option('В'))).toBeNull();
    expect(within(editor).getByLabelText(EDITOR.keepOrder)).toBeChecked();
    expect(within(editor).getByLabelText(EDITOR.right('А'))).not.toBeChecked();
    expect(within(editor).getByLabelText(EDITOR.stem)).toHaveFocus();

    fireEvent.change(within(editor).getByLabelText(EDITOR.stem), { target: { value: 'Вода кипит при 100 °C на уровне моря.' } });
    fireEvent.click(within(editor).getByLabelText(EDITOR.right('А')));
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.save }));
    await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
    const [subjectId, inputs] = api.addItems.mock.calls[0] as [string, ItemInput[]];
    expect(subjectId).toBe(SUBJ);
    expect(inputs[0]).toMatchObject({
      stem: 'Вода кипит при 100 °C на уровне моря.',
      options: ['Верно', 'Неверно'],
      correct: [0],
      kind: 'single',
      keep_order: true,
      key_source: 'manual',
      file_no: '5',
    });
    expect(inputs[0].ref).toMatch(/^man:/);
    expect(await screen.findByText(BUILD.added(5))).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: EDITOR.label })).toBeNull();
    expect(ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4', 'new-1']);
    expect(within(card(5)).getByText('Верно / неверно')).toBeInTheDocument();
    expect(api.reorderItems).not.toHaveBeenCalled();
    expect(api.reload).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: KEYS.add })).toHaveFocus();
  });

  it('«Короткий ответ» opens the editor with the accepted forms, without options', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: KEYS.add }));
    fireEvent.click(screen.getByRole('button', { name: 'Короткий ответ' }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    expect(within(editor).getByLabelText(EDITOR.forms)).toHaveValue('');
    expect(within(editor).queryByLabelText(EDITOR.option('А'))).toBeNull();
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.cancel }));
    expect(screen.queryByRole('form', { name: EDITOR.label })).toBeNull();
    expect(screen.getByRole('button', { name: KEYS.add })).toHaveFocus();
    expect(api.addItems).not.toHaveBeenCalled();
  });

  it('a new test: one line and the four kinds right there; «Несколько ответов» starts with four options', () => {
    api.state.summary = testSummary({ subjects: [subject({ id: SUBJ, title: 'Вопросы', oral: null, topic_titles: [], topics: [], kinds: { single: 0, multiple: 0, short: 0 } })] });
    api.state.items = new Map();
    renderAt();
    expect(screen.getByText(BUILD.empty)).toBeInTheDocument();
    expect(screen.getByText('пока без вопросов')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: KEYS.add })).toBeNull();
    const kinds = screen.getByRole('group', { name: BUILD.typeChoice });
    expect(within(kinds).getAllByRole('button').map((button) => button.textContent)).toEqual(['Один ответ', 'Несколько ответов', 'Короткий ответ', 'Верно / неверно']);
    expect(screen.getByRole('button', { name: BUILD.send })).toBeDisabled();

    fireEvent.click(within(kinds).getByRole('button', { name: 'Несколько ответов' }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    expect(within(editor).getByText(/^Новый вопрос 1\s·\sНесколько ответов: отметьте все верные варианты$/)).toBeInTheDocument();
    expect(within(editor).getByLabelText(EDITOR.option('Г'))).toHaveValue('');
    expect(within(editor).queryByLabelText(EDITOR.option('Д'))).toBeNull();
    expect(screen.queryByText(BUILD.empty)).toBeNull();
  });

  it('a failed add keeps the editor open with the reason', async () => {
    api.addItems.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'MC007' }));
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: KEYS.add }));
    fireEvent.click(screen.getByRole('button', { name: 'Короткий ответ' }));
    const editor = screen.getByRole('form', { name: EDITOR.label });
    fireEvent.change(within(editor).getByLabelText(EDITOR.stem), { target: { value: 'Столица Италии?' } });
    fireEvent.change(within(editor).getByLabelText(EDITOR.forms), { target: { value: 'Рим' } });
    fireEvent.click(within(editor).getByRole('button', { name: EDITOR.save }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent('В экзамене помещается 20 предметов и 2000 вопросов с вариантами.');
    expect(ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
  });
});

describe('BuildPage: subjects, and who may build', () => {
  const twoSubjects = () =>
    testSummary({
      subjects: [
        subject({ id: OTHER, position: 1, title: 'Органика', oral: null, topic_titles: [], topics: [], kinds: { single: 0, multiple: 0, short: 0 } }),
        subject({ id: SUBJ, position: 2, title: 'Неорганика', oral: null, topic_titles: [], topics: [], kinds: { single: 2, multiple: 1, short: 1 } }),
      ],
    });

  it('an exam of several subjects opens on the first with questions and lets the author choose another', () => {
    api.state.summary = twoSubjects();
    renderAt();
    expect(screen.getByRole('combobox', { name: KEYS.findSubject })).toHaveTextContent('Неорганика');
    expect(ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
    expect(screen.getByText(/^2\sпредмета\s·\s4\sвопроса$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: KEYS.findSubject }));
    fireEvent.click(screen.getByRole('option', { name: 'Органика' }));
    expect(ids()).toEqual([]);
    expect(screen.getByText(BUILD.empty)).toBeInTheDocument();
    // The questions of the other subject still count for the link.
    expect(screen.getByRole('link', { name: BUILD.send })).toBeInTheDocument();
  });

  it('?s=<subject> opens that subject', () => {
    api.state.summary = twoSubjects();
    renderAt(`/exams/c/${ID}/build?s=${OTHER}`);
    expect(screen.getByRole('combobox', { name: KEYS.findSubject })).toHaveTextContent('Органика');
    expect(screen.getByText(BUILD.empty)).toBeInTheDocument();
  });

  it('a member is told the questions are the author’s, as in «Вопросы и ключи»', () => {
    api.state.summary = testSummary({ role: 'member', owner: null });
    renderAt();
    expect(screen.getByText(KEYS.authorOnly)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: KEYS.toExam })).toHaveAttribute('href', `/exams/c/${ID}`);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button', { name: KEYS.add })).toBeNull();
    expect(screen.queryByText(BUILD.send)).toBeNull();
  });

  it('an exam that is gone: says so, the way to «Экзамены», no retry', () => {
    api.state.summary = null;
    api.state.error = 'Не нашли — возможно, его уже удалили.';
    api.state.gone = true;
    renderAt();
    expect(screen.getByText(`${GONE.title}. ${GONE.text}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: KEYS.retry })).toBeNull();
  });

  it('says in Russian when the questions did not load, with a retry', () => {
    api.state.summary = null;
    api.state.error = 'Failed to fetch';
    renderAt();
    expect(screen.getByRole('alert')).toHaveTextContent(KEYS.loadFailed);
    fireEvent.click(screen.getByRole('button', { name: KEYS.retry }));
    expect(api.reload).toHaveBeenCalled();
  });

  it('waits with a line while loading', () => {
    api.state.summary = null;
    api.state.loading = true;
    renderAt();
    expect(screen.getByRole('status')).toHaveTextContent(KEYS.loading);
  });
});
