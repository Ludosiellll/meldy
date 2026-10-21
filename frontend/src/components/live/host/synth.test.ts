/**
 * The rendered instruments and effects (synth.ts): bounded, silent at both ends (no click where a buffer starts or
 * stops), the same every time, and the pitched instruments in tune.
 */
import { describe, expect, it } from 'vitest';
import { LENGTH, NOTE_LENGTH, hz, renderNote, renderRoom, renderSamples, type BufferName, type NoteVoice } from './synth';

const RATE = 16000;

function peak(data: Float32Array): number {
  let p = 0;
  for (const v of data) p = Math.max(p, Math.abs(v));
  return p;
}

/**
 * Where the spectrum peaks near `f` (cents off it): a Hann-windowed Goertzel over half a second after the attack,
 * on a 2-cent grid ±60 cents. The bars' partials are inharmonic, so the fundamental is looked for, not a period.
 */
function centsOff(data: Float32Array, rate: number, f: number): number {
  const from = Math.floor(rate * 0.02);
  const n = Math.min(Math.floor(rate * 0.5), data.length - from);
  let best = 0;
  let bestP = -1;
  for (let c = -60; c <= 60; c += 2) {
    const w = (2 * Math.PI * f * 2 ** (c / 1200)) / rate;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i += 1) {
      const v = data[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > bestP) {
      bestP = p;
      best = c;
    }
  }
  return best;
}

describe('the rendered sounds', () => {
  it('every named sound is as long as listed, audible, never over full scale, and silent at both ends', () => {
    for (const name of Object.keys(LENGTH) as BufferName[]) {
      const data = renderSamples(name, RATE);
      expect(data.length, name).toBe(Math.floor(RATE * LENGTH[name]));
      expect(peak(data), name).toBeGreaterThan(0.05);
      expect(peak(data), name).toBeLessThanOrEqual(1);
      expect(Math.abs(data[0]), name).toBeLessThan(0.01);
      expect(Math.abs(data[data.length - 1]), name).toBeLessThan(0.01);
    }
  });

  it('every instrument’s note is bounded and silent at both ends', () => {
    for (const voice of Object.keys(NOTE_LENGTH) as NoteVoice[])
      for (const midi of [36, 60, 84]) {
        const data = renderNote(voice, midi, RATE);
        expect(peak(data), `${voice} ${midi}`).toBeGreaterThan(0.05);
        expect(peak(data), `${voice} ${midi}`).toBeLessThanOrEqual(1);
        expect(Math.abs(data[0])).toBeLessThan(0.01);
        expect(Math.abs(data[data.length - 1])).toBeLessThan(0.01);
      }
  });

  it('the same every time (no Math.random)', () => {
    expect(renderSamples('rumble', RATE)).toEqual(renderSamples('rumble', RATE));
    expect(renderNote('pluck', 69, RATE)).toEqual(renderNote('pluck', 69, RATE));
  });

  it('the pitched instruments are in tune (their fundamental within 15 cents)', () => {
    const rate = 24000;
    for (const voice of ['pluck', 'keys', 'mallet', 'bell', 'bass'] as const)
      for (const midi of voice === 'bass' ? [38, 45] : [62, 69, 77]) {
        const c = centsOff(renderNote(voice, midi, rate), rate, hz(midi));
        expect(Math.abs(c), `${voice} ${midi}: ${c} cents`).toBeLessThanOrEqual(15);
      }
  });

  it('the room’s reverb dies away', () => {
    const [l, r] = renderRoom(RATE);
    const rms = (d: Float32Array, a: number, b: number) => Math.sqrt(d.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    const tenth = Math.floor(l.length / 10);
    expect(rms(l, l.length - tenth, l.length)).toBeLessThan(rms(l, 0, tenth) / 100);
    expect(l).not.toEqual(r); // two decorrelated sides: width
  });
});
