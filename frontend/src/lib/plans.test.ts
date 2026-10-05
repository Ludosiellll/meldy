import { describe, expect, it } from 'vitest';
import {
  AI_COSTS,
  EXAM_MAPPING_QUESTIONS_PER_CHARGE,
  FREE_DAILY_UNITS,
  PRO_DAILY_UNITS,
  dailyUnits,
  examMappingCost,
  OCR_PAGES_PER_CHARGE,
  scanCost,
} from './plans';

// The same numbers live in backend/plans.py (the server charges, tests/test_quota.py pins them there).
describe('plans', () => {
  it('keeps the limits of 2026-10-04 and the costs of 2026-10-05', () => {
    expect([FREE_DAILY_UNITS, PRO_DAILY_UNITS]).toEqual([100, 1000]);
    expect(AI_COSTS).toEqual({
      lecture: 20, examMapping: 10, answer: 4, answerPoints: 1, conversation: 5, visuals: 2, cheatsheet: 5,
      mistakesPractice: 2, gradebookScan: 1, scanPages: 5, analysisSection: 7,
    });
    expect(dailyUnits(false)).toBe(100);
    expect(dailyUnits(true)).toBe(1000);
  });

  it('charges the check of a list by every started 40 questions that go to the model', () => {
    expect(EXAM_MAPPING_QUESTIONS_PER_CHARGE).toBe(40);
    expect([0, 1, 40, 41, 80, 81, -3].map(examMappingCost)).toEqual([0, 10, 10, 20, 20, 30, 0]);
  });

  it('charges the recognition of a scan by every started 15 pages', () => {
    expect(OCR_PAGES_PER_CHARGE).toBe(15);
    expect([0, 1, 15, 16, 60, -2].map(scanCost)).toEqual([0, 5, 5, 10, 20, 0]);
  });
});
