import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageHead, { withRename, type HeadAction } from './PageHead';

const ACTIONS: HeadAction[] = [
  { key: 'keys', label: 'Вопросы и ключи', to: '/keys' },
  { key: 'settings', label: 'Настройки', to: '/settings' },
  { key: 'delete', label: 'Удалить', onSelect: () => undefined, danger: true },
];

function head(props: Partial<Parameters<typeof PageHead>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PageHead title="01 Таблица" meta="12 вопросов" crumb={{ to: '/exams', label: 'Экзамены' }} actions={ACTIONS} menuLabel="Действия" phone={false} {...props} />
    </MemoryRouter>,
  );
}

/** The field takes the focus a moment after it opens (a menu gives its own back first). */
const settle = () => act(() => void vi.advanceTimersByTime(60));

describe('PageHead: the name changed in place (owner 19.11)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('without onRename the name is only a heading: no pencil, no «Переименовать»', () => {
    head();
    expect(screen.getByRole('heading', { level: 1, name: '01 Таблица' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Переименовать' })).toBeNull();
    fireEvent.doubleClick(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('textbox', { name: 'Название' })).toBeNull();
  });

  it('a double click opens the field with the name; Enter saves it and the new name stands at once', async () => {
    const onRename = vi.fn(async () => null);
    head({ onRename });
    fireEvent.doubleClick(screen.getByRole('heading', { level: 1, name: '01 Таблица' }));
    settle();
    const field = screen.getByRole('textbox', { name: 'Название' }) as HTMLInputElement;
    expect(field.value).toBe('01 Таблица');
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: '  Базы   данных ' } });
    await act(async () => void fireEvent.keyDown(field, { key: 'Enter' }));
    expect(onRename).toHaveBeenCalledWith('Базы данных');
    expect(screen.getByRole('heading', { level: 1, name: 'Базы данных' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Название' })).toBeNull();
  });

  it('the pencil opens it too; Esc leaves the name as it was and saves nothing', () => {
    const onRename = vi.fn(async () => null);
    head({ onRename });
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать' }));
    settle();
    const field = screen.getByRole('textbox', { name: 'Название' });
    fireEvent.change(field, { target: { value: 'Другое' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.blur(field);
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: '01 Таблица' })).toBeInTheDocument();
  });

  it('a click away saves; an empty or unchanged name saves nothing', async () => {
    const onRename = vi.fn(async () => null);
    head({ onRename });
    fireEvent.doubleClick(screen.getByRole('heading', { level: 1 }));
    settle();
    let field = screen.getByRole('textbox', { name: 'Название' });
    fireEvent.change(field, { target: { value: '   ' } });
    await act(async () => void fireEvent.blur(field));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: '01 Таблица' })).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole('heading', { level: 1 }));
    settle();
    field = screen.getByRole('textbox', { name: 'Название' });
    fireEvent.change(field, { target: { value: 'Сети' } });
    await act(async () => void fireEvent.blur(field));
    expect(onRename).toHaveBeenCalledWith('Сети');
  });

  it('a blur before the field took the focus (a menu closing) does not close it', () => {
    const onRename = vi.fn(async () => null);
    head({ onRename });
    fireEvent.doubleClick(screen.getByRole('heading', { level: 1 }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Название' }));
    expect(screen.getByRole('textbox', { name: 'Название' })).toBeInTheDocument();
  });

  it('an error keeps the field open with the words of what went wrong', async () => {
    const onRename = vi.fn(async () => 'Нет связи. Название не сохранено.');
    head({ onRename });
    fireEvent.doubleClick(screen.getByRole('heading', { level: 1 }));
    settle();
    const field = screen.getByRole('textbox', { name: 'Название' });
    fireEvent.change(field, { target: { value: 'Сети' } });
    await act(async () => void fireEvent.keyDown(field, { key: 'Enter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Нет связи. Название не сохранено.');
    expect(screen.getByRole('textbox', { name: 'Название' })).toBeInTheDocument();
  });

  it('a phone has no pencil: «Переименовать» is in the «⋯», before «Удалить»', () => {
    head({ onRename: async () => null, phone: true });
    expect(screen.queryByRole('button', { name: 'Переименовать' })).toBeNull();
    expect(withRename(ACTIONS, { key: 'rename', label: 'Переименовать' }).map((action) => action.key)).toEqual(['keys', 'settings', 'rename', 'delete']);
    expect(withRename(ACTIONS.slice(0, 2), { key: 'rename', label: 'Переименовать' }).map((action) => action.key)).toEqual(['keys', 'settings', 'rename']);
  });
});
