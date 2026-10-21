/**
 * The projector's sound in the live games («Битва с монстром», «Встань на ответ»): music written for them (music.ts:
 * the lobby's groove, the question's tension loop that speeds up and rises in the last seconds, the leaderboard's
 * bounce, the podium's party) and the game's moments — the 3-2-1, the ticks of the last seconds, «Время вышло», the
 * key, a star landing, the blow, the ice, the heal, a new phase, the boss's jump and the floor collapsing, the ghosts
 * rising, the floor coming back, the cheer, the podium, the fanfare. Phones stay silent: only this screen plays.
 *
 * Made on the device with WebAudio. Drums and pitched instruments are rendered once into buffers (synth.ts) and
 * replayed; brass and strings are oscillators; a few short recordings (sfx/, CC0, LICENSES.md) add weight to the big
 * moments and load after the first gesture — until they are in (or if they never come) the synthesised layers play
 * alone. Notes are scheduled a little ahead on the audio clock by one timer (never a timer per note, nothing per
 * frame). One mix: the music under a ducker (it dips under big moments), the effects, a shared room reverb, a
 * limiter (peaks stay under −1 dBFS).
 *
 * Browsers let a page make sound only after a gesture: nothing is created until `unlock()` is called from one (the
 * «Открыть комнату» or «Начать» click, any key or click on the game's screen). Sound is on by default; the teacher's
 * mute is remembered in this browser (`meldy.live.sound`) and silences everything at once. Reduced motion does not
 * silence it (it is about motion). Without WebAudio (tests, old browsers) every call does nothing.
 */
import { DRUMS, FANFARE, GO, HURRY, LOSE, PHASE_STING, REVEAL_STING, Sequencer, TIME_UP, TRACKS, type Note, type Shot, type Track, type Voice } from './music';
import { LENGTH, NOTE_RATE_CAP, RATE_CAP, hz, renderNote, renderRoom, renderSamples, type BufferName, type NoteVoice } from './synth';
import type { SynthAnswer, SynthJob } from './synthWorker';
import applauseUrl from './sfx/applause.mp3';
import bellUrl from './sfx/bell.mp3';
import glassUrl from './sfx/glass.mp3';
import plankUrl from './sfx/plank.mp3';
import punchUrl from './sfx/punch.mp3';
import rock1Url from './sfx/rock1.mp3';
import rock2Url from './sfx/rock2.mp3';

export type { Track } from './music';
export { hz, renderSamples } from './synth';

const KEY = 'meldy.live.sound';

type Ctx = BaseAudioContext;
type Listener = () => void;

export type SampleName = 'applause' | 'bell' | 'glass' | 'plank' | 'punch' | 'rock1' | 'rock2';

/** The recorded effects (sfx/LICENSES.md): built into hashed files under /assets/. */
export const SAMPLE_URLS: Record<SampleName, string> = {
  applause: applauseUrl,
  bell: bellUrl,
  glass: glassUrl,
  plank: plankUrl,
  punch: punchUrl,
  rock1: rock1Url,
  rock2: rock2Url,
};

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface SoundOptions {
  /** A context made elsewhere — an OfflineAudioContext renders the game's sound to a file (scripts/sound-render.mjs). */
  context?: BaseAudioContext;
  /** The scheduler's clock (default: the page's timers). */
  timers?: Timers;
  /** The recorded effects' addresses (default SAMPLE_URLS; null: none, synthesis only). */
  samples?: Partial<Record<SampleName, string>> | null;
}

