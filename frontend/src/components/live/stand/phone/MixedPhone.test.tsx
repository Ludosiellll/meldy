/**
 * A battle with movement rounds on the phone (docs/live/MODE_MIXED.md §8): the battle's own screens, the room's socket
 * from the join on, and in the movement round the arena's screen with no answer buttons and the battle's words for
 * the own result. The database is the fake server's mixed game; the room is a fake socket played by the test.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer } from '../../../../lib/live/fake';
import { encodeSnapshot, STAND_ARENA, type Welcome } from '../../../../lib/live/move/protocol';
import type { PlayerController } from '../../player/controller';
import { PlayerApp } from '../../player/PlayerApp';
import { controller, newRecorder, recordingPlatform, type Recorder } from '../../player/testkit';
// The lazy screens, loaded before the clock is faked.
import './MixedPhone';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    // the room answers pings (the client drops a socket silent for 4 s)
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
  snap(tick: number, flags = 0) {
    this.onmessage?.({ data: encodeSnapshot({ tick, t: tick * 50, ack: 0, ents: [{ id: 7, x: 560, y: 490, flags }] }, 10) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const welcome: Welcome = {
  t: 'welcome', v: 1, role: 'player', tick: 100, ms: 5000, hz: 20, snap: 2, q: 10, speed: 260, r: 18, npc_r: 26,
  map: STAND_ARENA, roster: [[7, 0, 'pid', 'Дима', { body: 'drop', colour: 'blue', hat: 'cap' }]], frozen: false, you: 7, pid: 'pid', resumed: false,
};
const hello = { t: 'stand', k: 'hello', v: 1, boss: 'clock', q_count: 6, time_s: 20, speed: true, stage: [800, 520, 80], floor: { x: 20, y: 160, tile: 60, cols: 26, rows: 12 }, letters: ['А', 'Б', 'В', 'Г'], alarm_ms: 3000, fall_ms: 900, floor_ms: 4000, mixed: { every: 3, rounds: [2, 5] } };
const state = (over: Record<string, unknown>) => ({ t: 'stand', k: 'state', phase: 'lobby', qi: -1, q_count: 6, players: 4, q: null, opens: null, closes: null, floor: 'up', res: null, top: null, acc: null, round: null, ...over });

let rec: Recorder;
let ctl: PlayerController;
let fake: ReturnType<typeof createFakeServer>;
let game: { game_id: string; host_token: string; pin: string };
let tick = 100;

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function until(cond: () => boolean, maxMs = 60_000) {
  for (let t = 0; t <= maxMs; t += 100) {
    if (cond()) return;
    await wait(100);
  }
  throw new Error('the screen never came');
}
const sock = () => FakeSocket.all[FakeSocket.all.length - 1];
async function room(msg: unknown) {
  await act(async () => {
    sock().text(msg);
  });
}
async function snaps(n: number, flags = 0) {
  for (let i = 0; i < n; i++) {
    tick += 2;
    await act(async () => {
      sock().snap(tick, flags);
      await vi.advanceTimersByTimeAsync(100);
    });
  }
}
/** The teacher's «Дальше» (the fake server's live_next), the phone hears it on its next read. */
async function next(expect: 'lobby' | 'reveal' | 'leaderboard') {
  await act(async () => {
    await fake.next(game.game_id, game.host_token, expect);
  });
  await wait(1200);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date', 'performance'], now: Date.UTC(2026, 9, 21, 9, 0, 0) });
  window.sessionStorage.clear();
  window.localStorage.clear();
  FakeSocket.all = [];
  tick = 100;
  vi.stubGlobal('WebSocket', FakeSocket);
  fake = createFakeServer({ bots: 3, fastBots: true, autoHost: false, demoPin: null, latencyMs: 0, seed: 5 });
  game = await fake.create({ quiz_id: 'q' }, { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: true, stand_every: 3, boss: 'clock' });
  rec = newRecorder();
  ctl = controller(fake, recordingPlatform(rec));
});

