/**
 * The teacher's screen's sound, made on the device with WebAudio — no files, no network: a light lobby loop, a pop as
 * players come in, the last five seconds' ticks, a drum roll for the beat before the key, the blow, the ice, the heal,
 * the monster's growl at a new phase, a fanfare when it falls and a low sting when it wins.
 *
 * Browsers let a page make sound only after a gesture: nothing is created until `unlock()` is called from one (the
 * «Открыть комнату» or «Начать» click, any key or click on the game's screen). Sound is on by default; the teacher's
 * mute is remembered in this browser (`meldy.live.sound`). Reduced motion does not silence it (it is about motion).
 * Without WebAudio (tests, old browsers) every call does nothing.
 */

const KEY = 'meldy.live.sound';

type Ctx = AudioContext;
type Listener = () => void;

export interface HostSound {
  /** From a user gesture: makes (or resumes) the audio context. */
  unlock(): void;
  isUnlocked(): boolean;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  subscribe(fn: Listener): () => void;
  /** The lobby's loop: on while the room waits. */
  lobby(on: boolean): void;
  join(): void;
  /** One of the last five seconds (`last`: the final one). */
  tick(last: boolean): void;
  /** The beat between the answers and the key; stops by itself after a few seconds. */
  roll(on: boolean): void;
  land(i: number): void;
  hit(): void;
  freeze(): void;
  heal(): void;
  growl(): void;
  fanfare(): void;
  sting(): void;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    if (muted) window.localStorage.setItem(KEY, 'off');
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage refused: the choice lasts for this page */
  }
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** C – Am – F – G, one bar each: the lobby's chords (MIDI notes: root, third, fifth). */
const CHORDS = [
  [60, 64, 67],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
] as const;
/** The arpeggio of a bar in eighths: chord tone index, +12 for the octave. */
const ARP = [0, 1, 2, 13, 2, 1, 12, 2] as const;
const BEAT_S = 0.3; // an eighth at 100 BPM

