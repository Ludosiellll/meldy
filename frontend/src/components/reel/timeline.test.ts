import { describe, expect, it } from 'vitest';
import { ReelClock } from './clock';
import { CHAPTERS, POSTER_AT, SCENES, TOTAL, activeScenes, chapterAt, ease, plural, rng, sceneWindow, seg } from './timeline';
import { END_AT, TAP_WRONG } from './scenes/Session';

describe('the reel timeline', () => {
  it('plays the scenes in story order, each overlapping the next for its transition, within the reel', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(['intro', 'chaos', 'brand', 'questions', 'plan', 'session', 'sheet', 'group', 'outro']);
    expect(SCENES[0].from).toBe(0);
    expect(SCENES[SCENES.length - 1].to).toBe(TOTAL);
    for (let i = 1; i < SCENES.length; i += 1) {
      expect(SCENES[i].from).toBeGreaterThan(SCENES[i - 1].from);
      expect(SCENES[i].from).toBeLessThan(SCENES[i - 1].to);
    }
  });

  it('runs about 48 seconds, so it has room to breathe', () => {
    expect(TOTAL).toBeGreaterThanOrEqual(46000);
    expect(TOTAL).toBeLessThanOrEqual(48000);
    // Each chapter is on the stage for at least six seconds.
    for (const chapter of CHAPTERS) {
      const scene = sceneWindow(chapter.id);
      expect(scene.to - scene.from).toBeGreaterThanOrEqual(6000);
    }
  });

  it('mounts at most three scenes at a time, ahead of their start', () => {
    for (let t = 0; t < TOTAL; t += 50) expect(activeScenes(t).length).toBeLessThanOrEqual(3);
    // The chaos scene is put on the stage with the intro, hidden until 3 s.
    expect(activeScenes(0)).toEqual(['intro', 'chaos']);
    expect(activeScenes(2700)).toEqual(['intro', 'chaos']);
    expect(activeScenes(6400)).toEqual(['chaos', 'brand']);
    expect(activeScenes(TOTAL - 1)).toEqual(['outro']);
    // A chapter is built well before it shows, not on the frame before it.
    for (const chapter of CHAPTERS) expect(sceneWindow(chapter.id).lead ?? 0).toBeGreaterThanOrEqual(1000);
  });

  it('keeps the group under the ending until its iris covers the stage', () => {
    // Outro.tsx opens a circle over 680 ms; nothing of the dark stage may show around it.
    expect(sceneWindow('group').to).toBeGreaterThanOrEqual(sceneWindow('outro').from + 680);
  });

  it('names the chapters 01–05 and knows which one plays', () => {
    expect(CHAPTERS.map((chapter) => `${chapter.number} ${chapter.label}`)).toEqual(['01 Вопросы', '02 План', '03 Занятие', '04 Шпаргалка', '05 Группа']);
    expect(chapterAt(1000)).toBeNull();
    expect(chapterAt(CHAPTERS[0].at + 10)?.label).toBe('Вопросы');
    expect(chapterAt(CHAPTERS[3].at + 10)?.label).toBe('Шпаргалка');
    expect(chapterAt(CHAPTERS[4].at + 10)?.label).toBe('Группа');
    expect(chapterAt(TOTAL - 10)).toBeNull();
  });

  it('takes its poster from the «занятие»: the figure and a wrong answer with the key from the file, before the session runs on', () => {
    expect(chapterAt(POSTER_AT)?.label).toBe('Занятие');
    const session = sceneWindow('session');
    expect(POSTER_AT - session.from).toBeGreaterThan(TAP_WRONG + 500);
    expect(POSTER_AT - session.from).toBeLessThan(END_AT - 600);
  });

  it('eases like the CSS curves it stands for', () => {
    expect(ease.brand(0)).toBe(0);
    expect(ease.brand(1)).toBe(1);
    // cubic-bezier(.16, 1, .3, 1) is past 90 % of the way at 40 % of the time.
    expect(ease.brand(0.4)).toBeGreaterThan(0.9);
    expect(ease.inOut(0.5)).toBeCloseTo(0.5, 5);
    expect(ease.back(0.7)).toBeGreaterThan(1);
    expect(seg(50, 100, 200)).toBe(0);
    expect(seg(200, 100, 200)).toBe(0.5);
    expect(seg(400, 100, 200)).toBe(1);
  });

  it('draws the same particles for the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(43)()).not.toBe(rng(42)());
  });

  it('declines Russian nouns after numbers', () => {
    const forms = ['вопрос', 'вопроса', 'вопросов'] as const;
    expect([1, 2, 5, 11, 21, 24, 40].map((n) => plural(n, forms))).toEqual(['вопрос', 'вопроса', 'вопросов', 'вопросов', 'вопрос', 'вопроса', 'вопросов']);
  });
});

describe('ReelClock', () => {
  function manual() {
    let now = 0;
    const queue = new Map<number, (time: number) => void>();
    let next = 1;
    const scheduler = {
      request: (callback: (time: number) => void) => {
        queue.set(next, callback);
        return next++;
      },
      cancel: (id: number) => {
        queue.delete(id);
      },
      now: () => now,
    };
    const step = (ms: number) => {
      now += ms;
      const callbacks = Array.from(queue.values());
      queue.clear();
      for (const callback of callbacks) callback(now);
    };
    return { scheduler, step };
  }

  it('advances with frames while playing, loops at the end, and stops on pause', () => {
    const { scheduler, step } = manual();
    const clock = new ReelClock(1000, scheduler);
    const seen: number[] = [];
    clock.addFrame((t) => seen.push(t));
    expect(seen).toEqual([0]);
    clock.play();
    step(16);
    step(16);
    expect(clock.time).toBe(32);
    clock.seek(990);
    step(16);
    expect(clock.time).toBe(6);
    clock.pause();
    step(16);
    expect(clock.time).toBe(6);
    expect(clock.isPlaying).toBe(false);
  });

  it('moves one short step after a long pause between frames, never a jump', () => {
    const { scheduler, step } = manual();
    const clock = new ReelClock(10_000, scheduler);
    clock.play();
    step(5000);
    expect(clock.time).toBe(64);
  });

  it('tells watchers about play, pause and seek, and clamps seeks to the reel', () => {
    const { scheduler } = manual();
    const clock = new ReelClock(1000, scheduler);
    let calls = 0;
    clock.watch(() => {
      calls += 1;
    });
    clock.play();
    clock.seek(5000);
    clock.pause();
    expect(calls).toBe(3);
    expect(clock.time).toBe(1000);
  });
});
