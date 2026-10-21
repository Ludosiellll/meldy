/**
 * The projector of a battle with movement rounds (docs/live/MODE_MIXED.md §8) against the fake server's mixed game and
 * a fake room socket: the room opened from the lobby and told after every move, the battle's screens for the button
 * questions with the next mini-game named in the bar, the arena's board for a movement round with the battle's HP bar,
 * the hits on the boss one by one after the stomp, and a round that did not count.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer } from '../../../lib/live/fake';
import type { HostState, Settings } from '../../../lib/live/types';
import { LiveHostView } from '../../../pages/live/LiveHostPage';
import { saveHostInfo, saveHostToken } from '../host/hostSession';
// the lazy screen, loaded before the clock is faked
import './MixedHost';

// No WebGL here: the kit does not load, the board still plays.
vi.mock('../../../lib/live/three', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/live/three')>()),
  loadKit: () => Promise.reject(new Error('no WebGL in the test')),
}));

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
    if (typeof data === 'string' && data.includes('"t":"ping"')) queueMicrotask(() => this.text({ t: 'pong', c: JSON.parse(data).c, tick: 1, ms: 1 }));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  text(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  cmds() {
    return this.sent.map((d) => JSON.parse(d) as { t: string; op?: string }).filter((m) => m.t === 'cmd');
  }
}

const SETTINGS: Settings = { mode: 'boss', time_s: 10, speed: true, who: 'pin', chat_names: false, stand_every: 3, boss: 'clock' };
const hello = { t: 'stand', k: 'hello', v: 1, boss: 'clock', q_count: 6, time_s: 10, speed: true, stage: [800, 520, 80], floor: { x: 20, y: 160, tile: 60, cols: 26, rows: 12 }, letters: ['А', 'Б', 'В', 'Г'], alarm_ms: 3000, fall_ms: 900, floor_ms: 4000, mixed: { every: 3, rounds: [2, 5] } };
const state = (over: Record<string, unknown>) => ({ t: 'stand', k: 'state', phase: 'lobby', qi: -1, q_count: 6, players: 4, q: null, opens: null, closes: null, floor: 'up', res: null, top: null, acc: null, round: null, ...over });

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const space = () => fireEvent.keyDown(window, { key: ' ' });
const sock = () => FakeSocket.all[FakeSocket.all.length - 1];
async function room(msg: unknown) {
  await act(async () => {
    sock().text(msg);
  });
}

async function start() {
  const api = createFakeServer({ bots: 3, latencyMs: 0, demoPin: null, autoHost: false, fastBots: true, seed: 11 });
  const g = await api.create({ container_id: 'c', subject_ids: ['s'], count: 6 }, SETTINGS);
  saveHostToken(g.game_id, g.host_token);
  saveHostInfo(g.game_id, { title: 'Базы данных', joinUrl: g.join_url, containerId: 'c', quizId: null, source: null, settings: SETTINGS });
  const view = render(
    <MemoryRouter initialEntries={[`/live/${g.game_id}`]}>
      <LiveHostView gameId={g.game_id} api={api} />
    </MemoryRouter>,
  );
  for (let i = 0; i < 20 && FakeSocket.all.length === 0; i++) await tick(100);
  const server = async () => (await api.hostState(g.game_id, g.host_token)) as HostState;
  const s0 = await server();
  // the room: the host's welcome with everyone's names, the mode's hello and state
  sock().open();
  await room({ t: 'welcome', v: 1, role: 'host', tick: 100, ms: 5000, hz: 20, snap: 2, q: 10, speed: 260, r: 18, npc_r: 26, map: { w: 1600, h: 900, solids: [], zones: [], spawns: [[800, 520]], npc_spawns: [] }, roster: s0.roster.map((r, i) => [i + 1, 0, r.player_id, r.name, r.look]), frozen: false });
  await room(hello);
  await room(state({}));
  return { api, g, view, server };
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 21, 9, 0, 0) });
  window.sessionStorage.clear();
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the projector of a battle with movement rounds', () => {
  it('opens the room in the lobby, tells it every move, names the next mini-game and plays the movement round in the arena', async () => {
    const { view, server } = await start();
    expect(JSON.parse(FakeSocket.all[0].sent[0])).toMatchObject({ t: 'hello', role: 'host' });
    expect(view.container.querySelector('.lvh-lobby-settings')?.textContent).toMatch(/мини-игра на вопросах 3 и 6$/);
    const viewport = () => view.container.querySelector('.lvh-viewport')!;
    expect(viewport().hasAttribute('data-mixed')).toBe(true);
    expect(viewport().hasAttribute('data-arena')).toBe(false);

    // the first question is a button question: the battle's screen, and the room hears the click
    space();
    await tick(200);
    expect(sock().cmds().filter((c) => c.op === 'sync')).toHaveLength(1);
    expect((await server()).question?.stand).toBe(false);
    expect(viewport().hasAttribute('data-arena')).toBe(false);
    await tick(3000);
    await tick(13_000);
    expect((await server()).state).toBe('reveal');
    await tick(1500);
    expect(view.container.querySelector('.lvh-note')?.textContent).toBe('Мини-игра через 1 вопрос');
    space();
    await tick(500);
    space();
    await tick(3000);
    await tick(13_000);
    expect(view.container.querySelector('.lvh-note')?.textContent).toBe('Следующий вопрос с мини-игрой');
    space();
    await tick(500);
    space();
    await tick(500);

    // the movement round: the arena's board in place of the battle's, the battle's HP bar over it
    const s = await server();
    expect(s.question?.stand).toBe(true);
    expect(viewport().hasAttribute('data-arena')).toBe(true);
    expect(view.container.querySelector('.lvmx .lvst-board')?.textContent).toContain('Мини-игра. Встаньте на верный ответ.');
    expect(view.container.querySelector('.lvmx .lvst-board')?.textContent).toContain(s.question!.text);
    const hpOf = () => view.container.querySelector('.lvmx .lvh-hp-num')?.textContent?.replace(/\s/g, ' ');
    expect(hpOf()).toBe(`${s.boss.hp.toLocaleString('ru-RU').replace(/\s/g, ' ')} из ${s.boss.hp_max.toLocaleString('ru-RU').replace(/\s/g, ' ')}`);
    expect(sock().cmds().filter((c) => c.op === 'sync').length).toBeGreaterThanOrEqual(5);

    // the room's reveal: the hits one by one, the HP after each, the three who hit hardest, who stood and the fastest
    const names = s.roster.map((r) => r.name);
    const hp0 = s.boss.hp;
    await room(state({ phase: 'countdown', qi: 2, round: 'stand', q: { text: s.question!.text, options: s.question!.options }, opens: 8000, closes: 18_000 }));
    await room(
      state({
        phase: 'reveal', qi: 2, round: 'stand', q: { text: s.question!.text, options: s.question!.options }, opens: 8000, closes: 18_000, floor: 'down',
        res: { qi: 2, key: 1, counts: [1, 2, 0, 0], stood: 2, of: 4, fastest: { id: 1, pts: 141, ms: 2500 }, fell: [2, 4], back: [2, 4], at: 1e12, back_at: 1e12 + 4000, thawed: [3], froze: [2, 4], hp: hp0 - 239, hp_max: s.boss.hp_max, phase: 0, defeated: false, healed: 0, phase_changed: null, void: false, pts: [[1, 141], [3, 98]], hits: [[1, 141, hp0 - 141], [3, 98, hp0 - 239]] },
      }),
    );
    expect(view.container.querySelector('.lvst-stood')?.textContent?.replace(/\s/g, ' ')).toBe('Попали 2 из 4');
    expect(view.container.querySelector('.lvst-fastest')?.textContent).toBe(`Быстрее всех ${names[0]}, −141`);
    await tick(1300);
    expect(view.container.querySelector('.lvmx-hits')?.textContent).toContain(`${names[0]}−141`);
    await tick(400);
    await tick(2500);
    const chips = [...view.container.querySelectorAll('.lvmx-hits li')].map((li) => li.textContent);
    expect(chips).toEqual([`${names[0]}−141`, `${names[2]}−98`]);
    expect(hpOf()?.startsWith(`${(hp0 - 239).toLocaleString('ru-RU').replace(/\s/g, ' ')} из`)).toBe(true);
  });

  it('a round the room never wrote says it did not count, with nothing played', async () => {
    const { view, server } = await start();
    for (let i = 0; i < 2; i++) {
      space();
      await tick(500);
      await tick(3000);
      await tick(13_000);
      space();
      await tick(500);
    }
    space();
    await tick(500);
    const s = await server();
    expect(s.question?.stand).toBe(true);
    await room(
      state({
        phase: 'reveal', qi: 2, round: 'stand', q: { text: s.question!.text, options: s.question!.options }, opens: 8000, closes: 18_000, floor: 'up',
        res: { qi: 2, key: 0, counts: [0, 0, 0, 0], stood: 0, of: 4, fastest: null, fell: [], back: [], at: 1e12, back_at: 1e12, thawed: [], froze: [], hp: s.boss.hp, hp_max: s.boss.hp_max, phase: 0, defeated: false, healed: 0, phase_changed: null, void: true, pts: [], hits: [] },
      }),
    );
    expect(view.container.querySelector('.lvmx .lvh-banner')?.textContent).toContain('Мини-игра не засчитана');
    expect(view.container.querySelector('.lvmx-hits')).toBeNull();
  });
});
