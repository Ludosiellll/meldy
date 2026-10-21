/**
 * The games' music (music.ts): every note playable and in its loop's key, the loops whole bars, the sequencer handing
 * out notes in order on the audio clock — never more than asked, never twice — and the question's last seconds faster,
 * higher and busier.
 */
import { describe, expect, it } from 'vitest';
import { DRUMS, FANFARE, GO, HURRY, LOSE, PHASE_STING, REVEAL_STING, Sequencer, TIME_UP, TRACKS, allNotes, stepSec, type Track } from './music';

/** Pitch classes of each loop's key (the question's D minor has its leading note C♯). */
const KEYS: Record<Track, number[]> = {
  lobby: [5, 7, 9, 10, 0, 2, 4],
  question: [2, 4, 5, 7, 9, 10, 0, 1],
  board: [0, 2, 4, 5, 7, 9, 11],
  podium: [7, 9, 11, 0, 2, 4, 6],
};

describe('the games’ music', () => {
  it('every note is a real note in a playable range; the loops are whole bars at a game’s tempo', () => {
    for (const { voice, midi } of allNotes()) {
      if (voice !== 'shot' && DRUMS.has(voice)) continue;
      expect(midi, voice).toBeGreaterThanOrEqual(28);
      expect(midi, voice).toBeLessThanOrEqual(100);
      expect(Number.isInteger(midi)).toBe(true);
    }
    for (const [name, p] of Object.entries(TRACKS)) {
      expect(p.steps % 16, name).toBe(0);
      expect(p.bpm).toBeGreaterThanOrEqual(90);
      expect(p.bpm).toBeLessThanOrEqual(140);
      expect(p.level ?? 1).toBeGreaterThan(0.5);
      expect(p.level ?? 1).toBeLessThan(2);
      for (const n of p.notes) {
        expect(n.step, name).toBeGreaterThanOrEqual(0);
        expect(n.step, name).toBeLessThan(p.steps);
        expect(n.len).toBeGreaterThan(0);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('no wrong notes: every pitched note of a loop is in its key', () => {
    for (const [name, p] of Object.entries(TRACKS) as [Track, (typeof TRACKS)[Track]][]) {
      for (const n of p.notes) {
        if (DRUMS.has(n.voice) || n.voice === 'tom') continue;
        expect(KEYS[name], `${name}: ${n.voice} ${n.midi} at step ${n.step}`).toContain(n.midi % 12);
      }
    }
    // the stings: the fanfare and the open in C major, «Время вышло» in D minor
    for (const s of [...FANFARE, ...GO]) expect(KEYS.board).toContain(s[1] % 12);
    for (const s of TIME_UP) expect(KEYS.question).toContain(s[1] % 12);
    for (const list of [REVEAL_STING, PHASE_STING, LOSE]) expect(list.length).toBeGreaterThan(2);
  });

  it('hands out the notes due before a time, in order, each once, and loops', () => {
    const p = TRACKS.lobby;
    const seq = new Sequencer(p, 10);
    const step = stepSec(p.bpm);
    const first = seq.due(10 + step * 0.5); // only step 0
    expect(first.length).toBe(p.notes.filter((n) => n.step === 0 && !n.hurry).length);
    expect(first.every((d) => d.time === 10)).toBe(true);
    expect(seq.due(10 + step * 0.5)).toEqual([]); // asked again: nothing twice
    // a whole loop later every note has come once
    const loop = seq.due(10 + step * p.steps + step * 0.5);
    expect(loop.length).toBe(p.notes.filter((n) => !n.hurry).length);
    const times = loop.map((d) => d.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(loop[loop.length - 1].time).toBeCloseTo(10 + step * p.steps, 6);
  });

  it('the question’s last seconds: faster, higher and busier from the next step on', () => {
    const p = TRACKS.question;
    const bar = (hurried: boolean) => {
      const seq = new Sequencer(p, 0);
      seq.setHurry(hurried);
      return { seq, notes: seq.due(stepSec(seq.bpm) * 16 - 0.0001) };
    };
    const calm = bar(false);
    const fast = bar(true);
    expect(calm.notes.every((d) => d.shift === 0 && !d.note.hurry)).toBe(true);
    expect(fast.notes.length).toBeGreaterThan(calm.notes.length);
    expect(fast.notes.some((d) => d.note.hurry)).toBe(true);
    expect(fast.notes.every((d) => d.shift === HURRY.transpose)).toBe(true);
    expect(fast.notes[0].step).toBeCloseTo(stepSec(p.bpm * HURRY.tempo), 6);
    // from the next step on: a step already handed out keeps its time
    const seq = new Sequencer(p, 0);
    seq.due(stepSec(p.bpm) * 4 - 0.0001);
    const at = seq.nextTime;
    seq.setHurry(true);
    expect(seq.due(at + 0.0001)[0].time).toBe(at);
    seq.setHurry(false);
    expect(seq.bpm).toBe(p.bpm);
  });

  it('a clock that fell behind (a hidden tab) starts again from now, not with a pile of late notes', () => {
    const seq = new Sequencer(TRACKS.board, 0);
    seq.catchUp(30);
    const notes = seq.due(30.2);
    expect(notes.length).toBeGreaterThan(0);
    expect(Math.min(...notes.map((d) => d.time))).toBeGreaterThanOrEqual(30);
  });

  it('a loop is seamless: its second time round is the first moved by one loop', () => {
    for (const p of Object.values(TRACKS)) {
      const seq = new Sequencer(p, 0);
      const len = stepSec(p.bpm) * p.steps;
      const one = seq.due(len - 1e-6);
      const two = seq.due(2 * len - 1e-6);
      expect(two.length).toBe(one.length);
      two.forEach((d, i) => {
        expect(d.note).toBe(one[i].note);
        expect(d.time - one[i].time).toBeCloseTo(len, 6);
      });
    }
  });
});
