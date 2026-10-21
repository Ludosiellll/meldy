/**
 * The live games' music, written for them (no one else's melody): loops in 16th-note steps — the lobby's groove, the
 * question's tension (a clock's tick-tock over a heartbeat and a minor ostinato; in the last seconds it speeds up and
 * rises), the leaderboard's bounce, the podium's party — and the stings and fanfares as note lists. Pure: the
 * sequencer only says which note is due at which time on the audio clock; sound.ts plays them. Tested.
 */

export type Track = 'lobby' | 'question' | 'board' | 'podium';

export type Voice =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'open'
  | 'shaker'
  | 'tick'
  | 'tock'
  | 'tom'
  | 'crash'
  | 'bass'
  | 'pluck'
  | 'keys'
  | 'mallet'
  | 'bell'
  | 'pad'
  | 'brass';

/** Drums and clicks: their `midi` is ignored (0), except the tom's pitch. */
export const DRUMS: ReadonlySet<Voice> = new Set<Voice>(['kick', 'snare', 'clap', 'hat', 'open', 'shaker', 'tick', 'tock', 'crash']);

export interface Note {
  /** 16th step in the loop. */
  step: number;
  /** MIDI note (drums: 0). */
  midi: number;
  /** Length in steps. */
  len: number;
  vel: number;
  voice: Voice;
  /** Played only in the hurry (the question's last seconds). */
  hurry?: true;
}

export interface Pattern {
  bpm: number;
  /** The loop's own level (linear), so every loop sits at about the same loudness. */
  level?: number;
  /** Steps in the loop (16 a bar). */
  steps: number;
  notes: Note[];
}

const n = (voice: Voice, step: number, midi = 0, len = 1, vel = 1): Note => ({ voice, step, midi, len, vel });
const each = (voice: Voice, steps: readonly number[], vel = 1, midi = 0, len = 1) => steps.map((s) => n(voice, s, midi, len, vel));
/** [step, midi, len] triples of one voice. */
const line = (voice: Voice, list: readonly (readonly [number, number, number?])[], vel: number) => list.map(([s, m, l]) => n(voice, s, m, l ?? 1, vel));
/** A chord (several notes at one step). */
const chord = (voice: Voice, step: number, midis: readonly number[], len: number, vel: number) => midis.map((m) => n(voice, step, m, len, vel));
/** Steps of a pattern repeated every `every` steps, `times` times. */
const rep = (steps: readonly number[], every: number, times: number) => Array.from({ length: times }, (_, k) => steps.map((s) => s + k * every)).flat();
const hurry = (list: Note[]) => list.map((x) => ({ ...x, hurry: true as const }));

// ───────── the lobby: 112 BPM, four bars in F (F – C/E – Dm – B♭ C), four on the floor ─────────
const LOBBY_CHORDS = [
  [57, 60, 65],
  [55, 60, 64],
  [57, 62, 65],
  [58, 62, 65],
] as const;

const LOBBY: Pattern = {
  bpm: 112,
  steps: 64,
  notes: [
    ...each('kick', rep([0, 4, 8, 12], 16, 4), 0.95),
    ...each('clap', rep([4, 12], 16, 4), 0.75),
    ...each('hat', rep([2, 6, 10, 14], 16, 4), 0.5),
    ...Array.from({ length: 64 }, (_, s) => n('shaker', s, 0, 1, s % 2 ? 0.26 : 0.14)),
    n('open', 46, 0, 2, 0.35),
    n('open', 62, 0, 2, 0.45),
    n('snare', 61, 0, 1, 0.3),
    n('snare', 63, 0, 1, 0.45),
    // bass: syncopated roots and octaves
    ...line(
      'bass',
      [
        [0, 41, 2],
        [3, 41],
        [6, 53],
        [8, 41, 2],
        [11, 48],
        [14, 53, 2],
        [16, 40, 2],
        [19, 40],
        [22, 52],
        [24, 48, 2],
        [27, 43],
        [30, 52, 2],
        [32, 38, 2],
        [35, 38],
        [38, 50],
        [40, 38, 2],
        [43, 45],
        [46, 50, 2],
        [48, 46, 2],
        [51, 46],
        [54, 46],
        [56, 48, 2],
        [59, 48],
        [62, 48],
        [63, 52],
      ],
      0.85,
    ),
    // the keys' off-beat stabs (the last bar: B♭, then C)
    ...LOBBY_CHORDS.flatMap((c, b) => [2, 7, 10, 13].flatMap((s) => chord('keys', b * 16 + s, b === 3 && s >= 8 ? [55, 60, 64] : c, s === 2 || s === 10 ? 2 : 1, s === 2 ? 0.42 : 0.32))),
    // the marimba's tune
    ...line(
      'mallet',
      [
        [0, 72],
        [2, 77],
        [4, 76],
        [6, 72],
        [8, 69],
        [11, 72],
        [14, 74],
        [16, 76],
        [18, 74],
        [20, 72],
        [22, 67],
        [24, 72, 4],
        [32, 74],
        [34, 77],
        [36, 81],
        [38, 77],
        [40, 76],
        [43, 74],
        [46, 72],
        [48, 70],
        [50, 74],
        [52, 77],
        [54, 74],
        [56, 76],
        [58, 79],
        [60, 76],
        [62, 74],
      ],
      0.62,
    ),
    // a glint at the end of each phrase
    ...chord('bell', 28, [84], 2, 0.3),
    ...chord('bell', 60, [88], 2, 0.26),
  ],
};

