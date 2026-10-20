import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { obeyOffline } from './offline';
import type { PlayerController } from './controller';
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
    expect(ctl.submitPin('12345')).toBe(false);
    expect(ctl.getSnapshot().error).toMatch(/шесть цифр/);
    expect(ctl.submitPin('482 913')).toBe(true);
    expect(step()).toBe('builder');
    expect(ctl.getSnapshot().pin).toBe('482913');
  });

  it('a wrong PIN comes back to the PIN step with plain words', async () => {
    await ctl.start({ pin: '111111' });
    ctl.setName('Дима');
    await ctl.confirm();
    expect(step()).toBe('pin');
    expect(ctl.getSnapshot().error).toBe('Игры с PIN 111 111 нет. Проверьте цифры у ведущего.');
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
    await until(() => st()?.state === 'countdown');
    expect(ctl.isOpenNow()).toBe(false);
    ctl.answer(0);
    expect(ctl.getSnapshot().pick).toBeNull();
    await until(() => ctl.isOpenNow());
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

  it('a late answer is refused in plain words', async () => {
    await joinDemo();
    await toOpen();
    // The server closes the question while this phone still shows it open.
    const g = api.peek(ctl.getSnapshot().game!.id)!;
    vi.setSystemTime(Date.parse(new Date(g.questions[g.qi].closesAt + 1600).toISOString()));
    ctl.answer(0);
    await until(() => ctl.getSnapshot().pick?.status === 'late');
    expect(ctl.getSnapshot().notice).toMatch(/Время вышло|Сейчас ответить нельзя/);
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
    expect(rec.playing[rec.playing.length - 1]).toBe(false);
    await ctl.openReview();
    expect(step()).toBe('review');
    const review = ctl.getSnapshot().review!;
    expect(review.items.length).toBe(st()!.qi + 1);
    expect(review.items.every((i) => i.correct)).toBe(true);
    ctl.closeReview();
    expect(step()).toBe('game');
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
