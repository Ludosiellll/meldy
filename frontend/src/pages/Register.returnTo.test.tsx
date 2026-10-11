import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signUp: vi.fn(), signInWithOAuth: vi.fn(), resend: vi.fn() }));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => auth.signUp(...args),
      signInWithOAuth: (...args: unknown[]) => auth.signInWithOAuth(...args),
      resend: (...args: unknown[]) => auth.resend(...args),
    },
  },
}));
vi.mock('../components/authReel/AuthReel', () => ({ default: () => null }));

import Register, { BACK_TO_TRY, EMAIL_LABEL, EMAIL_PLACEHOLDER } from './Register';
import { FROM_TRY } from '../lib/returnTo';

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Алина' } });
  fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'alina@example.com' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Secret123' } });
  fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'Secret123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
}

beforeEach(() => {
  auth.signUp.mockReset().mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
  auth.signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.resend.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe('Register: the way back (lib/returnTo)', () => {
  it('the confirmation letter leads straight back to the group link, in its own address (and so does a second letter)', async () => {
    renderAt('/register?next=%2Fjoin%2Fabcd2fghjkmn');
    fillAndSubmit();
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/join/abcd2fghjkmn`);
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить письмо ещё раз' }));
    await waitFor(() => expect(auth.resend).toHaveBeenCalledTimes(1));
    expect(auth.resend.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/join/abcd2fghjkmn`);
  });

  it('Google goes through /auth/callback with the way back; «Войти» keeps it', async () => {
    renderAt('/register?next=%2Fjoin%2Fabcd2fghjkmn');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить с Google' }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      `${window.location.origin}/auth/callback?next=%2Fjoin%2Fabcd2fghjkmn`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(where).toBe('/login?next=%2Fjoin%2Fabcd2fghjkmn');
  });

  it('without a way back (or an unsafe one) everything is as before: «Сегодня»', async () => {
    renderAt('/register?next=%2F%2Fevil.example');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить с Google' }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(`${window.location.origin}/auth/callback`);
    fillAndSubmit();
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/dashboard`);
  });
});

describe('Register opened from the example (/try): its own words and the way back (jury QA, 2026-10-11)', () => {
  const fromTry = (state: unknown) =>
    render(
      <MemoryRouter initialEntries={[{ pathname: '/register', search: '?next=%2Fexams%2Fnew', state }]}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/try" element={<h1>Пример</h1>} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );

  it('names the e-mail field in Russian, with no English placeholder', () => {
    renderAt('/register');
    const field = screen.getByLabelText(EMAIL_LABEL);
    expect(EMAIL_LABEL).toBe('Почта');
    expect(field).toHaveAttribute('placeholder', EMAIL_PLACEHOLDER);
    expect(screen.queryByText('Email')).toBeNull();
    expect(document.body.innerHTML).not.toContain('you@example.com');
  });

  it('a visitor who came from the example gets a quiet link back to it; anyone else does not', () => {
    fromTry(FROM_TRY);
    const back = screen.getByRole('link', { name: BACK_TO_TRY });
    expect(back).toHaveAttribute('href', '/try');
    expect(back).toHaveClass('au-link');
    expect(back.closest('header')).not.toBeNull();
    fireEvent.click(back);
    expect(where).toBe('/try');
    cleanup();
    for (const state of [null, undefined, { from: '/exams' }, 'try']) {
      fromTry(state);
      expect(screen.queryByRole('link', { name: BACK_TO_TRY })).toBeNull();
      cleanup();
    }
    renderAt('/register?next=%2Fexams%2Fnew');
    expect(screen.queryByRole('link', { name: BACK_TO_TRY })).toBeNull();
  });
});