// ───────── the question: 120 BPM, two bars in D minor; tick-tock, a heartbeat, a running ostinato ─────────
const QUESTION: Pattern = {
  bpm: 120,
  level: 1.2,
  steps: 32,
  notes: [
    ...each('tick', [0, 8, 16, 24], 0.7),
    ...each('tock', [4, 12, 20, 28], 0.6),
    ...[0, 8, 16, 24].flatMap((s) => [n('kick', s, 0, 1, s % 16 === 0 ? 0.85 : 0.68), n('kick', s + 3, 0, 1, 0.4)]),
    ...each('hat', rep([2, 6, 10, 14], 16, 2), 0.32),
    ...Array.from({ length: 32 }, (_, s) => n('shaker', s, 0, 1, s % 2 ? 0.2 : 0.1)),
    ...hurry(each('hat', rep([1, 3, 5, 7, 9, 11, 13, 15], 16, 2), 0.18)),
    ...hurry(each('clap', [4, 12, 20, 28], 0.5)),
    // toms at the end of each bar: the turn of the screw
    ...line(
      'tom',
      [
        [13, 50],
        [14, 47],
        [15, 45],
        [29, 50],
        [30, 47],
        [31, 43],
      ],
      0.55,
    ),
    // the bass in eighths: D with octave jumps, then a creeping line down to the dominant
    ...line(
      'bass',
      [
        [0, 38],
        [2, 38],
        [4, 50],
        [6, 38],
        [8, 41],
        [10, 38],
        [12, 50],
        [14, 40],
        [16, 38],
        [18, 38],
        [20, 50],
        [22, 38],
        [24, 46],
        [26, 45],
        [28, 43],
        [30, 45],
      ],
      0.9,
    ),
    // the strings: D minor, then B♭ over D, then A (the dominant pulls the loop round)
    ...chord('pad', 0, [62, 65, 69], 16, 0.55),
    ...chord('pad', 16, [62, 65, 70], 8, 0.55),
    ...chord('pad', 24, [61, 64, 69], 8, 0.55),
    // the pluck's running sixteenths
    ...Array.from({ length: 32 }, (_, s) => {
      const fig = s < 16 ? [74, 77, 81, 77] : s < 24 ? [74, 77, 82, 77] : [73, 76, 81, 76];
      return n('pluck', s, fig[s % 4], 1, s % 4 === 0 ? 0.5 : 0.32);
    }),
  ],
};

