import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestItem } from '../../types/container';
import type { TestDoc } from '../../types/testDoc';

/**
 * The studio on a phone and a tablet (phone audit of 19.10): the bottom bar from 360 to 1023 px, gone while a field
 * takes the keyboard; a block added from «Блоки» brought into the middle; the names of the block's bar; «Вернуть» after
 * a removal; «Проверка теста» in its own sheet; the words of a short answer. StudioPage with its data mocked as in
 * StudioPage.test.tsx; the page's width is the frame's (clientWidth).
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

import StudioPage from './StudioPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { KEYS } from '../../components/containers/copyImport';
import { STUDIO } from '../../components/studio/copyStudio';
import { hintFor } from '../../components/studio/Workspace';
import { DRAFT_WORDS } from '../../lib/studio/checker';
import { emptyDoc } from '../../lib/studio/doc';

const EXAM = '11111111-2222-4333-8444-555555555555';
const SUBJ = '22222222-3333-4444-8555-666666666666';
const base = { container_id: EXAM, subject_id: SUBJ, topic: null, key_source: 'manual' as const, images: null };
const Q1 = item({ ...base, id: 'c0000000-0000-4000-8000-000000000001', position: 1, file_no: '1', stem: 'Столица Франции?', options: ['Париж', 'Лион'], correct: [0] });

function storedDoc(): TestDoc {
  return {
    ...emptyDoc('Телефон'),
    layout: 'one_page',
    blocks: [
      { type: 'cover', id: 'cover0000001', title: 'Телефон', subtitle: '', image: null, align: 'center' },
      { type: 'heading', id: 'head00000001', text: 'Часть первая', size: 'l' },
      { type: 'text', id: 'text00000001', text: 'Ответьте на вопросы.', align: 'left' },
      { type: 'question', id: 'qblock000001', item_id: Q1.id, points: 1, required: false },
    ],
  };
}

const order = () => Array.from(document.querySelectorAll<HTMLElement>('.st-block')).map((node) => node.dataset.block as string);
const frame = (id: string) => document.querySelector<HTMLElement>(`[data-block="${id}"]`) as HTMLElement;
const bar = () => document.querySelector<HTMLElement>('.st-phonebar');
const notice = () => document.querySelector('.st-page > p.sr-only[role="status"]') as HTMLElement;

/** The page frame is `width` px wide (useFrame measures clientWidth). */
function widthIs(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
}

