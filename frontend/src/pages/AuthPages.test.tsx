import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The sign-in pages after the audit of 2026-10-08: a real address or name is never refused (PUB-4, PUB-19), the
 * password's rules are on screen before typing and a differing repeat says so as it is typed (PUB-20), the sign-up
 * says what the free account gives (PUB-21) and calls itself «Создать аккаунт» (decision 5), each tab has its name.
 */

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => auth.signUp(...args),
      signInWithPassword: (...args: unknown[]) => auth.signInWithPassword(...args),
      signInWithOAuth: (...args: unknown[]) => auth.signInWithOAuth(...args),
      resetPasswordForEmail: (...args: unknown[]) => auth.resetPasswordForEmail(...args),
      updateUser: (...args: unknown[]) => auth.updateUser(...args),
      resend: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock('../components/authReel/AuthReel', () => ({ default: () => null }));

import Login from './Login';
import Register, { GOOGLE_SIGN_UP, MISMATCH, SIGN_UP_TITLE, TYPO_NOTE } from './Register';
import ForgotPassword from './ForgotPassword';
import UpdatePassword from './UpdatePassword';
import { EMAIL_FORMAT_MESSAGE } from '../utils/validators';

const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/update-password" element={<UpdatePassword />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillRegister({ name = 'Алина', email = 'alina@example.com', password = 'Secret123', confirm }: { name?: string; email?: string; password?: string; confirm?: string } = {}) {
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.blur(screen.getByLabelText('Email'));
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: confirm ?? password } });
}

beforeEach(() => {
  auth.signUp.mockReset().mockResolvedValue({ data: { user: { id: 'u-1', identities: [{ id: 'i-1' }] }, session: null }, error: null });
  auth.signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.resetPasswordForEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
});

afterEach(cleanup);

describe('each sign-in page names its tab', () => {
  it.each([
    ['/login', 'Вход — Meldy'],
    ['/register', 'Регистрация — Meldy'],
    ['/forgot-password', 'Восстановление пароля — Meldy'],
    ['/update-password', 'Новый пароль — Meldy'],
  ])('%s → «%s»', (path, title) => {
    renderAt(path);
    expect(document.title).toBe(title);
  });
});

describe('/login: an address is checked for its form only (PUB-4)', () => {
  it.each(['student@mail.com', 'student@inbox.lv', 'student@mail.kz', 'student@yandex.ua', 'student@gmail.co'])('%s signs in, no hint', async (email) => {
    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({ email, password: 'Secret123' }));
    expect(screen.queryByText(/опечатк|имели в виду/i)).toBeNull();
  });

  it('a malformed address stops the form and says why; fixing it clears the message', () => {
    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@mail' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByRole('alert')).toHaveTextContent(EMAIL_FORMAT_MESSAGE);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@mail.ru' } });
    expect(screen.queryByText(EMAIL_FORMAT_MESSAGE)).toBeNull();
  });

  it('offers sign-up as «Создать аккаунт» (decision 5)', () => {
    renderAt('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(screen.getByRole('heading', { level: 1, name: SIGN_UP_TITLE })).toBeInTheDocument();
  });
});

