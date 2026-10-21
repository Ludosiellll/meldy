import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer } from '../../../lib/live/fake';
import { liveError } from '../../../lib/live/real';
import { LiveError } from '../../../lib/live/types';
import { TelegramPost, postErrorText } from './TelegramPost';

const groups = vi.hoisted(() => ({ list: [] as Array<{ chatId: number; title: string | null }> }));
vi.mock('../../../api/telegramGroups', () => ({
  fetchTelegramGroups: vi.fn(async () => ({ telegramLinked: true, linkActive: true, bot: 'Meldyteach_bot', hours: [], defaultHour: 12, groups: groups.list })),
}));

const SETTINGS = { mode: 'boss' as const, time_s: 20 as const, speed: true, who: 'pin' as const, chat_names: false };

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the lobby’s Telegram post', () => {
  it('one chat: the pill posts at once and says where; a second post within a minute shows the wait', async () => {
    const api = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null });
    const g = await api.create({ quiz_id: 'q' }, SETTINGS);
    const posted = vi.fn();
    const view = render(<TelegramPost api={api} gameId={g.game_id} containerId="c" fake onPosted={posted} />);
    await tick(10);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить в беседу «3-ПО»' }));
    await tick(10);
    expect(screen.getByRole('status')).toHaveTextContent('Пост отправлен в беседу «3-ПО»');
    expect(screen.getByRole('button', { name: 'Пост в беседе «3-ПО»' })).toBeInTheDocument();
    expect(posted).toHaveBeenCalledWith({ chatId: -1001234567890, title: '3-ПО' });
    view.unmount();
    // another tab of the same game: the server refuses a second post within the minute
    window.sessionStorage.clear();
    render(<TelegramPost api={api} gameId={g.game_id} containerId="c" fake />);
    await tick(10);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить в беседу «3-ПО»' }));
    await tick(10);
    expect(screen.getByRole('alert')).toHaveTextContent(/Пост уже отправлен\. Следующий можно через (59|60) с\./);
    expect(screen.getByRole('button', { name: 'Отправить в беседу «3-ПО»' })).toBeDisabled();
    await tick(61_000);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Отправить в беседу «3-ПО»' })).toBeEnabled();
  });

  it('no chat bound: a plain pill; how to bind one only when pressed (never on the projector by itself)', async () => {
    groups.list = [];
    const api = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null });
    const view = render(<TelegramPost api={api} gameId="g" containerId="c" fake={false} />);
    await tick(10);
    expect(view.container.textContent).toBe('Отправить в беседу');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить в беседу' }));
    const pop = screen.getByRole('dialog', { name: 'Отправить в беседу' });
    expect(pop).toHaveTextContent('«⋯» → «Пригласить группу» → «Подключить беседу»');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('several chats: pressed, a short list to pick from', async () => {
    groups.list = [
      { chatId: -1, title: '3-ПО' },
      { chatId: -2, title: '4-ИС' },
    ];
    const api = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null });
    const g = await api.create({ quiz_id: 'q' }, SETTINGS);
    render(<TelegramPost api={api} gameId={g.game_id} containerId="c" fake={false} />);
    await tick(10);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить в беседу' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить в беседу «4-ИС»' }));
    await tick(10);
    expect(screen.getByRole('status')).toHaveTextContent('Пост отправлен в беседу «4-ИС»');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names every refusal of live_tg_post', () => {
    expect(postErrorText(new LiveError('28000', null, 401))).toMatch(/Войдите/);
    expect(postErrorText(new LiveError('42501', 'author', 403))).toMatch(/автор/);
    expect(postErrorText(new LiveError('P0002', 'group', 404))).toMatch(/не подключена/);
    expect(postErrorText(new LiveError('P0002', 'game', 404))).toMatch(/не найдена/);
    expect(postErrorText(new LiveError('ML002', 'ended'))).toMatch(/закончилась/);
    expect(postErrorText(new LiveError('ML010', 'bot', 503))).toMatch(/Бот Meldy/);
    // the real client: ML010 is known; the wait comes from the error's hint when the server gives it
    expect(liveError({ code: 'ML010', details: 'bot' }, 503).code).toBe('ML010');
    expect(liveError({ code: 'ML005', details: 'post', hint: '42' }, 429)).toMatchObject({ code: 'ML005', retryAfterS: 42 });
    expect(liveError({ code: 'ML005', details: 'post' }, 429).retryAfterS).toBeNull();
  });
});
