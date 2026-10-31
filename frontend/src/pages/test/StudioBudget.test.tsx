import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestItem } from '../../types/container';
import type { DocBlock, TestDoc } from '../../types/testDoc';

/**
 * The studio's render budget (owner, 2026-10-20: «в конструкторе тоже пролагивание с телефона… никаких
 * пролагиваний»; the smoothness audit of 20.10 found 475 components re-rendered at each key typed on a 30-block page).
 * Counts, not times: React's commits and the components that rendered in them, read through a DevTools-style hook as
 * React itself reports them, on a phone's width and a page of 30 blocks.
 *
 * - a key typed in a block: one commit, at most 15 components;
 * - a block chosen: at most 10;
 * - a step of a drag that moves the drop line: at most 5 of the app's components (dnd-kit's own — its context, its
 *   live region, its overlay — render at every step of a drag whatever the page does, and are counted apart).
 */

/** Every commit while `on`: the names of the components that rendered in it (memo bail-outs are not renders). */
const budget = vi.hoisted(() => {
  const state = { on: false, commits: [] as string[][], kitTypes: new Set<unknown>() };
  // Function, class, forwardRef, memo and simple-memo components.
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  type Fiber = { tag: number; type: unknown; elementType: unknown; flags: number; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null };
  // `const X = memo(function X…)` compiles to a function named «X2»: the name as written.
  type Named = { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } };
  const nameOf = (fiber: Fiber): string => {
    const type = (fiber.elementType ?? fiber.type) as unknown;
    let name = 'Anonymous';
    if (typeof type === 'function') name = (type as Named).displayName || (type as Named).name || name;
    else if (type && typeof type === 'object') name = (type as Named).displayName || (type as Named).type?.name || (type as Named).render?.name || name;
    return name.replace(/\d+$/, '');
  };
  // dnd-kit's own parts (named «dnd:…»): DndContext itself, and all under its overlay and its accessibility parts.
  // (its overlay is an unnamed memo: known by its type, given after the imports)
  const DND_KIT_ROOTS = new Set(['Accessibility', 'RestoreFocus']);
  const walk = (root: Fiber): string[] => {
    const out: string[] = [];
    const stack: Array<[Fiber, boolean]> = [[root, false]];
    while (stack.length > 0) {
      const [fiber, inKit] = stack.pop() as [Fiber, boolean];
      const before = fiber.alternate;
      const name = COMPONENT_TAGS.has(fiber.tag) ? nameOf(fiber) : '';
      const kit = inKit || DND_KIT_ROOTS.has(name) || state.kitTypes.has(fiber.elementType);
      // Rendered in this commit: new, or did its work (PerformedWork). A memo that bailed out did not.
      if (name && (!before || (fiber.flags & 1) === 1)) out.push(kit || name === 'DndContext' ? `dnd:${name}` : name);
      // A subtree not cloned in this commit was not rendered.
      if (before && fiber.child === before.child) continue;
      for (let child = fiber.child; child; child = child.sibling) stack.push([child, kit]);
    }
    return out;
  };
  const renderers = new Map<number, unknown>();
  (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers,
    inject(renderer: unknown) {
      renderers.set(1, renderer);
      return 1;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    setStrictMode() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      if (state.on) state.commits.push(walk(root.current));
    },
  };
  return state;
});

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

import { DragOverlay } from '@dnd-kit/core';
import StudioPage from './StudioPage';
import { item, subject, summary } from '../../components/containers/testkit/fixtures';
import { STUDIO } from '../../components/studio/copyStudio';
import { SAVE_DELAY } from '../../components/studio/useStudio';
import { emptyDoc } from '../../lib/studio/doc';

budget.kitTypes.add(DragOverlay);

const EXAM = '11111111-2222-4333-8444-555555555555';
const SUBJ = '22222222-3333-4444-8555-666666666666';
const base = { container_id: EXAM, subject_id: SUBJ, topic: null, key_source: 'manual' as const, images: null };
const QUESTIONS: TestItem[] = Array.from({ length: 6 }, (_, at) =>
  item({ ...base, id: `c0000000-0000-4000-8000-00000000000${at + 1}`, position: at + 1, file_no: String(at + 1), stem: `Вопрос ${at + 1}?`, options: ['Да', 'Нет'], correct: [0] }),
);

