import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useFragmentPanel } from './FragmentPanel';
import { FragmentRefs } from './FragmentSlip';
import { closeFragmentPanel, fragmentPanelState, type PanelFragment } from './fragmentPanelStore';
import { PHONE_QUERY } from '../../lib/usePhone';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const SOURCES = [
  { id: 'S01', text: 'Природа\nПрирода — материальный мир Вселенной, основной объект изучения естественных наук.' },
  { id: 'S07', text: `Геология — комплекс наук о составе и строении земной коры. ${'Геологи изучают горные породы и минералы. '.repeat(20)}` },
  { id: 'S29', text: 'Экосистема — сообщество живых организмов вместе со средой их обитания.' },
];

const fragments = (ids: string[]): PanelFragment[] =>
  ids.map((id) => ({ id, number: Number(id.slice(1)), text: SOURCES.find((source) => source.id === id)?.text }));

/** A chip that opens the panel the way the app's chips do. */
function Opener({ name, ids, note }: { name: string; ids: string[]; note?: string }) {
  const { open, current, panel } = useFragmentPanel();
  return (
    <div>
      <button
        type="button"
        aria-expanded={current !== null}
        onClick={(event) => open({ note, fragments: fragments(ids), current: ids[0], returnTo: event.currentTarget })}
      >
        {name}
      </button>
      {panel}
    </div>
  );
}

afterEach(() => {
  closeFragmentPanel();
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
  window.history.replaceState(null, '', '/');
});

