import { describe, expect, it } from 'vitest';
import { CHAPTERS3, OVERLAP, SCENES3, TOTAL3, activeScenes3, chapterAt3, scene3 } from './timeline3';
import { SAY } from '../home3/copy3';
import { END_CTA } from './scenes/End';

describe('the reel v3 timeline', () => {
  it('runs its scenes one after another, each overlapping the next by OVERLAP, from 0 to TOTAL3', () => {
    expect(SCENES3[0].from).toBe(0);
    expect(SCENES3[SCENES3.length - 1].to).toBe(TOTAL3);
    for (let i = 1; i < SCENES3.length; i += 1) expect(SCENES3[i].from).toBe(SCENES3[i - 1].to - OVERLAP);
    expect(TOTAL3).toBeGreaterThanOrEqual(66000);
    // 83 s since the game in class came in after the group (owner, 21.10); the constructor keeps the longest part.
    expect(TOTAL3).toBeLessThanOrEqual(84000);
  });

  it('gives the constructor the longest chapter', () => {
    const lengths = CHAPTERS3.map((chapter) => chapter.to - chapter.from);
    const builder = CHAPTERS3.findIndex((chapter) => chapter.id === 'builder');
    expect(Math.max(...lengths)).toBe(lengths[builder]);
    expect(lengths[builder]).toBeGreaterThanOrEqual(25000);
  });

  it('covers the whole reel with chapters and knows the chapter at any time', () => {
    expect(CHAPTERS3[0].from).toBe(0);
    for (let i = 1; i < CHAPTERS3.length; i += 1) expect(CHAPTERS3[i].from).toBe(CHAPTERS3[i - 1].to);
    expect(chapterAt3(0)).toBe(0);
    expect(chapterAt3(scene3('ticket').from + 10)).toBe(CHAPTERS3.findIndex((chapter) => chapter.id === 'ticket'));
    expect(chapterAt3(TOTAL3 - 1)).toBe(CHAPTERS3.length - 1);
  });

  it('mounts the next scene ahead, hidden, and at most three scenes at once', () => {
    expect(activeScenes3(scene3('file').from - 500)).toContain('file');
    for (let t = 0; t < TOTAL3; t += 100) expect(activeScenes3(t).length).toBeLessThanOrEqual(3);
  });

  it('has a sentence for every scene but the end card, and the end card’s button inside each stage', () => {
    for (const scene of SCENES3) if (scene.id !== 'end') expect(SAY[scene.id as keyof typeof SAY], scene.id).toBeTruthy();
    expect(END_CTA.wide.x + END_CTA.wide.w).toBeLessThanOrEqual(1600);
    expect(END_CTA.tall.x + END_CTA.tall.w).toBeLessThanOrEqual(400);
  });

  it('puts the game in class right after the group, 6 to 8 seconds long, with its own chapter', () => {
    const order = SCENES3.map((scene) => scene.id);
    expect(order.indexOf('game')).toBe(order.indexOf('group') + 1);
    const game = scene3('game');
    expect(game.to - game.from).toBeGreaterThanOrEqual(6000);
    expect(game.to - game.from).toBeLessThanOrEqual(8000);
    const chapters = CHAPTERS3.map((chapter) => chapter.id);
    expect(chapters.indexOf('game')).toBe(chapters.indexOf('group') + 1);
    expect(chapterAt3(game.from + 500)).toBe(chapters.indexOf('game'));
  });
});
