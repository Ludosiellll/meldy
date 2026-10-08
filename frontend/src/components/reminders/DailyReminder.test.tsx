import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DailyReminder, { profileReminderNote } from './DailyReminder';
import { PHONE_QUERY } from '../../lib/usePhone';
import { reminderUid } from '../../lib/reminders/ics';
import { REMINDER_PREFIX } from '../../lib/reminders/dailyReminder';
import { danglingControls } from '../../test/a11y';

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  leadingExamId: vi.fn(),
  user: { id: 'user-1' } as { id: string } | null,
}));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock('../../lib/telemetry', () => ({ track: (...args: unknown[]) => mocks.track(...args) }));
vi.mock('../../lib/exams/leading', () => ({ leadingExamId: (...args: unknown[]) => mocks.leadingExamId(...args) }));

const UA = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  telegram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Telegram-Android/11.2.3',
};

const plain = (text: string | null | undefined) => (text ?? '').replace(/[\s ]+/g, ' ').trim();

let files: Blob[];
let clicks: Array<{ href: string; download: string }>;

function setAgent(agent: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: agent, configurable: true });
}

/** The device's zone: Minsk (UTC+3 all year) unless a test says otherwise. */
function setZone(name: string, offsets: (moment: Date) => number) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: name } as Intl.ResolvedDateTimeFormatOptions);
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
    return offsets(this);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 7, 14, 30) });
  window.localStorage.clear();
  mocks.user = { id: 'user-1' };
  mocks.track.mockReset();
  mocks.leadingExamId.mockReset().mockResolvedValue('e-leading');
  files = [];
  clicks = [];
  setAgent(UA.desktop);
  setZone('Europe/Minsk', () => -180);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      files.push(blob);
      return `blob:http://localhost/${files.length}`;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function lastFile(): Promise<string> {
  expect(files.length).toBeGreaterThan(0);
  const blob = files[files.length - 1];
  expect(blob.type).toBe('text/calendar;charset=utf-8');
  return blob.text();
}

