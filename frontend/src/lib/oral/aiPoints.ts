/**
 * Answer points written by the model for an exam without lectures (owner 19.11: «что делать в случае если лекций нет?…
 * чтобы можно было тянуть билеты спокойно и отвечать»). The server builds them only when asked (`ai` of
 * /api/oral/rubric) and only for an exam with no lectures at all; it does not keep them — the table of rubrics is
 * tied to a lecture — so this device does: the choice for the exam («Составить пункты с ИИ» is pressed once) and the
 * points of each question, so a question drawn again shows the same points and costs nothing. Storage that is full
 * or shut is not an error: the points are then built again.
 */
import { parseRubricResponse, type RubricResponse } from './oralApi';

const PREFIX = 'meldy:oral-ai:';
const examKey = (examId: string) => `${PREFIX}${examId}`;
const questionKey = (examId: string, questionId: string) => `${PREFIX}${examId}:${questionId}`;

/** The student asked for the model's points in this exam (on this device). */
export function aiPointsOn(examId: string): boolean {
  try {
    return localStorage.getItem(examKey(examId)) === '1';
  } catch {
    return false;
  }
}

export function setAiPointsOn(examId: string, on = true): void {
  try {
    if (on) localStorage.setItem(examKey(examId), '1');
    else localStorage.removeItem(examKey(examId));
  } catch {
    /* the choice then lasts for this page only */
  }
}

/** The points kept for a question, read through the same checks as the server's answer; null — none (or not ours). */
export function savedAiPoints(examId: string, questionId: string): RubricResponse | null {
  try {
    const raw = localStorage.getItem(questionKey(examId, questionId));
    if (!raw) return null;
    const response = parseRubricResponse(JSON.parse(raw));
    return response.rubric.origin === 'ai' && response.rubric.points.length > 0 ? response : null;
  } catch {
    return null;
  }
}

export function saveAiPoints(examId: string, questionId: string, response: RubricResponse): void {
  if (response.rubric.origin !== 'ai') return;
  try {
    localStorage.setItem(questionKey(examId, questionId), JSON.stringify(response));
  } catch {
    /* full or shut: the points are built again next time */
  }
}

export { AI_POINT_LABEL, AI_POINTS_NOTE } from './aiPointsWords';