async function openStored(doc: TestDoc = storedDoc()) {
  api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 3, updated_at: '2026-10-19T08:00:00Z' });
  render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/studio`]}>
      <Routes>
        <Route path="/exams/c/:id/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('group', { name: `1 из ${doc.blocks.length}: Обложка` });
}

beforeEach(() => {
  api.state.summary = summary({
    id: EXAM,
    title: 'Телефон',
    exam_date: null,
    subjects: [subject({ id: SUBJ, title: 'Вопросы', exam_date: null, oral: null, topic_titles: [], topics: [], kinds: { single: 1, multiple: 0, short: 0 } })],
    owner: { members: 0, doubts_open: 0, links: [] },
  });
  api.state.items = new Map([[Q1.id, Q1]]);
  api.fetchTestDoc.mockReset();
  api.saveTestDoc.mockReset().mockImplementation(async (_id: string, _doc: TestDoc, rev: number) => ({ rev: rev + 1, updated_at: '2026-10-19T08:00:01Z' }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the bottom bar', () => {
  it('a phone of 360 px: «Блоки», «Настройки» and «Отправить» (its name whole)', async () => {
    widthIs(360);
    await openStored();
    const here = within(bar() as HTMLElement);
    expect(here.getByRole('button', { name: STUDIO.palette })).toBeInTheDocument();
    expect(here.getByRole('button', { name: STUDIO.panelsLabel })).toBeInTheDocument();
    const send = here.getByRole('button', { name: STUDIO.send });
    expect(send).toHaveTextContent(new RegExp(`^${STUDIO.sendShort}$`));
    expect(bar()).toBeVisible();
  });

  it('a tablet (768 px, an iPad upright or a phone on its side): the same bar, the button’s whole words, no columns', async () => {
    widthIs(768);
    await openStored();
    const here = within(bar() as HTMLElement);
    expect(here.getByRole('button', { name: STUDIO.palette })).toBeInTheDocument();
    expect(here.getByRole('button', { name: STUDIO.panelsLabel })).toBeInTheDocument();
    expect(here.getByRole('button', { name: STUDIO.send })).toHaveTextContent(STUDIO.send);
    expect(screen.queryByRole('complementary', { name: STUDIO.palette })).toBeNull();
    expect(document.querySelector('.st-page')).toHaveAttribute('data-frame', 'm');
  });

  it('a computer (1024 px and wider): the columns, no bottom bar', async () => {
    await openStored();
    expect(bar()).toBeNull();
    expect(screen.getByRole('complementary', { name: STUDIO.palette })).toBeInTheDocument();
  });

  it('steps away while a text of the page is typed in, and comes back when typing ends', async () => {
    widthIs(375);
    await openStored();
    fireEvent.click(screen.getByText('Часть первая'));
    const field = screen.getByRole('textbox', { name: STUDIO.types.heading });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await waitFor(() => expect(bar()).not.toBeVisible());
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(bar()).toBeVisible());
    // A block taking the focus (chosen, not typed in) leaves the bar where it is.
    act(() => frame('text00000001').focus());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.activeElement).toBe(frame('text00000001'));
    expect(bar()).toBeVisible();
  });

  it('in «Текст» the same: the bar goes while the text is typed in', async () => {
    widthIs(390);
    await openStored();
    fireEvent.click(within(screen.getByRole('group', { name: STUDIO.viewsLabel })).getByRole('button', { name: STUDIO.views.text }));
    const area = screen.getByRole('textbox', { name: STUDIO.textLabel });
    act(() => area.focus());
    await waitFor(() => expect(bar()).not.toBeVisible());
    act(() => area.blur());
    await waitFor(() => expect(bar()).toBeVisible());
  });
});

describe('a block added from «Блоки» on a phone', () => {
  it('is brought to the middle of the screen (it stood under the bar), selected and typed in', async () => {
    widthIs(375);
    await openStored();
    fireEvent.click(frame('text00000001'));
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    fireEvent.click(within(bar() as HTMLElement).getByRole('button', { name: STUDIO.palette }));
    const sheet = screen.getByRole('dialog', { name: STUDIO.palette });
    fireEvent.click(within(sheet).getByRole('button', { name: STUDIO.types.heading }));
    expect(screen.queryByRole('dialog', { name: STUDIO.palette })).toBeNull();
    const added = order()[3];
    expect(frame(added)).toHaveAttribute('data-type', 'heading');
    expect(frame(added)).toHaveAttribute('data-selected');
    const centered = into.mock.calls.findIndex(([how]) => (how as ScrollIntoViewOptions | undefined)?.block === 'center');
    expect(centered).toBeGreaterThanOrEqual(0);
    expect(into.mock.contexts[centered]).toBe(frame(added));
    await waitFor(() => expect(document.activeElement).toBe(within(frame(added)).getByRole('textbox', { name: STUDIO.types.heading })));
  });
});

describe('a video block added on a phone', () => {
  it('does not take the focus (no keyboard, no iOS zoom); it is brought into the middle instead', async () => {
    widthIs(375);
    await openStored();
    fireEvent.click(frame('text00000001'));
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    fireEvent.click(within(bar() as HTMLElement).getByRole('button', { name: STUDIO.palette }));
    fireEvent.click(within(screen.getByRole('dialog', { name: STUDIO.palette })).getByRole('button', { name: STUDIO.types.video }));
    const added = order()[3];
    expect(frame(added)).toHaveAttribute('data-type', 'video');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(frame(added)).getByRole('textbox', { name: STUDIO.videoEmpty })).not.toHaveFocus();
    expect(into.mock.contexts).toContain(frame(added));
    expect(bar()).toBeVisible();
  });
});

describe('the block’s bar on a phone', () => {
  it('names its buttons «Настройки блока», «Копия», «Удалить» (not «Ctrl+D», «Delete», nothing)', async () => {
    widthIs(360);
    await openStored();
    fireEvent.click(frame('head00000001'));
    const tools = within(within(frame('head00000001')).getByRole('toolbar'));
    expect(tools.getByRole('button', { name: STUDIO.blockSettings })).toBeInTheDocument();
    expect(tools.getByRole('button', { name: STUDIO.copy })).toBeInTheDocument();
    expect(tools.getByRole('button', { name: STUDIO.remove })).toBeInTheDocument();
    expect(tools.queryByRole('button', { name: 'Ctrl+D' })).toBeNull();
    expect(tools.queryByRole('button', { name: 'Delete' })).toBeNull();
    for (const button of tools.getAllByRole('button')) expect(button).toHaveAccessibleName();
  });

  it('a removal: «Вернуть» on the screen brings the block back; no Ctrl+Z is read out', async () => {
    widthIs(360);
    await openStored();
    fireEvent.click(frame('head00000001'));
    fireEvent.click(within(within(frame('head00000001')).getByRole('toolbar')).getByRole('button', { name: STUDIO.remove }));
    expect(order()).not.toContain('head00000001');
    const toast = document.querySelector('.st-toast') as HTMLElement;
    expect(toast).toHaveTextContent(STUDIO.removed(STUDIO.types.heading, true));
    await waitFor(() => expect(notice()).toHaveTextContent(STUDIO.removed(STUDIO.types.heading, true)));
    expect(notice()).not.toHaveTextContent(/Ctrl/);
    fireEvent.click(within(toast).getByRole('button', { name: STUDIO.undoRemove }));
    expect(order()).toEqual(['cover0000001', 'head00000001', 'text00000001', 'qblock000001']);
    expect(document.querySelector('.st-toast')).toBeNull();
  });

  it('«Вернуть» goes away once the page changes again (it would undo something else)', async () => {
    widthIs(360);
    await openStored();
    fireEvent.click(frame('head00000001'));
    fireEvent.click(within(within(frame('head00000001')).getByRole('toolbar')).getByRole('button', { name: STUDIO.remove }));
    expect(document.querySelector('.st-toast')).not.toBeNull();
    fireEvent.click(within(within(frame('text00000001')).getByRole('toolbar')).getByRole('button', { name: STUDIO.down }));
    await waitFor(() => expect(document.querySelector('.st-toast')).toBeNull());
  });

  it('a computer keeps the keys in the words read out, and shows no «Вернуть»', async () => {
    await openStored();
    fireEvent.keyDown(frame('head00000001'), { key: 'Delete' });
    await waitFor(() => expect(notice()).toHaveTextContent(STUDIO.removed(STUDIO.types.heading)));
    expect(notice()).toHaveTextContent('Ctrl+Z');
    expect(document.querySelector('.st-toast')).toBeNull();
  });
});

describe('«Проверка теста» on a phone', () => {
  it('opens in its own sheet without the settings’ tabs; «Настройки» opens the settings again', async () => {
    widthIs(375);
    await openStored();
    fireEvent.click(screen.getByRole('button', { name: STUDIO.check }));
    const check = screen.getByRole('dialog', { name: STUDIO.check });
    expect(within(check).queryByRole('tablist')).toBeNull();
    fireEvent.click(within(check).getByRole('button', { name: STUDIO.previewClose }));
    fireEvent.click(within(bar() as HTMLElement).getByRole('button', { name: STUDIO.panelsLabel }));
    const settings = screen.getByRole('dialog', { name: STUDIO.panelsLabel });
    expect(within(settings).getByRole('tab', { name: STUDIO.panels.block })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('a question saved in the studio (useSavedLine)', () => {
  const saveStem = async (stem: string) => {
    fireEvent.click(frame('qblock000001'));
    const panel = screen.getByRole('complementary', { name: STUDIO.panelsLabel });
    fireEvent.change(within(panel).getByLabelText('Текст вопроса'), { target: { value: stem } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Сохранить' }));
    return panel;
  };

  it('a test nobody answered: «Вопрос сохранён.», not «Счёт… начнётся заново»', async () => {
    api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: true, doubts_resolved: 0 }));
    await openStored();
    const panel = await saveStem('Какой город — столица Франции?');
    expect(await within(panel).findByText(STUDIO.editorSaved)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/начнётся заново/);
  });

  it('a test with a group: the count starts again, and it is said', async () => {
    api.state.summary = { ...(api.state.summary as object), owner: { members: 3, doubts_open: 0, links: [] } };
    api.updateItem.mockReset().mockImplementation(async (id: string) => ({ id, rev: 2, rev_changed: true, doubts_resolved: 0 }));
    await openStored();
    const panel = await saveStem('Какой город — столица Франции?');
    expect(await within(panel).findByText(KEYS.editedReset(true))).toBeInTheDocument();
  });
});

describe('the words of a short answer', () => {
  const short = (answers: string[]): TestItem => item({ ...base, id: 'c0000000-0000-4000-8000-000000000009', position: 9, file_no: '9', kind: 'short', stem: DRAFT_WORDS.stem, options: [], correct: [], answers });

  it('«Короткий ответ» in the palette, as in the editor', () => {
    expect(STUDIO.qtypes.short).toBe('Короткий ответ');
  });

  it('an empty short answer is asked for its accepted answers, not its options', () => {
    const row = short([DRAFT_WORDS.form]);
    const doc = { ...emptyDoc('Т'), blocks: [{ type: 'question' as const, id: 'qblock000009', item_id: row.id, points: 1, required: false }] };
    const hint = hintFor(doc.blocks[0], doc, new Map([[row.id, row]]));
    expect(hint).toBe(STUDIO.hints.questionDraftShort);
    expect(hint).not.toMatch(/варианты/);
    const done = { ...row, stem: 'Наименьшая частица элемента?', answers: ['атом'] };
    expect(hintFor(doc.blocks[0], doc, new Map([[row.id, done]]))).toBe(STUDIO.hints.questionShort);
  });
});
