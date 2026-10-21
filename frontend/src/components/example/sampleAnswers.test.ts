import { describe, expect, it } from 'vitest';
import { answerableQuestions, exampleQuestion, exampleRubric, EXAMPLE_QUESTIONS } from '../../data/example';
import { liveMarks } from '../../lib/oral/rubricMatch';
import { pasteAllowed } from '../../lib/oral/pasteGuard';
import { TRY_TRANSCRIPT_CHARS } from './tryCheck';
import { exampleFollowup, keywordEvaluation } from './exampleFlow';
import { isSampleAnswer, sampleAnswer, SAMPLE_ANSWERS } from './sampleAnswers';

/** The point each ready answer leaves out on purpose: the examiner asks about it. */
const LEFT_OUT: Record<string, string> = {
  q1: 'p4',
  q2: 'p2',
  q3: 'p3',
  q4: 'p4',
  q5: 'p5',
  q6: 'p4',
  q7: 'p4',
  q8: 'p3',
  q9: 'p5',
  q10: 'p5',
  q11: 'p1',
};

describe('the ready answers of the example (sampleAnswers)', () => {
  it('there is one for every question the lectures cover, and none for the question in no lecture', () => {
    expect(Object.keys(SAMPLE_ANSWERS).sort()).toEqual(
      answerableQuestions()
        .map((question) => question.id)
        .sort(),
    );
    expect(sampleAnswer(exampleQuestion('q12'))).toBeNull();
    expect(sampleAnswer(null)).toBeNull();
  });

  it.each(Object.entries(LEFT_OUT))('%s names every point but %s by the key words, and the examiner asks about that one', (id, left) => {
    const question = exampleQuestion(id)!;
    const rubric = exampleRubric(question)!;
    const answer = sampleAnswer(question)!;
    const named = liveMarks(rubric.points, answer, '');
    expect([...named].sort()).toEqual(rubric.points.map((point) => point.id).filter((point) => point !== left));
    const evaluation = keywordEvaluation(rubric.points, named, answer);
    expect(exampleFollowup(rubric.points, answer, evaluation)?.pointId).toBe(left);
  });

  it('is a short spoken answer: under the AI check’s limit, three or four sentences', () => {
    for (const answer of Object.values(SAMPLE_ANSWERS)) {
      expect(answer.length).toBeLessThan(TRY_TRANSCRIPT_CHARS);
      expect(answer.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(2);
      expect(answer.split(/[.!?]\s/).length).toBeLessThanOrEqual(4);
      // A button puts it in, not a paste: pasted, it would be refused as any ready text is.
      expect(pasteAllowed(answer)).toBe(false);
    }
  });

  it('every point has a ready reply to the examiner’s question', () => {
    for (const question of EXAMPLE_QUESTIONS) for (const point of question.points) expect(point.followup.expected.trim()).not.toBe('');
  });

  it('knows its own text: the label says «готовый ответ» only while it is unchanged', () => {
    const question = exampleQuestion('q5')!;
    expect(isSampleAnswer(question, `${sampleAnswer(question)}  `)).toBe(true);
    expect(isSampleAnswer(question, `${sampleAnswer(question)} И ещё.`)).toBe(false);
    expect(isSampleAnswer(question, '')).toBe(false);
  });
});
