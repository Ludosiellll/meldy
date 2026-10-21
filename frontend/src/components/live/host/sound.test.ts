/**
 * The teacher's screen's sound (sound.ts) against a stand-in AudioContext: nothing before a gesture, the lobby's loop
 * scheduled ahead on the audio clock and stopped when the room starts, the mute remembered, no sound at all while muted,
 * and a page without WebAudio simply silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostSound } from './sound';

const param = () => ({ value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
const node = () => ({ connect: vi.fn((n: unknown) => n), disconnect: vi.fn() });

class FakeContext {
  static made = 0;
  static started = 0;
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  constructor() {
    FakeContext.made += 1;
  }
  createGain() {
    return { ...node(), gain: param() };
  }
  createOscillator() {
    return { ...node(), type: 'sine', frequency: param(), start: vi.fn(() => (FakeContext.started += 1)), stop: vi.fn() };
  }
  createBiquadFilter() {
    return { ...node(), type: 'lowpass', frequency: param(), Q: param() };
  }
  createBufferSource() {
    return { ...node(), buffer: null, start: vi.fn(), stop: vi.fn() };
  }
  createBuffer(_c: number, len: number) {
    const data = new Float32Array(len);
    return { getChannelData: () => data };
  }
  createDynamicsCompressor() {
    return node();
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

const withAudio = () => ({ ...window, AudioContext: FakeContext }) as unknown as Window & typeof globalThis;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  FakeContext.made = 0;
  FakeContext.started = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the host screen’s sound', () => {
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
    const sound = createHostSound(withAudio());
    sound.unlock();
    sound.lobby(true);
    const first = FakeContext.started;
    expect(first).toBeGreaterThan(0);
    vi.advanceTimersByTime(2400); // the audio clock does not move: nothing more is due
    expect(FakeContext.started).toBe(first);
    sound.lobby(false);
    vi.advanceTimersByTime(2400);
    expect(FakeContext.started).toBe(first);
  });

  it('a gesture after the loop was asked for starts it', () => {
    const sound = createHostSound(withAudio());
    sound.lobby(true);
    expect(FakeContext.started).toBe(0);
    sound.unlock();
    expect(FakeContext.started).toBeGreaterThan(0);
  });

  it('mute: remembered in this browser, silent while on, the switch’s listeners told', () => {
    const sound = createHostSound(withAudio());
    const told = vi.fn();
    sound.subscribe(told);
    sound.unlock();
    sound.setMuted(true);
    expect(sound.isMuted()).toBe(true);
    expect(window.localStorage.getItem('meldy.live.sound')).toBe('off');
    expect(told).toHaveBeenCalled();
    const before = FakeContext.started;
    sound.hit();
    sound.tick(true);
    sound.fanfare();
    sound.lobby(true);
    expect(FakeContext.started).toBe(before);
    // another page of this browser starts muted
    expect(createHostSound(withAudio()).isMuted()).toBe(true);
    sound.setMuted(false);
    expect(window.localStorage.getItem('meldy.live.sound')).toBeNull();
    sound.hit();
    expect(FakeContext.started).toBeGreaterThan(before);
  });

  it('every cue makes a sound once unlocked', () => {
    const sound = createHostSound(withAudio());
    sound.unlock();
    const cues: Array<() => void> = [() => sound.join(), () => sound.tick(true), () => sound.land(3), () => sound.hit(), () => sound.freeze(), () => sound.heal(), () => sound.growl(), () => sound.fanfare(), () => sound.sting()];
    for (const cue of cues) {
      const before = FakeContext.started;
      cue();
      expect(FakeContext.started).toBeGreaterThan(before);
    }
    sound.roll(true);
    const rolling = FakeContext.started;
    expect(rolling).toBeGreaterThan(0);
    sound.roll(false);
  });

  it('without WebAudio every call does nothing', () => {
    const sound = createHostSound({ ...window, AudioContext: undefined } as unknown as Window & typeof globalThis);
    expect(() => {
      sound.unlock();
      sound.lobby(true);
      sound.hit();
      sound.fanfare();
      sound.setMuted(true);
    }).not.toThrow();
    expect(sound.isUnlocked()).toBe(false);
  });
});
