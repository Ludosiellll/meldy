import { describe, expect, it } from 'vitest';
import {
  AI_COSTS,
  EXAM_MAPPING_QUESTIONS_PER_CHARGE,
  FREE_DAILY_UNITS,
  PRO_DAILY_UNITS,
  dailyUnits,
  examMappingCost,
  professorExamCost,
} from './plans';

// The same numbers live in backend/plans.py (the server charges, tests/test_quota.py pins them there).
describe('plans', () => {
  it('keeps the limits and the costs of 2026-10-04', () => {
    expect([FREE_DAILY_UNITS, PRO_DAILY_UNITS]).toEqual([100, 1000]);
    expect(AI_COSTS).toEqual({
      lecture: 20, examMapping: 10, answer: 4, answerPoints: 1, conversation: 5, visuals: 2, cheatsheet: 5, chatMessage: 1,
      course: 5, missions: 2, mistakesPractice: 2, gradebookScan: 1, careerProfile: 5, careerReview: 5,
    });
    expect(dailyUnits(false)).toBe(100);
    expect(dailyUnits(true)).toBe(1000);
  });

  it('charges the check of a list by every started 40 questions that go to the model', () => {
    expect(EXAM_MAPPING_QUESTIONS_PER_CHARGE).toBe(40);
    expect([0, 1, 40, 41, 80, 81, -3].map(examMappingCost)).toEqual([0, 10, 10, 20, 20, 30, 0]);
  });

  it('charges the professor exam by its length, an unknown length as the usual 5 questions', () => {
    expect([3, 5, 10, 7].map(professorExamCost)).toEqual([1, 2, 4, 2]);
  });
});
