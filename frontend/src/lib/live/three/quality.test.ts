import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS, QualityGovernor } from './quality';

function feed(g: QualityGovernor, ms: number, frames: number): number {
  let changes = 0;
  for (let i = 0; i < frames; i++) if (g.push(ms)) changes++;
  return changes;
}

describe('adaptive quality', () => {
  it('drops the outlines first, then the effects, and only then the resolution', () => {
    expect(QUALITY_LEVELS[0]).toEqual({ outlines: true, effects: true, scale: 1 });
    expect(QUALITY_LEVELS[1]).toEqual({ outlines: false, effects: true, scale: 1 });
    expect(QUALITY_LEVELS[2]).toEqual({ outlines: false, effects: false, scale: 1 });
    for (let i = 3; i < QUALITY_LEVELS.length; i++) expect(QUALITY_LEVELS[i].scale).toBeLessThan(QUALITY_LEVELS[i - 1].scale);
  });

  it('stays put at 60 fps and with a missed frame now and then', () => {
    const g = new QualityGovernor();
    expect(feed(g, 16.7, 600)).toBe(0);
    for (let i = 0; i < 600; i++) g.push(i % 30 === 0 ? 33 : 16.7);
    expect(g.level).toBe(0);
  });

  it('steps down while frames run late, one step a second at most', () => {
    const g = new QualityGovernor();
    feed(g, 33, 45); // the first window
    expect(g.level).toBe(1);
    feed(g, 33, 20);
    expect(g.level).toBe(1);
    feed(g, 33, 45);
    expect(g.level).toBe(2);
    feed(g, 33, 1000);
    expect(g.level).toBe(QUALITY_LEVELS.length - 1);
  });

  it('steps back up after a calm stretch, waiting twice as long after each failure', () => {
    const g = new QualityGovernor();
    feed(g, 30, 45);
    expect(g.level).toBe(1);
    // 6 s of calm at 60 fps
    feed(g, 16.7, 6000 / 16.7 + 50);
    expect(g.level).toBe(0);
    feed(g, 30, 45);
    expect(g.level).toBe(1);
    // the next try waits 12 s: not after 7 s
    feed(g, 16.7, 7000 / 16.7);
    expect(g.level).toBe(1);
    feed(g, 16.7, 6000 / 16.7);
    expect(g.level).toBe(0);
  });

  it('can be pinned', () => {
    const g = new QualityGovernor();
    g.force(3);
    expect(g.level).toBe(3);
    g.force(99);
    expect(g.level).toBe(QUALITY_LEVELS.length - 1);
  });
});

describe('the kit stays out of the main bundle', () => {
  it('imports three.js only in internal/ and dev/ (the chunk loadKit fetches)', () => {
    const sources = import.meta.glob(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toContain('./index.ts');
    for (const [file, src] of Object.entries(sources)) {
      expect(src, file).not.toMatch(/from 'three/);
      expect(src, file).not.toMatch(/import\(['"]three/);
    }
    expect(sources['./index.ts']).not.toMatch(/from '\.\/internal/);
    expect(sources['./index.ts']).toMatch(/import\('\.\/internal\/game3d'\)/);
  });
});
