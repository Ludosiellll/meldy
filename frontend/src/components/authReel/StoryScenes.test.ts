import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUESTIONS } from '../../data/example';
import { lectureOf } from '../../data/example/lectures';
import { changeSentence, lineNote } from '../exams/sheet/copy';
import { changeSummary, type LineChange, type LineStatus } from '../../lib/exams/cheatSheet';
import { inkAt } from '../film/ink';
import { HERO_SHEET } from '../home/HeroSheet';
import { LIST_LINES } from './RegisterScenes';
import { AFTER_QUESTION, ANSWER_CHANGE, ERASE_AT, FOLLOWUP, Q6, Q7_LINES, Q7_TEXT, QUESTION_ROWS, QUOTE, q7 } from './StoryScenes';

const example = (number: number) => EXAMPLE_QUESTIONS.find((question) => question.number === number)!;

describe('the example of the sign-in reels', () => {
  it('is /try\'s exam, word for word: questions 6 and 7, their short lines, the follow-up on point 3, the quote', () => {
    expect(Q6.text).toBe(example(6).text);
    expect(Q6.lines.map((line) => [line.text, line.essential])).toEqual(example(6).points.map((point) => [point.short, point.essential]));
    expect(Q7_TEXT).toBe(example(7).text);
    expect([...Q7_LINES]).toEqual(example(7).points.map((point) => point.short));
    expect(q7(null).lines.map((line) => line.essential)).toEqual(example(7).points.map((point) => point.essential));
    expect(FOLLOWUP).toBe(example(7).points[2].followup.question);
    expect(example(7).evidence[0]).toMatchObject({ lecture: 'M2', fragment: 'S05', quote: QUOTE });
    expect(lectureOf('M2').title).toBe('Эластичность спроса');
  });

  it('marks questions 6–8 and points to their fragments as the example\'s «Вопросы» does', () => {
    for (const row of QUESTION_ROWS) {
      const question = example(row.n);
      expect(row.text).toBe(question.text);
      expect(row.kind).toBe(question.coverage === 'full' ? 'ok' : 'half');
      const fragment = Number(question.evidence[0].fragment.slice(1));
      expect(row.source.endsWith(`фрагмент ${fragment}`)).toBe(true);
      expect(question.evidence[0].lecture).toBe('M2');
    }
    expect(QUESTION_ROWS[0].source).toBe(`${lectureOf('M2').title}, фрагмент 4`);
  });

  it('pastes the department\'s list as the example has it', () => {
    expect(LIST_LINES.slice(1, 5)).toEqual([1, 2, 3, 4].map((number) => `${number}. ${example(number).text}`));
    expect(EXAMPLE_QUESTIONS).toHaveLength(12);
  });

  it('shows question 6 as learned: every main line erased', () => {
    expect(Q6.learned).toBe(true);
    expect(Q6.lines.filter((line) => line.essential).every((line) => line.from === 'erased')).toBe(true);
  });
});

describe('the answer on the sheet', () => {
  const lines = q7(ERASE_AT).lines;
  const after = lines.map((line) => inkAt(line, ERASE_AT + 10_000).state);

  it('erases the line named the day before, rubs two named now and leaves the one named only after the examiner\'s question', () => {
    expect(lines.map((line) => line.from)).toEqual(['rubbed', 'fresh', 'fresh', 'fresh']);
    expect(after).toEqual(['erased', 'rubbed', 'missed', 'rubbed']);
    // Before the answer the sheet is as the sign-in reel's first scene shows it.
    expect(q7(null).lines.map((line) => inkAt(line, 0).state)).toEqual(['rubbed', 'fresh', 'fresh', 'fresh']);
  });

  it('says what it did in the exam page\'s words', () => {
    const changes: LineChange[] = lines
      .map((line, index) => ({ key: String(index), questionId: 'q7', from: line.from, to: after[index] }))
      .filter((change) => change.from !== change.to);
    expect(ANSWER_CHANGE).toBe(changeSentence(changeSummary(changes)));
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
    expect(lines[2].steps?.[0].note).toBe(AFTER_QUESTION);
  });

  it('uses the lines of the landing\'s own sheet', () => {
    const hero = HERO_SHEET.find((question) => question.number === 7)!;
    expect(hero.lines.map((line) => line.text)).toEqual([...Q7_LINES]);
  });
});
