/**
 * The exam container's samples (contracts/container/*.json) against its shared types (./container.ts).
 *
 * At compile time (tsc -b): a JSON module has no literal types ('owner' is a string, a tuple is an array), so each
 * sample must fit Json<T>, its type with literals widened, and may hold no field the type lacks, at any depth
 * (Extra). A missing field, a wrong primitive or a field outside the contract does not compile.
 * At run time (Vitest): the literal values (versions, roles, kinds, statuses, steps), the tuple lengths of plan_inputs
 * (PlanItemRow 7, PlanStateRow 14), and one story across the files: the same container «Зимняя сессия», subjects,
 * items, states and counts everywhere; the stored items are the importer's real output for the same file.
 */
import { describe, expect, it } from 'vitest';
import {
  QUEUE_DONE,
  QUEUE_DROP_AND_REPORT,
  TEST_ITEM_COLUMNS,
  type AnswerResult,
  type AnswerState,
  type AnswerStatus,
  type AnswerStep,
  type BankItemKind,
  type BankParseResult,
  type ContainerRole,
  type ContainerSummary,
  type ContainersOverview,
  type DoubtRow,
  type ItemKind,
  type KeySource,
  type LinkPreview,
  type LinkPreviewStatus,
  type MockRunResult,
  type OralSyncResponse,
  type PlanCls,
  type PlanInputsWire,
  type PlanItemRow,
  type PlanStateRow,
  type RecordAnswersResponse,
  type SubjectFacts,
  type TestItem,
} from './container';
import overviewJson from '../../../contracts/container/overview.json';
import summaryJson from '../../../contracts/container/summary.json';
import planInputsJson from '../../../contracts/container/plan_inputs.json';
import recordResultJson from '../../../contracts/container/record_result.json';
import itemsPageJson from '../../../contracts/container/items_page.json';
import mockResultJson from '../../../contracts/container/mock_result.json';
import linkPreviewJson from '../../../contracts/container/link_preview.json';
import doubtsJson from '../../../contracts/container/doubts.json';
import oralSyncJson from '../../../contracts/container/oral_sync.json';
import parseTwoSubjectsJson from '../../../contracts/container/parse_bank_two_subjects.json';
import parseOpenJson from '../../../contracts/container/parse_bank_open.json';

// ── Compile-time shape checks ─────────────────────────────────────────────────────────────────────────────────

type Primitive = string | number | boolean | null | undefined;
/** What a JSON module gives a value of type T: literals widened to their primitives, tuples to arrays. */
type Json<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null | undefined
        ? T
        : T extends readonly (infer E)[]
          ? Json<E>[]
          : T extends object
            ? { [K in keyof T]: Json<T[K]> }
            : T;
type ObjectPart<T> = Exclude<T, Primitive | readonly unknown[]>;
type KeysOf<T> = T extends unknown ? keyof T : never;
type FieldOf<T, K> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;
/** The fields of A, at any depth, that T has no place for (never when there are none). */
type Extra<A, T> = unknown extends T
  ? never
  : A extends readonly (infer E)[]
    ? Extra<E, Extract<T, readonly unknown[]>[number]>
    : A extends object
      ? { [K in keyof A]-?: K extends KeysOf<ObjectPart<T>> ? Extra<A[K], FieldOf<ObjectPart<T>, K>> : K }[keyof A]
      : never;
type Exact<A, T> = [Extra<A, T>] extends [never] ? true : { fieldsOutsideTheContract: Extra<A, T> };

/** A sample as its contract type, once tsc has checked that it fits T (literals widened) and holds nothing else. */
function sample<T>() {
  return <A extends Json<T>>(json: A, exact: Exact<A, T>): T => {
    void exact;
    return json as unknown as T;
  };
}

const overview = sample<ContainersOverview>()(overviewJson, true);
const summary = sample<ContainerSummary>()(summaryJson, true);
const plan = sample<PlanInputsWire>()(planInputsJson, true);
const recorded = sample<RecordAnswersResponse>()(recordResultJson, true);
const itemsPage = sample<TestItem[]>()(itemsPageJson, true);
const mock = sample<MockRunResult>()(mockResultJson, true);
const preview = sample<LinkPreview>()(linkPreviewJson, true);
const doubts = sample<DoubtRow[]>()(doubtsJson, true);
const oralSync = sample<OralSyncResponse>()(oralSyncJson, true);
const parseTwoSubjects = sample<BankParseResult>()(parseTwoSubjectsJson, true);
const parseOpen = sample<BankParseResult>()(parseOpenJson, true);

