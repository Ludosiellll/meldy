import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUESTIONS, answerableQuestions, exampleRubric, lectureOf } from './index';
import { exampleServerCopy, serverCopyText } from './serverCopy';

/**
 * backend/try_example.json is what POST /api/try/evaluate checks answers against. It must say exactly what
 * the example's answer screen shows: a drift fails here. To write the file again after a change of the
 * example: npx vitest run -u src/data/example/serverCopy.test.ts
 */
describe('the example as the server keeps it (backend/try_example.json)', () => {
  it('is the file in the backend, byte for byte', async () => {
    await expect(serverCopyText()).toMatchFileSnapshot('../../../../backend/try_example.json');
  });

  it('holds every question that can be answered, with the points of its answer sheet in their order', () => {
    const copy = exampleServerCopy();
    expect(copy.v).toBe(1);
    expect(copy.questions.map((question) => question.id)).toEqual(answerableQuestions().map((question) => question.id));
    // The question in no lecture has nothing to check an answer against: the server does not know it.
    const none = EXAMPLE_QUESTIONS.filter((question) => question.coverage === 'none').map((question) => question.id);
    expect(none).toEqual(['q12']);
    expect(copy.questions.some((question) => none.includes(question.id))).toBe(false);
    for (const question of copy.questions) {
      const rubric = exampleRubric(answerableQuestions().find((item) => item.id === question.id)!)!;
      expect(question.points.map((point) => point.id)).toEqual(rubric.points.map((point) => point.id));
      expect(question.points.map((point) => point.title)).toEqual(rubric.points.map((point) => point.title));
      expect(question.points.map((point) => point.essential)).toEqual(rubric.points.map((point) => point.essential));
      // Every quote is the lecture's own words: the model compares the answer with the lecture, not with a paraphrase.
      const lecture = lectureOf(question.lecture as 'M1' | 'M2' | 'M3').text.replace(/\s+/g, ' ');
      for (const point of question.points) expect(lecture).toContain(point.source_quote.replace(/\s+/g, ' '));
    }
  });

  it('keeps no key words or short lines: only what the protocol and the check of a reply to the examiner need', () => {
    const text = serverCopyText();
    expect(text).not.toMatch(/anchors|short|fragments/);
    for (const question of exampleServerCopy().questions) {
      for (const point of question.points) {
        expect(Object.keys(point).sort()).toEqual(['essential', 'followup', 'id', 'source_quote', 'title']);
        expect(Object.keys(point.followup).sort()).toEqual(['expected', 'question']);
      }
    }
  });

  it('gives the server the examiner’s question about each point and what should be heard in reply, as the answer screen asks it', () => {
    for (const question of exampleServerCopy().questions) {
      const rubric = exampleRubric(answerableQuestions().find((item) => item.id === question.id)!)!;
      expect(question.points.map((point) => point.followup)).toEqual(rubric.points.map((point) => point.followup));
    }
    // Jury QA, 2026-10-11: «Совершенно неэластичный и совершенно эластичный спрос.» was judged «не назван» — the check
    // did not know the question, and what should be heard was the two definitions the question does not ask for.
    const extremes = exampleServerCopy().questions.find((question) => question.id === 'q5')!.points[4];
    expect(extremes.followup).toEqual({
      question: 'Какие крайние случаи ценовой эластичности спроса бывают?',
      expected: 'Совершенно неэластичный и совершенно эластичный спрос.',
    });
  });
});
