import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressParam, isText, paramValue, setAddressParams, useListPlace, useSessionDraft, useUrlState } from './urlState';

/**
 * The place a page keeps across a reload (owner, 21.10): a choice in the address, a draft in the tab. A «reload» here
 * is a fresh render from the same address (the router opened at window.location) or the same sessionStorage.
 */

const TABS = ['summary', 'cards', 'quiz'] as const;
type Tab = (typeof TABS)[number];

function TabProbe() {
  const [tab, setTab] = useUrlState<Tab>('tab', 'summary', TABS);
  return (
    <>
      <p data-testid="tab">{tab}</p>
      {TABS.map((name) => (
        <button key={name} type="button" onClick={() => setTab(name)}>
          {name}
        </button>
      ))}
    </>
  );
}

function openAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <MemoryRouter initialEntries={[`${window.location.pathname}${window.location.search}`]}>
      <TabProbe />
    </MemoryRouter>,
  );
}

function DraftProbe({ id }: { id: string }) {
  const [text, setText, clear] = useSessionDraft<string>(`answer:${id}`, '', isText);
  return (
    <>
      <textarea aria-label="answer" value={text} onChange={(event) => setText(event.target.value)} />
      <button type="button" onClick={clear}>
        send
      </button>
    </>
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('paramValue', () => {
  it('takes a known value, else the fallback', () => {
    expect(paramValue(new URLSearchParams('tab=cards'), 'tab', 'summary', TABS)).toBe('cards');
    expect(paramValue(new URLSearchParams('tab=nope'), 'tab', 'summary', TABS)).toBe('summary');
    expect(paramValue(new URLSearchParams(''), 'tab', 'summary', TABS)).toBe('summary');
    expect(paramValue(new URLSearchParams('q=abc'), 'q', '')).toBe('abc');
  });
});

describe('setAddressParams', () => {
  it('writes and removes keys in place, keeping the others and the history state', () => {
    window.history.replaceState({ usr: { keep: 1 }, key: 'k1', idx: 0 }, '', '/library/1?mode=express#top');
    const before = window.history.length;
    setAddressParams({ section: 'quiz', mode: null });
    expect(window.location.pathname).toBe('/library/1');
    expect(window.location.search).toBe('?section=quiz');
    expect(window.location.hash).toBe('#top');
    expect(window.history.state).toEqual({ usr: { keep: 1 }, key: 'k1', idx: 0 });
    expect(window.history.length).toBe(before);
    expect(addressParam('section')).toBe('quiz');
  });
});

describe('useUrlState', () => {
  it('a changed tab is in the address, and a reload from that address opens on it', () => {
    const first = openAt('/library/1');
    expect(screen.getByTestId('tab').textContent).toBe('summary');
    act(() => screen.getByRole('button', { name: 'cards' }).click());
    expect(screen.getByTestId('tab').textContent).toBe('cards');
    expect(window.location.search).toBe('?tab=cards');
    first.unmount();

    openAt(window.location.pathname + window.location.search);
    expect(screen.getByTestId('tab').textContent).toBe('cards');
  });

  it('the default leaves the address clean; an unknown value reads as the default', () => {
    const first = openAt('/library/1?tab=quiz&x=1');
    expect(screen.getByTestId('tab').textContent).toBe('quiz');
    act(() => screen.getByRole('button', { name: 'summary' }).click());
    expect(window.location.search).toBe('?x=1');
    first.unmount();
    openAt('/library/1?tab=bogus');
    expect(screen.getByTestId('tab').textContent).toBe('summary');
  });
});

describe('useSessionDraft', () => {
  it('typed text comes back after a reload, per item, and is gone once sent', () => {
    const first = render(<DraftProbe id="q1" />);
    const box = screen.getByRole('textbox', { name: 'answer' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Первая нормальная форма' } });
    first.unmount();

    const second = render(<DraftProbe id="q1" />);
    expect((screen.getByRole('textbox', { name: 'answer' }) as HTMLTextAreaElement).value).toBe('Первая нормальная форма');
    second.unmount();

    const other = render(<DraftProbe id="q2" />);
    expect((screen.getByRole('textbox', { name: 'answer' }) as HTMLTextAreaElement).value).toBe('');
    other.unmount();

    const third = render(<DraftProbe id="q1" />);
    act(() => screen.getByRole('button', { name: 'send' }).click());
    expect((screen.getByRole('textbox', { name: 'answer' }) as HTMLTextAreaElement).value).toBe('');
    third.unmount();
    render(<DraftProbe id="q1" />);
    expect((screen.getByRole('textbox', { name: 'answer' }) as HTMLTextAreaElement).value).toBe('');
  });
});

/** Ten items 100 px tall, 10 px apart, the first at 350 px of the page scrolled by `scrolled` px; the window is 800 px tall. */
function ListProbe({ count = 10 }: { count?: number }) {
  const list = useListPlace<HTMLOListElement>('card', count);
  return (
    <ol ref={list}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>{`Карточка ${index + 1}`}</li>
      ))}
    </ol>
  );
}

let scrolled = 0;
const frame = () => act(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));

describe('useListPlace', () => {
  const brought: string[] = [];
  beforeEach(() => {
    scrolled = 0;
    brought.length = 0;
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
      const top = 350 + index * 110 - scrolled;
      return { top, bottom: top + 100, left: 0, right: 300, width: 300, height: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement, options?: ScrollIntoViewOptions) {
        brought.push(`${this.textContent} ${options?.block}`);
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('the item across the middle of the window is in the address, and a reload brings it back into view', async () => {
    const first = openList('/library/m1?section=flashcards');
    // Item 4 spans 680–780 px of the page: scrolled by 300 px it is across the middle of the window, 400 px.
    scrolled = 300;
    fireEvent.scroll(document);
    await frame();
    expect(window.location.search).toBe('?section=flashcards&card=4');
    first.unmount();

    openList(`${window.location.pathname}${window.location.search}`);
    expect(brought).toEqual(['Карточка 4 center']);
  });

  it('the first item leaves the address clean; a number outside the list is ignored', async () => {
    const first = openList('/library/m1?card=4');
    expect(brought).toEqual(['Карточка 4 center']);
    scrolled = 0;
    fireEvent.scroll(document);
    await frame();
    expect(window.location.search).toBe('');
    first.unmount();

    brought.length = 0;
    const second = openList('/library/m1?card=11');
    second.unmount();
    openList('/library/m1?card=1');
    expect(brought).toEqual([]);
  });
});

function openList(path: string) {
  window.history.replaceState(null, '', path);
  return render(<ListProbe />);
}
