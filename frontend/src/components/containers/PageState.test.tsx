import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Loadable } from '../../lib/containers/hooks';
import { CONTAINER_ERROR_TEXT } from '../../api/containers';
import { PageState } from './PageState';
import { GONE } from './copyImport';

function state(extra: Partial<Loadable<unknown>>): Loadable<unknown> {
  return { data: null, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn(), ...extra };
}

function renderState(value: Loadable<unknown>) {
  return render(
    <MemoryRouter>
      <PageState state={value} />
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe('PageState: an exam page without its data', () => {
  it('an exam that is not the user’s any more (deleted, left, removed): says so plainly, the way to «Экзамены», no «Повторить» (usability check m2)', () => {
    renderState(state({ error: CONTAINER_ERROR_TEXT.P0002, gone: true }));
    expect(screen.getByRole('heading', { level: 1, name: GONE.title })).toBeInTheDocument();
    expect(screen.getByText(GONE.text)).toBeInTheDocument();
    expect(GONE.text).toMatch(/удалили/);
    expect(GONE.text).toMatch(/вышли/);
    expect(GONE.text).toMatch(/убрал/);
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить экзамен')).not.toBeInTheDocument();
    expect(screen.queryByText(CONTAINER_ERROR_TEXT.P0002)).not.toBeInTheDocument();
  });

  it('a real failure (no network) keeps «Повторить»', () => {
    const value = state({ error: CONTAINER_ERROR_TEXT.network, offline: true });
    renderState(value);
    expect(screen.getByRole('alert').textContent).toContain(CONTAINER_ERROR_TEXT.network);
    expect(screen.getByRole('heading', { level: 1, name: 'Не удалось загрузить экзамен' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(value.reload).toHaveBeenCalled();
    expect(screen.queryByText(GONE.title)).not.toBeInTheDocument();
  });
});
