import { describe, expect, it } from 'vitest';
import type { Boss, BossPhase } from '../../../lib/live/three';
import { F_AWAY, F_CAUGHT, F_GHOST, KIND_NPC, KIND_PLAYER } from '../../../lib/live/move/protocol';
import { Hunter, LUNGE_EVERY, LUNGE_RANGE, isPrey, nearestHunter, nearestPrey } from './hunt';

/** A boss that keeps what it was told; a blow lasts 0.6 s of its own update. */
function fakeBoss() {
  const log: string[] = [];
  let phase: BossPhase = 'idle';
  let blow = -1;
  const boss = {
    kind: 'clock' as const,
    stompImpactS: 0.85,
    get phase() { return phase; },
    get striking() { return blow >= 0; },
    setPhase(next: BossPhase) { phase = next; if (next !== 'chase') blow = -1; log.push(`phase ${next}`); },
    setGait(gait: number) { log.push(`gait ${gait}`); },
    strike(landed?: boolean) { phase = 'chase'; blow = 0; log.push(landed ? 'blow at once' : 'lunge'); },
    setPosition() {},
    setFacing(rad: number) { log.push(`faces ${rad.toFixed(2)}`); },
    update(dt: number) { if (blow >= 0) { blow += dt; if (blow >= 0.6) blow = -1; } },
    dispose() {},
  };
  return { boss: boss as Boss, log };
}

const FRAME = 1 / 60;
/** Runs `seconds` of frames: the hunter goes right at `speed` units a second, the prey is `prey` away. */
function run(h: Hunter, boss: Boss, seconds: number, speed: number, prey: number | null) {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) {
    h.frame(h.x + speed * FRAME, h.y, FRAME, prey);
    boss.update(FRAME);
  }
}

describe('a hunter of «Убеги от Дедлайна»', () => {
  it('takes its own way of running and runs while the room moves it', () => {
    const { boss, log } = fakeBoss();
    const h = new Hunter(boss, 2, 100, 100);
    expect(log).toEqual(['gait 2']);
    run(h, boss, 0.5, 190, null);
    expect(boss.phase).toBe('chase');
    expect(log.filter((line) => line.startsWith('phase'))).toEqual(['phase chase']);
    expect(log).toContain('faces 1.57'); // to the right: +x
    expect(log.some((line) => line === 'lunge' || line === 'blow at once')).toBe(false);
  });

  it('lunges at a character within its reach, and not again before the pause between blows is over', () => {
    const { boss, log } = fakeBoss();
    const h = new Hunter(boss, 0, 0, 0);
    run(h, boss, 0.3, 190, LUNGE_RANGE + 40);
    expect(log).not.toContain('lunge');
    run(h, boss, LUNGE_EVERY - 0.2, 190, LUNGE_RANGE - 10);
    expect(log.filter((line) => line === 'lunge')).toHaveLength(1);
    run(h, boss, 0.5, 190, LUNGE_RANGE - 10);
    expect(log.filter((line) => line === 'lunge')).toHaveLength(2);
  });

  it('a catch brings the blow down at once; held still after it, the hunter rings over its catch and then runs on', () => {
    const { boss, log } = fakeBoss();
    const h = new Hunter(boss, 0, 0, 0);
    run(h, boss, 0.3, 190, 300);
    h.caught();
    expect(log[log.length - 1]).toBe('blow at once');
    // the room holds it for a second: the blow is played out first, then it rings («roar»)
    run(h, boss, 0.4, 0, null);
    expect(boss.phase).toBe('chase');
    run(h, boss, 0.6, 0, null);
    expect(boss.phase).toBe('roar');
    // it moves again: back to the run, and it stays the run (it used to keep «roar» to the end of the chase)
    run(h, boss, 1, 190, 400);
    expect(boss.phase).toBe('chase');
    expect(log.filter((line) => line === 'phase roar')).toHaveLength(1);
  });

  it('a catch while a lunge is in the air does not start the blow over; a lunge does not follow a catch at once', () => {
    const { boss, log } = fakeBoss();
    const h = new Hunter(boss, 1, 0, 0);
    run(h, boss, 0.2, 190, LUNGE_RANGE - 5);
    expect(log.filter((line) => line === 'lunge')).toHaveLength(1);
    h.caught();
    expect(log).not.toContain('blow at once');
    run(h, boss, 1, 190, LUNGE_RANGE - 5);
    expect(log.filter((line) => line === 'lunge')).toHaveLength(1);
  });

  it('prey is a player on the floor that is neither caught nor a ghost; the nearest one and the nearest hunter', () => {
    expect([isPrey(KIND_PLAYER), isPrey(KIND_NPC), isPrey(KIND_PLAYER | F_GHOST), isPrey(KIND_PLAYER | F_CAUGHT), isPrey(KIND_PLAYER | F_AWAY)]).toEqual([true, false, false, false, false]);
    const entities = [
      { x: 30, y: 40, flags: KIND_PLAYER | F_GHOST },
      { x: 60, y: 80, flags: KIND_PLAYER },
      { x: 10, y: 0, flags: KIND_NPC },
    ];
    expect(nearestPrey(0, 0, entities)).toBe(100);
    expect(nearestPrey(0, 0, [entities[0], entities[2]])).toBeNull();
    const a = new Hunter(fakeBoss().boss, 0, 0, 0);
    const b = new Hunter(fakeBoss().boss, 1, 500, 0);
    expect([nearestHunter(400, 10, [a, b]), nearestHunter(100, 10, [a, b]), nearestHunter(0, 0, [])]).toEqual([b, a, null]);
  });
});
