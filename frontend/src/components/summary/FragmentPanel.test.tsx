import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useFragmentPanel } from './FragmentPanel';
import { FragmentRefs } from './FragmentSlip';
import { closeFragmentPanel, fragmentPanelState, type PanelFragment } from './fragmentPanelStore';
import { PHONE_QUERY } from '../../lib/usePhone';

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
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
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
