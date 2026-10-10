import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import { localDayOf, type LineStatus, type SheetQuestion } from '../exams/cheatSheet';

/**
 * The oral reads are replaced (api/cheatSheet fetchSheet, api/learning fetchSheetEvents / fetchQuestionEvents, the
 * exams' dates); the cheat sheet's own rules (lib/exams/cheatSheet.ts) run for real, so a line here is in the state
 * the oral sheet would show.
 */
const reads = vi.hoisted(() => ({
  fetchSheet: vi.fn(),
  fetchSheetEvents: vi.fn(),
  fetchQuestionEvents: vi.fn(),
  examDates: vi.fn(),
  datesAsked: [] as unknown[][],
}));

vi.mock('../../api/cheatSheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cheatSheet')>()),
  fetchSheet: reads.fetchSheet,
}));
vi.mock('../../api/learning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/learning')>()),
  fetchSheetEvents: reads.fetchSheetEvents,
  fetchQuestionEvents: reads.fetchQuestionEvents,
}));
vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: (column: string, ids: string[]) => {
          reads.datesAsked.push([table, columns, column, ids]);
          return reads.examDates(ids);
        },
      }),
    }),
  },
}));

import { SheetError } from '../../api/cheatSheet';
import { LearningLoadError } from '../../api/learning';
import { loadOralPlanItems, oralMeta, unitFromLine } from './oralPlan';

const EXAM = '0fe86dc1-dc3c-482a-9b76-c06c11bc3cc5';
const EXAM2 = 'c0390f9c-787d-4d0e-a82d-9efa069bfe11';
const SUBJECT = '93c5b45c-df3d-4c94-b305-960744c757be';
const SUBJECT2 = '590a774c-7a67-4b13-a944-cf9a2f0e9d9b';
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const R5 = '55555555-5555-4555-8555-555555555555';
const hash = (n: number) => String(n).repeat(32).slice(0, 32);
const NOW = Date.parse('2026-12-21T15:00:00Z');
const TODAY = localDayOf(NOW);
const day = (iso: string) => localDayOf(Date.parse(iso));

function question(n: number, extra: Partial<SheetQuestion>): SheetQuestion {
  return {
    question_id: `${n}0000000-0000-4000-8000-00000000000${n}`,
    position: n,
    label: String(n),
    section: n <= 2 ? 1 : 2,
    text: `Вопрос ${n}`,
    question_hash: hash(n),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: null,
    ...extra,
  };
}

const point = (id: string, title: string, essential: boolean) => ({ id, title, short: '', essential, source_quote: 'цитата', source_ids: [] });
const rubric = (id: string, points: ReturnType<typeof point>[], coverage: 'full' | 'partial' | 'none' = 'full') => ({
  rubric_id: id, built_at: '2026-12-10T10:00:00Z', coverage, coverage_note: '', materials: [], points,
});

const QUESTIONS: SheetQuestion[] = [
  // lines: one essential point decides
  question(1, { rubric: rubric(R1, [point('p1', 'Определение', true), point('p2', 'Пример', false), point('p3', 'Вывод', false)]) }),
  // lines: no essential point, both decide
  question(2, { rubric: rubric(R2, [point('p1', 'Спрос', false), point('p2', 'Предложение', false)]) }),
  // in the lectures, points not written yet: in the plan, not prepared
  question(3, { coverage: 'partial' }),
  // not checked against the lectures: waits for lectures
  question(4, { coverage: null, coverage_method: null }),
  // not in the lectures
  question(5, { coverage: 'none', rubric: rubric(R5, [], 'none') }),
  // checked by words only
  question(6, { coverage: 'unverified', coverage_method: 'lexical' }),
  // written for other lectures: to be written again, in the plan
  question(7, { rebuilt: true }),
];

