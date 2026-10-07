import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  state: { user: null as null | { id: string }, loading: false },
  signInWithOAuth: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: auth.state.user, loading: auth.state.loading, requestSession: vi.fn() }),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => auth.signInWithOAuth(...args),
      signInWithPassword: (...args: unknown[]) => auth.signInWithPassword(...args),
    },
  },
}));
vi.mock('../components/authReel/AuthReel', () => ({ default: () => null }));

import JoinGroup from './JoinGroup';
import Login from './Login';
import { GUIDE_LATER_KEY } from '../components/guide/guideLater';
import { JOIN_PENDING_KEY } from '../lib/returnTo';
import { storedGroupLinks } from '../lib/groups/groupLinks';

const CODE = 'abcd2fghjkmn';
const COPY = '0f8c9a52-3b1e-4c6d-9a7f-2e5b8c1d4a60';
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  telegramAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.2',
  webviewIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};
const ACTIVE = { status: 'active', title: 'Макроэкономика', kind: 'exam', exam_date: '2026-11-10', questions: 40, lectures: 3 };

let location = '';
function Where() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The backend of a group link: the preview and the join, as the server answers them. */
function server(options: { preview?: unknown; join?: Array<[number, unknown]> } = {}) {
  const joins = [...(options.join ?? [[200, { exam_id: COPY, joined: true, questions: 40, lectures: 3, without_points: 0 }]])];
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/exam-shares/preview') {
      // The code travels in the body, never in the address (addresses are logged).
      expect(JSON.parse(String(init?.body))).toEqual({ code: CODE });
      return json(200, options.preview ?? ACTIVE);
    }
    if (url === '/api/exam-shares/join') {
      const [status, body] = joins.length > 1 ? joins.shift()! : joins[0];
      return json(status, body);
    }
    return json(404, { detail: 'Нет такого адреса' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

function setAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join/:code" element={<JoinGroup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/exams/:id" element={<p>Копия экзамена</p>} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  auth.state = { user: null, loading: false };
  auth.signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.signInWithPassword.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  setAgent(UA.chrome);
  location = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/join/<код> signed out', () => {
  it('tells the exam and offers Google first, e-mail second, both bringing the visitor back', async () => {
    const { calls } = server();
    renderAt(`/join/${CODE}`);
    const heading = await screen.findByRole('heading', { level: 1, name: /Вас пригласили/ });
    expect(plain(heading.textContent)).toBe('Вас пригласили готовиться к экзамену «Макроэкономика» в Meldy');
    expect(plain(document.querySelector('.jg-meta')?.textContent)).toBe('40 вопросов · 3 лекции · экзамен 10 ноября');
    // Each part holds together (a phone broke «экзамен 10 / ноября»); a row breaks only after a dot.
    expect(document.querySelector('.jg-meta')?.textContent).toBe('40\u00a0вопросов\u00a0· 3\u00a0лекции\u00a0· экзамен\u00a010\u00a0ноября');
    const google = screen.getByRole('button', { name: 'Войти через Google' });
    const mail = screen.getByRole('link', { name: 'Войти по почте' });
    expect(google.compareDocumentPosition(mail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mail).toHaveAttribute('href', `/login?next=%2Fjoin%2F${CODE}`);
    expect(screen.getByRole('link', { name: 'Создать аккаунт' })).toHaveAttribute('href', `/register?next=%2Fjoin%2F${CODE}`);
    expect(screen.queryByRole('heading', { name: 'Откройте ссылку в Chrome или Safari' })).toBeNull();
    expect(calls).toEqual(['POST /api/exam-shares/preview']);

    fireEvent.click(google);
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Fjoin%2F${CODE}` },
    });
    // The code also waits on this device, in case the sign-in comes back to another page.
    expect(JSON.parse(window.localStorage.getItem(JOIN_PENDING_KEY) ?? '{}').code).toBe(CODE);
  });

  it('inside Telegram on Android asks for Chrome or Safari, copies the link and opens it in Chrome', async () => {
    setAgent(UA.telegramAndroid);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    server();
    renderAt(`/join/${CODE}`);
    const note = (await screen.findByRole('heading', { name: 'Откройте ссылку в Chrome или Safari' })).closest('section')!;
    expect(plain(note.textContent)).toContain('Во встроенном браузере Telegram Google не даёт войти');
    fireEvent.click(within(note).getByRole('button', { name: 'Скопировать ссылку' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/${CODE}`));
    expect(await within(note).findByRole('button', { name: 'Ссылка скопирована' })).toBeInTheDocument();
    const chrome = within(note).getByRole('link', { name: 'Открыть в Chrome' });
    // The site is https (jsdom runs on http): the same address, in Chrome.
    expect(chrome.getAttribute('href')).toMatch(new RegExp(`^intent://[^#]+/join/${CODE}#Intent;scheme=https?;package=com\\.android\\.chrome;`));
    expect(chrome.getAttribute('href')).toMatch(/;end$/);
    // Google refuses inside the app: only e-mail is offered, under the note.
    expect(screen.queryByRole('button', { name: 'Войти через Google' })).toBeNull();
    const mail = screen.getByRole('link', { name: 'Войти по почте здесь' });
    expect(note.compareDocumentPosition(mail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('inside an iPhone app tells where to tap', async () => {
    setAgent(UA.webviewIos);
    server();
    renderAt(`/join/${CODE}`);
    const note = (await screen.findByRole('heading', { name: 'Откройте ссылку в Chrome или Safari' })).closest('section')!;
    expect(plain(note.textContent)).toContain('Во встроенном браузере приложения Google не даёт войти');
    expect(plain(note.textContent)).toContain('Или нажмите «⋯» или «Поделиться» → «Открыть в Safari».');
    expect(within(note).queryByRole('link', { name: 'Открыть в Chrome' })).toBeNull();
  });

  it('says a closed, expired or full link plainly and offers nothing to sign in', async () => {
    for (const [status, words] of [
      ['revoked', 'Автор закрыл эту ссылку. Попросите у него новую.'],
      ['expired', 'Срок действия ссылки закончился. Попросите у автора новую.'],
      ['full', 'По этой ссылке мест больше нет: все места заняты.'],
      ['not_found', 'Ссылка не найдена. Проверьте, что она скопирована целиком.'],
    ] as const) {
      server({ preview: { status } });
      renderAt(`/join/${CODE}`);
      expect(plain((await screen.findByRole('alert')).textContent)).toBe(words);
      expect(screen.getByRole('heading', { level: 1, name: 'Приглашение не открылось' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Войти через Google' })).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('refuses a broken code without asking the server', async () => {
    const { calls } = server();
    renderAt('/join/not-a-code');
    expect(plain((await screen.findByRole('alert')).textContent)).toBe('Ссылка неполная. Проверьте, что она скопирована целиком.');
    expect(calls).toEqual([]);
  });
});

describe('/join/<код> signed in', () => {
  it('joins at once and opens the copy on its cheat sheet; the mandatory guide waits', async () => {
    auth.state = { user: { id: 'student-1' }, loading: false };
    const { calls } = server();
    window.localStorage.setItem(JOIN_PENDING_KEY, JSON.stringify({ code: CODE, at: Date.now() }));
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('Копия экзамена')).toBeInTheDocument();
    expect(location).toBe(`/exams/${COPY}?view=sheet`);
    expect(calls).toEqual(['POST /api/exam-shares/preview', 'POST /api/exam-shares/join']);
    expect(window.sessionStorage.getItem(GUIDE_LATER_KEY)).toBe('1');
    expect(window.localStorage.getItem(JOIN_PENDING_KEY)).toBeNull();
  });

  it('opens the copy made before (joining again)', async () => {
    auth.state = { user: { id: 'student-1' }, loading: false };
    server({ preview: { status: 'joined', exam_id: COPY, title: 'Макроэкономика' }, join: [[200, { exam_id: COPY, joined: false }]] });
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('Копия экзамена')).toBeInTheDocument();
    expect(location).toBe(`/exams/${COPY}?view=sheet`);
  });

  it('a final refusal is said once; a server hiccup offers another try', async () => {
    auth.state = { user: { id: 'student-1' }, loading: false };
    server({ join: [[409, { detail: 'По этой ссылке уже вошли 80 человек — мест больше нет.', code: 'link_full' }]] });
    renderAt(`/join/${CODE}`);
    expect(plain((await screen.findByRole('alert')).textContent)).toBe('По этой ссылке уже вошли 80 человек — мест больше нет.');
    expect(screen.queryByRole('button', { name: 'Попробовать ещё раз' })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    const { calls } = server({
      join: [
        [503, { detail: 'Не удалось открыть экзамен по ссылке. Попробуйте через минуту.', code: 'read_failed' }],
        [200, { exam_id: COPY, joined: true, without_points: 0 }],
      ],
    });
    renderAt(`/join/${CODE}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Попробовать ещё раз' }));
    expect(await screen.findByText('Копия экзамена')).toBeInTheDocument();
    expect(calls.filter((call) => call === 'POST /api/exam-shares/join')).toHaveLength(2);
  });

  it('the author opening their own link gets the exam, not a copy', async () => {
    auth.state = { user: { id: 'author-1' }, loading: false };
    const { calls } = server({ preview: { ...ACTIVE, status: 'own', exam_id: COPY } });
    renderAt(`/join/${CODE}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Это ваша ссылка' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть экзамен' })).toHaveAttribute('href', `/exams/${COPY}`);
    expect(calls).not.toContain('POST /api/exam-shares/join');
  });

  it('the author on their own open link: this device keeps it for «Вопрос дня»; a closed one is not kept', async () => {
    auth.state = { user: { id: 'author-1' }, loading: false };
    server({ preview: { ...ACTIVE, status: 'own', exam_id: COPY, link: 'active' } });
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('На этом устройстве Meldy запомнил ссылку: «Вопрос дня» теперь копируется вместе с ней.')).toBeInTheDocument();
    expect(storedGroupLinks(COPY)).toEqual([{ code: CODE, share: null }]);
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();

    server({ preview: { ...ACTIVE, status: 'own', exam_id: COPY, link: 'revoked' } });
    renderAt(`/join/${CODE}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Вы закрыли эту ссылку' })).toBeInTheDocument();
    expect(storedGroupLinks(COPY)).toEqual([]);
    expect(screen.queryByText(/Meldy запомнил ссылку/)).toBeNull();
  });

  it('the author on their own closed or expired link sees that it is closed and where to make a new one', async () => {
    // Live run of 2026-10-07: a revoked link still told its author «Однокурсники, которые по ней войдут…».
    for (const [link, heading, words] of [
      ['active', 'Это ваша ссылка', 'Однокурсники, которые по ней войдут, получат свою копию экзамена «Макроэкономика».'],
      ['revoked', 'Вы закрыли эту ссылку', 'По ней больше никто не войдёт. Кто уже вошёл, остался со своей копией экзамена «Макроэкономика». Новую ссылку можно сделать на странице экзамена — кнопка «Пригласить группу».'],
      ['expired', 'Срок вашей ссылки закончился', 'По ней больше никто не войдёт. Кто уже вошёл, остался со своей копией экзамена «Макроэкономика». Новую ссылку можно сделать на странице экзамена — кнопка «Пригласить группу».'],
      [undefined, 'Это ваша ссылка', 'пока ссылка открыта. Закрыть её или сделать новую можно на странице экзамена — кнопка «Пригласить группу».'],
    ] as const) {
      auth.state = { user: { id: 'author-1' }, loading: false };
      const { calls } = server({ preview: { ...ACTIVE, status: 'own', exam_id: COPY, ...(link ? { link } : {}) } });
      renderAt(`/join/${CODE}`);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(plain(document.querySelector('.au-lede')?.textContent)).toContain(words);
      if (link !== 'active') expect(plain(document.body.textContent)).not.toContain('которые по ней войдут');
      expect(screen.getByRole('link', { name: 'Открыть экзамен' })).toHaveAttribute('href', `/exams/${COPY}`);
      expect(calls).not.toContain('POST /api/exam-shares/join');
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('a closed link or the own one lets the waiting code go: «Сегодня» does not send the visitor back here', async () => {
    for (const [preview, heading] of [
      [{ status: 'revoked' }, 'Приглашение не открылось'],
      [{ ...ACTIVE, status: 'own', exam_id: COPY }, 'Это ваша ссылка'],
    ] as const) {
      auth.state = { user: { id: 'student-1' }, loading: false };
      window.localStorage.setItem(JOIN_PENDING_KEY, JSON.stringify({ code: CODE, at: Date.now() }));
      const { calls } = server({ preview });
      renderAt(`/join/${CODE}`);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(window.localStorage.getItem(JOIN_PENDING_KEY)).toBeNull();
      expect(calls).not.toContain('POST /api/exam-shares/join');
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('the way back: link → sign in by e-mail → the copy', () => {
  it('signs in on /login?next=… and lands on the copy of the exam', async () => {
    const { calls } = server();
    auth.signInWithPassword.mockImplementation(async () => {
      auth.state = { user: { id: 'student-1' }, loading: false };
      return { data: {}, error: null };
    });
    renderAt(`/join/${CODE}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Войти по почте' }));
    expect(location).toBe(`/login?next=%2Fjoin%2F${CODE}`);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret-pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Копия экзамена')).toBeInTheDocument();
    expect(location).toBe(`/exams/${COPY}?view=sheet`);
    expect(calls).toContain('POST /api/exam-shares/join');
  });

  it('never follows a way back off the site', async () => {
    auth.signInWithPassword.mockImplementation(async () => {
      auth.state = { user: { id: 'student-1' }, loading: false };
      return { data: {}, error: null };
    });
    renderAt('/login?next=https%3A%2F%2Fevil.example%2Fjoin');
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalled());
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret-pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(location).toBe('/dashboard'));
  });
});
