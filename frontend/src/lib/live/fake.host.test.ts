/**
 * The fake server's rules the teacher's screen depends on (W1's contract changes, 20.10): a kicked player leaves the
 * top and the podium but keeps their damage in the HP; a late joiner adds HP only while the boss is alive; a game on
 * the podium no longer counts as open for ML009; kick and end resolve.
 */
import { describe, expect, it } from 'vitest';
import { createFakeServer, manualClock, type FakeQuestion } from './fake';
import { COUNTDOWN_MS } from './rules';
import { LiveError, type HostState } from './types';

const SETTINGS = { mode: 'boss' as const, time_s: 20 as const, speed: true, who: 'pin' as const, chat_names: false };
const T = (c: string) => c.repeat(43);
const SHORT: FakeQuestion[] = [
  { text: 'Один', options: ['a', 'b'], key: 0, keepOrder: true },
  { text: 'Два', options: ['a', 'b'], key: 1, keepOrder: true },
  { text: 'Три', options: ['a', 'b'], key: 0, keepOrder: true },
];

function server(questions?: FakeQuestion[]) {
  const clock = manualClock();
  const api = createFakeServer({ clock, latencyMs: 0, bots: 0, demoPin: null, autoHost: false, seed: 5, questions });
  return { clock, api };
}

describe('fake server: what the host screen relies on', () => {
  it('kick and end resolve; a kicked player is out of the top, their damage stays in the HP', async () => {
    const { clock, api } = server();
    const g = await api.create({ quiz_id: 'q' }, SETTINGS);
    const a = await api.join(g.pin, 'Дима', T('A'), null);
    await api.join(g.pin, 'Лена', T('B'), null);
    await api.next(g.game_id, g.host_token, 'lobby');
    clock.advance(COUNTDOWN_MS);
    const key = api.peek(g.game_id)!.questions[0].key;
    await api.answer(g.game_id, T('A'), 0, key);
    await api.answer(g.game_id, T('B'), 0, key === 0 ? 1 : 0);
    const reveal = (await api.hostState(g.game_id, g.host_token)) as HostState;
    expect(reveal.state).toBe('reveal');
    const hp = reveal.boss.hp;
    expect(hp).toBeLessThan(reveal.boss.hp_max);
    await expect(api.kick(g.game_id, g.host_token, a.player_id)).resolves.toBeUndefined();
    const board = await api.next(g.game_id, g.host_token, 'reveal');
    expect(board.state).toBe('leaderboard');
    expect(board.top?.map((r) => r.player_id)).not.toContain(a.player_id);
    expect(board.roster.map((r) => r.player_id)).not.toContain(a.player_id);
    expect(board.boss.hp).toBe(hp);
    await expect(api.end(g.game_id, g.host_token)).resolves.toBeUndefined();
    expect(((await api.hostState(g.game_id, g.host_token)) as HostState).state).toBe('ended');
  });

  it('tgPost answers «posting», then 429 with the wait within a minute; refused once the game ended', async () => {
    const { clock, api } = server();
    const g = await api.create({ quiz_id: 'q' }, SETTINGS);
    await expect(api.tgPost(g.game_id, -1001)).resolves.toEqual({ status: 'posting' });
    clock.advance(20_000);
    const again = await api.tgPost(g.game_id, -1001).catch((e: LiveError) => e);
    expect(again).toBeInstanceOf(LiveError);
    expect(again).toMatchObject({ code: 'ML005', detail: 'post', status: 429, retryAfterS: 40 });
    clock.advance(40_000);
    await expect(api.tgPost(g.game_id, -1002)).resolves.toEqual({ status: 'posting' });
    await api.end(g.game_id, g.host_token);
    clock.advance(60_000);
    await expect(api.tgPost(g.game_id, -1001)).rejects.toMatchObject({ code: 'ML002', detail: 'ended' });
    await expect(api.tgPost('00000000-0000-4000-8000-000000000000', -1001)).rejects.toMatchObject({ code: 'P0002', detail: 'game', status: 404 });
  });

  it('a late joiner adds HP while the boss lives, never after it fell; a podium game is not open', async () => {
    const { clock, api } = server(SHORT);
    const g = await api.create({ quiz_id: 'q' }, SETTINGS);
    await api.join(g.pin, 'Дима', T('A'), null);
    await api.next(g.game_id, g.host_token, 'lobby');
    const s0 = (await api.hostState(g.game_id, g.host_token)) as HostState;
    expect(s0.boss.hp_max).toBe(3 * 55);
    // a late joiner during the first countdown: + 55 × 3 questions not yet opened
    await api.join(g.pin, 'Лена', T('B'), null);
    const s1 = (await api.hostState(g.game_id, g.host_token)) as HostState;
    expect(s1.boss.hp_max).toBe(6 * 55);
    // kill it: two right answers at once, then the second question
    for (let qi = 0; qi < 3; qi += 1) {
      const st = (await api.hostState(g.game_id, g.host_token)) as HostState;
      if (st.boss.defeated) break;
      if (st.state === 'leaderboard') await api.next(g.game_id, g.host_token, 'leaderboard');
      clock.advance(COUNTDOWN_MS);
      const key = api.peek(g.game_id)!.questions[qi].key;
      await api.answer(g.game_id, T('A'), qi, key);
      await api.answer(g.game_id, T('B'), qi, key);
      const after = (await api.hostState(g.game_id, g.host_token)) as HostState;
      if (!after.boss.defeated) await api.next(g.game_id, g.host_token, 'reveal');
    }
    const dead = (await api.hostState(g.game_id, g.host_token)) as HostState;
    expect(dead.boss.defeated).toBe(true);
    expect(dead.state).toBe('reveal');
    await api.join(g.pin, 'Вера', T('C'), null);
    const still = (await api.hostState(g.game_id, g.host_token)) as HostState;
    expect(still.boss.hp).toBe(0);
    expect(still.boss.hp_max).toBe(dead.boss.hp_max);
    expect((await api.next(g.game_id, g.host_token, 'reveal')).state).toBe('podium');
    // ML009: the podium game is not open — two more games fit, the third is refused
    await api.create({ quiz_id: 'q' }, SETTINGS);
    await api.create({ quiz_id: 'q' }, SETTINGS);
    await api.create({ quiz_id: 'q' }, SETTINGS);
    const refused = await api.create({ quiz_id: 'q' }, SETTINGS).catch((e: LiveError) => e);
    expect(refused).toBeInstanceOf(LiveError);
    expect((refused as LiveError).code).toBe('ML009');
  });
});
