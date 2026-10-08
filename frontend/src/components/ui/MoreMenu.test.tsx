import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MoreMenu from './MoreMenu';

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

  it('draws nothing without items', () => {
    const { container } = render(
      <MemoryRouter>
        <MoreMenu items={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
