import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * /login and /register inside an embedded WebView (live run of 2026-10-07, corrected the same day): Google usually
 * refuses to sign in there (403 disallowed_useragent), so these pages say what /join says — «Откройте ссылку в Chrome
 * или Safari» with the same actions — and offer no Google button; e-mail stays. A link Telegram opens in a Chrome
 * Custom Tab or SFSafariViewController is Chrome or Safari: Google as everywhere, no note.
 */

const auth = vi.hoisted(() => ({ signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn() }));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => auth.signInWithOAuth(...args),
      signInWithPassword: (...args: unknown[]) => auth.signInWithPassword(...args),
      signUp: (...args: unknown[]) => auth.signUp(...args),
      resend: vi.fn(),
    },
  },
}));
vi.mock('../components/authReel/AuthReel', () => ({ default: () => null }));

import Login from './Login';
import Register from './Register';

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  telegramAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.2 (Samsung SM-A546B; Android 14; SDK 34; AVERAGE)',
  telegramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  viberAndroid:
    'Mozilla/5.0 (Linux; Android 13; Redmi Note 12; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36 Viber/22.8.1.0',
  // What a Custom Tab (Android) and SFSafariViewController (iPhone) send: Chrome's and Safari's own user agents.
  customTab: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  safariView:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
};
const NEXT = '?next=%2Fjoin%2Fabcd2fghjkmn';
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function setAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function note() {
  return screen.getByRole('heading', { name: 'Откройте ссылку в Chrome или Safari' }).closest('section')!;
}

beforeEach(() => {
  auth.signInWithOAuth.mockReset();
  auth.signInWithPassword.mockReset();
  auth.signUp.mockReset();
  setAgent(UA.chrome);
});

afterEach(() => {
  cleanup();
  setAgent(UA.chrome);
});

describe.each([
  ['/login', 'Войти по почте можно и здесь.', 'Войти', 'Войти через Google', 'Email'],
  ['/register', 'Зарегистрироваться по почте можно и здесь.', 'Создать аккаунт', 'Продолжить с Google', 'Почта'],
])('%s inside a messenger', (page, mailLine, submit, google, emailLabel) => {
  it('in Telegram on Android: the /join note, the link with its way back into Chrome, no Google, e-mail stays', async () => {
    setAgent(UA.telegramAndroid);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt(`${page}${NEXT}`);
    const box = note();
    expect(plain(box.textContent)).toContain(
      'Это встроенный браузер Telegram. В таких браузерах Google обычно не даёт войти, а микрофон для ответов вслух может не работать.',
    );
    expect(plain(box.textContent)).toContain(mailLine);
    fireEvent.click(within(box).getByRole('button', { name: 'Скопировать ссылку' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${page}${NEXT}`));
    expect(await within(box).findByRole('button', { name: 'Ссылка скопирована' })).toBeInTheDocument();
    const chrome = within(box).getByRole('link', { name: 'Открыть в Chrome' });
    expect(chrome.getAttribute('href')).toMatch(
      new RegExp(`^intent://[^/]+${page}\\?next=%2Fjoin%2Fabcd2fghjkmn#Intent;scheme=https?;package=com\\.android\\.chrome;`),
    );
    expect(screen.queryByRole('button', { name: google })).toBeNull();
    expect(screen.queryByText(/^или/)).toBeNull();
    // E-mail stays, under the note.
    const button = screen.getByRole('button', { name: submit });
    expect(box.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText(emailLabel)).toBeInTheDocument();
  });

  it('in Telegram on iPhone (a web view without Safari): where to tap, no Chrome link, no Google', () => {
    setAgent(UA.telegramIos);
    renderAt(page);
    const box = note();
    expect(plain(box.textContent)).toContain('Это встроенный браузер приложения. В таких браузерах Google обычно не даёт войти');
    expect(plain(box.textContent)).toContain('Или нажмите «⋯» или «Поделиться» → «Открыть в Safari».');
    expect(within(box).queryByRole('link', { name: 'Открыть в Chrome' })).toBeNull();
    expect(screen.queryByRole('button', { name: google })).toBeNull();
  });

  it('in Viber the same, by its name', () => {
    setAgent(UA.viberAndroid);
    renderAt(page);
    expect(plain(note().textContent)).toContain('Это встроенный браузер Viber. В таких браузерах Google обычно не даёт войти');
    expect(screen.queryByRole('button', { name: google })).toBeNull();
  });

  it('in a real browser: Google as before, no note', () => {
    renderAt(`${page}${NEXT}`);
    expect(screen.getByRole('button', { name: google })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Откройте ссылку в Chrome или Safari' })).toBeNull();
  });

  it.each([
    ['a Chrome Custom Tab opened from Telegram', 'customTab'],
    ['SFSafariViewController opened from Telegram', 'safariView'],
  ] as const)('in %s: Google as in any browser, no note', (_name, agent) => {
    setAgent(UA[agent]);
    renderAt(`${page}${NEXT}`);
    expect(screen.getByRole('button', { name: google })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Откройте ссылку в Chrome или Safari' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/не даёт войти|встроенный браузер/);
  });
});