// ───────── the leaderboard: 116 BPM, two bars in C (C – Am – F – G), a bouncing bass, a glockenspiel ─────────
const BOARD: Pattern = {
  bpm: 116,
  level: 1.25,
  steps: 32,
  notes: [
    ...each('kick', [0, 8, 16, 24], 0.9),
    ...each('kick', [10, 26], 0.5),
    ...each('clap', [4, 12, 20, 28], 0.68),
    ...each('hat', rep([2, 6, 10, 14], 16, 2), 0.45),
    ...Array.from({ length: 32 }, (_, s) => n('shaker', s, 0, 1, s % 2 ? 0.2 : 0.1)),
    n('open', 30, 0, 2, 0.4),
    ...line(
      'bass',
      [
        [0, 36],
        [2, 48],
        [4, 36],
        [7, 43],
        [8, 45],
        [10, 33],
        [12, 45],
        [14, 43],
        [16, 41],
        [18, 53],
        [20, 41],
        [23, 43],
        [24, 43],
        [26, 31],
        [28, 43],
        [30, 47],
      ],
      0.82,
    ),
    ...chord('keys', 2, [60, 64, 67], 2, 0.36),
    ...chord('keys', 10, [60, 64, 69], 2, 0.34),
    ...chord('keys', 18, [60, 65, 69], 2, 0.34),
    ...chord('keys', 26, [59, 62, 67], 2, 0.34),
    ...line(
      'bell',
      [
        [0, 76],
        [2, 79],
        [4, 84],
        [6, 79],
        [8, 81],
        [11, 79],
        [16, 77],
        [18, 81],
        [20, 84],
        [22, 81],
        [24, 83],
        [27, 79],
      ],
      0.46,
    ),
  ],
};

// ───────── the podium: 124 BPM, two bars in G (G – C – D – G), a party ─────────
const PODIUM: Pattern = {
  bpm: 124,
  steps: 32,
  notes: [
    ...each('kick', rep([0, 4, 8, 12], 16, 2), 0.95),
    ...each('clap', [4, 12, 20, 28], 0.75),
    ...each('open', rep([2, 6, 10, 14], 16, 2), 0.3),
    ...Array.from({ length: 32 }, (_, s) => n('shaker', s, 0, 1, s % 2 ? 0.24 : 0.12)),
    ...line(
      'bass',
      [
        [0, 43],
        [3, 55],
        [6, 43],
        [8, 48],
        [11, 60],
        [14, 48],
        [16, 50],
        [19, 62],
        [22, 50],
        [24, 43],
        [27, 55],
        [30, 47],
      ],
      0.85,
    ),
    ...[
      [59, 62, 67],
      [60, 64, 67],
      [57, 62, 66],
      [59, 62, 67],
    ].flatMap((c, k) => [2, 6].flatMap((s) => chord('keys', k * 8 + s, c, 1, 0.34))),
    ...line(
      'bell',
      [
        [0, 79],
        [2, 83],
        [4, 86],
        [7, 84],
        [8, 84],
        [10, 88],
        [12, 86],
        [14, 84],
        [16, 81],
        [18, 86],
        [20, 90],
        [23, 88],
        [24, 86, 4],
        [28, 83],
        [30, 81],
      ],
      0.42,
    ),
    ...line(
      'mallet',
      [
        [0, 67],
        [4, 71],
        [8, 72],
        [12, 72],
        [16, 69],
        [20, 74],
        [24, 71],
        [28, 74],
      ],
      0.4,
    ),
  ],
};

export const TRACKS: Record<Track, Pattern> = { lobby: LOBBY, question: QUESTION, board: BOARD, podium: PODIUM };

/** The question's last seconds: this much faster, this many semitones higher. */
export const HURRY = { tempo: 1.25, transpose: 2 } as const;

/** Seconds of one 16th step at `bpm`. */
export const stepSec = (bpm: number) => 60 / bpm / 4;

export interface Due {
  time: number;
  note: Note;
  /** Semitones to add (the hurry). */
  shift: number;
  /** Seconds per step at the time (for lengths). */
  step: number;
}

/** What the sequencer calls per due note (no object made per note). */
export type Play = (time: number, note: Note, shift: number, step: number) => void;

/**
 * Walks a pattern on the audio clock: `run(until, play)` plays every note whose step starts before `until` (seconds),
 * in order, and moves on. The tempo and the shift can change at any step (hurry); a step already handed out keeps its
 * time. Notes of one step are handed out together. Nothing is allocated per call.
 */
export class Sequencer {
  private stepNo = 0;
  private next: number;
  private readonly byStep: Note[][];
  bpm: number;
  shift = 0;
  hurried = false;

  constructor(
    readonly pattern: Pattern,
    start: number,
  ) {
    this.next = start;
    this.bpm = pattern.bpm;
    this.byStep = Array.from({ length: pattern.steps }, () => []);
    for (const note of pattern.notes) this.byStep[note.step % pattern.steps].push(note);
  }

