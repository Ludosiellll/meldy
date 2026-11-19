import { beforeEach, describe, expect, it } from 'vitest';
import { aiPointsOn, saveAiPoints, savedAiPoints, setAiPointsOn } from './aiPoints';
import { pointSource } from './oralPersistence';
import { DEMO_RUBRIC, demoRubricResponse } from './testing/fixtures';

const EXAM = 'e-1';
const ai = () =>
  demoRubricResponse({ rubric_id: null, saved: false, rubric: { ...DEMO_RUBRIC, materials: [], origin: 'ai', points: DEMO_RUBRIC.points.map((point) => ({ ...point, source_ids: [] })) } });

describe('aiPoints: the model’s points of an exam without lectures, kept on this device', () => {
  beforeEach(() => window.localStorage.clear());

  it('the choice is the exam’s own', () => {
    expect(aiPointsOn(EXAM)).toBe(false);
    setAiPointsOn(EXAM);
    expect(aiPointsOn(EXAM)).toBe(true);
    expect(aiPointsOn('e-2')).toBe(false);
    setAiPointsOn(EXAM, false);
    expect(aiPointsOn(EXAM)).toBe(false);
  });

  it('keeps only points the model wrote, by question, and reads them back whole', () => {
    saveAiPoints(EXAM, 'q-1', demoRubricResponse());
    expect(savedAiPoints(EXAM, 'q-1')).toBeNull(); // points from lectures are the server's to keep
    saveAiPoints(EXAM, 'q-1', ai());
    const kept = savedAiPoints(EXAM, 'q-1');
    expect(kept?.rubric.origin).toBe('ai');
    expect(kept?.rubric.points.map((point) => point.id)).toEqual(DEMO_RUBRIC.points.map((point) => point.id));
    expect(savedAiPoints(EXAM, 'q-2')).toBeNull();
  });

  it('a broken or foreign record is not points', () => {
    window.localStorage.setItem(`meldy:oral-ai:${EXAM}:q-1`, '{not json');
    expect(savedAiPoints(EXAM, 'q-1')).toBeNull();
    window.localStorage.setItem(`meldy:oral-ai:${EXAM}:q-1`, JSON.stringify(demoRubricResponse()));
    expect(savedAiPoints(EXAM, 'q-1')).toBeNull();
  });

  it('a point of such a rubric names no lecture', () => {
    const response = ai();
    expect(pointSource(response.rubric.points[0], response.rubric)).toMatchObject({ label: 'Ответ ИИ', fragments: '', materialId: null });
  });
});
