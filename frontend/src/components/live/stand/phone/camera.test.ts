import { describe, expect, it } from 'vitest';
import { DEFAULT_TOPS, FollowCam, screenX, screenY, spanFor, TILT, type Screen } from './camera';

// mode A's floor (MODE_STAND §3: tiles of 60 from (20, 160), 26 × 12), the stage in the middle, the four zones
const FLOOR = { x0: 20, y0: 160, x1: 1580, y1: 880 };
const STAGE = { x: 800, y: 520 };
const ZONES = [
  { x0: 80, y0: 220, x1: 680, y1: 460 },
  { x0: 920, y0: 220, x1: 1520, y1: 460 },
  { x0: 80, y0: 580, x1: 680, y1: 820 },
  { x0: 920, y0: 580, x1: 1520, y1: 820 },
];
// a 390 × 844 phone: the question card down to 200 px, the stick and the small map from 170 px above the bottom
const PHONE: Screen = { width: 390, height: 844, top: 200, bottom: 170 };
const DT = 1 / 60;

function cam() {
  return new FollowCam(FLOOR, DEFAULT_TOPS, STAGE, ZONES);
}

/** Where a map point lands on the screen, CSS px from the top left, for this frame's shot. */
function onScreen(c: FollowCam, shot: ReturnType<FollowCam['update']>, s: Screen, x: number, y: number, z = 0) {
  return {
    x: s.width / 2 + screenX(x, y, z, shot.target.x, c.aimY, shot.fov, s.height),
    y: s.height / 2 + screenY(y, z, c.aimY, shot.fov, s.height) + shot.shift.y * s.height,
  };
}

function settle(c: FollowCam, hero: { x: number; y: number }, s = PHONE, toBoss = false, seconds = 4) {
  let shot = c.update(DT, hero, s, toBoss);
  for (let i = 0; i < seconds * 60; i++) shot = c.update(DT, hero, s, toBoss);
  return shot;
}