type Equal<X, Y> = (<V>() => V extends X ? 1 : 2) extends <V>() => V extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
/** What the run-time checks below assume about the tuples. */
export type TupleChecks = [
  Expect<Equal<PlanItemRow['length'], 7>>,
  Expect<Equal<PlanStateRow['length'], 14>>,
  Expect<Equal<PlanItemRow[4], 0 | 1 | 2>>,
  Expect<Equal<PlanItemRow[6], 0 | 1>>,
  Expect<Equal<PlanStateRow[5], 0 | 1 | 2 | null>>,
  Expect<Equal<PlanStateRow[12], 0 | 1>>,
];

/** Every member of a union, at run time: tsc fails when one is missing or one is not a member. */
const every = <U extends string>(members: Record<U, true>): readonly string[] => Object.keys(members);

const ROLES = every<ContainerRole>({ owner: true, member: true });
const ITEM_KINDS = every<ItemKind>({ single: true, multiple: true, short: true });
const KEY_SOURCES = every<KeySource>({
  bold: true, underline: true, italic: true, color: true, highlight: true, shade: true, marker: true, key_column: true,
  answer_line: true, key_list: true, key_text: true, gift: true, first_option: true, manual: true, none: true,
});
const STATUSES = every<AnswerStatus>({
  saved: true, late: true, duplicate: true, conflict: true, gone: true, no_key: true, stale: true, invalid: true,
});
const STEPS = every<AnswerStep>({
  miss: true, misclick: true, training: true, start: true, too_early: true, two_days: true, check: true, early: true, late: true,
});
const LAST_RESULTS = every<NonNullable<AnswerState['last_result']>>({ right: true, wrong: true, dont_know: true });
const PLAN_CLASSES = every<PlanCls>({
  relearn: true, confirm: true, new_floor: true, confirm_ai: true, start_ai: true, check: true, final: true, new_fill: true,
  free: true,
});
const LINK_STATUSES = every<LinkPreviewStatus>({
  active: true, own: true, joined: true, removed: true, revoked: true, expired: true, full: true, not_found: true,
});
const ORAL_STATUSES = every<OralSyncResponse['oral'][number]['status']>({
  copied: true, bound: true, not_ready: true, closed: true, failed: true,
});
const BANK_KINDS = every<BankItemKind>({
  single: true, multiple: true, truefalse: true, open: true, order: true, match: true, unknown: true,
});
const SUBJECT_EVIDENCE = every<BankParseResult['subjects'][number]['evidence']>({
  heading: true, heading_level: true, restart: true, none: true,
});

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const FACT_FIELDS: Array<keyof SubjectFacts> = ['keyed', 'no_key', 'seen', 'two_days', 'open_errors', 'seen_today', 'doubted', 'stale'];

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const daysFrom = (day: string, from: string) => (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const seconds = (moment: string | null) => (moment === null ? null : Math.floor(Date.parse(moment) / 1000));
const offset = (day: string | null) => (day === null ? null : daysFrom(day, plan.day));
const RESULT_CODE = { right: 0, wrong: 1, dont_know: 2 } as const;

function facts(rows: Array<{ subject: number; topic: number | null }>, keep: (row: { subject: number; topic: number | null }) => boolean) {
  const out: Record<keyof SubjectFacts, number> = { keyed: 0, no_key: 0, seen: 0, two_days: 0, open_errors: 0, seen_today: 0, doubted: 0, stale: 0 };
  const states = new Map(plan.states.map((row) => [row[0], row]));
  rows.forEach((row, index) => {
    if (!keep(row)) return;
    out.keyed += 1;
    const doubted = plan.doubted.includes(index);
    if (doubted) out.doubted += 1;
    const state = states.get(index);
    if (!state) return;
    if (state[3] !== null) out.seen += 1;
    if (state[8] !== null) out.two_days += 1;
    if ((state[5] === 1 || state[5] === 2) && !doubted) out.open_errors += 1;
    if (state[3] === 0) out.seen_today += 1;
  });
  return out;
}

const planRows = plan.items.map(([, subject, topic]) => ({ subject, topic }));
const container = overview.containers[0];

// ── Shapes the compiler cannot see ──────────────────────────────────────────────────────────────────────────

describe('literal values and tuples', () => {
  it('reads every version as 1 and every day as YYYY-MM-DD', () => {
    for (const value of [overview, summary, plan, recorded]) expect(value.v).toBe(1);
    for (const day of [overview.day, summary.day, plan.day, recorded.server_day, summary.first_plan_day]) expect(day).toMatch(DAY);
  });

  it('gives each role, kind, key source, status and step from its union', () => {
    expect(ROLES).toContain(container.role);
    expect(ROLES).toContain(summary.role);
    for (const c of plan.containers) expect(ROLES).toContain(c.role);
    for (const item of itemsPage) {
      expect(ITEM_KINDS).toContain(item.kind);
      expect(KEY_SOURCES).toContain(item.key_source);
    }
    for (const result of [...recorded.results, ...(mock.results ?? [])]) {
      expect(STATUSES).toContain(result.status);
      if (result.step !== undefined) expect(STEPS).toContain(result.step);
      if (result.state) expect([null, ...LAST_RESULTS]).toContain(result.state.last_result);
    }
    for (const pace of plan.pace) expect(PLAN_CLASSES).toContain(pace.cls);
    expect(LINK_STATUSES).toContain(preview.status);
    for (const row of oralSync.oral) expect(ORAL_STATUSES).toContain(row.status);
    for (const parse of [parseTwoSubjects, parseOpen]) {
      for (const item of parse.items) expect(BANK_KINDS).toContain(item.kind);
      for (const subject of parse.subjects) expect(SUBJECT_EVIDENCE).toContain(subject.evidence);
    }
  });

  it('packs plan items as 7-tuples [id, subject, topic, position, kind, rev, slow]', () => {
    expect(plan.items.length).toBeGreaterThan(0);
    for (const row of plan.items) {
      expect(row).toHaveLength(7);
      const [id, subject, topic, position, kind, rev, slow] = row;
      expect(id).toMatch(UUID);
      expect(isInt(subject) && subject >= 0 && subject < plan.subjects.length).toBe(true);
      expect(topic === null || (isInt(topic) && topic >= 1 && topic <= plan.subjects[subject].topics)).toBe(true);
      expect(isInt(position) && position >= 1).toBe(true);
      expect([0, 1, 2]).toContain(kind);
      expect(isInt(rev) && rev >= 1).toBe(true);
      expect([0, 1]).toContain(slow);
    }
  });

  it('packs plan states as 14-tuples of offsets, epoch seconds and codes', () => {
    expect(plan.states.length).toBeGreaterThan(0);
    const dayOrNull = (value: number | null) => value === null || (isInt(value) && value <= 0);
    const momentOrNull = (value: number | null) => value === null || (isInt(value) && value > 1_700_000_000 && value <= plan.now);
    let previous = -1;
    for (const row of plan.states) {
      expect(row).toHaveLength(14);
      const [item, seen, wrong, firstSeen, lastAnswer, lastResult, streakDay, streakAt, twoDaysAt, namedAt, checks, peekDay, wasTwoDays, cleanOkAt] = row;
      expect(isInt(item) && item > previous && item < plan.items.length).toBe(true);
      previous = item;
      expect(isInt(seen) && isInt(wrong) && wrong <= seen).toBe(true);
      for (const day of [firstSeen, lastAnswer, streakDay, peekDay]) expect(dayOrNull(day)).toBe(true);
      for (const at of [streakAt, twoDaysAt, namedAt, cleanOkAt]) expect(momentOrNull(at)).toBe(true);
      expect([0, 1, 2, null]).toContain(lastResult);
      expect(isInt(checks) && checks >= 0).toBe(true);
      expect([0, 1]).toContain(wasTwoDays);
      // A state in «верно в два разных дня» has its series, and the series began before the second day.
      if (twoDaysAt !== null) expect(streakAt !== null && streakAt < twoDaysAt).toBe(true);
    }
    for (const index of plan.doubted) expect(isInt(index) && index < plan.items.length).toBe(true);
  });

  it('keeps ids, days and moments in their formats', () => {
    for (const id of [container.id, summary.id, oralSync.container_id, mock.run_id, ...overview.attached_exam_ids]) expect(id).toMatch(UUID);
    for (const item of itemsPage) expect(item.updated_at).toMatch(MOMENT);
    for (const result of recorded.results) {
      if (!result.state) continue;
      for (const at of [result.state.streak_at, result.state.two_days_at, result.state.named_at, result.state.clean_ok_at]) {
        if (at !== null) expect(at).toMatch(MOMENT);
      }
    }
    expect(container.created_at).toMatch(MOMENT);
    expect(summary.owner?.links[0].expires_at).toMatch(MOMENT);
  });

  it('lists the columns of a test_items row and an offline-queue action for every answer status', () => {
    for (const item of itemsPage) expect(Object.keys(item)).toEqual(TEST_ITEM_COLUMNS.split(', '));
    expect([...QUEUE_DONE, ...QUEUE_DROP_AND_REPORT].sort()).toEqual([...STATUSES].sort());
  });
});

// ── One story across the files ──────────────────────────────────────────────────────────────────────────────

describe('one container across the samples', () => {
  it('is the same container, title, date, settings and day everywhere', () => {
    expect(container.title).toBe('Зимняя сессия');
    for (const id of [summary.id, plan.containers[0].id, oralSync.container_id, ...itemsPage.map((item) => item.container_id)]) expect(id).toBe(container.id);
    for (const value of [summary, plan.containers[0], preview]) {
      expect(value.title).toBe(container.title);
      expect(value.exam_date).toBe(container.exam_date);
    }
    expect(summary.created_at).toBe(container.created_at);
    expect(summary.settings).toEqual(container.settings);
    expect(plan.containers[0].settings).toEqual(summary.settings);
    expect(plan.containers[0].first_plan_day).toBe(summary.first_plan_day);
    expect(summary.day).toBe(overview.day);
    expect(plan.day).toBe(overview.day);
    for (const value of [summary, plan.containers[0]]) expect(value.answers_today).toBe(container.answers_today);
    expect(summary.items_version).toEqual({ count: container.items, updated_at: container.items_updated_at });
  });

  it('has the same subjects, in order, with two parts with variants and one oral part', () => {
    const subjects = container.subjects.map(({ id, position, title, exam_date }) => ({ id, position, title, exam_date }));
    expect(subjects.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(summary.subjects.map(({ id, position, title, exam_date }) => ({ id, position, title, exam_date }))).toEqual(subjects);
    expect(plan.subjects.map(({ id, title, test_date, container: index }) => ({ id, title, exam_date: test_date, index }))).toEqual(
      subjects.map(({ id, title, exam_date }) => ({ id, title, exam_date, index: 0 })),
    );
    expect(preview.subjects?.map((s) => s.title)).toEqual(subjects.map((s) => s.title));
    expect(container.subjects.map((s) => s.has_oral)).toEqual([false, false, true]);
    expect(summary.subjects.map((s) => s.topic_titles.length)).toEqual(plan.subjects.map((s) => s.topics));
  });

  it('points to the one oral exam the same way in the overview, the summary and the plan', () => {
    const oral = container.subjects.filter((s) => s.has_oral).map((s) => s.oral_exam_id);
    expect(overview.attached_exam_ids).toEqual(oral);
    expect(summary.subjects.map((s) => s.oral?.exam_id ?? null)).toEqual(container.subjects.map((s) => s.oral_exam_id));
    expect(plan.subjects.map((s) => s.oral_exam_id)).toEqual(container.subjects.map((s) => s.oral_exam_id));
  });

  it('counts the same facts in the overview and the summary, and derives them from the plan’s tuples', () => {
    container.subjects.forEach((subject, index) => {
      const own = summary.subjects[index];
      for (const field of FACT_FIELDS) expect(own[field], `${subject.title}: ${field}`).toBe(subject[field]);
      const derived = facts(planRows, (row) => row.subject === index);
      expect({ ...derived, no_key: subject.no_key, stale: subject.stale }).toEqual(
        Object.fromEntries(FACT_FIELDS.map((field) => [field, subject[field]])),
      );
      expect(plan.subjects[index].new_today).toBe(subject.seen_today);
      const kinds = own.kinds.single + own.kinds.multiple + own.kinds.short;
      expect(kinds).toBe(subject.keyed + subject.no_key);
      expect(own.topics.map((t) => t.topic)).toEqual(own.topic_titles.map((_, n) => n + 1));
      for (const topic of own.topics) {
        const byTopic = facts(planRows, (row) => row.subject === index && row.topic === topic.topic);
        expect(topic).toEqual({ topic: topic.topic, keyed: byTopic.keyed, seen: byTopic.seen, two_days: byTopic.two_days, open_errors: byTopic.open_errors });
      }
    });
    expect(container.items).toBe(container.subjects.reduce((sum, s) => sum + s.keyed + s.no_key, 0));
  });

  it('stores the first subject’s page exactly as the plan lists its items', () => {
    const first = container.subjects[0];
    const rows = plan.items.filter((row) => row[1] === 0);
    expect(itemsPage.map((item) => item.subject_id)).toEqual(rows.map(() => first.id));
    expect(itemsPage.map((item) => item.position)).toEqual(rows.map((_, n) => n + 1));
    itemsPage.forEach((item, n) => {
      const [id, , topic, position, kind, rev, slow] = rows[n];
      expect({ id: item.id, topic: item.topic, position: item.position, rev: item.rev }).toEqual({ id, topic, position, rev });
      expect(kind).toBe({ single: 0, multiple: 1, short: 2 }[item.kind]);
      expect(slow).toBe(item.code || item.kind === 'multiple' ? 1 : 0);
      expect(item.correct.length).toBeGreaterThan(0);
      for (const index of item.correct) expect(index).toBeLessThan(item.options.length);
    });
  });

  it('answers in record_result left the very states the plan read afterwards', () => {
    expect(recorded.server_day).toBe(plan.day);
    const index = new Map(plan.items.map((row, n) => [row[0], n]));
    const keys = new Map(itemsPage.map((item) => [item.id, item.correct]));
    const last = new Map<string, AnswerResult>();
    for (const result of recorded.results) {
      expect(index.has(result.item_id ?? '')).toBe(true);
      if (result.status !== 'saved') continue;
      expect(result.key).toEqual(keys.get(result.item_id!));
      expect(result.rev).toBe(plan.items[index.get(result.item_id!)!][5]);
      last.set(result.item_id!, result);
    }
    expect(last.size).toBeGreaterThan(0);
    for (const [itemId, result] of last) {
      const s = result.state!;
      const row = plan.states.find((state) => state[0] === index.get(itemId));
      expect(row).toEqual([
        index.get(itemId), s.seen, s.wrong, offset(s.first_seen_day), offset(s.last_answer_day),
        s.last_result === null ? null : RESULT_CODE[s.last_result], offset(s.streak_day), seconds(s.streak_at),
        seconds(s.two_days_at), seconds(s.named_at), s.checks, offset(s.peek_day), s.was_two_days ? 1 : 0, seconds(s.clean_ok_at),
      ]);
      expect(s.seen).toBe(s.right + s.wrong);
      expect(s.item_rev).toBe(result.rev);
    }
  });

  it('finished the mock test listed in the summary', () => {
    const run = summary.mock_runs.find((r) => r.id === mock.run_id);
    expect(run).toBeDefined();
    expect({ items: mock.items, correct: mock.correct }).toEqual({ items: run!.items, correct: run!.correct });
    expect(mock.results).toHaveLength(mock.items);
    expect(mock.results!.filter((r) => r.correct).length).toBe(mock.correct);
    expect(mock.unanswered).toBeLessThanOrEqual(mock.items - mock.correct);
    const ofRun = new Set(plan.items.filter((row) => run!.subject_ids.includes(plan.subjects[row[1]].id)).map((row) => row[0]));
    for (const result of mock.results!) expect(ofRun.has(result.item_id!)).toBe(true);
  });

  it('shows the author the doubted items of this container, without names', () => {
    const rows = new Map(plan.items.map((row) => [row[0], row]));
    for (const doubt of doubts) {
      const row = rows.get(doubt.item_id);
      expect(row).toBeDefined();
      expect(doubt.subject_id).toBe(plan.subjects[row![1]].id);
      expect(doubt.position).toBe(row![3]);
      if (doubt.doubts === 0) expect(doubt.top_wrong_n! * 2).toBeGreaterThan(doubt.first_answers);
      for (const proposed of doubt.proposed ?? []) expect(proposed).not.toEqual(doubt.correct);
    }
    const page = new Map(itemsPage.map((item) => [item.id, item]));
    for (const doubt of doubts.filter((d) => page.has(d.item_id))) {
      expect(doubt.correct).toEqual(page.get(doubt.item_id)!.correct);
      expect(doubt.file_no).toBe(page.get(doubt.item_id)!.file_no);
    }
    expect(summary.owner?.doubts_open).toBe(doubts.filter((d) => d.doubts > 0).length);
  });

  it('previews the group link with the same subjects and their questions with a key', () => {
    expect(preview.status).toBe('active');
    expect(preview.container_id).toBeNull();
    expect(preview.subjects).toEqual(container.subjects.map((s) => ({ title: s.title, items: s.keyed, oral: s.has_oral })));
    expect(preview.needs_consent_text).toBe(container.subjects.some((s) => s.has_oral));
    expect(summary.owner?.links).toHaveLength(1);
  });

  it('gives a member their own copy of the oral subject', () => {
    const oral = container.subjects.filter((s) => s.has_oral);
    expect(oralSync.oral.map((row) => row.subject_id)).toEqual(oral.map((s) => s.id));
    for (const row of oralSync.oral) {
      expect(row.exam_id).toMatch(UUID);
      expect(overview.attached_exam_ids).not.toContain(row.exam_id);
    }
  });
});

describe('the importer’s real output for the same files', () => {
  it('holds the two subjects with variants, their topics and their questions as stored', () => {
    const [first, second] = summary.subjects;
    expect(parseTwoSubjects.subjects.map((s) => ({ title: s.title, items: s.items }))).toEqual([
      { title: first.title, items: first.keyed },
      { title: second.title, items: second.keyed },
    ]);
    parseTwoSubjects.subjects.forEach((subject, n) => {
      expect(parseTwoSubjects.topics.filter((t) => t.subject === subject.index).map((t) => t.title)).toEqual(summary.subjects[n].topic_titles);
    });
    const firstTopics = parseTwoSubjects.topics.filter((t) => t.subject === 1).map((t) => t.index);
    const parsed = parseTwoSubjects.items.filter((item) => item.subject === 1);
    expect(parsed.map((item) => ({
      file_no: item.label, stem: item.text, options: item.options, correct: item.correct, kind: item.kind,
      code: item.code, key_source: item.evidence, topic: item.topic === null ? null : firstTopics.indexOf(item.topic) + 1,
    }))).toEqual(itemsPage.map((item) => ({
      file_no: item.file_no, stem: item.stem, options: item.options, correct: item.correct, kind: item.kind,
      code: item.code, key_source: item.key_source, topic: item.topic,
    })));
  });

  it('counts its own parts consistently', () => {
    for (const parse of [parseTwoSubjects, parseOpen]) {
      expect(parse.stats.items).toBe(parse.items.length);
      expect(parse.items.map((item) => item.position)).toEqual(parse.items.map((_, n) => n + 1));
      for (const subject of parse.subjects) expect(subject.items).toBe(parse.items.filter((item) => item.subject === subject.index).length);
      for (const topic of parse.topics) expect(topic.items).toBe(parse.items.filter((item) => item.topic === topic.index).length);
      const kinds: Record<string, number> = {};
      for (const item of parse.items) kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
      expect(parse.stats.kinds).toEqual(kinds);
    }
  });

  it('reads the oral list as the open questions of the oral subject', () => {
    expect(parseOpen.items.every((item) => item.kind === 'open' && item.options.length === 0 && item.correct.length === 0)).toBe(true);
    const oral = summary.subjects.find((s) => s.oral !== null);
    expect(oral?.oral?.questions).toBe(parseOpen.items.length);
    expect(oral?.title.startsWith(parseOpen.subjects[0].title ?? '')).toBe(true);
  });
});
