import { describe, expect, it } from 'vitest';
import vectorsRaw from './__fixtures__/plan_vectors.json?raw';
import { planVectorCases, type PlanVectorFile } from './__fixtures__/planVectors.ts';
import { planDay } from './plan.ts';
import { LINE_KEYS, lineText } from './words.ts';

const file = JSON.parse(vectorsRaw) as PlanVectorFile;

describe('plan vectors (__fixtures__/plan_vectors.json)', () => {
  it('hold exactly the inputs of planVectors.ts', () => {
    const cases = planVectorCases();
    expect(file.v).toBe(1);
    expect(file.cases.map((c) => c.name)).toEqual(cases.map((c) => c.name));
    for (const [i, c] of cases.entries()) {
      expect(file.cases[i].about).toBe(c.about);
      expect(file.cases[i].input).toEqual(JSON.parse(JSON.stringify(c.input)));
    }
  });

  for (const c of file.cases) {
    it(`${c.name}: planDay gives the stored plan`, () => {
      expect(planDay(c.input)).toEqual(c.expect);
      for (const line of c.expect.lines) {
        expect(LINE_KEYS as readonly string[]).toContain(line.key);
        expect(lineText(line).length).toBeGreaterThan(5);
      }
    });
  }

  it('cover every state but «empty», and the lines that matter', () => {
    const states = new Set(file.cases.map((c) => c.expect.state));
    expect([...states].sort()).toEqual(['after', 'done', 'exam_today', 'nothing', 'study']);
    const keys = new Set(file.cases.flatMap((c) => c.expect.lines.map((l) => l.key)));
    for (const key of ['later', 'first_count', 'skip', 'short', 'window_ahead', 'window_in', 'exam_today', 'exam_errors', 'after', 'no_date',
      'first_day', 'more_new', 'ai_limit', 'oral', 'done', 'nothing', 'day_off']) expect(keys.has(key), key).toBe(true);
  });
});