describe('the fragment panel', () => {
  it('opens from its chip, takes the focus and keeps the chip marked', () => {
    render(<Opener name="Природа" ids={['S01', 'S07']} note="Здесь в лекции больше всего общих слов с термином «Природа»." />);
    const chip = screen.getByRole('button', { name: 'Природа' });
    fireEvent.click(chip);
    const panel = screen.getByRole('dialog', { name: 'Фрагмент 1 лекции' });
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByText('Здесь в лекции больше всего общих слов с термином «Природа».')).toBeInTheDocument();
    // The lecture's own heading keeps its line; the panel is in a portal, not inside the card.
    expect(within(panel).getByText('Природа', { selector: '.sv-slip-head' })).toBeInTheDocument();
    expect(chip.parentElement?.contains(panel)).toBe(false);
  });

  it('moves between the fragments of one item with the switches at the top', () => {
    render(<Opener name="Природа" ids={['S01', 'S07']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Природа' }));
    const panel = screen.getByRole('dialog');
    const first = within(panel).getByRole('button', { name: 'Фрагмент 1' });
    const seventh = within(panel).getByRole('button', { name: 'Фрагмент 7' });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(seventh);
    expect(seventh).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('dialog', { name: 'Фрагмент 7 лекции' })).toBeInTheDocument();
    expect(panel.querySelector('[data-fragment="S07"]')).not.toBeNull();
    // A long fragment is cut, «Показать целиком» shows it whole.
    expect(panel.querySelector('.fp-slip')?.textContent?.length).toBeLessThan(SOURCES[1].text.length);
    fireEvent.click(within(panel).getByRole('button', { name: 'Показать целиком' }));
    expect(panel.querySelector('.fp-slip')?.textContent?.trim()).toBe(SOURCES[1].text.trim());
    expect(within(panel).getByRole('button', { name: 'Свернуть' })).toBeInTheDocument();
  });

  it('shows one fragment by its number without switches', () => {
    render(<Opener name="Экосистема" ids={['S29']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Экосистема' }));
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByRole('heading', { name: 'Фрагмент 29' })).toBeInTheDocument();
    expect(within(panel).queryByRole('group')).toBeNull();
  });

  it('replaces what it shows when another chip opens it, and never stacks', () => {
    render(
      <>
        <Opener name="Природа" ids={['S01']} />
        <Opener name="Экосистема" ids={['S29']} />
      </>,
    );
    const nature = screen.getByRole('button', { name: 'Природа' });
    const ecosystem = screen.getByRole('button', { name: 'Экосистема' });
    fireEvent.click(nature);
    fireEvent.click(ecosystem);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.querySelectorAll('.fp-panel')).toHaveLength(1);
    expect(document.querySelectorAll('.fp-dim')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Фрагмент 29 лекции' })).toBeInTheDocument();
    expect(nature).toHaveAttribute('aria-expanded', 'false');
    expect(ecosystem).toHaveAttribute('aria-expanded', 'true');
    // The second one does not slide in again.
    expect(document.querySelector('.fp-layer')).toHaveAttribute('data-still');
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes with Escape and gives the focus back to the chip', () => {
    render(<Opener name="Природа" ids={['S01']} />);
    const chip = screen.getByRole('button', { name: 'Природа' });
    fireEvent.click(chip);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip).toHaveFocus();
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(fragmentPanelState()).toBeNull();
  });

  it('closes on a click on the dim and with ×, the focus back on the chip', () => {
    render(<Opener name="Природа" ids={['S01']} />);
    const chip = screen.getByRole('button', { name: 'Природа' });
    fireEvent.click(chip);
    fireEvent.click(document.querySelector('.fp-dim') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip).toHaveFocus();

    fireEvent.click(chip);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть фрагмент' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip).toHaveFocus();
  });

  it('keeps Tab inside the panel', () => {
    render(<Opener name="Природа" ids={['S01', 'S07']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Природа' }));
    const panel = screen.getByRole('dialog');
    const buttons = within(panel).getAllByRole('button');
    const last = buttons[buttons.length - 1];
    act(() => last.focus());
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('goes away with the chip that opened it', () => {
    const { rerender } = render(<Opener name="Природа" ids={['S01']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Природа' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(<p>Другая вкладка</p>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fragmentPanelState()).toBeNull();
  });

  it('is a bottom sheet with a handle on a phone', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === PHONE_QUERY, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
    });
    render(<Opener name="Природа" ids={['S01']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Природа' }));
    expect(document.querySelector('.fp-layer')).toHaveAttribute('data-phone');
    expect(document.querySelector('.fp-grip')).not.toBeNull();
    // The page under the sheet holds still while it is open.
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('FragmentRefs opens the panel instead of a slip inside the card', () => {
  it('opens a term’s fragments with switches, in the order of their numbers', () => {
    render(
      <div className="sv-term">
        <FragmentRefs ids={['S07', 'S01']} sources={SOURCES} stems={['природ']} note="Здесь в лекции больше всего общих слов с термином «Природа»." compact />
      </div>,
    );
    const term = document.querySelector('.sv-term') as HTMLElement;
    const seventh = within(term).getByRole('button', { name: 'Фрагмент лекции 7' });
    fireEvent.click(seventh);
    expect(seventh).toHaveAttribute('data-active');
    expect(term.querySelector('.sf-slip')).toBeNull();
    const panel = screen.getByRole('dialog', { name: 'Фрагмент 7 лекции' });
    expect(within(panel).getAllByRole('button', { name: /^Фрагмент \d+$/ }).map((button) => button.textContent)).toEqual(['Фрагмент 1', 'Фрагмент 7']);
    // A switch in the panel moves the mark to the other chip.
    fireEvent.click(within(panel).getByRole('button', { name: 'Фрагмент 1' }));
    expect(within(term).getByRole('button', { name: 'Фрагмент лекции 1' })).toHaveAttribute('data-active');
    expect(seventh).not.toHaveAttribute('data-active');
  });
});

// Each test has a page path of its own: the panel remembers the fragments the reader closed on a page for the visit.
describe('the open fragment lives in the address (owner 21.10: a reload lost it)', () => {
  const terms = (
    <>
      <div className="sv-term">
        <FragmentRefs ids={['S01', 'S07']} sources={SOURCES} stems={[]} note="Про природу." panelKey="term-0" compact />
      </div>
      <div className="sv-term">
        <FragmentRefs ids={['S29']} sources={SOURCES} stems={[]} note="Про экосистему." panelKey="term-1" compact />
      </div>
    </>
  );

  it('writes ?frag and frag_for without a new step in the history, follows the switches and clears them on close', () => {
    window.history.replaceState({ idx: 3 }, '', '/library/m1?tab=summary');
    const steps = window.history.length;
    render(terms);
    const chip = screen.getByRole('button', { name: 'Фрагмент лекции 1' });
    fireEvent.click(chip);
    expect(window.location.search).toBe('?tab=summary&frag=1&frag_for=term-0');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Фрагмент 7' }));
    expect(window.location.search).toBe('?tab=summary&frag=7&frag_for=term-0');
    // Replaced, not pushed: Back still leaves the page; the router's state of the entry is kept.
    expect(window.history.length).toBe(steps);
    expect(window.history.state).toEqual({ idx: 3 });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(window.location.search).toBe('?tab=summary');
    expect(chip).toHaveFocus();
  });

  it('opens the fragment the address names when the page comes back (a reload, Back), for that item only', () => {
    window.history.replaceState(null, '', '/library/m4?tab=summary&frag=7&frag_for=term-0');
    render(terms);
    const panel = screen.getByRole('dialog', { name: 'Фрагмент 7 лекции' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(panel).getByText('Про природу.')).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: 'Фрагмент лекции 7' });
    expect(chip).toHaveAttribute('data-active');
    // Closing gives the focus to its chip and takes the parameters away, the page's own stay.
    fireEvent.click(within(panel).getByRole('button', { name: 'Закрыть фрагмент' }));
    expect(chip).toHaveFocus();
    expect(window.location.search).toBe('?tab=summary');
  });

  it('ignores an address that names no fragment of the item', () => {
    window.history.replaceState(null, '', '/library/m1?frag=12&frag_for=term-1');
    render(terms);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves the address to the item that opens next, and keeps it out of the way for items without a key', () => {
    render(
      <>
        {terms}
        <Opener name="Без адреса" ids={['S29']} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Фрагмент лекции 29' }));
    expect(window.location.search).toBe('?frag=29&frag_for=term-1');
    fireEvent.click(screen.getByRole('button', { name: 'Без адреса' }));
    expect(window.location.search).toBe('');
  });

  it('inside the router, writes the browser’s address and leaves the router alone: the page does not draw again', () => {
    window.history.replaceState(null, '', '/library/m2?tab=summary&frag=7&frag_for=term-0');
    let draws = 0;
    function Where() {
      const location = useLocation();
      draws += 1;
      return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
    }
    render(
      <MemoryRouter initialEntries={['/library/m2?tab=summary']}>
        <Routes>
          <Route
            path="/library/:id"
            element={
              <>
                {terms}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const panel = screen.getByRole('dialog', { name: 'Фрагмент 7 лекции' });
    const before = draws;
    fireEvent.click(within(panel).getByRole('button', { name: 'Закрыть фрагмент' }));
    fireEvent.click(screen.getByRole('button', { name: 'Фрагмент лекции 29' }));
    expect(window.location.search).toBe('?tab=summary&frag=29&frag_for=term-1');
    expect(screen.getByTestId('where')).toHaveTextContent('/library/m2?tab=summary');
    expect(draws).toBe(before);
  });

  it('does not open again a fragment the reader closed when an old address comes back; a new opening counts again', () => {
    window.history.replaceState(null, '', '/library/m3?frag=7&frag_for=term-0');
    const first = render(terms);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Фрагмент 7 лекции' }), { key: 'Escape' });
    expect(window.location.search).toBe('');
    first.unmount();
    // The page wrote its own parameter from the router's old address: the closed fragment came back with it.
    window.history.replaceState(null, '', '/library/m3?tab=summary&frag=7&frag_for=term-0');
    const second = render(terms);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Opened by hand and left by going away: Back to the address opens it again.
    fireEvent.click(screen.getByRole('button', { name: 'Фрагмент лекции 7' }));
    second.unmount();
    window.history.replaceState(null, '', '/library/m3?tab=summary&frag=7&frag_for=term-0');
    render(terms);
    expect(screen.getByRole('dialog', { name: 'Фрагмент 7 лекции' })).toBeInTheDocument();
  });

  it('takes the parameters away when the item goes (another tab)', () => {
    const { rerender } = render(terms);
    fireEvent.click(screen.getByRole('button', { name: 'Фрагмент лекции 29' }));
    expect(window.location.search).toBe('?frag=29&frag_for=term-1');
    rerender(<p>Карточки</p>);
    expect(window.location.search).toBe('');
  });
});
