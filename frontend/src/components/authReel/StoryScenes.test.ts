import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUESTIONS } from '../../data/example';
import { Q7, SHEET_BEFORE } from '../../data/sheetExample';
import { changeSentence, lineNote } from '../exams/sheet/copy';
import { changeSummary, type LineChange, type LineStatus } from '../../lib/exams/cheatSheet';
import { CHANGE_MS, LOOK, leftAt, lineAt, statesAt } from '../film/listLine';
import { AFTER_QUESTION, ANSWER_CHANGE, MARKED, ORAL_AT, ORAL_CAPTION, ORAL_LINES, PICK, Q7_LINES, Q7_TEXT, SHEET_IN, mapLines, q7 } from './StoryScenes';
import { LOGIN_SCRIPT, REGISTER_SCRIPT, leaveOf } from './script';

const example = (number: number) => EXAMPLE_QUESTIONS.find((question) => question.number === number)!;

describe('the oral example of the sign-in reels', () => {
  it('is /try\'s question 7, word for word: its text and its short lines, main and detail', () => {
    expect(Q7_TEXT).toBe(example(7).text);
    expect([...Q7_LINES]).toEqual(example(7).points.map((point) => point.short));
    expect(q7(null).map((line) => line.essential)).toEqual(example(7).points.map((point) => point.essential));
  });

  it('uses the lines of the example sheet', () => {
    expect(Q7.lines.map((line) => line.text)).toEqual([...Q7_LINES]);
  });
});

describe('the answer on the sheet', () => {
  const after = statesAt(ORAL_LINES, ORAL_AT + 10_000);

  it('strikes off the line named the day before, names two for the first time and leaves the one named only after the examiner\'s question', () => {
    expect(ORAL_LINES.map((line) => line.from)).toEqual(['rubbed', 'fresh', 'fresh', 'fresh']);
    expect(after).toEqual(['erased', 'rubbed', 'missed', 'rubbed']);
    // Before the answer reaches it the sheet is as it was; the strike comes first, the namings after it.
    expect(statesAt(ORAL_LINES, ORAL_AT - 1)).toEqual(['rubbed', 'fresh', 'fresh', 'fresh']);
    const firsts = ORAL_LINES.map((line) => line.steps?.[0]?.at ?? Infinity);
    expect(firsts[0]).toBe(ORAL_AT);
    expect(Math.min(...firsts.slice(1))).toBeGreaterThan(ORAL_AT);
  });

  it('says what it did in the exam page\'s words, once it has done it', () => {
    const changes: LineChange[] = ORAL_LINES.map((line, index) => ({ key: String(index), questionId: 'q7', from: line.from, to: after[index] })).filter(
      (change) => change.from !== change.to,
    );
    expect(ANSWER_CHANGE).toBe(changeSentence(changeSummary(changes)));
    const done = Math.max(...ORAL_LINES.flatMap((line) => (line.steps ?? []).map((step) => step.at + CHANGE_MS[LOOK[step.to]])));
    expect(ORAL_CAPTION[0]).toEqual({ at: expect.any(Number), text: ANSWER_CHANGE });
    expect(ORAL_CAPTION[0].at).toBeGreaterThanOrEqual(done);
  });

  it('notes the point named after the examiner\'s question as the exam page does', () => {
    const status: LineStatus = {
      state: 'missed',
      history: [{ at: '2026-10-08T09:00:00.000Z', date: '2026-10-08', outcome: 'missed', word: 'after_question', sessionId: null }],
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
    expect(lineNote(status)?.endsWith(` ${AFTER_QUESTION}`)).toBe(true);
    expect(lineAt(ORAL_LINES[2], ORAL_AT + 10_000).note).toBe(AFTER_QUESTION);
  });

  it('maps the whole sheet: one square per line of the example, one fewer left once the strike has run', () => {
    const map = mapLines(ORAL_LINES);
    const all = map.flat();
    expect(all).toHaveLength(EXAMPLE_QUESTIONS.reduce((sum, question) => sum + question.points.length, 0));
    expect(map.map((lines) => lines.length)).toEqual(EXAMPLE_QUESTIONS.filter((question) => question.points.length > 0).map((question) => question.points.length));
    expect(leftAt(all, ORAL_AT - 1) - leftAt(all, ORAL_AT + 1000)).toBe(1);
    // The same states as the example sheet before its answer.
    expect(map[5].map((line) => line.from)).toEqual(SHEET_BEFORE.find((question) => question.number === 6)!.states);
  });

  it('plays inside its beat in both reels: the sheet comes forward after the voice, the answer before the beat leaves', () => {
    expect(SHEET_IN).toBeLessThan(ORAL_AT);
    for (const script of [LOGIN_SCRIPT, REGISTER_SCRIPT]) {
      expect(ORAL_CAPTION[0].at + 320).toBeLessThan(leaveOf(script, 'oral'));
      expect(MARKED + 260 + 620).toBeLessThan(leaveOf(script, 'session'));
    }
    expect(PICK).toBeLessThan(MARKED);
  });
});
