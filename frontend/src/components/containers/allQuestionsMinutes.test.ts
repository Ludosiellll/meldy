import { describe, expect, it } from 'vitest';
import { ALL_QUESTIONS_MIN } from '../../lib/containers/plan';
import { ALL_QUESTIONS_MINUTES } from './allQuestionsMinutes';

describe('«Все вопросы» minutes', () => {
  it('the words use the planner’s own number', () => {
    expect(ALL_QUESTIONS_MINUTES).toBe(ALL_QUESTIONS_MIN);
  });
});
