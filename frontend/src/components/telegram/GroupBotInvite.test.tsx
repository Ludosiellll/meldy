import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../contracts/container/summary.json';
import type { ContainerSummary } from '../../types/container';
import type { GroupCode, TelegramGroup, TelegramGroups } from '../../api/telegramGroups';
import { danglingControls } from '../../test/a11y';

const api = vi.hoisted(() => ({
  fetchTelegramGroups: vi.fn(),
  requestGroupCode: vi.fn(),
  setTelegramGroup: vi.fn(),
  createLink: vi.fn(),
  revokeLink: vi.fn(),
  fetchMembers: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('../../api/telegramGroups', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/telegramGroups')>();
  return { ...real, fetchTelegramGroups: api.fetchTelegramGroups, requestGroupCode: api.requestGroupCode, setTelegramGroup: api.setTelegramGroup };
});
vi.mock('../../api/containers', () => ({ createLink: api.createLink, revokeLink: api.revokeLink, fetchMembers: api.fetchMembers, removeMember: api.removeMember }));

import GroupBotInvite, { GROUP_BOT, POLL_MS } from './GroupBotInvite';
import InviteExam from '../containers/group/InviteExam';
import { TelegramGroupError } from '../../api/telegramGroups';

const CID = 'a1b2c3d4-0000-4000-8000-000000000001';
const CODE = `G${'7e'.repeat(16)}`;
const URL_ = `https://t.me/Meldyteach_bot?startgroup=${CODE}`;
const plain = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ');

const chat = (over: Partial<TelegramGroup> = {}): TelegramGroup => ({
  chatId: -1001234567890, title: '3-ПО', hour: 12, zone: 'Europe/Minsk', on: true, offReason: null, boundAt: '2026-10-15T09:00:00Z', linkActive: true, ...over,
});
const state = (over: Partial<TelegramGroups> = {}): TelegramGroups => ({
  telegramLinked: true, linkActive: true, bot: 'Meldyteach_bot', hours: [9, 12, 15, 18], defaultHour: 12, groups: [], ...over,
});
const made = (over: Partial<GroupCode> = {}): GroupCode => ({ code: CODE, url: URL_, bot: 'Meldyteach_bot', hour: 12, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), ...over });

function show(props: { linkOpen?: boolean } = {}) {
  const view = render(
    <MemoryRouter>
      <GroupBotInvite containerId={CID} linkOpen={props.linkOpen ?? true} />
    </MemoryRouter>,
  );
  return view;
}

async function opened(props: { linkOpen?: boolean } = {}) {
  const view = show(props);
  fireEvent.click(screen.getByRole('button', { name: GROUP_BOT.title }));
  await waitFor(() => expect(api.fetchTelegramGroups).toHaveBeenCalled());
  return view;
}

const section = () => screen.getByRole('button', { name: GROUP_BOT.title }).closest('section') as HTMLElement;
const pill = () => within(section()).queryByRole('button', { name: GROUP_BOT.connect });
const blue = () => section().querySelectorAll('.sf-primary').length;

beforeEach(() => {
  api.fetchTelegramGroups.mockReset().mockResolvedValue(state());
  api.requestGroupCode.mockReset().mockResolvedValue(made());
  api.setTelegramGroup.mockReset();
  api.createLink.mockReset();
  api.revokeLink.mockReset();
  api.fetchMembers.mockReset().mockResolvedValue([]);
  api.removeMember.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GroupBotInvite: «Вопрос дня в Telegram» (spec G0)', () => {
  it('is a closed section first: nothing is read until it is opened', async () => {
    show();
    const toggle = screen.getByRole('button', { name: GROUP_BOT.title });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(api.fetchTelegramGroups).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(api.fetchTelegramGroups).toHaveBeenCalledWith(CID, expect.any(AbortSignal)));
    expect(await screen.findByText((_, el) => el?.className === 'gb-lede' && plain(el.textContent) === GROUP_BOT.lede)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText((_, el) => el?.className === 'gb-lede')).toBeNull();
  });

  it('the hour (12:00 by default, 9 · 12 · 15 · 18) and «Подключить беседу» → a code → «Открыть Telegram» to startgroup', async () => {
    await opened();
    const hour = await screen.findByRole('combobox', { name: GROUP_BOT.hourLabel });
    expect(hour).toHaveTextContent('12:00');
    fireEvent.click(hour);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['9:00', '12:00', '15:00', '18:00']);
    fireEvent.click(screen.getByRole('option', { name: '15:00' }));
    expect(blue()).toBe(1);
    fireEvent.click(pill()!);
    await waitFor(() => expect(api.requestGroupCode).toHaveBeenCalledWith(CID, 15));
    const open = await screen.findByRole('link', { name: GROUP_BOT.open });
    expect(open).toHaveAttribute('href', URL_);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(open).toHaveClass('sf-primary');
    expect(open).toHaveFocus();
    expect(pill()).toBeNull();
    expect(blue()).toBe(1);
    expect(plain(within(section()).getByRole('status').textContent)).toBe(GROUP_BOT.ready);
    fireEvent.click(screen.getByRole('button', { name: GROUP_BOT.cancel }));
    expect(pill()).toBeInTheDocument();
    expect(danglingControls()).toEqual([]);
  });

  it('while the code waits it reads the chats every 3 s; the new chat → «Беседа «3-ПО» подключена.»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await opened();
    fireEvent.click(await screen.findByRole('button', { name: GROUP_BOT.connect }));
    await screen.findByRole('link', { name: GROUP_BOT.open });
    expect(api.fetchTelegramGroups).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(api.fetchTelegramGroups).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: GROUP_BOT.open })).toBeInTheDocument();
    api.fetchTelegramGroups.mockResolvedValue(state({ groups: [chat({ boundAt: new Date().toISOString() })] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(screen.queryByRole('link', { name: GROUP_BOT.open })).toBeNull();
    expect(plain(within(section()).getByRole('status').textContent)).toBe('Беседа «3-ПО» подключена.');
    expect(within(section()).getByRole('list', { name: GROUP_BOT.listLabel })).toHaveTextContent('«3-ПО»');
    const calls = api.fetchTelegramGroups.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    });
    expect(api.fetchTelegramGroups.mock.calls.length).toBe(calls);
  });

  it('a chat connected again (already in the list) counts by its new binding; the hour passing ends the wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.fetchTelegramGroups.mockResolvedValue(state({ groups: [chat({ linkActive: false, offReason: 'link', on: false })] }));
    await opened();
    fireEvent.click(await screen.findByRole('button', { name: GROUP_BOT.connect }));
    await screen.findByRole('link', { name: GROUP_BOT.open });
    api.fetchTelegramGroups.mockResolvedValue(state({ groups: [chat({ boundAt: new Date(Date.now() + 1000).toISOString() })] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(plain(within(section()).getByRole('status').textContent)).toBe('Беседа «3-ПО» подключена.');

    api.requestGroupCode.mockResolvedValue(made({ expiresAt: new Date(Date.now() + 2000).toISOString() }));
    api.fetchTelegramGroups.mockResolvedValue(state());
    fireEvent.click(screen.getByRole('button', { name: GROUP_BOT.connect }));
    await screen.findByRole('link', { name: GROUP_BOT.open });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    });
    expect(screen.queryByRole('link', { name: GROUP_BOT.open })).toBeNull();
    expect(plain(section().textContent)).toContain(GROUP_BOT.expired);
    expect(pill()).toBeInTheDocument();
  });

  it('without a linked Telegram: «Сначала подключите Telegram в профиле.» and the way to the profile; no pill', async () => {
    api.fetchTelegramGroups.mockResolvedValue(state({ telegramLinked: false }));
    await opened();
    await screen.findByText((_, el) => el?.tagName === 'P' && plain(el.textContent).startsWith(GROUP_BOT.needTelegram));
    expect(screen.getByRole('link', { name: GROUP_BOT.openProfile })).toHaveAttribute('href', '/profile#telegram');
    expect(pill()).toBeNull();
    expect(blue()).toBe(0);
  });

  it('without an open group link: «Сначала создайте ссылку для группы.»; while the window makes one: no second pill', async () => {
    api.fetchTelegramGroups.mockResolvedValue(state({ linkActive: false }));
    const view = await opened();
    await screen.findByText((_, el) => el?.tagName === 'P' && plain(el.textContent) === GROUP_BOT.needLink);
    expect(pill()).toBeNull();
    api.fetchTelegramGroups.mockResolvedValue(state());
    view.rerender(
      <MemoryRouter>
        <GroupBotInvite containerId={CID} linkOpen={false} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.fetchTelegramGroups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText((_, el) => el?.tagName === 'P' && plain(el.textContent) === GROUP_BOT.needLink)).toBeNull());
    expect(pill()).toBeNull();
    expect(blue()).toBe(0);
    view.rerender(
      <MemoryRouter>
        <GroupBotInvite containerId={CID} linkOpen />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.fetchTelegramGroups).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('button', { name: GROUP_BOT.connect })).toBeInTheDocument();
  });

  it('the connected chats: the hour, «Выключить», «Включить» after five empty days, and a chat whose link ended', async () => {
    const empty = chat({ chatId: -1002, title: 'Вечерние', on: false, offReason: 'empty' });
    const ended = chat({ chatId: -1003, title: null, on: false, offReason: 'link', linkActive: false });
    api.fetchTelegramGroups.mockResolvedValue(state({ groups: [chat(), empty, ended] }));
    api.setTelegramGroup.mockImplementation(async (chatId: number, change: { hour?: number; on?: boolean }) => {
      const base = [chat(), empty].find((g) => g.chatId === chatId)!;
      return { ...base, hour: change.hour ?? base.hour, on: change.on ?? base.on, offReason: change.on === false ? 'author' : change.on ? null : base.offReason };
    });
    await opened();
    const list = await screen.findByRole('list', { name: GROUP_BOT.listLabel });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => plain(li.textContent))).toEqual([
      '«3-ПО»Каждый день в12:00Выключить',
      `«Вечерние»${GROUP_BOT.stoppedEmpty}Включить`,
      `Беседа без названия${GROUP_BOT.stoppedLink}`,
    ]);
    const hour = within(items[0]).getByRole('combobox', { name: 'Час вопроса дня: «3-ПО»' });
    fireEvent.click(hour);
    fireEvent.click(screen.getByRole('option', { name: '18:00' }));
    await waitFor(() => expect(api.setTelegramGroup).toHaveBeenCalledWith(-1001234567890, { hour: 18 }));
    await waitFor(() => expect(plain(within(section()).getByRole('status').textContent)).toBe('«3-ПО»: вопрос дня — в 18:00.'));
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Выключить: «3-ПО»' }));
    await waitFor(() => expect(api.setTelegramGroup).toHaveBeenLastCalledWith(-1001234567890, { on: false }));
    await waitFor(() => expect(plain(within(section()).getAllByRole('listitem')[0].textContent)).toBe(`«3-ПО»${GROUP_BOT.off}Включить`));
    fireEvent.click(within(items[1]).getByRole('button', { name: 'Включить: «Вечерние»' }));
    await waitFor(() => expect(api.setTelegramGroup).toHaveBeenLastCalledWith(-1002, { on: true }));
    expect(within(items[2]).queryByRole('button')).toBeNull();
    expect(blue()).toBe(1);
  });

  it('refusals in Russian: Telegram unlinked meanwhile (read again), too many codes, a chat the bot left', async () => {
    await opened();
    api.requestGroupCode.mockRejectedValueOnce(new TelegramGroupError('not_linked'));
    api.fetchTelegramGroups.mockResolvedValue(state({ telegramLinked: false }));
    fireEvent.click(await screen.findByRole('button', { name: GROUP_BOT.connect }));
    expect(plain((await within(section()).findByRole('alert')).textContent)).toBe(GROUP_BOT.needTelegram);
    await waitFor(() => expect(api.fetchTelegramGroups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pill()).toBeNull());

    cleanup();
    api.fetchTelegramGroups.mockResolvedValue(state({ groups: [chat()] }));
    await opened();
    api.requestGroupCode.mockRejectedValueOnce(new TelegramGroupError('too_many'));
    fireEvent.click(await screen.findByRole('button', { name: GROUP_BOT.connect }));
    expect(plain((await within(section()).findByRole('alert')).textContent)).toBe('Слишком много попыток. Попробуйте через час.');
    api.setTelegramGroup.mockRejectedValueOnce(new TelegramGroupError('not_found'));
    api.fetchTelegramGroups.mockResolvedValue(state());
    fireEvent.click(screen.getByRole('button', { name: 'Выключить: «3-ПО»' }));
    await waitFor(() => expect(plain(within(section()).getByRole('alert').textContent)).toBe('Бота уже нет в этой беседе.'));
    await waitFor(() => expect(within(section()).queryByRole('list')).toBeNull());
  });

  it('a database without the functions, and a failed read with «Повторить»', async () => {
    api.fetchTelegramGroups.mockResolvedValue(null);
    await opened();
    expect(await screen.findByText(GROUP_BOT.missing)).toBeInTheDocument();
    cleanup();
    api.fetchTelegramGroups.mockReset().mockRejectedValueOnce(new TelegramGroupError('network')).mockResolvedValue(state());
    await opened();
    const alert = await screen.findByRole('alert');
    expect(plain(alert.textContent)).toContain(GROUP_BOT.loadFailed);
    fireEvent.click(within(alert).getByRole('button', { name: GROUP_BOT.retry }));
    expect(await screen.findByRole('button', { name: GROUP_BOT.connect })).toBeInTheDocument();
  });

  it('every line follows the copy rules', () => {
    const lines = Object.values(GROUP_BOT).map((v) => (typeof v === 'function' ? (v as (...a: unknown[]) => string)('«3-ПО»', 12) : v));
    for (const text of lines) {
      expect(text).not.toMatch(/(^|[^а-яё])тест|контейнер|преподавател|колледж|пробн|правильн|засчит|сгор|повторени|спорн|!/iu);
      expect(text).not.toMatch(/[А-ЯЁ]{4,}/u);
    }
  });
});

