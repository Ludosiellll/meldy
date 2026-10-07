/**
 * The example's questions as the server keeps them: backend/try_example.json, read by backend/try_api.py.
 * POST /api/try/evaluate takes only a question's id and the answer, and the server checks the answer
 * against these points — never against points or lecture text sent by a browser, so the open route is
 * no free way to the model.
 *
 * One source of truth: this file is built from the example's own data (questions.ts, the lecture
 * texts), and serverCopy.test.ts fails when the backend's file differs from it. After a change of the
 * example's questions or points, write the file again: npx vitest run -u src/data/example/serverCopy.test.ts
 */
import { EXAMPLE_EXAM, answerableQuestions, exampleRubric } from './index';

export interface ServerExamplePoint {
  /** «p1» … in the order of the answer sheet. */
  id: string;
  title: string;
  essential: boolean;
  /** Word for word from the lecture: what the protocol's model compares the answer with. */
  source_quote: string;
}

export interface ServerExampleQuestion {
  /** «q1» … «q11»: only the questions that can be answered (a question in no lecture has no points). */
  id: string;
  number: number;
  text: string;
  /** The lecture of the points (M1, M2, M3: lecture-*.txt), for the backend's own check of the quotes. */
  lecture: string;
  points: ServerExamplePoint[];
}

export interface ServerExampleCopy {
  v: 1;
  exam: string;
  questions: ServerExampleQuestion[];
}

export function exampleServerCopy(): ServerExampleCopy {
  return {
    v: 1,
    exam: EXAMPLE_EXAM.id,
    questions: answerableQuestions().flatMap((question) => {
      const rubric = exampleRubric(question);
      if (!rubric || !question.lecture) return [];
      return [
        {
          id: question.id,
          number: question.number,
          text: question.text,
          lecture: question.lecture,
          points: rubric.points.map((point) => ({ id: point.id, title: point.title, essential: point.essential, source_quote: point.source_quote })),
        },
      ];
    }),
  };
}

/** The backend's file, byte for byte: two-space JSON, Cyrillic as is, a newline at the end. */
export function serverCopyText(): string {
  return `${JSON.stringify(exampleServerCopy(), null, 2)}\n`;
}
