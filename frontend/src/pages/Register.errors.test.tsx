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
import { EMPTY_FIELD_MESSAGES, SIGN_UP_MESSAGES, emptySignUpFields } from '../lib/signUpErrors';

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
  fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'alina@example.com' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Secret123' } });
  fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'Secret123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
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

describe('Register: an empty form never reaches Supabase', () => {
  // Live run of 2026-10-07: an empty form went to /auth/v1/signup as an anonymous sign-up (422), and the page said
  // «Не удалось зарегистрироваться…».
  it('says under each empty field what to fill in, like the other field errors, and sends nothing', () => {
    renderRegister();
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(auth.signUp).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((element) => element.textContent);
    expect(alerts).toEqual([EMPTY_FIELD_MESSAGES.name, EMPTY_FIELD_MESSAGES.email, EMPTY_FIELD_MESSAGES.password]);
    expect(screen.getByLabelText('Имя')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Почта')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('aria-invalid', 'true');
    // The same classes as the other inline errors of the form (name and e-mail red, the password's hint yellow).
    expect(screen.getByText(EMPTY_FIELD_MESSAGES.name)).toHaveClass('au-hint', 'au-hint--error');
    expect(screen.getByText(EMPTY_FIELD_MESSAGES.password)).toHaveClass('au-hint', 'au-hint--warn');
    expect(document.activeElement).toBe(screen.getByLabelText('Имя'));
    expect(screen.queryByText(SIGN_UP_MESSAGES.failed)).not.toBeInTheDocument();
  });

  it('spaces are empty too; a filled field clears its message as it is typed', () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'alina@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').map((element) => element.textContent)).toEqual([
      EMPTY_FIELD_MESSAGES.name,
      EMPTY_FIELD_MESSAGES.password,
    ]);
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Алина' } });
    expect(screen.queryByText(EMPTY_FIELD_MESSAGES.name)).not.toBeInTheDocument();
  });

  it('the form checks itself (no browser bubbles in another language) and still marks the fields as required', () => {
    renderRegister();
    expect(screen.getByRole('button', { name: 'Создать аккаунт' }).closest('form')).toHaveAttribute('novalidate');
    for (const label of ['Имя', 'Почта', 'Пароль']) expect(screen.getByLabelText(label)).toBeRequired();
  });

  it('emptySignUpFields names only the empty ones', () => {
    expect(emptySignUpFields({ name: 'Алина', email: ' ', password: 'Secret123' })).toEqual({
      name: '',
      email: EMPTY_FIELD_MESSAGES.email,
      password: '',
    });
  });
});
