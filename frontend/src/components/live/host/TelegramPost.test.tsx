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
  it('posts into the bound chat and says so; a second post within a minute shows the wait', async () => {
    const api = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null });
    const g = await api.create({ quiz_id: 'q' }, SETTINGS);
    const view = render(<TelegramPost api={api} gameId={g.game_id} containerId="c" fake />);
    await tick(10);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить в беседу «3-ПО»' }));
    await tick(10);
    expect(screen.getByRole('status')).toHaveTextContent('Пост отправлен в беседу «3-ПО»');
    expect(view.container.textContent).toMatch(/Telegram: кнопка «Играть» в беседе «3-ПО»/);
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

  it('no chat bound to the exam: how to bind one, in plain words', async () => {
    groups.list = [];
    const api = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null });
    render(<TelegramPost api={api} gameId="g" containerId="c" fake={false} />);
    await tick(10);
    expect(screen.getByText(/беседа группы не подключена/)).toHaveTextContent('«⋯» → «Пригласить группу» → «Подключить беседу»');
    expect(screen.queryByRole('button')).toBeNull();
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
