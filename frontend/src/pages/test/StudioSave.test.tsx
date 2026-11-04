import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerSummary } from '../../types/container';
import type { DocBlock, TestDoc } from '../../types/testDoc';

/**
 * Saving in the studio and leaving it (owner, 04.11: «Почему нет кнопки сохранить изменения? Если выйти по стрелке
 * слева сверху, ничего не меняется»): the top bar's «Сохранить» and its status, the editor pressed by the page, Ctrl+S,
 * the question before leaving (the back arrow, the app's links, the browser's «Назад», closing the tab, «Отправить по
 * ссылке», another view), «Список» the same, and the line about where the changes go. StudioPage with its data mocked as
 * in StudioPage.test.tsx.
 */
const api = vi.hoisted(() => ({
  addItems: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItems: vi.fn(),
  fetchTestDoc: vi.fn(),
  saveTestDoc: vi.fn(),
  listQuizzes: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/containers', () => ({
  addItems: api.addItems,
  updateItem: api.updateItem,
  deleteItem: api.deleteItem,
  reorderItems: api.reorderItems,
  isGone: (error: { code?: string } | null) => error?.code === 'P0002',
  isOffline: (error: { code?: string } | null) => error?.code === 'network',
}));
vi.mock('../../api/testDocs', () => ({
  fetchTestDoc: api.fetchTestDoc,
  saveTestDoc: api.saveTestDoc,
  isStale: (error: { code?: string } | null) => error?.code === 'MC020',
  refusedRule: (error: { code?: string; detail?: string } | null) => (error?.code === '22023' ? error.detail ?? null : null),
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 },
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    gone: false,
    reload: vi.fn(),
  }),
}));
vi.mock('../../api/quizzes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/quizzes')>()),
  itemPercents: vi.fn(async () => []),
  listQuizzes: api.listQuizzes,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

import StudioPage, { whereKind } from './StudioPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { STUDIO } from '../../components/studio/copyStudio';
import { EDITOR, nb } from '../../components/containers/copyImport';
import { emptyDoc } from '../../lib/studio/doc';
import { mayLeave } from '../../lib/leaveCheck';

const EXAM = '11111111-2222-4333-8444-555555555555';
const SUBJ = '22222222-3333-4444-8555-666666666666';
const uid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { container_id: EXAM, subject_id: SUBJ, topic: null, key_source: 'manual' as const, images: null };
const Q1 = item({ ...base, id: uid(1), position: 1, file_no: '1', stem: 'Срок хранения амбулаторной карты', options: ['5 лет', '25 лет'], correct: [1] });
const Q2 = item({ ...base, id: uid(2), position: 2, file_no: '2', stem: 'Согласие на вмешательство оформляется', options: ['устно', 'письменно'], correct: [1] });
const STUDIO_PATH = `/exams/c/${EXAM}/studio`;

const question = (id: string, itemId: string): DocBlock => ({ type: 'question', id, item_id: itemId, points: 1, required: false });
function storedDoc(): TestDoc {
  return {
    ...emptyDoc('Аккредитация, полный тест'),
    layout: 'one_page',
    blocks: [
      { type: 'heading', id: 'head00000001', text: 'Часть первая', size: 'l' },
      question('qblock000001', uid(1)),
      question('qblock000002', uid(2)),
    ],
  };
}

const examSummary = (): ContainerSummary =>
  summary({
    id: EXAM,
    title: 'Аккредитация, полный тест',
    exam_date: null,
    subjects: [subject({ id: SUBJ, title: 'Вопросы', exam_date: null, oral: null, topic_titles: [], topics: [], kinds: { single: 2, multiple: 0, short: 0 } })],
    owner: { members: 0, doubts_open: 0, links: [] },
  });

