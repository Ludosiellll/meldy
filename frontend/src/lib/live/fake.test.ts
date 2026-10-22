import { describe, expect, it } from 'vitest';
import { createFakeServer, manualClock } from './fake';
import { COUNTDOWN_MS, GRACE_MS, damage } from './rules';
import { LiveError, isUnchanged, type HostState, type PlayerState } from './types';

const T1 = 'A'.repeat(43);
const T2 = 'B'.repeat(43);
const SETTINGS = { mode: 'boss' as const, time_s: 20 as const, speed: true, who: 'pin' as const, chat_names: true };

async function setup(bots = 0) {
  const clock = manualClock();
  const api = createFakeServer({ clock, latencyMs: 0, bots, demoPin: null, autoHost: false, seed: 3 });
  const g = await api.create({ quiz_id: 'q' }, SETTINGS);
  const a = await api.join(g.pin, 'Дима', T1, null);
  const b = await api.join(g.pin, 'Лена', T2, null);
  const host = async () => (await api.hostState(g.game_id, g.host_token)) as HostState;
  const me = async (t = T1) => (await api.state(g.game_id, t)) as PlayerState;
  return { clock, api, g, a, b, host, me };
}

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as LiveError;
  }
  throw new Error('no error');
};

describe('fake live server: states and timing', () => {
  it('lobby → countdown → open by the clock → reveal when all answered → leaderboard → countdown', async () => {
    const { clock, api, g, host, me } = await setup();
    expect((await host()).state).toBe('lobby');
    expect((await api.next(g.game_id, g.host_token, 'lobby')).state).toBe('countdown');
    const s = await me();
    expect(s.state).toBe('countdown');
    expect(s.question?.options).toHaveLength(4);
    expect(s.boss.hp_max).toBe(2 * 6 * 55);
    expect((await err(api.answer(g.game_id, T1, 0, 0))).detail).toBe('early');
    clock.advance(COUNTDOWN_MS);
    expect((await me()).state).toBe('open');
    await api.answer(g.game_id, T1, 0, 0);
    expect((await err(api.answer(g.game_id, T1, 0, 1))).detail).toBe('twice');
    await api.answer(g.game_id, T2, 0, 1);
    expect((await host()).state).toBe('reveal');
    expect((await err(api.next(g.game_id, g.host_token, 'lobby'))).code).toBe('ML011');
    expect((await api.next(g.game_id, g.host_token, 'reveal')).state).toBe('leaderboard');
    const lb = await host();
    expect(lb.top?.length).toBe(2);
    expect((await api.next(g.game_id, g.host_token, 'leaderboard')).state).toBe('countdown');
    expect((await host()).qi).toBe(1);
  });

  it('closes by time with the 1.5 s grace; a late answer is refused', async () => {
    const { clock, api, g, me } = await setup();
    await api.next(g.game_id, g.host_token, 'lobby');
    clock.advance(COUNTDOWN_MS + 20_000 + GRACE_MS - 10);
    await api.answer(g.game_id, T1, 0, 0);
    expect((await me()).state).toBe('open');
    clock.advance(20);
    expect((await me()).state).toBe('reveal');
    expect((await err(api.answer(g.game_id, T2, 0, 0))).code).toBe('ML004');
  });

  it('the server moves a stalled reveal on after 30 s', async () => {
    const { clock, api, g, host } = await setup();
    await api.next(g.game_id, g.host_token, 'lobby');
    clock.advance(COUNTDOWN_MS);
    await api.answer(g.game_id, T1, 0, 0);
    await api.answer(g.game_id, T2, 0, 0);
    expect((await host()).state).toBe('reveal');
    clock.advance(30_000);
    expect((await host()).state).toBe('leaderboard');
  });
});

