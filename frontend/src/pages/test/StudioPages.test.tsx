import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerSummary, ItemInput, TestItem } from '../../types/container';
import type { DocBlock, TestDoc } from '../../types/testDoc';

/**
 * «Холст» one page at a time (owner, 2026-11-05: an exam of 960 questions, the canvas held 400): the bar over the page,
 * a block chosen elsewhere bringing its page, the question editor's changes holding a page back as another block, a full
 * page offering a new one, «Страница на каждый предмет», and the whole test saved and undone across the pages.
 * Made-up exams only.
 */

const api = vi.hoisted(() => ({
  addItems: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItems: vi.fn(),
  fetchTestDoc: vi.fn(),
  saveTestDoc: vi.fn(),
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
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));
vi.mock('../../api/quizzes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/quizzes')>()), itemPercents: vi.fn(async () => []), listQuizzes: vi.fn(async () => []) }));

import StudioPage from './StudioPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { STUDIO } from '../../components/studio/copyStudio';
import { SAVE_DELAY } from '../../components/studio/useStudio';
import { emptyDoc } from '../../lib/studio/doc';

const EXAM = '31111111-2222-4333-8444-555555555555';
const SUBJECTS = [
  { id: '32222222-3333-4444-8555-000000000001', title: 'Анатомия' },
  { id: '32222222-3333-4444-8555-000000000002', title: 'Физиология' },
  { id: '32222222-3333-4444-8555-000000000003', title: 'Гигиена' },
];
const uid = (s: number, n: number) => `c${s}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Three subjects of four questions; the third question of «Гигиена» has no key. */
const ITEMS: TestItem[] = SUBJECTS.flatMap((entry, s) =>
  Array.from({ length: 4 }, (_, at) =>
    item({ id: uid(s + 1, at + 1), container_id: EXAM, subject_id: entry.id, topic: null, key_source: 'manual', images: null, position: at + 1, file_no: String(at + 1),
           stem: `${entry.title}, вопрос ${at + 1}?`, options: ['Азот', 'Кислород', 'Аргон'], correct: s === 2 && at === 2 ? [] : [0] }),
  ),
);
const examSummary = (): ContainerSummary =>
  summary({
    id: EXAM,
    title: 'Итоговый экзамен',
    exam_date: null,
    subjects: SUBJECTS.map((entry) => subject({ id: entry.id, title: entry.title, exam_date: null, oral: null, topic_titles: [], topics: [], kinds: { single: 4, multiple: 0, short: 0 } })),
    owner: { members: 0, doubts_open: 0, links: [] },
  });

const q = (s: number, n: number): DocBlock => ({ type: 'question', id: `qb${s}${String(n).padStart(9, '0')}`, item_id: uid(s, n), points: 1, required: false });
const pageBlock = (s: number, title: string): DocBlock => ({ type: 'page', id: `pagesubj${s}0000`, title });
/** The exam's questions a subject a page, as the studio lays them out. */
function pagedDoc(): TestDoc {
  return {
    ...emptyDoc('Итоговый экзамен'),
    layout: 'pages',
    blocks: [
      { type: 'heading', id: 'headintro001', text: 'Итоговый экзамен', size: 'l' },
      ...[1, 2, 3, 4].map((n) => q(1, n)),
      pageBlock(2, 'Физиология'),
      ...[1, 2, 3, 4].map((n) => q(2, n)),
      pageBlock(3, 'Гигиена'),
      ...[1, 2, 3, 4].map((n) => q(3, n)),
    ],
  };
}

let newRow = 500;
const echoAdd = async (subjectId: string, inputs: ItemInput[]) => [
  { subject_id: subjectId, added: inputs.length, in_container: 20, items: inputs.map((input) => ({ ref: input.ref, id: `abababab-bbbb-4ccc-8ddd-${String(newRow++).padStart(12, '0')}`, position: newRow })) },
];

function renderStudio(path = `/exams/c/${EXAM}/studio`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/c/:id/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
async function open(doc: TestDoc = pagedDoc(), path?: string) {
  api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 3, updated_at: '2026-11-05T08:00:00Z' });
  renderStudio(path);
  return screen.findByRole('navigation', { name: STUDIO.pagesNav }, { timeout: 5000 });
}
const order = () => Array.from(document.querySelectorAll<HTMLElement>('.st-block')).map((node) => node.dataset.block as string);
const frame = (id: string) => document.querySelector<HTMLElement>(`[data-block="${id}"]`) as HTMLElement;
const side = () => screen.getByRole('complementary', { name: STUDIO.panelsLabel });
const nav = () => screen.getByRole('navigation', { name: STUDIO.pagesNav });
const lastSaved = (): TestDoc => api.saveTestDoc.mock.calls[api.saveTestDoc.mock.calls.length - 1][1] as TestDoc;

beforeEach(() => {
  api.state.summary = examSummary();
  api.state.items = new Map(ITEMS.map((entry) => [entry.id, entry]));
  api.addItems.mockReset().mockImplementation(echoAdd);
  api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: false, doubts_resolved: 0 }));
  api.deleteItem.mockReset().mockResolvedValue(undefined);
  api.reorderItems.mockReset().mockResolvedValue(undefined);
  api.fetchTestDoc.mockReset();
  api.saveTestDoc.mockReset().mockImplementation(async (_id: string, _doc: TestDoc, rev: number) => ({ rev: rev + 1, updated_at: '2026-11-05T08:00:01Z' }));
});
afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});

describe('«Холст»: one page at a time', () => {
  it('the bar: «Страница 1 из 3», forward, back, and a jump by the list of pages (titles and questions)', async () => {
    await open();
    expect(nav()).toHaveTextContent(STUDIO.pageOf(1, 3));
    expect(order()).toEqual(['headintro001', ...[1, 2, 3, 4].map((n) => q(1, n).id)]);
    expect(within(nav()).getByRole('button', { name: STUDIO.pagePrev })).toBeDisabled();
    fireEvent.click(within(nav()).getByRole('button', { name: STUDIO.pageNext }));
    expect(nav()).toHaveTextContent(`${STUDIO.pageOf(2, 3)}Физиология`);
    // The page's «Новая страница» stands at its top, named «Страница 2», with no gap above it.
    expect(order()[0]).toBe('pagesubj20000');
    expect(within(frame('pagesubj20000')).getByText(STUDIO.pageMark(2))).toBeInTheDocument();
    expect(frame('pagesubj20000').previousElementSibling).toBeNull();
    const options = within(nav()).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([
      STUDIO.pageOption(1, '', 'вопросы 1–4'),
      STUDIO.pageOption(2, 'Физиология', 'вопросы 5–8'),
      STUDIO.pageOption(3, 'Гигиена', 'вопросы 9–12'),
    ]);
    fireEvent.change(within(nav()).getByRole('combobox'), { target: { value: '2' } });
    expect(nav()).toHaveTextContent(STUDIO.pageOf(3, 3));
    expect(within(nav()).getByRole('button', { name: STUDIO.pageNext })).toBeDisabled();
    // Under the page's last block: back to the page before.
    fireEvent.click(screen.getByRole('button', { name: STUDIO.pageBack(2) }));
    expect(nav()).toHaveTextContent(STUDIO.pageOf(2, 3));
    // The questions keep their numbers over the whole test.
    expect(within(frame(q(2, 1).id)).getByText('Вопрос 5')).toBeInTheDocument();
  });

  it('a block chosen elsewhere brings its page: «Показать» of «Проверка теста», ↑ ↓ past the edge, a link to it', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(STUDIO.check) }));
    const check = within(side());
    // The question of «Гигиена» without a key, on the third page.
    fireEvent.click(check.getAllByRole('button', { name: STUDIO.checkShow })[0]);
    await waitFor(() => expect(nav()).toHaveTextContent(STUDIO.pageOf(3, 3)));
    expect(frame(q(3, 3).id)).toHaveAttribute('data-selected');

    // ↑ from the first block of the page: the last block of the page before.
    fireEvent.click(frame('pagesubj30000'));
    fireEvent.keyDown(frame('pagesubj30000'), { key: 'ArrowUp' });
    await waitFor(() => expect(nav()).toHaveTextContent(STUDIO.pageOf(2, 3)));
    expect(frame(q(2, 4).id)).toHaveAttribute('data-selected');
    await waitFor(() => expect(frame(q(2, 4).id)).toHaveFocus());
    cleanup();

    // A link to a block opens on its page.
    await open(pagedDoc(), `/exams/c/${EXAM}/studio?block=${q(3, 2).id}`);
    await waitFor(() => expect(nav()).toHaveTextContent(STUDIO.pageOf(3, 3)));
    expect(frame(q(3, 2).id)).toHaveAttribute('data-selected');
  });

  it('a question editor with changes holds another page back, as another block: «Не сохранять» goes on', async () => {
    await open();
    fireEvent.click(frame(q(1, 2).id));
    fireEvent.change(within(side()).getByLabelText('Текст вопроса'), { target: { value: 'Анатомия, вопрос второй?' } });
    fireEvent.click(within(nav()).getByRole('button', { name: STUDIO.pageNext }));
    expect(nav()).toHaveTextContent(STUDIO.pageOf(1, 3));
    expect(within(side()).getByText(STUDIO.editorUnsaved(2))).toBeInTheDocument();
    fireEvent.click(within(side()).getByRole('button', { name: 'Не сохранять' }));
    expect(nav()).toHaveTextContent(STUDIO.pageOf(2, 3));
    // Nothing chosen on the new page: the settings are the page's own.
    expect(within(side()).getByText(STUDIO.nothingSelected)).toBeInTheDocument();
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it('Alt+↓ over a page break takes the block to the next page, and the canvas with it; Ctrl+Z brings both back', async () => {
    await open();
    fireEvent.click(frame(q(1, 4).id));
    fireEvent.keyDown(frame(q(1, 4).id), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(nav()).toHaveTextContent(STUDIO.pageOf(2, 3)));
    expect(order().slice(0, 2)).toEqual(['pagesubj20000', q(1, 4).id]);
    // The whole test is saved, every page of it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY + 100));
    });
    await waitFor(() => expect(api.saveTestDoc).toHaveBeenCalled());
    const moved = pagedDoc().blocks.map((block) => block.id).filter((id) => id !== q(1, 4).id);
    moved.splice(moved.indexOf('pagesubj20000') + 1, 0, q(1, 4).id);
    expect(lastSaved().blocks.map((block) => block.id)).toEqual(moved);
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(nav()).toHaveTextContent(STUDIO.pageOf(1, 3)));
    expect(order()[order().length - 1]).toBe(q(1, 4).id);
  });

  it('«Страница на каждый предмет»: a break before each subject, nothing moved; one step of Ctrl+Z', async () => {
    const flat: TestDoc = { ...pagedDoc(), blocks: pagedDoc().blocks.filter((block) => block.type !== 'page') };
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: flat, rev: 3, updated_at: '' });
    renderStudio();
    await screen.findByRole('group', { name: '1 из 13: Заголовок' });
    expect(screen.queryByRole('navigation', { name: STUDIO.pagesNav })).toBeNull();
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.bySubject }));
    expect(nav()).toHaveTextContent(STUDIO.pageOf(1, 3));
    expect(within(side()).getByText(STUDIO.bySubjectDone(2))).toBeInTheDocument();
    fireEvent.click(within(nav()).getByRole('button', { name: STUDIO.pageNext }));
    expect(within(nav()).getByRole('combobox')).toHaveDisplayValue(STUDIO.pageOption(2, 'Физиология', 'вопросы 5–8'));
    // Pressed again: nothing to add.
    fireEvent.click(within(side()).getByRole('button', { name: STUDIO.bySubject }));
    expect(within(side()).getByText(STUDIO.bySubjectDone(0))).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('navigation', { name: STUDIO.pagesNav })).toBeNull());
    expect(order()).toEqual(flat.blocks.map((block) => block.id));
  });

  it('a move or a removed «Новая страница» that would make a page pass 400 blocks does not happen, and says why', async () => {
    const blocks: DocBlock[] = [
      ...Array.from({ length: 400 }, (_, at): DocBlock => ({ type: 'divider', id: `divider${String(at).padStart(5, '0')}` })),
      { type: 'page', id: 'pagesecond01', title: 'Вторая' },
      ...[1, 2, 3].flatMap((s) => [1, 2, 3, 4].map((n) => q(s, n))),
    ];
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: { ...emptyDoc('Итоговый экзамен'), blocks }, rev: 3, updated_at: '' });
    renderStudio();
    const bar = await screen.findByRole('navigation', { name: STUDIO.pagesNav }, { timeout: 5000 });
    fireEvent.click(within(bar).getByRole('button', { name: STUDIO.pageNext }));
    // Alt+↑ on the first block after the page break: the first page is full.
    fireEvent.click(frame(q(1, 1).id));
    fireEvent.keyDown(frame(q(1, 1).id), { key: 'ArrowUp', altKey: true });
    expect(screen.getByText(STUDIO.pageMoveFull)).toBeInTheDocument();
    expect(nav()).toHaveTextContent(STUDIO.pageOf(2, 2));
    expect(order()[1]).toBe(q(1, 1).id);
    // Delete on the page break: the two pages together would hold 413 blocks.
    fireEvent.click(frame('pagesecond01'));
    fireEvent.keyDown(frame('pagesecond01'), { key: 'Delete' });
    expect(screen.getByText(STUDIO.pageJoinFull)).toBeInTheDocument();
    expect(frame('pagesecond01')).toHaveAttribute('data-selected');
    fireEvent.click(screen.getByRole('button', { name: STUDIO.pageFullClose }));
    expect(screen.queryByText(STUDIO.pageJoinFull)).toBeNull();
  }, 20000);

  it('a full page: a block added to it waits, «Начать новую страницу» opens one after it and shows it', async () => {
    const full: TestDoc = {
      ...emptyDoc('Итоговый экзамен'),
      blocks: [...Array.from({ length: 400 - 12 }, (_, at): DocBlock => ({ type: 'divider', id: `divider${String(at).padStart(5, '0')}` })), ...[1, 2, 3].flatMap((s) => [1, 2, 3, 4].map((n) => q(s, n)))],
    };
    api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc: full, rev: 3, updated_at: '' });
    renderStudio();
    await screen.findByRole('group', { name: '1 из 400: Разделитель' }, { timeout: 5000 });
    fireEvent.click(frame('divider00000'));
    fireEvent.click(within(screen.getByRole('complementary', { name: STUDIO.palette })).getByRole('button', { name: STUDIO.types.heading }));
    const offer = await screen.findByText(STUDIO.pageFull);
    expect(order()).toHaveLength(400);
    fireEvent.click(within(offer.parentElement as HTMLElement).getByRole('button', { name: STUDIO.pageFullNew }));
    // The new page after the full one: shown, its «Новая страница» chosen, the offer gone.
    expect(nav()).toHaveTextContent(STUDIO.pageOf(2, 2));
    expect(order()).toHaveLength(1);
    expect(frame(order()[0])).toHaveAttribute('data-type', 'page');
    expect(frame(order()[0])).toHaveAttribute('data-selected');
    expect(screen.queryByText(STUDIO.pageFull)).toBeNull();
    // Now the heading goes on it.
    fireEvent.click(within(screen.getByRole('complementary', { name: STUDIO.palette })).getByRole('button', { name: STUDIO.types.heading }));
    expect(order()).toHaveLength(2);
    expect(frame(order()[1])).toHaveAttribute('data-type', 'heading');
  }, 20000);
});