/** A page of 30 blocks, as the audit's: a cover, then headings, texts, notes, a divider and six questions in turn. */
function page30(): TestDoc {
  const blocks: DocBlock[] = [{ type: 'cover', id: 'cover0000001', title: 'Тридцать блоков', subtitle: 'Проверка плавности', image: null, align: 'center' }];
  let question = 0;
  for (let at = 1; blocks.length < 30; at += 1) {
    const id = (kind: string) => `${kind}${String(at).padStart(12 - kind.length, '0')}`;
    switch (at % 5) {
      case 1:
        blocks.push({ type: 'heading', id: id('head'), text: `Часть ${at}`, size: 'l' });
        break;
      case 2:
        blocks.push({ type: 'text', id: id('text'), text: `Текст блока ${at}: **важное** и обычное.`, align: 'left' });
        break;
      case 3:
        if (question < QUESTIONS.length) {
          blocks.push({ type: 'question', id: id('qblock'), item_id: QUESTIONS[question].id, points: 1, required: false });
          question += 1;
        } else blocks.push({ type: 'divider', id: id('line') });
        break;
      case 4:
        blocks.push({ type: 'note', id: id('note'), text: `Заметка ${at}`, tone: 'info' });
        break;
      default:
        blocks.push({ type: 'text', id: id('text'), text: `Ещё текст ${at}.`, align: 'left' });
    }
  }
  return { ...emptyDoc('Тридцать блоков'), layout: 'one_page', blocks };
}

const frame = (id: string) => document.querySelector<HTMLElement>(`[data-block="${id}"]`) as HTMLElement;
const blockIds = () => Array.from(document.querySelectorAll<HTMLElement>('.st-block')).map((node) => node.dataset.block as string);

/** What one action rendered: its commits, and the components of each. */
function measure(action: () => void): { commits: string[][]; components: string[] } {
  budget.commits = [];
  budget.on = true;
  try {
    action();
  } finally {
    budget.on = false;
  }
  const commits = budget.commits;
  return { commits, components: commits.flat() };
}