describe('fake live server: the key and the score', () => {
  it('never sends the key before the question closes, then sends it with counts and the own result', async () => {
    const { clock, api, g, host, me } = await setup();
    await api.next(g.game_id, g.host_token, 'lobby');
    const key = api.peek(g.game_id)!.questions[0].key;
    for (const view of [await me(), await host()]) {
      expect(JSON.stringify(view)).not.toMatch(/"key"/);
      expect(view.result).toBeNull();
    }
    clock.advance(COUNTDOWN_MS + 900);
    await api.answer(g.game_id, T1, 0, key);
    const open = await me();
    expect(open.result).toBeNull();
    expect(open.me.choice).toBe(key);
    expect(JSON.stringify(await host())).not.toMatch(/"key"/);
    await api.answer(g.game_id, T2, 0, (key + 1) % 4);
    const done = await me();
    expect(done.result).toMatchObject({ key, correct: true, dmg: damage(900, 20, 1), right: 1 });
    expect(done.result?.counts.reduce((x, y) => x + y, 0)).toBe(2);
    const lena = await me(T2);
    expect(lena.result).toMatchObject({ correct: false, frozen: true, dmg: 0 });
    const h = await host();
    expect(h.result?.hits).toEqual([{ player_id: done.me.player_id, dmg: damage(900, 20, 1), hp_after: 660 - damage(900, 20, 1) }]);
    expect(h.result?.frozen_now).toEqual([lena.me.player_id]);
    expect(h.boss.hp).toBe(660 - damage(900, 20, 1));
  });

  it('a frozen player thaws with a right answer and deals no damage', async () => {
    const { clock, api, g, me } = await setup();
    const g0 = api.peek(g.game_id)!;
    await api.next(g.game_id, g.host_token, 'lobby');
    clock.advance(COUNTDOWN_MS);
    const k0 = g0.questions[0].key;
    await api.answer(g.game_id, T1, 0, (k0 + 1) % 4);
    await api.answer(g.game_id, T2, 0, k0);
    expect((await me()).me.frozen).toBe(true);
    await api.next(g.game_id, g.host_token, 'reveal');
    await api.next(g.game_id, g.host_token, 'leaderboard');
    clock.advance(COUNTDOWN_MS);
    const k1 = g0.questions[1].key;
    await api.answer(g.game_id, T1, 1, k1);
    await api.answer(g.game_id, T2, 1, k1);
    const s = await me();
    expect(s.result).toMatchObject({ correct: true, thawed: true, dmg: 0 });
    expect(s.me).toMatchObject({ frozen: false, streak: 1 });
  });

  it('plays to the podium; the boss falls when the class is right and fast', async () => {
    const { clock, api, g, host, me } = await setup();
    const g0 = api.peek(g.game_id)!;
    await api.next(g.game_id, g.host_token, 'lobby');
    for (let qi = 0; qi < 6; qi += 1) {
      clock.advance(COUNTDOWN_MS);
      const k = g0.questions[qi].key;
      await api.answer(g.game_id, T1, qi, k);
      await api.answer(g.game_id, T2, qi, k);
      const h = await host();
      expect(h.state).toBe('reveal');
      if (h.boss.defeated) break;
      await api.next(g.game_id, g.host_token, 'reveal');
      await api.next(g.game_id, g.host_token, 'leaderboard');
    }
    expect((await host()).boss.defeated).toBe(true);
    expect((await api.next(g.game_id, g.host_token, 'reveal')).state).toBe('podium');
    const s = await me();
    expect(s.final).toMatchObject({ won: true, accuracy_pct: 100 });
    expect(s.final?.unlocked_now).toContain('crown');
    const review = await api.review(g.game_id, T1);
    expect(review.items.length).toBe(g0.qi + 1);
    expect(review.items.every((i) => i.correct)).toBe(true);
  });

  it('a late player adds HP for the questions not opened yet', async () => {
    const { clock, api, g, host } = await setup();
    await api.next(g.game_id, g.host_token, 'lobby');
    clock.advance(COUNTDOWN_MS + 1);
    const before = (await host()).boss.hp_max;
    await api.join(g.pin, 'Вера', 'C'.repeat(43), null);
    expect((await host()).boss.hp_max).toBe(before + 55 * 5);
    expect((await err(api.answer(g.game_id, 'C'.repeat(43), 0, 0))).detail).toBe('not_joined_yet');
  });
});

