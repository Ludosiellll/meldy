import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TelegramCard, {
  LINK_MS, POLL_MS, TELEGRAM_COPY, TelegramLinkWindow, TelegramRemindLink, clockWords, codeMoment, examLine, leadingExam, linkedByCode, pauseLine,
  timeLine,
} from './TelegramCard';
import { PHONE_QUERY } from '../../lib/usePhone';
import { danglingControls } from '../../test/a11y';

type Answer = { data?: unknown; error?: unknown; status?: number };

const db = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  handle: ((_name: string, _args: Record<string, unknown>) => ({ data: null })) as (name: string, args: Record<string, unknown>) => Answer,
}));
const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  fetchOverview: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      db.calls.push({ name, args });
      const run = () =>
        Promise.resolve().then(() => {
          const answer = db.handle(name, args);
          return { data: answer.data ?? null, error: answer.error ?? null, status: answer.status ?? 200 };
        });
      const query = {
        then: (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) => run().then(ok, fail),
        abortSignal: () => query,
      };
      return query;
    },
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock('../../api/containers', () => ({ fetchOverview: (...args: unknown[]) => mocks.fetchOverview(...args) }));

const HEX = '0123456789abcdef0123456789abcdef';
const URL_OF_CODE = `https://t.me/Meldyteach_bot?start=L${HEX}`;
const NOT_LINKED = { linked: false, bot_username: 'Meldyteach_bot' };
/** T1's contract, «Site»: linked a few seconds after the code of these tests (asked at 12:00:00Z, ends 12:15:00Z). */
const LINKED = {
  linked: true, linked_at: '2026-10-16T12:00:09Z', blocked: false, remind_on: true, remind_at: '20:00', tz: 'Europe/Minsk',
  paused_until: null, bot_username: 'Meldyteach_bot',
};
/** The exams list (containers_overview): the state names no exam, so the card reads it there. */
const OVERVIEW = {
  v: 1, day: '2026-10-16', attached_exam_ids: [],
  containers: [
    { id: 'c-1', title: 'Зимняя сессия', exam_date: '2027-01-20', subjects: [] },
    { id: 'c-2', title: 'Осенняя сессия', exam_date: null, subjects: [{ exam_date: '2026-11-03' }, { exam_date: '2026-11-05' }] },
  ],
};
/** The spec's data line (§6.4), word for word. */
const DATA_LINE =
  'Meldy хранит id вашего Telegram и чата с ботом и время напоминания — без имени и номера телефона. План и вопросы приходят через Telegram.';

const UA = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

const plain = (text: string | null | undefined) => (text ?? '').replace(/[\s ]+/g, ' ').trim();
const calls = (name: string) => db.calls.filter((call) => call.name === name);

/** The site's answers: the link state first, then a code, then the state the bot leaves. */
function server(states: Array<Record<string, unknown> | Answer>, extra: Partial<Record<string, (args: Record<string, unknown>) => Answer>> = {}) {
  const queue = [...states];
  db.handle = (name, args) => {
    if (extra[name]) return extra[name]!(args);
    if (name === 'telegram_link_start') return { data: { code: `L${HEX}`, expires_at: '2026-10-16T12:15:00Z', bot_username: 'Meldyteach_bot' } };
    if (name === 'telegram_link_state') {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      return 'linked' in next ? { data: next } : (next as Answer);
    }
    return { data: null };
  };
}

