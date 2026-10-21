/**
 * The teacher's screen, state by state, against the fake server (docs/live/CONTRACT.md §12): lobby, countdown, open,
 * reveal, leaderboard, podium, ended; kick, end, a reload in the middle, a missing token. Fake timers drive both the
 * server's clock and the screen's polling.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_QUESTIONS, createFakeServer } from '../../../lib/live/fake';
import type { HostState, Settings } from '../../../lib/live/types';
import { LiveHostView } from '../../../pages/live/LiveHostPage';
import { pinText } from './copy';
import { saveHostInfo, saveHostToken } from './hostSession';

const SETTINGS: Settings = { mode: 'boss', time_s: 10, speed: true, who: 'pin', chat_names: false };

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const space = () => fireEvent.keyDown(window, { key: ' ' });

async function start(bots = 23) {
  const api = createFakeServer({ bots, latencyMs: 0, demoPin: null, autoHost: false, fastBots: true, seed: 11 });
  const g = await api.create({ container_id: 'c', subject_ids: ['s'], count: 6 }, SETTINGS);
  saveHostToken(g.game_id, g.host_token);
  saveHostInfo(g.game_id, { title: 'Базы данных', joinUrl: g.join_url, containerId: 'c', quizId: null, source: null, settings: SETTINGS });
  const ui = () => (
    <MemoryRouter initialEntries={[`/live/${g.game_id}`]}>
      <LiveHostView gameId={g.game_id} api={api} />
    </MemoryRouter>
  );
  const view = render(ui());
  await tick(50);
  const server = async () => (await api.hostState(g.game_id, g.host_token)) as HostState;
  return { api, g, view, ui, server };
}

/** From a countdown to the reveal: 3 s, then the bots (1–3 s); the director's film plays out. */
async function playQuestion() {
  await tick(3000);
  await tick(3500);
  await tick(9000);
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 21, 9, 0, 0) });
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('teacher screen against the fake server', () => {
  it('lobby: PIN in big letters, the QR of the join link, the characters as they come', async () => {
    const { g, view } = await start();
    expect(screen.getByText(pinText(g.pin).replace(/ /g, ' '))).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /QR-код: ludosiel-studyforge\.hf\.space\/play\?pin=/ })).toBeInTheDocument();
    expect(view.container.querySelector('.lvh-lobby-count')?.textContent).toBe('23игрока');
    expect(view.container.querySelectorAll('.lvh-slot[role="button"]')).toHaveLength(23);
    expect(screen.getByRole('button', { name: /Начать/ })).toBeEnabled();
    expect(screen.getByText('Базы данных')).toBeInTheDocument();
  });

  it('the sound’s switch in the bar: on by default, remembered when turned off', async () => {
    window.localStorage.removeItem('meldy.live.sound');
    await start(3);
    const button = screen.getByRole('button', { name: 'Звук' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', 'Выключить звук');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Звук' })).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('meldy.live.sound')).toBe('off');
    fireEvent.click(screen.getByRole('button', { name: 'Звук' }));
    expect(window.localStorage.getItem('meldy.live.sound')).toBeNull();
  });

  it('a whole game: countdown, open, reveal with the key, top five, … podium, review, end', async () => {
    const { view, server } = await start();
    space();
    await tick(50);
    // countdown: the question and its four tiles, answers not open yet
    expect(screen.getByRole('heading', { name: EXAMPLE_QUESTIONS[0].text })).toBeInTheDocument();
    const tiles = view.container.querySelectorAll('.lvh-tile');
    expect(tiles).toHaveLength(4);
    expect([...tiles].map((t) => t.querySelector('.lvh-tile-badge b')?.textContent)).toEqual(['А', 'Б', 'В', 'Г']);
    expect(view.container.querySelector('.lvh-ring')).toHaveAttribute('data-mode', 'ready');
    expect(view.container.querySelectorAll('.lvh-slot')).toHaveLength(23);
    await tick(3000);
    expect(view.container.querySelector('.lvh-ring')).toHaveAttribute('data-mode', 'run');
    expect(view.container.querySelector('.lvh-q-side')?.textContent).toMatch(/из 23 ответили/);
    await tick(3500);
    // everyone answered before the time: «Все ответили» for a beat, the options step back, the monster braces itself
    expect(view.container.querySelector('.lvh-closing')?.textContent).toBe('Все ответили');
    expect(view.container.querySelector('.lvh-tiles')).toHaveAttribute('data-closing');
    expect(view.container.querySelector('.lvh-boss')).toHaveAttribute('data-tense');
    expect(view.container.querySelectorAll('.lvh-tile[data-key]')).toHaveLength(0);
    await tick(800);
    // reveal: the key, the counts, «верно»
    expect(view.container.querySelector('.lvh-closing')).toBeNull();
    expect(view.container.querySelector('.lvh-boss')).not.toHaveAttribute('data-tense');
    expect(view.container.querySelectorAll('.lvh-tile[data-key]')).toHaveLength(1);
    expect(view.container.querySelector('.lvh-q-side')?.textContent).toMatch(/из 23 верно/);
    await tick(9000);
    const s = await server();
    expect(s.state).toBe('reveal');
    expect(screen.getByRole('meter', { name: 'Дедлайн' })).toHaveAttribute('aria-valuenow', String(s.boss.hp));
    const frozenShown = view.container.querySelectorAll('.lvh-slot .lv-char[data-frozen="true"]').length;
    expect(frozenShown).toBe(s.roster.filter((r) => r.frozen).length);
    // leaderboard
    expect(screen.getByRole('button', { name: /Дальше/ })).toBeEnabled();
    space();
    await tick(50);
    expect(screen.getByRole('heading', { name: 'Больше всех урона' })).toBeInTheDocument();
    expect(view.container.querySelectorAll('.lvh-card')).toHaveLength(5);
    // the rest of the questions until the podium
    for (let i = 0; i < 6 && !view.container.querySelector('.lvh-podium'); i += 1) {
      space();
      await tick(50);
      if (view.container.querySelector('.lvh-podium')) break;
      await playQuestion();
      space();
      await tick(50);
    }
    expect(view.container.querySelector('.lvh-podium')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /Дедлайн (повержен|победил)/ })).toBeInTheDocument();
    expect(view.container.querySelectorAll('.lvh-pod-col')).toHaveLength(3);
    // review: every played question with its key, every student
    fireEvent.click(screen.getByRole('button', { name: 'Разбор' }));
    const dialog = screen.getByRole('dialog', { name: 'Разбор' });
    const asked = (await server()).qi + 1;
    expect(within(dialog).getAllByRole('heading', { level: 3 })).toHaveLength(asked);
    expect(dialog.querySelectorAll('li[data-key]')).toHaveLength(asked);
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Ученики' }));
    expect(within(dialog).getAllByRole('row')).toHaveLength(24);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // podium → ended
    space();
    await tick(50);
    expect((await server()).state).toBe('ended');
    expect(screen.getByText(/Игра закончена\. Разбор у каждого/)).toBeInTheDocument();
  });

  it('kicks a player from the lobby after a confirmation', async () => {
    const { view, server } = await start(5);
    const first = view.container.querySelector<HTMLElement>('.lvh-slot[role="button"]')!;
    const name = first.getAttribute('aria-label')!;
    fireEvent.click(first);
    const dialog = screen.getByRole('dialog', { name: `Убрать ${name} из игры?` });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Убрать' }));
    await tick(50);
    expect((await server()).players).toBe(4);
    expect(view.container.querySelectorAll('.lvh-slot[role="button"]')).toHaveLength(4);
    expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('kicks during the game from «Игроки»; ends the game from the bar', async () => {
    const { view, server } = await start(6);
    space();
    await tick(50);
    fireEvent.click(screen.getByRole('button', { name: 'Игроки' }));
    const sheet = screen.getByRole('dialog', { name: 'Игроки · 6' });
    fireEvent.click(within(sheet).getAllByRole('button', { name: 'Убрать' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Убрать' }));
    await tick(50);
    expect((await server()).players).toBe(5);
    expect(view.container.querySelectorAll('.lvh-slot')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Закончить игру?' })).getByRole('button', { name: 'Закончить' }));
    await tick(50);
    expect((await server()).state).toBe('ended');
    // no question closed yet: the game is simply closed
    expect(screen.getByRole('heading', { level: 1, name: 'Игра закрыта' })).toBeInTheDocument();
    expect(view.container.querySelector('.lvh-podium')).toBeNull();
  });

  it('ended from the lobby: a calm «Игра закрыта» with the way back, no crowd, no «Итог» or «Играют»', async () => {
    const { view } = await start(3);
    fireEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Закончить игру?' })).getByRole('button', { name: 'Закончить' }));
    await tick(50);
    expect(screen.getByRole('heading', { level: 1, name: 'Игра закрыта' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'К тесту' })).toHaveAttribute('href', '/exams/c/c');
    expect(view.container.querySelectorAll('.lvh-slot')).toHaveLength(0);
    expect(view.container.querySelector('.lvh-top')?.textContent).not.toMatch(/Итог|Играют|PIN/);
    expect(screen.queryByRole('button', { name: 'Закончить' })).toBeNull();
  });

  it('ended in the middle of a question: «Игра закончена» with the questions that closed, no winner', async () => {
    const { view, server } = await start(6);
    space();
    await tick(50);
    await playQuestion();
    expect((await server()).state).toBe('reveal');
    space(); // leaderboard
    await tick(50);
    space(); // question 2, countdown
    await tick(50);
    await tick(3500); // open
    expect((await server()).state).toBe('open');
    fireEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Закончить игру?' })).getByRole('button', { name: 'Закончить' }));
    await tick(50);
    expect((await server()).state).toBe('ended');
    expect(screen.getByRole('heading', { level: 1, name: 'Игра закончена' })).toBeInTheDocument();
    const head = view.container.querySelector('.lvh-pod-head')!.textContent!.replace(/\u00a0/g, ' ');
    expect(head).toMatch(/^Игра закончена1 вопрос из 6 · 6 игроков · верных ответов \d+ %$/);
    expect(view.container.textContent).not.toMatch(/Дедлайн (победил|повержен)/);
    expect(view.container.querySelectorAll('.lvh-pod-col')).toHaveLength(3);
  });

  it('a kick during the game leaves an empty seat: nobody else moves', async () => {
    const { view, server } = await start(8);
    space();
    await tick(50);
    await tick(1500); // the walk into the arena
    const where = () => new Map([...view.container.querySelectorAll<HTMLElement>('.lvh-slot')].map((el) => [el.dataset.player!, el.style.transform]));
    const before = where();
    expect(before.size).toBe(8);
    fireEvent.click(screen.getByRole('button', { name: 'Игроки' }));
    const sheet = screen.getByRole('dialog', { name: 'Игроки · 8' });
    fireEvent.click(within(sheet).getAllByRole('button', { name: 'Убрать' })[3]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Убрать' }));
    await tick(50);
    expect((await server()).players).toBe(7);
    const after = where();
    expect(after.size).toBe(7);
    for (const [id, t] of after) expect(t, id).toBe(before.get(id));
  });

  it('names: one line at their place’s width, the full name kept; they step out while the class walks', async () => {
    const api = createFakeServer({ bots: 3, latencyMs: 0, demoPin: null, autoHost: false, fastBots: true, seed: 11 });
    const g = await api.create({ container_id: 'c', subject_ids: ['s'], count: 6 }, SETTINGS);
    saveHostToken(g.game_id, g.host_token);
    const long = 'Катя Смирнова-Остроумова';
    await api.join(g.pin, long, 'L'.repeat(43), null);
    const view = render(
      <MemoryRouter>
        <LiveHostView gameId={g.game_id} api={api} />
      </MemoryRouter>,
    );
    await tick(50);
    const label = [...view.container.querySelectorAll<HTMLElement>('.lvh-name')].find((el) => el.textContent === long)!;
    expect(label).toHaveAttribute('title', long);
    expect(parseFloat(label.style.width)).toBeLessThanOrEqual(130);
    expect(screen.getByRole('button', { name: long })).toBeInTheDocument();
    const crowd = view.container.querySelector('.lvh-crowd')!;
    expect(crowd).not.toHaveAttribute('data-walk');
    space();
    await tick(50);
    expect(crowd).toHaveAttribute('data-walk');
    await tick(1400);
    expect(crowd).not.toHaveAttribute('data-walk');
  });

  it('the timer’s 0: «Время вышло» at once (no frozen «0»), until the reveal comes after the server’s grace', async () => {
    const api = createFakeServer({ bots: 3, latencyMs: 0, demoPin: null, autoHost: false, fastBots: true, seed: 11 });
    const g = await api.create({ container_id: 'c', subject_ids: ['s'], count: 6 }, SETTINGS);
    saveHostToken(g.game_id, g.host_token);
    await api.join(g.pin, 'Тихоня', 'T'.repeat(43), null); // never answers: the question runs to its end
    const view = render(
      <MemoryRouter>
        <LiveHostView gameId={g.game_id} api={api} />
      </MemoryRouter>,
    );
    await tick(50);
    space();
    await tick(3050);
    await tick(1000); // open on the screen
    expect(view.container.querySelector('.lvh-closing')).toBeNull();
    await tick(9000); // SETTINGS: 10 s
    expect((await api.hostState(g.game_id, g.host_token)) as HostState).toMatchObject({ state: 'open' });
    expect(view.container.querySelector('.lvh-closing')?.textContent).toBe('Время вышло');
    expect(view.container.querySelector('.lvh-tiles')).toHaveAttribute('data-closing');
    expect(view.container.querySelector('.lvh-boss')).toHaveAttribute('data-tense');
    await tick(2600);
    expect(view.container.querySelector('.lvh-closing')).toBeNull();
    expect(view.container.querySelectorAll('.lvh-tile[data-key]')).toHaveLength(1);
    expect(view.container.querySelector('.lvh-boss')).not.toHaveAttribute('data-tense');
  });

  it('a reload in the middle of a reveal draws it as it is, without replaying', async () => {
    const { view, ui, server } = await start();
    space();
    await tick(3000);
    await tick(3500);
    expect((await server()).state).toBe('reveal');
    view.unmount();
    const again = render(ui());
    await tick(50);
    const s = await server();
    expect(again.container.querySelectorAll('.lvh-tile[data-key]')).toHaveLength(1);
    expect(screen.getByRole('meter', { name: 'Дедлайн' })).toHaveAttribute('aria-valuenow', String(s.boss.hp));
    expect(again.container.querySelectorAll('.lvh-fx-item')).toHaveLength(0);
    expect(again.container.querySelector('.lvh-q-no')?.textContent).toBe('Вопрос 1 из 6');
  });

  it('says so when this tab has no host token, or the game is gone', async () => {
    const api = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null });
    const { unmount } = render(
      <MemoryRouter>
        <LiveHostView gameId="00000000-0000-4000-8000-000000000999" api={api} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Эту игру ведут с другого устройства' })).toBeInTheDocument();
    unmount();
    saveHostToken('00000000-0000-4000-8000-000000000998', 'A'.repeat(43));
    render(
      <MemoryRouter>
        <LiveHostView gameId="00000000-0000-4000-8000-000000000998" api={api} />
      </MemoryRouter>,
    );
    await tick(50);
    expect(screen.getByRole('heading', { name: 'Игра не найдена' })).toBeInTheDocument();
  });
});
