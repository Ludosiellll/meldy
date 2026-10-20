/**
 * Render budgets of the screens the smoothness audit of 20.10 found slow on a phone (owner's rule: no jank anywhere,
 * the look unchanged). Counts, not times, so a loaded machine does not make them flaky: React commits (a DevTools-style
 * hook installed before react-dom loads), reads of the page's layout made while React commits (a read there lays the
 * page out before the browser does), and Markdown parses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const budget = vi.hoisted(() => {
  const state = { commits: 0 };
  (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => undefined,
    onScheduleFiberRoot: () => undefined,
    onCommitFiberRoot: () => {
      state.commits += 1;
    },
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    setStrictMode: () => undefined,
  };
  return state;
});

const markdown = vi.hoisted(() => ({ calls: 0 }));
vi.mock('react-markdown', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-markdown')>();
  const Markdown = real.default;
  const counted = (options: Parameters<typeof Markdown>[0]) => {
    markdown.calls += 1;
    return Markdown(options);
  };
  return { ...real, default: counted };
});
vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import QuestionEditor from '../components/containers/keys/QuestionEditor';
import { EDITOR } from '../components/containers/copyImport';
import SummaryView from '../components/SummaryView';
import { TextMark } from '../components/marks/TextMarks';
import { resetObserveSizeForTests } from '../lib/observeSize';
import type { TestItem } from '../types/container';

/** Every read of the page's layout, by name, while `run` runs. */
const LAYOUT_READS: Array<[object, string]> = [
  [HTMLElement.prototype, 'offsetWidth'],
  [HTMLElement.prototype, 'offsetHeight'],
  [Element.prototype, 'clientWidth'],
  [Element.prototype, 'clientHeight'],
  [Element.prototype, 'scrollHeight'],
  [Element.prototype, 'scrollWidth'],
];
function countLayoutReads(run: () => void): number {
  let reads = 0;
  const restore: Array<() => void> = [];
  for (const [target, key] of LAYOUT_READS) {
    const own = Object.getOwnPropertyDescriptor(target, key);
    const get = own?.get;
    Object.defineProperty(target, key, {
      configurable: true,
      get(this: Element) {
        reads += 1;
        return get ? get.call(this) : 0;
      },
    });
    restore.push(() => (own ? Object.defineProperty(target, key, own) : delete (target as Record<string, unknown>)[key]));
  }
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function counted(this: Element) {
    reads += 1;
    return rect.call(this);
  };
  try {
    run();
  } finally {
    for (const undo of restore) undo();
    Element.prototype.getBoundingClientRect = rect;
  }
  return reads;
}

/** A ResizeObserver the test reports through, as a browser does after its layout: one report for every box. */
const observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }> = [];
class FakeResizeObserver {
  entry: { callback: ResizeObserverCallback; targets: Set<Element> };
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: new Set() };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.add(target);
  }
  unobserve(target: Element) {
    this.entry.targets.delete(target);
  }
  disconnect() {
    this.entry.targets.clear();
  }
}
function reportAll() {
  act(() => {
    for (const observer of observers) {
      const entries = [...observer.targets].map((target) => ({ target, contentRect: { width: 600, height: 20 } }) as unknown as ResizeObserverEntry);
      if (entries.length) observer.callback(entries, {} as ResizeObserver);
    }
  });
}

beforeEach(() => {
  budget.commits = 0;
  markdown.calls = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetObserveSizeForTests();
  observers.length = 0;
});

const ITEM: TestItem = {
  id: 'i1',
  container_id: '11111111-2222-4333-8444-555555555555',
  subject_id: 's1',
  position: 1,
  file_no: '1',
  topic: null,
  kind: 'single',
  stem: 'Что означает стрелка слева?',
  options: ['Вход', 'Управление', 'Выход'],
  correct: [0],
  answers: [],
  key_source: 'bold',
  code: false,
  keep_order: false,
  flags: [],
  rev: 1,
  updated_at: '2026-10-16T00:00:00Z',
  images: null,
};

describe('render budget: the question editor (audit #3)', () => {
  it('a keystroke reads the layout at most once (the field typed in, after all the writes)', () => {
    render(<QuestionEditor containerId={ITEM.container_id} item={ITEM} context="№ 1" group={false} onSave={vi.fn()} onCancel={vi.fn()} />);
    const stem = screen.getByLabelText(EDITOR.stem) as HTMLTextAreaElement;
    const reads = countLayoutReads(() => {
      fireEvent.change(stem, { target: { value: `${ITEM.stem} и` } });
    });
    expect(reads).toBeLessThanOrEqual(1);
    const option = screen.getByLabelText(EDITOR.option('Б')) as HTMLTextAreaElement;
    expect(countLayoutReads(() => fireEvent.change(option, { target: { value: 'Управлени' } }))).toBeLessThanOrEqual(1);
  });
});

const SUMMARY = {
  content: ['## Архитектура', '', 'Слои: $x_1$, скрытые, выходной.', '', '## Обучение', '', 'Ошибка идёт назад: $$E = \\sum_i e_i^2$$', '', '## Активация', '', 'Сигмоида и ReLU.'].join('\n'),
  terms: [{ term: 'Сигмоида', definition: 'Гладкая функция активации.' }],
} as never;

describe('render budget: the lecture’s «Конспект» (audit #4)', () => {
  it('drawing the summary again with the same content parses no Markdown; coming back to the tab neither', () => {
    const view = render(<SummaryView data={SUMMARY} />);
    expect(markdown.calls).toBe(3);
    markdown.calls = 0;
    view.rerender(<SummaryView data={SUMMARY} />);
    view.rerender(<SummaryView data={{ ...(SUMMARY as object) } as never} />);
    expect(markdown.calls).toBe(0);
    view.unmount();
    render(<SummaryView data={SUMMARY} />);
    expect(markdown.calls).toBe(0);
  });

  it('switching to the tab: at most 2 commits, and nothing reads the layout while React commits', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let reads = 0;
    reads = countLayoutReads(() => {
      render(<SummaryView data={SUMMARY} />);
    });
    expect(reads).toBe(0);
    reportAll();
    expect(budget.commits).toBeLessThanOrEqual(2);
  });
});

describe('render budget: the exam sheet’s pencil marks (audit #6)', () => {
  it('opening a sheet of 40 marks: no layout read while React commits, and their sizes in one commit', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const reads = countLayoutReads(() => {
      render(
        <div>
          {Array.from({ length: 40 }, (_, index) => (
            <TextMark key={index} kind="ring" seed={index}>
              {index + 1}
            </TextMark>
          ))}
        </div>,
      );
    });
    expect(reads).toBe(0);
    const mounted = budget.commits;
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(31);
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(23);
    reportAll();
    width.mockRestore();
    height.mockRestore();
    expect(budget.commits - mounted).toBe(1);
    expect(budget.commits).toBeLessThanOrEqual(2);
  });
});
