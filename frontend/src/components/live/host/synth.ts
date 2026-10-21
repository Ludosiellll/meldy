/**
 * The instruments and effects of the live games' sound, as pure sample functions: each renders one short sound into a
 * Float32Array once (sound.ts copies it into an AudioBuffer and replays it as often as it likes). Drums and clicks by
 * name; pitched instruments by voice and MIDI note — a plucked string (Karplus–Strong), an electric piano (FM), a
 * marimba and a glockenspiel (their bars' partials), a synth bass whose brightness falls like a filter's. Every buffer
 * starts and ends at zero (a short fade), so nothing clicks where it starts or stops. Deterministic: no Math.random.
 * Cheap: fixed sines by recurrence and decays by multiplication (no Math.sin or Math.exp per sample and partial),
 * so the whole set renders in the background a few milliseconds at a time.
 */

export type BufferName =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'open'
  | 'shaker'
  | 'tick'
  | 'tock'
  | 'crash'
  | 'land0'
  | 'land1'
  | 'land2'
  | 'crack0'
  | 'crack1'
  | 'shatter'
  | 'whoosh'
  | 'up'
  | 'down'
  | 'boom'
  | 'rumble'
  | 'ghost'
  | 'alarm'
  | 'pop';

export type NoteVoice = 'tom' | 'bass' | 'pluck' | 'keys' | 'mallet' | 'bell';

/** Seconds of each named buffer. */
export const LENGTH: Record<BufferName, number> = {
  kick: 0.5,
  snare: 0.32,
  clap: 0.42,
  hat: 0.09,
  open: 0.5,
  shaker: 0.1,
  tick: 0.07,
  tock: 0.08,
  crash: 2.2,
  land0: 0.26,
  land1: 0.26,
  land2: 0.26,
  crack0: 0.3,
  crack1: 0.3,
  shatter: 0.55,
  whoosh: 0.26,
  up: 0.85,
  down: 1.0,
  boom: 1.9,
  rumble: 2.4,
  ghost: 1.7,
  alarm: 1.7,
  pop: 0.12,
};

/** Seconds of a pitched note's buffer. */
export const NOTE_LENGTH: Record<NoteVoice, number> = { tom: 0.5, bass: 0.8, pluck: 1.0, keys: 1.2, mallet: 0.9, bell: 1.5 };

/**
 * The sample rate each sound is rendered at, at most (the browser resamples a buffer as it plays): what has no
 * highs is rendered at 24 or 32 kHz — a half or two thirds of the work and the memory.
 */
export const RATE_CAP: Record<BufferName, number> = {
  kick: 32000,
  snare: 48000,
  clap: 48000,
  hat: 48000,
  open: 48000,
  shaker: 48000,
  tick: 48000,
  tock: 48000,
  crash: 48000,
  land0: 32000,
  land1: 32000,
  land2: 32000,
  crack0: 48000,
  crack1: 48000,
  shatter: 48000,
  whoosh: 32000,
  up: 32000,
  down: 32000,
  boom: 24000,
  rumble: 24000,
  ghost: 24000,
  alarm: 32000,
  pop: 24000,
};
export const NOTE_RATE_CAP: Record<NoteVoice, number> = { tom: 24000, bass: 24000, pluck: 32000, keys: 32000, mallet: 32000, bell: 48000 };

export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const TAU = Math.PI * 2;

/** A seeded noise source, −1…1. */
function noise(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
}