function routes() {
  return (
    <>
      <nav>
        <Link to="/library">Лекции</Link>
      </nav>
      <Routes>
        <Route path="/exams/c/:id/studio" element={<StudioPage />} />
        <Route path="/exams/c/:id/quizzes/new" element={<p>Настройка контрольной</p>} />
        <Route path="/exams/c/:id" element={<p>Экзамен</p>} />
        <Route path="/library" element={<p>Лекции страница</p>} />
      </Routes>
    </>
  );
}

async function openStudio(doc: TestDoc = storedDoc()) {
  api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 4, updated_at: '2026-11-04T10:00:00Z' });
  render(<MemoryRouter initialEntries={[STUDIO_PATH]}>{routes()}</MemoryRouter>);
  await screen.findByRole('group', { name: '1 из 3: Заголовок' });
}

const frame = (id: string) => document.querySelector<HTMLElement>(`[data-block="${id}"]`) as HTMLElement;
const side = () => screen.getByRole('complementary', { name: STUDIO.panelsLabel });
const bar = () => document.querySelector('.st-bar') as HTMLElement;
const saveAll = () => within(bar()).getByRole('button', { name: STUDIO.saveAll });
const status = () => (document.querySelector('.st-save') as HTMLElement).textContent ?? '';
const ask = () => screen.queryByRole('alertdialog');
const view = (name: string) => within(screen.getByRole('group', { name: STUDIO.viewsLabel })).getByRole('button', { name });

/** Question 2 of the canvas in its editor, its text changed (not saved). */
function editQuestion2(text = 'Согласие на медицинское вмешательство оформляется') {
  fireEvent.click(frame('qblock000002'));
  fireEvent.change(within(side()).getByLabelText('Текст вопроса'), { target: { value: text } });
}

beforeEach(() => {
  api.state.summary = examSummary();
  api.state.items = new Map([Q1, Q2].map((entry) => [entry.id, entry]));
  api.addItems.mockReset();
  api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: false, doubts_resolved: 0 }));
  api.deleteItem.mockReset().mockResolvedValue(undefined);
  api.reorderItems.mockReset().mockResolvedValue(undefined);
  api.fetchTestDoc.mockReset();
  api.saveTestDoc.mockReset().mockImplementation(async (_id: string, _doc: TestDoc, rev: number) => ({ rev: rev + 1, updated_at: '2026-11-04T10:00:01Z' }));
  api.listQuizzes.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});

