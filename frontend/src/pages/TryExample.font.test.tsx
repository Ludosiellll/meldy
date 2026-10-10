import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const font = vi.hoisted(() => ({
  // A handwriting that never arrives: the sheet must not wait for it.
  load: vi.fn(() => new Promise<void>(() => undefined)),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }) }));
vi.mock('../components/exams/sheet/sheetFont', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/exams/sheet/sheetFont')>()),
  isSheetFontSettled: () => false,
  loadSheetFont: font.load,
}));

import TryExample from './TryExample';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('the sheet in the app’s own type (2026-10-10_cheat-sheet-native-look)', () => {
  it('lays the card out at once: no handwriting to load, nothing to wait for', () => {
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
    // «Meldy Hand» is not asked for, not even on the way to the sheet.
    expect(font.load).not.toHaveBeenCalled();
  });
});
