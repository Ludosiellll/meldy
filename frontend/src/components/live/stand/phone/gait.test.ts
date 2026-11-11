import { describe, expect, it } from 'vitest';
import { PoseMachine, type BakedClip, type Pose } from '../../../../lib/live/three/pose';
import { gaitStep, newGait, RUN_REST_S } from './gait';

const FRAME = 1 / 60;

describe('gait: a run on the phone', () => {
  it('starts with the first step and survives frames without one', () => {
    const g = newGait();
    expect(gaitStep(g, false, FRAME)).toBe(false);
    expect(gaitStep(g, true, FRAME)).toBe(true);
    // a command a frame late, a duplicated frame: still running
    for (let i = 0; i < 5; i++) expect(gaitStep(g, false, FRAME)).toBe(true);
    expect(gaitStep(g, true, FRAME)).toBe(true);
    expect(g.still).toBe(0);
  });

  it('ends after a short stillness, within an eighth of a second', () => {
    const g = newGait();
    gaitStep(g, true, FRAME);
    let frames = 0;
    while (gaitStep(g, false, FRAME)) frames += 1;
    expect(frames * FRAME).toBeLessThan(RUN_REST_S + FRAME);
    expect((frames + 1) * FRAME).toBeGreaterThanOrEqual(RUN_REST_S - 1e-9);
    expect(RUN_REST_S).toBeGreaterThan(0.1); // two server ticks
    expect(RUN_REST_S).toBeLessThan(0.2);
  });

  it('keeps the run’s clip going when steps come on some frames only (the owner’s video: the legs never ran)', () => {
    const clip = (row: number, duration: number): BakedClip => ({ row, rows: Math.ceil(duration * 30) + 1, duration });
    const clips = Object.fromEntries((['idle', 'run', 'jump', 'fall', 'cheer', 'hit', 'lie', 'wave'] as Pose[]).map((p, i) => [p, clip(i * 100, 0.8)])) as Record<Pose, BakedClip>;
    // one step every fourth frame, as the own character moved before 11.11
    const told = (useGait: boolean) => {
      const machine = new PoseMachine(clips);
      const g = newGait();
      let starts = 0;
      let longest = 0;
      for (let i = 0; i < 120; i++) {
        const moving = i % 4 === 0;
        const run = useGait ? gaitStep(g, moving, FRAME) : moving;
        const before = machine.pose;
        machine.set(run ? 'run' : 'idle');
        if (machine.pose === 'run' && before !== 'run') starts += 1;
        machine.step(FRAME);
        if (machine.pose === 'run') longest = Math.max(longest, machine.t);
      }
      return { starts, longest };
    };
    // from one frame alone the clip started again 30 times in two seconds and never got past its first frame
    expect(told(false)).toEqual({ starts: 30, longest: FRAME });
    // with the gait it starts once and runs on
    const now = told(true);
    expect(now.starts).toBe(1);
    expect(now.longest).toBeGreaterThan(1.9);
  });
});