describe('the top bar\'s «Сохранить» and its status', () => {
  it('opened as stored: «Все изменения сохранены», the button there and off', async () => {
    await openStudio();
    expect(status()).toContain(STUDIO.allSaved);
    expect(saveAll()).toBeDisabled();
    expect(saveAll()).toHaveAttribute('aria-keyshortcuts', 'Control+S Meta+S');
    expect(api.saveTestDoc).not.toHaveBeenCalled();
  });

  it('a change of the page: «Сохраняю…» and the button on until it is saved by itself, then off again', async () => {
    await openStudio();
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    expect(status()).toBe(STUDIO.saving);
    expect(saveAll()).toBeEnabled();
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
    expect(saveAll()).toBeDisabled();
  });

  it('the button saves the page at once, without waiting for the pause', async () => {
    await openStudio();
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    fireEvent.click(saveAll());
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalledTimes(1), { timeout: 500 });
    expect(api.saveTestDoc.mock.calls[0][1].layout).toBe('pages');
  });

  it('a question with changes: «Вопрос 2 не сохранён», never «Сохранено»; the button saves it through its editor', async () => {
    await openStudio();
    editQuestion2();
    expect(status()).toContain(STUDIO.questionUnsaved([2]));
    expect(status()).not.toContain(STUDIO.allSaved);
    expect(saveAll()).toBeEnabled();
    fireEvent.click(saveAll());
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(uid(2), { stem: 'Согласие на медицинское вмешательство оформляется' }));
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
    expect(saveAll()).toBeDisabled();
    expect(within(side()).getByText(STUDIO.editorSaved)).toBeInTheDocument();
    // The editor stays on the question as saved.
    expect(within(side()).getByLabelText('Текст вопроса')).toHaveValue('Согласие на медицинское вмешательство оформляется');
  });

  it('while the question saves: «Сохраняю…», the button off', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.updateItem.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await openStudio();
    editQuestion2();
    fireEvent.click(saveAll());
    await waitFor(() => expect(status()).toBe(STUDIO.saving));
    expect(saveAll()).toBeDisabled();
    await act(async () => answer({ id: uid(2), rev: 2, rev_changed: false, doubts_resolved: 0 }));
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
  });

  it('a question its editor would not save (no text): nothing is sent, the editor says why, it stays unsaved', async () => {
    await openStudio();
    editQuestion2('   ');
    fireEvent.click(saveAll());
    await act(async () => undefined);
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(within(side()).getByText(EDITOR.problems.stem)).toBeInTheDocument();
    expect(status()).toContain(STUDIO.questionUnsaved([2]));
  });

  it('a question whose save failed: the editor\'s error line, still «Вопрос 2 не сохранён»', async () => {
    api.updateItem.mockRejectedValue({ code: 'network', message: 'Нет связи' });
    await openStudio();
    editQuestion2();
    fireEvent.click(saveAll());
    await waitFor(() => expect(api.updateItem).toHaveBeenCalled());
    await waitFor(() => expect(within(side()).getByRole('alert')).toBeInTheDocument());
    expect(status()).toContain(STUDIO.questionUnsaved([2]));
    expect(saveAll()).toBeEnabled();
  });

  it('the failure states stay: no network says so with «Сохранить ещё раз»', async () => {
    await openStudio();
    api.saveTestDoc.mockRejectedValueOnce({ code: 'network' });
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    expect(await screen.findByText(STUDIO.offline, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: STUDIO.retry })).toBeInTheDocument();
    // The bar's button is the same retry (on a phone it stands for it).
    expect(saveAll()).toBeEnabled();
    fireEvent.click(saveAll());
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
  });
});