let eventId = 0;
function oralPoint(q: number, rubricId: string, pointId: string, title: string, at: string, named: boolean): LearningEvent {
  eventId += 1;
  return {
    id: `e${String(eventId).padStart(4, '0')}`, created_at: at, local_date: day(at), material_id: null, kind: 'oral_point',
    item_key: `oral:${rubricId}:${pointId}`, correct: named, score: null, confidence: null, source_ids: [],
    session_id: `s-${at}`, payload: { question_hash: hash(q), rubric_id: rubricId, point_id: pointId, title, status: named ? 'covered' : 'missing' },
  };
}
function peek(q: number, rubricId: string, pointId: string, title: string, at: string): LearningEvent {
  eventId += 1;
  return {
    id: `e${String(eventId).padStart(4, '0')}`, created_at: at, local_date: day(at), material_id: null, kind: 'sheet_peek',
    item_key: `peek:${rubricId}:${pointId}`, correct: null, score: null, confidence: null, source_ids: [], session_id: null,
    payload: { question_hash: hash(q), rubric_id: rubricId, point_id: pointId, title },
  };
}
function questionEvent(q: number, kind: 'self_rating' | 'exam_answer', at: string, confidence: 1 | 2 | 3 | null = null): LearningEvent {
  eventId += 1;
  return {
    id: `e${String(eventId).padStart(4, '0')}`, created_at: at, local_date: day(at), material_id: null, kind,
    item_key: `q:${hash(q)}`, correct: kind === 'exam_answer' ? true : null, score: null, confidence, source_ids: [], session_id: null, payload: {},
  };
}

const T1 = '2026-12-14T10:00:00Z';
const T2 = '2026-12-15T09:00:00Z'; // another day, 23 hours later: erases
const T3 = '2026-12-20T12:00:00Z'; // after the 5 days: a check passed
const T4 = '2026-12-21T13:00:00Z'; // today: one naming
const T5 = '2026-12-19T10:00:00Z'; // a miss
const T6 = '2026-12-21T14:00:00Z'; // uncovered today

const LINE_EVENTS: LearningEvent[] = [
  oralPoint(1, R1, 'p1', 'Определение', T1, true),
  oralPoint(1, R1, 'p1', 'Определение', T2, true),
  oralPoint(1, R1, 'p1', 'Определение', T3, true),
  oralPoint(1, R1, 'p2', 'Пример', T1, false),
  oralPoint(2, R2, 'p1', 'Спрос', T4, true),
  oralPoint(2, R2, 'p2', 'Предложение', T5, false),
  peek(2, R2, 'p2', 'Предложение', T6),
];

const META_EVENTS: LearningEvent[] = [
  questionEvent(1, 'self_rating', '2026-12-18T10:00:00Z', 2),
  questionEvent(1, 'self_rating', '2026-12-19T10:00:00Z', 3),
  questionEvent(1, 'exam_answer', '2026-12-20T12:00:00Z'),
  questionEvent(3, 'self_rating', '2026-12-17T10:00:00Z', 1),
];

function sheetResponse(questions: SheetQuestion[]) {
  return { examId: EXAM, mappingState: 'done', questions, toWrite: 2, units: 2, unwritable: 0, job: null };
}

beforeEach(() => {
  reads.fetchSheet.mockReset().mockResolvedValue(sheetResponse(QUESTIONS));
  reads.fetchSheetEvents.mockReset().mockResolvedValue(LINE_EVENTS);
  reads.fetchQuestionEvents.mockReset().mockResolvedValue(META_EVENTS);
  reads.examDates.mockReset().mockResolvedValue({ data: [{ id: EXAM, exam_date: '2027-01-20' }], error: null });
  reads.datesAsked = [];
});