describe('the phone camera', () => {
  it('looks at the arena from the front as steeply as the projector', () => {
    const shot = cam().update(DT, { x: 500, y: 400 }, PHONE);
    const back = shot.eye.y - shot.target.y;
    const up = shot.eye.z - shot.target.z;
    expect(back).toBeGreaterThan(0);
    expect((Math.atan2(up, back) * 180) / Math.PI).toBeCloseTo(TILT, 5);
    expect(shot.eye.x).toBe(shot.target.x);
  });

  it('shows a third to a half of the arena across a phone', () => {
    const span = spanFor(390);
    expect(span).toBeGreaterThan(1560 / 3);
    expect(span).toBeLessThan(1560 / 2);
    const c = cam();
    const shot = settle(c, { x: 800, y: c.aimY });
    // the screen's edges at the aim row are span/2 to either side
    expect(onScreen(c, shot, PHONE, shot.target.x + span / 2, c.aimY).x).toBeCloseTo(390, 0);
    expect(onScreen(c, shot, PHONE, shot.target.x - span / 2, c.aimY).x).toBeCloseTo(0, 0);
  });

  it('holds the whole depth between the cards and never moves up or down', () => {
    const c = cam();
    // a two-line question with its four answers
    const S: Screen = { ...PHONE, top: 180 };
    const shots = [{ x: 300, y: 250 }, { x: 1300, y: 850 }, { x: 800, y: 700 }, { x: 60, y: 180 }].map((h) => {
      const s = settle(c, h, S);
      return { ty: s.target.y, ez: s.eye.z, shift: s.shift.y, shot: { ...s, target: { ...s.target }, shift: { ...s.shift } } };
    });
    for (const s of shots) {
      expect(s.ty).toBe(shots[0].ty);
      expect(s.ez).toBe(shots[0].ez);
      expect(s.shift).toBeCloseTo(shots[0].shift, 6);
    }
    const shot = shots[0].shot;
    const signTop = onScreen(c, shot, S, 800, FLOOR.y0 + 10, DEFAULT_TOPS.sign).y;
    const front = onScreen(c, shot, S, 800, FLOOR.y1 + 25).y;
    expect(signTop).toBeGreaterThanOrEqual(S.top);
    expect(front).toBeLessThanOrEqual(S.height - S.bottom);
    // and it uses the band: the arena is most of it
    expect(front - signTop).toBeGreaterThan(0.85 * (S.height - S.top - S.bottom));
  });

  it('follows a running hero smoothly: no jumps, no overshoot back and forth', () => {
    const c = cam();
    let x = 200;
    let prev = c.update(DT, { x, y: 500 }, PHONE).target.x;
    let steps = 0;
    for (let i = 0; i < 180; i++) {
      x += 300 * DT; // the room's top speed is about 300 units/s
      const now = c.update(DT, { x, y: 500 }, PHONE).target.x;
      const d = now - prev;
      expect(d).toBeGreaterThanOrEqual(-1e-9); // never back
      expect(d).toBeLessThan(12); // never a jump (a running hero moves 5 a frame)
      steps = Math.max(steps, d);
      prev = now;
    }
    expect(steps).toBeGreaterThan(3);
    // stopped: it settles on the hero, a little towards its zone's middle at most
    const shot = settle(c, { x, y: 500 });
    expect(Math.abs(onScreen(c, shot, PHONE, x, 500).x - 195)).toBeLessThan(10);
  });

  it('does not shake when the predicted position jitters by a few units', () => {
    const c = cam();
    settle(c, { x: 760, y: 520 });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let prev = c.update(DT, { x: 760, y: 520 }, PHONE).target.x;
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const now = c.update(DT, { x: 760 + 4 * rnd(), y: 520 + 4 * rnd() }, PHONE).target.x;
      worst = Math.max(worst, Math.abs(now - prev));
      prev = now;
    }
    // under a third of a CSS pixel a frame
    expect(worst * 0.64).toBeLessThan(0.33);
  });

  it('keeps the hero in the picture at every corner of the floor', () => {
    for (const h of [
      { x: 40, y: 180 },
      { x: 1560, y: 180 },
      { x: 40, y: 860 },
      { x: 1560, y: 860 },
    ]) {
      const c = cam();
      const shot = settle(c, h);
      const p = onScreen(c, shot, PHONE, h.x, h.y);
      expect(p.x).toBeGreaterThan(20);
      expect(p.x).toBeLessThan(370);
      expect(p.y).toBeGreaterThan(PHONE.top);
      expect(p.y).toBeLessThan(PHONE.height - PHONE.bottom);
    }
  });

  it('leans towards the boss in the last seconds while the hero stays well inside the picture', () => {
    const hero = { x: 380, y: 560 };
    const c = cam();
    const calm = settle(c, hero).target.x;
    const lean = settle(c, hero, PHONE, true);
    expect(lean.target.x).toBeGreaterThan(calm + 100);
    const p = onScreen(c, lean, PHONE, hero.x, hero.y);
    expect(p.x).toBeGreaterThan(50);
    // and back after
    expect(settle(c, hero).target.x).toBeCloseTo(calm, 0);
  });

  it('slides the picture when the band is too short for the whole depth, keeping the hero in it', () => {
    const tall: Screen = { ...PHONE, top: 430 };
    for (const h of [
      { x: 400, y: 200 },
      { x: 400, y: 860 },
    ]) {
      const c = cam();
      const shot = settle(c, h, tall);
      const p = onScreen(c, shot, tall, h.x, h.y);
      expect(p.y).toBeGreaterThan(tall.top + 60);
      expect(p.y).toBeLessThan(tall.height - tall.bottom);
    }
  });

  it('leans towards the middle of the zone the hero stands on, without a jump at its edge', () => {
    const c = cam();
    // across zone А's right edge (x 680) and back out, slowly
    let prev = settle(c, { x: 760, y: 340 }).target.x;
    for (let x = 760; x > 560; x -= 1) {
      const now = c.update(DT, { x, y: 340 }, PHONE).target.x;
      expect(Math.abs(now - prev)).toBeLessThan(3); // the old switch moved it 90 units at once
      prev = now;
    }
    // standing near the zone's side, the camera sits between the hero and the zone's middle (380)
    const shot = settle(c, { x: 600, y: 340 });
    expect(shot.target.x).toBeLessThan(600 - 50);
    expect(shot.target.x).toBeGreaterThan(380);
  });

  it('follows a respawn far away at once', () => {
    const c = cam();
    settle(c, { x: 200, y: 500 });
    const shot = c.update(DT, { x: 1400, y: 500 }, PHONE);
    expect(Math.abs(onScreen(c, shot, PHONE, 1400, 500).x - 195)).toBeLessThan(80);
  });
});
