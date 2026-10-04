import { describe, expect, it } from 'vitest';
import { ReelClock } from './clock';
import { SHEET_ROWS, SHEET_TOTALS, TICKET } from './content';
import { MARK_AT } from './scenes/Tickets';
import { CHAPTERS, POSTER_AT, SCENES, TOTAL, activeScenes, chapterAt, ease, plural, rng, seg, timecode } from './timeline';

describe('the reel timeline', () => {
  it('plays the scenes in story order, each overlapping the next for its transition, within the reel', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(['intro', 'chaos', 'brand', 'tour', 'tickets', 'oral', 'review', 'ready', 'outro']);
    expect(SCENES[0].from).toBe(0);
    expect(SCENES[SCENES.length - 1].to).toBe(TOTAL);
    for (let i = 1; i < SCENES.length; i += 1) {
      expect(SCENES[i].from).toBeGreaterThan(SCENES[i - 1].from);
      expect(SCENES[i].from).toBeLessThan(SCENES[i - 1].to);
    }
  });

  it('mounts at most three scenes at a time, ahead of their start', () => {
    for (let t = 0; t < TOTAL; t += 50) expect(activeScenes(t).length).toBeLessThanOrEqual(3);
    expect(activeScenes(0)).toEqual(['intro']);
    expect(activeScenes(2700)).toEqual(['intro', 'chaos']);
    expect(activeScenes(TOTAL - 1)).toEqual(['outro']);
  });

  it('names the chapters 01–04 and knows which one plays', () => {
    expect(CHAPTERS.map((chapter) => `${chapter.number} ${chapter.label}`)).toEqual(['01 Билеты', '02 Ответ вслух', '03 Повторение', '04 Готовность']);
    expect(chapterAt(1000)).toBeNull();
    expect(chapterAt(POSTER_AT)?.label).toBe('Билеты');
    expect(chapterAt(CHAPTERS[2].at + 10)?.label).toBe('Повторение');
    expect(chapterAt(TOTAL - 10)).toBeNull();
  });

  it('writes the corner timecode in frames of 30 per second', () => {
    expect(timecode(0)).toBe('00:00:00:00');
    expect(timecode(12_250)).toBe('00:00:12:07');
    expect(timecode(65_999)).toBe('00:01:05:29');
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

describe('the reel content', () => {
  it('uses the stage list of the app: 40 questions, 24 «есть», 7 «частично», 9 «нет»', () => {
    expect(SHEET_ROWS).toHaveLength(40);
    expect(SHEET_TOTALS).toEqual({ ok: 24, half: 7, no: 9 });
  });

  it('marks the rows of the ticket sheet in order, every one while the chapter plays', () => {
    for (let i = 1; i < MARK_AT.length; i += 1) expect(MARK_AT[i]).toBeGreaterThanOrEqual(MARK_AT[i - 1]);
    const chapter = SCENES.find((scene) => scene.id === 'tickets')!;
    expect(MARK_AT[MARK_AT.length - 1]).toBeLessThan(chapter.to - chapter.from - 1500);
  });

  it('names every point of the ticket but the missed one during the answer', () => {
    const words = TICKET.answer.split(' ');
    const named = Object.keys(TICKET.namedAfterWord).map(Number);
    expect(named).not.toContain(TICKET.missed);
    expect(named.sort()).toEqual([1, 2, 3, 4]);
    for (const index of Object.values(TICKET.namedAfterWord)) expect(index).toBeLessThan(words.length);
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
