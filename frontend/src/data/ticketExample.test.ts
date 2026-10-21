import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUESTIONS } from './example';
import { Q7 } from './ticketExample';

const example = (number: number) => EXAMPLE_QUESTIONS.find((question) => question.number === number)!;

describe('question 7 of the example exam, as the reels show it', () => {
  it('is /try\'s question 7 word for word: its text, its points\' short words, main and detail', () => {
    expect(Q7.text).toBe(example(Q7.number).text);
    expect(Q7.points.map((point) => [point.text, point.essential])).toEqual(example(Q7.number).points.map((point) => [point.short, point.essential]));
  });
});
