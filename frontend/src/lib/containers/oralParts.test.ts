import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningEvent } from '../../types/learning';
import type { PlanInput } from '../../types/container';
import { localDayOf, type SheetQuestion } from '../exams/cheatSheet';
import { addDays } from './time';
import oralPartsSource from './oralParts.ts?raw';
import cheatSheetSource from '../exams/cheatSheet.ts?raw';
import sheetResponseSource from '../exams/sheetResponse.ts?raw';
import readinessSource from '../learning/readiness.ts?raw';
import learningTypesSource from '../../types/learning.ts?raw';

/**
 * The pure core of the oral plan (oralParts.ts): the site's loadOralPlanItems runs it over its reads (mocked here, as in
 * oralPlan.test.ts), the Telegram bot over `bot_oral_inputs`; the cheat sheet's own rules run for real.
 */
const reads = vi.hoisted(() => ({ fetchSheet: vi.fn(), fetchSheetEvents: vi.fn(), fetchQuestionEvents: vi.fn(), examDates: vi.fn() }));
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
  supabase: { from: () => ({ select: () => ({ in: (_column: string, ids: string[]) => reads.examDates(ids) }) }) },
}));

import * as cheatSheetApi from '../../api/cheatSheet';
import * as sheetResponse from '../exams/sheetResponse';
import * as oralPlan from './oralPlan';
import {
  decidingLines, IN_PLAN, oralMeta, oralPartsFromInputs, oralPlanItems, oralPlanPart, oralSheetPlan, unitFromLine, withOralDates,
  type OralPlanPart,
} from './oralParts';

const EXAM = '0fe86dc1-dc3c-482a-9b76-c06c11bc3cc5';
const SUBJECT = '93c5b45c-df3d-4c94-b305-960744c757be';
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const hash = (n: number) => String(n).repeat(32).slice(0, 32);
const NOW = Date.parse('2026-12-21T15:00:00Z');
const TODAY = localDayOf(NOW);
const day = (iso: string) => localDayOf(Date.parse(iso));

function question(n: number, extra: Partial<SheetQuestion>): SheetQuestion {
  return {
    question_id: `${n}0000000-0000-4000-8000-00000000000${n}`, position: n, label: String(n), section: n <= 2 ? 1 : 2,
    text: `Вопрос ${n}`, question_hash: hash(n), coverage: 'full', coverage_method: 'llm', coverage_reason: '', missing_note: '',
    rubric: null, ...extra,
  };
}
const point = (id: string, title: string, essential: boolean) => ({ id, title, short: '', essential, source_quote: 'цитата', source_ids: [] });
const rubric = (id: string, points: ReturnType<typeof point>[], coverage: 'full' | 'partial' | 'none' = 'full') => ({
  rubric_id: id, built_at: '2026-12-10T10:00:00Z', coverage, coverage_note: '', materials: [], points,
});
const QUESTIONS: SheetQuestion[] = [
  question(1, { rubric: rubric(R1, [point('p1', 'Определение', true), point('p2', 'Пример', false)]) }),
  question(2, { rubric: rubric(R2, [point('p1', 'Спрос', false), point('p2', 'Предложение', false)]) }),
  question(3, { coverage: 'partial' }),
  question(4, { coverage: null, coverage_method: null }),
  question(5, { coverage: 'none' }),
  question(7, { rebuilt: true }),
  question(6, { coverage: 'unverified', coverage_method: 'lexical' }),
];

let eventId = 0;
function line(kind: 'oral_point' | 'sheet_peek', q: number, rubricId: string, pointId: string, title: string, at: string, named = true): LearningEvent {
  eventId += 1;
  return {
    id: `e${String(eventId).padStart(4, '0')}`, created_at: at, local_date: day(at), material_id: null, kind,
    item_key: `${kind === 'oral_point' ? 'oral' : 'peek'}:${rubricId}:${pointId}`, correct: kind === 'oral_point' ? named : null,
    score: null, confidence: null, source_ids: [], session_id: kind === 'oral_point' ? `s-${at}` : null,
    payload: { question_hash: hash(q), rubric_id: rubricId, point_id: pointId, title, status: named ? 'covered' : 'missing' },
  };
}
function meta(q: number, kind: 'self_rating' | 'exam_answer', at: string, confidence: 1 | 2 | 3 | null = null): LearningEvent {
  eventId += 1;
  return {
    id: `e${String(eventId).padStart(4, '0')}`, created_at: at, local_date: day(at), material_id: null, kind, item_key: `q:${hash(q)}`,
    correct: kind === 'exam_answer' ? true : null, score: null, confidence, source_ids: [], session_id: null, payload: {},
  };
}
const LINE_EVENTS: LearningEvent[] = [
  line('oral_point', 1, R1, 'p1', 'Определение', '2026-12-14T10:00:00Z'),
  line('oral_point', 1, R1, 'p1', 'Определение', '2026-12-15T09:00:00Z'),
  line('oral_point', 1, R1, 'p1', 'Определение', '2026-12-20T12:00:00Z'),
  line('oral_point', 2, R2, 'p1', 'Спрос', '2026-12-21T13:00:00Z'),
  line('oral_point', 2, R2, 'p2', 'Предложение', '2026-12-19T10:00:00Z', false),
  line('sheet_peek', 2, R2, 'p2', 'Предложение', '2026-12-21T14:00:00Z'),
];
const META_EVENTS: LearningEvent[] = [meta(1, 'self_rating', '2026-12-19T10:00:00Z', 3), meta(1, 'exam_answer', '2026-12-20T12:00:00Z'), meta(3, 'self_rating', '2026-12-17T10:00:00Z', 1)];
const sheetResponseOf = (questions: SheetQuestion[]) => ({ examId: EXAM, mappingState: 'done', questions, toWrite: 2, units: 2, unwritable: 0, job: null });

