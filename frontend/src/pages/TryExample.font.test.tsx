import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const font = vi.hoisted(() => {
  const state = { settled: false, resolve: () => undefined as void };
  const ready = new Promise<void>((resolve) => {
    state.resolve = () => {
      state.settled = true;
      resolve();
    };
  });
  return { state, ready };
});

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }) }));
// A browser where the handwriting is still on its way.
vi.mock('../components/exams/sheet/sheetFont', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/exams/sheet/sheetFont')>()),
  isSheetFontSettled: () => font.state.settled,
  loadSheetFont: () => font.ready,
}));

import TryExample from './TryExample';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('the sheet waits for its handwriting', () => {
  it('lays the paper out once, in the handwriting: until the font is there, «Загружаем шпаргалку…»', async () => {
    render(
      <MemoryRouter initialEntries={['/try']}>
        <Routes>
          <Route path="/try/*" element={<TryExample />} />
        </Routes>
      </MemoryRouter>,
    );
    // The count is known already; the paper (whose lines would wrap anew under a late font) waits.
    expect(screen.getByText('Загружаем шпаргалку…')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Шпаргалка' })).toBeNull();
    expect(document.querySelector('.cs-big')?.textContent).toBe('47');
    await act(async () => {
      font.state.resolve();
      await font.ready;
    });
    expect(await screen.findByRole('region', { name: 'Шпаргалка' })).toBeInTheDocument();
    expect(screen.queryByText('Загружаем шпаргалку…')).toBeNull();
  });
});
