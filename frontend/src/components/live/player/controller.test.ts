import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { LiveError, type Hint, type LiveApi, type Look } from '../../../lib/live/types';
import { obeyOffline } from './offline';
import { closedOf, type PlayerController } from './controller';
import { controller, fakeApi, keyOf, newRecorder, recordingPlatform, until, useGameClock, type FakeApi, type Recorder } from './testkit';

let api: FakeApi;
let rec: Recorder;
let ctl: PlayerController;

const st = () => ctl.getSnapshot().state;
const step = () => ctl.getSnapshot().step;

async function joinDemo(name = 'Дима') {
  await ctl.start({ pin: '482913' });
  expect(step()).toBe('builder');
  ctl.setName(name);
  await ctl.confirm();
  expect(step()).toBe('game');
  await until(() => st()?.state === 'lobby');
}

async function toOpen() {
  await until(() => st()?.state === 'countdown' || st()?.state === 'open');
  await until(() => ctl.isOpenNow());
}

/** Another player on the same server (its own controller; the tab's storage is cleared after it joined). */
async function otherJoins(name = 'Лена'): Promise<PlayerController> {
  const other = controller(api, recordingPlatform(newRecorder()));
  await other.start({ pin: '482913' });
  other.setName(name);
  await other.confirm();
  window.sessionStorage.clear();
  return other;
}

/** The same API with some calls replaced (the rest go to the fake). */
function withCalls(over: Partial<LiveApi>): LiveApi {
  return Object.assign(Object.create(api) as LiveApi, over);
}

beforeEach(() => {
  useGameClock();
  window.sessionStorage.clear();
  window.localStorage.clear();
  api = fakeApi();
  rec = newRecorder();
  ctl = controller(api, recordingPlatform(rec));
});

afterEach(() => {
  ctl.dispose();
  vi.useRealTimers();
});

