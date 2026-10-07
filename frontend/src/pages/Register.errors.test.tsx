import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signUp: vi.fn(), resend: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => auth.signUp(...args),
      resend: (...args: unknown[]) => auth.resend(...args),
      signInWithOAuth: vi.fn(),
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

import Register from './Register';
import { SIGN_UP_MESSAGES } from '../lib/signUpErrors';

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<p>Сегодня</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submit() {
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Алина' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alina@example.com' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Secret123' } });
  fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'Secret123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
}

beforeEach(() => {
  auth.signUp.mockReset();
  auth.resend.mockReset();
});

afterEach(cleanup);

describe('Register: what went wrong, and where the letter went', () => {
  it.each([
    ['the address is taken', { name: 'AuthApiError', status: 422, code: 'user_already_exists', message: 'User already registered' }, SIGN_UP_MESSAGES.exists],
    ['too many letters', { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }, SIGN_UP_MESSAGES.tooManyEmails],
    ['no network', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, SIGN_UP_MESSAGES.offline],
  ])('says so when %s', async (_, error, message) => {
    auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error });
    renderRegister();
    submit();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Произошла ошибка при регистрации. Проверьте данные.')).not.toBeInTheDocument();
  });

  it('says the address is taken when the server hides it behind an empty success', async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: 'u-1', identities: [] }, session: null }, error: null });
    renderRegister();
    submit();
    expect(await screen.findByText(SIGN_UP_MESSAGES.exists)).toBeInTheDocument();
  });

  it('names the address the letter went to and both folders to look in', async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: 'u-1', identities: [{ id: 'i-1' }] }, session: null }, error: null });
    renderRegister();
    submit();
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Мы отправили письмо на');
    expect(done).toHaveTextContent('alina@example.com');
    expect(done).toHaveTextContent('Проверьте «Входящие» и «Спам»');
  });
});
