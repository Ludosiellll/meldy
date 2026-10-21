/**
 * The projector's sound (sound.ts) against a stand-in AudioContext: nothing before a gesture; the music scheduled
 * ahead on the audio clock by one timer, one loop at a time, stopped when asked and when muted; the mute remembered
 * and silencing everything; every cue — old names and new — making a sound; a crowd of joins spaced out; the calls
 * kept for a soundtrack with ?soundlog; and a page without WebAudio simply silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostSound, type HostSound } from './sound';

const param = () => ({ value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
const node = () => ({ connect: vi.fn((n: unknown) => n), disconnect: vi.fn() });

class FakeContext {
  static made = 0;
  static started = 0;
  static nodes = 0;
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  constructor() {
    FakeContext.made += 1;
  }
  private count<T>(n: T): T {
    FakeContext.nodes += 1;
    return n;
  }
  createGain() {
    return this.count({ ...node(), gain: param() });
  }
  createOscillator() {
    return this.count({ ...node(), type: 'sine', frequency: param(), detune: param(), start: vi.fn(() => (FakeContext.started += 1)), stop: vi.fn() });
  }
  createBiquadFilter() {
    return this.count({ ...node(), type: 'lowpass', frequency: param(), Q: param(), gain: param() });
  }
  createBufferSource() {
    return this.count({ ...node(), buffer: null, playbackRate: param(), start: vi.fn(() => (FakeContext.started += 1)), stop: vi.fn() });
  }
  createStereoPanner() {
    return this.count({ ...node(), pan: param() });
  }
  createConvolver() {
    return this.count({ ...node(), buffer: null });
  }
  createBuffer(channels: number, len: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(len));
    return { duration: len / 8000, getChannelData: (c: number) => data[c] };
  }
  createDynamicsCompressor() {
    return this.count({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

const withAudio = () => ({ ...window, AudioContext: FakeContext, fetch: undefined }) as unknown as Window & typeof globalThis;

/** The audio clock moves on by `s` seconds and the page's timers with it, in the scheduler's steps. */
function later(ctx: () => FakeContext, s: number) {
  for (let t = 0; t < s - 1e-9; t += 0.025) {
    ctx().currentTime += 0.025;
    vi.advanceTimersByTime(25);
  }
}

