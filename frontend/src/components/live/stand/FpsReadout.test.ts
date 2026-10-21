import { describe, expect, it } from 'vitest';
import { fpsWanted, frameNumbers } from './FpsReadout';

describe('the fps readout for a real device', () => {
  it('shows only with ?fps=1', () => {
    expect(fpsWanted('?fps=1')).toBe(true);
    expect(fpsWanted('?pin=1&fps=1')).toBe(true);
    expect(fpsWanted('')).toBe(false);
    expect(fpsWanted('?fps=0')).toBe(false);
  });

  it('frames a second and the slowest 5 % from the intervals', () => {
    const steady = Array.from({ length: 60 }, () => 1000 / 60);
    expect(frameNumbers(steady).fps).toBeCloseTo(60);
    expect(frameNumbers(steady).p95).toBeCloseTo(16.67, 1);
    const hitch = [...Array.from({ length: 37 }, () => 16), 100, 100, 100];
    expect(frameNumbers(hitch).p95).toBe(100);
    expect(frameNumbers([])).toEqual({ fps: 0, p95: 0 });
  });
});