export interface HostSound {
  /** From a user gesture: makes (or resumes) the audio context. */
  unlock(): void;
  isUnlocked(): boolean;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  subscribe(fn: Listener): () => void;
  /** Resolves once the recorded effects are loaded (or failed to): the offline render waits for it. */
  ready(): Promise<void>;
  /** The music that loops now (one at a time, cross-faded), or none (faded out over `fadeS`). */
  music(track: Track | null, fadeS?: number): void;
  /** The question's last seconds: the loop speeds up and rises. */
  hurry(on: boolean): void;
  /** The lobby's loop: on while the room waits (music('lobby')). */
  lobby(on: boolean): void;
  /** A player came in (soft; a crowd of joins climbs a scale and is spaced out). */
  join(): void;
  /** 3, 2, 1 before the answers open; 0: they open. */
  count(n: number): void;
  /** One of the last five seconds (`last`: the final one). */
  tick(last: boolean): void;
  /** «Время вышло» / «Все ответили» lands. */
  slam(): void;
  /** A drum roll: the beat before the key (stops by itself after a few seconds), or a podium's (`ms`). */
  roll(on: boolean, ms?: number): void;
  /** The key is shown. */
  reveal(): void;
  /** A throw leaves the hand. */
  whoosh(i: number): void;
  /** A star lands on the monster (the i-th of a volley). */
  land(i: number): void;
  /** The blow on the bar. */
  hit(): void;
  roar(): void;
  /** The counter-attack's ice (n: how many froze). */
  freeze(n?: number): void;
  shatter(i?: number): void;
  heal(): void;
  /** A new phase: the roar and the phase's sting. */
  growl(): void;
  slowmo(): void;
  /** An explosion (the monster's fall). */
  boom(): void;
  /** A column of the podium rises (3, 2, then 1). */
  podium(place: number): void;
  /** The class cheers (n: how many to cheer for — more, louder). */
  cheer(n?: number): void;
  fanfare(): void;
  sting(): void;
  /** The alarm clock rings (the clock boss's last seconds). */
  alarm(): void;
  /** «Встань на ответ»: time is up — the boss jumps (the music stops). */
  stomp(): void;
  /** «Встань на ответ»: the boss lands and the floor of the wrong zones collapses. */
  collapse(): void;
  /** «Встань на ответ»: the fallen rise as ghosts. */
  rise(): void;
  /** «Встань на ответ»: the floor comes back. */
  restore(): void;
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

/** How far ahead notes are scheduled (s), and how often the scheduler wakes (ms). */
export const AHEAD_S = 0.16;
export const WAKE_MS = 25;

/**
 * The mix (linear gains), set by measuring offline renders (scripts/sound-render.mjs): the music bed near −16 LUFS, the
 * cues louder, every peak under −1 dBFS after the limiter.
 */
export const MIX = {
  music: 0.25,
  /** The music under a big moment. */
  ducked: 0.3,
  sfx: 0.85,
  verbMusic: 0.2,
  verbSfx: 0.14,
  verbReturn: 0.75,
  /** After the limiter. */
  out: 0.82,
} as const;

/** Each voice's level and place (pan, −1…1). */
const VOICE: Record<Voice, { vol: number; pan: number }> = {
  kick: { vol: 0.85, pan: 0 },
  snare: { vol: 0.7, pan: 0.05 },
  clap: { vol: 0.85, pan: 0 },
  hat: { vol: 0.8, pan: 0.3 },
  open: { vol: 0.6, pan: 0.3 },
  shaker: { vol: 0.7, pan: -0.35 },
  tick: { vol: 0.6, pan: 0.15 },
  tock: { vol: 0.6, pan: -0.15 },
  tom: { vol: 0.75, pan: -0.1 },
  crash: { vol: 0.45, pan: 0.2 },
  bass: { vol: 0.7, pan: 0 },
  pluck: { vol: 0.75, pan: -0.3 },
  keys: { vol: 0.58, pan: -0.12 },
  mallet: { vol: 0.95, pan: 0.25 },
  bell: { vol: 0.58, pan: 0.35 },
  pad: { vol: 0.17, pan: 0 },
  brass: { vol: 0.22, pan: 0 },
};

const PITCHED: ReadonlySet<Voice> = new Set<Voice>(['tom', 'bass', 'pluck', 'keys', 'mallet', 'bell']);
/** F major pentatonic: the notes a crowd of joins climbs. */
const JOIN_SCALE = [72, 74, 77, 79, 81, 84, 86, 89, 91, 93];
/** The pitched notes the cues play (the warm-up renders them with the music's). */
const CUE_NOTES: Array<[NoteVoice, number[]]> = [
  ['mallet', JOIN_SCALE],
  ['bell', [...JOIN_SCALE.map((m) => m + 5), 64, 72, 76, 79, 81, 83, 84, 88, 91, 94, 96, 100, 103]],
  ['keys', [67, 69, 71]],
  ['tom', [38, 40, 43, 44, 45, 46, 47, 48, 50]],
  ['bass', [36]],
];

/** A track's own bus with three lanes (left, centre, right). */
interface Bus {
  out: GainNode;
  /** A node after `out` that goes with it (a track's level). */
  tail?: AudioNode;
  left: AudioNode;
  centre: AudioNode;
  right: AudioNode;
}

const DEFAULT_TIMERS: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createHostSound(win: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window, options: SoundOptions = {}): HostSound {
  const Ctor: typeof AudioContext | undefined = win ? (win.AudioContext ?? (win as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  const given = options.context ?? null;
  const timers = options.timers ?? DEFAULT_TIMERS;
  const sampleUrls = options.samples === null ? {} : (options.samples ?? SAMPLE_URLS);
  let ctx: Ctx | null = null;
  let mute: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let sfx: Bus | null = null;
  let noise: AudioBuffer | null = null;
  const buffers = new Map<string, AudioBuffer>();
  const samples = new Map<SampleName, AudioBuffer>();
  let loading: Promise<void> | null = null;
  let muted = readMuted();
  const listeners = new Set<Listener>();
  let want: Track | null = null;
  let seq: Sequencer | null = null;
  let seqTrack: Track | null = null;
  let track: Bus | null = null;
  let hurried = false;
  let timer: unknown = null;
  let rollUntil = 0;
  let rollStart = 0;
  let rollNext = 0;
  const last = new Map<string, number>();
  let joins = 0;
  let lastJoin = -10;
  let worker: Worker | null = null;
  let warmP: Promise<void> | null = null;
  let warmOk: (() => void) | null = null;
  let isWarm = false;

  const emit = () => listeners.forEach((fn) => fn());
  const live = (): Ctx | null => (ctx && !muted && ctx.state !== 'closed' ? ctx : null);
  /** Not more often than `gap` seconds (a volley of 40 landings is not 40 sounds on top of each other). */
  const spaced = (name: string, now: number, gap: number) => {
    if (now - (last.get(name) ?? -1) < gap) return false;
    last.set(name, now);
    return true;
  };

  // ───────── buffers ─────────
  function toBuffer(c: Ctx, data: Float32Array, rate: number): AudioBuffer {
    const b = c.createBuffer(1, data.length, rate);
    b.getChannelData(0).set(data);
    return b;
  }

  const namedRate = (c: Ctx, name: BufferName) => Math.min(c.sampleRate, RATE_CAP[name]);
  const noteRate = (c: Ctx, v: NoteVoice) => Math.min(c.sampleRate, NOTE_RATE_CAP[v]);

  /** A named sound's buffer: from the warm-up, or (before it is in, or with no worker) rendered here. */
  function named(c: Ctx, name: BufferName): AudioBuffer {
    const hit = buffers.get(name);
    if (hit) return hit;
    const rate = namedRate(c, name);
    const b = toBuffer(c, renderSamples(name, rate), rate);
    buffers.set(name, b);
    return b;
  }

  function note(c: Ctx, v: NoteVoice, midi: number): AudioBuffer {
    const key = `${v}${midi}`;
    const hit = buffers.get(key);
    if (hit) return hit;
    const rate = noteRate(c, v);
    const b = toBuffer(c, renderNote(v, midi, rate), rate);
    buffers.set(key, b);
    return b;
  }

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

  /** Every buffer the music and the cues use. */
  function warmJobs(c: Ctx): SynthJob[] {
    const jobs: SynthJob[] = (Object.keys(LENGTH) as BufferName[]).map((name) => ({ key: name, rate: namedRate(c, name), name }));
    const seen = new Set<string>();
    const add = (voice: NoteVoice, midi: number) => {
      const key = `${voice}${midi}`;
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push({ key, rate: noteRate(c, voice), voice, midi });
    };
    for (const t of Object.values(TRACKS))
      for (const nt of t.notes) {
        if (!PITCHED.has(nt.voice)) continue;
        add(nt.voice as NoteVoice, nt.midi);
        if (t === TRACKS.question && nt.voice !== 'tom') add(nt.voice as NoteVoice, nt.midi + HURRY.transpose);
      }
    for (const [voice, midis] of CUE_NOTES) for (const m of midis) add(voice, m);
    return jobs;
  }

  /**
   * The warm-up after the first gesture: the whole set rendered in the worker (the music waits for it, well under a
   * second); with no worker (an old browser, the tests) a few at a time here, and anything missing on demand.
   */
  function startWarm(c: Ctx): void {
    if (warmP) return;
    warmP = new Promise<void>((ok) => (warmOk = ok));
    const jobs = warmJobs(c);
    if (win && typeof win.Worker === 'function') {
      try {
        // (written out like this so the build bundles the worker)
        const made = new Worker(new URL('./synthWorker.ts', import.meta.url), { type: 'module' });
        let left = jobs.length;
        made.onmessage = (event: MessageEvent<SynthAnswer>) => {
          const a = event.data;
          if ('data' in a && ctx && !buffers.has(a.key)) buffers.set(a.key, toBuffer(ctx, a.data, a.rate));
          left -= 1;
          if (left <= 0) warmed();
        };
        // the worker could not start (or broke): what is missing is rendered here, on demand
        made.onerror = () => warmed();
        made.postMessage(jobs);
        worker = made;
        return;
      } catch {
        worker = null;
      }
    }
    warmed();
    const slice = () => {
      const cc = ctx;
      if (!cc) return;
      const t0 = Date.now();
      while (jobs.length && Date.now() - t0 < 4) {
        const job = jobs.shift()!;
        if ('name' in job) named(cc, job.name);
        else note(cc, job.voice, job.midi);
      }
      if (jobs.length) timers.setTimeout(slice, 40);
    };
    timers.setTimeout(slice, 30);
  }

  function warmed(): void {
    if (isWarm) return;
    isWarm = true;
    worker?.terminate();
    worker = null;
    warmOk?.();
    syncMusic();
  }

  function decode(c: Ctx, data: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise((ok, fail) => {
      const p = c.decodeAudioData(data, ok, fail);
      if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(ok, fail);
    });
  }

  function loadSamples(c: Ctx): Promise<void> {
    if (loading) return loading;
    const fetcher = win?.fetch?.bind(win);
    if (!fetcher || typeof c.decodeAudioData !== 'function') return (loading = Promise.resolve());
    const jobs = (Object.entries(sampleUrls) as [SampleName, string][]).map(([name, url]) =>
      fetcher(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => decode(c, data))
        .then((b) => {
          samples.set(name, b);
        })
        .catch(() => {
          /* not loaded: the synthesised layers play alone */
        }),
    );
    loading = Promise.all(jobs).then(() => undefined);
    return loading;
  }

  // ───────── the graph ─────────
  function lanes(c: Ctx, out: GainNode): Bus {
    const pan = (p: number): AudioNode => {
      if (typeof c.createStereoPanner !== 'function') return out;
      const node = c.createStereoPanner();
      node.pan.value = p;
      node.connect(out);
      return node;
    };
    return { out, left: pan(-0.4), centre: out, right: pan(0.4) };
  }

  const laneOf = (bus: Bus, pan: number): AudioNode => (pan < -0.15 ? bus.left : pan > 0.15 ? bus.right : bus.centre);

  function build(c: Ctx): void {
    const limiter = c.createDynamicsCompressor();
    const setParam = (p: AudioParam | undefined, v: number) => {
      if (p) p.value = v;
    };
    setParam(limiter.threshold, -7);
    setParam(limiter.knee, 2);
    setParam(limiter.ratio, 20);
    setParam(limiter.attack, 0.002);
    setParam(limiter.release, 0.18);
    const out = c.createGain();
    out.gain.value = MIX.out;
    mute = c.createGain();
    mute.gain.value = muted ? 0 : 1;
    const mix = c.createGain();
    // small speakers (a projector's, a laptop's) play little under ~150 Hz: the sub-bass is thinned, not pushed into
    // the limiter for nothing
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 35;
    const shelf = c.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 100;
    shelf.gain.value = -3;
    mix.connect(hp);
    hp.connect(shelf);
    const air = c.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 4500;
    air.gain.value = 3;
    shelf.connect(air);
    air.connect(mute);
    mute.connect(limiter);
    limiter.connect(out);
    out.connect(c.destination);
    musicBus = c.createGain();
    musicBus.gain.value = MIX.music;
    musicBus.connect(mix);
    const sfxOut = c.createGain();
    sfxOut.gain.value = MIX.sfx;
    sfxOut.connect(mix);
    sfx = lanes(c, sfxOut);
    if (typeof c.createConvolver === 'function') {
      const verb = c.createConvolver();
      const [l, r] = renderRoom(c.sampleRate);
      const ir = c.createBuffer(2, l.length, c.sampleRate);
      ir.getChannelData(0).set(l);
      ir.getChannelData(1).set(r);
      verb.buffer = ir;
      const ret = c.createGain();
      ret.gain.value = MIX.verbReturn;
      verb.connect(ret).connect(mix);
      const sendM = c.createGain();
      sendM.gain.value = MIX.verbMusic;
      musicBus.connect(sendM).connect(verb);
      const sendS = c.createGain();
      sendS.gain.value = MIX.verbSfx;
      sfxOut.connect(sendS).connect(verb);
    }
  }

  // ───────── voices ─────────
  /** A buffer once: one source, one gain. */
  function play(c: Ctx, to: AudioNode, buf: AudioBuffer, at: number, vol: number, rate = 1, until?: number): void {
    const src = c.createBufferSource();
    src.buffer = buf;
    if (rate !== 1) src.playbackRate.setValueAtTime(rate, at);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at);
    if (until !== undefined && until < at + buf.duration / rate) {
      g.gain.setValueAtTime(vol, until);
      g.gain.linearRampToValueAtTime(0, until + 0.04);
      src.connect(g).connect(to);
      src.start(at);
      src.stop(until + 0.06);
      return;
    }
    src.connect(g).connect(to);
    src.start(at);
  }

  /** A recorded effect, when it is loaded. */
  function sample(c: Ctx, name: SampleName, at: number, vol: number, rate = 1, pan = 0): boolean {
    const buf = samples.get(name);
    if (!buf || !sfx) return false;
    play(c, laneOf(sfx, pan), buf, at, vol, rate);
    return true;
  }

  /** A note: oscillator → its envelope → `to`. */
  function tone(c: Ctx, to: AudioNode, at: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', attack = 0.005, endFreq?: number): void {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(to);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** A burst of noise through a filter. */
  function hiss(c: Ctx, to: AudioNode, at: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, endFreq?: number): void {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, at);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    f.Q.setValueAtTime(q, at);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(to);
    src.start(at, (at * 7.31) % 0.3);
    src.stop(at + dur + 0.02);
  }

  /** Two detuned sawtooths through a filter that opens and settles: brass, or (slow, dark) strings. */
  function saws(c: Ctx, to: AudioNode, at: number, freq: number, dur: number, vol: number, kind: 'brass' | 'pad'): void {
    const f = c.createBiquadFilter();
    const g = c.createGain();
    f.type = 'lowpass';
    f.Q.setValueAtTime(kind === 'brass' ? 1.2 : 0.5, at);
    const attack = kind === 'brass' ? 0.02 : Math.min(0.3, dur / 3);
    const release = kind === 'brass' ? 0.09 : 0.35;
    if (kind === 'brass') {
      f.frequency.setValueAtTime(500, at);
      f.frequency.exponentialRampToValueAtTime(3200, at + 0.05);
      f.frequency.exponentialRampToValueAtTime(1700, at + Math.max(0.1, dur));
    } else {
      f.frequency.setValueAtTime(700, at);
      f.frequency.linearRampToValueAtTime(1500, at + dur * 0.5);
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + attack);
    g.gain.setValueAtTime(vol, at + Math.max(attack, dur));
    g.gain.linearRampToValueAtTime(0, at + Math.max(attack, dur) + release);
    f.connect(g).connect(to);
    for (const cents of [-7, 7]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, at);
      osc.detune.setValueAtTime(cents, at);
      osc.connect(f);
      osc.start(at);
      osc.stop(at + Math.max(attack, dur) + release + 0.02);
    }
  }

  /** One instrument's note at `at` (the sequencer's and the one-shots'). */
  function voice(c: Ctx, bus: Bus, v: Voice, at: number, midi: number, dur: number, vel: number): void {
    const { vol, pan } = VOICE[v];
    const to = laneOf(bus, pan);
    const level = vol * vel;
    if (v === 'pad' || v === 'brass') saws(c, to, at, hz(midi), dur, level, v);
    else if (DRUMS.has(v)) play(c, to, named(c, v as BufferName), at, level);
    else if (PITCHED.has(v)) play(c, to, note(c, v as NoteVoice, midi), at, level, 1, v === 'bass' ? at + Math.max(0.08, dur) : v === 'keys' ? at + Math.max(0.2, dur) + 0.35 : undefined);
  }

  function shots(c: Ctx, list: readonly Shot[], at: number, v: Voice, vol = 1): void {
    if (!sfx) return;
    for (const [d, midi, dur, vel] of list) voice(c, sfx, v, at + d, midi, dur, vel * vol);
  }

  const fx = (c: Ctx, name: BufferName, at: number, vol: number, rate = 1, pan = 0) => sfx && play(c, laneOf(sfx, pan), named(c, name), at, vol, rate);

  /** Lower the music for a big moment, then back. */
  function duck(c: Ctx, sec: number): void {
    if (!musicBus) return;
    const now = c.currentTime;
    const g = musicBus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(MIX.music * MIX.ducked, now + 0.04);
    g.setValueAtTime(MIX.music * MIX.ducked, now + sec);
    g.linearRampToValueAtTime(MIX.music, now + sec + 0.6);
  }

  // ───────── the scheduler: one timer, notes a little ahead on the audio clock ─────────
  function playDue(time: number, nt: Note, shift: number, step: number): void {
    const c = ctx;
    if (!c || !track) return;
    voice(c, track, nt.voice, time, nt.midi + (nt.midi && nt.voice !== 'tom' ? shift : 0), nt.len * step, nt.vel);
  }

  function wake(): void {
    const c = live();
    if (!c) return;
    const until = c.currentTime + AHEAD_S;
    if (seq && track) {
      seq.catchUp(c.currentTime);
      seq.run(until, playDue);
    }
    if (sfx && (rollUntil > c.currentTime || rollNext < rollUntil)) {
      if (rollNext < c.currentTime) rollNext = c.currentTime + 0.02;
      while (rollNext < until && rollNext < rollUntil) {
        const k = Math.min(1, (rollNext - rollStart) / 2.4);
        play(c, sfx.centre, named(c, 'snare'), rollNext, 0.16 + 0.34 * k, 1.05 + ((rollNext * 13) % 1) * 0.06);
        rollNext += 0.075 - 0.03 * k;
      }
    }
    if (!seq && rollNext >= rollUntil) stopTimer();
  }

  function startTimer(): void {
    if (!timer) timer = timers.setInterval(wake, WAKE_MS);
  }

  function stopTimer(): void {
    if (timer) timers.clearInterval(timer);
    timer = null;
  }

  function fadeOut(bus: Bus, sec: number): void {
    if (!ctx) return;
    const now = ctx.currentTime;
    const g = bus.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + sec);
    timers.setTimeout(() => {
      bus.out.disconnect();
      bus.tail?.disconnect();
    }, (sec + 0.4) * 1000);
  }

