import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  value: { user: { id: 'user-1', email: 'student@example.com', user_metadata: {} } as unknown, loading: false },
}));
const materials = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('./hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('./components/PWAUpdater', () => ({ default: () => null }));
vi.mock('./components/Layout', () => ({
  default: () => (
    <div data-testid="layout">
      <Outlet />
    </div>
  ),
}));
vi.mock('./pages/Exams', () => ({ default: () => <h1>Список экзаменов</h1> }));
vi.mock('./pages/ExamEditor', () => ({ default: () => <h1>Редактор экзамена</h1> }));
vi.mock('./pages/ExamDetail', () => ({ default: () => <h1>Лист экзамена</h1> }));
vi.mock('./pages/ExamDraw', () => ({ default: () => <h1>Тянуть билет</h1> }));
vi.mock('./pages/ExamTicket.tsx', () => ({ default: () => <h1>Экран ответа</h1> }));
vi.mock('./pages/ExamReport', () => ({ default: () => <h1>Отчёт для преподавателя</h1> }));
vi.mock('./pages/MistakeDiary', () => ({ default: () => <h1>Дневник ошибок</h1> }));
vi.mock('./pages/LectureTalk', () => ({ default: () => <h1>Разговор о лекции</h1> }));
vi.mock('./pages/Landing', () => ({ default: () => <h1>Главная</h1> }));
vi.mock('./pages/TryExample', () => ({ default: () => <h1>Пример экзамена</h1> }));
vi.mock('./pages/JoinGroup', () => ({ default: () => <h1>Приглашение в группу</h1> }));
vi.mock('./pages/Dashboard', () => ({ default: () => <h1>Сегодня</h1> }));
// The exam container's pages (packages D3a and D3b build them): here each is its heading, which names the route.
vi.mock('./pages/container/ImportPage', () => ({ default: () => <h1>Загрузка вопросов</h1> }));
vi.mock('./pages/container/ContainerPage', () => ({ default: () => <h1>Страница экзамена</h1> }));
vi.mock('./pages/container/SubjectPage', () => ({ default: () => <h1>Страница предмета</h1> }));
vi.mock('./pages/container/StudyPage', () => ({ default: () => <h1>Занятие</h1> }));
vi.mock('./pages/container/MockPage', () => ({ default: () => <h1>Как на экзамене</h1> }));
vi.mock('./pages/container/KeysPage', () => ({ default: () => <h1>Ключи</h1> }));
vi.mock('./pages/container/SettingsPage', () => ({ default: () => <h1>Настройки экзамена</h1> }));
vi.mock('./pages/container/JoinContainerPage', () => ({ default: () => <h1>Приглашение к экзамену</h1> }));
vi.mock('./components/authReel/AuthReel', () => ({ default: () => null }));
// The Mini App's own page has its tests (pages/TelegramMiniApp.test.tsx): here it is its heading.
vi.mock('./pages/TelegramMiniApp', () => ({ default: () => <h1>Вход через Telegram</h1> }));
vi.mock('./api/materials', () => ({
  getMaterials: vi.fn(async () => materials.list),
  deleteMaterial: vi.fn(),
  updateMaterialTitle: vi.fn(),
}));
const shelves = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('./api/exams', () => ({ listExamShelves: vi.fn(async () => shelves.list) }));
// «Лекции» also counts the cards from ticket answers; here none, and no request leaves the test.
vi.mock('./lib/followupCards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/followupCards')>()),
  followupCardsByLecture: vi.fn(async () => new Map()),
}));
vi.mock('./contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn(async () => false) }));

import App from './App';
import { bootMiniApp } from './lib/telegram/miniApp';
import { startMiniApp, stopMiniApp } from './test/telegramWebApp';

function openAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  auth.value = { user: { id: 'user-1', email: 'student@example.com', user_metadata: {} }, loading: false };
  materials.list = [];
  shelves.list = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('exam routes', () => {
  it.each([
    ['/exams', 'Список экзаменов'],
    ['/exams/exam-1', 'Лист экзамена'],
    ['/exams/exam-1/edit', 'Редактор экзамена'],
    ['/exams/exam-1/draw', 'Тянуть билет'],
    ['/exams/exam-1/report', 'Отчёт для преподавателя'],
  ])('%s renders inside the layout', async (path, heading) => {
    openAt(path);
    const page = await screen.findByRole('heading', { name: heading });
    expect(within(screen.getByTestId('layout')).getByRole('heading', { name: heading })).toBe(page);
  });

  it('routes /exams/:id/ticket to the answer screen inside the layout', async () => {
    openAt('/exams/exam-1/ticket?q=q-1&n=12');
    const layout = await screen.findByTestId('layout');
    // The answer screen comes from its own package; this checkout may not have it yet.
    expect(
      await within(layout).findByText(/Экран ответа|Экран ответа пока недоступен/),
    ).toBeInTheDocument();
  });
});

describe('the exam container routes', () => {
  const C = '3f2a9c4e-1b7d-4e8a-9c21-6d5f0a8b7e14';
  const S = '7c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';

  it.each([
    ['/exams/import', 'Загрузка вопросов'],
    [`/exams/c/${C}`, 'Страница экзамена'],
    [`/exams/c/${C}/s/${S}`, 'Страница предмета'],
    [`/exams/c/${C}/study?s=${S}&kind=answer&topic=2&only=errors`, 'Занятие'],
    [`/exams/c/${C}/mock?s=${S}`, 'Как на экзамене'],
    [`/exams/c/${C}/keys`, 'Ключи'],
    [`/exams/c/${C}/settings`, 'Настройки экзамена'],
    [`/exams/c/${C}/`, 'Страница экзамена'],
  ])('%s renders its page inside the layout', async (path, heading) => {
    openAt(path);
    const page = await screen.findByRole('heading', { name: heading });
    expect(within(screen.getByTestId('layout')).getByRole('heading', { name: heading })).toBe(page);
    expect(window.location.pathname).toBe(path.split('?')[0]);
  });

  it.each([
    [`/exams/c/${C}`, 'Страница экзамена'],
    // /exams/c/<x> ties with /exams/:id/<x> in rank: the container route is listed first and wins.
    ['/exams/c/draw', 'Страница экзамена'],
    ['/exams/c/ticket', 'Страница экзамена'],
    ['/exams/c/report', 'Страница экзамена'],
    ['/exams/c/edit', 'Страница экзамена'],
    [`/exams/c/${C}/s/${S}`, 'Страница предмета'],
  ])('%s never reaches an oral exam page', async (path, heading) => {
    openAt(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    for (const oral of ['Лист экзамена', 'Редактор экзамена', 'Тянуть билет', 'Экран ответа', 'Отчёт для преподавателя']) {
      expect(screen.queryByRole('heading', { name: oral })).toBeNull();
    }
  });

  it.each([`/exams/c/${C}/edit`, `/exams/c/${C}/draw`, `/exams/c/${C}/s`, `/exams/c/${C}/s/${S}/mock`])(
    '%s is no page of its own and leads to the start page, never to an oral page',
    async (path) => {
      openAt(path);
      expect(await screen.findByRole('heading', { name: 'Главная' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/');
    },
  );

  it('keeps every oral exam address where it was', async () => {
    for (const [path, heading] of [
      [`/exams/${C}`, 'Лист экзамена'],
      [`/exams/${C}/edit`, 'Редактор экзамена'],
      [`/exams/${C}/draw?from=c:${C}`, 'Тянуть билет'],
      [`/exams/${C}/report`, 'Отчёт для преподавателя'],
    ] as const) {
      openAt(path);
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      cleanup();
      window.history.pushState({}, '', '/');
    }
  });

  it('sends the old «Новый экзамен» address to the import page, with its query and hash, in place', async () => {
    openAt('/exams/new?from=try#lectures');
    expect(await screen.findByRole('heading', { name: 'Загрузка вопросов' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/exams/import');
    expect(window.location.search).toBe('?from=try');
    expect(window.location.hash).toBe('#lectures');
    expect(screen.queryByRole('heading', { name: 'Редактор экзамена' })).toBeNull();
  });

  it('replaces /exams/new in the history: «назад» does not bounce through it', async () => {
    window.history.pushState({}, '', '/dashboard');
    const before = window.history.length;
    openAt('/exams/new');
    expect(await screen.findByRole('heading', { name: 'Загрузка вопросов' })).toBeInTheDocument();
    // openAt pushed /exams/new once; the redirect replaced that entry instead of adding /exams/import after it.
    expect(window.history.length).toBe(before + 1);
    expect(window.location.pathname).toBe('/exams/import');
  });

  it('a signed-out visitor of the import page or a container page signs in and comes back to it', async () => {
    auth.value = { user: null, loading: false };
    for (const path of ['/exams/import', `/exams/c/${C}/study?s=${S}`, '/exams/new?x=1']) {
      openAt(path);
      expect(await screen.findByRole('heading', { name: 'Продолжить подготовку' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/login');
      const back = path === '/exams/new?x=1' ? '/exams/import?x=1' : path;
      expect(new URLSearchParams(window.location.search).get('next')).toBe(back);
      cleanup();
      window.history.pushState({}, '', '/');
    }
  });

  it.each([
    ['a guest', null],
    ['a signed-in student', { id: 'user-1', email: 'student@example.com', user_metadata: {} }],
  ])('/g/:code opens for %s without the sign-in wall and outside the app layout', async (_who, user) => {
    auth.value = { user, loading: false };
    openAt('/g/abcd2fghjkmn');
    expect(await screen.findByRole('heading', { name: 'Приглашение к экзамену' })).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).toBeNull();
    expect(window.location.pathname).toBe('/g/abcd2fghjkmn');
  });
});

describe('lecture routes', () => {
  it('routes /library/:id/talk to the voice tutor inside the layout', async () => {
    openAt('/library/m-1/talk');
    const page = await screen.findByRole('heading', { name: 'Разговор о лекции' });
    expect(within(screen.getByTestId('layout')).getByRole('heading', { name: 'Разговор о лекции' })).toBe(page);
  });
});

describe('removed sections', () => {
  it.each([
    '/exam',
    '/mood',
    '/network',
    '/career',
    '/messages/user-2',
    '/assignment/a-1',
    '/co-study/room-1',
    '/courses',
    '/planner',
    '/chat',
    '/play',
    '/teacher',
    '/study-session',
    '/pricing',
    '/quick-prep',
    '/profile/user-2',
    '/shorts/m-1',
    '/hh-callback',
  ])('%s leads to the start page', async (path) => {
    openAt(path);
    expect(await screen.findByRole('heading', { name: 'Главная' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByTestId('layout')).toBeNull();
  });
});

describe('loaders', () => {
  it('shows the canvas-coloured route loader while the session is checked', () => {
    auth.value = { user: null, loading: true };
    const { container } = openAt('/exams');
    const loader = screen.getByRole('status', { name: 'Загрузка страницы' });
    expect(loader.className).toContain('bg-[var(--sf-canvas)]');
    expect(container.innerHTML).not.toContain('bg-slate-900');
    expect(container.innerHTML).not.toContain('07111f');
  });

  it('uses the same loader while a lazy page loads', async () => {
    const { container } = openAt('/mistakes');
    const loader = screen.getByRole('status', { name: 'Загрузка страницы' });
    expect(loader.className).toContain('bg-[var(--sf-canvas)]');
    expect(container.innerHTML).not.toContain('07111f');
    expect(await screen.findByRole('heading', { name: 'Дневник ошибок' })).toBeInTheDocument();
  });
});

describe('library', () => {
  it('labels a lecture imported as plain text instead of promising a summary', async () => {
    materials.list = [
      {
        id: 'm-text',
        title: 'Лекция 5. Денежный рынок',
        subject: '',
        created_at: '2026-10-02T09:00:00Z',
        original_text: 'Текст лекции',
        summary_json: { text_only: true },
        flashcards_json: { flashcards: [] },
        quiz_json: { quiz: [] },
      },
      {
        id: 'm-full',
        title: 'Эластичность спроса',
        subject: 'Микроэкономика',
        created_at: '2026-10-01T09:00:00Z',
        original_text: 'Текст',
        summary_json: { content: 'Конспект лекции' },
        flashcards_json: { flashcards: [{ question: 'Что такое эластичность?', answer: 'Отношение изменений' }] },
        quiz_json: { quiz: [] },
      },
    ];
    openAt('/library');
    expect(await screen.findByText('только текст, конспекта нет')).toBeInTheDocument();
    expect(screen.getAllByText('только текст, конспекта нет')).toHaveLength(1);
    expect(screen.getByText('конспект · 1 карточка')).toBeInTheDocument();
  });

  it('is the course’s table of contents: one exam is the page, lectures in the order they were added, no chips or capitals', async () => {
    materials.list = [
      { id: 'm-1', title: 'Спрос и предложение', subject: 'Экономика', created_at: '2026-09-08T09:00:00Z', summary_json: { content: 'Конспект', podcast: [{ text: 'Реплика' }] }, flashcards_json: { flashcards: [{}, {}] }, quiz_json: { quiz: [{}] } },
      { id: 'm-2', title: 'Эластичность спроса', subject: 'Экономика', created_at: '2026-09-15T09:00:00Z', summary_json: { text_only: true }, flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] } },
    ];
    shelves.list = [
      {
        id: 'exam-1',
        title: 'Экзамен: микроэкономика',
        kind: 'exam',
        exam_date: '2026-10-15',
        created_at: '2026-10-01T00:00:00Z',
        materials: [
          { id: 'm-1', addedAt: '2026-10-01T09:00:00Z' },
          { id: 'm-2', addedAt: '2026-10-01T09:00:00Z' },
        ],
      },
    ];
    const { container } = openAt('/library');
    expect(await screen.findByRole('heading', { level: 1, name: 'Микроэкономика' })).toBeInTheDocument();
    expect(screen.getByText('Экзамен 15 октября · 2 лекции: 1 разобрана, 1 загружена только текстом · 2 карточки')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/exam-1');
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('link').getAttribute('href'))).toEqual(['/library/m-1', '/library/m-2']);
    expect(within(rows[0]).getByText('конспект · 2 карточки · тест · подкаст')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/uppercase|tracking-wider|Только для меня|Пакетный выбор|Статистика/);
    expect(screen.queryByText('Экономика')).toBeNull();
  });
});

describe('the example exam (/try)', () => {
  it.each([
    ['a guest', null],
    ['a signed-in student', { id: 'user-1', email: 'student@example.com', user_metadata: {} }],
  ])('opens for %s without the sign-in wall and outside the app layout, its steps included', async (_who, user) => {
    auth.value = { user, loading: false };
    openAt('/try/draw');
    expect(await screen.findByRole('heading', { name: 'Пример экзамена' })).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).toBeNull();
  });
});

describe('signing in and coming back (lib/returnTo)', () => {
  it('a signed-out visitor of a private page goes to sign in with that page as the way back', async () => {
    auth.value = { user: null, loading: false };
    openAt('/exams/exam-1?view=sheet');
    expect(await screen.findByRole('heading', { name: 'Продолжить подготовку' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/exams/exam-1?view=sheet');
  });

  it('the report for the teacher is signed-in only: a signed-out visitor signs in and comes back to it', async () => {
    auth.value = { user: null, loading: false };
    openAt('/exams/exam-1/report');
    expect(await screen.findByRole('heading', { name: 'Продолжить подготовку' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/exams/exam-1/report');
    expect(screen.queryByRole('heading', { name: 'Отчёт для преподавателя' })).toBeNull();
  });

  it('«Сегодня» signed out leads to the plain sign-in page, as before', async () => {
    auth.value = { user: null, loading: false };
    openAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Продолжить подготовку' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('');
  });

  it('/join/:code opens without the sign-in wall and outside the app layout', async () => {
    auth.value = { user: null, loading: false };
    openAt('/join/abcd2fghjkmn');
    expect(await screen.findByRole('heading', { name: 'Приглашение в группу' })).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).toBeNull();
    expect(window.location.pathname).toBe('/join/abcd2fghjkmn');
  });

  it('a group link waiting on this device takes over when the sign-in comes back to «Сегодня»', async () => {
    window.localStorage.setItem('meldy_join_pending', JSON.stringify({ code: 'abcd2fghjkmn', at: Date.now() }));
    openAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Приглашение в группу' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/join/abcd2fghjkmn');
  });

  it('with nothing waiting (or a stale code) «Сегодня» stays', async () => {
    window.localStorage.setItem('meldy_join_pending', JSON.stringify({ code: 'abcd2fghjkmn', at: Date.now() - 3 * 24 * 3600 * 1000 }));
    openAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Сегодня' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dashboard');
  });
});

describe('Meldy as a Telegram Mini App (/tg)', () => {
  afterEach(() => {
    stopMiniApp();
    for (const script of Array.from(document.head.querySelectorAll('script'))) script.remove();
  });

  it('/tg opens without the sign-in wall and outside the app layout', async () => {
    auth.value = { user: null, loading: false };
    await startMiniApp();
    openAt('/tg?c=69ead689-38d6-4350-bc5d-13d273f8b9b2');
    expect(await screen.findByRole('heading', { name: 'Вход через Telegram' })).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).toBeNull();
    expect(window.location.pathname).toBe('/tg');
  });

  it('inside Telegram a signed-out private page goes to Telegram\'s sign-in, not to the site\'s', async () => {
    auth.value = { user: null, loading: false };
    // A tab /tg marked: Telegram reloaded the Mini App on a page inside it.
    window.sessionStorage.setItem('meldy_tg', '1');
    await startMiniApp(undefined, '/exams');
    openAt('/exams');
    expect(await screen.findByRole('heading', { name: 'Вход через Telegram' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/tg');
  });

  it('while Telegram\'s script loads it waits; a visit that is not Telegram\'s goes to the site\'s sign-in', async () => {
    auth.value = { user: null, loading: false };
    window.sessionStorage.setItem('meldy_tg', '1');
    const booting = bootMiniApp('/exams');
    openAt('/exams');
    expect(screen.getByRole('status', { name: 'Загрузка страницы' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/exams');
    await act(async () => {
      document.head.querySelector('script[src*="telegram.org"]')?.dispatchEvent(new Event('error'));
      await booting;
    });
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });

  it('inside Telegram files are added on the site: the import page says so and opens it in the browser', async () => {
    const webApp = await startMiniApp(undefined, '/tg');
    openAt('/exams/import?from=c:abc');
    expect(await screen.findByRole('heading', { name: 'Загружать файлы удобнее на сайте' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Загрузка вопросов' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть сайт в браузере' }));
    expect(webApp.openLink).toHaveBeenCalledWith(`${window.location.origin}/exams/import?from=c:abc`);
  });

  it('outside Telegram nothing of it shows: no script, no class, the import page as it is', async () => {
    openAt('/exams/import');
    expect(await screen.findByRole('heading', { name: 'Загрузка вопросов' })).toBeInTheDocument();
    expect(document.head.querySelector('script[src*="telegram.org"]')).toBeNull();
    expect(document.documentElement.classList.contains('tg-mode')).toBe(false);
  });
});