describe('Ctrl+S', () => {
  it('in the question\'s field: the question saved, the browser\'s own «Сохранить страницу» prevented', async () => {
    await openStudio();
    editQuestion2();
    const field = within(side()).getByLabelText('Текст вопроса');
    expect(fireEvent.keyDown(field, { key: 's', code: 'KeyS', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
  });

  it('⌘S, and the Russian layout\'s «ы»; with nothing to save it is still not the browser\'s', async () => {
    await openStudio();
    expect(fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true })).toBe(false);
    await act(async () => undefined);
    editQuestion2();
    expect(fireEvent.keyDown(document.body, { key: 'ы', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    // Plain «s» types as usual.
    expect(fireEvent.keyDown(document.body, { key: 's', code: 'KeyS' })).toBe(true);
  });
});

describe('leaving with something not saved asks first', () => {
  it('the back arrow: «Остаться» keeps the editor, «Не сохранять» goes without saving', async () => {
    await openStudio();
    editQuestion2();
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    const dialog = ask() as HTMLElement;
    expect(dialog).toHaveAccessibleName(nb(STUDIO.leaveQuestion([2])));
    expect(within(dialog).getByRole('button', { name: STUDIO.leaveSave.go })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveStay }));
    expect(ask()).toBeNull();
    expect(within(side()).getByLabelText('Текст вопроса')).toHaveValue('Согласие на медицинское вмешательство оформляется');
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveDiscard }));
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it('«Сохранить и выйти»: the question saved through its editor, then the page goes', async () => {
    await openStudio();
    editQuestion2();
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveSave.go }));
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
    expect(api.updateItem).toHaveBeenCalledWith(uid(2), { stem: 'Согласие на медицинское вмешательство оформляется' });
  });

  it('«Сохранить и выйти» that cannot save: the page stays, the question says why', async () => {
    await openStudio();
    editQuestion2('');
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveSave.go }));
    await waitFor(() => expect(within(ask() as HTMLElement).getByRole('alert')).toHaveTextContent(STUDIO.leaveFailedQuestion));
    expect(screen.queryByText('Экзамен')).toBeNull();
    expect(api.updateItem).not.toHaveBeenCalled();
    // Escape is «Остаться».
    fireEvent.keyDown(ask() as HTMLElement, { key: 'Escape' });
    expect(ask()).toBeNull();
  });

  it('a link of the app\'s top line is held the same way; nothing unsaved — it goes at once', async () => {
    await openStudio();
    editQuestion2();
    fireEvent.click(screen.getByRole('link', { name: 'Лекции' }));
    expect(ask()).not.toBeNull();
    expect(screen.queryByText('Лекции страница')).toBeNull();
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveSave.go }));
    expect(await screen.findByText('Лекции страница')).toBeInTheDocument();
  });

  it('a link opened in a new tab or with a modifier is not held', async () => {
    await openStudio();
    editQuestion2();
    fireEvent.click(screen.getByRole('link', { name: 'Лекции' }), { ctrlKey: true });
    expect(ask()).toBeNull();
  });

  it('only the page waiting (its pause): the back arrow sends it now and goes without asking', async () => {
    await openStudio();
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
    expect(ask()).toBeNull();
    expect(api.saveTestDoc).toHaveBeenCalledTimes(1);
    expect(api.saveTestDoc.mock.calls[0][1].layout).toBe('pages');
  });

  it('the page that cannot be sent (no network): asked, «Тест не сохранён»', async () => {
    await openStudio();
    api.saveTestDoc.mockRejectedValue({ code: 'network' });
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleName(nb(STUDIO.leavePage));
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveSave.go }));
    await waitFor(() => expect(within(ask() as HTMLElement).getByRole('alert')).toHaveTextContent(STUDIO.leaveFailedPage('нет связи.')));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveDiscard }));
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
  });

  it('closing the tab: the browser asks while a question or the page waits, not when all is saved', async () => {
    await openStudio();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    editQuestion2();
    expect(unload()).toBe(true);
    fireEvent.click(saveAll());
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
    expect(unload()).toBe(false);
  });

  it('another view: «Список» waits for the answer; «Сохранить и перейти» saves the question first', async () => {
    await openStudio();
    editQuestion2();
    fireEvent.click(view(STUDIO.views.list));
    const dialog = ask() as HTMLElement;
    expect(within(dialog).getByRole('button', { name: STUDIO.leaveSave.view })).toBeInTheDocument();
    expect(document.querySelector('.st-page')).toHaveAttribute('data-view', 'canvas');
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveSave.view }));
    await waitFor(() => expect(document.querySelector('.st-page')).toHaveAttribute('data-view', 'list'));
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });

  it('inside «Холст»: another tab of the settings waits for the editor\'s own «Сохранить» / «Не сохранять»', async () => {
    await openStudio();
    editQuestion2();
    fireEvent.click(screen.getByRole('tab', { name: STUDIO.panels.design }));
    expect(screen.getByRole('tab', { name: STUDIO.panels.block })).toHaveAttribute('aria-selected', 'true');
    expect(within(side()).getByText(STUDIO.editorUnsaved(2))).toBeInTheDocument();
    fireEvent.click(within(side()).getByRole('button', { name: EDITOR.save }));
    await waitFor(() => expect(screen.getByRole('tab', { name: STUDIO.panels.design })).toHaveAttribute('aria-selected', 'true'));
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });
});

describe('«Отправить по ссылке» with a question not saved', () => {
  it('saves the question first, then opens the setup', async () => {
    await openStudio();
    editQuestion2();
    fireEvent.click(within(bar()).getByRole('button', { name: STUDIO.send }));
    expect(await screen.findByText('Настройка контрольной')).toBeInTheDocument();
    expect(api.updateItem).toHaveBeenCalledWith(uid(2), { stem: 'Согласие на медицинское вмешательство оформляется' });
  });

  it('a question that cannot be saved: asked; «Не сохранять» opens the setup without it', async () => {
    await openStudio();
    editQuestion2('');
    fireEvent.click(within(bar()).getByRole('button', { name: STUDIO.send }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: STUDIO.leaveSave.send })).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(STUDIO.leaveFailedQuestion);
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveDiscard }));
    expect(await screen.findByText('Настройка контрольной')).toBeInTheDocument();
    expect(api.updateItem).not.toHaveBeenCalled();
  });
});