beforeEach(() => {
  reads.fetchSheet.mockReset().mockResolvedValue(sheetResponseOf(QUESTIONS));
  reads.fetchSheetEvents.mockReset().mockResolvedValue(LINE_EVENTS);
  reads.fetchQuestionEvents.mockReset().mockResolvedValue(META_EVENTS);
  reads.examDates.mockReset().mockResolvedValue({ data: [{ id: EXAM, exam_date: '2026-12-23' }], error: null });
});

describe('the site and the core', () => {
  it('loadOralPlanItems gives exactly the core’s part over the same reads', async () => {
    const [site] = await oralPlan.loadOralPlanItems([{ examId: EXAM, subjectId: SUBJECT }], NOW, 'Europe/Minsk');
    const core = oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, '2026-12-23', NOW, { questions: QUESTIONS }, LINE_EVENTS, META_EVENTS);
    expect(site).toEqual(core);
    expect(core.items.map((item) => item.o)).toEqual([1, 2, 3, 7]);
    expect(core.withoutPoints).toBe(3);
    // The reads asked by the two steps: line events of the written questions, then the planned questions' checks.
    expect(reads.fetchSheetEvents).toHaveBeenCalledWith([hash(1), hash(2)]);
    expect(reads.fetchQuestionEvents).toHaveBeenCalledWith([hash(1), hash(2), hash(3), hash(7)], ['exam_answer', 'self_rating']);
  });

  it('oralPlan.ts re-exports the core’s names (the same functions)', () => {
    expect(oralPlan.unitFromLine).toBe(unitFromLine);
    expect(oralPlan.oralMeta).toBe(oralMeta);
    expect(oralPlan.decidingLines).toBe(decidingLines);
    expect(oralPlan.IN_PLAN).toBe(IN_PLAN);
    expect([...IN_PLAN].sort()).toEqual(['lines', 'rebuilt', 'unwritten']);
  });

  it('api/cheatSheet.ts re-exports the pure parser and its error (one class: instanceof holds everywhere)', () => {
    expect(cheatSheetApi.parseSheetResponse).toBe(sheetResponse.parseSheetResponse);
    expect(cheatSheetApi.parseSheetQuestion).toBe(sheetResponse.parseSheetQuestion);
    expect(cheatSheetApi.SheetError).toBe(sheetResponse.SheetError);
    expect(cheatSheetApi.SHEET_LOAD_MESSAGE).toBe(sheetResponse.SHEET_LOAD_MESSAGE);
    expect(new sheetResponse.SheetError('x')).toBeInstanceOf(cheatSheetApi.SheetError);
  });
});

describe('oralSheetPlan and oralPlanItems', () => {
  it('the planned questions in the sheet’s order, whose checks are needed, the rest counted', () => {
    const plan = oralSheetPlan({ questions: QUESTIONS }, LINE_EVENTS, NOW, null);
    expect(plan.planned.map(({ question: q, block }) => [q.position, block.kind])).toEqual([[1, 'lines'], [2, 'lines'], [3, 'unwritten'], [7, 'rebuilt']]);
    expect(plan.metaHashes).toEqual([hash(1), hash(2), hash(3), hash(7)]);
    expect(plan.withoutPoints).toBe(3);
    expect(plan.today).toBe(TODAY);
    const items = oralPlanItems(SUBJECT, plan, META_EVENTS);
    expect(items[0]).toMatchObject({ id: QUESTIONS[0].question_id, s: SUBJECT, f: 'o', tp: 1, o: 1, m: { rating: 3, prepared: true } });
    expect(items[0].l).toHaveLength(1); // only the essential point decides
    expect(items[1].l).toHaveLength(2); // none essential: both decide
    expect(items[2]).toMatchObject({ l: [], m: { rating: 1, prepared: false } });
  });

  it('a question without a hash is planned but asks for no checks', () => {
    const plan = oralSheetPlan({ questions: [question(3, { coverage: 'partial', question_hash: '' })] }, [], NOW, null);
    expect(plan.planned).toHaveLength(1);
    expect(plan.metaHashes).toEqual([]);
  });
});