let made: FakeContext | null = null;
const OrigCtx = FakeContext;
class Tracked extends OrigCtx {
  constructor() {
    super();
    made = this; // eslint-disable-line @typescript-eslint/no-this-alias
  }
}
const tracked = () => ({ ...window, AudioContext: Tracked, fetch: undefined }) as unknown as Window & typeof globalThis;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  FakeContext.made = 0;
  FakeContext.started = 0;
  FakeContext.nodes = 0;
  made = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the projector’s sound', () => {
  it('makes nothing before a gesture; one context after it', () => {
    const sound = createHostSound(withAudio());
    sound.lobby(true);
    sound.tick(false);
    sound.hit();
    expect(FakeContext.made).toBe(0);
    expect(sound.isUnlocked()).toBe(false);
    sound.unlock();
    sound.unlock();
    expect(FakeContext.made).toBe(1);
    expect(sound.isUnlocked()).toBe(true);
  });

  it('the lobby’s loop plays ahead on the audio clock while the room waits, and stops when it starts', () => {
    const sound = createHostSound(tracked());
    sound.unlock();
    sound.lobby(true);
    const first = FakeContext.started;
    expect(first).toBeGreaterThan(0);
    vi.advanceTimersByTime(2400); // the audio clock does not move: nothing more is due
    expect(FakeContext.started).toBe(first);
    later(() => made!, 1); // a second of music: more notes
    const playing = FakeContext.started;
    expect(playing).toBeGreaterThan(first);
    sound.lobby(false);
    later(() => made!, 2);
    expect(FakeContext.started).toBe(playing);
  });

  it('a gesture after the loop was asked for starts it', () => {
    const sound = createHostSound(withAudio());
    sound.lobby(true);
    expect(FakeContext.started).toBe(0);
    sound.unlock();
    expect(FakeContext.started).toBeGreaterThan(0);
  });

  it('one loop at a time: a new track replaces the old, null stops the music and its timer', () => {
    const sound = createHostSound(tracked());
    sound.unlock();
    for (const track of ['lobby', 'question', 'board', 'podium'] as const) {
      sound.music(track);
      const before = FakeContext.started;
      later(() => made!, 0.5);
      expect(FakeContext.started, track).toBeGreaterThan(before);
    }
    sound.music(null);
    const stopped = FakeContext.started;
    later(() => made!, 3);
    expect(FakeContext.started).toBe(stopped);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the question hurries in its last seconds; another track ends the hurry', () => {
    const sound = createHostSound(tracked());
    sound.unlock();
    sound.music('question');
    later(() => made!, 1);
    const calm = FakeContext.started;
    later(() => made!, 2);
    const perTwoCalm = FakeContext.started - calm;
    sound.hurry(true);
    const hurried = FakeContext.started;
    later(() => made!, 2);
    // faster and with the hurry's extra hats: more notes in the same time
    const perTwoHurried = FakeContext.started - hurried;
    expect(perTwoHurried).toBeGreaterThan(perTwoCalm * 1.2);
    sound.music('board');
    sound.music('question');
    const again = FakeContext.started;
    later(() => made!, 2);
    expect(FakeContext.started - again).toBeLessThan(perTwoHurried);
  });

  it('mute: remembered in this browser, silent while on (the music too), the switch’s listeners told', () => {
    const sound = createHostSound(tracked());
    const told = vi.fn();
    sound.subscribe(told);
    sound.unlock();
    sound.music('lobby');
    sound.setMuted(true);
    expect(sound.isMuted()).toBe(true);
    expect(window.localStorage.getItem('meldy.live.sound')).toBe('off');
    expect(told).toHaveBeenCalled();
    const before = FakeContext.started;
    sound.hit();
    sound.tick(true);
    sound.fanfare();
    sound.collapse();
    sound.lobby(true);
    later(() => made!, 3);
    expect(FakeContext.started).toBe(before);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // at most a fading bus's clean-up, no scheduler
    // another page of this browser starts muted
    expect(createHostSound(withAudio()).isMuted()).toBe(true);
    sound.setMuted(false);
    expect(window.localStorage.getItem('meldy.live.sound')).toBeNull();
    sound.hit();
    expect(FakeContext.started).toBeGreaterThan(before);
    // the music it was asked for comes back
    const back = FakeContext.started;
    later(() => made!, 1);
    expect(FakeContext.started).toBeGreaterThan(back);
  });

  it('every cue makes a sound once unlocked — the old names the screens call and the new ones', () => {
    const sound = createHostSound(withAudio());
    sound.unlock();
    const cues: Array<[string, (s: HostSound) => void]> = [
      ['join', (s) => s.join()],
      ['count 3', (s) => s.count(3)],
      ['count 0', (s) => s.count(0)],
      ['tick', (s) => s.tick(false)],
      ['tick last', (s) => s.tick(true)],
      ['slam', (s) => s.slam()],
      ['reveal', (s) => s.reveal()],
      ['whoosh', (s) => s.whoosh(1)],
      ['land', (s) => s.land(3)],
      ['hit', (s) => s.hit()],
      ['roar', (s) => s.roar()],
      ['freeze', (s) => s.freeze()],
      ['shatter', (s) => s.shatter(2)],
      ['heal', (s) => s.heal()],
      ['growl', (s) => s.growl()],
      ['slowmo', (s) => s.slowmo()],
      ['boom', (s) => s.boom()],
      ['podium', (s) => s.podium(1)],
      ['cheer', (s) => s.cheer(4)],
      ['fanfare', (s) => s.fanfare()],
      ['sting', (s) => s.sting()],
      ['alarm', (s) => s.alarm()],
      ['stomp', (s) => s.stomp()],
      ['collapse', (s) => s.collapse()],
      ['rise', (s) => s.rise()],
      ['restore', (s) => s.restore()],
    ];
    for (const [name, cue] of cues) {
      const before = FakeContext.started;
      cue(sound);
      expect(FakeContext.started, name).toBeGreaterThan(before);
    }
    const before = FakeContext.started;
    sound.roll(true);
    expect(FakeContext.started).toBeGreaterThan(before);
    sound.roll(false);
  });

  it('the boss’s jump stops the music', () => {
    const sound = createHostSound(tracked());
    sound.unlock();
    sound.music('question');
    later(() => made!, 1);
    sound.stomp();
    later(() => made!, 0.5);
    const after = FakeContext.started;
    later(() => made!, 3);
    expect(FakeContext.started).toBe(after);
  });

  it('a crowd of joins is spaced out: 30 at once are a handful of sounds, not 30', () => {
    const sound = createHostSound(tracked());
    sound.unlock();
    const before = FakeContext.started;
    for (let i = 0; i < 30; i += 1) sound.join();
    const burst = FakeContext.started - before;
    expect(burst).toBeGreaterThan(0);
    expect(burst).toBeLessThanOrEqual(2);
    // 30 over three seconds: one each 0.1 s at most
    const spread = FakeContext.started;
    for (let i = 0; i < 30; i += 1) {
      made!.currentTime += 0.1;
      sound.join();
    }
    expect(FakeContext.started - spread).toBeLessThanOrEqual(60);
  });

  it('a cue costs a few nodes, not dozens (a volley of landings is rate-limited)', () => {
    const sound = createHostSound(tracked());
    sound.unlock();
    const before = FakeContext.nodes;
    for (let i = 0; i < 40; i += 1) sound.land(i);
    expect(FakeContext.nodes - before).toBeLessThan(8);
  });

  it('?soundlog keeps every call with the page’s clock for a soundtrack', async () => {
    vi.resetModules();
    const url = new URL(window.location.href);
    window.history.replaceState(null, '', `${url.pathname}?bench&soundlog`);
    try {
      const mod = await import('./sound');
      const s = mod.hostSound();
      s.music('lobby');
      s.join();
      s.count(3);
      const log = (window as unknown as { __soundLog: Array<[number, string, unknown[]]> }).__soundLog;
      expect(log.map((e) => e[1])).toEqual(['music', 'join', 'count']);
      expect(log[2][2]).toEqual([3]);
    } finally {
      window.history.replaceState(null, '', url.pathname);
    }
  });

  it('without WebAudio every call does nothing', () => {
    const sound = createHostSound({ ...window, AudioContext: undefined } as unknown as Window & typeof globalThis);
    expect(() => {
      sound.unlock();
      sound.lobby(true);
      sound.music('question');
      sound.hit();
      sound.collapse();
      sound.fanfare();
      sound.setMuted(true);
    }).not.toThrow();
    expect(sound.isUnlocked()).toBe(false);
    return expect(sound.ready()).resolves.toBeUndefined();
  });
});
