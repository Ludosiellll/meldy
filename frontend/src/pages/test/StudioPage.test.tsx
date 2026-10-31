import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerSummary, ItemInput } from '../../types/container';
import type { DocBlock, TestDoc } from '../../types/testDoc';

const api = vi.hoisted(() => ({
  addItems: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItems: vi.fn(),
  fetchTestDoc: vi.fn(),
  saveTestDoc: vi.fn(),
  reload: vi.fn(),
  user: null as { id: string } | null,
  state: { summary: null as unknown, items: null as unknown, loading: false, error: null as string | null, gone: false },
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
    data: api.state.summary ? { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 } : null,
    loading: api.state.loading,
    offline: false,
    unavailable: false,
    error: api.state.error,
    gone: api.state.gone,
    reload: api.reload,
  }),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: api.user, session: null, loading: false }) }));
// Release 49 part B: the canvas reads its questions' percents (test_item_percents); none here, and no fetch of its own.
vi.mock('../../api/quizzes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/quizzes')>()), itemPercents: vi.fn(async () => []) }));
// The tour asks the profile whether it was seen (UX audit of 21.10): not yet.
vi.mock('../../api/social', () => ({ getProfile: vi.fn(async () => ({ onboarding_status: {} })), markOnboardingTourSeen: vi.fn(async () => undefined) }));

import StudioPage from './StudioPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { STUDIO } from '../../components/studio/copyStudio';
import { PORT } from '../../components/port/copyPort';
import { tourKey } from '../../components/studio/Tour';
import { readableAccent } from '../../lib/studio/contrast';
import { DRAFT_WORDS } from '../../lib/studio/checker';
import { BLOCK_WORDS, emptyDoc, ruleMessage } from '../../lib/studio/doc';
import { TEMPLATES, templateSamples } from '../../lib/studio/templates';

const EXAM = '11111111-2222-4333-8444-555555555555';
const SUBJ = '22222222-3333-4444-8555-666666666666';
const uid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const base = { container_id: EXAM, subject_id: SUBJ, topic: null, key_source: 'manual' as const, images: null };
const Q1 = item({ ...base, id: uid(1), position: 1, file_no: '1', stem: 'Какой газ выделяется, когда цинк реагирует с соляной кислотой?', options: ['Кислород', 'Водород', 'Хлор'], correct: [1] });
const Q2 = item({ ...base, id: uid(2), position: 2, file_no: '2', kind: 'multiple', stem: 'Какие вещества — кислоты? Отметьте все верные.', options: ['HCl', 'NaOH', 'H₂SO₄'], correct: [0, 2] });
const Q3 = item({ ...base, id: uid(3), position: 3, file_no: '3', kind: 'short', stem: 'Как называется наименьшая частица элемента?', options: [], correct: [], answers: ['атом'] });
const ITEMS = [Q1, Q2, Q3];

const examSummary = (overrides: Partial<ContainerSummary> = {}): ContainerSummary =>
  summary({
    id: EXAM,
    title: 'Химия, 8 класс',
    exam_date: null,
    subjects: [subject({ id: SUBJ, title: 'Вопросы', exam_date: null, oral: null, topic_titles: [], topics: [], kinds: { single: 1, multiple: 1, short: 1 } })],
    owner: { members: 0, doubts_open: 0, links: [] },
    ...overrides,
  });

const question = (id: string, itemId: string, extra: Partial<DocBlock & { type: 'question' }> = {}): DocBlock => ({ type: 'question', id, item_id: itemId, points: 1, required: false, ...extra });

function storedDoc(): TestDoc {
  return {
    ...emptyDoc('Кислоты и основания'),
    layout: 'one_page',
    blocks: [
      { type: 'cover', id: 'cover0000001', title: 'Кислоты и основания', subtitle: 'Контрольная · 8 класс', image: null, align: 'center' },
      { type: 'heading', id: 'head00000001', text: 'Часть первая', size: 'l' },
      { type: 'text', id: 'text00000001', text: 'Ответьте на **все** вопросы.', align: 'left' },
      question('qblock000001', uid(1), { required: true }),
      question('qblock000002', uid(2)),
      question('qblock000003', uid(3)),
    ],
    results: {
      bands: [
        { from: 0, to: 49, title: 'Повторите тему', text: '', image: null },
        { from: 50, to: 100, title: 'Хорошо', text: 'Тема усвоена.', image: null },
      ],
      cta: { label: 'Следующая тема', url: 'https://chem8.ru/temy/oksidy' },
    },
  };
}