describe('player controller on the fake server', () => {
  it('no PIN in the address: the PIN step, which takes six digits only', async () => {
    await ctl.start({ pin: null });
    expect(step()).toBe('pin');
    expect(await ctl.submitPin('12345')).toBe(false);
    expect(ctl.getSnapshot().error).toMatch(/шесть цифр/);
    expect(await ctl.submitPin('482 913')).toBe(true);
    expect(step()).toBe('builder');
    expect(ctl.getSnapshot().pin).toBe('482913');
  });

  it('a wrong PIN is told on the PIN step, before the character (typed or from the address)', async () => {
    await ctl.start({ pin: null });
    expect(await ctl.submitPin('111111')).toBe(false);
    expect(step()).toBe('pin');
    expect(ctl.getSnapshot().error).toBe('Игры с PIN 111 111 нет. Проверьте цифры у ведущего.');
    expect(ctl.getSnapshot().busy).toBe(false);
    ctl.dispose();
    ctl = controller(api, recordingPlatform(rec));
    await ctl.start({ pin: '111111' });
    expect(step()).toBe('pin');
    expect(ctl.getSnapshot().pin).toBe('111111');
    expect(ctl.getSnapshot().error).toMatch(/^Игры с PIN 111.111 нет/);
  });

  it('the PIN check makes no player: only the join after the builder does', async () => {
    const other = await otherJoins();
    const id = other.getSnapshot().game!.id;
    const before = api.peek(id)!.players.size;
    await ctl.start({ pin: null });
    expect(await ctl.submitPin('482913')).toBe(true);
    expect(step()).toBe('builder');
    expect(api.peek(id)!.players.size).toBe(before);
    ctl.setName('Дима');
    await ctl.confirm();
    expect(step()).toBe('game');
    expect(api.peek(id)!.players.size).toBe(before + 1);
    other.dispose();
  });

  it('a finished game\'s PIN is told before the character', async () => {
    await joinDemo();
    const id = ctl.getSnapshot().game!.id;
    await api.end(id, api.peek(id)!.hostToken);
    ctl.dispose();
    window.sessionStorage.clear();
    ctl = controller(api, recordingPlatform(rec));
    await ctl.start({ pin: '482913' });
    expect(step()).toBe('pin');
    expect(ctl.getSnapshot().error).toMatch(/Игры с PIN 482.913 нет|Эта игра уже закончилась/);
  });

  it('a members-only refusal stops a web guest at the PIN, not a Telegram player (their account decides)', async () => {
    const members = withCalls({ join: () => Promise.reject(new LiveError('ML003', 'members', 403)) });
    ctl.dispose();
    ctl = controller(members, recordingPlatform(rec));
    await ctl.start({ pin: '482913' });
    expect(step()).toBe('pin');
    expect(ctl.getSnapshot().error).toMatch(/только участники экзамена/);
    ctl.dispose();
    ctl = controller(members, { ...recordingPlatform(rec), kind: 'telegram' });
    await ctl.start({ pin: '482913' });
    expect(step()).toBe('builder');
  });

  it('the PIN check finds this identity already in the game: that join is kept, no builder', async () => {
    await joinDemo();
    const first = ctl.getSnapshot();
    const token = ctl.playerToken()!;
    ctl.dispose();
    // The token is kept, the game's record is not (as a signed-in user on another device is found by the account).
    window.sessionStorage.removeItem(`meldy.live.game.${first.game!.id}`);
    const rejoin = withCalls({ join: (pin: string, name: string, tok: string, look: Look | null) => api.join(pin, tok === token ? name || 'Дима' : name, tok, look) });
    ctl = controller(rejoin, recordingPlatform(rec));
    await ctl.start({ pin: '482913' });
    expect(step()).toBe('game');
    expect(ctl.getSnapshot().game?.playerId).toBe(first.game?.playerId);
  });

  it('the builder: the name gives the first look; locked parts say how they open; the name is checked', async () => {
    await ctl.start({ pin: '482913' });
    ctl.setName('Дима');
    const first = ctl.getSnapshot().look;
    ctl.setName('Лена');
    expect(ctl.getSnapshot().look).not.toEqual(first);
    ctl.choose('hat', 'crown');
    expect(ctl.getSnapshot().look.hat).not.toBe('crown');
    expect(ctl.getSnapshot().lockedTap).toEqual({ part: 'hat', id: 'crown' });
    expect(rec.haptics[rec.haptics.length - 1]).toBe('warning');
    ctl.choose('hat', 'phones');
    expect(ctl.getSnapshot().look.hat).toBe('phones');
    expect(rec.haptics[rec.haptics.length - 1]).toBe('select');
    // a chosen part stays when the name changes
    ctl.setName('Лена2');
    expect(ctl.getSnapshot().look.hat).toBe('phones');
    ctl.setName('   ');
    await ctl.confirm();
    expect(step()).toBe('builder');
    expect(ctl.getSnapshot().error).toMatch(/Напишите имя/);
  });

  it('joins with the look, keeps the token in this tab, and follows lobby → countdown → open', async () => {
    await ctl.start({ pin: '482913' });
    ctl.setName('Дима');
    ctl.choose('colour', 'orange');
    await ctl.confirm();
    const s = ctl.getSnapshot();
    expect(s.game?.id).toBeTruthy();
    expect(s.look.colour).toBe('orange');
    expect(window.sessionStorage.getItem(`meldy.live.player.${s.game?.id}`)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rec.playing).toContain(true);
    await until(() => st()?.state === 'lobby');
    expect(st()?.me.name).toBe('Дима');
    expect(st()?.crowd?.length).toBe(3);
    expect(ctl.getSnapshot().lateQi).toBeNull();
    await until(() => st()?.state === 'countdown');
    expect(ctl.isOpenNow()).toBe(false);
    ctl.answer(0);
    expect(ctl.getSnapshot().pick).toBeNull();
    await until(() => ctl.isOpenNow());
    expect(ctl.getSnapshot().lateQi).toBeNull();
  });

  it('a right answer: shown at once, accepted, then the hit with damage and streak', async () => {
    await joinDemo();
    await toOpen();
    const key = keyOf(api, ctl.getSnapshot().game!.id);
    ctl.answer(key);
    expect(ctl.getSnapshot().pick).toMatchObject({ choice: key, status: 'sending' });
    expect(rec.haptics).toContain('tap');
    // one answer a question
    ctl.answer((key + 1) % 4);
    expect(ctl.getSnapshot().pick?.choice).toBe(key);
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    expect(ctl.getSnapshot().answered).toBeGreaterThanOrEqual(1);
    await until(() => st()?.state === 'reveal');
    const r = st()!.result!;
    expect(r.correct).toBe(true);
    expect(r.key).toBe(key);
    expect(r.dmg).toBeGreaterThanOrEqual(50);
    expect(st()!.me.streak).toBe(1);
    expect(ctl.getSnapshot().hpFrom).toBe(st()!.boss.hp_max);
    expect(st()!.boss.hp).toBeLessThan(st()!.boss.hp_max);
    await until(() => st()?.state === 'leaderboard');
    expect(st()!.top!.length).toBeGreaterThan(0);
    expect(st()!.me.place).toBeGreaterThanOrEqual(1);
  });

  it('the seconds shown are the server\'s (the ack), the ones the damage counts; the answer\'s order too', async () => {
    await joinDemo();
    await toOpen();
    const id = ctl.getSnapshot().game!.id;
    await vi.advanceTimersByTimeAsync(2300);
    ctl.answer(keyOf(api, id));
    expect(ctl.getSnapshot().pick).toMatchObject({ status: 'sending', elapsedMs: null, order: null });
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    const q = api.peek(id)!.questions[0];
    const me = ctl.getSnapshot().game!.playerId;
    expect(ctl.getSnapshot().pick?.elapsedMs).toBe(q.answers.get(me)!.elapsedMs);
    expect(ctl.getSnapshot().pick?.elapsedMs).toBeGreaterThanOrEqual(2300);
    expect(ctl.getSnapshot().pick?.order).toBe([...q.answers.keys()].indexOf(me) + 1);
  });

  it('an answer whose ack was lost: taken, but no seconds (a guess could contradict the damage)', async () => {
    let lose = true;
    const lossy = withCalls({
      answer: async (game: string, tok: string, qi: number, choice: number) => {
        const ack = await api.answer(game, tok, qi, choice);
        if (lose) {
          lose = false;
          throw new LiveError('network', null, 0);
        }
        return ack;
      },
    });
    ctl.dispose();
    ctl = controller(lossy, recordingPlatform(rec));
    await joinDemo();
    await toOpen();
    ctl.answer(keyOf(api, ctl.getSnapshot().game!.id));
    await until(() => ctl.getSnapshot().pick?.status === 'retrying');
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    expect(ctl.getSnapshot().pick).toMatchObject({ status: 'accepted', elapsedMs: null, order: null });
  });

  it('a wrong answer freezes; the next right answer thaws without damage', async () => {
    await joinDemo();
    await toOpen();
    const key = keyOf(api, ctl.getSnapshot().game!.id);
    ctl.answer((key + 1) % 4);
    await until(() => st()?.state === 'reveal');
    expect(st()!.result).toMatchObject({ correct: false, frozen: true, none: false });
    expect(st()!.me.frozen).toBe(true);
    expect(ctl.getSnapshot().frozenBefore).toBe(false);
    await until(() => st()?.state === 'countdown' && st()!.qi === 1);
    expect(ctl.getSnapshot().frozenBefore).toBe(true);
    expect(ctl.getSnapshot().pick).toBeNull();
    await toOpen();
    ctl.answer(keyOf(api, ctl.getSnapshot().game!.id));
    await until(() => st()?.state === 'reveal');
    expect(st()!.result).toMatchObject({ correct: true, thawed: true, dmg: 0 });
    expect(st()!.me.frozen).toBe(false);
    expect(st()!.me.streak).toBe(1);
  });

  it('a late answer is refused: said beside the character, no passing line over the answers', async () => {
    await joinDemo();
    await toOpen();
    // The server closes the question while this phone still shows it open.
    const g = api.peek(ctl.getSnapshot().game!.id)!;
    vi.setSystemTime(Date.parse(new Date(g.questions[g.qi].closesAt + 1600).toISOString()));
    ctl.answer(0);
    await until(() => ctl.getSnapshot().pick?.status === 'late');
    expect(ctl.getSnapshot().notice).toBeNull();
  });

  it('joined while a question is open: that question is sat out from the start, the next one counts', async () => {
    const other = await otherJoins();
    await until(() => other.getSnapshot().state?.state === 'open');
    await ctl.start({ pin: '482913' });
    ctl.setName('Дима');
    await ctl.confirm();
    await until(() => st()?.state === 'open' && st()?.qi === 0);
    expect(ctl.getSnapshot().lateQi).toBe(0);
    ctl.answer(0);
    expect(ctl.getSnapshot().pick).toBeNull();
    expect(rec.haptics).not.toContain('tap');
    // The next question: in like everyone.
    await until(() => st()?.qi === 1 && (st()?.state === 'countdown' || st()?.state === 'open'));
    await toOpen();
    ctl.answer(keyOf(api, ctl.getSnapshot().game!.id));
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    expect(ctl.getSnapshot().notice).toBeNull();
    // A reload keeps the join's time: the sat-out question stays sat out, the rest is in.
    const kept = JSON.parse(window.sessionStorage.getItem(`meldy.live.game.${ctl.getSnapshot().game!.id}`) ?? '{}') as { joinedAt?: number };
    expect(typeof kept.joinedAt).toBe('number');
    other.dispose();
  });

  it('a rejoin this tab could not date: the server\'s «not yet» turns into the sit-out line, not a toast', async () => {
    const other = await otherJoins();
    await until(() => other.getSnapshot().state?.state === 'open');
    // A player made during the question, kept by an older page that did not write the join's time.
    const token = 'T'.repeat(43);
    const joined = await api.join('482913', 'Дима', token, null);
    window.sessionStorage.setItem('meldy.live.pin.482913', joined.game_id);
    window.sessionStorage.setItem(`meldy.live.game.${joined.game_id}`, JSON.stringify({ topic: joined.topic, playerId: joined.player_id, guest: true }));
    window.sessionStorage.setItem(`meldy.live.player.${joined.game_id}`, token);
    await ctl.start({ pin: '482913' });
    expect(step()).toBe('game');
    expect(ctl.getSnapshot().lateQi).toBeNull();
    await until(() => ctl.isOpenNow());
    ctl.answer(0);
    await until(() => ctl.getSnapshot().lateQi === 0);
    expect(ctl.getSnapshot().pick).toBeNull();
    expect(ctl.getSnapshot().notice).toBeNull();
    other.dispose();
  });

  it('plays to the end: the boss\'s phases, the final with unlocks, the review', async () => {
    let phases = 0;
    for (let q = 0; q < 6; q += 1) {
      if (q === 0) await joinDemo();
      await until(() => ['countdown', 'open', 'podium', 'ended'].includes(st()?.state ?? ''));
      if (st()?.state === 'podium' || st()?.state === 'ended') break;
      await toOpen();
      ctl.answer(keyOf(api, ctl.getSnapshot().game!.id));
      await until(() => st()?.state === 'reveal');
      if (st()!.result!.phase_changed) phases += 1;
      await until(() => st()?.state === 'leaderboard' || st()?.state === 'podium');
      if (st()?.state === 'podium') break;
    }
    await until(() => st()?.state === 'podium');
    expect(phases).toBeGreaterThanOrEqual(1);
    const f = st()!.final!;
    expect(f.won).toBe(true);
    expect(f.place).toBeGreaterThanOrEqual(1);
    expect(f.unlocked_now).toContain('crown');
    expect(st()!.top!.length).toBeGreaterThan(0);
    expect(rec.playing[rec.playing.length - 1]).toBe(false);
    await ctl.openReview();
    expect(step()).toBe('review');
    const review = ctl.getSnapshot().review!;
    expect(review.items.length).toBe(st()!.qi + 1);
    expect(review.items.every((i) => i.correct)).toBe(true);
    ctl.closeReview();
    expect(step()).toBe('game');
  });

  it('the host ends the game mid-way: ended without a final; the review of the closed questions is read once', async () => {
    await joinDemo();
    await toOpen();
    ctl.answer(keyOf(api, ctl.getSnapshot().game!.id));
    await until(() => st()?.state === 'reveal');
    await until(() => st()?.qi === 1 && st()?.state === 'open');
    const g = api.peek(ctl.getSnapshot().game!.id)!;
    const review = vi.spyOn(api, 'review');
    await api.end(g.id, g.hostToken);
    await until(() => st()?.state === 'ended');
    expect(st()!.final).toBeNull();
    expect(st()!.question).toBeNull();
    expect(closedOf(st()!)).toBe(1);
    await until(() => ctl.getSnapshot().review !== null);
    expect(ctl.getSnapshot().review!.items).toHaveLength(1);
    expect(ctl.getSnapshot().review!.items[0].correct).toBe(true);
    expect(ctl.getSnapshot().step).toBe('game');
    expect(rec.playing[rec.playing.length - 1]).toBe(false);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('the host ends the game in the lobby: ended, nothing closed, no review asked', async () => {
    await joinDemo();
    const g = api.peek(ctl.getSnapshot().game!.id)!;
    const review = vi.spyOn(api, 'review');
    await api.end(g.id, g.hostToken);
    await until(() => st()?.state === 'ended');
    expect(st()!.final).toBeNull();
    expect(closedOf(st()!)).toBe(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(review).not.toHaveBeenCalled();
  });

  it('a reload goes on with the kept token (the same player, the same game)', async () => {
    await joinDemo();
    await toOpen();
    const key = keyOf(api, ctl.getSnapshot().game!.id);
    ctl.answer(key);
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    const before = ctl.getSnapshot();
    ctl.dispose();
    // A new page: the same tab's storage, the same server.
    const again = controller(api, recordingPlatform(newRecorder()));
    await again.start({ pin: '482913' });
    const s = again.getSnapshot();
    expect(s.step).toBe('game');
    expect(s.game?.id).toBe(before.game?.id);
    expect(s.state?.me.player_id).toBe(before.state?.me.player_id);
    expect(s.pick).toMatchObject({ choice: key, status: 'accepted', elapsedMs: null });
    expect(s.lateQi).toBeNull();
    again.dispose();
  });

  it('a lost network: the line says so, the answer retries and goes through when the network is back', async () => {
    api = fakeApi();
    ctl.dispose();
    ctl = controller(obeyOffline(api), recordingPlatform(rec));
    await joinDemo();
    await toOpen();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    expect(ctl.getSnapshot().link).toBe('lost');
    const key = keyOf(api, ctl.getSnapshot().game!.id);
    ctl.answer(key);
    await until(() => ctl.getSnapshot().pick?.status === 'retrying');
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    await until(() => ctl.getSnapshot().link === 'ok');
    online.mockRestore();
  });

  it('a channel that never joins is subscribed again, later and later; a joined one is left alone', async () => {
    // The channel's answers in turn: refused, refused, joined.
    const answers = [false, false, true];
    let subscribes = 0;
    const flaky = withCalls({
      subscribe: (topic: string, onHint: (h: Hint) => void, onLink?: (c: boolean) => void) => {
        subscribes += 1;
        const unsubscribe = api.subscribe(topic, onHint);
        const ok = answers.shift() ?? true;
        setTimeout(() => onLink?.(ok), 0);
        return unsubscribe;
      },
    });
    ctl.dispose();
    ctl = controller(flaky, recordingPlatform(rec));
    await joinDemo();
    expect(subscribes).toBe(1);
    // Polling every second meanwhile; 20 s without the channel → the old one leaves, a new subscribe 1.5 s later.
    await vi.advanceTimersByTimeAsync(23_000);
    expect(subscribes).toBe(2);
    // Still refused: the next try waits twice as long.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(subscribes).toBe(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(subscribes).toBe(3);
    // Joined now: left alone.
    await vi.advanceTimersByTimeAsync(200_000);
    expect(subscribes).toBe(3);
  });

  it('back online without the channel: subscribed again at once (after the old one leaves)', async () => {
    let subscribes = 0;
    const down = withCalls({
      subscribe: (topic: string, onHint: (h: Hint) => void, onLink?: (c: boolean) => void) => {
        subscribes += 1;
        const unsubscribe = api.subscribe(topic, onHint);
        setTimeout(() => onLink?.(subscribes > 1), 0);
        return unsubscribe;
      },
    });
    ctl.dispose();
    ctl = controller(down, recordingPlatform(rec));
    await joinDemo();
    expect(subscribes).toBe(1);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1600);
    expect(subscribes).toBe(2);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(subscribes).toBe(2);
  });

  it('kicked by the host: the game says so and stops', async () => {
    await joinDemo();
    const g = api.peek(ctl.getSnapshot().game!.id)!;
    await api.kick(g.id, g.hostToken, ctl.getSnapshot().state!.me.player_id);
    await until(() => step() === 'gone');
    expect(ctl.getSnapshot().gone?.title).toBe('Ведущий убрал вас из игры');
  });

  it('the lobby\'s «Изменить персонажа» saves the look; the game starting meanwhile keeps the old one', async () => {
    await joinDemo();
    ctl.editLook();
    expect(step()).toBe('builder');
    expect(ctl.getSnapshot().builderFrom).toBe('lobby');
    const hat = st()!.me.look.hat === 'bow' ? 'cap' : 'bow';
    ctl.choose('hat', hat);
    await ctl.confirm();
    expect(step()).toBe('game');
    expect(st()!.me.look.hat).toBe(hat);
    ctl.editLook();
    ctl.choose('hat', hat === 'bow' ? 'cap' : 'bow');
    await until(() => st()?.state === 'countdown');
    expect(step()).toBe('game');
    expect(ctl.getSnapshot().notice).toMatch(/Игра началась/);
    expect(ctl.getSnapshot().look.hat).toBe(hat);
  });
});