describe('«Список»: its editor is the page\'s to save too', () => {
  it('a card\'s editor with changes: the status names it, the bar saves it, leaving asks', async () => {
    await openStudio();
    fireEvent.click(view(STUDIO.views.list));
    const card = await waitFor(() => {
      const button = document.querySelector<HTMLElement>(`[data-act="edit:${uid(1)}"]`);
      if (!button) throw new Error('no card yet');
      return button;
    });
    fireEvent.click(card);
    const field = await waitFor(() => {
      const node = document.querySelector<HTMLTextAreaElement>('.st-listview .qe-stem');
      if (!node) throw new Error('no editor yet');
      return node;
    });
    fireEvent.change(field, { target: { value: 'Срок хранения медицинской карты' } });
    expect(status()).toContain(STUDIO.questionUnsaved([1]));
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    expect(ask()).toHaveAccessibleName(nb(STUDIO.leaveQuestion([1])));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveStay }));
    fireEvent.click(saveAll());
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(uid(1), { stem: 'Срок хранения медицинской карты' }));
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
    // Saved: the card's editor closed as after its own «Сохранить».
    expect(document.querySelector('.st-listview .qe-stem')).toBeNull();
  });

  it('a new question being written: «Новый вопрос не сохранён»; leaving the view asks', async () => {
    await openStudio();
    fireEvent.click(view(STUDIO.views.list));
    await waitFor(() => expect(document.querySelector('.st-listview')).not.toBeNull());
    fireEvent.click(within(document.querySelector('[data-place="end"]') as HTMLElement).getByRole('button', { name: /Добавить вопрос/ }));
    fireEvent.click(await waitFor(() => within(document.querySelector('[data-place="end"]') as HTMLElement).getAllByRole('button')[1]));
    const field = await waitFor(() => {
      const node = document.querySelector<HTMLTextAreaElement>('.tb-newq .qe-stem');
      if (!node) throw new Error('no editor yet');
      return node;
    });
    fireEvent.change(field, { target: { value: 'Кто подписывает согласие?' } });
    expect(status()).toContain(STUDIO.questionUnsaved([null]));
    fireEvent.click(view(STUDIO.views.canvas));
    expect(ask()).toHaveAccessibleName(nb(STUDIO.leaveQuestion([null])));
  });
});

describe('the browser\'s «Назад» (BrowserRouter, as the app has it)', () => {
  it('is taken back and asked about; «Не сохранять» goes back after all', async () => {
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: storedDoc(), rev: 4, updated_at: '2026-11-04T10:00:00Z' });
    window.history.replaceState(null, '', `/exams/c/${EXAM}`);
    render(<BrowserRouter>{routes()}</BrowserRouter>);
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
    act(() => {
      window.history.pushState({ usr: null, key: 'studio', idx: 1 }, '', STUDIO_PATH);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    await screen.findByRole('group', { name: '1 из 3: Заголовок' });
    editQuestion2();
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await waitFor(() => expect(ask()).not.toBeNull());
    await waitFor(() => expect(window.location.pathname).toBe(STUDIO_PATH));
    expect(screen.queryByText('Экзамен')).toBeNull();
    await act(async () => {
      fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveDiscard }));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await waitFor(() => expect(window.location.pathname).toBe(`/exams/c/${EXAM}`));
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
    expect(api.updateItem).not.toHaveBeenCalled();
  });
});