let newRow = 100;
const echoAdd = async (subjectId: string, inputs: ItemInput[]) => [
  {
    subject_id: subjectId,
    added: inputs.length,
    in_container: 10,
    items: inputs.map((input) => ({ ref: input.ref, id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(newRow++).padStart(12, '0')}`, position: newRow })),
  },
];

function renderStudio(path = `/exams/c/${EXAM}/studio`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/c/:id/studio" element={<StudioPage />} />
        <Route path="/exams/c/:id/quizzes/new" element={<p>Настройка контрольной</p>} />
        <Route path="/exams/c/:id" element={<p>Экзамен</p>} />
        <Route path="/exams" element={<p>Все экзамены</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The frames of the page's blocks, top to bottom (their block ids). */
const order = () => Array.from(document.querySelectorAll<HTMLElement>('.st-block')).map((node) => node.dataset.block);
const frame = (id: string) => document.querySelector<HTMLElement>(`[data-block="${id}"]`) as HTMLElement;
const lastSaved = (): TestDoc => api.saveTestDoc.mock.calls[api.saveTestDoc.mock.calls.length - 1][1] as TestDoc;
const side = () => screen.getByRole('complementary', { name: STUDIO.panelsLabel });
const keys = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);
const view = (name: string) => within(screen.getByRole('group', { name: STUDIO.viewsLabel })).getByRole('button', { name });

async function openStored(doc: TestDoc = storedDoc(), rev = 4) {
  api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev, updated_at: '2026-10-18T10:00:00Z' });
  renderStudio();
  await screen.findByRole('group', { name: '1 из 6: Обложка' });
}

beforeEach(() => {
  api.state.summary = examSummary();
  api.state.items = new Map(ITEMS.map((entry) => [entry.id, entry]));
  api.state.loading = false;
  api.state.error = null;
  api.state.gone = false;
  api.user = null;
  api.addItems.mockReset().mockImplementation(echoAdd);
  api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: false, doubts_resolved: 0 }));
  api.deleteItem.mockReset().mockResolvedValue(undefined);
  api.reorderItems.mockReset().mockResolvedValue(undefined);
  api.fetchTestDoc.mockReset();
  api.saveTestDoc.mockReset().mockImplementation(async (_id: string, _doc: TestDoc, rev: number) => ({ rev: rev + 1, updated_at: '2026-10-18T10:00:01Z' }));
  api.reload.mockReset();
});
afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});

describe('StudioPage: loading and saving (plan «Saving»)', () => {
  it('a new page: the exam’s name and its questions, saved first at revision 0, then «Сохранено»', async () => {
    api.fetchTestDoc.mockResolvedValue(null);
    renderStudio();
    expect(await screen.findByRole('group', { name: '1 из 3: Вопрос 1' })).toBeInTheDocument();
    expect(api.fetchTestDoc).toHaveBeenCalledWith(EXAM);
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [container, doc, rev] = api.saveTestDoc.mock.calls[0];
    expect([container, rev]).toEqual([EXAM, 0]);
    expect(doc.title).toBe('Химия, 8 класс');
    expect(doc.blocks.map((block: DocBlock) => (block.type === 'question' ? block.item_id : block.type))).toEqual([uid(1), uid(2), uid(3)]);
    expect(await screen.findByText(STUDIO.saved)).toBeInTheDocument();
  });

  it('an empty test shows the four starters; one press adds its questions, binds them and saves the page', async () => {
    api.state.items = new Map();
    api.fetchTestDoc.mockResolvedValue(null);
    renderStudio();
    expect(await screen.findByRole('heading', { name: STUDIO.emptyTitle })).toBeInTheDocument();
    for (const template of TEMPLATES) expect(screen.getByRole('button', { name: new RegExp(template.title) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STUDIO.pasteTest })).toBeInTheDocument();
    for (const type of Object.values(STUDIO.qtypes)) expect(screen.getAllByRole('button', { name: type }).length).toBeGreaterThan(0);
    // Nothing is saved for an untouched empty page.
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(api.saveTestDoc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(TEMPLATES[0].title) }));
    await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
    const [subjectId, inputs] = api.addItems.mock.calls[0];
    expect(subjectId).toBe(SUBJ);
    expect(inputs.map((input: ItemInput) => input.stem)).toEqual(templateSamples(TEMPLATES[0].id).map((sample) => sample.stem));
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalled(), { timeout: 3000 });
    const doc = lastSaved();
    const bound = doc.blocks.filter((block) => block.type === 'question').map((block) => (block.type === 'question' ? block.item_id : ''));
    expect(bound).toHaveLength(inputs.length);
    expect(bound.every((id) => id.startsWith('aaaaaaaa-'))).toBe(true);
    expect(doc.results.bands.length).toBeGreaterThan(0);
  });

  it('saves 800 ms after the last change, once for a word typed, over the revision it was read at', async () => {
    await openStored();
    fireEvent.click(screen.getByText('Часть первая'));
    const field = screen.getByRole('textbox', { name: STUDIO.types.heading });
    fireEvent.change(field, { target: { value: 'Часть первая: кислоты' } });
    fireEvent.change(field, { target: { value: 'Часть первая: кислоты и соли' } });
    expect(api.saveTestDoc).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.saveTestDoc).not.toHaveBeenCalled();
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(api.saveTestDoc.mock.calls[0][2]).toBe(4);
    expect(lastSaved().blocks[1]).toMatchObject({ type: 'heading', text: 'Часть первая: кислоты и соли' });
    // The next save goes over the new revision.
    fireEvent.change(field, { target: { value: 'Часть 1' } });
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(api.saveTestDoc.mock.calls[1][2]).toBe(5);
  });

  it('MC020: «Тест изменён в другой вкладке» with «Обновить»; nothing is overwritten, the other tab’s page comes in', async () => {
    await openStored();
    api.saveTestDoc.mockRejectedValueOnce({ code: 'MC020', detail: 'stale' });
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    expect((await screen.findAllByText(STUDIO.stale, { exact: false }, { timeout: 3000 })).length).toBeGreaterThan(0);
    const calls = api.saveTestDoc.mock.calls.length;
    // Further changes wait: the stale page is never sent again.
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.one_by_one }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(api.saveTestDoc.mock.calls.length).toBe(calls);

    const other = storedDoc();
    other.blocks[1] = { type: 'heading', id: 'head00000001', text: 'Из другой вкладки', size: 'l' };
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: other, rev: 9, updated_at: '' });
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: STUDIO.reload }));
    expect(await screen.findByText('Из другой вкладки')).toBeInTheDocument();
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    await waitFor(() => expect(api.saveTestDoc.mock.calls.length).toBe(calls + 1), { timeout: 3000 });
    expect(api.saveTestDoc.mock.calls[calls][2]).toBe(9);
  });

  it('no network: «Не сохранено — нет связи» and «Повторить»', async () => {
    await openStored();
    api.saveTestDoc.mockRejectedValueOnce({ code: 'network' });
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    expect(await screen.findByText(STUDIO.offline, {}, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STUDIO.retry }));
    expect(await screen.findByText(STUDIO.saved)).toBeInTheDocument();
    expect(lastSaved().layout).toBe('pages');
  });

  it('a page the check refuses is not sent: the rule’s words stand by the block', async () => {
    await openStored();
    fireEvent.click(screen.getByText('Часть первая'));
    const field = screen.getByRole('textbox', { name: STUDIO.types.heading });
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);
    expect(await screen.findByText(ruleMessage('block:1:text'), {}, { timeout: 3000 })).toBeInTheDocument();
    expect(api.saveTestDoc).not.toHaveBeenCalled();
    expect(screen.getByText(/^Не сохранено: Блок 2/)).toBeInTheDocument();
  });

  it('«Отправить по ссылке» saves first, then opens the quiz setup with every question «как в студии»', async () => {
    await openStored();
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.layouts.pages }));
    fireEvent.click(screen.getByRole('button', { name: STUDIO.send }));
    expect(await screen.findByText('Настройка контрольной')).toBeInTheDocument();
    expect(api.saveTestDoc).toHaveBeenCalled();
    expect(lastSaved().layout).toBe('pages');
  });
});

describe('StudioPage: undo, moving, inserting, removing (spec §47.6 «Холст»)', () => {
  it('Отменить / Повторить: the buttons, Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y', async () => {
    await openStored();
    const heading = () => document.querySelector('.dv-heading') as HTMLElement;
    fireEvent.click(frame('head00000001'));
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.sizes.m }));
    expect(heading()).toHaveClass('dv-heading-m');
    keys({ key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(heading()).toHaveClass('dv-heading-l');
    keys({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    expect(heading()).toHaveClass('dv-heading-m');
    fireEvent.click(screen.getByRole('button', { name: STUDIO.undo }));
    expect(heading()).toHaveClass('dv-heading-l');
    keys({ key: 'y', code: 'KeyY', ctrlKey: true });
    expect(heading()).toHaveClass('dv-heading-m');
    fireEvent.click(screen.getByRole('button', { name: STUDIO.undo }));
    expect(screen.getByRole('button', { name: STUDIO.undo })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: STUDIO.redo }));
    expect(heading()).toHaveClass('dv-heading-m');
  });

  it('drags a block with the keyboard: Space on the handle, ↓, Space (dnd-kit KeyboardSensor)', async () => {
    await openStored();
    const rect = (top: number, height: number) => ({ top, left: 0, width: 600, height, right: 600, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const original = Element.prototype.getBoundingClientRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const block = (this as HTMLElement).closest?.('.st-block') as HTMLElement | null;
      if (block && block === this) return rect(Number(block.dataset.index) * 120, 100);
      if ((this as HTMLElement).classList?.contains('st-gap-end')) return rect(6 * 120, 120);
      return original.call(this);
    });
    try {
      fireEvent.click(frame('cover0000001'));
      const handle = within(frame('cover0000001')).getByRole('button', { name: STUDIO.handle('Обложка') });
      handle.focus();
      fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      fireEvent.keyDown(document, { key: ' ', code: 'Space' });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(order().slice(0, 3)).toEqual(['head00000001', 'cover0000001', 'text00000001']);
    } finally {
      spy.mockRestore();
    }
  });

  it('Alt+↓ moves the block, Delete removes it, Ctrl+Z brings it back, Ctrl+D copies it', async () => {
    await openStored();
    const node = frame('head00000001');
    node.focus();
    fireEvent.keyDown(node, { key: 'ArrowDown', altKey: true });
    expect(order().slice(0, 3)).toEqual(['cover0000001', 'text00000001', 'head00000001']);
    fireEvent.keyDown(frame('head00000001'), { key: 'ArrowUp', altKey: true });
    expect(order().slice(0, 3)).toEqual(['cover0000001', 'head00000001', 'text00000001']);
    fireEvent.keyDown(frame('head00000001'), { key: 'Delete' });
    expect(order()).not.toContain('head00000001');
    keys({ key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(order().slice(0, 3)).toEqual(['cover0000001', 'head00000001', 'text00000001']);
    fireEvent.keyDown(frame('head00000001'), { key: 'd', ctrlKey: true });
    await waitFor(() => expect(screen.getAllByText('Часть первая')).toHaveLength(2));
    expect(order()).toHaveLength(7);
    // «Выше / Ниже» on the block's own bar do the same.
    fireEvent.click(within(frame('text00000001')).getByRole('button', { name: STUDIO.up }));
    expect(order().indexOf('text00000001')).toBe(2);
  });

  it('a palette block stands after the selected one; «+» between blocks opens the block menu', async () => {
    await openStored();
    fireEvent.click(frame('head00000001'));
    fireEvent.click(within(screen.getByRole('complementary', { name: STUDIO.palette })).getByRole('button', { name: STUDIO.types.note }));
    const ids = order();
    expect(ids).toHaveLength(7);
    const added = ids[2] as string;
    expect(frame(added)).toHaveAttribute('data-type', 'note');
    // It is selected and its words are being typed.
    expect(frame(added)).toHaveAttribute('data-selected');
    expect(screen.getByRole('textbox', { name: STUDIO.types.note })).toHaveValue('Заметка');

    // A gap's «+» is there under the mouse (and under the chosen block): the first gap, hovered.
    const firstGap = document.querySelector('.st-gap') as HTMLElement;
    fireEvent.pointerOver(firstGap, { pointerType: 'mouse' });
    const plus = within(firstGap).getByRole('button', { name: STUDIO.addHere });
    fireEvent.click(plus);
    const menu = await screen.findByRole('dialog', { name: STUDIO.blockMenu });
    fireEvent.change(within(menu).getByRole('combobox'), { target: { value: 'разд' } });
    fireEvent.keyDown(within(menu).getByRole('combobox'), { key: 'Enter' });
    expect(frame(order()[0] as string)).toHaveAttribute('data-type', 'divider');
  });

  it('every block type: a new one opens on its own first words selected whole, so typing replaces them (live check of 47.2)', async () => {
    const user = userEvent.setup();
    await openStored();
    const palette = () => within(screen.getByRole('complementary', { name: STUDIO.palette }));
    const add = async (name: string) => {
      fireEvent.click(frame('head00000001'));
      await user.click(palette().getByRole('button', { name }));
    };
    const selection = (field: HTMLElement) => [(field as HTMLTextAreaElement).selectionStart, (field as HTMLTextAreaElement).selectionEnd];
    // The new block stands after the heading (the selected one): the third on the page. The canvas's field, not the settings'.
    const onCanvas = () => within(frame(order()[2] as string));

    // Заголовок, Текст, Заметка: editing starts at once, on the block's word, all of it selected.
    for (const type of ['heading', 'text', 'note'] as const) {
      await add(STUDIO.types[type]);
      const field = onCanvas().getByRole('textbox', { name: STUDIO.types[type] });
      expect(field).toHaveFocus();
      expect(selection(field)).toEqual([0, BLOCK_WORDS[type].length]);
      await user.keyboard(`${STUDIO.types[type]} 47.3`);
      expect(field).toHaveValue(`${STUDIO.types[type]} 47.3`);
      await user.keyboard('{Escape}');
    }

    // Обложка: selected, not opened; a click on its title takes «Название теста» whole. Its line under the title is empty.
    await add(STUDIO.types.cover);
    await user.click(onCanvas().getByText(BLOCK_WORDS.cover));
    const title = onCanvas().getByRole('textbox', { name: STUDIO.coverTitle });
    expect(selection(title)).toEqual([0, BLOCK_WORDS.cover.length]);
    await user.keyboard('Проверка 47.3');
    expect(title).toHaveValue('Проверка 47.3');
    await user.keyboard('{Escape}');
    await user.click(onCanvas().getByText(STUDIO.subtitleAdd));
    const subtitle = onCanvas().getByRole('textbox', { name: STUDIO.coverSubtitle });
    expect(subtitle).toHaveValue('');
    await user.keyboard('Для 8 класса');
    expect(subtitle).toHaveValue('Для 8 класса');
    await user.keyboard('{Escape}');

    // Новая страница: its title starts empty, so the words typed are all there is.
    await add(STUDIO.types.page);
    const pageTitle = onCanvas().getByRole('textbox', { name: STUDIO.pageBlockTitle });
    expect(pageTitle).toHaveValue('');
    await user.keyboard('Часть 2');
    expect(pageTitle).toHaveValue('Часть 2');
    await user.keyboard('{Escape}');

    // Картинка: the caption starts empty too.
    await add(STUDIO.types.image);
    await user.click(onCanvas().getByText(STUDIO.captionAdd));
    const caption = onCanvas().getByRole('textbox', { name: STUDIO.caption });
    expect(caption).toHaveValue('');
    await user.keyboard('Цинк в кислоте');
    expect(caption).toHaveValue('Цинк в кислоте');
    await user.keyboard('{Escape}');

    // Разделитель: no words at all.
    await add(STUDIO.types.divider);
    expect(onCanvas().queryByRole('textbox')).toBeNull();

    // A question: Enter on its block opens its editor on «Новый вопрос», selected whole.
    fireEvent.click(frame('qblock000003'));
    await user.click(palette().getByRole('button', { name: STUDIO.qtypes.single }));
    await waitFor(() => expect(frame(order()[order().length - 1] as string)).toHaveAttribute('data-type', 'question'));
    const block = frame(order()[order().length - 1] as string);
    block.focus();
    fireEvent.keyDown(block, { key: 'Enter' });
    const stem = within(side()).getByLabelText('Текст вопроса') as HTMLTextAreaElement;
    await waitFor(() => expect(stem).toHaveFocus());
    expect(selection(stem)).toEqual([0, DRAFT_WORDS.stem.length]);
    // Some 80 keys typed through userEvent: 3–9 s on a busy shared machine (the base commit as slow as this one).
  }, 20000);

  it('«/» in an empty text block opens the block menu, and the chosen block takes its place', async () => {
    await openStored();
    fireEvent.click(screen.getByText(/вопросы\./));
    const field = screen.getByRole('textbox', { name: STUDIO.types.text });
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.keyDown(field, { key: '/' });
    const menu = await screen.findByRole('dialog', { name: STUDIO.blockMenu });
    fireEvent.click(within(menu).getByRole('option', { name: STUDIO.types.heading }));
    expect(order()).not.toContain('text00000001');
    expect(frame(order()[2] as string)).toHaveAttribute('data-type', 'heading');
  });

  it('a question asks before it goes; its row is deleted, and Ctrl+Z brings the question back as a new row', async () => {
    await openStored();
    const node = frame('qblock000001');
    node.focus();
    fireEvent.keyDown(node, { key: 'Delete' });
    const ask = screen.getByRole('alertdialog', { name: STUDIO.removeQuestion(1) });
    fireEvent.click(within(ask).getByRole('button', { name: STUDIO.removeYes }));
    expect(order()).not.toContain('qblock000001');
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(uid(1)));
    keys({ key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(order()).toContain('qblock000001');
    await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
    const [subjectId, inputs] = api.addItems.mock.calls[0];
    expect(subjectId).toBe(SUBJ);
    expect(inputs[0]).toMatchObject({ stem: Q1.stem, options: Q1.options, correct: Q1.correct });
    await waitFor(() => expect(screen.getByRole('group', { name: '4 из 6: Вопрос 1' })).toBeInTheDocument());
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalled(), { timeout: 3000 });
    const back = lastSaved().blocks.find((block) => block.id === 'qblock000001');
    expect(back && back.type === 'question' ? back.item_id : '').toMatch(/^aaaaaaaa-/);
  });

  it('«Оставить» keeps the question and its row', async () => {
    await openStored();
    fireEvent.click(frame('qblock000002'));
    fireEvent.click(within(frame('qblock000002')).getByRole('button', { name: STUDIO.remove }));
    fireEvent.click(screen.getByRole('button', { name: STUDIO.removeNo }));
    expect(order()).toContain('qblock000002');
    expect(api.deleteItem).not.toHaveBeenCalled();
  });

  it('a new question from the palette: its row first (a valid draft of that kind), then its block', async () => {
    await openStored();
    fireEvent.click(frame('qblock000003'));
    fireEvent.click(within(screen.getByRole('complementary', { name: STUDIO.palette })).getByRole('button', { name: STUDIO.qtypes.truefalse }));
    await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
    expect(api.addItems.mock.calls[0][1][0]).toMatchObject({ options: ['Верно', 'Неверно'], keep_order: true, kind: 'single' });
    await waitFor(() => expect(order()).toHaveLength(7));
    expect(frame(order()[6] as string)).toHaveAttribute('data-type', 'question');
    // The settings show the new question's editor.
    expect(within(side()).getByLabelText('Текст вопроса')).toHaveValue('Новое утверждение');
  });
});

describe('StudioPage: the settings (spec §47.6 «Справа — свойства»)', () => {
  it('a question: the release-47 editor saves into test_items; «Баллы» and «Обязательный» change the page', async () => {
    await openStored();
    fireEvent.click(frame('qblock000002'));
    const panel = side();
    fireEvent.click(within(panel).getByRole('button', { name: STUDIO.pointsMore }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: new RegExp(STUDIO.requiredLabel) }));
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalled(), { timeout: 3000 });
    expect(lastSaved().blocks[4]).toMatchObject({ points: 2, required: true });
    expect(within(frame('qblock000002')).getByText('2 балла')).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText('Текст вопроса'), { target: { value: 'Какие из веществ — кислоты? Отметьте все верные.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(uid(2), { stem: 'Какие из веществ — кислоты? Отметьте все верные.' }));
    expect(await within(frame('qblock000002')).findByText('Какие из веществ — кислоты? Отметьте все верные.')).toBeInTheDocument();
  });

  it('changes not saved in the question’s editor hold another block back until «Сохранить» or «Не сохранять»', async () => {
    await openStored();
    fireEvent.click(frame('qblock000002'));
    fireEvent.change(within(side()).getByLabelText('Текст вопроса'), { target: { value: 'Какие вещества — кислоты?' } });
    fireEvent.click(frame('head00000001'));
    expect(frame('qblock000002')).toHaveAttribute('data-selected');
    expect(within(side()).getByText(STUDIO.editorUnsaved(2))).toBeInTheDocument();
    fireEvent.click(within(side()).getByRole('button', { name: 'Не сохранять' }));
    expect(frame('head00000001')).toHaveAttribute('data-selected');
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it('a block’s own settings: a heading’s size, a note’s tone, a cover’s alignment', async () => {
    await openStored();
    fireEvent.click(frame('cover0000001'));
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.aligns.left }));
    expect(document.querySelector('.dv-cover')).toHaveAttribute('data-align', 'left');
    expect(within(side()).getAllByRole('button', { name: /Бумага|Клетка|Миллиметровка|Лён|Холмы в тумане|Грифельная доска/ })).toHaveLength(6);
    fireEvent.click(frame('text00000001'));
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.aligns.center }));
    expect(frame('text00000001').querySelector('.dv-on-bg')).toHaveAttribute('data-align', 'center');
  });

  it('nothing selected: the page’s name for the participants and how they go through it', async () => {
    await openStored();
    const name = within(side()).getByLabelText(STUDIO.pageTitle);
    fireEvent.change(name, { target: { value: 'Кислоты, основания, соли' } });
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalled(), { timeout: 3000 });
    expect(lastSaved().title).toBe('Кислоты, основания, соли');
  });

  it('«Оформление»: a ready theme in one press; an own colour nudged until it reads, and the author is told', async () => {
    await openStored();
    fireEvent.click(screen.getByRole('tab', { name: STUDIO.panels.design }));
    fireEvent.click(within(side()).getByRole('button', { name: /Строгая/ }));
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalled(), { timeout: 3000 });
    expect(lastSaved().theme).toMatchObject({ accent: 'graphite', radius: 'square', buttons: 'square' });

    const color = within(side()).getByLabelText(STUDIO.customColor);
    fireEvent.change(color, { target: { value: '#ffee00' } });
    expect(await within(side()).findByText(STUDIO.nudged)).toBeInTheDocument();
    const nudged = readableAccent('#ffee00', '#ffffff').color;
    expect(nudged).not.toBe('#ffee00');
    await waitFor(() => expect(lastSaved().theme.accent).toEqual({ custom: nudged }), { timeout: 3000 });
    // A colour that reads as it is says nothing.
    fireEvent.change(color, { target: { value: '#1f5bc6' } });
    expect(within(side()).queryByText(STUDIO.nudged)).toBeNull();
    // The answers as tiles.
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.answerViews.grid }));
    expect(document.querySelector('.st-doc')).toHaveAttribute('data-answers', 'grid');
  });

  it('«Результат»: overlapping ranges are said at once; «Ссылка дальше» shows its address', async () => {
    await openStored();
    fireEvent.click(screen.getByRole('tab', { name: STUDIO.panels.result }));
    const from = within(side()).getAllByLabelText(STUDIO.bandFrom);
    fireEvent.change(from[1], { target: { value: '40' } });
    expect(within(side()).getByText(STUDIO.bandOverlap('0–49 %', '40–100 %'))).toBeInTheDocument();
    expect(within(side()).getByText(STUDIO.ctaShown('chem8.ru/temy/oksidy'))).toBeInTheDocument();
    fireEvent.change(within(side()).getByLabelText(STUDIO.ctaUrl), { target: { value: 'http://chem8.ru' } });
    expect(within(side()).getByText(STUDIO.ctaBad)).toBeInTheDocument();
  });

  it('«Проверка теста»: what to mend, and «Исправить» mends it in one press', async () => {
    const tf = item({ ...base, id: uid(4), position: 4, file_no: '4', stem: 'Реакция нейтрализации — реакция кислоты с основанием.', options: ['Верно', 'Неверно'], correct: [0], keep_order: false });
    api.state.items = new Map([...ITEMS, tf].map((entry) => [entry.id, entry]));
    const doc = storedDoc();
    doc.blocks.push(question('qblock000004', uid(4)));
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 4, updated_at: '' });
    renderStudio();
    await screen.findByRole('group', { name: '1 из 7: Обложка' });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(STUDIO.check) }));
    const panel = side();
    expect(within(panel).getByText(/лучше не перемешивать/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: STUDIO.checkFix }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(uid(4), { keep_order: true }));
    expect(await within(panel).findByText(STUDIO.checkFixed)).toBeInTheDocument();
    expect(within(panel).queryByText(/лучше не перемешивать/)).toBeNull();
  });
});

describe('StudioPage: the views and the participant', () => {
  it('«Текст»: problems by line and nothing applied; then a new question is added and the page keeps it', async () => {
    await openStored();
    fireEvent.click(view(STUDIO.views.text));
    const area = screen.getByRole('textbox', { name: STUDIO.textLabel }) as HTMLTextAreaElement;
    expect(area.value).toContain('[обложка] Кислоты и основания');
    const text = area.value;
    fireEvent.change(area, { target: { value: `${text}\n# \n` } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    expect(screen.getByText(/^1\sошибка\. Исправьте, чтобы применить текст\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /пустой заголовок/ })).toHaveTextContent(/^Строка \d+:/);
    expect(api.addItems).not.toHaveBeenCalled();

    fireEvent.change(area, { target: { value: `${text}\nЧто такое оксид?\n+ Соединение элемента с кислородом\n- Соль\n` } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
    expect(api.addItems.mock.calls[0][1][0]).toMatchObject({ stem: 'Что такое оксид?', options: ['Соединение элемента с кислородом', 'Соль'], correct: [0] });
    expect(await screen.findByText(STUDIO.textApplied)).toBeInTheDocument();
    // Back on the canvas the question is there.
    fireEvent.click(view(STUDIO.views.canvas));
    expect(await screen.findByText('Что такое оксид?')).toBeInTheDocument();
  });

  it('«Текст»: questions left out of the text are deleted only after asking', async () => {
    await openStored();
    fireEvent.click(view(STUDIO.views.text));
    const area = screen.getByRole('textbox', { name: STUDIO.textLabel }) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: area.value.split('\n\nКак называется')[0] + '\n' } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    const ask = screen.getByRole('alertdialog', { name: STUDIO.textRemoves(1) });
    expect(api.deleteItem).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: STUDIO.textRemovesYes }));
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(uid(3)));
  });

  it('«Вставить готовый тест» opens «Текст» with an example of the marks', async () => {
    api.state.items = new Map();
    api.fetchTestDoc.mockResolvedValue(null);
    renderStudio();
    fireEvent.click(await screen.findByRole('button', { name: STUDIO.pasteTest }));
    expect((screen.getByRole('textbox', { name: STUDIO.textLabel }) as HTMLTextAreaElement).value).toBe(STUDIO.textExample);
  });

  it('«Список»: the constructor’s cards in the page’s order; «Ниже» moves the question on the page', async () => {
    await openStored();
    fireEvent.click(view(STUDIO.views.list));
    const cards = screen.getAllByRole('article');
    expect(cards.map((card) => card.querySelector('[data-act^="edit:"]')?.getAttribute('data-act'))).toEqual([`edit:${uid(1)}`, `edit:${uid(2)}`, `edit:${uid(3)}`]);
    fireEvent.click(document.querySelector(`[data-act="down:${uid(1)}"]`) as HTMLElement);
    fireEvent.click(view(STUDIO.views.canvas));
    expect(order().filter((id) => id?.startsWith('qblock'))).toEqual(['qblock000002', 'qblock000001', 'qblock000003']);
  });

  it('«Посмотреть как участник»: answered here, graded by the keys, the band and the link with its address; nothing sent', async () => {
    await openStored();
    await waitFor(() => expect(screen.queryByText(STUDIO.saving)).toBeNull());
    const saves = api.saveTestDoc.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: STUDIO.preview }));
    const dialog = screen.getByRole('dialog', { name: STUDIO.previewTitle });
    // The required first question is asked for: brought into view inside the frame, its head focused (as in the run).
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    fireEvent.click(within(dialog).getByRole('button', { name: /Завершить/ }));
    expect(within(dialog).getByText('Ответьте на обязательный вопрос: 1.')).toBeInTheDocument();
    const first = within(dialog).getByRole('region', { name: /Вопрос 1/ });
    expect(into.mock.contexts).toEqual([first]);
    into.mockRestore();
    expect(dialog.querySelector('.st-scroll')?.contains(first)).toBe(true);
    expect(document.activeElement).toBe(first.querySelector('.dv-q-head'));
    fireEvent.click(within(dialog).getByRole('radio', { name: /Водород/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /HCl/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /H₂SO₄/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Ваш ответ' }), { target: { value: ' Атом ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Завершить/ }));
    expect(await within(dialog).findByRole('heading', { name: /^100\s%$/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Хорошо')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Следующая тема/ })).toHaveAttribute('href', 'https://chem8.ru/temy/oksidy');
    expect(within(dialog).getByText('chem8.ru/temy/oksidy')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: STUDIO.previewAgain }));
    expect(within(dialog).getByRole('radio', { name: /Водород/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: STUDIO.previewTitle })).toBeNull();
    expect(api.saveTestDoc.mock.calls.length).toBe(saves);
  });

  it('400 blocks fit on a page: the questions beyond them are named, and they stay in «Список»', async () => {
    const doc = { ...emptyDoc('Длинный тест'), blocks: Array.from({ length: 399 }, (_, at) => ({ type: 'divider' as const, id: `divider${String(at).padStart(5, '0')}` })) };
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 2, updated_at: '' });
    renderStudio();
    expect(await screen.findByText(STUDIO.cap, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(order()).toHaveLength(400);
    fireEvent.click(view(STUDIO.views.list));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  }, 20000);

  it('the first visit’s tour: three steps on a computer, «Пропустить» ends it and it is not shown again', async () => {
    api.user = { id: 'user-7' };
    await openStored();
    const tour = await screen.findByRole('dialog', { name: STUDIO.tourLabel });
    // «Блоки» is left out on a computer: the palette's own line says it (UX audit of 21.10).
    expect(within(tour).getByText(STUDIO.tour[1].title)).toBeInTheDocument();
    expect(within(tour).getByText(STUDIO.tourStep(1, 3))).toBeInTheDocument();
    fireEvent.click(within(tour).getByRole('button', { name: STUDIO.tourNext }));
    expect(within(tour).getByText(STUDIO.tour[2].title)).toBeInTheDocument();
    // It never takes the focus from the page.
    expect(tour.contains(document.activeElement)).toBe(false);
    fireEvent.click(within(tour).getByRole('button', { name: STUDIO.tourSkip }));
    expect(screen.queryByRole('dialog', { name: STUDIO.tourLabel })).toBeNull();
    expect(window.localStorage.getItem(tourKey('user-7'))).toBe('1');
    cleanup();
    await openStored();
    expect(screen.queryByRole('dialog', { name: STUDIO.tourLabel })).toBeNull();
  });

  it('a test gone while its studio opens: the words name the test; an address of one never read says neutral words', async () => {
    api.state.summary = examSummary({ kind: 'test' });
    api.fetchTestDoc.mockRejectedValue({ code: 'P0002' });
    renderStudio();
    expect(await screen.findByText(/^Этого теста больше нет в вашем списке\./)).toBeInTheDocument();
    cleanup();
    api.state.summary = null;
    api.state.gone = true;
    renderStudio();
    expect(screen.getByText(/^Этой страницы больше нет в вашем списке\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Этого (экзамена|теста)/);
  });

  it('a member of the exam gets the author-only screen', async () => {
    api.state.summary = examSummary({ role: 'member', owner: null });
    api.fetchTestDoc.mockResolvedValue(null);
    renderStudio();
    expect(await screen.findByText(/автор/i)).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: STUDIO.palette })).toBeNull();
  });
});