describe('/register', () => {
  it('says what the free account gives, from lib/plans.ts, under the heading (PUB-21)', () => {
    renderAt('/register');
    expect(plain(document.querySelector('.au-free')?.textContent)).toBe('Аккаунт бесплатный: каждый день 100 единиц ИИ — это 5 лекций или 25 проверенных ответов.');
  });

  it.each(['student@mail.com', 'student@inbox.lv', 'student@mail.kz', 'student@yandex.ua'])('signs up %s: no hint, no refusal (PUB-4)', async (email) => {
    renderAt('/register');
    fillRegister({ email });
    expect(screen.queryByText(TYPO_NOTE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SIGN_UP_TITLE }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    expect(auth.signUp.mock.calls[0][0].email).toBe(email);
  });

  it('a likely typo is a hint with a one-click fix, and never stops the form', async () => {
    renderAt('/register');
    fillRegister({ email: 'alina@gmail.co' });
    const hint = screen.getByText(TYPO_NOTE).closest('p')!;
    expect(hint).toHaveClass('au-hint', 'au-hint--warn');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'false');
    fireEvent.click(within(hint).getByRole('button', { name: 'Исправить на gmail.com' }));
    expect(screen.getByLabelText('Email')).toHaveValue('alina@gmail.com');
    expect(screen.queryByText(TYPO_NOTE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SIGN_UP_TITLE }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    expect(auth.signUp.mock.calls[0][0].email).toBe('alina@gmail.com');
    cleanup();

    // Left as it is, the address goes as typed.
    auth.signUp.mockClear();
    renderAt('/register');
    fillRegister({ email: 'alina@gmail.co' });
    fireEvent.click(screen.getByRole('button', { name: SIGN_UP_TITLE }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    expect(auth.signUp.mock.calls[0][0].email).toBe('alina@gmail.co');
  });

  it.each(['Гарик Сукачёв', 'Шехерезада', "Д'Артаньян", 'Anna-Maria O’Neil'])('signs up «%s» (PUB-19)', async (name) => {
    renderAt('/register');
    fillRegister({ name });
    fireEvent.click(screen.getByRole('button', { name: SIGN_UP_TITLE }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
    expect(auth.signUp.mock.calls[0][0].options.data.full_name).toBe(name);
  });

  it('shows the password rules before anything is typed, and ticks each one as it is met (PUB-20)', () => {
    renderAt('/register');
    const rules = document.getElementById('register-password-rules')!;
    expect(plain(rules.textContent)).toBe('Пароль: от 8 символов, заглавная буква, цифра');
    expect(screen.getByLabelText('Пароль').getAttribute('aria-describedby')).toContain('register-password-rules');
    expect(rules.querySelectorAll('[data-met]')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret12' } });
    expect(Array.from(rules.querySelectorAll('[data-met]'), (rule) => plain(rule.textContent))).toEqual(['от 8 символов', 'цифра']);
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Secret12' } });
    expect(rules.querySelectorAll('[data-met]')).toHaveLength(3);
  });

  it('says the repeat differs as soon as it is as long as the password, and stops when it matches', () => {
    renderAt('/register');
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'Secret1' } });
    expect(screen.queryByText(MISMATCH)).toBeNull();
    fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'Secret124' } });
    expect(screen.getByText(MISMATCH)).toBeInTheDocument();
    expect(screen.getByLabelText('Повтор пароля')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'Secret123' } });
    expect(screen.queryByText(MISMATCH)).toBeNull();
  });

  it('a differing repeat stops the form at the repeat, which gets the focus', () => {
    renderAt('/register');
    fillRegister({ confirm: 'Secret12' });
    fireEvent.click(screen.getByRole('button', { name: SIGN_UP_TITLE }));
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(screen.getByText(MISMATCH)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Повтор пароля'));
  });

  it('offers Google as «или · Продолжить с Google», not «войти» (PUB-20)', () => {
    renderAt('/register');
    expect(plain(document.querySelector('.au-or')?.textContent)).toBe('или');
    expect(screen.getByRole('button', { name: GOOGLE_SIGN_UP })).toBeInTheDocument();
    expect(screen.queryByText(/войти через/i)).toBeNull();
  });
});

describe('/forgot-password', () => {
  it('tells an account made with Google that it needs no password, and where to go (PUB-20)', () => {
    renderAt('/forgot-password');
    const line = document.querySelector('.au-aside')!;
    expect(plain(line.textContent)).toBe('Входили через Google? Пароль не нужен: войдите через Google на странице входа.');
    expect(within(line as HTMLElement).getByRole('link', { name: /^войдите через\sGoogle$/ })).toHaveAttribute('href', '/login');
  });
});

describe('/update-password', () => {
  it('asks for the sign-up’s rules and refuses a weaker password without sending it', async () => {
    renderAt('/update-password');
    expect(plain(document.getElementById('new-password-rules')?.textContent)).toBe('Пароль: от 8 символов, заглавная буква, цифра');
    fireEvent.change(screen.getByLabelText('Новый пароль', { selector: 'input' }), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Минимум 8 символов');
    fireEvent.change(screen.getByLabelText('Новый пароль', { selector: 'input' }), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'Secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Secret123' }));
  });
});
