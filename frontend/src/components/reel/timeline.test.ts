import { describe, expect, it } from 'vitest';
import { cameraAt } from './paper/camera';
import { CAMERA_KEYS, PUSH_IN } from './paper/layout';
import { activeScenes, CHAPTERS, chapterAt, CUT, POSTER_AT, SCENES, sceneWindow, TOTAL } from './timeline';

describe('the reel timeline', () => {
  it('is one sheet of paper and an end card, cut once at the end of the sheet', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(['paper', 'end']);
    expect(sceneWindow('paper')).toEqual({ id: 'paper', from: 0, to: CUT });
    expect(sceneWindow('end')).toEqual({ id: 'end', from: CUT, to: TOTAL });
    expect(TOTAL).toBe(48000);
  });

  it('puts the sheet on the stage from the start and the end card only after the cut', () => {
    expect(activeScenes(0)).toEqual(['paper']);
    expect(activeScenes(CUT - 100)).toEqual(['paper', 'end']);
    expect(activeScenes(CUT)).toEqual(['end']);
    expect(activeScenes(TOTAL - 1)).toEqual(['end']);
  });

  it('has seven chapters in order, each starting and arriving inside its own stretch of the sheet', () => {
    expect(CHAPTERS.map((chapter) => chapter.number)).toEqual(['01', '02', '03', '04', '05', '06', '07']);
    expect(CHAPTERS.map((chapter) => chapter.label)).toEqual([
      'Список кафедры',
      'Лекции',
      'Шпаргалка',
      'Билет вслух',
      'Разные дни',
      'Группе',
      'Итог',
    ]);
    expect(new Set(CHAPTERS.map((chapter) => chapter.id)).size).toBe(7);
    CHAPTERS.forEach((chapter, index) => {
      const next = CHAPTERS[index + 1]?.from ?? TOTAL;
      expect(chapter.at).toBeGreaterThanOrEqual(chapter.from);
      expect(chapter.at).toBeLessThan(next);
    });
    expect(chapterAt(0).id).toBe('tickets');
    expect(chapterAt(CUT + 10).id).toBe('end');
  });

  it('keeps the poster on the answer, inside the sheet', () => {
    expect(POSTER_AT).toBeGreaterThan(CHAPTERS[3].from);
    expect(POSTER_AT).toBeLessThan(CUT);
  });
});

describe('the camera over the sheet', () => {
  it('stands at each station for the chapter it shows, and pushes in slowly', () => {
    for (const [t, centre] of CAMERA_KEYS) {
      const cam = cameraAt(t);
      // The point of the sheet the camera looks at lands in the middle of the stage.
      expect((960 - cam.x) / cam.scale).toBeCloseTo(centre, 0);
    }
    expect(cameraAt(0).scale).toBeCloseTo(1, 5);
    expect(cameraAt(CUT).scale).toBeCloseTo(1 + PUSH_IN, 5);
  });

  it('moves without jumps: no frame moves the sheet by more than a pan allows', () => {
    let previous = cameraAt(0);
    let largest = 0;
    for (let t = 1000 / 30; t < CUT; t += 1000 / 30) {
      const cam = cameraAt(t);
      largest = Math.max(largest, Math.abs(cam.x - previous.x));
      previous = cam;
    }
    // The longest pans cover about 2000 px in 1.8 s; ease-in-out peaks at three times its average speed:
    // about 115 px a frame at 30 frames a second.
    expect(largest).toBeLessThan(130);
  });
});