function setAgent(agent: string, touchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value: agent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

function setPhone(on: boolean) {
  if (!on) {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    return;
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => ({ matches: media === PHONE_QUERY, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

function setZone(name: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: name } as Intl.ResolvedDateTimeFormatOptions);
}

/** Lets the mocked requests answer and the timers run (fake timers). */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

/** A keyboard press: the focus is on the button first (a click alone does not move it in jsdom). */
function press(button: HTMLElement) {
  button.focus();
  fireEvent.click(button);
}

function show(ui = <TelegramCard />, path = '/profile') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

beforeEach(() => {
  // Friday, 16 October 2026, 15:00 in Minsk (the spec's example day).
  // Timers and the clock only: faking Intl too would bypass the zone spy below.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: new Date('2026-10-16T12:00:00Z') });
  db.calls.length = 0;
  mocks.user = { id: 'user-1' };
  mocks.fetchOverview.mockReset().mockResolvedValue(OVERVIEW);
  setAgent(UA.desktop);
  setPhone(false);
  setZone('Europe/Minsk');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setPhone(false);
});

describe('without the Telegram functions on the server', () => {
  it('shows nothing at all, as the containers’ old-client rule', async () => {
    for (const code of ['PGRST202', '42883']) {
      server([{ error: { code, message: 'Could not find the function public.telegram_link_state' }, status: 404 }]);
      const { container } = show();
      await tick();
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
    expect(calls('telegram_link_start')).toHaveLength(0);
  });

  it('hides itself when the code cannot be asked for either', async () => {
    server([NOT_LINKED], { telegram_link_start: () => ({ error: { code: 'PGRST202', message: 'no function' }, status: 404 }) });
    const { container } = show();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Подключить Telegram' }));
    await tick();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing while signed out', async () => {
    mocks.user = null;
    server([NOT_LINKED]);
    const { container } = show();
    await tick();
    expect(container).toBeEmptyDOMElement();
    expect(db.calls).toHaveLength(0);
  });
});

describe('not linked', () => {
  it('is a row of «Уведомления» with «Подключить Telegram», a white pill', async () => {
    server([NOT_LINKED]);
    const { container } = show();
    await tick();
    const card = container.querySelector('#telegram') as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByText(TELEGRAM_COPY.title)).toBeInTheDocument();
    expect(plain(card.textContent)).toContain(plain(TELEGRAM_COPY.about));
    const connect = within(card).getByRole('button', { name: 'Подключить Telegram' });
    expect(connect).toHaveClass('ac-btn');
    expect(connect).not.toHaveClass('ac-btn--blue');
    expect(card.querySelector('.sf-primary, .ac-btn--blue')).toBeNull();
    expect(calls('telegram_link_state')).toHaveLength(1);
    expect(calls('telegram_link_start')).toHaveLength(0);
  });

  it('on a computer shows the link as a QR code, opens Telegram on the computer, and says the data line', async () => {
    server([NOT_LINKED]);
    const { container } = show();
    await tick();
    press(screen.getByRole('button', { name: 'Подключить Telegram' }));
    await tick();
    expect(calls('telegram_link_start')).toEqual([{ name: 'telegram_link_start', args: { p_tz: 'Europe/Minsk' } }]);
    const qr = screen.getByRole('img', { name: TELEGRAM_COPY.qr });
    expect(qr.getAttribute('viewBox')).toBe('0 0 45 45');
    expect(qr.querySelector('path')!.getAttribute('d')).toMatch(/^M4 4h7v1h-7z/);
    const open = screen.getByRole('link', { name: 'Открыть Telegram на компьютере' });
    expect(open).toHaveAttribute('href', URL_OF_CODE);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    expect(open).toHaveFocus();
    expect(plain(container.textContent)).toContain(plain(TELEGRAM_COPY.scanStep));
    expect(plain(container.textContent)).toContain(plain(TELEGRAM_COPY.lifetime));
    expect(container.querySelector('[data-line="data"]')!.textContent).toBe(DATA_LINE);
    // No blue pill on a computer: the QR code is the step.
    expect(container.querySelector('.sf-primary')).toBeNull();
    expect(danglingControls()).toEqual([]);
  });

  it('on a phone opens Telegram with the one blue pill and no QR code', async () => {
    setAgent(UA.iphone, 5);
    setPhone(true);
    server([NOT_LINKED]);
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain(plain(TELEGRAM_COPY.aboutPhone));
    fireEvent.click(screen.getByRole('button', { name: 'Подключить Telegram' }));
    await tick();
    expect(screen.queryByRole('img', { name: TELEGRAM_COPY.qr })).toBeNull();
    const open = screen.getByRole('link', { name: 'Открыть Telegram' });
    expect(open).toHaveAttribute('href', URL_OF_CODE);
    expect(open).toHaveClass('sf-primary');
    expect(container.querySelectorAll('.sf-primary, .ac-btn--blue')).toHaveLength(1);
    expect(plain(container.textContent)).toContain(plain(TELEGRAM_COPY.appStep));
    expect(container.querySelector('[data-line="data"]')!.textContent).toBe(DATA_LINE);
  });

  it('says «Слишком много попыток» after five codes in an hour and keeps the button', async () => {
    server([NOT_LINKED], { telegram_link_start: () => ({ error: { code: 'MT001', message: 'more than 5 link codes in an hour' }, status: 400 }) });
    show();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Подключить Telegram' }));
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком много попыток. Попробуйте через час.');
    expect(screen.getByRole('button', { name: 'Подключить Telegram' })).toBeInTheDocument();
  });

  it('asks for one code at a time', async () => {
    server([NOT_LINKED]);
    show();
    await tick();
    const connect = screen.getByRole('button', { name: 'Подключить Telegram' });
    fireEvent.click(connect);
    fireEvent.click(connect);
    await tick();
    expect(calls('telegram_link_start')).toHaveLength(1);
  });

  it('says so when the state cannot be read, and reads it again on «Повторить», the row staying in place', async () => {
    server([{ error: { code: 'XX000', message: 'boom' }, status: 500 }, NOT_LINKED]);
    const { container } = show();
    await tick();
    expect(screen.getByText(TELEGRAM_COPY.readFailed)).toBeInTheDocument();
    press(screen.getByRole('button', { name: 'Повторить' }));
    // While it reads again the row stays, busy.
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('#telegram')).not.toBeNull();
    await tick();
    expect(screen.getByRole('button', { name: 'Подключить Telegram' })).toHaveFocus();
  });
});

describe('polling while the code waits', () => {
  async function waiting(states: Array<Record<string, unknown> | Answer>) {
    server([NOT_LINKED, ...states]);
    const view = show();
    await tick();
    press(screen.getByRole('button', { name: 'Подключить Telegram' }));
    await tick();
    expect(screen.getByRole('link', { name: 'Открыть Telegram на компьютере' })).toBeInTheDocument();
    return view;
  }

  it('asks every 3 s and shows the linked card when the bot has linked the account, then stops', async () => {
    const { container } = await waiting([NOT_LINKED, NOT_LINKED, LINKED]);
    expect(calls('telegram_link_state')).toHaveLength(1);
    await tick(POLL_MS - 1);
    expect(calls('telegram_link_state')).toHaveLength(1);
    await tick(1);
    expect(calls('telegram_link_state')).toHaveLength(2);
    await tick(POLL_MS);
    expect(calls('telegram_link_state')).toHaveLength(3);
    await tick(POLL_MS);
    expect(calls('telegram_link_state')).toHaveLength(4);
    expect(screen.getByText(TELEGRAM_COPY.linked)).toHaveFocus();
    // Heard, not shown twice: the title says it on screen.
    expect(screen.getByRole('status')).toHaveTextContent('Telegram подключён.');
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(plain(container.textContent)).toContain('План на день — в 20:00.');
    expect(plain(container.textContent)).toContain('Экзамен — «Осенняя сессия», 3 ноября.');
    expect(screen.queryByRole('img', { name: TELEGRAM_COPY.qr })).toBeNull();
    await tick(POLL_MS * 10);
    expect(calls('telegram_link_state')).toHaveLength(4);
  });

  it('shows a link made before this code without «Telegram подключён.» (linked_at is older than the code)', async () => {
    await waiting([{ ...LINKED, linked_at: '2026-10-16T11:40:00Z' }]);
    await tick(POLL_MS);
    expect(screen.getByText(TELEGRAM_COPY.linked)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('stops after 15 minutes and says the link has ended', async () => {
    await waiting([NOT_LINKED]);
    await tick(LINK_MS - 1);
    expect(calls('telegram_link_state').length).toBeGreaterThan(250);
    expect(screen.getByRole('link', { name: 'Открыть Telegram на компьютере' })).toBeInTheDocument();
    await tick(1);
    const asked = calls('telegram_link_state').length;
    expect(asked).toBeLessThanOrEqual(1 + LINK_MS / POLL_MS + 1);
    expect(screen.queryByRole('link', { name: 'Открыть Telegram на компьютере' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Ссылка устарела: она действует 15 минут.');
    expect(screen.getByRole('button', { name: 'Подключить Telegram' })).toHaveFocus();
    await tick(POLL_MS * 20);
    expect(calls('telegram_link_state')).toHaveLength(asked);
  });

  it('keeps asking through a failed request', async () => {
    await waiting([{ error: { code: 'XX000', message: 'boom' }, status: 503 }, { error: { code: '', message: '' }, status: 0 }, LINKED]);
    await tick(POLL_MS * 3);
    expect(screen.getByText(TELEGRAM_COPY.linked)).toBeInTheDocument();
  });

  it('stops when the card goes away', async () => {
    const { unmount } = await waiting([NOT_LINKED]);
    await tick(POLL_MS);
    const asked = calls('telegram_link_state').length;
    unmount();
    await tick(POLL_MS * 10);
    expect(calls('telegram_link_state')).toHaveLength(asked);
  });

  it('stops on «Отмена»', async () => {
    await waiting([NOT_LINKED]);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await tick();
    expect(screen.getByRole('button', { name: 'Подключить Telegram' })).toHaveFocus();
    const asked = calls('telegram_link_state').length;
    await tick(POLL_MS * 10);
    expect(calls('telegram_link_state')).toHaveLength(asked);
  });

  it('asks at once when the tab comes back from Telegram', async () => {
    await waiting([LINKED]);
    await tick(1000);
    expect(calls('telegram_link_state')).toHaveLength(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await tick();
    expect(calls('telegram_link_state')).toHaveLength(2);
    expect(screen.getByText(TELEGRAM_COPY.linked)).toBeInTheDocument();
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });

  it('hides the card when the functions disappear while it waits', async () => {
    const { container } = await waiting([{ error: { code: 'PGRST202', message: 'no function' }, status: 404 }]);
    await tick(POLL_MS);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('linked', () => {
  it('says the exam, the time and the data line, and «Отключить»', async () => {
    server([LINKED]);
    const { container } = show();
    await tick();
    // The state names no exam (T1's contract): the nearest date ahead in the exams list.
    expect(mocks.fetchOverview).toHaveBeenCalledWith('2026-10-16');
    const card = container.querySelector('#telegram') as HTMLElement;
    expect(within(card).getByText(TELEGRAM_COPY.linked)).toBeInTheDocument();
    const text = plain(card.textContent);
    expect(text).toContain('Экзамен — «Осенняя сессия», 3 ноября.');
    expect(text).toContain('План на день — в 20:00.');
    expect(text).not.toContain('Пауза');
    expect(text).toContain('Время и пауза — в боте: /settings.');
    expect(card.querySelector('[data-line="data"]')!.textContent).toBe(DATA_LINE);
    expect(within(card).getByRole('button', { name: 'Отключить' })).toHaveClass('ac-btn');
    expect(card.querySelector('.ac-row-i')).toHaveClass('ac-row-i--on');
  });

  it('uses the exam the state names, should the server add it, without reading the exams list', async () => {
    server([{ ...LINKED, exam: { title: 'Летняя сессия', date: '2027-06-10' } }]);
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain('Экзамен — «Летняя сессия», 10 июня.');
    expect(mocks.fetchOverview).not.toHaveBeenCalled();
  });

  it('says the pause until the first day the plan comes again', async () => {
    server([{ ...LINKED, paused_until: '2026-10-19' }]);
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain('Пауза до понедельника, 19 октября.');
    expect(plain(container.textContent)).toContain('План на день — в 20:00.');
  });

  it('says nothing of a pause that has ended', async () => {
    server([{ ...LINKED, paused_until: '2026-10-16' }]);
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).not.toContain('Пауза');
  });

  it('says when there is no exam with a plan, or no date', async () => {
    server([LINKED]);
    mocks.fetchOverview.mockResolvedValue({ ...OVERVIEW, containers: [{ id: 'c-0', title: 'Прошла', exam_date: '2026-06-01', subjects: [] }] });
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain('В Meldy пока нет экзамена с планом на день.');
    cleanup();
    mocks.fetchOverview.mockResolvedValue({ ...OVERVIEW, containers: [{ id: 'c-3', title: 'Осенняя сессия', exam_date: null, subjects: [] }] });
    const second = show();
    await tick();
    expect(plain(second.container.textContent)).toContain('Экзамен — «Осенняя сессия», дата не указана.');
  });

  it('leaves the exam out when the exams cannot be read, or the server has no exams', async () => {
    server([LINKED]);
    mocks.fetchOverview.mockRejectedValue(new Error('offline'));
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).not.toContain('Экзамен');
    expect(plain(container.textContent)).not.toContain('нет экзамена');
    cleanup();
    mocks.fetchOverview.mockResolvedValue(null);
    const second = show();
    await tick();
    expect(plain(second.container.textContent)).not.toContain('Экзамен');
    expect(plain(second.container.textContent)).toContain('План на день — в 20:00.');
  });

  it('asks before «Отключить», and unlinks', async () => {
    server([LINKED], { telegram_unlink: () => ({ data: NOT_LINKED }) });
    const { container } = show();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }));
    const ask = screen.getByRole('group', { name: TELEGRAM_COPY.ask });
    expect(screen.getByText(TELEGRAM_COPY.ask)).toHaveFocus();
    expect(plain(ask.textContent)).toContain('План перестанет приходить в Telegram. Экзамен и счёт останутся в Meldy.');
    const confirm = within(ask).getByRole('button', { name: 'Отключить' });
    expect(confirm).toHaveClass('ac-btn--danger');
    expect(screen.getAllByRole('button', { name: 'Отключить' })).toHaveLength(1);
    fireEvent.click(confirm);
    await tick();
    expect(calls('telegram_unlink')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Telegram отключён от Meldy.');
    expect(screen.getByRole('button', { name: 'Подключить Telegram' })).toBeInTheDocument();
    expect(container.querySelector('[data-line="data"]')).toBeNull();
  });

  it('keeps the link on «Отмена»', async () => {
    server([LINKED]);
    show();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await tick();
    expect(screen.queryByRole('group', { name: TELEGRAM_COPY.ask })).toBeNull();
    expect(screen.getByRole('button', { name: 'Отключить' })).toHaveFocus();
    expect(calls('telegram_unlink')).toHaveLength(0);
  });

  it('says when unlinking failed', async () => {
    server([LINKED], { telegram_unlink: () => ({ error: { code: '', message: '' }, status: 0 }) });
    show();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }));
    fireEvent.click(within(screen.getByRole('group', { name: TELEGRAM_COPY.ask })).getByRole('button', { name: 'Отключить' }));
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Нет сети');
    expect(screen.getByText(TELEGRAM_COPY.linked)).toBeInTheDocument();
  });

  it('says «План на день не приходит» after «Не присылать» and sends it again on the student’s word', async () => {
    server([{ ...LINKED, remind_on: false }], { telegram_settings: (args) => ({ data: { ...LINKED, remind_on: args.p_remind_on } }) });
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain('План на день не приходит.');
    expect(plain(container.textContent)).not.toContain('в 20:00');
    fireEvent.click(screen.getByRole('button', { name: 'Присылать снова' }));
    await tick();
    // Null keeps a value (T1's contract): only the switch is sent.
    expect(calls('telegram_settings')).toEqual([{ name: 'telegram_settings', args: { p_remind_on: true, p_remind_at: null, p_tz: null } }]);
    expect(plain(container.textContent)).toContain('План на день — в 20:00.');
  });

  it('says when the bot is blocked in Telegram and links its chat', async () => {
    server([{ ...LINKED, blocked: true }]);
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain('Бот остановлен в Telegram — план не приходит.');
    expect(screen.getByRole('link', { name: 'Открыть чат с ботом' })).toHaveAttribute('href', 'https://t.me/Meldyteach_bot');
  });

  it('names the zone when its clock is not the browser’s, and moves the plan to the browser’s', async () => {
    server([{ ...LINKED, tz: 'Asia/Vladivostok' }], { telegram_settings: (args) => ({ data: { ...LINKED, tz: args.p_tz } }) });
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain('План на день — в 20:00 по Владивостоку.');
    fireEvent.click(screen.getByRole('button', { name: (name) => plain(name) === 'Присылать в 20:00 по Минску' }));
    await tick();
    expect(calls('telegram_settings')[0].args).toEqual({ p_remind_on: null, p_remind_at: null, p_tz: 'Europe/Minsk' });
    expect(plain(container.textContent)).toContain('План на день — в 20:00.');
  });

  it('does not name a zone that shows the same clock (Moscow and Minsk)', async () => {
    server([{ ...LINKED, tz: 'Europe/Moscow' }]);
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).toContain('План на день — в 20:00.');
    expect(screen.queryByRole('button', { name: /Присылать в/ })).toBeNull();
  });

  it('keeps a phone to its lines without the hint about /settings', async () => {
    setAgent(UA.iphone, 5);
    setPhone(true);
    server([LINKED]);
    const { container } = show();
    await tick();
    expect(plain(container.textContent)).not.toContain('/settings');
    expect(container.querySelectorAll('.sf-primary, .ac-btn--blue')).toHaveLength(0);
  });
});

describe('the anchor #telegram', () => {
  it('brings the card into view when the profile is opened on it', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    server([NOT_LINKED]);
    show(<TelegramCard />, '/profile#telegram');
    await tick();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toHaveAttribute('id', 'telegram');
  });

  it('leaves the page where it is without the anchor', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    server([NOT_LINKED]);
    show();
    await tick();
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('«Напоминать в Telegram» at the end of the first session', () => {
  const calendar = <p>Напоминать каждый день</p>;

  it('keeps the calendar reminder while the bot is not on the server, or the state cannot be read', async () => {
    server([{ error: { code: 'PGRST202', message: 'no function' }, status: 404 }]);
    show(<TelegramRemindLink fallback={calendar} />);
    await tick();
    expect(screen.getByText('Напоминать каждый день')).toBeInTheDocument();
    expect(screen.queryByText(TELEGRAM_COPY.remind)).toBeNull();
    cleanup();
    server([{ error: { code: 'XX000', message: 'boom' }, status: 500 }]);
    show(<TelegramRemindLink fallback={calendar} />);
    await tick();
    expect(screen.getByText('Напоминать каждый день')).toBeInTheDocument();
  });

  it('says nothing once Telegram is linked', async () => {
    server([LINKED]);
    const { container } = show(<TelegramRemindLink fallback={calendar} />);
    await tick();
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the bot with a code from a quiet line; on a phone the pill is white', async () => {
    setAgent(UA.iphone, 5);
    setPhone(true);
    server([NOT_LINKED, NOT_LINKED, LINKED]);
    const { container } = show(<TelegramRemindLink fallback={calendar} />);
    await tick();
    expect(screen.queryByText('Напоминать каждый день')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TELEGRAM_COPY.remind }));
    await tick();
    const open = screen.getByRole('link', { name: 'Открыть Telegram' });
    expect(open).toHaveAttribute('href', URL_OF_CODE);
    expect(open).toHaveClass('ac-btn');
    expect(open).not.toHaveClass('sf-primary');
    expect(container.querySelector('.sf-primary, .ac-btn--blue')).toBeNull();
    expect(container.querySelector('[data-line="data"]')!.textContent).toBe(DATA_LINE);
    await tick(POLL_MS * 2);
    expect(screen.getByRole('status')).toHaveTextContent('Telegram подключён.');
  });

  it('shows the QR code on a computer', async () => {
    server([NOT_LINKED]);
    show(<TelegramRemindLink fallback={calendar} />);
    await tick();
    fireEvent.click(screen.getByRole('button', { name: TELEGRAM_COPY.remind }));
    await tick();
    expect(screen.getByRole('img', { name: TELEGRAM_COPY.qr })).toBeInTheDocument();
  });
});

describe('the link window of the exam page’s tip (TelegramLinkWindow)', () => {
  it('asks for a code once the state is read, and on a phone opens the bot with the blue «Открыть Telegram»', async () => {
    setAgent(UA.iphone, 5);
    setPhone(true);
    server([NOT_LINKED, NOT_LINKED, LINKED]);
    const onClose = vi.fn();
    const { container } = show(<TelegramLinkWindow onClose={onClose} />);
    // The read first: a code asked before it ends would race it.
    expect(calls('telegram_link_start')).toHaveLength(0);
    await tick();
    expect(calls('telegram_link_state').length).toBeGreaterThanOrEqual(1);
    expect(calls('telegram_link_start')).toHaveLength(1);
    const open = screen.getByRole('link', { name: 'Открыть Telegram' });
    expect(open).toHaveAttribute('href', URL_OF_CODE);
    expect(open).toHaveClass('sf-primary');
    expect(plain(container.textContent)).toContain('В Telegram откроется чат с Meldy — нажмите в нём «Запустить».');
    expect(container.querySelector('[data-line="data"]')!.textContent).toBe(DATA_LINE);
    expect(screen.queryByRole('img', { name: TELEGRAM_COPY.qr })).toBeNull();
    // The bot links the account: the window says so, with the plan's time; no second code.
    await tick(POLL_MS * 2);
    expect(screen.getByRole('status')).toHaveTextContent('Telegram подключён.');
    expect(plain(container.textContent)).toContain('План на день — в 20:00.');
    expect(calls('telegram_link_start')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on a computer shows the QR code and «Открыть Telegram на компьютере»; «Отмена» closes the window', async () => {
    server([NOT_LINKED]);
    const onClose = vi.fn();
    show(<TelegramLinkWindow onClose={onClose} />);
    await tick();
    expect(screen.getByRole('img', { name: TELEGRAM_COPY.qr })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TELEGRAM_COPY.openHere })).toHaveAttribute('href', URL_OF_CODE);
    fireEvent.click(screen.getByRole('button', { name: TELEGRAM_COPY.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('after the code’s 15 minutes says so and asks for a new one only on «Подключить Telegram»', async () => {
    server([NOT_LINKED]);
    show(<TelegramLinkWindow onClose={vi.fn()} />);
    await tick();
    expect(calls('telegram_link_start')).toHaveLength(1);
    await tick(LINK_MS + POLL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Ссылка устарела: она действует 15 минут.');
    expect(screen.queryByRole('link', { name: TELEGRAM_COPY.openHere })).toBeNull();
    expect(calls('telegram_link_start')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: TELEGRAM_COPY.connect }));
    await tick();
    expect(calls('telegram_link_start')).toHaveLength(2);
    expect(screen.getByRole('link', { name: TELEGRAM_COPY.openHere })).toBeInTheDocument();
  });

  it('says when no code can be had now, with the button to ask again', async () => {
    server([NOT_LINKED], { telegram_link_start: () => ({ error: { code: 'MT001' }, status: 400 }) });
    show(<TelegramLinkWindow onClose={vi.fn()} />);
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком много попыток. Попробуйте через час.');
    expect(screen.getByRole('button', { name: TELEGRAM_COPY.connect })).toBeInTheDocument();
    expect(calls('telegram_link_start')).toHaveLength(1);
  });

  it('says it when the account is linked already, without a code', async () => {
    server([LINKED]);
    show(<TelegramLinkWindow onClose={vi.fn()} />);
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Telegram подключён.');
    expect(calls('telegram_link_start')).toHaveLength(0);
  });

  it('says the bot is not there when the server has no Telegram functions', async () => {
    server([{ error: { code: 'PGRST202' }, status: 404 }]);
    const { container } = show(<TelegramLinkWindow onClose={vi.fn()} />);
    await tick();
    expect(plain(container.textContent)).toBe('Telegram пока не подключить: бот ещё не запущен.');
    expect(calls('telegram_link_start')).toHaveLength(0);
  });
});

describe('the words', () => {
  it('writes the bot’s lines: time, pause, exam', () => {
    expect(clockWords('07:30')).toBe('7:30');
    expect(clockWords('20:00')).toBe('20:00');
    expect(plain(timeLine('20:00', null))).toBe('План на день — в 20:00.');
    expect(plain(timeLine('07:30', 'Europe/Minsk'))).toBe('План на день — в 7:30 по Минску.');
    expect(plain(pauseLine('2026-10-19'))).toBe('Пауза до понедельника, 19 октября.');
    expect(plain(pauseLine('2026-10-21'))).toBe('Пауза до среды, 21 октября.');
    expect(plain(pauseLine('2026-10-25'))).toBe('Пауза до воскресенья, 25 октября.');
    expect(plain(examLine({ title: 'Осенняя сессия', date: '2026-11-03' }))).toBe('Экзамен — «Осенняя сессия», 3 ноября.');
    // A number holds on to its word.
    expect(pauseLine('2026-10-19')).toContain('19 октября');
  });

  it('tells a link made by this code from an older one, on the server’s clock', () => {
    const moment = codeMoment('2026-10-16T12:15:00Z');
    expect(moment).toBe(Date.parse('2026-10-16T12:00:00Z'));
    expect(linkedByCode('2026-10-16T12:00:09Z', moment)).toBe(true);
    expect(linkedByCode('2026-10-16T11:59:59Z', moment)).toBe(true);
    expect(linkedByCode('2026-10-16T11:40:00Z', moment)).toBe(false);
    expect(linkedByCode(null, moment)).toBe(true);
    expect(linkedByCode('2026-10-16T11:40:00Z', codeMoment(null))).toBe(true);
  });

  it('picks the exam the bot plans for: the nearest date ahead, else one without a date', () => {
    const today = '2026-10-16';
    expect(leadingExam([], today)).toBeNull();
    expect(leadingExam([{ title: 'Прошла', exam_date: '2026-10-01' }], today)).toBeNull();
    expect(leadingExam([{ title: 'Без даты', exam_date: null }, { title: 'Позже', exam_date: '2026-12-01' }], today)).toEqual({ title: 'Позже', date: '2026-12-01' });
    expect(leadingExam([{ title: 'Без даты', exam_date: null }, { title: 'Прошла', exam_date: '2026-10-01' }], today)).toEqual({ title: 'Без даты', date: null });
    expect(leadingExam([{ title: 'Сегодня', exam_date: '2026-10-16' }, { title: 'Завтра', exam_date: '2026-10-17' }], today)).toEqual({ title: 'Сегодня', date: '2026-10-16' });
    // Subjects with dates of their own: the exam's own date does not count («Сегодня» counts the same way).
    expect(
      leadingExam([{ title: 'Осенняя сессия', exam_date: '2026-11-01', subjects: [{ exam_date: '2026-11-03' }, { exam_date: '2026-11-05' }] }], today),
    ).toEqual({ title: 'Осенняя сессия', date: '2026-11-03' });
    expect(leadingExam([{ title: 'Осенняя сессия', exam_date: '2026-11-01', subjects: [{ exam_date: null }] }], today)).toEqual({
      title: 'Осенняя сессия', date: '2026-11-01',
    });
  });

  it('keeps to the copy rules: no «!», emoji, caps or the words the spec forbids', () => {
    const banned = /тест|контейнер|преподавател|колледж|аккредитац|пробн|правильный ответ|засчитан|сгорел|сгорит|повторени|на проверку|спорн/i;
    for (const line of Object.values(TELEGRAM_COPY)) {
      expect(line).not.toMatch(banned);
      expect(line).not.toContain('!');
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(line).not.toMatch(/[A-ZА-ЯЁ]{3,}/u);
      expect(line).not.toMatch(/"/);
    }
    expect(TELEGRAM_COPY.data).toBe(DATA_LINE);
  });
});