describe('where the changes go: one quiet line on the canvas', () => {
  it('whereKind: a link «как в студии», only older links, or none; closed links do not count', () => {
    expect(whereKind([])).toBe('none');
    expect(whereKind([{ design: false, state: 'open' }])).toBe('plain');
    expect(whereKind([{ design: false, state: 'open' }, { design: true, state: 'not_yet' }])).toBe('design');
    expect(whereKind([{ design: true, state: 'closed' }])).toBe('none');
    expect(whereKind([{ design: true, state: 'closed' }, { design: false, state: 'open' }])).toBe('plain');
  });

  it.each([
    ['design', [{ design: true, state: 'open' }]],
    ['plain', [{ design: false, state: 'open' }]],
    ['none', []],
  ] as const)('%s', async (kind, rows) => {
    api.listQuizzes.mockResolvedValue(rows);
    await openStudio();
    expect(await screen.findByText(STUDIO.where[kind])).toBeInTheDocument();
    expect(api.listQuizzes).toHaveBeenCalledWith(EXAM);
  });

  it('the links not read (no network): no line rather than a guess', async () => {
    api.listQuizzes.mockRejectedValue({ code: 'network' });
    await openStudio();
    await act(async () => undefined);
    for (const kind of ['design', 'plain', 'none'] as const) expect(screen.queryByText(STUDIO.where[kind])).toBeNull();
  });

  it('«Понятно» puts it away for this exam on this device; not in «Список»', async () => {
    await openStudio();
    const line = await screen.findByText(STUDIO.where.none);
    fireEvent.click(view(STUDIO.views.list));
    await waitFor(() => expect(screen.queryByText(STUDIO.where.none)).toBeNull());
    fireEvent.click(view(STUDIO.views.canvas));
    expect(await screen.findByText(STUDIO.where.none)).toBe(line.isConnected ? line : screen.getByText(STUDIO.where.none));
    fireEvent.click(screen.getByRole('button', { name: STUDIO.whereOk }));
    expect(screen.queryByText(STUDIO.where.none)).toBeNull();
    cleanup();
    await openStudio();
    await act(async () => undefined);
    expect(screen.queryByText(STUDIO.where.none)).toBeNull();
  });
});

/** «Текст» with words typed after the page's own, not applied. */
async function typeText(extra: string) {
  fireEvent.click(view(STUDIO.views.text));
  const area = await waitFor(() => {
    const node = document.querySelector<HTMLTextAreaElement>('.st-textview textarea');
    if (!node) throw new Error('no text yet');
    return node;
  });
  fireEvent.change(area, { target: { value: `${area.value}\n\n${extra}` } });
  return area;
}
const savedTexts = () => api.saveTestDoc.mock.calls.flatMap((call) => (call[1] as TestDoc).blocks.filter((block) => block.type === 'text').map((block) => (block as { text: string }).text));

