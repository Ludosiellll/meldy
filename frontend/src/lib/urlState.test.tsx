import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addressParam, isText, paramValue, setAddressParams, useSessionDraft, useUrlState } from './urlState';

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
