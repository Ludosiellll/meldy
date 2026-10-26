import { describe, expect, it } from 'vitest';
import {
  AI_COSTS,
  EXAM_MAPPING_QUESTIONS_PER_CHARGE,
  FREE_DAILY_UNITS,
  PRO_DAILY_UNITS,
  dailyUnits,
  examMappingCost,
  IMPORT_AI_QUESTIONS_PER_CHARGE,
  importAiCost,
  OCR_PAGES_PER_CHARGE,
  RECORDING_DAILY_SECONDS,
  RECORDING_MAX_SECONDS,
  recordingCost,
  scanCost,
  textCost,
} from './plans';

// The same numbers live in backend/plans.py (the server charges, tests/test_quota.py pins them there).
describe('plans', () => {
  it('keeps the limits of 2026-10-04 and the costs of 2026-10-05, the voice tutor included', () => {
    expect([FREE_DAILY_UNITS, PRO_DAILY_UNITS]).toEqual([100, 1000]);
    expect(AI_COSTS).toEqual({
      lecture: 20, examMapping: 10, answer: 4, answerPoints: 1, conversation: 5, visuals: 2, cheatsheet: 5,
      mistakesPractice: 2, gradebookScan: 1, scanPages: 5, analysisSection: 7, tutorTurn: 1, importAI: 5,
    });
    expect(dailyUnits(false)).toBe(100);
    expect(dailyUnits(true)).toBe(1000);
  });

  it('charges the check of a list by every started 40 questions that go to the model', () => {
    expect(EXAM_MAPPING_QUESTIONS_PER_CHARGE).toBe(40);
    expect([0, 1, 40, 41, 80, 81, -3].map(examMappingCost)).toEqual([0, 10, 10, 20, 20, 30, 0]);
  });

  it('charges the AI pass over a bank of questions by every started 100 questions sent to the model', () => {
    expect(IMPORT_AI_QUESTIONS_PER_CHARGE).toBe(100);
    expect([0, 1, 100, 101, 250, -4].map(importAiCost)).toEqual([5, 5, 5, 10, 15, 5]); // a pass costs at least 5
  });

  it('prices a recording by its length and caps it at 2 hours, 2 hours a day free and 5 in PRO', () => {
    const minutes = [0, 10, 30, 30.02, 45, 45.5, 60, 90, 120];
    expect(minutes.map(m => recordingCost(m * 60))).toEqual([20, 20, 20, 30, 30, 40, 40, 60, 80]);
    expect(RECORDING_MAX_SECONDS).toBe(7200);
    expect(RECORDING_DAILY_SECONDS).toEqual({ free: 7200, pro: 18000 });
  });

  it('prices a text over 50 000 characters by every started 50 000 more', () => {
    expect([1, 50_000, 50_001, 100_000, 100_001, 300_000].map(textCost)).toEqual([20, 20, 30, 30, 40, 70]);
  });

  it('charges the recognition of a scan by every started 15 pages', () => {
    expect(OCR_PAGES_PER_CHARGE).toBe(15);
    expect([0, 1, 15, 16, 60, -2].map(scanCost)).toEqual([0, 5, 5, 10, 20, 0]);
  });
});