describe('today: the plan’s day for a caller in another zone', () => {
  const shift = (events: LearningEvent[], by: number) => events.map((event) => ({ ...event, local_date: addDays(event.local_date, by) }));
  const DAY_KEYS = ['firstDay', 'lastDay', 'peekDay', 'seriesDay'] as const;
  function shiftPart(part: OralPlanPart, by: number): OralPlanPart {
    const move = (value: string | null | undefined) => (typeof value === 'string' ? addDays(value, by) : value);
    return {
      ...part,
      examDate: move(part.examDate),
      items: part.items.map((item) => ({
        ...item,
        l: item.l?.map((unit) => ({ ...unit, ...Object.fromEntries(DAY_KEYS.map((key) => [key, move(unit[key])])) })),
        m: item.m ? { ...item.m, sc: move(item.m.sc) ?? null, ac: move(item.m.ac) ?? null } : item.m,
      })),
    };
  }

  it('the device’s own day changes nothing; a malformed day is ignored', () => {
    const plain = oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, '2026-12-23', NOW, { questions: QUESTIONS }, LINE_EVENTS, META_EVENTS);
    expect(oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, '2026-12-23', NOW, { questions: QUESTIONS }, LINE_EVENTS, META_EVENTS, { today: TODAY })).toEqual(plain);
    expect(oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, '2026-12-23', NOW, { questions: QUESTIONS }, LINE_EVENTS, META_EVENTS, { today: '21.12.2026' })).toEqual(plain);
  });

  it.each([1, -1, 2])('every local day moved by %i days and read on the plan’s day moved as much: the same part, its days moved', (by) => {
    const plain = oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, '2026-12-23', NOW, { questions: QUESTIONS }, LINE_EVENTS, META_EVENTS);
    const moved = oralPlanPart(
      { examId: EXAM, subjectId: SUBJECT }, addDays('2026-12-23', by), NOW, { questions: QUESTIONS },
      shift(LINE_EVENTS, by), shift(META_EVENTS, by), { today: addDays(TODAY, by) },
    );
    expect(moved).toEqual(shiftPart(plain, by));
  });

  it('a peek on the user’s day counts when the device is still on the day before', () => {
    const tomorrow = addDays(TODAY, 1);
    const peek = { ...line('sheet_peek', 2, R2, 'p1', 'Спрос', '2026-12-21T14:30:00Z'), local_date: tomorrow };
    const events = [...LINE_EVENTS, peek];
    const device = oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, null, NOW, { questions: QUESTIONS }, events, []);
    const user = oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, null, NOW, { questions: QUESTIONS }, events, [], { today: tomorrow });
    expect(device.items[1].l?.[0].peekDay).not.toBe(tomorrow);
    expect(user.items[1].l?.[0]).toMatchObject({ peekDay: tomorrow, lastDay: tomorrow });
    // Its namings keep their own days.
    expect(user.items[0].l?.[0]).toMatchObject({ firstDay: day('2026-12-14T10:00:00Z'), seriesDay: day('2026-12-14T10:00:00Z') });
  });
});

describe('withOralDates', () => {
  const input = (items: PlanInput['items']): PlanInput => ({
    v: 1, now: NOW, tz: 'Europe/Minsk', containerId: 'c1', budgetMin: 60, firstPlanDay: '2026-12-01',
    subjects: [{ id: 's1', title: 'Экономика', date: '2026-12-24' }, { id: 's2', title: 'Право', date: '2026-12-26' },
      { id: 's3', title: 'История', date: null }],
    items, today: { firstAt: null, doneSec: 0, newDone: {} }, pace: null, ai: null,
  });
  const oralItem = (s: string) => ({ id: `o-${s}`, s, f: 'o' as const, tp: null, o: 1, l: [], m: { sc: null, rating: 0 as const, ac: null, prepared: false } });
  const testItem = (s: string) => ({ id: `t-${s}`, s, f: 't' as const, tp: null, o: 1 });

  it('a subject with only an oral part takes its oral exam’s date; one with tests keeps its own (hooks.ts buildData)', () => {
    const parts = [
      { subjectId: 's1', examDate: '2026-12-23' }, { subjectId: 's2', examDate: '2026-12-20' }, { subjectId: 's3', examDate: null },
    ];
    const out = withOralDates(input([oralItem('s1'), testItem('s2'), oralItem('s2'), oralItem('s3')]), parts);
    expect(out.subjects.map((subject) => subject.date)).toEqual(['2026-12-23', '2026-12-26', null]);
    expect(withOralDates(input([]), []).subjects.map((subject) => subject.date)).toEqual(['2026-12-24', '2026-12-26', null]);
  });
});