describe('fake live server: refusals and polling', () => {
  it('refuses a wrong host token, an unknown PIN, a rude name and a locked part', async () => {
    const { api, g } = await setup();
    expect((await err(api.hostState(g.game_id, 'x'.repeat(43)))).code).toBe('42501');
    expect((await err(api.join('000000', 'Оля', 'D'.repeat(43), null))).status).toBe(404);
    expect((await err(api.join(g.pin, 'сука', 'D'.repeat(43), null))).code).toBe('ML006');
    expect((await err(api.join(g.pin, 'Оля', 'D'.repeat(43), { body: 'round', colour: 'blue', eyes: 'dots', hat: 'crown' }))).detail).toBe('locked');
  });

  it('the PIN step as live_pin: open with the mode, the same token taken back, refusals as data, nothing changed', async () => {
    const { api, g, a } = await setup();
    const D = 'D'.repeat(43);
    const players = () => api.peek(g.game_id)!.players.size;
    const rev = () => api.peek(g.game_id)!.rev;
    const before = [players(), rev()];
    expect(await api.pin(g.pin, D)).toEqual({ status: 'open', mode: 'boss' });
    expect([players(), rev()]).toEqual(before);
    expect(await api.pin('000000', D)).toEqual({ status: 'refused', code: 'P0002', detail: 'pin', http: 404, retry_after: null });
    expect(await api.pin(g.pin, 'short')).toEqual({ status: 'refused', code: '22023', detail: 'token', http: 400, retry_after: null });
    const back = await api.pin(g.pin, T1);
    expect(back).toMatchObject({ status: 'joined', game_id: g.game_id, player_id: a.player_id, name: 'Дима', wardrobe: null });
    expect([players(), rev()]).toEqual(before);
    await api.kick(g.game_id, g.host_token, a.player_id);
    expect(await api.pin(g.pin, T1)).toMatchObject({ status: 'refused', code: '42501', detail: 'kicked', http: 403 });
    api.peek(g.game_id)!.state = 'podium';
    expect(await api.pin(g.pin, D)).toMatchObject({ status: 'refused', code: 'ML002', detail: 'ended' });
    expect(await api.pin(g.pin, T2)).toMatchObject({ status: 'joined', name: 'Лена' });
  });

  it('answers «unchanged» when the rev did not move (outside lobby and open), and hints on every state change', async () => {
    const { clock, api, g } = await setup();
    const hints: string[] = [];
    api.subscribe(api.peek(g.game_id)!.topic, (h) => hints.push(h.state));
    await api.next(g.game_id, g.host_token, 'lobby');
    clock.advance(0);
    const s = (await api.state(g.game_id, T1)) as PlayerState;
    expect(isUnchanged(await api.state(g.game_id, T1, s.rev))).toBe(true);
    clock.advance(COUNTDOWN_MS);
    expect(hints).toEqual(['countdown', 'open']);
  });

  it('bots answer by themselves and autoHost runs the demo game alone', async () => {
    const clock = manualClock();
    const api = createFakeServer({ clock, latencyMs: 0, bots: 23, fastBots: true, autoHost: true, seed: 5 });
    const j = await api.join('482913', 'Дима', T1, null);
    clock.advance(4000);
    let s = (await api.state(j.game_id, T1)) as PlayerState;
    expect(s.state).toBe('countdown');
    expect(s.players).toBe(24);
    clock.advance(COUNTDOWN_MS + 2500);
    s = (await api.state(j.game_id, T1)) as PlayerState;
    expect(s.answered).toBe(23);
    await api.answer(j.game_id, T1, 0, 0);
    s = (await api.state(j.game_id, T1)) as PlayerState;
    expect(s.state).toBe('reveal');
    clock.advance(5000);
    s = (await api.state(j.game_id, T1)) as PlayerState;
    expect(s.state).toBe('leaderboard');
    expect(s.top).toHaveLength(5);
  });
});

describe('fake live server: a battle with movement rounds (MODE_MIXED §8, no room here)', () => {
  it('says the plan and which question is a movement round; a tap there is refused and the round closes void by time', async () => {
    const clock = manualClock();
    const api = createFakeServer({ clock, latencyMs: 0, bots: 0, demoPin: null, autoHost: false, seed: 3 });
    const g = await api.create({ quiz_id: 'q' }, { ...SETTINGS, stand_every: 3, boss: 'skeleton' });
    await api.join(g.pin, 'Дима', T1, null);
    const host = async () => (await api.hostState(g.game_id, g.host_token)) as HostState;
    const me = async () => (await api.state(g.game_id, T1)) as PlayerState;
    expect((await host()).mixed).toEqual({ every: 3, rounds: [2, 5] });
    // two button questions, the first right
    for (const qi of [0, 1]) {
      await api.next(g.game_id, g.host_token, qi === 0 ? 'lobby' : 'leaderboard');
      expect((await me()).question?.stand).toBe(false);
      clock.advance(COUNTDOWN_MS);
      const key = api.peek(g.game_id)!.questions[qi].key;
      await api.answer(g.game_id, T1, qi, key);
      await api.next(g.game_id, g.host_token, 'reveal');
    }
    const before = await me();
    await api.next(g.game_id, g.host_token, 'leaderboard');
    const round = await me();
    expect(round.question?.stand).toBe(true);
    clock.advance(COUNTDOWN_MS);
    expect((await err(api.answer(g.game_id, T1, 2, 0))).detail).toBe('stand');
    // the room never writes it: 8 s after the deadline the database closes it as void
    clock.advance(20_000 + GRACE_MS + 10);
    expect((await me()).state).toBe('open');
    clock.advance(8000);
    const after = await me();
    expect(after.state).toBe('reveal');
    expect(after.result).toMatchObject({ stand: true, void: true, counts: [0, 0, 0, 0], healed: 0, none: true, frozen: false });
    expect(after.me.streak).toBe(before.me.streak);
    expect(after.boss.hp).toBe(before.boss.hp);
    await api.next(g.game_id, g.host_token, 'reveal');
    await api.end(g.game_id, g.host_token);
    const review = await api.review(g.game_id, T1);
    expect(review.items.map((i) => i.stand === true)).toEqual([false, false, true]);
  });

  it('a plain battle and a stand game carry no plan', async () => {
    const { host } = await setup();
    expect((await host()).mixed).toBeUndefined();
    expect((await host()).question).toBeNull();
  });
});
