import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MoreMenu, { opensUp } from './MoreMenu';

afterEach(cleanup);

function renderMenu(props: Partial<Parameters<typeof MoreMenu>[0]> = {}) {
  const onInvite = vi.fn();
  render(
    <MemoryRouter initialEntries={['/exams/1']}>
      <Routes>
        <Route
          path="/exams/1"
          element={
            <MoreMenu
              label="Ещё: лист экзамена"
              items={[
                { key: 'edit', label: 'Изменить список', to: '/exams/1/edit' },
                { key: 'invite', label: 'Пригласить группу', onSelect: onInvite },
                { key: 'delete', label: 'Удалить экзамен…', onSelect: vi.fn(), danger: true },
              ]}
              {...props}
            />
          }
        />
        <Route path="/exams/1/edit" element={<p>Редактор</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onInvite };
}

describe('MoreMenu', () => {
  it('is a quiet «Ещё» with a name, closed at first', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: 'Ещё: лист экзамена' });
    expect(button).toHaveTextContent('Ещё');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens with the focus on the first item; arrows move, Escape closes and gives the focus back', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: 'Ещё: лист экзамена' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(['Изменить список', 'Пригласить группу', 'Удалить экзамен…']);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(items[2], { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('runs an action and closes; a link goes to its page', () => {
    const { onInvite } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Пригласить группу' }));
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить список' }));
    expect(screen.getByText('Редактор')).toBeInTheDocument();
  });

  it('gives the focus back to «Ещё» when an action runs, and Tab closes the menu', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: 'Ещё: лист экзамена' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Пригласить группу' }));
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a click outside', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('the round variant is the «⋯» circle', () => {
    renderMenu({ variant: 'round' });
    expect(screen.getByRole('button', { name: 'Ещё: лист экзамена' })).toHaveClass('sf-more');
  });

  it('a switch: its state drawn and said, turned in place (the menu stays open on it), walked by the arrows with the rest', () => {
    const onHistory = vi.fn();
    function Switches() {
      const [on, setOn] = useState(false);
      return (
        <MoreMenu
          label="Ещё: шпаргалка"
          variant="round"
          items={[
            { key: 'cover', label: 'Спрятать строки', hint: on ? null : 'и проверить, что помните их', checked: on, onSelect: () => setOn((value) => !value) },
            { key: 'history', label: 'История шпаргалки', onSelect: onHistory, separatorBefore: true },
          ]}
        />
      );
    }
    render(
      <MemoryRouter>
        <Switches />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: шпаргалка' }));
    const item = screen.getByRole('menuitemcheckbox', { name: 'Спрятать строки' });
    expect(item).toHaveFocus();
    expect(item).toHaveAttribute('aria-checked', 'false');
    // The hint is seen under the label and read as the description, not as part of the name.
    expect(item).toHaveAccessibleDescription('и проверить, что помните их');
    expect(item.querySelector('.mm-switch')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(item);
    expect(screen.getByRole('menu', { name: 'Ещё: шпаргалка' })).toBeInTheDocument();
    expect(item).toHaveAttribute('aria-checked', 'true');
    expect(item).not.toHaveAccessibleDescription();
    fireEvent.keyDown(item, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'История шпаргалки' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'История шпаргалки' }), { key: 'ArrowDown' });
    expect(item).toHaveFocus();
    // An action still closes it.
    fireEvent.click(screen.getByRole('menuitem', { name: 'История шпаргалки' }));
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('draws nothing without items', () => {
    const { container } = render(
      <MemoryRouter>
        <MoreMenu items={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MoreMenu: where it opens (usability check 2026-10-10, n1)', () => {
  const initialHeight = window.innerHeight;
  afterEach(() => Object.defineProperty(window, 'innerHeight', { configurable: true, value: initialHeight }));

  /** The «⋯» at `top` in a window `viewHeight` high; the open menu `menuHeight` high (jsdom lays nothing out). */
  function place(top: number, menuHeight: number, viewHeight: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-haspopup') === 'menu' ? new DOMRect(300, top, 44, 44) : new DOMRect(0, 0, 0, 0);
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu' ? menuHeight : 0;
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewHeight });
  }
  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: лист экзамена' }));
    return screen.getByRole('menu');
  };

  it('opens under its button unless it would leave the window there and the room above is larger', () => {
    expect(opensUp({ top: 100, bottom: 144 }, 150, 844)).toBe(false);
    // a subject's «⋯» near the bottom of «Настройки» on a phone (390 × 844): 113 px of menu, 36 px left below
    expect(opensUp({ top: 770, bottom: 814 }, 113, 844)).toBe(true);
    // more room below than above: it stays under, as it is
    expect(opensUp({ top: 40, bottom: 84 }, 400, 300)).toBe(false);
    // a laptop window (734 px high): fits under, or does not
    expect(opensUp({ top: 520, bottom: 564 }, 150, 734)).toBe(false);
    expect(opensUp({ top: 600, bottom: 644 }, 150, 734)).toBe(true);
  });

  it('near the bottom of a phone it opens upwards, measured as it opens; with room below again, under', () => {
    place(770, 113, 844);
    renderMenu({ variant: 'round' });
    const menu = openMenu();
    expect(menu).toHaveAttribute('data-up');
    expect(menu.style.top).toBe('auto');
    expect(menu.style.bottom).toBe('calc(100% + 8px)');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });
    // the page scrolled: room under the button again
    place(200, 113, 844);
    const again = openMenu();
    expect(again).not.toHaveAttribute('data-up');
    expect(again.style.top).toBe('');
    expect(again.style.bottom).toBe('');
  });

  it('on a laptop the same: upwards only without room below', () => {
    place(600, 150, 734);
    renderMenu({ variant: 'round' });
    expect(openMenu()).toHaveAttribute('data-up');
    cleanup();
    place(300, 150, 734);
    renderMenu({ variant: 'round' });
    expect(openMenu()).not.toHaveAttribute('data-up');
  });

  it('`up` (a bar at the bottom) opens upwards whatever the room, by its own rule', () => {
    place(100, 113, 844);
    renderMenu({ up: true });
    const menu = openMenu();
    expect(menu).toHaveAttribute('data-up');
    expect(menu.getAttribute('style')).toBeNull();
  });
});
