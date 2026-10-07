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

  it('keeps no key words, follow-ups or short lines: only what the protocol needs', () => {
    const text = serverCopyText();
    expect(text).not.toMatch(/anchors|followup|short|expected/);
    for (const question of exampleServerCopy().questions) {
      for (const point of question.points) expect(Object.keys(point).sort()).toEqual(['essential', 'id', 'source_quote', 'title']);
    }
  });
});
