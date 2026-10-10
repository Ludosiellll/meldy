import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }) }));

import TryExample from './TryExample';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('the sheet in the app’s own type (2026-10-10_cheat-sheet-native-look)', () => {
  it('lays the card out at once: no handwriting font exists to wait for', () => {
    render(
      <MemoryRouter initialEntries={['/try']}>
        <Routes>
          <Route path="/try/*" element={<TryExample />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('.cs-paper')).not.toBeNull();
    expect(document.querySelectorAll('.cs-line').length).toBeGreaterThan(0);
    expect(screen.queryByText('Загружаем шпаргалку…')).toBeNull();
    expect(document.querySelector('.cs-big')?.textContent).toBe('47');
    // «Meldy Hand» (Caveat) is gone from the app with the paper look: nothing on the page asks for it.
    expect(document.documentElement.innerHTML).not.toMatch(/Meldy Hand|fontsource-variable\/caveat/);
  });
});
