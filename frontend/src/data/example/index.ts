/**
 * «Попробовать на примере» (/try): a ready example exam — three lectures of an original short course
 * in microeconomics and the department's list of twelve questions, already checked against them, with
 * the answer points of every question that can be answered. Everything is static: the page runs it
 * on the device, with no account and nothing saved; the server keeps a copy of the questions and points
 * for the AI check of an answer (serverCopy.ts → backend/try_example.json).
 *
 * The converters below give the data the app's own shapes, so the example is drawn and answered by
 * the same components and rules as a real exam: ExamQuestion for the sheet (components/exams), Rubric
 * and TicketQuestion for the answer screen (lib/oral, components/oral).
 */
import type { ExamQuestion, TicketLayout } from '../../api/exams';
import type { Rubric, RubricPoint, RubricResponse } from '../../lib/oral/oralApi';
import type { TicketExam, TicketQuestion } from '../../lib/oral/ticketData';
import { EXAMPLE_LECTURES, fragmentText, lectureOf, type ExampleLecture, type LectureKey } from './lectures';
import { EXAMPLE_QUESTIONS, type ExampleQuestion } from './questions';

export { EXAMPLE_LECTURES, EXAMPLE_QUESTIONS, fragmentText, lectureOf };
export type { ExampleLecture, ExampleQuestion, LectureKey };
export type { ExampleEvidence, ExampleNearest, ExamplePoint } from './questions';
export { FRAGMENT_CHARS, fragmentsOf, type ExampleFragment } from './lectures';

/** The example exam: one question per ticket, drawn at random (the default layout of a new exam is two). */
export const EXAMPLE_EXAM = {
  id: 'example-microeconomics',
  /** The subject, as the sheet's heading. */
  title: 'Микроэкономика',
  kind: 'exam' as const,
  /** The department's own heading of the list. */
  sheetTitle: 'Вопросы к экзамену по микроэкономике',
  layout: { mode: 'random', per_ticket: 1 } as TicketLayout,
};

export function exampleQuestion(id: string | null | undefined): ExampleQuestion | null {
  return EXAMPLE_QUESTIONS.find((question) => question.id === id) ?? null;
}

/** Questions with answer points: in the lectures fully or partly. */
export function answerableQuestions(): ExampleQuestion[] {
  return EXAMPLE_QUESTIONS.filter((question) => question.coverage !== 'none' && question.points.length > 0);
}

function material(key: LectureKey) {
  const lecture = lectureOf(key);
  return { material_id: lecture.materialId, material_title: lecture.title };
}

/** The question's answer points as the rubric /api/oral/rubric would return (contracts §5); null without points. */
export function exampleRubric(question: ExampleQuestion): Rubric | null {
  if (!question.lecture || question.coverage === 'none' || question.points.length === 0) return null;
  const lecture = lectureOf(question.lecture);
  const points: RubricPoint[] = question.points.map((point, index) => ({
    id: `p${index + 1}`,
    title: point.title,
    essential: point.essential,
    source_quote: point.quote,
    source_ids: point.fragments.map((fragment) => `${lecture.key}:${fragment}`),
    anchors: point.anchors.map((group) => [...group]),
    followup: { question: point.followup.question, expected: point.followup.expected },
  }));
  return {
    v: 1,
    question: question.text,
    coverage: question.coverage,
    coverage_note: question.coverageNote,
    fragments_considered: lecture.fragments.length,
    fragments_total: lecture.fragments.length,
    materials: [{ key: lecture.key, material_id: lecture.materialId, title: lecture.title }],
    points,
    nearest: [],
  };
}

/** The response around the rubric, as the answer screen's state machine keeps it (nothing was saved: no id). */
export function exampleRubricResponse(question: ExampleQuestion): RubricResponse | null {
  const rubric = exampleRubric(question);
  if (!rubric) return null;
  return { rubric_id: null, cached: true, saved: false, question_hash: '', question: question.text, rubric };
}

/** A question as the exam sheet shows it (components/exams/ExamSheet). */
export function exampleExamQuestion(question: ExampleQuestion): ExamQuestion {
  return {
    id: question.id,
    exam_id: EXAMPLE_EXAM.id,
    position: question.number,
    label: String(question.number),
    section: null,
    text: question.text,
    question_hash: null,
    coverage: question.coverage,
    coverage_method: null,
    coverage_reason: question.reason,
    missing_note: question.missing,
    evidence: question.evidence.map((item) => ({ ...material(item.lecture), source_id: item.fragment, excerpt: item.quote })),
    nearest: question.nearest
      ? [
          {
            ...material(question.nearest.lecture),
            source_id: question.nearest.fragment,
            excerpt: fragmentText(question.nearest.lecture, question.nearest.fragment),
            matched: [...question.nearest.matched],
          },
        ]
      : [],
    materials_fingerprint: null,
    mapping_version: null,
    mapped_at: null,
    created_at: '',
  };
}

/** The exam and the question as the answer screen's state machine (lib/oral/ticketMachine) loads them. */
export function exampleTicket(question: ExampleQuestion): { exam: TicketExam; question: TicketQuestion } {
  const sheet = exampleExamQuestion(question);
  return {
    exam: { id: EXAMPLE_EXAM.id, title: EXAMPLE_EXAM.title, kind: EXAMPLE_EXAM.kind, layout: { mode: 'random', tickets: [] } },
    question: {
      id: sheet.id,
      exam_id: sheet.exam_id,
      position: sheet.position,
      label: sheet.label,
      text: sheet.text,
      question_hash: '',
      coverage: question.coverage,
      evidence: sheet.evidence,
      nearest: sheet.nearest,
    },
  };
}