describe('«Текст» not applied is the page\'s too (review of 04.11)', () => {
  it('the status says «Текст не применён»; Ctrl+S applies it and the page is saved with it', async () => {
    await openStudio();
    await typeText('Новый абзац автора');
    expect(status()).toContain(STUDIO.textUnapplied);
    expect(saveAll()).toBeEnabled();
    expect(fireEvent.keyDown(document.querySelector('.st-textview textarea') as HTMLElement, { key: 's', code: 'KeyS', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(savedTexts()).toContain('Новый абзац автора'));
    await waitFor(() => expect(status()).toContain(STUDIO.allSaved));
  });

  it('leaving asks «Текст не применён»; «Применить и выйти» applies it, saves it, then goes', async () => {
    await openStudio();
    await typeText('Новый абзац автора');
    fireEvent.click(screen.getByRole('link', { name: 'Лекции' }));
    const dialog = ask() as HTMLElement;
    expect(dialog).toHaveAccessibleName(nb(STUDIO.textUnapplied));
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveApply.go }));
    expect(await screen.findByText('Лекции страница')).toBeInTheDocument();
    expect(savedTexts()).toContain('Новый абзац автора');
  });

  it('a text that cannot be applied as it is: the page stays, the question says so, the text lists its problem', async () => {
    await openStudio();
    await typeText('[картинка] Схема');
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveApply.go }));
    await waitFor(() => expect(within(ask() as HTMLElement).getByRole('alert')).toHaveTextContent(STUDIO.leaveFailedText));
    expect(screen.queryByText('Экзамен')).toBeNull();
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveStay }));
    expect(document.querySelector('.st-text-problems')).toHaveTextContent(/Строка \d+: новую картинку добавьте на холсте/);
    expect(status()).toContain(STUDIO.textUnapplied);
  });

  it('another view asks («Применить и перейти»); «Не сохранять» drops the text', async () => {
    await openStudio();
    await typeText('Новый абзац автора');
    fireEvent.click(view(STUDIO.views.canvas));
    const dialog = ask() as HTMLElement;
    expect(within(dialog).getByRole('button', { name: STUDIO.leaveApply.view })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveDiscard }));
    await waitFor(() => expect(document.querySelector('.st-page')).toHaveAttribute('data-view', 'canvas'));
    expect(screen.queryByText('Новый абзац автора')).toBeNull();
    expect(status()).toContain(STUDIO.allSaved);
  });

  it('«Отправить по ссылке» applies the text first', async () => {
    await openStudio();
    await typeText('Новый абзац автора');
    fireEvent.click(within(bar()).getByRole('button', { name: STUDIO.send }));
    expect(await screen.findByText('Настройка контрольной')).toBeInTheDocument();
    expect(savedTexts()).toContain('Новый абзац автора');
  });
});

describe('one save at a time, one way out at a time (review of 04.11)', () => {
  it('Ctrl+S and «Отправить по ссылке» at once: the second waits for the first, no «Не сохранено», one save', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.updateItem.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await openStudio();
    editQuestion2();
    fireEvent.keyDown(document.body, { key: 's', code: 'KeyS', ctrlKey: true });
    fireEvent.click(within(bar()).getByRole('button', { name: STUDIO.send }));
    await act(async () => undefined);
    expect(screen.queryByText(STUDIO.failed)).toBeNull();
    await act(async () => answer({ id: uid(2), rev: 2, rev_changed: false, doubts_resolved: 0 }));
    expect(await screen.findByText('Настройка контрольной')).toBeInTheDocument();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });

  it('while «Сохранить и выйти» saves, another way out is not taken and the answers stay waiting', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.updateItem.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await openStudio();
    editQuestion2();
    fireEvent.click(within(bar()).getByRole('link', { name: 'Аккредитация, полный тест' }));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveSave.go }));
    await waitFor(() => expect(ask()).toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(screen.getByRole('link', { name: 'Лекции' }));
    expect(ask()).toHaveAttribute('aria-busy', 'true');
    for (const button of within(ask() as HTMLElement).getAllByRole('button')) expect(button).toBeDisabled();
    await act(async () => answer({ id: uid(2), rev: 2, rev_changed: false, doubts_resolved: 0 }));
    // The first step goes: the exam, not «Лекции».
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
  });

  it('«Не сохранять» on the send question still sends the page first', async () => {
    await openStudio();
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    editQuestion2('');
    fireEvent.click(within(bar()).getByRole('button', { name: STUDIO.send }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.saveTestDoc).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveDiscard }));
    expect(await screen.findByText('Настройка контрольной')).toBeInTheDocument();
    expect(api.saveTestDoc).toHaveBeenCalledTimes(1);
    expect(api.saveTestDoc.mock.calls[0][1].layout).toBe('pages');
  });
});

describe('«Выйти» of the account menu asks too (lib/leaveCheck)', () => {
  it('with a question not saved: «Остаться» keeps the studio, «Не сохранять» lets the sign-out go; nothing held — at once', async () => {
    await expect(mayLeave()).resolves.toBe(true);
    await openStudio();
    await expect(mayLeave()).resolves.toBe(true);
    editQuestion2();
    let answered: boolean | null = null;
    void mayLeave().then((go) => (answered = go));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleName(nb(STUDIO.leaveQuestion([2])));
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.leaveStay }));
    await waitFor(() => expect(answered).toBe(false));
    void mayLeave().then((go) => (answered = go));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: STUDIO.leaveSave.go }));
    await waitFor(() => expect(answered).toBe(true));
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });
});

