import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase } from './testing/fakeSupabase';

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof createFakeSupabase>['client'] }));
vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => state.client.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => state.client.rpc(fn, args),
  },
}));

import {
  TicketLoadError,
  departmentTicketNumber,
  historyFrom,
  loadOralSession,
  loadQuestionHistory,
  loadRubricAnchors,
  loadTicket,
  parseQuestionIds,
  protocolFromRow,
  ticketLayoutOf,
} from './ticketData';
import type { LearningEvent } from '../../api/learning';

const EXAM = '0e000000-0000-4000-8000-000000000001';
const OTHER_EXAM = '0e000000-0000-4000-8000-000000000002';
const Q1 = '0a000000-0000-4000-8000-000000000001';
const Q2 = '0a000000-0000-4000-8000-000000000002';
const Q3 = '0a000000-0000-4000-8000-000000000003';
const SESSION = '05000000-0000-4000-8000-000000000001';
const RUBRIC = '07000000-0000-4000-8000-000000000001';
const HASH = 'c'.repeat(32);

function question(id: string, examId: string, position: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    exam_id: examId,
    position,
    label: String(position),
    text: `Вопрос ${position}`,
    question_hash: HASH,
    coverage: 'full',
    evidence: [{ material_id: 'm1', material_title: 'Лекция', source_id: 'S12', excerpt: 'Фрагмент' }],
    nearest: [],
    ...extra,
  };
}

function event(id: string, kind: LearningEvent['kind'], extra: Partial<LearningEvent>): Record<string, unknown> {
  return {
    id,
    created_at: '2026-10-01T10:00:00Z',
    local_date: '2026-10-01',
    material_id: null,
    kind,
    item_key: `q:${HASH}`,
    correct: null,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: null,
    payload: {},
    ...extra,
  };
}

beforeEach(() => {
  state.client = createFakeSupabase().client;
});

describe('ticket ids from the address', () => {
  it('keeps 1..4 unique question ids in order', () => {
    expect(parseQuestionIds(`${Q2},${Q1},${Q2},нет,${encodeURIComponent(Q3)}`)).toEqual([Q2, Q1, Q3]);
    expect(parseQuestionIds(null)).toEqual([]);
    const five = [Q1, Q2, Q3, '0a000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000005'].join(',');
    expect(parseQuestionIds(five)).toHaveLength(4);
  });
});

