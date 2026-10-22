/**
 * «Встань на ответ» in the player app: the hero picker before the join when the link says the mode, then the whole
 * game over the room's socket (a fake one played by the test) with the database's state from the fake server, which
 * reports a stand game. The database is not read while the room works; the podium reads it once.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer } from '../../../../lib/live/fake';
import { encodeSnapshot, STAND_ARENA, type Welcome } from '../../../../lib/live/move/protocol';
import type { LiveApi, PlayerState } from '../../../../lib/live/types';
import { PlayerApp } from '../../player/PlayerApp';
import { controller, newRecorder, recordingPlatform, type Recorder } from '../../player/testkit';
import type { PlayerController } from '../../player/controller';
// The lazy screens, loaded before the clock is faked.
import './StandGame';
import './StandBuilder';

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
  snap(tick: number, x = 380, y = 340) {
    this.onmessage?.({ data: encodeSnapshot({ tick, t: tick * 50, ack: 0, ents: [{ id: 7, x, y, flags: 1 << 8 }] }, 10) });
  }
}

const welcome: Welcome = {
  t: 'welcome', v: 1, role: 'player', tick: 100, ms: 5000, hz: 20, snap: 2, q: 10, speed: 260, r: 18, npc_r: 26,
  map: STAND_ARENA, roster: [[7, 0, 'pid', 'Дима', { body: 'drop', colour: 'blue', hat: 'cap' }]], frozen: false, you: 7, pid: 'pid', resumed: false,
};
const state = (over: Record<string, unknown>) => ({ t: 'stand', k: 'state', phase: 'lobby', qi: -1, q_count: 3, players: 24, q: null, opens: null, closes: null, floor: 'up', res: null, top: null, acc: null, ...over });
const me = (over: Record<string, unknown> = {}) => ({ t: 'stand', k: 'me', ghost: false, pts: 0, streak: 0, best: 0, right: 0, place: 4, of: 24, last: null, ...over });

let rec: Recorder;
let ctl: PlayerController;
let reads = 0;
let tick = 100;

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function until(cond: () => boolean, maxMs = 20_000) {
  for (let t = 0; t <= maxMs; t += 50) {
    if (cond()) return;
    await wait(50);
  }
  throw new Error('the screen never came');
}
const sock = () => FakeSocket.all[FakeSocket.all.length - 1];
async function room(msg: unknown) {
  await act(async () => {
    sock().text(msg);
  });
}
async function snaps(n: number) {
  for (let i = 0; i < n; i++) {
    tick += 2;
    await act(async () => {
      sock().snap(tick);
      await vi.advanceTimersByTimeAsync(100);
    });
  }
}

beforeEach(() => {
  // The game's clock, and performance.now too: the room's client and «connection lost» run on it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date', 'performance'], now: Date.UTC(2026, 9, 21, 9, 0, 0) });
  window.sessionStorage.clear();
  window.localStorage.clear();
  FakeSocket.all = [];
  tick = 100;
  vi.stubGlobal('WebSocket', FakeSocket);
  const fake = createFakeServer({ bots: 3, autoHost: false, demoPin: '482913', latencyMs: 0, seed: 5 });
  reads = 0;
  // The fake plays a battle game; this one reports «Встань на ответ» (the PIN step and the state) and counts the reads
  // of the state.
  const api: LiveApi = Object.assign(Object.create(fake) as LiveApi, {
    pin: async (pin: string, token: string) => {
      const got = await fake.pin(pin, token);
      return got.status === 'open' ? { ...got, mode: 'stand' as const } : got;
    },
    state: async (game: string, token: string, since?: number | null) => {
      reads += 1;
      const st = await fake.state(game, token, since ?? undefined);
      return 'mode' in st ? ({ ...(st as PlayerState), mode: 'stand' } as PlayerState) : st;
    },
  });
  rec = newRecorder();
  ctl = controller(api, recordingPlatform(rec));
});

afterEach(() => {
  ctl.dispose();
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('«Встань на ответ» on the phone', () => {
  it('picks the hero from the kit before the join, plays a question over the room and reads the database only around it', async () => {
    render(<PlayerApp ctl={ctl} platform={recordingPlatform(rec)} shareUrl="https://ludosiel-studyforge.hf.space/play" />);
    await act(async () => {
      await ctl.start({ pin: '482913', mode: 'stand' });
    });
    await until(() => !!screen.queryByRole('heading', { name: 'Выберите героя' }));
    expect(document.title).toBe('Встань на ответ — Meldy');
    // The wardrobe's hats and the locked ones; not the kit's own until the database takes them.
    expect(screen.getByRole('button', { name: 'Корона, закрыто' })).toBeInTheDocument();
    for (const name of ['Колпак', 'Пропеллер', 'Цилиндр']) expect(screen.queryByRole('button', { name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Маг' }));
    fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Дима' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Войти в игру' }));
    });
    await until(() => FakeSocket.all.length > 0);
    expect(ctl.getSnapshot().look.body).toBe('drop');
    sock().open();
    expect(JSON.parse(sock().sent[0] as string)).toMatchObject({ t: 'hello', role: 'player' });
    await room(welcome);
    await room(state({}));
    await room(me());
    await snaps(3);
    expect(screen.getByRole('heading', { name: 'Вы в игре' })).toBeInTheDocument();
    expect(screen.getByText('Ждём начала.')).toBeInTheDocument();

    // While the room works, the phone does not read the game from the database.
    const before = reads;
    await snaps(60);
    expect(reads).toBe(before);

    // A question: its text, the options with the projector's letters, the big timer.
    await room(state({ phase: 'countdown', qi: 0, q: { text: 'Какая команда отменяет транзакцию?', options: ['COMMIT', 'ROLLBACK', 'GRANT'] }, opens: (tick + 20) * 50, closes: (tick + 320) * 50 }));
    await snaps(2);
    expect(screen.getByText('Какая команда отменяет транзакцию?')).toBeInTheDocument();
    expect(screen.getByText('Вопрос 1 из 3')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Ответы' }).textContent).toContain('А. COMMIT');
    expect(screen.getByRole('timer').textContent).toBe('15');

    // The reveal: the right zone stays, the own result from the room.
    await room(state({ phase: 'reveal', qi: 0, q: { text: 'Какая команда отменяет транзакцию?', options: ['COMMIT', 'ROLLBACK', 'GRANT'] }, opens: 1, closes: 2, floor: 'down', res: { qi: 0, key: 1, counts: [3, 17, 2], stood: 17, of: 24, fastest: null, fell: [], back: [], at: tick * 50, back_at: tick * 50 + 4000 } }));
    await room(me({ pts: 620, streak: 1, best: 1, right: 1, place: 4, last: { qi: 0, choice: 1, ok: true, pts: 620, ms: 4000, fell: false, revived: false, late: false } }));
    expect(screen.getByRole('heading', { name: 'Верно' })).toBeInTheDocument();
    expect(screen.getByText('+620')).toBeInTheDocument();
    expect(rec.haptics).toContain('success');

    // The leaderboard: the own place among everyone.
    const row = (id: number, name: string, pts: number) => ({ id, name, look: { body: 'drop', colour: 'blue', hat: 'cap' }, pts, move: 0 });
    await room(state({ phase: 'leaderboard', qi: 0, top: [row(11, 'Аня', 900), row(12, 'Лена', 800), row(13, 'Боря', 700), row(7, 'Дима', 620), row(14, 'Оля', 500)] }));
    expect(screen.getByText('4 место из 24')).toBeInTheDocument();

    // The connection drops: after a second without snapshots the phone says so and keeps the picture.
    await wait(1500);
    expect(screen.getByRole('alert').textContent).toContain('Связь пропала. Подключаемся');
    await snaps(4);
    expect(screen.queryByText(/Связь пропала/)).toBeNull();

    // The podium: one read of the database for the final and the opened parts.
    const atPodium = reads;
    await room(state({ phase: 'podium', qi: 2, top: [], acc: 69 }));
    await room(me({ pts: 2450, best: 3, right: 3, place: 2, of: 24 }));
    await until(() => !!screen.queryByRole('heading', { name: 'Игра окончена' }));
    expect(screen.getByText('2 место из 24')).toBeInTheDocument();
    expect(screen.getByText('2 450 очков')).toBeInTheDocument();
    expect(screen.getByText('3 верных подряд')).toBeInTheDocument();
    await wait(200);
    expect(reads).toBe(atPodium + 1);
  });

  it('a ghost who falls hears it calmly, with the way back', async () => {
    render(<PlayerApp ctl={ctl} platform={recordingPlatform(rec)} shareUrl="x" />);
    await act(async () => {
      await ctl.start({ pin: '482913', mode: 'stand' });
    });
    await until(() => !!screen.queryByRole('heading', { name: 'Выберите героя' }));
    fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Аня' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Войти в игру' }));
    });
    await until(() => FakeSocket.all.length > 0);
    sock().open();
    await room(welcome);
    await room(state({ phase: 'reveal', qi: 0, q: { text: 'Q', options: ['a', 'b'] }, opens: 1, closes: 2, floor: 'down', res: { qi: 0, key: 1, counts: [1, 1], stood: 1, of: 2, fastest: null, fell: [7], back: [], at: 1, back_at: 2 } }));
    await room(me({ ghost: true, last: { qi: 0, choice: 0, ok: false, pts: 0, ms: 100, fell: true, revived: false, late: false } }));
    expect(screen.getByRole('heading', { name: 'Мимо' })).toBeInTheDocument();
    expect(screen.getByText('Теперь вы призрак.')).toBeInTheDocument();
    expect(screen.getByText('Вы стояли тут')).toBeInTheDocument();
    expect(document.querySelector('.sp-out')?.getAttribute('data-tone')).toBe('fell');
  });
});
