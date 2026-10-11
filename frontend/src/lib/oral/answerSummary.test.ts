import { describe, expect, it } from 'vitest';
import { answerSummary, summaryLine, type SummaryFollowup, type SummaryPoint } from './answerSummary';
import { lineStatus } from '../exams/cheatSheet';
import type { LearningEvent } from '../../api/learning';

/** The stage example: four main points of five, p3 mentioned, p4 not named, p5 (not main) named. */
const STAGE: SummaryPoint[] = [
  { id: 'p1', essential: true, status: 'covered' },
  { id: 'p2', essential: true, status: 'covered' },
  { id: 'p3', essential: true, status: 'partial' },
  { id: 'p4', essential: true, status: 'missing' },
  { id: 'p5', essential: false, status: 'covered' },
];

function line(points: SummaryPoint[], followup: SummaryFollowup | null = null): string | null {
  return summaryLine(answerSummary(points, followup));
}

describe('answerSummary: the result of an answer without a grade (Ф1)', () => {
  it('counts the main points named in the answer itself', () => {
    expect(line(STAGE)).toBe('Сами назвали 2 из 4 главных пунктов');
    expect(answerSummary(STAGE, null)).toMatchObject({ basis: 'main', total: 4, own: 2, afterQuestion: 0, errors: 0 });
  });

  it('adds the point named only after the examiner’s question, and only when the reply covered it', () => {
    expect(line(STAGE, { point_id: 'p4', status: 'covered' })).toBe('Сами назвали 2 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора');
    // «Не знаю», a wrong or a partial reply: nothing was named after the question.
    for (const status of ['missing', 'wrong', 'partial']) expect(line(STAGE, { point_id: 'p4', status })).toBe('Сами назвали 2 из 4 главных пунктов');
    // A point already named in the answer is not counted twice.
    expect(line(STAGE, { point_id: 'p1', status: 'covered' })).toBe('Сами назвали 2 из 4 главных пунктов');
    // A mentioned or wrong point put right on the question counts too.
    expect(line(STAGE, { point_id: 'p3', status: 'covered' })).toBe('Сами назвали 2 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора');
  });

  it('says which status the point named after the question had in the answer (the plain sentence moves it)', () => {
    expect(answerSummary(STAGE, { point_id: 'p4', status: 'covered' }).afterQuestionFrom).toBe('missing');
    expect(answerSummary(STAGE, { point_id: 'p3', status: 'covered' }).afterQuestionFrom).toBe('partial');
    expect(answerSummary(STAGE, { point_id: 'p4', status: 'partial' }).afterQuestionFrom).toBeNull();
    expect(answerSummary(STAGE, { point_id: 'p1', status: 'covered' }).afterQuestionFrom).toBeNull();
    expect(answerSummary(STAGE, null).afterQuestionFrom).toBeNull();
  });

  it('counts the errors of every point, the main ones and the others', () => {
    const wrong = STAGE.map((point) => (point.id === 'p5' || point.id === 'p2' ? { ...point, status: 'wrong' } : point));
    expect(line(wrong, { point_id: 'p4', status: 'covered' })).toBe('Сами назвали 1 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора. Ошибки в 2 пунктах');
    expect(line(wrong.map((point) => (point.id === 'p5' ? { ...point, status: 'covered' } : point)))).toBe('Сами назвали 1 из 4 главных пунктов. Ошибка в 1 пункте');
    expect(answerSummary(wrong, null).errors).toBe(2);
  });

  it('counts every point when the rubric has no main ones, with the right word forms', () => {
    const plain = STAGE.map((point) => ({ ...point, essential: false }));
    expect(line(plain)).toBe('Сами назвали 3 из 5 пунктов');
    expect(line([{ id: 'p1', essential: false, status: 'missing' }])).toBe('Сами назвали 0 из 1 пункта');
    expect(line([{ id: 'p1', essential: true, status: 'covered' }, { id: 'p2', essential: false, status: 'covered' }])).toBe('Сами назвали 1 из 1 главного пункта');
  });

  it('keeps unrated points in the count and has no line when nothing was judged', () => {
    const half = STAGE.map((point) => (point.id === 'p2' ? { ...point, status: 'unrated' } : point));
    expect(line(half)).toBe('Сами назвали 1 из 4 главных пунктов');
    expect(answerSummary(half, null).counts).toMatchObject({ covered: 2, partial: 1, missing: 1, unrated: 1, total: 5 });
    expect(line(STAGE.map((point) => ({ ...point, status: 'unrated' })))).toBeNull();
    expect(line([])).toBeNull();
    // An unknown status reads as unrated.
    expect(answerSummary([{ id: 'p1', essential: true, status: 'odd' }], null).counts.unrated).toBe(1);
  });

  it('never says a grade or «засчитано»', () => {
    for (const followup of [null, { point_id: 'p4', status: 'covered' }]) {
      expect(line(STAGE, followup)).not.toMatch(/[2-5] ·|отлично|хорошо|удовлетвор|засчит/i);
    }
  });
});

describe('answerSummary agrees with the cheat sheet’s rule (cheatSheet.ts, outcomeOf)', () => {
  /** The oral_point event record_oral_attempt writes for a point (correct = covered or recovered on the follow-up). */
  function event(point: SummaryPoint, followup: SummaryFollowup | null): LearningEvent {
    const asked = followup?.point_id === point.id ? followup.status : null;
    return {
      id: `e-${point.id}`,
      created_at: '2026-10-06T10:00:00Z',
      local_date: '2026-10-06',
      material_id: null,
      kind: 'oral_point',
      item_key: `oral:r1:${point.id}`,
      correct: point.status === 'unrated' ? null : point.status === 'covered' || asked === 'covered',
      score: null,
      confidence: null,
      source_ids: [],
      session_id: 's-1',
      payload: { v: 1, question_hash: 'a'.repeat(32), rubric_id: 'r1', point_id: point.id, title: point.id, status: point.status, followup_status: asked },
    } as LearningEvent;
  }

  it('the points named «сами» rub their lines; the one named after the question does not', () => {
    const followup = { point_id: 'p4', status: 'covered' };
    const summary = answerSummary(STAGE, followup);
    const states = STAGE.map((point) => lineStatus([event(point, followup)], Date.parse('2026-10-06T12:00:00Z')));
    const rubbed = STAGE.filter((point, index) => point.essential && states[index].state === 'rubbed').length;
    expect(rubbed).toBe(summary.own);
    // p4: named after the examiner asked — the sheet keeps it, and says why.
    expect(states[3].state).toBe('missed');
    expect(states[3].history[0].word).toBe('after_question');
    expect(summary.afterQuestion).toBe(1);
  });
});