export function createHostSound(win: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window): HostSound {
  const Ctor: typeof AudioContext | undefined = win ? (win.AudioContext ?? (win as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = readMuted();
  const listeners = new Set<Listener>();
  let wantLobby = false;
  let lobbyTimer: ReturnType<typeof setInterval> | null = null;
  let lobbyNext = 0;
  let lobbyStep = 0;
  let lobbyBus: GainNode | null = null;
  let rollTimer: ReturnType<typeof setInterval> | null = null;
  let rollStop: ReturnType<typeof setTimeout> | null = null;
  let rollNext = 0;
  let rollStart = 0;
  let lastLand = -1;
  let lastJoin = -1;

  const emit = () => listeners.forEach((fn) => fn());
  const live = (): Ctx | null => (ctx && !muted && ctx.state !== 'closed' ? ctx : null);

  function noiseBuffer(c: Ctx): AudioBuffer {
    if (noise) return noise;
    const len = Math.floor(c.sampleRate * 0.5);
    noise = c.createBuffer(1, len, c.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < len; i += 1) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    return noise;
  }

  /** A note: oscillator → its envelope → `to`. */
  function tone(c: Ctx, to: AudioNode, at: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', attack = 0.005, endFreq?: number): void {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(to);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** A burst of noise through a filter. */
  function hiss(c: Ctx, to: AudioNode, at: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1): void {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, at);
    f.Q.setValueAtTime(q, at);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(to);
    src.start(at, Math.random() * 0.3);
    src.stop(at + dur + 0.02);
  }

  /** A soft mallet: the fundamental and a quiet fourth harmonic, quick decay. */
  function mallet(c: Ctx, to: AudioNode, at: number, midi: number, vol: number, dur = 0.42): void {
    tone(c, to, at, hz(midi), dur, vol, 'sine', 0.004);
    tone(c, to, at, hz(midi) * 4, dur * 0.35, vol * 0.18, 'sine', 0.002);
  }

  // ───────── the lobby's loop: scheduled a little ahead on the audio clock ─────────
  function lobbyTick(): void {
    const c = live();
    if (!c || !lobbyBus) return;
    const ahead = c.currentTime + 0.35;
    if (lobbyNext < c.currentTime) lobbyNext = c.currentTime + 0.05;
    while (lobbyNext < ahead) {
      const bar = Math.floor(lobbyStep / 8) % CHORDS.length;
      const i = lobbyStep % 8;
      const chord = CHORDS[bar];
      const a = ARP[i];
      const midi = chord[a % 12] + (a >= 12 ? 12 : 0) + 12;
      mallet(c, lobbyBus, lobbyNext, midi, i === 0 ? 0.5 : 0.36);
      if (i === 0 || i === 4) tone(c, lobbyBus, lobbyNext, hz(chord[0] - 24), 0.5, 0.4, 'triangle', 0.01);
      if (i % 2 === 1) hiss(c, lobbyBus, lobbyNext, 0.05, 0.05, 'highpass', 6000);
      lobbyNext += BEAT_S;
      lobbyStep += 1;
    }
  }

  function syncLobby(): void {
    const c = live();
    const run = wantLobby && !!c;
    if (run && !lobbyTimer && c) {
      lobbyBus = c.createGain();
      lobbyBus.gain.setValueAtTime(0.0001, c.currentTime);
      lobbyBus.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 1.2);
      lobbyBus.connect(master!);
      lobbyNext = c.currentTime + 0.1;
      lobbyStep = 0;
      lobbyTick();
      lobbyTimer = setInterval(lobbyTick, 120);
    } else if (!run && lobbyTimer) {
      clearInterval(lobbyTimer);
      lobbyTimer = null;
      const bus = lobbyBus;
      lobbyBus = null;
      if (bus && ctx) {
        const now = ctx.currentTime;
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
        bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
        setTimeout(() => bus.disconnect(), 700);
      }
    }
  }

  function stopRoll(): void {
    if (rollTimer) clearInterval(rollTimer);
    if (rollStop) clearTimeout(rollStop);
    rollTimer = null;
    rollStop = null;
  }

  function rollTick(): void {
    const c = live();
    if (!c || !master) return;
    const ahead = c.currentTime + 0.2;
    if (rollNext < c.currentTime) rollNext = c.currentTime + 0.02;
    while (rollNext < ahead) {
      const k = Math.min(1, (rollNext - rollStart) / 2.5);
      hiss(c, master, rollNext, 0.07, 0.07 + 0.12 * k, 'bandpass', 1800, 0.8);
      tone(c, master, rollNext, 190, 0.06, 0.05 + 0.06 * k, 'triangle', 0.002, 120);
      rollNext += 0.075 - 0.025 * k;
    }
  }

  const api: HostSound = {
    unlock() {
      if (!Ctor) return;
      try {
        if (!ctx) {
          ctx = new Ctor();
          master = ctx.createGain();
          master.gain.value = muted ? 0 : 0.9;
          const comp = ctx.createDynamicsCompressor();
          master.connect(comp).connect(ctx.destination);
          emit();
        }
        if (ctx.state === 'suspended')
          void ctx.resume().then(
            () => {
              syncLobby();
              emit();
            },
            () => {},
          );
        syncLobby();
      } catch {
        ctx = null;
      }
    },
    isUnlocked: () => !!ctx,
    isMuted: () => muted,
    setMuted(next) {
      if (next === muted) return;
      muted = next;
      saveMuted(next);
      if (ctx && master) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(next ? 0 : 0.9, now + 0.15);
      }
      if (next) stopRoll();
      syncLobby();
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    lobby(on) {
      wantLobby = on;
      syncLobby();
    },
    join() {
      const c = live();
      if (!c || !master) return;
      const now = c.currentTime;
      if (now - lastJoin < 0.12) return;
      lastJoin = now;
      tone(c, master, now, 520, 0.12, 0.16, 'sine', 0.003, 900);
    },
    tick(last) {
      const c = live();
      if (!c || !master) return;
      const now = c.currentTime;
      tone(c, master, now, last ? 1320 : 990, 0.09, 0.32, 'sine', 0.002);
      hiss(c, master, now, 0.03, 0.12, 'highpass', 3000);
    },
    roll(on) {
      stopRoll();
      const c = live();
      if (!on || !c) return;
      rollStart = c.currentTime;
      rollNext = c.currentTime + 0.02;
      rollTick();
      rollTimer = setInterval(rollTick, 60);
      rollStop = setTimeout(stopRoll, 4000);
    },
    land(i) {
      const c = live();
      if (!c || !master) return;
      const now = c.currentTime;
      if (now - lastLand < 0.035) return;
      lastLand = now;
      tone(c, master, now, 700 + Math.min(i, 30) * 22, 0.1, 0.1, 'sine', 0.002);
    },
    hit() {
      const c = live();
      if (!c || !master) return;
      stopRoll();
      const now = c.currentTime;
      tone(c, master, now, 160, 0.42, 0.95, 'sine', 0.003, 42);
      tone(c, master, now, 90, 0.3, 0.5, 'triangle', 0.003, 50);
      hiss(c, master, now, 0.16, 0.45, 'highpass', 1200);
      hiss(c, master, now + 0.02, 0.3, 0.22, 'lowpass', 900);
    },
    freeze() {
      const c = live();
      if (!c || !master) return;
      const now = c.currentTime;
      [2093, 2637, 3136, 2349].forEach((f, i) => tone(c, master!, now + 0.12 + i * 0.05, f, 0.25, 0.08, 'sine', 0.002));
      hiss(c, master, now + 0.1, 0.35, 0.05, 'highpass', 7000);
    },
    heal() {
      const c = live();
      if (!c || !master) return;
      const now = c.currentTime;
      [72, 76, 79, 84].forEach((m, i) => tone(c, master!, now + i * 0.08, hz(m), 0.35, 0.16, 'triangle', 0.01));
    },
    growl() {
      const c = live();
      if (!c || !master) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      const f = c.createBiquadFilter();
      const g = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(62, now);
      osc.frequency.linearRampToValueAtTime(48, now + 0.7);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(200, now);
      f.frequency.linearRampToValueAtTime(700, now + 0.25);
      f.frequency.linearRampToValueAtTime(160, now + 0.75);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.5, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      osc.connect(f).connect(g).connect(master);
      osc.start(now);
      osc.stop(now + 0.85);
    },
    fanfare() {
      const c = live();
      if (!c || !master) return;
      stopRoll();
      const now = c.currentTime;
      const brass = (at: number, midi: number, dur: number, vol: number) => {
        const osc = c.createOscillator();
        const f = c.createBiquadFilter();
        const g = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(hz(midi), at);
        f.type = 'lowpass';
        f.frequency.setValueAtTime(900, at);
        f.frequency.linearRampToValueAtTime(2600, at + 0.08);
        f.frequency.linearRampToValueAtTime(1400, at + dur);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.03);
        g.gain.setValueAtTime(vol, at + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(f).connect(g).connect(master!);
        osc.start(at);
        osc.stop(at + dur + 0.02);
      };
      // G4 C5 E5 · G5 — then the C major chord, held
      [67, 72, 76].forEach((m, i) => brass(now + i * 0.12, m, 0.14, 0.2));
      brass(now + 0.36, 79, 0.3, 0.22);
      [72, 76, 79, 84].forEach((m) => brass(now + 0.7, m, 1.1, 0.12));
      tone(c, master, now + 0.7, hz(48), 1.1, 0.3, 'triangle', 0.02);
      hiss(c, master, now + 0.7, 0.6, 0.08, 'highpass', 5000);
    },
    sting() {
      const c = live();
      if (!c || !master) return;
      const now = c.currentTime;
      [
        [50, 0],
        [44, 0],
        [43, 0.45],
        [38, 0.45],
      ].forEach(([m, d]) => {
        const at = now + d;
        const osc = c.createOscillator();
        const f = c.createBiquadFilter();
        const g = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(hz(m), at);
        f.type = 'lowpass';
        f.frequency.setValueAtTime(700, at);
        f.frequency.linearRampToValueAtTime(250, at + 1.2);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.22, at + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.3);
        osc.connect(f).connect(g).connect(master!);
        osc.start(at);
        osc.stop(at + 1.35);
      });
    },
  };
  return api;
}

let shared: HostSound | null = null;

/** The one sound of this tab: the setup page unlocks it on «Открыть комнату», the game's screen plays it. */
export function hostSound(): HostSound {
  if (!shared) shared = createHostSound();
  return shared;
}