describe('oralPartsFromInputs (the bot’s read)', () => {
  const wireSheet = {
    exam_id: EXAM, mapping_state: 'done', to_write: 2, units: 2, unwritable: 0, job: null,
    questions: QUESTIONS.map((q) => ({ ...q, rubric: q.rubric ? { ...q.rubric, points: q.rubric.points.map((p) => ({ ...p, anchors: [] })) } : null })),
  };
  const part = (extra: Record<string, unknown>) => ({
    container_id: 'c1', subject_id: SUBJECT, exam_id: EXAM, exam_date: '2026-12-23', questions: 7, capped: false, sheet: wireSheet,
    line_events: LINE_EVENTS, meta_events: META_EVENTS, ...extra,
  });

  it('parses each part and runs the core; repeats, capped parts, parts without ids or a readable sheet are left out', () => {
    const raw = {
      linked: true, cap: 300,
      parts: [
        part({}),
        part({ subject_id: 's-other' }), // the same exam again: the first wins
        part({ exam_id: 'e-capped', capped: true, sheet: null }),
        part({ exam_id: 'e-no-subject', subject_id: '' }),
        part({ exam_id: 'e-bad', sheet: { questions: 'none' } }),
        part({ exam_id: 'e-null', sheet: null }),
        'not a part',
        part({ exam_id: 'e-second', exam_date: null, line_events: [null, 5, ...LINE_EVENTS], meta_events: 'none' }),
      ],
    };
    const parts = oralPartsFromInputs(raw, NOW);
    expect(parts.map((p) => [p.examId, p.subjectId, p.examDate])).toEqual([[EXAM, SUBJECT, '2026-12-23'], ['e-second', SUBJECT, null]]);
    expect(parts[0]).toEqual(oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, '2026-12-23', NOW, { questions: QUESTIONS }, LINE_EVENTS, META_EVENTS));
    expect(parts[1]).toEqual(oralPlanPart({ examId: 'e-second', subjectId: SUBJECT }, null, NOW, { questions: QUESTIONS }, LINE_EVENTS, []));
    expect(oralPartsFromInputs({ linked: false }, NOW)).toEqual([]);
    expect(oralPartsFromInputs(null, NOW)).toEqual([]);
  });

  it('passes the plan’s day on', () => {
    const tomorrow = addDays(TODAY, 1);
    expect(oralPartsFromInputs({ parts: [part({})] }, NOW, { today: tomorrow })).toEqual([
      oralPlanPart({ examId: EXAM, subjectId: SUBJECT }, '2026-12-23', NOW, { questions: QUESTIONS }, LINE_EVENTS, META_EVENTS, { today: tomorrow }),
    ]);
  });
});

describe('the core loads in plain Node (the bot copies it into supabase/functions/_shared/plan/)', () => {
  const SOURCES: Record<string, { source: string; imports: RegExp }> = {
    'lib/containers/oralParts.ts': { source: oralPartsSource, imports: /^(\.\.\/exams\/(cheatSheet|sheetResponse)|\.\.\/\.\.\/types\/(learning|container)|\.\/time)\.ts$/ },
    'lib/exams/cheatSheet.ts': { source: cheatSheetSource, imports: /^(\.\.\/\.\.\/types\/learning|\.\.\/learning\/readiness)\.ts$/ },
    'lib/exams/sheetResponse.ts': { source: sheetResponseSource, imports: /^\.\/cheatSheet\.ts$/ },
    'lib/learning/readiness.ts': { source: readinessSource, imports: /^\.\.\/\.\.\/types\/learning\.ts$/ },
    'types/learning.ts': { source: learningTypesSource, imports: /^$/ },
  };
  for (const [file, { source, imports }] of Object.entries(SOURCES)) {
    it(`${file}: relative .ts imports of the pure set only; no network, storage, browser or Supabase`, () => {
      expect(source.length).toBeGreaterThan(200);
      for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
        expect(imports.test(m[1]), `${file}: ${m[1]}`).toBe(true);
      }
      for (const forbidden of [/\bsupabase\b\s*\./, /\bfetch\s*\(/, /\b(window|document|localStorage|sessionStorage|navigator|indexedDB)\s*[.[]/,
        /\bimport\.meta\b/, /\brequire\s*\(|\bimport\s*\(/, /\benum\s/, /\bnamespace\s/]) {
        expect(forbidden.test(source), `${file}: ${forbidden}`).toBe(false);
      }
    });
  }
});
