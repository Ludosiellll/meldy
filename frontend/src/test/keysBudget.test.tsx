/**
 * «Вопросы и ключи»: the render budget of a key typed (owner, 2026-11-05: typing in the question editor is not smooth).
 * Counts, not times, read through a DevTools-style hook as React itself reports its commits: the components each commit
 * rendered (memo bail-outs are not renders), on a list of twelve questions found by words with one open in the editor.
 *
 * - a key typed in a field of the editor (the question, an option, the explanation, a field of a new kind): no commit
 *   while nothing the editor shows besides the field changes; the browser keeps the words (the field is not React's);
 * - a key that changes a line (a problem, «Сохранить» on or off, the range of a number): one commit of that line's
 *   own parts — never the editor, its options, the page or the other questions;
 * - a key in the accepted forms of a short answer's card: that row only, not the card or the list.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestItem } from '../types/container';

/** Every commit while `on`: the names of the components that rendered in it. */
const budget = vi.hoisted(() => {
  const state = { on: false, commits: [] as string[][] };
  // Function, class, forwardRef, memo and simple-memo components.
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  type Fiber = { tag: number; type: unknown; elementType: unknown; flags: number; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null };
  type Named = { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } };
  const nameOf = (fiber: Fiber): string => {
    const type = (fiber.elementType ?? fiber.type) as unknown;
    let name = 'Anonymous';
    if (typeof type === 'function') name = (type as Named).displayName || (type as Named).name || name;
    else if (type && typeof type === 'object') name = (type as Named).displayName || (type as Named).type?.name || (type as Named).render?.name || name;
    return name.replace(/\d+$/, '');
  };
  const walk = (root: Fiber): string[] => {
    const out: string[] = [];
    const stack: Fiber[] = [root];
    while (stack.length > 0) {
      const fiber = stack.pop() as Fiber;
      const before = fiber.alternate;
      const name = COMPONENT_TAGS.has(fiber.tag) ? nameOf(fiber) : '';
      // Rendered in this commit: new, or did its work (PerformedWork).
      if (name && (!before || (fiber.flags & 1) === 1)) out.push(name);
      // A subtree not cloned in this commit was not rendered.
      if (before && fiber.child === before.child) continue;
      for (let child = fiber.child; child; child = child.sibling) stack.push(child);
    }
    return out;
  };
  (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
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

const api = vi.hoisted(() => ({ items: null as unknown, summary: null as unknown }));
vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));
vi.mock('../api/containers', () => ({
  updateItem: vi.fn(),
  keysAi: vi.fn(),
  addItems: vi.fn(),
  keepKey: vi.fn(),
  deleteItem: vi.fn(),
  fetchDoubts: vi.fn(async () => []),
}));
vi.mock('../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: { summary: api.summary, items: api.items, planInput: null, oralWithoutPoints: 0 },
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    gone: false,
    reload: vi.fn(),
  }),
}));

import KeysPage from '../pages/container/KeysPage';
import QuestionEditor from '../components/containers/keys/QuestionEditor';
import { EDITOR, KEYS, QUEUE } from '../components/containers/copyImport';
import { item, subject, summary } from '../components/containers/testkit/fixtures';

const EXAM = '11111111-2222-4333-8444-555555555555';
const SUBJ = '22222222-3333-4444-8555-666666666666';
const uid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Twelve questions with «кость» in them; the fifth is a short answer. */
const ROWS: TestItem[] = Array.from({ length: 12 }, (_, at) =>
  item({
    id: uid(at + 1),
    container_id: EXAM,
    subject_id: SUBJ,
    position: at + 1,
    file_no: String(at + 1),
    topic: null,
    stem: `Какая кость номер ${at + 1}?`,
    key_source: 'bold',
    images: null,
    explanation: '',
    ...(at === 4 ? { kind: 'short' as const, options: [], correct: [], answers: ['лопатка'] } : { kind: 'single' as const, options: ['лопатка', 'бедренная', 'крестец'], correct: [0], answers: [] }),
  }),
);

/** What one action rendered: its commits, and the components of each. */
function measure(action: () => void): { commits: string[][]; components: string[] } {
  budget.commits = [];
  budget.on = true;
  try {
    action();
  } finally {
    budget.on = false;
  }
  return { commits: budget.commits, components: budget.commits.flat() };
}

/** Keys typed at the end of a field, one by one: what each rendered. */
function typeKeys(field: HTMLInputElement | HTMLTextAreaElement, keys: string) {
  return [...keys].map((key) => measure(() => fireEvent.change(field, { target: { value: `${field.value}${key}` } })));
}

