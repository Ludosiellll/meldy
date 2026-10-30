/**
 * The battle's 3D projector (BattleHost) against the fake server and a fake room socket, with the 3D scene replaced by a
 * recorder: the lobby's way in over the arena and the class round the boss from the database's roster, a button
 * question on the board, its reveal with the hits leaping at the boss in the stored order and the ice at the blow, the
 * five best and the podium over the arena; a plain battle opens the room too; without WebGL the flat screen takes over.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer } from '../../../lib/live/fake';
import type { HostState, Settings } from '../../../lib/live/types';
import { LiveHostView } from '../../../pages/live/LiveHostPage';
import { saveHostInfo, saveHostToken } from '../host/hostSession';

// The scene: every call recorded; `fail` makes its start reject (no WebGL).
const rec = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, fail: false }));
vi.mock('./scene', () => {
  class StandScene {
    constructor(...args: unknown[]) {
      rec.calls.push(['new', [args[4]]]);
    }
    start() {
      return rec.fail ? Promise.reject(new Error('no WebGL in the test')) : Promise.resolve();
    }
    dispose() {}
  }
  for (const m of ['pause', 'resume', 'shake', 'bossPhase', 'setFormation', 'setRoster', 'setIced', 'hop', 'strike', 'cheer', 'calm', 'setLooks', 'step', 'manual', 'stats']) {
    (StandScene.prototype as unknown as Record<string, unknown>)[m] = function (...a: unknown[]) {
      rec.calls.push([m, a]);
      return null;
    };
  }
  return { StandScene };
});
// the lazy screen, loaded before the clock is faked
import './BattleHost';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

const SETTINGS: Settings = { mode: 'boss', time_s: 10, speed: true, who: 'pin', chat_names: false };

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const space = () => fireEvent.keyDown(window, { key: ' ' });
const calls = (name: string) => rec.calls.filter((c) => c[0] === name).map((c) => c[1]);
const last = <T,>(list: T[]): T | undefined => list[list.length - 1];

async function start(settings: Settings = SETTINGS) {
  const api = createFakeServer({ bots: 5, latencyMs: 0, demoPin: null, autoHost: false, fastBots: true, seed: 11 });
  const g = await api.create({ container_id: 'c', subject_ids: ['s'], count: 6 }, settings);
  saveHostToken(g.game_id, g.host_token);
  saveHostInfo(g.game_id, { title: 'Базы данных', joinUrl: g.join_url, containerId: 'c', quizId: null, source: null, settings });
  const view = render(
    <MemoryRouter initialEntries={[`/live/${g.game_id}`]}>
      <LiveHostView gameId={g.game_id} api={api} />
    </MemoryRouter>,
  );
  for (let i = 0; i < 20 && FakeSocket.all.length === 0; i++) await tick(100);
  await act(async () => FakeSocket.all[FakeSocket.all.length - 1]?.open());
  await tick(300);
  const server = async () => (await api.hostState(g.game_id, g.host_token)) as HostState;
  return { api, g, view, server };
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 30, 9, 0, 0) });
  window.sessionStorage.clear();
  FakeSocket.all = [];
  rec.calls = [];
  rec.fail = false;
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the battle on the 3D projector', () => {
  it('a plain battle: the room opened, the way in over the arena, the class round the boss from the roster', async () => {
    const { view, server } = await start();
    // the room's socket for a battle without movement rounds too (the phones' characters)
    expect(FakeSocket.all.length).toBeGreaterThan(0);
    expect(JSON.parse(FakeSocket.all[0].sent[0] ?? '{}')).toMatchObject({ t: 'hello', role: 'host' });
    // drawn without the room's welcome: the scene has the arena's own map
    const made = calls('new')[0][0] as { world?: { stage: number[] }; mixed?: boolean };
    expect(made.world?.stage).toEqual([800, 520, 80]);
    expect(last(calls('setFormation'))).toEqual([true]);
    const s = await server();
    const rows = last(calls('setRoster'))![0] as Array<{ pid: string; name: string }>;
    expect(rows.map((r) => r.pid).sort()).toEqual(s.roster.map((r) => r.player_id).sort());
    // the board: the QR code and the PIN; the bar's «Начать»
    expect(screen.getByRole('img', { name: /QR-код/ })).toBeInTheDocument();
    expect(view.container.querySelector('.lvst-join-text strong')?.textContent).toMatch(/^PIN \d{3}.\d{3}$/);
    expect(screen.getByRole('button', { name: /Начать/ })).toBeEnabled();
    expect(view.container.querySelector('.lvh-viewport')?.hasAttribute('data-arena')).toBe(true);
    // nothing of the flat screen
    expect(view.container.querySelector('.lvh-crowd, .lvh-lobby')).toBeNull();
  });

  it('a button question on the board; its reveal leaps each hit at the boss in order, the ice at the blow', async () => {
    const { view, server } = await start();
    space();
    await tick(500);
    const q = (await server()).question!;
    expect(view.container.querySelector('.lvbt .lvst-q-text')?.textContent).toBe(q.text);
    expect([...view.container.querySelectorAll('.lvbt-options li')].map((li) => li.querySelector('.lvst-opt-text')?.textContent)).toEqual(q.options);
    expect(view.container.querySelector('.lvbt .lvst-hint')?.textContent).toBe('Приготовьтесь');
    await tick(3000);
    expect(view.container.querySelector('.lvbt .lvst-hint')?.textContent).toBe('Отвечайте на телефоне');
    expect(view.container.querySelector('.lvbt-answered')?.textContent).toMatch(/^Ответили \d из \d$/);
    // the reveal: the key, then the hits one by one
    for (let i = 0; i < 30 && (await server()).state !== 'reveal'; i++) await tick(500);
    await tick(1200);
    const s = await server();
    expect(s.state).toBe('reveal');
    expect(view.container.querySelector('.lvbt .lvst-answer')?.textContent).toContain(q.options[s.result!.key]);
    await tick(5000);
    expect(calls('strike').map((a) => a[0])).toEqual(s.result!.hits.map((h) => h.player_id));
    const iced = calls('setIced').filter((a) => a[1] !== true);
    expect(iced.length).toBe(1);
    expect([...(iced[0][0] as Set<string>)].sort()).toEqual(s.roster.filter((r) => r.frozen).map((r) => r.player_id).sort());
    // the three who hit hardest stay under the board; the bar's «Дальше»
    expect(view.container.querySelectorAll('.lvmx-hits li').length).toBe(Math.min(3, s.result!.hits.length));
    expect(screen.getByRole('button', { name: /Дальше/ })).toBeEnabled();
    // the five best over the arena
    space();
    await tick(800);
    expect(view.container.querySelector('.lvbt-veil h1')?.textContent).toBe('Больше всех урона');
    expect(view.container.querySelectorAll('.lvst-top li').length).toBeGreaterThan(0);
  });

  it('the end: the podium over the arena, the three best cheer, the review and «Закончить игру»', async () => {
    const { view, api, g, server } = await start();
    // play the game to its end: the teacher's «next» until the podium
    for (let i = 0; i < 60 && (await server()).state !== 'podium'; i++) {
      const st = (await server()).state;
      if (st === 'lobby' || st === 'reveal' || st === 'leaderboard') await api.next(g.game_id, g.host_token, st);
      await tick(1500);
    }
    await tick(1500);
    expect((await server()).state).toBe('podium');
    expect(view.container.querySelector('.lvbt-veil h1')?.textContent).toMatch(/^Дедлайн (повержен|победил)$/);
    expect(view.container.querySelectorAll('.lvst-pod').length).toBeGreaterThan(0);
    expect(calls('cheer').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Разбор' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Закончить игру/ })).toBeInTheDocument();
  });

  it('a mixed game: its movement round leaves the ring for the arena, the next button question brings the class back', async () => {
    const { view, api, g, server } = await start({ ...SETTINGS, stand_every: 3, boss: 'clock' });
    for (let i = 0; i < 60 && !(await server()).question?.stand; i++) {
      const st = (await server()).state;
      if (st === 'lobby' || st === 'reveal' || st === 'leaderboard') await api.next(g.game_id, g.host_token, st);
      await tick(1500);
    }
    await tick(1200);
    expect((await server()).question?.stand).toBe(true);
    expect(last(calls('setFormation'))).toEqual([false]);
    expect(view.container.querySelector('.lvmx-head .lvst-hint')?.textContent).toBe('Мини-игра. Встаньте на верный ответ.');
    expect(view.container.querySelector('.lvbt')).toBeNull();
    for (let i = 0; i < 60 && (await server()).question?.stand; i++) {
      const st = (await server()).state;
      if (st === 'reveal' || st === 'leaderboard') await api.next(g.game_id, g.host_token, st);
      await tick(1500);
    }
    await tick(1200);
    expect(last(calls('setFormation'))).toEqual([true]);
  });

  it('without WebGL the battle\'s flat screen takes over', async () => {
    rec.fail = true;
    const { view } = await start();
    await tick(500);
    expect(view.container.querySelector('.lvh-lobby-site')).not.toBeNull();
    expect(view.container.querySelector('.lvbt')).toBeNull();
  });
});
