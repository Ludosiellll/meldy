/**
 * Synthetic data for the exam's screens: tests and the screenshot harness. Plausible shapes of types/container.ts
 * (contracts/container/*.json are the real samples): an exam «Аккредитация» of four subjects with variants, a mixed
 * one, questions of every kind (one option, several, a short answer, code), the plan's input and a day's plan built by
 * hand. Nothing here is real student data.
 */
import type {
  ContainerSummary,
  DayPlan,
  OverviewContainer,
  PlanInput,
  PlanItem,
  SummarySubject,
  TestItem,
  UnitState,
} from '../../../types/container';
import type { ContainerData } from '../../../lib/containers/hooks';

export const CONTAINER = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
export const SUBJECT_CS = '69ead689-38d6-4350-bc5d-13d273f8b9b2';
export const SUBJECT_DB = '590a774c-7a67-4b13-a944-cf9a2f0e9d9b';
export const SUBJECT_NET = '7d1e2c3b-4a5f-4e6d-8c7b-9a0b1c2d3e4f';
export const SUBJECT_OS = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
export const SUBJECT_ORAL = '93c5b45c-df3d-4c94-b305-960744c757be';
export const ORAL_EXAM = 'c0390f9c-787d-4d0e-a82d-9efa069bfe11';
export const TODAY = '2026-10-10';

export function unit(overrides: Partial<UnitState> = {}): UnitState {
  return {
    seen: 0,
    wrong: 0,
    firstDay: null,
    lastDay: null,
    seriesAt: null,
    seriesDay: null,
    twoDaysAt: null,
    namedAt: null,
    checks: 0,
    peekDay: null,
    wasTwoDays: false,
    cleanOkAt: null,
    ...overrides,
  };
}

export function subject(overrides: Partial<SummarySubject> = {}): SummarySubject {
  return {
    id: SUBJECT_CS,
    position: 1,
    title: 'Программирование на C#',
    exam_date: '2026-10-28',
    topic_titles: ['2.2 Сборки. Атрибуты. Директивы', '2.3 Методы', '2.4 Делегаты и события', '2.5 Обобщения'],
    oral: null,
    keyed: 240,
    no_key: 0,
    seen: 180,
    two_days: 61,
    open_errors: 21,
    seen_today: 0,
    doubted: 0,
    stale: 0,
    topics: [
      { topic: 1, keyed: 18, seen: 18, two_days: 12, open_errors: 2 },
      { topic: 2, keyed: 20, seen: 14, two_days: 8, open_errors: 0 },
      { topic: 3, keyed: 22, seen: 0, two_days: 0, open_errors: 0 },
      { topic: 4, keyed: 24, seen: 0, two_days: 0, open_errors: 0 },
    ],
    kinds: { single: 230, multiple: 8, short: 2 },
    ...overrides,
  };
}

export function fourSubjects(): SummarySubject[] {
  return [
    subject(),
    subject({ id: SUBJECT_DB, position: 2, title: 'Базы данных', seen: 150, two_days: 40, open_errors: 9, topic_titles: ['3.1 Модель данных', '3.2 Индексы'], topics: [{ topic: 1, keyed: 120, seen: 90, two_days: 30, open_errors: 5 }, { topic: 2, keyed: 120, seen: 60, two_days: 10, open_errors: 4 }] }),
    subject({ id: SUBJECT_NET, position: 3, title: 'Компьютерные сети', keyed: 236, seen: 50, two_days: 22, open_errors: 4, topic_titles: ['3.1 Модель OSI'], topics: [{ topic: 1, keyed: 236, seen: 50, two_days: 22, open_errors: 4 }] }),
    subject({ id: SUBJECT_OS, position: 4, title: 'Операционные системы', keyed: 240, no_key: 4, seen: 30, two_days: 20, open_errors: 3, topic_titles: ['1.1 Процессы'], topics: [{ topic: 1, keyed: 240, seen: 30, two_days: 20, open_errors: 3 }] }),
  ];
}

export function summary(overrides: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    v: 1,
    day: TODAY,
    id: CONTAINER,
    title: 'Аккредитация',
    exam_date: '2026-10-28',
    role: 'owner',
    created_at: '2026-10-01T10:00:00+00:00',
    first_plan_day: '2026-10-01',
    settings: { minutes_per_day: 45, study_weekdays: 127 },
    subjects: fourSubjects(),
    items_version: { count: 960, updated_at: '2026-10-01T10:05:00+00:00' },
    answers_today: 0,
    key_changes_unseen: 0,
    mock_runs: [],
    owner: { members: 0, doubts_open: 0, links: [] },
    ...overrides,
  };
}

export function overviewContainer(overrides: Partial<OverviewContainer> = {}): OverviewContainer {
  const subjects = fourSubjects().map((s) => ({
    id: s.id,
    position: s.position,
    title: s.title,
    exam_date: s.exam_date,
    oral_exam_id: null,
    has_oral: false,
    keyed: s.keyed,
    no_key: s.no_key,
    seen: s.seen,
    two_days: s.two_days,
    open_errors: s.open_errors,
    seen_today: s.seen_today,
    doubted: s.doubted,
    stale: s.stale,
  }));
  return {
    id: CONTAINER,
    title: 'Аккредитация',
    exam_date: '2026-10-28',
    created_at: '2026-10-01T10:00:00+00:00',
    role: 'owner',
    items: 960,
    items_updated_at: '2026-10-01T10:05:00+00:00',
    subjects,
    answers_today: 0,
    settings: { minutes_per_day: 45, study_weekdays: 127 },
    ...overrides,
  };
}