describe('loadOralPlanItems', () => {
  it('builds the plan items of the questions with points and of those the lectures can write, and counts the rest', async () => {
    const [part] = await loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk');
    expect(part).toMatchObject({ examId: EXAM, subjectId: SUBJECT, withoutPoints: 3, examDate: '2027-01-20' });
    expect(part.items.map((item) => item.o)).toEqual([1, 2, 3, 7]);
    expect(part.items.every((item) => item.f === 'o' && item.s === SUBJECT)).toBe(true);
    expect(part.items.map((item) => item.m?.prepared)).toEqual([true, true, false, false]);
    expect(part.items[0]).toMatchObject({ id: QUESTIONS[0].question_id, tp: 1 });
    expect(part.items[2]).toMatchObject({ l: [], tp: 2 });
  });

  it('uses only the existing reads, and the sheet with the exam’s own date', async () => {
    await loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk');
    expect(reads.fetchSheet).toHaveBeenCalledWith(EXAM);
    // The line events of the written questions (sheetHashes), the self-checks and AI checks of the planned ones.
    expect(reads.fetchSheetEvents).toHaveBeenCalledWith([hash(1), hash(2), hash(5)]);
    expect(reads.fetchQuestionEvents).toHaveBeenCalledWith([hash(1), hash(2), hash(3), hash(7)], ['exam_answer', 'self_rating']);
    expect(reads.datesAsked).toEqual([['exams', 'id, exam_date', 'id', [EXAM]]]);
  });

  it('a question’s deciding lines: its essential points, else all of them, as UnitStates', async () => {
    const [part] = await loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk');
    // Q1: only the essential p1 decides; named on two days 23 h apart (erased), then checked after 5 days.
    expect(part.items[0].l).toEqual([
      {
        seen: 3, wrong: 0, firstDay: day(T1), lastDay: day(T3), seriesAt: Date.parse(T1), seriesDay: day(T1),
        twoDaysAt: Date.parse(T2), namedAt: Date.parse(T3), checks: 1, peekDay: null, wasTwoDays: false, cleanOkAt: Date.parse(T3),
      },
    ]);
    // Q2: no essential point, both decide; p1 named once today (rubbed), p2 missed and uncovered today.
    expect(part.items[1].l).toEqual([
      {
        seen: 1, wrong: 0, firstDay: TODAY, lastDay: TODAY, seriesAt: Date.parse(T4), seriesDay: TODAY, twoDaysAt: null,
        namedAt: Date.parse(T4), checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: Date.parse(T4),
      },
      {
        seen: 1, wrong: 1, firstDay: day(T5), lastDay: TODAY, seriesAt: null, seriesDay: null, twoDaysAt: null,
        namedAt: null, checks: 0, peekDay: TODAY, wasTwoDays: false, cleanOkAt: null,
      },
    ]);
  });

  it('the last self-check and AI check of each question', async () => {
    const [part] = await loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk');
    expect(part.items[0].m).toEqual({ sc: day('2026-12-19T10:00:00Z'), rating: 3, ac: day('2026-12-20T12:00:00Z'), prepared: true });
    expect(part.items[1].m).toEqual({ sc: null, rating: 0, ac: null, prepared: true });
    expect(part.items[2].m).toEqual({ sc: day('2026-12-17T10:00:00Z'), rating: 1, ac: null, prepared: false });
  });

  it('a list without lectures is all waiting: nothing in the plan, every question counted', async () => {
    reads.fetchSheet.mockResolvedValue(sheetResponse(QUESTIONS.map((item) => ({ ...item, coverage: null, rubric: null, rebuilt: false }))));
    const [part] = await loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk');
    expect(part.items).toEqual([]);
    expect(part.withoutPoints).toBe(7);
    expect(reads.fetchSheetEvents).not.toHaveBeenCalled();
    expect(reads.fetchQuestionEvents).not.toHaveBeenCalled();
  });

  it('several parts in their order, one per exam; nothing to read for none', async () => {
    reads.examDates.mockResolvedValue({ data: [{ id: EXAM, exam_date: '2027-01-20' }, { id: EXAM2, exam_date: null }], error: null });
    const parts = await loadOralPlanItems(
      [{ examId: EXAM2, subjectId: SUBJECT2 }, { examId: EXAM, subjectId: SUBJECT }, { examId: EXAM, subjectId: SUBJECT }],
      NOW,
      'Europe/Minsk',
    );
    expect(parts.map((part) => [part.examId, part.subjectId, part.examDate])).toEqual([[EXAM2, SUBJECT2, null], [EXAM, SUBJECT, '2027-01-20']]);
    expect(reads.fetchSheet).toHaveBeenCalledTimes(2);
    expect(await loadOralPlanItems([], NOW, 'Europe/Minsk')).toEqual([]);
  });

  it('dates that cannot be read are unknown (null), the rest goes on', async () => {
    reads.examDates.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    const [part] = await loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk');
    expect(part.examDate).toBeNull();
    expect(part.items).toHaveLength(4);
  });

  it('a sheet that could not be fetched is the network; another failure is not', async () => {
    reads.fetchSheet.mockRejectedValue(new SheetError('Шпаргалка не загрузилась.'));
    await expect(loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk')).rejects.toMatchObject({ code: 'network' });
    reads.fetchSheet.mockResolvedValue(sheetResponse(QUESTIONS));
    reads.fetchSheetEvents.mockRejectedValue(new LearningLoadError('Не удалось загрузить историю ответов.', null));
    await expect(loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk')).rejects.toMatchObject({ code: 'network' });
    reads.fetchSheetEvents.mockRejectedValue(new LearningLoadError('История ответов не загружена: войдите в аккаунт.', '42501'));
    await expect(loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk')).rejects.toMatchObject({ code: 'unknown' });
    reads.fetchSheet.mockRejectedValue(new SheetError('Нет доступа.', { status: 403 }));
    await expect(loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk')).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('unitFromLine and oralMeta', () => {
  const status = (extra: Partial<LineStatus>): LineStatus => ({
    state: 'fresh', history: [], erasableFrom: null, erasedAt: null, erasedOn: null, lastNamedAt: null, dueAt: null,
    wasErasedOn: null, wasErasedAt: null, peekedToday: false, checks: 0, ...extra,
  });

  it('a fresh line is new; uncovered today it was seen today and peeked', () => {
    expect(unitFromLine(status({}), TODAY)).toMatchObject({ seen: 0, firstDay: null, lastDay: null, peekDay: null });
    expect(unitFromLine(status({ peekedToday: true }), TODAY)).toMatchObject({ seen: 0, firstDay: TODAY, lastDay: TODAY, peekDay: TODAY });
  });

  it('a line back after a miss was out of the figure; a naming after a peek is a peek day, not a series', () => {
    const returned = unitFromLine(
      status({
        state: 'returned',
        wasErasedOn: '2026-12-15',
        history: [
          { at: T1, date: '2026-12-14', outcome: 'named', word: 'named', sessionId: 'a' },
          { at: T2, date: '2026-12-15', outcome: 'named', word: 'named', sessionId: 'b' },
          { at: T3, date: '2026-12-20', outcome: 'missed', word: 'missing', sessionId: 'c' },
          { at: T4, date: '2026-12-21', outcome: 'skipped', word: 'after_peek', sessionId: 'd' },
        ],
      }),
      TODAY,
    );
    expect(returned).toMatchObject({
      seen: 4, wrong: 1, seriesAt: null, twoDaysAt: null, namedAt: null, wasTwoDays: true, peekDay: '2026-12-21', cleanOkAt: Date.parse(T2),
      firstDay: '2026-12-14', lastDay: '2026-12-21',
    });
  });

  it('the latest self-rating wins, whatever order the events come in', () => {
    const events = [questionEvent(9, 'self_rating', '2026-12-19T10:00:00Z', 3), questionEvent(9, 'self_rating', '2026-12-18T10:00:00Z', 1)];
    expect(oralMeta(hash(9), events, true)).toEqual({ sc: day('2026-12-19T10:00:00Z'), rating: 3, ac: null, prepared: true });
    expect(oralMeta(hash(8), events, false)).toEqual({ sc: null, rating: 0, ac: null, prepared: false });
  });
});