  function syncMusic(fadeS = 0.5): void {
    if (worker && !isWarm) return; // the warm-up starts it when the worker is done
    const c = live();
    const target = c ? want : null;
    if (target === seqTrack && (target === null || seq)) return;
    if (track) fadeOut(track, fadeS);
    seq = null;
    track = null;
    seqTrack = null;
    if (!target || !c || !musicBus) return;
    const out = c.createGain();
    const now = c.currentTime;
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + (target === 'lobby' ? 1.2 : target === 'question' ? 0.03 : 0.25));
    const level = c.createGain();
    level.gain.value = TRACKS[target].level ?? 1;
    out.connect(level).connect(musicBus);
    track = { ...lanes(c, out), tail: level };
    seq = new Sequencer(TRACKS[target], now + 0.04);
    seqTrack = target;
    if (target === 'question' && hurried) seq.setHurry(true);
    wake();
    startTimer();
  }

  function stopRoll(): void {
    rollUntil = 0;
    rollNext = 0;
  }

  /** Every cue: the live context and the effects' bus, or nothing (locked, muted, closed). */
  const cue = (): [Ctx, Bus] | null => {
    const c = live();
    return c && sfx ? [c, sfx] : null;
  };

  const api: HostSound = {
    unlock() {
      if (!given && !Ctor) return;
      try {
        if (!ctx) {
          ctx = given ?? new Ctor!();
          build(ctx);
          void loadSamples(ctx);
          startWarm(ctx);
          emit();
        }
        const st = ctx.state as string;
        if (!given && (st === 'suspended' || st === 'interrupted'))
          void (ctx as AudioContext).resume().then(
            () => {
              syncMusic();
              emit();
            },
            () => {},
          );
        syncMusic();
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
      if (ctx && mute) {
        const now = ctx.currentTime;
        mute.gain.cancelScheduledValues(now);
        mute.gain.setValueAtTime(mute.gain.value, now);
        mute.gain.linearRampToValueAtTime(next ? 0 : 1, now + 0.08);
      }
      if (next) {
        stopRoll();
        stopTimer();
      }
      syncMusic(0.08);
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    ready: () => (ctx ? Promise.all([loading, warmP]).then(() => undefined) : Promise.resolve()),
    music(next, fadeS = 0.6) {
      if (next !== 'question') hurried = false;
      if (next === want) return;
      want = next;
      syncMusic(fadeS);
    },
    hurry(on) {
      hurried = on;
      if (seq && seqTrack === 'question') seq.setHurry(on);
    },
    lobby(on) {
      if (on) api.music('lobby');
      else if (want === 'lobby') api.music(null);
    },
    join() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      if (!spaced('join', now, 0.09)) return;
      joins = now - lastJoin > 2.5 ? 0 : joins + 1;
      lastJoin = now;
      const m = JOIN_SCALE[Math.min(joins, JOIN_SCALE.length - 1)];
      play(c, bus.right, note(c, 'mallet', m), now, 0.24);
      play(c, bus.centre, named(c, 'pop'), now, 0.1, 1 + Math.min(joins, 9) * 0.05);
    },
    count(n) {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      if (n > 0) {
        voice(c, bus, 'tom', now, n === 3 ? 45 : n === 2 ? 47 : 50, 0.3, 1);
        play(c, bus.centre, note(c, 'bell', n === 3 ? 79 : n === 2 ? 81 : 83), now, 0.5);
        play(c, bus.centre, note(c, 'keys', n === 3 ? 67 : n === 2 ? 69 : 71), now, 0.4);
        fx(c, 'kick', now, 0.6);
      } else {
        // the answers open: a bright hit and a lift
        duck(c, 0.4);
        shots(c, GO, now, 'brass', 1.1);
        fx(c, 'kick', now, 0.95);
        fx(c, 'crash', now, 0.5, 1, 0.25);
        fx(c, 'up', now, 0.18, 2.2);
      }
    },
    tick(lastOne) {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      play(c, bus.centre, named(c, 'tick'), now, 0.5, lastOne ? 1.2 : 1);
      play(c, bus.centre, note(c, 'bell', lastOne ? 91 : 88), now, lastOne ? 0.42 : 0.3);
    },
    slam() {
      const k = cue();
      if (!k) return;
      const [c] = k;
      const now = c.currentTime;
      duck(c, 1.0);
      shots(c, TIME_UP, now, 'brass', 1.1);
      fx(c, 'boom', now, 0.55, 1.4);
      fx(c, 'crash', now, 0.4, 0.85, -0.2);
      if (!sample(c, 'bell', now, 0.32, 0.7)) voice(c, k[1], 'bell', now, 64, 0.5, 0.6);
    },
    roll(on, ms) {
      stopRoll();
      const c = live();
      if (!on || !c || !sfx) return;
      rollStart = c.currentTime;
      rollNext = c.currentTime + 0.02;
      rollUntil = c.currentTime + (ms ?? 4000) / 1000;
      wake();
      startTimer();
    },
    reveal() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      stopRoll();
      const now = c.currentTime;
      shots(c, REVEAL_STING, now, 'brass', 0.95);
      play(c, bus.right, note(c, 'bell', 94), now + 0.17, 0.3);
      fx(c, 'crash', now + 0.17, 0.3, 1.1, 0.3);
      fx(c, 'kick', now + 0.17, 0.6);
    },
    whoosh(i) {
      const k = cue();
      if (!k || !spaced('whoosh', k[0].currentTime, 0.045)) return;
      fx(k[0], 'whoosh', k[0].currentTime, 0.3, 0.9 + ((i * 37) % 5) * 0.06, ((i * 53) % 7) / 7 - 0.4);
    },
    land(i) {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      if (!spaced('land', now, 0.022)) return;
      fx(c, (['land0', 'land1', 'land2'] as const)[i % 3], now, 0.5, 0.92 + Math.min(i, 30) * 0.012, ((i * 37) % 9) / 9 - 0.45);
      play(c, bus.right, note(c, 'bell', JOIN_SCALE[Math.min(i, JOIN_SCALE.length - 1)] + 5), now, 0.16);
    },
    hit() {
      const k = cue();
      if (!k) return;
      const [c] = k;
      stopRoll();
      duck(c, 0.7);
      const now = c.currentTime;
      fx(c, 'boom', now, 0.55, 1.15);
      fx(c, 'kick', now, 0.8);
      fx(c, 'crash', now, 0.5, 1, -0.25);
      if (!sample(c, 'punch', now, 1)) hiss(c, k[1].centre, now, 0.16, 0.45, 'highpass', 1200);
    },
    roar() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      // two sawtooths a little apart (a rough, beating growl) through a filter that opens and closes
      const f = c.createBiquadFilter();
      const g = c.createGain();
      f.type = 'lowpass';
      f.Q.setValueAtTime(1.6, now);
      f.frequency.setValueAtTime(260, now);
      f.frequency.linearRampToValueAtTime(1300, now + 0.15);
      f.frequency.linearRampToValueAtTime(220, now + 0.7);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.9, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
      f.connect(g).connect(bus.centre);
      for (const [from, to] of [
        [72, 52],
        [77, 55],
      ]) {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(from, now);
        osc.frequency.linearRampToValueAtTime(to, now + 0.65);
        osc.connect(f);
        osc.start(now);
        osc.stop(now + 0.8);
      }
      hiss(c, bus.centre, now, 0.65, 0.6, 'bandpass', 600, 1.2, 250);
      fx(c, 'boom', now, 0.3, 0.75);
    },
    freeze(n = 1) {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      if (!spaced('freeze', now, 0.028)) return;
      const count = Math.max(1, Math.min(4, n));
      for (let i = 0; i < count; i += 1) fx(c, i % 2 ? 'crack1' : 'crack0', now + 0.25 + i * 0.07, 0.55, 0.95 + (i % 4) * 0.05, i % 2 ? 0.35 : -0.35);
      sample(c, 'glass', now + 0.25, 0.4, 1.25);
      fx(c, 'whoosh', now, 0.3, 1.4);
      [96, 100, 103].forEach((m, i) => play(c, bus.right, note(c, 'bell', m), now + 0.28 + i * 0.05, 0.14));
    },
    shatter(i = 0) {
      const k = cue();
      if (!k || !spaced('shatter', k[0].currentTime, 0.03)) return;
      const [c] = k;
      fx(c, 'shatter', c.currentTime, 0.55, 0.9 + (i % 5) * 0.06, ((i * 41) % 7) / 7 - 0.4);
      sample(c, 'glass', c.currentTime, 0.35, 1.1 + (i % 3) * 0.1);
    },
    heal() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      [72, 76, 79, 84, 88].forEach((m, i) => play(c, bus.right, note(c, 'bell', m), now + i * 0.07, 0.4));
      saws(c, bus.centre, now, hz(60), 0.7, 0.07, 'pad');
      saws(c, bus.centre, now, hz(67), 0.7, 0.06, 'pad');
      hiss(c, bus.centre, now, 0.8, 0.06, 'bandpass', 2000, 1.2, 6000);
    },
    growl() {
      const k = cue();
      if (!k) return;
      const [c] = k;
      duck(c, 1.4);
      const now = c.currentTime;
      api.roar();
      shots(c, PHASE_STING, now + 0.05, 'brass', 1);
      fx(c, 'kick', now, 1);
      fx(c, 'boom', now, 0.45, 0.8);
    },
    slowmo() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      duck(c, 1.8);
      const now = c.currentTime;
      hiss(c, bus.centre, now, 1.4, 0.26, 'bandpass', 2600, 1.4, 260);
      tone(c, bus.centre, now, 220, 1.4, 0.18, 'sawtooth', 0.2, 55);
    },
    boom() {
      const k = cue();
      if (!k) return;
      const [c] = k;
      duck(c, 2.4);
      const now = c.currentTime;
      fx(c, 'boom', now, 0.95);
      fx(c, 'rumble', now + 0.05, 0.6);
      fx(c, 'crash', now, 0.45);
      sample(c, 'rock1', now + 0.12, 0.45, 0.9, -0.4);
      sample(c, 'rock2', now + 0.3, 0.4, 1.05, 0.4);
    },
    podium(place) {
      const k = cue();
      if (!k) return;
      const [c] = k;
      stopRoll();
      const now = c.currentTime;
      fx(c, 'kick', now, 0.9);
      fx(c, 'crash', now, place === 1 ? 0.5 : 0.28, place === 1 ? 1 : 1.2, place === 2 ? -0.3 : place === 3 ? 0.3 : 0);
      const root = place === 3 ? 60 : place === 2 ? 64 : 67;
      shots(
        c,
        [0, 4, 7, 12].map((d) => [0, root + d, place === 1 ? 0.7 : 0.3, 0.6] as const),
        now,
        'brass',
        1,
      );
    },
    cheer(n = 5) {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      const loud = Math.min(1, 0.45 + n / 20);
      sample(c, 'applause', now, 0.7 * loud);
      [76, 79, 84, 88, 91].forEach((m, i) => play(c, bus.right, note(c, 'bell', m), now + i * 0.06, 0.32));
      fx(c, 'crash', now, 0.22, 1.2, 0.3);
    },
    fanfare() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      stopRoll();
      duck(c, 3.2);
      const now = c.currentTime;
      shots(c, FANFARE, now, 'brass', 1.15);
      [0, 0.13, 0.26, 0.39].forEach((d) => voice(c, bus, 'tom', now + d, 43, 0.2, 0.55));
      fx(c, 'kick', now + 0.96, 1);
      fx(c, 'crash', now + 0.96, 0.55);
      voice(c, bus, 'bass', now + 0.96, 36, 1.2, 0.8);
      [84, 88, 91, 96].forEach((m, i) => play(c, bus.right, note(c, 'bell', m), now + 0.96 + i * 0.08, 0.26));
      sample(c, 'applause', now + 0.9, 0.62);
    },
    sting() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      duck(c, 2.2);
      const now = c.currentTime;
      shots(c, LOSE, now, 'brass', 1);
      voice(c, bus, 'tom', now, 40, 0.4, 0.8);
      voice(c, bus, 'tom', now + 0.5, 38, 0.6, 0.9);
      fx(c, 'boom', now + 0.5, 0.35, 0.7);
    },
    alarm() {
      const k = cue();
      if (!k || !spaced('alarm', k[0].currentTime, 1)) return;
      fx(k[0], 'alarm', k[0].currentTime, 0.85, 1, 0.2);
    },
    stomp() {
      const k = cue();
      api.music(null, 0.12);
      stopRoll();
      if (!k) return;
      const [c] = k;
      const now = c.currentTime;
      shots(c, TIME_UP, now, 'brass', 1);
      fx(c, 'kick', now, 0.8);
      fx(c, 'up', now + 0.05, 0.5);
    },
    collapse() {
      const k = cue();
      if (!k) return;
      const [c] = k;
      duck(c, 2.8);
      const now = c.currentTime;
      fx(c, 'boom', now, 1);
      fx(c, 'kick', now, 0.9);
      fx(c, 'crash', now, 0.45, 0.8, 0.2);
      fx(c, 'rumble', now + 0.08, 0.75);
      fx(c, 'down', now + 0.3, 0.45, 1, -0.2);
      sample(c, 'punch', now, 0.75, 0.75);
      sample(c, 'rock1', now + 0.14, 0.6, 0.9, -0.45);
      sample(c, 'rock2', now + 0.36, 0.55, 1, 0.45);
      sample(c, 'rock1', now + 0.62, 0.42, 0.8, 0.15);
      sample(c, 'rock2', now + 0.9, 0.3, 0.7, -0.2);
    },
    rise() {
      const k = cue();
      if (!k || !spaced('rise', k[0].currentTime, 1)) return;
      fx(k[0], 'ghost', k[0].currentTime, 0.45, 1, -0.15);
    },
    restore() {
      const k = cue();
      if (!k) return;
      const [c, bus] = k;
      const now = c.currentTime;
      fx(c, 'up', now, 0.22, 1.7);
      [0, 0.12, 0.24, 0.38].forEach((d, i) => {
        if (!sample(c, 'plank', now + 0.2 + d, 0.42, [1, 1.12, 0.92, 1.2][i], [-0.4, 0.4, -0.15, 0.2][i])) voice(c, bus, 'tom', now + 0.2 + d, 50 - i * 2, 0.3, 0.6);
      });
      [79, 84, 88].forEach((m, i) => play(c, bus.right, note(c, 'bell', m), now + 0.15 + i * 0.09, 0.3));
      fx(c, 'kick', now + 0.62, 0.55);
    },
  };
  return api;
}

let shared: HostSound | null = null;

/**
 * Every call of the sound, with the page's clock (ms): `?soundlog` in the address keeps them in `window.__soundLog`,
 * so a recorded game (stand-local.mjs replay) can be rendered to a soundtrack with the same calls.
 */
function logged(api: HostSound, w: Window & typeof globalThis): HostSound {
  const log: unknown[] = [];
  (w as unknown as { __soundLog: unknown[] }).__soundLog = log;
  const keep = new Set(['unlock', 'isUnlocked', 'isMuted', 'subscribe', 'ready', 'setMuted']);
  const out = { ...api } as Record<string, unknown>;
  for (const [name, fn] of Object.entries(api)) {
    if (keep.has(name) || typeof fn !== 'function') continue;
    out[name] = (...args: unknown[]) => {
      log.push([w.performance.now(), name, args]);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return out as unknown as HostSound;
}

/** The one sound of this tab: the setup page unlocks it on «Открыть комнату», the game's screen plays it. */
export function hostSound(): HostSound {
  if (!shared) {
    shared = createHostSound();
    if (typeof window !== 'undefined' && /[?&]soundlog\b/.test(window.location.search)) shared = logged(shared, window);
  }
  return shared;
}