export function item(overrides: Partial<TestItem> & { id: string }): TestItem {
  return {
    container_id: CONTAINER,
    subject_id: SUBJECT_DB,
    position: 1,
    file_no: '1',
    topic: 1,
    kind: 'single',
    stem: 'Вопрос',
    options: ['А', 'Б', 'В', 'Г'],
    correct: [0],
    answers: [],
    key_source: 'bold',
    code: false,
    keep_order: false,
    flags: [],
    rev: 1,
    updated_at: '2026-10-01T10:05:00+00:00',
    ...overrides,
  };
}

/** Questions of «Базы данных» of every kind. */
export function dbItems(): TestItem[] {
  return [
    item({
      id: 'q-iso',
      position: 37,
      file_no: '37',
      topic: 2,
      stem: 'Какой уровень изоляции не допускает фантомного чтения?\nSET TRANSACTION ISOLATION LEVEL ...;',
      code: true,
      options: ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'],
      correct: [3],
    }),
    item({
      id: 'q-multi',
      position: 12,
      file_no: '12',
      kind: 'multiple',
      stem: 'Какие из перечисленных команд относятся к DDL?',
      options: ['CREATE', 'SELECT', 'ALTER', 'DROP', 'INSERT'],
      correct: [0, 2, 3],
    }),
    item({
      id: 'q-short',
      position: 44,
      file_no: '44',
      kind: 'short',
      stem: 'Впишите ключевое слово, которое отменяет транзакцию.',
      options: [],
      correct: [],
      answers: ['ROLLBACK'],
      key_source: 'gift',
    }),
    item({
      id: 'q-code',
      position: 7,
      file_no: '7',
      stem: 'Что выведет программа?\nint a = 7;\nint b = 2;\ndouble c = a / b;\nConsole.WriteLine(c); // целочисленное деление выполняется до приведения к double',
      code: true,
      options: ['3,5', '4', '3', 'Ошибка компиляции'],
      correct: [2],
    }),
    item({
      id: 'q-plain',
      position: 3,
      file_no: '3',
      stem: 'Какая нормальная форма требует отсутствия транзитивных зависимостей?',
      options: ['Первая', 'Вторая', 'Третья', 'Все перечисленные'],
      correct: [2],
      key_source: 'manual',
    }),
  ];
}

export function planItemsFor(items: TestItem[], states: Record<string, UnitState> = {}): PlanItem[] {
  return items.map((entry) => ({ id: entry.id, s: entry.subject_id, f: 't' as const, tp: entry.topic, o: entry.position, ...(states[entry.id] ? { u: states[entry.id] } : {}) }));
}

export function dayPlan(overrides: Partial<DayPlan> = {}): DayPlan {
  return {
    day: TODAY,
    state: 'study',
    sessions: [
      { subjectId: SUBJECT_CS, kind: 'answer', ids: Array.from({ length: 20 }, (_, i) => `cs-${i}`), estSec: 540 },
      { subjectId: SUBJECT_DB, kind: 'answer', ids: dbItems().map((entry) => entry.id), estSec: 180 },
    ],
    counts: { newItems: 30, reviews: 60, oral: 0, aiChecks: 0, estSec: 2700, leftSec: 2700, doneSec: 0 },
    postponed: {},
    coverage: { unseen: 550, floor: 30, lastNewDay: '2026-10-23', seenByDateEst: 960, neededMin: 45 },
    window: { from: '2026-10-24', days: 4, inWindow: false },
    units: null,
    figure: { inPlan: 960, twoDays: 143, seen: 410, errors: 37, selfKnow: 0 },
    perSubject: [
      { subjectId: SUBJECT_CS, estSec: 720, items: 25, figure: { inPlan: 240, twoDays: 61, seen: 180, errors: 21 } },
      { subjectId: SUBJECT_DB, estSec: 720, items: 25, figure: { inPlan: 240, twoDays: 40, seen: 150, errors: 9 } },
      { subjectId: SUBJECT_NET, estSec: 600, items: 20, figure: { inPlan: 236, twoDays: 22, seen: 50, errors: 4 } },
      { subjectId: SUBJECT_OS, estSec: 660, items: 20, figure: { inPlan: 240, twoDays: 20, seen: 30, errors: 3 } },
    ],
    next: null,
    firstCountDay: null,
    lines: [],
    ...overrides,
  };
}

export type PlanInputWithPlan = PlanInput & { __plan?: DayPlan };

export function planInput(overrides: Partial<PlanInput> = {}, plan?: DayPlan): PlanInputWithPlan {
  const input: PlanInputWithPlan = {
    v: 1,
    now: Date.parse('2026-10-10T18:00:00+03:00'),
    tz: 'Europe/Minsk',
    containerId: CONTAINER,
    budgetMin: 45,
    firstPlanDay: '2026-10-01',
    subjects: fourSubjects().map((s) => ({ id: s.id, title: s.title, date: s.exam_date })),
    items: planItemsFor(dbItems()),
    today: { firstAt: null, doneSec: 0, newDone: {} },
    pace: null,
    ai: { left: 100, resetsAt: Date.parse('2026-10-11T03:00:00+03:00') },
    ...overrides,
  };
  if (plan) input.__plan = plan;
  return input;
}

export function containerData(p: { summary?: ContainerSummary; plan?: DayPlan; input?: Partial<PlanInput>; items?: TestItem[]; oralWithoutPoints?: number } = {}): ContainerData {
  const items = p.items ?? dbItems();
  return {
    summary: p.summary ?? summary(),
    planInput: planInput({ items: planItemsFor(items), ...(p.input ?? {}) }, p.plan ?? dayPlan()),
    items: new Map(items.map((entry) => [entry.id, entry])),
    oralWithoutPoints: p.oralWithoutPoints ?? 0,
  };
}