  /** The next step's time (s). */
  get nextTime(): number {
    return this.next;
  }

  setHurry(on: boolean): void {
    this.hurried = on;
    this.bpm = on ? this.pattern.bpm * HURRY.tempo : this.pattern.bpm;
    this.shift = on ? HURRY.transpose : 0;
  }

  /** A clock that fell behind (a hidden tab) starts again from `now` instead of playing a pile of late notes. */
  catchUp(now: number): void {
    if (this.next < now - 0.05) this.next = now + 0.02;
  }

  run(until: number, play: Play): void {
    while (this.next < until) {
      const step = stepSec(this.bpm);
      const notes = this.byStep[this.stepNo % this.pattern.steps];
      for (let i = 0; i < notes.length; i += 1) {
        const note = notes[i];
        if (note.hurry && !this.hurried) continue;
        play(this.next, note, this.shift, step);
      }
      this.stepNo += 1;
      this.next += step;
    }
  }

  /** The notes `run` would play, as a list (the tests). */
  due(until: number): Due[] {
    const out: Due[] = [];
    this.run(until, (time, note, shift, step) => out.push({ time, note, shift, step }));
    return out;
  }
}

/** One-shot pieces: (seconds from now, MIDI, seconds long, velocity). */
export type Shot = readonly [number, number, number, number];

/** The victory: an upward call, a held major chord with a turn on top. */
export const FANFARE: readonly Shot[] = [
  [0, 67, 0.12, 0.8],
  [0.13, 72, 0.12, 0.8],
  [0.26, 74, 0.12, 0.85],
  [0.39, 76, 0.3, 0.9],
  [0.72, 74, 0.1, 0.75],
  [0.84, 76, 0.1, 0.8],
  [0.96, 79, 0.7, 1],
  [0.96, 72, 1.4, 0.55],
  [0.96, 76, 1.4, 0.5],
  [0.96, 67, 1.4, 0.45],
  [1.66, 84, 1.0, 0.9],
];

/** The key is shown: a quick rising pair and a bright chord. */
export const REVEAL_STING: readonly Shot[] = [
  [0, 70, 0.08, 0.7],
  [0.08, 77, 0.08, 0.8],
  [0.17, 82, 0.45, 0.9],
  [0.17, 74, 0.45, 0.5],
  [0.17, 77, 0.45, 0.45],
];

/** A new phase: a falling minor stab. */
export const PHASE_STING: readonly Shot[] = [
  [0, 62, 0.18, 0.9],
  [0, 65, 0.18, 0.7],
  [0.2, 61, 0.6, 0.9],
  [0.2, 64, 0.6, 0.7],
  [0.2, 49, 0.6, 0.6],
];

/** Time is up: one hard D minor stab. */
export const TIME_UP: readonly Shot[] = [
  [0, 50, 0.55, 0.9],
  [0, 57, 0.55, 0.75],
  [0, 62, 0.55, 0.8],
  [0, 65, 0.55, 0.7],
];

/** The answers open after the 3-2-1: a bright C major hit. */
export const GO: readonly Shot[] = [
  [0, 60, 0.36, 0.7],
  [0, 67, 0.36, 0.6],
  [0, 72, 0.36, 0.7],
  [0, 76, 0.36, 0.6],
  [0, 79, 0.36, 0.55],
];

/** The monster won: two falling minor chords. */
export const LOSE: readonly Shot[] = [
  [0, 50, 0.6, 0.8],
  [0, 53, 0.6, 0.6],
  [0, 57, 0.6, 0.6],
  [0.5, 49, 1.3, 0.8],
  [0.5, 52, 1.3, 0.6],
  [0.5, 56, 1.3, 0.55],
  [0.5, 37, 1.3, 0.6],
];

/** Every note of every piece. Used by the tests. */
export function allNotes(): { voice: Voice | 'shot'; midi: number }[] {
  const out: { voice: Voice | 'shot'; midi: number }[] = [];
  for (const p of Object.values(TRACKS)) for (const note of p.notes) out.push({ voice: note.voice, midi: note.midi });
  for (const list of [FANFARE, REVEAL_STING, PHASE_STING, TIME_UP, GO, LOSE]) for (const s of list) out.push({ voice: 'shot', midi: s[1] });
  return out;
}
