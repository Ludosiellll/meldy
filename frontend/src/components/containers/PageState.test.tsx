import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Loadable } from '../../lib/containers/hooks';
import { CONTAINER_ERROR_TEXT } from '../../api/containers';
import { PageState } from './PageState';
import { GONE, GONE_EXAM } from './copyImport';
import { GONE_TEST, goneWords } from '../test/copyTest';

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

  it('the kind of a container that is gone is not known: the words name neither an exam nor a test (live check of 47.2)', () => {
    renderState(state({ error: CONTAINER_ERROR_TEXT.P0002, gone: true }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Этой страницы больше нет в вашем списке');
    expect(document.body.textContent).not.toMatch(/Этого экзамена|Этого теста/);
  });

  it('where the kind is known, the words name it; unknown, the neutral ones', () => {
    expect(goneWords('test')).toBe(GONE_TEST);
    expect(GONE_TEST).toEqual({ title: 'Этого теста больше нет в вашем списке', text: 'Его удалили, вы из него вышли или автор убрал вас.' });
    expect(goneWords('exam')).toBe(GONE_EXAM);
    expect(GONE_EXAM.title).toBe('Этого экзамена больше нет в вашем списке');
    expect(goneWords(null)).toBe(GONE);
    expect(goneWords(undefined)).toBe(GONE);
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