/** One biquad (RBJ cookbook), direct form I; its frequency can move (`set`). */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly type: 'lowpass' | 'highpass' | 'bandpass',
    private readonly rate: number,
    freq: number,
    private readonly q = 0.707,
  ) {
    this.set(freq);
  }

  set(freq: number): void {
    const w = (TAU * Math.min(freq, this.rate * 0.45)) / this.rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * this.q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (this.type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
    } else if (this.type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** A sine at a fixed frequency by recurrence (no Math.sin per sample); starts at 0. */
class Sine {
  private y1: number;
  private y2: number;
  private readonly k: number;

  constructor(f: number, rate: number) {
    const w = (TAU * f) / rate;
    this.k = 2 * Math.cos(w);
    this.y1 = -Math.sin(w);
    this.y2 = -Math.sin(2 * w);
  }

  next(): number {
    const y = this.k * this.y1 - this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** exp(−t / tau) by multiplication, 1 at the first call. */
class Decay {
  private v = 1;
  private readonly m: number;

  constructor(tau: number, rate: number) {
    this.m = Math.exp(-1 / (tau * rate));
  }

  next(): number {
    const r = this.v;
    this.v *= this.m;
    return r;
  }
}

/** A soft clip close to tanh (a rational fit), far cheaper per sample. */
function soft(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** The 808's six square waves (Hz): the metal of hats and cymbals, from phase accumulators. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

class Metal {
  private readonly ph = new Float64Array(6);
  private readonly inc: number[];

  constructor(scale: number, rate: number) {
    this.inc = METAL.map((f) => (f * scale) / rate);
  }

  next(): number {
    let s = 0;
    for (let j = 0; j < 6; j += 1) {
      let p = this.ph[j] + this.inc[j];
      if (p >= 1) p -= 1;
      this.ph[j] = p;
      s += p < 0.5 ? 1 : -1;
    }
    return s / 6;
  }
}

/** A short fade at both ends (no click where a buffer starts or stops), then a hard limit at ±1. */
function finish(out: Float32Array, rate: number, fadeIn = 0.0008, fadeOut = 0.012): Float32Array {
  const a = Math.max(1, Math.floor(rate * fadeIn));
  const b = Math.max(1, Math.floor(rate * fadeOut));
  for (let i = 0; i < out.length; i += 1) {
    let v = out[i];
    if (i < a) v *= i / a;
    const left = out.length - 1 - i;
    if (left < b) v *= left / b;
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return out;
}

/** A named drum, click or effect. */
export function renderSamples(name: BufferName, rate: number): Float32Array {
  const len = Math.floor(rate * LENGTH[name]);
  const out = new Float32Array(len);
  const rnd = noise(name.length * 7919 + name.charCodeAt(0) * 31 + name.charCodeAt(name.length - 1));
  const v = name.endsWith('1') ? 1 : name.endsWith('2') ? 2 : 0;
  const dt = 1 / rate;
  let phase = 0;
  switch (name) {
    case 'kick': {
      const lp = new Biquad('lowpass', rate, 3000);
      const sweep = new Decay(0.026, rate);
      const sweep2 = new Decay(0.15, rate);
      const body = new Decay(0.24, rate);
      const click = new Decay(0.004, rate);
      const knock = new Sine(1600, rate);
      for (let i = 0; i < len; i += 1) {
        phase += (TAU * (54 + 110 * sweep.next() + 16 * sweep2.next())) / rate;
        const c = click.next();
        out[i] = soft(2.2 * Math.sin(phase) * body.next()) * 0.8 + lp.run(rnd()) * c * 0.7 + knock.next() * c * 0.25;
      }
      break;
    }
    case 'snare': {
      const hp = new Biquad('highpass', rate, 1400);
      const lp = new Biquad('lowpass', rate, 9000);
      const [s1, s2] = [new Sine(185, rate), new Sine(330, rate)];
      const [d1, d2, dn] = [new Decay(0.07, rate), new Decay(0.045, rate), new Decay(0.1, rate)];
      for (let i = 0; i < len; i += 1) {
        const body = s1.next() * d1.next() * 0.55 + s2.next() * d2.next() * 0.3;
        out[i] = soft(1.5 * (body + lp.run(hp.run(rnd())) * dn.next() * 0.9)) * 0.82;
      }
      break;
    }
    case 'clap': {
      const bp = new Biquad('bandpass', rate, 1500, 0.9);
      const burst = Math.exp(-dt / 0.0045);
      const tail = Math.exp(-dt / 0.11);
      let env = 0;
      let tl = 0.85;
      for (let i = 0; i < len; i += 1) {
        const t = i * dt;
        // three slaps 11 ms apart, then the room's tail
        if (i === 0 || i === Math.round(0.011 * rate) || i === Math.round(0.022 * rate)) env += 1;
        env *= burst;
        let e = env;
        if (t >= 0.033) {
          e += tl;
          tl *= tail;
        }
        out[i] = soft(bp.run(rnd()) * e * 3.2) * 0.85;
      }
      break;
    }
    case 'hat':
    case 'open': {
      const hp = new Biquad('highpass', rate, 7200);
      const bp = new Biquad('bandpass', rate, 10500, 0.8);
      const m = new Metal(1.7, rate);
      const d = new Decay(name === 'hat' ? 0.02 : 0.17, rate);
      for (let i = 0; i < len; i += 1) {
        const x = m.next() * 0.7 + rnd() * 0.3;
        out[i] = (hp.run(x) + bp.run(x) * 0.6) * d.next() * 1.7;
      }
      break;
    }
    case 'shaker': {
      const hp = new Biquad('highpass', rate, 5200);
      const d = new Decay(0.03, rate);
      const rise = Math.floor(0.012 * rate);
      for (let i = 0; i < len; i += 1) out[i] = hp.run(rnd()) * (i < rise ? i / rise : d.next()) * 0.9;
      break;
    }
    case 'tick':
    case 'tock': {
      const [f1, f2] = name === 'tick' ? [2200, 3500] : [1500, 2450];
      const [s1, s2] = [new Sine(f1, rate), new Sine(f2, rate)];
      const [d1, d2, d3] = [new Decay(0.012, rate), new Decay(0.006, rate), new Decay(0.0015, rate)];
      for (let i = 0; i < len; i += 1) out[i] = s1.next() * d1.next() * 0.8 + s2.next() * d2.next() * 0.4 + rnd() * d3.next() * 0.3;
      break;
    }
    case 'crash': {
      const hp = new Biquad('highpass', rate, 3800);
      const hp2 = new Biquad('highpass', rate, 6000);
      const m = new Metal(2.3, rate);
      const [d1, d2] = [new Decay(0.55, rate), new Decay(0.06, rate)];
      const attack = Math.floor(0.002 * rate);
      for (let i = 0; i < len; i += 1) {
        const x = hp.run(m.next()) * 0.45 + hp2.run(rnd()) * 0.75;
        out[i] = x * (i < attack ? i / attack : 1) * (d1.next() * 0.8 + d2.next() * 0.6);
      }
      break;
    }
    case 'land0':
    case 'land1':
    case 'land2': {
      // a thump (falling pitch), a short crack of noise and a little ping
      const ping = new Sine(1700 + v * 380, rate);
      const [d1, d2, d3] = [new Decay(0.07, rate), new Decay(0.016, rate), new Decay(0.05, rate)];
      for (let i = 0; i < len; i += 1) {
        const t = i * dt;
        phase += (TAU * (150 + v * 30 - 100 * Math.min(1, t / 0.12))) / rate;
        out[i] = Math.sin(phase) * d1.next() * 0.85 + rnd() * d2.next() * 0.5 + ping.next() * d3.next() * 0.18;
      }
      break;
    }
    case 'crack0':
    case 'crack1': {
      // ice closing: crackle impulses and a high ping
      const bp = new Biquad('bandpass', rate, 3200 + v * 600, 1.5);
      const ping = new Sine(2600 + v * 500, rate);
      const [d1, d2, d3] = [new Decay(0.12, rate), new Decay(0.05, rate), new Decay(0.06, rate)];
      for (let i = 0; i < len; i += 1) {
        const n = rnd();
        const crackle = Math.abs(n) > 0.93 - i * dt * 0.6 ? n : 0;
        out[i] = bp.run(crackle) * d1.next() * 2.2 + crackle * d2.next() * 0.4 + ping.next() * d3.next() * 0.3;
      }
      break;
    }
    case 'shatter': {
      // glass-like: bright pings scattered over the first 200 ms, and noise
      const pings = [
        [0, 3100],
        [0.03, 4300],
        [0.07, 3700],
        [0.12, 5200],
        [0.18, 4600],
      ].map(([at, f]) => ({ from: Math.round(at * rate), sine: new Sine(f, rate), d: new Decay(0.07, rate) }));
      const dn = new Decay(0.16, rate);
      let lp = 0;
      for (let i = 0; i < len; i += 1) {
        const n = rnd();
        lp += (n - lp) * 0.6;
        let x = (n - lp) * dn.next() * 0.7;
        for (const p of pings) if (i >= p.from) x += p.sine.next() * p.d.next() * 0.22;
        out[i] = x;
      }
      break;
    }
    case 'whoosh':
    case 'up':
    case 'down': {
      // a band of noise sweeping (up: the boss's jump, rising; down: the floor falling away)
      const dur = LENGTH[name];
      const bp = new Biquad('bandpass', rate, 600, name === 'whoosh' ? 0.9 : 1.6);
      const [from, to] = name === 'up' ? [260, 3600] : name === 'down' ? [3000, 170] : [700, 2400];
      const gain = name === 'whoosh' ? 2.4 : 3.2;
      for (let i = 0; i < len; i += 1) {
        const t = i * dt;
        const k = t / dur;
        if (i % 32 === 0) bp.set(from * (to / from) ** k);
        const env = name === 'up' ? k * k * (k > 0.96 ? (1 - k) / 0.04 : 1) : name === 'down' ? Math.min(1, t / 0.06) * (1 - k) * Math.sqrt(1 - k) : Math.sin(Math.PI * k);
        out[i] = bp.run(rnd()) * env * gain;
      }
      break;
    }
    case 'boom': {
      // the big blow: a drop from 137 Hz down to 42, a body of low noise, a mid crunch and a hard transient
      const lp = new Biquad('lowpass', rate, 420);
      const lp2 = new Biquad('lowpass', rate, 2600);
      const bp = new Biquad('bandpass', rate, 1100, 0.8);
      const [sweep, dsub, dbody, dcrunch, dhit] = [new Decay(0.09, rate), new Decay(0.5, rate), new Decay(0.36, rate), new Decay(0.09, rate), new Decay(0.012, rate)];
      for (let i = 0; i < len; i += 1) {
        phase += (TAU * (42 + 95 * sweep.next())) / rate;
        const x = Math.sin(phase) * dsub.next() + lp.run(rnd()) * dbody.next() * 1.6 + bp.run(rnd()) * dcrunch.next() * 1.4 + lp2.run(rnd()) * dhit.next() * 0.9;
        out[i] = soft(2.2 * x) * 0.9;
      }
      break;
    }
    case 'rumble': {
      // the floor breaking up: a low rumble that wobbles, and crumbling debris that thins out — each grain a short burst
      // of noise with a soft edge (an impulse into a narrow filter would click)
      const lp = new Biquad('lowpass', rate, 170, 0.9);
      const bpHi = new Biquad('bandpass', rate, 1900, 1.6);
      const bpLo = new Biquad('bandpass', rate, 650, 1.4);
      const wobble = new Sine(7, rate);
      const denv = new Decay(0.85, rate);
      const dgrain = new Decay(0.7, rate);
      const fall = Math.exp(-1 / (rate * 0.004));
      const per = 0.0006 * (48000 / rate);
      const rise = Math.floor(0.05 * rate);
      let target = 0;
      let g = 0;
      for (let i = 0; i < len; i += 1) {
        const env = (i < rise ? i / rise : 1) * denv.next();
        const low = lp.run(rnd()) * (0.65 + 0.35 * wobble.next()) * env * 2.4;
        if ((rnd() + 1) / 2 < per * dgrain.next()) target = (0.5 + 0.5 * Math.abs(rnd())) * env * 3;
        target *= fall;
        g += (target - g) * 0.08 * (48000 / rate);
        const grain = rnd() * g;
        out[i] = soft(low + bpHi.run(grain) * 0.9 + bpLo.run(grain) * 1.2) * 0.9;
      }
      break;
    }
    case 'ghost': {
      // light and airy: an open fifth that glides up with a slow vibrato, and breath
      const bp = new Biquad('bandpass', rate, 900, 1.2);
      const vib = new Sine(6, rate);
      const dur = LENGTH.ghost;
      let p1 = 0;
      let p2 = 0;
      let p3 = 0;
      for (let i = 0; i < len; i += 1) {
        const t = i * dt;
        const k = t / dur;
        const w = (TAU * 660 * (1 + 0.18 * k) * (1 + 0.015 * vib.next())) / rate;
        p1 += w;
        p2 += w * 1.5;
        p3 += w * 2;
        if (i % 32 === 0) bp.set(800 * 3 ** k);
        const env = Math.min(1, t / 0.35) * (k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1);
        out[i] = ((Math.sin(p1) * 0.5 + Math.sin(p2) * 0.3 + Math.sin(p3) * 0.16) * 0.6 + bp.run(rnd()) * 0.5) * env;
      }
      break;
    }
    case 'alarm': {
      // an alarm clock: a hammer at 16 strikes a second between two bells, each ringing on between its strikes
      const dur = LENGTH.alarm;
      const bells = [2350, 2650].map((f) => [new Sine(f, rate), new Sine(f * 1.48, rate), new Sine(f * 2.1, rate)]);
      const ring = (b: Sine[]) => b[0].next() * 0.6 + b[1].next() * 0.25 + b[2].next() * 0.12;
      const struck = (t: number, odd: number) => {
        // time since this bell's last strike (it is struck every 1/8 s, the other one in between)
        const k = Math.floor((t * 16 - odd) / 2);
        if (k < 0) return 0;
        const since = t - (2 * k + odd) / 16;
        return since < 0.0015 ? since / 0.0015 : 0.25 + 0.75 * Math.exp(-(since - 0.0015) / 0.03);
      };
      for (let i = 0; i < len; i += 1) {
        const t = i * dt;
        const env = Math.min(1, t / 0.02) * (t > dur - 0.25 ? (dur - t) / 0.25 : 1);
        out[i] = (ring(bells[0]) * struck(t, 0) + ring(bells[1]) * struck(t, 1)) * env * 0.6;
      }
      break;
    }
    case 'pop': {
      const d = new Decay(0.035, rate);
      for (let i = 0; i < len; i += 1) {
        phase += (TAU * 520 * (1 + 0.6 * Math.min(1, (i * dt) / 0.06))) / rate;
        out[i] = Math.sin(phase) * d.next() * 0.8;
      }
      break;
    }
  }
  return finish(out, rate, name === 'kick' || name === 'boom' ? 0.0003 : 0.0008);
}

/** A pitched note (MIDI) of one of the sampled instruments. */
export function renderNote(voice: NoteVoice, midi: number, rate: number): Float32Array {
  const len = Math.floor(rate * NOTE_LENGTH[voice]);
  const out = new Float32Array(len);
  const f0 = hz(midi);
  const nyq = rate * 0.45;
  const rnd = noise(midi * 131 + voice.length * 17 + voice.charCodeAt(0));
  switch (voice) {
    case 'tom': {
      let phase = 0;
      const [sweep, d, dn] = [new Decay(0.04, rate), new Decay(0.22, rate), new Decay(0.008, rate)];
      for (let i = 0; i < len; i += 1) {
        phase += (TAU * f0 * (1 + 0.3 * sweep.next())) / rate;
        out[i] = soft(1.4 * (Math.sin(phase) * d.next() + rnd() * dn.next() * 0.25)) * 0.85;
      }
      break;
    }
    case 'bass': {
      // a saw whose upper harmonics die away (a closing filter), a sub sine for weight, a little drive; the harmonics
      // by the Chebyshev recurrence sin(kφ) = 2·cos φ·sin((k−1)φ) − sin((k−2)φ)
      const K = Math.max(3, Math.min(16, Math.floor(Math.min(5000, nyq) / f0)));
      const w = (TAU * f0) / rate;
      const [dBright, dFast, dSlow] = [new Decay(0.08, rate), new Decay(0.18, rate), new Decay(0.9, rate)];
      const attack = Math.floor(0.004 * rate);
      for (let i = 0; i < len; i += 1) {
        const ph = w * i;
        const s1 = Math.sin(ph);
        const c2 = 2 * Math.cos(ph);
        const bright = 0.45 + 0.45 * dBright.next();
        let prev = 0;
        let cur = s1;
        let sum = s1;
        let a = bright;
        for (let k = 2; k <= K; k += 1) {
          const next = c2 * cur - prev;
          prev = cur;
          cur = next;
          sum += (cur * a) / k;
          a *= bright;
        }
        const env = (i < attack ? i / attack : 1) * (0.55 * dFast.next() + 0.45 * dSlow.next());
        out[i] = soft(1.5 * (sum * 0.75 + s1 * 0.12) * env) * 0.9;
      }
      break;
    }
    case 'pluck': {
      // Karplus–Strong: a burst of soft noise circulating in a delay line one period long, averaged each time round
      const period = rate / f0 - 0.5;
      const loss = 10 ** (-3 / (1.1 * f0));
      let lp = 0;
      let dc = 0;
      let prev = 0;
      for (let i = 0; i < len; i += 1) {
        let y: number;
        if (i < period) {
          lp += (rnd() - lp) * 0.8;
          y = lp;
        } else {
          const d = i - period;
          const i0 = Math.floor(d);
          const fr = d - i0;
          const a = out[i0] * (1 - fr) + out[i0 + 1] * fr;
          const b = i0 > 0 ? out[i0 - 1] * (1 - fr) + out[i0] * fr : a;
          y = loss * 0.5 * (a + b);
        }
        out[i] = y;
      }
      // a DC blocker over the result (the excitation has some)
      for (let i = 0; i < len; i += 1) {
        const x = out[i];
        dc = x - prev + 0.995 * dc;
        prev = x;
        out[i] = dc * 0.9;
      }
      break;
    }
    case 'keys': {
      // an electric piano: FM with a falling index, a chorus partner, a short metallic tine
      const tine = f0 * 7 < nyq ? new Sine(f0 * 7, rate) : null;
      const [m1, m2] = [new Sine(f0, rate), new Sine(f0 * 1.003, rate)];
      const [dIndex, dTine, dFast, dSlow] = [new Decay(0.16, rate), new Decay(0.05, rate), new Decay(0.55, rate), new Decay(1.6, rate)];
      const w1 = (TAU * f0) / rate;
      const w2 = w1 * 1.003;
      const attack = Math.floor(0.002 * rate);
      for (let i = 0; i < len; i += 1) {
        const index = 0.35 + 2.6 * dIndex.next();
        const car = Math.sin(w1 * i + index * m1.next());
        const car2 = Math.sin(w2 * i + index * 0.8 * m2.next());
        const tn = tine ? tine.next() * 0.16 * dTine.next() : 0;
        const env = (i < attack ? i / attack : 1) * (0.75 * dFast.next() + 0.25 * dSlow.next());
        out[i] = (car * 0.6 + car2 * 0.35 + tn) * env * 0.7;
      }
      break;
    }
    case 'mallet':
    case 'bell': {
      // a bar's partials: a marimba's (tuned 1 : 3.93 : 9.24) or a glockenspiel's (1 : 2.76 : 5.40 : 8.93)
      const table =
        voice === 'mallet'
          ? [
              [1, 1, 0.42],
              [3.93, 0.45, 0.09],
              [9.24, 0.14, 0.025],
            ]
          : [
              [1, 1, 1.1],
              [2.756, 0.42, 0.32],
              [5.404, 0.2, 0.12],
              [8.933, 0.1, 0.06],
            ];
      const parts = table.filter(([r]) => f0 * r < nyq).map(([r, a, tau]) => ({ sine: new Sine(f0 * r, rate), a, d: new Decay(tau, rate) }));
      const lp = new Biquad('lowpass', rate, 2500);
      const dk = new Decay(0.003, rate);
      const gain = voice === 'mallet' ? 0.72 : 0.55;
      const attack = Math.max(1, Math.floor(0.001 * rate));
      for (let i = 0; i < len; i += 1) {
        let x = 0;
        for (const p of parts) x += p.sine.next() * p.a * p.d.next();
        out[i] = (x * gain + lp.run(rnd()) * dk.next() * 0.4) * (i < attack ? i / attack : 1);
      }
      break;
    }
  }
  return finish(out, rate);
}

/** A room's impulse response: two decorrelated decaying noises, a little pre-delay, darker as it fades. */
export function renderRoom(rate: number, seconds = 1.6): [Float32Array, Float32Array] {
  const len = Math.floor(rate * seconds);
  const pre = Math.floor(rate * 0.012);
  const chans: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  chans.forEach((out, c) => {
    const rnd = noise(9001 + c * 77);
    const d = new Decay(seconds / 6.9, rate);
    let lp = 0;
    for (let i = pre; i < len; i += 1) {
      const k = 0.85 - 0.6 * ((i - pre) / rate / seconds);
      lp += (rnd() - lp) * k;
      out[i] = lp * d.next() * 0.5;
    }
  });
  return chans;
}