describe('StudioPage: release 49 — the file out and questions in', () => {
  const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('«Скачать» sends the page’s questions in its order and numbers and shows what the file gets', async () => {
    const fetchMock = vi.fn(() => answer({ name: 'Химия (Moodle XML).xml', mime: 'application/xml', data: btoa('<quiz/>'), count: 3, total: 3, skipped: [], pictures_lost: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await openStored();
      fireEvent.click(screen.getByRole('button', { name: PORT.exportOpenLong }));
      const sheet = await screen.findByRole('dialog', { name: PORT.exportTitle });
      expect(await within(sheet).findByText(PORT.willGo(3, 3).replace(/\s+/g, ' '))).toBeTruthy();
      const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.format).toBe('moodle');
      expect(body.items.map((entry: { number: string; stem: string }) => [entry.number, entry.stem])).toEqual([['1', Q1.stem], ['2', Q2.stem], ['3', Q3.stem]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the palette’s «Сгенерировать…» opens the sheet; the ticked questions are added at the end of the page', async () => {
    const generated = { title: '', dropped: 0, items: [
      { stem: 'Что такое кислота?', options: ['Донор протонов', 'Акцептор протонов'], correct: [0], explanation: 'Из текста: «Кислота — донор протонов.»', quote: 'Кислота — донор протонов.', source_id: 'S01', checked: true },
    ] };
    const fetchMock = vi.fn(() => answer(generated));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await openStored();
      fireEvent.click(within(screen.getByRole('complementary', { name: STUDIO.palette })).getByRole('button', { name: PORT.generateOpen }));
      const sheet = await screen.findByRole('dialog', { name: PORT.generateTitle });
      fireEvent.change(within(sheet).getByLabelText(PORT.text), { target: { value: 'Кислота — донор протонов. '.repeat(20) } });
      fireEvent.click(within(sheet).getByRole('button', { name: PORT.run }));
      fireEvent.click(await within(sheet).findByRole('button', { name: (name: string) => name.replace(/\s+/g, ' ') === PORT.pick(1).replace(/\s+/g, ' ') }));
      await waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1));
      expect(api.addItems.mock.calls[0][1][0]).toMatchObject({ stem: 'Что такое кислота?', kind: 'single', correct: [0], explanation: 'Из текста: «Кислота — донор протонов.»' });
      await waitFor(() => expect(order()).toHaveLength(7));
      expect(frame(order()[6] as string)).toHaveAttribute('data-type', 'question');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('an empty test offers «Сгенерировать из лекции, текста или файла» among its starters', async () => {
    api.state.items = new Map();
    api.fetchTestDoc.mockResolvedValue(null);
    renderStudio();
    // the starters' pill and the palette's entry
    expect(await screen.findAllByRole('button', { name: PORT.generateOpen })).toHaveLength(2);
    expect(document.querySelector('.st-start')?.textContent).toContain(PORT.generateOpen);
  });
});