async function openPage() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  const doc = page30();
  api.fetchTestDoc.mockResolvedValue({ container_id: EXAM, doc, rev: 3, updated_at: '2026-10-19T08:00:00Z' });
  render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/studio`]}>
      <Routes>
        <Route path="/exams/c/:id/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('group', { name: '1 из 30: Обложка' });
  // What the opening brings later (the first save's look, the check's settled page) comes before anything is counted.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY + 100));
  });
  return doc;
}

beforeEach(() => {
  api.state.summary = summary({
    id: EXAM,
    title: 'Тридцать блоков',
    exam_date: null,
    subjects: [subject({ id: SUBJ, title: 'Вопросы', exam_date: null, oral: null, topic_titles: [], topics: [], kinds: { single: 6, multiple: 0, short: 0 } })],
    owner: { members: 0, doubts_open: 0, links: [] },
  });
  api.state.items = new Map(QUESTIONS.map((row) => [row.id, row]));
  api.fetchTestDoc.mockReset();
  api.saveTestDoc.mockReset().mockImplementation(async (_id: string, _doc: TestDoc, rev: number) => ({ rev: rev + 1, updated_at: '2026-10-19T08:00:01Z' }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the studio’s render budget on a phone, a page of 30 blocks', () => {
  it('a key typed in a block: one commit, at most 15 components (the block typed in, not the page)', async () => {
    const doc = await openPage();
    const text = doc.blocks.find((block) => block.type === 'text' && block.id.startsWith('text')) as DocBlock & { type: 'text' };
    fireEvent.click(frame(text.id));
    fireEvent.click(within(frame(text.id)).getByText('важное', { exact: false }));
    const field = within(frame(text.id)).getByRole('textbox', { name: STUDIO.types.text }) as HTMLTextAreaElement;

    const typed = measure(() => fireEvent.change(field, { target: { value: `${field.value}я` } }));
    expect(field.value.endsWith('я')).toBe(true);
    expect(typed.commits, typed.components.join(', ')).toHaveLength(1);
    expect(typed.components.length, typed.components.join(', ')).toBeLessThanOrEqual(15);
    // The other 29 blocks did not render.
    expect(typed.components.filter((name) => name === 'CanvasFrame')).toHaveLength(1);
  });

  it('a block chosen: at most 10 components (its frame and the one left, their bars and gaps)', async () => {
    const doc = await openPage();
    const texts = doc.blocks.filter((block) => block.type === 'text');
    fireEvent.click(frame(texts[0].id));
    expect(frame(texts[0].id)).toHaveAttribute('data-selected');

    const chosen = measure(() => fireEvent.click(frame(texts[1].id)));
    expect(frame(texts[1].id)).toHaveAttribute('data-selected');
    expect(frame(texts[0].id)).not.toHaveAttribute('data-selected');
    expect(chosen.commits, chosen.components.join(', ')).toHaveLength(1);
    expect(chosen.components.length, chosen.components.join(', ')).toBeLessThanOrEqual(10);
    // The «+» is under the block chosen now, not under both (a gap that missed the change kept it).
    const next = Array.from(document.querySelectorAll<HTMLElement>('.st-gap[data-next]'));
    expect(next.map((gap) => (gap.previousElementSibling as HTMLElement | null)?.dataset.block)).toEqual([texts[1].id]);
    // The bar of the block left fades out, then is gone.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(frame(texts[0].id).querySelector('.st-acts')).toBeNull();
    expect(frame(texts[1].id).querySelector('.st-acts')).not.toBeNull();
  });

  it('a touch screen scrolled: the mouse a browser fakes over the blocks renders nothing (no bar, no commit)', async () => {
    // A device that does not hover (a phone): its bars show for the chosen block only, as the CSS :hover did before.
    vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    try {
      await openPage();
      const id = blockIds()[5];
      const passed = measure(() => {
        fireEvent.pointerOver(frame(id), { pointerType: 'mouse' });
        fireEvent.pointerOut(frame(id), { pointerType: 'mouse' });
      });
      expect(passed.commits).toHaveLength(0);
      expect(frame(id).querySelector('.st-acts')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a step of a drag that moves the drop line: at most 5 of the app’s components (two gaps, the dragged handle)', async () => {
    await openPage();
    const rect = (top: number, height: number) => ({ top, left: 0, width: 360, height, right: 360, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const block = (this as HTMLElement).closest?.('.st-block') as HTMLElement | null;
      if (block && block === this) return rect(Number(block.dataset.index) * 120, 100);
      if ((this as HTMLElement).classList?.contains('st-gap-end')) return rect(30 * 120, 120);
      return original.call(this);
    });
    const first = blockIds()[3];
    fireEvent.click(frame(first));
    const handle = within(frame(first)).getByRole('button', { name: /^Перетащить/ });
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.querySelectorAll('.st-gap[data-drop]')).toHaveLength(1);

    // The next step: the line goes one gap further (what the step brings, until it has settled).
    const line = document.querySelector('.st-gap[data-drop]');
    budget.commits = [];
    budget.on = true;
    fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    budget.on = false;
    const all = budget.commits.flat();
    expect(document.querySelector('.st-gap[data-drop]')).not.toBe(line);
    const app = all.filter((name) => !name.startsWith('dnd:'));
    expect(app.length, `app: ${app.join(', ')} · all: ${all.join(', ')}`).toBeLessThanOrEqual(5);
    expect(app.filter((name) => name === 'CanvasGap')).toHaveLength(2);
    // No block, no page, no canvas rendered for it.
    for (const name of ['CanvasFrame', 'EditBlock', 'DocView', 'Workspace', 'StudioPage', 'CanvasBody']) expect(app).not.toContain(name);

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
  });
});

describe('the studio’s «Список» on a phone (smoothness debt: a touch there took ≈ 172 ms of a mid phone)', () => {
  async function openList() {
    await openPage();
    const touched = measure(() => fireEvent.click(screen.getByRole('button', { name: STUDIO.views.list })));
    await screen.findAllByRole('button', { name: 'Ниже' });
    return touched;
  }

  it('the tap on «Список» moves the segment in its own commit; the list of cards comes in a later one', async () => {
    const touched = await openList();
    expect(touched.commits.length, touched.commits.map((c) => c.join(',')).join(' | ')).toBeGreaterThanOrEqual(2);
    expect(touched.commits[0]).not.toContain('ListView');
    expect(touched.commits[0]).not.toContain('BuildCard');
    expect(touched.components).toContain('ListView');
    expect(screen.getByRole('button', { name: STUDIO.views.list })).toHaveAttribute('aria-pressed', 'true');
  });

  it('«Ниже» redraws the two cards that swapped, not the whole list', async () => {
    await openList();
    const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.tb-list > li')).map((row) => row.dataset.item);
    const before = cards();
    expect(before.length).toBeGreaterThanOrEqual(6);
    const moved = measure(() => fireEvent.click(screen.getAllByRole('button', { name: 'Ниже' })[0]));
    expect(cards().slice(0, 2)).toEqual([before[1], before[0]]);
    expect(moved.components.filter((name) => name === 'BuildCard').length, moved.components.join(', ')).toBeLessThanOrEqual(2);
    // The moved card's «Ниже» has the focus back.
    expect(document.activeElement).toHaveAttribute('data-act', `down:${before[0]}`);
  });

  it('«Изменить»: the tap’s own commit has no editor; it comes in a later commit, with the focus in its question', async () => {
    await openList();
    const opened = measure(() => fireEvent.click(screen.getAllByRole('button', { name: 'Изменить' })[1]));
    expect(opened.commits[0]).not.toContain('QuestionEditor');
    expect(opened.components).toContain('QuestionEditor');
    // The other cards did not render for it.
    expect(opened.components.filter((name) => name === 'BuildCard').length, opened.components.join(', ')).toBeLessThanOrEqual(1);
    expect(document.activeElement?.classList.contains('qe-stem')).toBe(true);
  });
});