/** What the opening brought later (the doubts, the frame's size) comes before anything is counted. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const NEVER = ['KeysPage', 'KeyQuestion', 'QuestionEditor', 'KindFields', 'NumberFields', 'MatchFields', 'OrderFields', 'ClozeFields', 'ItemPictures', 'PictureIcon', 'CrossIcon'];

async function openEditor() {
  render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/keys`]}>
      <Routes>
        <Route path="/exams/c/:id/keys" element={<KeysPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByLabelText(KEYS.findNumber), { target: { value: 'какая кость' } });
  const cards = await screen.findAllByRole('article');
  expect(cards).toHaveLength(12);
  fireEvent.click(within(cards[2]).getByRole('button', { name: KEYS.edit }));
  await settle();
  return screen.getByRole('form', { name: EDITOR.label });
}

beforeEach(() => {
  api.items = new Map(ROWS.map((row) => [row.id, row]));
  api.summary = summary({
    id: EXAM,
    subjects: [subject({ id: SUBJ, title: 'Анатомия', topic_titles: [], topics: [], kinds: { single: 11, multiple: 0, short: 1 } })],
    owner: { members: 3, doubts_open: 0, links: [] },
  });
});
afterEach(() => cleanup());

describe('«Вопросы и ключи»: a key typed in the question editor, a list of twelve questions', () => {
  it('a key in the question, an option or the explanation: no commit; the words are the browser’s', async () => {
    const editor = await openEditor();
    const fields = [
      within(editor).getByRole('textbox', { name: EDITOR.stem }),
      within(editor).getByRole('textbox', { name: EDITOR.option('Б') }),
      within(editor).getByRole('textbox', { name: EDITOR.explanation }),
    ] as HTMLTextAreaElement[];
    for (const field of fields) {
      // The first key may turn «Сохранить» on (the question now differs): its own commit, the buttons only.
      const [first, ...rest] = typeKeys(field, 'ой и ещё');
      expect(first.commits.length, first.components.join(', ')).toBeLessThanOrEqual(1);
      for (const name of NEVER) expect(first.components, first.components.join(', ')).not.toContain(name);
      for (const key of rest) expect(key.commits, key.components.join(', ')).toHaveLength(0);
      expect(field.value.endsWith('ой и ещё')).toBe(true);
    }
    expect(within(editor).getByRole('button', { name: EDITOR.save })).toBeEnabled();
  });

  it('a key that changes a line renders that line’s parts only, not the editor, its options, the page or the other questions', async () => {
    const editor = await openEditor();
    const stem = within(editor).getByRole('textbox', { name: EDITOR.stem }) as HTMLTextAreaElement;
    // Emptied: the problem shows and «Сохранить» goes off.
    const emptied = measure(() => fireEvent.change(stem, { target: { value: '' } }));
    expect(within(editor).getByText(EDITOR.problems.stem)).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: EDITOR.save })).toBeDisabled();
    expect(emptied.commits, emptied.components.join(', ')).toHaveLength(1);
    expect(emptied.components.length, emptied.components.join(', ')).toBeLessThanOrEqual(4);
    for (const name of NEVER) expect(emptied.components, emptied.components.join(', ')).not.toContain(name);
    // A key change warns the group: the option's tick is the editor's own step and renders it, once.
    const ticked = measure(() => fireEvent.click(within(editor).getByLabelText(EDITOR.right('В'))));
    expect(ticked.commits).toHaveLength(1);
    expect(ticked.components).toContain('QuestionEditor');
    expect(ticked.components).not.toContain('KeyQuestion');
    expect(ticked.components).not.toContain('KeysPage');
    expect(within(editor).getByText(EDITOR.resets)).toBeInTheDocument();
  });

  it('a key in the accepted forms of a short answer’s card renders that row, not the card or the list', async () => {
    render(
      <MemoryRouter initialEntries={[`/exams/c/${EXAM}/keys`]}>
        <Routes>
          <Route path="/exams/c/:id/keys" element={<KeysPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByLabelText(KEYS.findNumber), { target: { value: 'какая кость' } });
    const card = (await screen.findAllByRole('article'))[4];
    await settle();
    const forms = within(card).getByLabelText(QUEUE.shortForms) as HTMLInputElement;
    const keys = typeKeys(forms, '; кость');
    expect(forms.value).toBe('лопатка; кость');
    expect(within(card).getByRole('button', { name: QUEUE.saveForms })).toBeEnabled();
    for (const key of keys) {
      expect(key.commits.length, key.components.join(', ')).toBeLessThanOrEqual(1);
      expect(key.components.length, key.components.join(', ')).toBeLessThanOrEqual(1);
      for (const name of NEVER) expect(key.components, key.components.join(', ')).not.toContain(name);
    }
  });
});

describe('the question editor’s fields of the kinds of release 48', () => {
  it('a key in «Число»: no commit unless the range line changes, and then the line only', () => {
    render(<QuestionEditor containerId={EXAM} item={null} context="Новый вопрос" group={false} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Число'));
    fireEvent.change(screen.getByRole('textbox', { name: EDITOR.stem }), { target: { value: 'Ускорение свободного падения?' } });
    const numbers = screen.getByRole('textbox', { name: 'Верное число' }) as HTMLInputElement;
    const unit = screen.getByRole('textbox', { name: 'Единица' }) as HTMLInputElement;
    fireEvent.change(numbers, { target: { value: '9,8' } });
    const keys = typeKeys(unit, 'м/с²');
    expect(screen.getByText('Засчитаем ровно 9,8 м/с².')).toBeInTheDocument();
    for (const key of keys) {
      expect(key.commits.length, key.components.join(', ')).toBeLessThanOrEqual(1);
      expect(key.components.length, key.components.join(', ')).toBeLessThanOrEqual(1);
      for (const name of NEVER) expect(key.components, key.components.join(', ')).not.toContain(name);
    }
    // A pair of a match: nothing shows the words but the field.
    fireEvent.click(screen.getByLabelText('Соответствие'));
    const pair = screen.getByRole('textbox', { name: 'Пара строки 1' }) as HTMLInputElement;
    for (const key of typeKeys(pair, 'слева и сверху')) expect(key.commits, key.components.join(', ')).toHaveLength(0);
    expect(pair.value).toBe('слева и сверху');
  });
});
