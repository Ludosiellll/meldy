import { describe, expect, it } from 'vitest';
import { EXAMPLE_EXAM, EXAMPLE_QUESTIONS } from './example';
import { lineNote } from '../components/exams/sheet/copy';
import type { LineStatus } from '../lib/exams/cheatSheet';
import { CAME_BACK, Q4, Q6, Q7, SHEET_BEFORE, SHEET_SUBJECT } from './sheetExample';

const example = (number: number) => EXAMPLE_QUESTIONS.find((question) => question.number === number)!;

describe('the cheat sheet of the example exam, as the landing and the reels draw it', () => {
  it('has questions 4, 6 and 7 of /try word for word: their text, their short lines, main and detail', () => {
    for (const question of [Q4, Q6, Q7]) {
      expect(question.text).toBe(example(question.number).text);
      expect(question.lines.map((line) => [line.text, line.essential])).toEqual(
        example(question.number).points.map((point) => [point.short, point.essential]),
      );
    }
  });

  it('has a state for every line of every question with lines, in the sheet\'s order', () => {
    const withLines = EXAMPLE_QUESTIONS.filter((question) => question.points.length > 0);
    expect(SHEET_BEFORE.map((question) => question.number)).toEqual(withLines.map((question) => question.number));
    expect(SHEET_BEFORE.map((question) => question.states.length)).toEqual(withLines.map((question) => question.points.length));
    // A learned question: question 6's main lines are all erased.
    const six = SHEET_BEFORE.find((question) => question.number === 6)!;
    expect(six.states.filter((_, index) => Q6.lines[index].essential).every((state) => state === 'erased')).toBe(true);
  });

  it('names the subject and notes a line that came back as the exam page does', () => {
    expect(SHEET_SUBJECT).toBe(EXAMPLE_EXAM.title);
    const returned: LineStatus = {
      state: 'returned',
      history: [],
      erasableFrom: null,
      erasedAt: null,
      erasedOn: null,
      lastNamedAt: null,
      dueAt: null,
      wasErasedOn: null,
      wasErasedAt: null,
      peekedToday: false,
      checks: 0,
    };
    // Word for word; the exam page keeps «·» on its line with a no-break space.
    expect(lineNote(returned)?.replace(/ /g, ' ')).toBe(CAME_BACK);
  });
});