describe('loading a ticket', () => {
  it('returns the exam and the questions in the order of the ticket', async () => {
    const fake = createFakeSupabase({
      tables: {
        exams: [{ id: EXAM, title: 'Микроэкономика', kind: 'exam', exam_date: '2026-10-20' }],
        exam_questions: [question(Q1, EXAM, 1), question(Q2, EXAM, 7, { coverage: 'none', nearest: [{ material_id: 'm1', material_title: 'Лекция', source_id: 'S07', excerpt: 'Похожее', matched: ['ставка'] }] })],
      },
    });
    state.client = fake.client;
    const { exam, questions } = await loadTicket(EXAM, [Q2, Q1]);
    // The exam date moves the cheat sheet's checks in the last days before the exam.
    expect(exam).toEqual({ id: EXAM, title: 'Микроэкономика', kind: 'exam', layout: { mode: 'random', tickets: [] }, examDate: '2026-10-20' });
    expect(questions.map((item) => item.id)).toEqual([Q2, Q1]);
    expect(questions[0].nearest[0]).toMatchObject({ source_id: 'S07', matched: ['ставка'] });
    expect(questions[1].evidence[0]).toMatchObject({ material_id: 'm1', source_id: 'S12' });
    const read = fake.calls.find((call) => call.table === 'exam_questions');
    expect(read?.filters).toContainEqual({ op: 'eq', column: 'exam_id', value: EXAM });
  });

  it('refuses a question of another exam and a missing exam', async () => {
    state.client = createFakeSupabase({
      tables: {
        exams: [{ id: EXAM, title: 'Микроэкономика', kind: 'exam' }],
        exam_questions: [question(Q1, OTHER_EXAM, 1)],
      },
    }).client;
    await expect(loadTicket(EXAM, [Q1])).rejects.toMatchObject({ kind: 'not_found' });
    await expect(loadTicket(OTHER_EXAM, [Q1])).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('reports a failed read as failed, not as missing', async () => {
    state.client = createFakeSupabase({ failing: { exam_questions: { code: '500' } }, tables: { exams: [{ id: EXAM, title: 'Т', kind: 'exam' }] } }).client;
    const error = await loadTicket(EXAM, [Q1]).catch((caught) => caught);
    expect(error).toBeInstanceOf(TicketLoadError);
    expect(error.kind).toBe('failed');
  });
});

describe('the department’s tickets (Jury_Check items 4, 9, 11)', () => {
  const Q4 = '0a000000-0000-4000-8000-000000000004';
  const fixed = ticketLayoutOf({
    mode: 'fixed',
    per_ticket: 2,
    tickets: [
      { number: 7, question_ids: [Q1, Q2] },
      { number: 12, question_ids: [Q3, Q4] },
    ],
  });

  it('reads ticket_layout and drops what it cannot use', () => {
    expect(fixed).toEqual({
      mode: 'fixed',
      tickets: [
        { number: 7, questionIds: [Q1, Q2] },
        { number: 12, questionIds: [Q3, Q4] },
      ],
    });
    expect(ticketLayoutOf(null)).toEqual({ mode: 'random', tickets: [] });
    expect(ticketLayoutOf({ mode: 'sections', per_ticket: 2 })).toEqual({ mode: 'sections', tickets: [] });
    expect(ticketLayoutOf({ mode: 'fixed', tickets: [{ number: 0, question_ids: [Q1] }, { number: 3, question_ids: [] }, { number: '4', question_ids: [Q1] }, 'x'] })).toEqual({
      mode: 'fixed',
      tickets: [],
    });
  });

  it('honours n only for a non-empty part of that ticket in its order', () => {
    expect(departmentTicketNumber(fixed, '7', [Q1, Q2])).toBe('7');
    // The draw leaves a «нет» question out of q and keeps &n.
    expect(departmentTicketNumber(fixed, '7', [Q2])).toBe('7');
    expect(departmentTicketNumber(fixed, '7', [Q1])).toBe('7');
    expect(departmentTicketNumber(fixed, ' 12 ', [Q3, Q4])).toBe('12');
    // Out of order, another ticket's question, nothing answered.
    expect(departmentTicketNumber(fixed, '7', [Q2, Q1])).toBeNull();
    expect(departmentTicketNumber(fixed, '7', [Q1, Q3])).toBeNull();
    expect(departmentTicketNumber(fixed, '7', [])).toBeNull();
  });

  it('ignores a forged or missing number', () => {
    // A ticket number on an exam without the department's tickets.
    expect(departmentTicketNumber(ticketLayoutOf({ mode: 'random', per_ticket: 2 }), '12', [Q1, Q2])).toBeNull();
    expect(departmentTicketNumber(ticketLayoutOf({ mode: 'sections', per_ticket: 2, tickets: [{ number: 12, question_ids: [Q1, Q2] }] }), '12', [Q1, Q2])).toBeNull();
    // A ticket that is not on the list, or whose questions are not the answered ones.
    expect(departmentTicketNumber(fixed, '13', [Q1, Q2])).toBeNull();
    expect(departmentTicketNumber(fixed, '12', [Q1, Q2])).toBeNull();
    expect(departmentTicketNumber(fixed, '7а', [Q1, Q2])).toBeNull();
    expect(departmentTicketNumber(fixed, null, [Q1, Q2])).toBeNull();
  });

  it('loads the layout with the exam', async () => {
    const fake = createFakeSupabase({
      tables: {
        exams: [{ id: EXAM, title: 'Микроэкономика', kind: 'exam', ticket_layout: { mode: 'fixed', per_ticket: 2, tickets: [{ number: 7, question_ids: [Q1, Q2] }] } }],
        exam_questions: [question(Q1, EXAM, 1), question(Q2, EXAM, 2)],
      },
    });
    state.client = fake.client;
    const { exam } = await loadTicket(EXAM, [Q1, Q2]);
    expect(exam.layout).toEqual({ mode: 'fixed', tickets: [{ number: 7, questionIds: [Q1, Q2] }] });
    expect(exam.examDate).toBeNull();
    expect(fake.calls.find((call) => call.table === 'exams')?.columns).toBe('id, title, kind, exam_date, ticket_layout');
  });
});

describe('history of a question', () => {
  it('finds the latest answer and the latest self-rating', async () => {
    state.client = createFakeSupabase({
      tables: {
        learning_events: [
          event('e1', 'exam_answer', { session_id: SESSION, correct: true, score: 0.78, payload: { grade: 4, score_pct: 78 }, local_date: '2026-10-01' }),
          event('e2', 'self_rating', { confidence: 2, created_at: '2026-10-02T10:00:00Z' }),
        ],
      },
    }).client;
    const history = await loadQuestionHistory(HASH);
    expect(history.previous).toEqual({ sessionId: SESSION, examId: null, localDate: '2026-10-01', at: '2026-10-01T10:00:00Z', grade: 4, scorePct: 78 });
    expect(history.confidence).toBe(2);
    expect(history.state.readiness).toBe('once');
  });

  it('knows the exam of the previous answer (the same question may be in another exam)', () => {
    const history = historyFrom([
      {
        id: 'e1',
        created_at: '2026-10-06T10:00:00Z',
        local_date: '2026-10-06',
        material_id: null,
        kind: 'exam_answer',
        item_key: `q:${HASH}`,
        correct: true,
        score: 0.78,
        confidence: null,
        source_ids: [],
        session_id: SESSION,
        payload: { grade: 4, score_pct: 78, exam_id: OTHER_EXAM },
      },
    ]);
    expect(history.previous).toMatchObject({ sessionId: SESSION, examId: OTHER_EXAM, at: '2026-10-06T10:00:00Z' });
  });

  it('keeps only the day of a previous answer whose row has no readable time', () => {
    const history = historyFrom([
      { ...(event('e1', 'exam_answer', { session_id: SESSION, local_date: '2026-10-06' }) as unknown as LearningEvent), created_at: 'not a time' },
    ]);
    expect(history.previous).toMatchObject({ localDate: '2026-10-06', at: null });
  });

  it('has no previous attempt without answers', () => {
    const history = historyFrom([]);
    expect(history.previous).toBeNull();
    expect(history.confidence).toBeNull();
    expect(history.state.readiness).toBe('untested');
  });
});

describe('a saved protocol', () => {
  const row = {
    id: SESSION,
    kind: 'oral_ticket',
    subject: 'Микроэкономика',
    score: 78,
    completed_at: '2026-10-07T11:02:00Z',
    questions_json: [
      {
        v: 1,
        exam_id: EXAM,
        exam_question_id: Q1,
        rubric_id: RUBRIC,
        question_hash: HASH,
        question: 'Эластичность спроса',
        input: 'speech',
        points: [
          { id: 'p1', title: 'Как считают', essential: true, status: 'covered', credit: 1, student_quote: 'процентное изменение', comment: '', source_ids: ['S1'], material_id: 'm1', source_quote: 'отношение процентного изменения', source_label: '«Эластичность», фрагмент 1', live: true },
          { id: 'p2', title: 'Выручка', essential: true, status: 'bogus', live: false },
        ],
        followup: { point_id: 'p2', question: 'А выручка?', expected: 'Падает.', status: 'missing', student_quote: 'не знаю', chosen_by: 'check' },
        errors: [],
        verdict: 'Повторите выручку.',
        grade: 4,
        formula: 'v1',
      },
    ],
  };

  it('parses questions_json of an oral_ticket row', () => {
    const protocol = protocolFromRow(row);
    expect(protocol).toMatchObject({ sessionId: SESSION, grade: 4, score: 78, question: 'Эластичность спроса', rubricId: RUBRIC });
    expect(protocol?.points.map((point) => point.status)).toEqual(['covered', 'unrated']);
    expect(protocol?.followup).toMatchObject({ point_id: 'p2', student_quote: 'не знаю', chosen_by: 'check' });
  });

  it('shows a point the saved protocol lists an error for as «wrong», whatever status was saved (before release 28)', () => {
    const entry = row.questions_json[0];
    const old = {
      ...row,
      questions_json: [
        {
          ...entry,
          points: [
            { ...entry.points[0], status: 'covered', comment: 'Названо верно.', credit: 1 },
            { id: 'p2', title: 'Выручка', essential: true, status: 'partial', student_quote: 'выручка растёт', comment: 'Упомянуто.', live: false },
            { id: 'p3', title: 'Перекрёстная', essential: false, status: 'wrong', student_quote: 'всегда больше нуля', comment: 'Ошибка.', live: false },
          ],
          errors: [
            { point_id: 'p1', student_quote: 'эластичность всегда больше единицы', correction: 'Бывает и меньше единицы.' },
            { point_id: 'p2', student_quote: '', correction: 'Выручка падает при эластичном спросе.' },
            { point_id: 'p3', student_quote: 'всегда больше нуля', correction: 'Бывает отрицательной.' },
          ],
        },
      ],
    };
    const protocol = protocolFromRow(old);
    expect(protocol?.points.map(({ status, credit, comment, student_quote }) => ({ status, credit, comment, student_quote }))).toEqual([
      { status: 'wrong', credit: 0, comment: '', student_quote: 'эластичность всегда больше единицы' },
      // No quote with the error: the point keeps its own.
      { status: 'wrong', credit: 0, comment: '', student_quote: 'выручка растёт' },
      // Already «wrong»: as saved.
      { status: 'wrong', credit: null, comment: 'Ошибка.', student_quote: 'всегда больше нуля' },
    ]);
    expect(protocol?.errors).toHaveLength(3);
    // A protocol without errors is as saved.
    expect(protocolFromRow(row)?.points.map((point) => point.status)).toEqual(['covered', 'unrated']);
  });

  it('loads only an oral_ticket session', async () => {
    const fake = createFakeSupabase({ tables: { exam_sessions: [row, { ...row, id: '05000000-0000-4000-8000-000000000002', kind: 'professor' }] } });
    state.client = fake.client;
    expect((await loadOralSession(SESSION))?.sessionId).toBe(SESSION);
    expect(await loadOralSession('05000000-0000-4000-8000-000000000002')).toBeNull();
    expect(await loadOralSession('не-uuid')).toBeNull();
    expect(fake.calls.find((call) => call.table === 'exam_sessions')?.filters).toContainEqual({ op: 'eq', column: 'kind', value: 'oral_ticket' });
  });

  it('reads the anchors of the stored rubric', async () => {
    state.client = createFakeSupabase({
      tables: { oral_rubrics: [{ id: RUBRIC, rubric: { points: [{ id: 'p1', anchors: [['процентн'], [1, 'цен']] }] } }] },
    }).client;
    expect(await loadRubricAnchors(RUBRIC)).toEqual({ p1: [['процентн'], ['цен']] });
    expect(await loadRubricAnchors(null)).toEqual({});
  });
});