afterEach(() => {
  ctl.dispose();
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a battle with movement rounds on the phone', () => {
  it('keeps the battle\'s screens, opens the room after the join and plays the movement round in the arena', async () => {
    render(<PlayerApp ctl={ctl} platform={recordingPlatform(rec)} shareUrl="https://ludosiel-studyforge.hf.space/play" />);
    await act(async () => {
      await ctl.start({ pin: game.pin });
    });
    await until(() => !!screen.queryByPlaceholderText('Как вас назвать'));
    fireEvent.change(screen.getByPlaceholderText('Как вас назвать'), { target: { value: 'Дима' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    });
    // the battle's lobby, which says where the mini-games are; the room's socket right after the join
    await until(() => !!screen.queryByRole('heading', { name: 'Вы в игре' }));
    expect(screen.getByText('На вопросах 3 и 6 будет мини-игра. Там вы бегаете по арене.')).toBeInTheDocument();
    await until(() => FakeSocket.all.length > 0);
    sock().open();
    expect(JSON.parse(sock().sent[0] as string)).toMatchObject({ t: 'hello', role: 'player' });
    await room(welcome);
    await room(hello);
    await room(state({}));
    expect(document.querySelector('main.lp')?.getAttribute('data-mode')).toBe('mixed');

    // two button questions: the battle's buttons, the room says «tap» and sends no positions
    for (const qi of [0, 1]) {
      await next(qi === 0 ? 'lobby' : 'leaderboard');
      await room(state({ phase: 'countdown', qi, round: 'tap' }));
      await until(() => document.querySelectorAll('.lp-ans').length > 0);
      expect(screen.queryByRole('list', { name: 'Ответы' })).toBeNull();
      await until(() => ctl.isOpenNow());
      fireEvent.click(document.querySelector(`.lp-ans--${fake.peek(game.game_id)!.questions[qi].key}`)!);
      await until(() => ctl.getSnapshot().state?.state === 'reveal', 40_000);
      await next('reveal');
    }

    // the movement round: the database says so first (question.stand), the arena's screen with no answer buttons
    await next('leaderboard');
    await until(() => ctl.getSnapshot().state?.question?.stand === true);
    await until(() => !!screen.queryByRole('list', { name: 'Ответы' }));
    expect(document.querySelectorAll('.lp-ans')).toHaveLength(0);
    const q = fake.peek(game.game_id)!.questions[2];
    expect(screen.getByText(q.text)).toBeInTheDocument();
    // a tap is never sent there
    ctl.answer(0);
    expect(ctl.getSnapshot().pick).toBeNull();

    // the room speaks for the round: its times, positions at 10 Hz
    await room(state({ phase: 'countdown', qi: 2, round: 'stand', q: { text: q.text, options: q.options }, opens: (tick + 20) * 50, closes: (tick + 420) * 50 }));
    await snaps(3);
    expect(screen.getByText('Вопрос 3 из 6')).toBeInTheDocument();

    // its reveal and the own result from the room's «me», in the battle's words
    await room(state({ phase: 'reveal', qi: 2, round: 'stand', q: { text: q.text, options: q.options }, opens: 1, closes: 2, floor: 'down', res: { qi: 2, key: q.key, counts: [0, 1, 0, 0], stood: 1, of: 4, fastest: { id: 7, pts: 141, ms: 2500 }, fell: [], back: [], at: tick * 50, back_at: tick * 50 + 4000, thawed: [], froze: [], hp: 872, hp_max: 1320, phase: 1, defeated: false, healed: 0, phase_changed: null, void: false } }));
    await room({ t: 'stand', k: 'me', ghost: false, frozen: false, pts: 341, streak: 3, best: 3, right: 3, place: 1, of: 4, last: { qi: 2, choice: q.key, ok: true, pts: 141, ms: 2500, fell: false, revived: false, late: false, thawed: false, froze: false, void: false } });
    expect(screen.getByRole('heading', { name: 'Верно' })).toBeInTheDocument();
    expect(screen.getByText('−141')).toBeInTheDocument();
    expect(document.querySelector('.sp-out')?.textContent).toContain('3\u00a0верных подряд');

    // the socket drops in the round: the phone says the arena is out of reach
    await act(async () => {
      sock().drop(1006);
    });
    expect(screen.getByRole('alert').textContent).toContain('Нет связи с ареной');

    // the teacher moves on (the database closed the round: here by time, as void, no room writes to the fake): back to
    // the battle's screens
    await until(() => ctl.getSnapshot().state?.state === 'reveal', 40_000);
    await act(async () => {
      await fake.next(game.game_id, game.host_token, 'reveal');
    });
    await until(() => ctl.getSnapshot().state?.state === 'leaderboard', 30_000);
    await until(() => !screen.queryByRole('list', { name: 'Ответы' }));
    expect(screen.queryByText('Нет связи с ареной')).toBeNull();
    // the battle's sheet says the round did not count (the database's result), in neutral words
    expect(document.querySelector('#lp-sheet-title')?.textContent).toBe('Мини-игра не засчитана');
    expect(document.querySelector('.lp-sheet')?.classList.contains('lp-sheet--seen')).toBe(true);
  });
});