describe('inside «Пригласить группу» (InviteExam: one line)', () => {
  const SUMMARY = summaryJson as unknown as ContainerSummary;
  const LINK = { id: 'link-1', created_at: '2026-10-08T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, members: 12, max_members: 60, oral: 0 };

  it('sits at the bottom of the window, closed; with the link on screen its pill is the only blue one', async () => {
    render(
      <MemoryRouter>
        <InviteExam summary={{ ...SUMMARY, owner: { members: 12, doubts_open: 0, links: [LINK] } }} onClose={() => undefined} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Пригласить группу' });
    const toggle = within(dialog).getByRole('button', { name: GROUP_BOT.title });
    expect(api.fetchTelegramGroups).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.fetchTelegramGroups).toHaveBeenCalledWith(SUMMARY.id, expect.any(AbortSignal)));
    expect(await within(dialog).findByRole('button', { name: GROUP_BOT.connect })).toBeInTheDocument();
    expect(dialog.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('while «Создать ссылку» is the window\'s pill, the section shows none', async () => {
    render(
      <MemoryRouter>
        <InviteExam summary={{ ...SUMMARY, subjects: SUMMARY.subjects.filter((s) => !s.oral), owner: { members: 0, doubts_open: 0, links: [] } }} onClose={() => undefined} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Пригласить группу' });
    fireEvent.click(within(dialog).getByRole('button', { name: GROUP_BOT.title }));
    await waitFor(() => expect(api.fetchTelegramGroups).toHaveBeenCalled());
    await within(dialog).findByText((_, el) => el?.className === 'gb-lede');
    expect(within(dialog).queryByRole('button', { name: GROUP_BOT.connect })).toBeNull();
    expect(dialog.querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Создать ссылку' })).toHaveClass('sf-primary');
  });
});