describe('«Напоминать каждый день» on «Сегодня»', () => {
  it('picks a time, downloads one daily event and says what to do next; the line remembers the time', async () => {
    render(<DailyReminder variant="today" examId="e-1" />);
    const open = screen.getByRole('button', { name: 'Напоминать каждый день' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(danglingControls()).toEqual([]);
    fireEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('group', { name: 'Напоминать каждый день' });
    expect(open).toHaveAttribute('aria-controls', panel.id);
    const times = within(panel).getByRole('group', { name: 'Во сколько напоминать' });
    expect(within(times).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(['19:00', '20:00', '21:00', 'custom']);
    expect(within(times).getByRole('radio', { name: '20:00' })).toBeChecked();
    // The event as the calendar will list it.
    expect(plain(panel.querySelector('.rm-event')?.textContent)).toBe('В календаре: 20:00–20:15Meldy: ответить на билетКаждый день · уведомление в 20:00'.replace(/\s+/g, ' '));
    fireEvent.click(within(times).getByRole('radio', { name: '21:00' }));
    expect(plain(panel.querySelector('.rm-event-time')?.textContent)).toBe('В календаре: 21:00–21:15');

    fireEvent.click(within(panel).getByRole('button', { name: 'Скачать файл календаря' }));
    const ics = await lastFile();
    expect(clicks).toEqual([{ href: 'blob:http://localhost/1', download: 'meldy-reminder.ics' }]);
    expect(ics).toContain('\r\nDTSTART;TZID=Europe/Minsk:20261007T210000\r\n');
    expect(ics).toContain('\r\nRRULE:FREQ=DAILY\r\n');
    expect(ics).toContain('\r\nDURATION:PT15M\r\n');
    expect(ics).toContain(`\r\nUID:${reminderUid('user-1', 'e-1')}\r\n`);
    expect(ics).toContain(`\r\nURL:${window.location.origin}/dashboard\r\n`);
    expect(ics).toContain('\r\nSUMMARY:Meldy: ответить на билет\r\n');
    expect(JSON.parse(window.localStorage.getItem(`${REMINDER_PREFIX}user-1`)!)).toMatchObject({ time: '21:00', exam: 'e-1' });
    expect(mocks.track).toHaveBeenCalledWith('reminder_downloaded', { from: 'today', time: '21:00', again: false, zone: 'fixed' });

    // What next, on a computer; the heading takes the focus.
    const done = await screen.findByText('Файл скачан');
    await waitFor(() => expect(done).toHaveFocus());
    expect(plain(within(panel).getByRole('status').textContent)).toMatch(/^Откройте файл из загрузок — его добавят Outlook, Календарь на Mac/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('group', { name: 'Напоминать каждый день' })).toBeNull();
    const change = screen.getByRole('button', { name: 'Изменить время напоминания' });
    expect(plain(change.closest('p')?.textContent)).toBe('Напоминание в 21:00 — изменить');
    await waitFor(() => expect(change).toHaveFocus());
    expect(danglingControls()).toEqual([]);
  });

  it('opens on the remembered time, keeps the event’s first exam and says how to replace the old event', async () => {
    window.localStorage.setItem(`${REMINDER_PREFIX}user-1`, JSON.stringify({ time: '08:05', exam: 'e-old', at: '2026-10-01T10:00:00.000Z' }));
    render(<DailyReminder variant="today" examId="e-1" />);
    const change = screen.getByRole('button', { name: 'Изменить время напоминания' });
    expect(plain(change.closest('p')?.textContent)).toBe('Напоминание в 8:05 — изменить');
    fireEvent.click(change);
    const panel = screen.getByRole('group', { name: 'Напоминать каждый день' });
    expect(within(panel).getByRole('radio', { name: 'Другое' })).toBeChecked();
    const input = within(panel).getByLabelText('Своё время') as HTMLInputElement;
    expect(input.value).toBe('08:05');
    fireEvent.change(input, { target: { value: '07:40' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Скачать файл календаря' }));
    const ics = await lastFile();
    expect(ics).toContain('DTSTART;TZID=Europe/Minsk:20261008T074000');
    // The same UID as the first file: the calendar replaces the event instead of adding one.
    expect(ics).toContain(`UID:${reminderUid('user-1', 'e-old')}`);
    expect(mocks.track).toHaveBeenCalledWith('reminder_downloaded', { from: 'today', time: 'custom', again: true, zone: 'fixed' });
    expect(plain(within(panel).getByRole('status').textContent)).toContain('Если в календаре осталось прежнее время, удалите старое событие и откройте файл снова.');
  });

  it('asks for a time before the download', () => {
    render(<DailyReminder variant="today" examId="e-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Напоминать каждый день' }));
    const panel = screen.getByRole('group', { name: 'Напоминать каждый день' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Другое' }));
    fireEvent.change(within(panel).getByLabelText('Своё время'), { target: { value: '' } });
    expect(within(panel).getByText('Укажите время: часы и минуты.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Скачать файл календаря' })).toBeDisabled();
  });

  it('tells an iPhone, an Android phone and a messenger’s browser what to do', async () => {
    setAgent(UA.iphone);
    render(<DailyReminder variant="today" examId="e-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Напоминать каждый день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл календаря' }));
    expect(plain((await screen.findByRole('status')).textContent)).toMatch(/^На iPhone откроется окно Календаря — добавьте в нём событие\./);
    cleanup();
    window.localStorage.clear();

    setAgent(UA.android);
    render(<DailyReminder variant="today" examId="e-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Напоминать каждый день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл календаря' }));
    const android = plain((await screen.findByRole('status')).textContent);
    expect(android).toContain('Откройте файл из уведомления о загрузке или из папки «Загрузки»');
    expect(android).toContain('добавьте его в Google Календарь на компьютере: «Настройки» → «Импорт и экспорт».');
    cleanup();
    window.localStorage.clear();

    setAgent(UA.telegram);
    render(<DailyReminder variant="today" examId="e-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Напоминать каждый день' }));
    expect(plain(screen.getByText(/Во встроенном браузере Telegram/).textContent)).toBe(
      'Во встроенном браузере Telegram файл может не скачаться. Откройте Meldy в Chrome или Safari.',
    );
  });

  it('gives a zone with daylight saving a floating time and asks to check it', async () => {
    setZone('Europe/Warsaw', (moment) => (moment.getMonth() >= 3 && moment.getMonth() <= 9 ? -120 : -60));
    render(<DailyReminder variant="today" examId="e-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Напоминать каждый день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл календаря' }));
    const ics = await lastFile();
    expect(ics).toContain('\r\nDTSTART:20261007T200000\r\n');
    expect(ics).not.toContain('VTIMEZONE');
    expect(mocks.track).toHaveBeenCalledWith('reminder_downloaded', expect.objectContaining({ zone: 'floating' }));
    expect(plain((await screen.findByRole('status')).textContent)).toContain('Проверьте в календаре время события');
  });

  it('works where the browser keeps nothing, and says so when it cannot download', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(<DailyReminder variant="today" examId="e-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Напоминать каждый день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл календаря' }));
    await lastFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Готово' }));
    // The page still shows the choice it made.
    expect(plain(screen.getByRole('button', { name: 'Изменить время напоминания' }).closest('p')?.textContent)).toBe('Напоминание в 20:00 — изменить');
    cleanup();

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined });
    mocks.track.mockReset();
    render(<DailyReminder variant="today" examId="e-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Напоминать каждый день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать файл календаря' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Не получилось скачать файл. Откройте Meldy в Chrome или Safari и попробуйте ещё раз.');
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('closes on Esc and on «Отмена», giving the focus back', async () => {
    render(<DailyReminder variant="today" examId="e-1" />);
    const open = screen.getByRole('button', { name: 'Напоминать каждый день' });
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole('radio', { name: '20:00' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Напоминать каждый день' })).toBeNull();
    await waitFor(() => expect(open).toHaveFocus());
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('group', { name: 'Напоминать каждый день' })).toBeNull();
    expect(files).toEqual([]);
  });

  it('shows nothing without an account', () => {
    mocks.user = null;
    const { container } = render(<DailyReminder variant="today" examId="e-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('«Напоминать каждый день» in «Профиль»', () => {
  it('is a row of «Уведомления» that names the leading exam’s event, as «Сегодня» does', async () => {
    render(<DailyReminder variant="profile" />);
    expect(screen.getByText('Напоминать каждый день')).toBeInTheDocument();
    expect(screen.getByText('Ваш календарь будет каждый день в выбранное время напоминать ответить на билет.')).toBeInTheDocument();
    const choose = screen.getByRole('button', { name: 'Выбрать время' });
    expect(choose).toHaveAccessibleDescription('Напоминать каждый день');
    await waitFor(() => expect(mocks.leadingExamId).toHaveBeenCalledWith('user-1'));
    fireEvent.click(choose);
    const download = screen.getByRole('button', { name: 'Скачать файл календаря' });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);
    const ics = await lastFile();
    expect(ics).toContain(`UID:${reminderUid('user-1', 'e-leading')}`);
    expect(mocks.track).toHaveBeenCalledWith('reminder_downloaded', { from: 'profile', time: '20:00', again: false, zone: 'fixed' });
    fireEvent.click(await screen.findByRole('button', { name: 'Готово' }));
    expect(screen.getByText('Напоминание в 20:00')).toBeInTheDocument();
    expect(screen.getByText('Каждый день — событие в вашем календаре.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
  });

  it('uses the remembered exam and does not read the exams again', () => {
    window.localStorage.setItem(`${REMINDER_PREFIX}user-1`, JSON.stringify({ time: '21:00', exam: null, at: '' }));
    render(<DailyReminder variant="profile" />);
    expect(screen.getByText('Напоминание в 21:00')).toBeInTheDocument();
    expect(mocks.leadingExamId).not.toHaveBeenCalled();
  });
});

describe('«Напоминать каждый день» in «Профиль» on a phone (10_Project/Phone_Declutter_2026-10-08)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (media: string) => ({ matches: media === PHONE_QUERY, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    });
  });
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('says what the row does in one line; the window still says that the calendar reminds and Meldy does not see it', async () => {
    render(<DailyReminder variant="profile" />);
    expect(screen.getByText('Событие в вашем календаре.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать время' }));
    expect(await screen.findByText(/Напоминает календарь на вашем телефоне или компьютере, Meldy его не видит/)).toBeInTheDocument();
  });

  it('words the row on a phone and on a computer', () => {
    expect(profileReminderNote(false, true)).toBe('Событие в вашем календаре.');
    expect(profileReminderNote(true, true)).toBe('Каждый день — событие в календаре.');
    expect(profileReminderNote(false, false)).toBe('Ваш календарь будет каждый день в выбранное время напоминать ответить на билет.');
    expect(profileReminderNote(true, false)).toBe('Каждый день — событие в вашем календаре.');
  });
});
