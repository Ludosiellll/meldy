import { describe, expect, it } from 'vitest';
import { BAKE_FPS, FADE_S, POSES, POSE_CLIPS, PoseMachine, bakedRows, clipFrame, type BakedClip, type Pose } from './pose';

const DUR: Record<string, number> = { Idle: 1.07, Running_A: 0.8, Jump_Full_Short: 1.17, Jump_Idle: 1.07, Cheer: 1.67, Hit_B: 0.87, Death_A: 0.8, Interact: 1.3 };

function layout(): Record<Pose, BakedClip> {
  const out = {} as Record<Pose, BakedClip>;
  let row = 0;
  for (const p of POSES) {
    const d = DUR[POSE_CLIPS[p].clip];
    out[p] = { row, rows: bakedRows(d), duration: d };
    row += out[p].rows;
  }
  return out;
}

function sample(m: PoseMachine): [number, number, number] {
  const a = new Float32Array(3);
  m.sample(a, 0);
  return [a[0], a[1], a[2]];
}

describe('baked clip frames', () => {
  it('needs one row per 1/30 s plus the end', () => {
    expect(bakedRows(1)).toBe(31);
    expect(bakedRows(0.8)).toBe(25);
    expect(bakedRows(1.07)).toBe(34);
  });

  it('wraps a loop and stops a one-shot on its last frame, never past the rows it has', () => {
    const c: BakedClip = { row: 100, rows: bakedRows(1), duration: 1 };
    expect(clipFrame(c, 0, true)).toBe(100);
    expect(clipFrame(c, 0.5, true)).toBeCloseTo(115);
    expect(clipFrame(c, 1.25, true)).toBeCloseTo(107.5);
    expect(clipFrame(c, 5, false)).toBeLessThan(100 + c.rows - 1);
    expect(clipFrame(c, 5, false)).toBeGreaterThan(100 + c.rows - 1.01);
    expect(clipFrame(c, -1, false)).toBe(100);
    // the frame after the one shown (row + 1) is always a baked row
    for (let t = 0; t < 3; t += 0.013) {
      expect(Math.floor(clipFrame(c, t, true)) + 1).toBeLessThan(100 + c.rows);
      expect(Math.floor(clipFrame(c, t, false)) + 1).toBeLessThan(100 + c.rows);
    }
    expect(BAKE_FPS).toBe(30);
  });
});

describe('the pose machine', () => {
  it('starts idle at its phase and loops', () => {
    const clips = layout();
    const m = new PoseMachine(clips, 0.5);
    expect(m.pose).toBe('idle');
    expect(sample(m)[0]).toBeCloseTo(clips.idle.row + 0.5 * 1.07 * BAKE_FPS, 3);
    m.step(1.07);
    expect(sample(m)[0]).toBeCloseTo(clips.idle.row + 0.5 * 1.07 * BAKE_FPS, 3);
  });

  it('fades from the old clip into the new one over FADE_S', () => {
    const clips = layout();
    const m = new PoseMachine(clips);
    m.set('run');
    let [now, before, w] = sample(m);
    expect(now).toBe(clips.run.row);
    expect(before).toBe(clips.idle.row);
    expect(w).toBeCloseTo(1);
    m.step(FADE_S / 2);
    [now, before, w] = sample(m);
    expect(w).toBeCloseTo(0.5);
    m.step(FADE_S);
    [now, before, w] = sample(m);
    expect(w).toBe(0);
    expect(before).toBe(now);
  });

  it('does not restart the pose already shown', () => {
    const m = new PoseMachine(layout());
    m.set('run');
    m.step(0.3);
    m.set('run');
    expect(m.t).toBeCloseTo(0.3);
  });

  it('plays a hit to its end even when run is asked every frame, then runs', () => {
    const m = new PoseMachine(layout());
    m.set('run');
    m.step(0.2);
    m.set('hit');
    for (let i = 0; i < 40; i++) {
      m.set('run');
      m.step(1 / 60);
      if (i < 50) expect(m.pose === 'hit' || m.t < 0.05).toBe(true);
    }
    expect(m.pose).toBe('hit');
    m.step(0.3);
    expect(m.pose).toBe('run');
  });

  it('goes back to idle after a jump when nothing else was asked', () => {
    const m = new PoseMachine(layout());
    m.set('jump');
    m.step(1.2);
    expect(m.pose).toBe('idle');
  });

  it('lets a fall cut a hit short: the floor is gone', () => {
    const m = new PoseMachine(layout());
    m.set('hit');
    m.step(0.1);
    m.set('fall');
    expect(m.pose).toBe('fall');
  });

  it('keeps lie on its last frame until another pose', () => {
    const clips = layout();
    const m = new PoseMachine(clips);
    m.set('lie');
    m.step(5);
    expect(m.pose).toBe('lie');
    const [f] = sample(m);
    expect(f).toBeGreaterThan(clips.lie.row + clips.lie.rows - 1.01);
    m.set('lie');
    expect(m.t).toBe(5);
    m.set('idle');
    expect(m.pose).toBe('idle');
  });

  it('ignores a step of zero, negative or NaN seconds', () => {
    const m = new PoseMachine(layout());
    m.step(0);
    m.step(-1);
    m.step(Number.NaN);
    expect(m.t).toBe(0);
  });
});