describe('the window narrows with a question not saved (a tablet turned)', () => {
  it('the settings move into the phone\'s sheet with the draft, and back into the column with it', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440);
    await openStudio();
    editQuestion2();
    act(() => {
      width.mockReturnValue(700);
      window.dispatchEvent(new Event('resize'));
    });
    const sheet = await screen.findByRole('dialog', { name: STUDIO.panelsLabel });
    expect(within(sheet).getByLabelText('Текст вопроса')).toHaveValue('Согласие на медицинское вмешательство оформляется');
    expect(status()).toContain(STUDIO.questionUnsaved([2]));
    act(() => {
      width.mockReturnValue(1440);
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(within(side()).getByLabelText('Текст вопроса')).toHaveValue('Согласие на медицинское вмешательство оформляется'));
    // «Не сохранять» of another view forgets the kept draft: back on the canvas, the question as it is.
    fireEvent.click(view(STUDIO.views.list));
    fireEvent.click(within(ask() as HTMLElement).getByRole('button', { name: STUDIO.leaveDiscard }));
    await waitFor(() => expect(document.querySelector('.st-page')).toHaveAttribute('data-view', 'list'));
    fireEvent.click(view(STUDIO.views.canvas));
    await waitFor(() => expect(document.querySelector('.st-page')).toHaveAttribute('data-view', 'canvas'));
    fireEvent.click(frame('qblock000001'));
    fireEvent.click(frame('qblock000002'));
    expect(within(side()).getByLabelText('Текст вопроса')).toHaveValue('Согласие на вмешательство оформляется');
    width.mockRestore();
  });
});

describe('the browser\'s «Назад» twice while only the page is being sent', () => {
  it('goes back once', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.saveTestDoc.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: storedDoc(), rev: 4, updated_at: '2026-11-04T10:00:00Z' });
    window.history.replaceState({ usr: null, key: 'lib', idx: 0 }, '', '/library');
    render(<BrowserRouter>{routes()}</BrowserRouter>);
    expect(await screen.findByText('Лекции страница')).toBeInTheDocument();
    act(() => {
      window.history.pushState({ usr: null, key: 'exam', idx: 1 }, '', `/exams/c/${EXAM}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    await screen.findByText('Экзамен');
    act(() => {
      window.history.pushState({ usr: null, key: 'studio', idx: 2 }, '', STUDIO_PATH);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    await screen.findByRole('group', { name: '1 из 3: Заголовок' });
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    for (let round = 0; round < 2; round += 1) {
      await act(async () => {
        window.history.back();
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
    }
    expect(ask()).toBeNull();
    await act(async () => {
      answer({ rev: 5, updated_at: '2026-11-04T10:00:01Z' });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await waitFor(() => expect(window.location.pathname).toBe(`/exams/c/${EXAM}`));
    expect(await screen.findByText('Экзамен')).toBeInTheDocument();
    expect(api.saveTestDoc).toHaveBeenCalledTimes(1);
  });
});

describe('the session ends while something waits (PrivateRoute closes the studio)', () => {
  it('nothing throws: the page change is sent, its refusal kept quiet, the guards let go', async () => {
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: storedDoc(), rev: 4, updated_at: '2026-11-04T10:00:00Z' });
    const view = render(<MemoryRouter initialEntries={[STUDIO_PATH]}>{routes()}</MemoryRouter>);
    await screen.findByRole('group', { name: '1 из 3: Заголовок' });
    api.saveTestDoc.mockRejectedValue({ code: '28000', message: 'not authenticated' });
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    editQuestion2();
    view.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(api.saveTestDoc).toHaveBeenCalledTimes(1);
    // Nothing holds the way out any more.
    await expect(mayLeave()).resolves.toBe(true);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});
