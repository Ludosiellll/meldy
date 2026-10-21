/**
 * «Осталось выучить» (owner, 2026-10-21; design learn-left §1–§2): an exam split into topics, each one closes when every
 * question in it is learned under the rules the app already has. Pure: no network, no storage, no clock (the moment
 * comes in). The site (subject page, oral exam page, session end, «Сегодня») and the Telegram bot (a flat copy made by
 * scripts/sync_bot_plan.mjs) group with this one module, so both say the same counts.
 *
 * Where topics come from:
 * - test questions with a key (a container subject): the file's topics (`PlanItem.tp`, titles from
 *   `container_subjects.topics`); questions with no topic, or one topic that is the whole subject and has more than 30
 *   questions, go in blocks of 20 in file order;
 * - oral questions in the plan (`learn_left`, one RPC): the department's sections, else the lecture that answers the
 *   question, else blocks of 10 in the department's order (also when lectures give more than 8 topics averaging under 3);
 * - a mixed subject: an oral topic with the same title as a test topic joins it; the others follow, tagged «устно».
 * A test topic over 30 questions splits into equal parts of at most 25; an oral one over 12 into parts of at most 10.
 *
 * Learned: a test question is in the figure (`twoDaysAt`, a due check included); an oral question has every main point
 * named in the answer itself on two different days (the server's `learn_left` state 3, the same line rule as the plan).
 * Comments stay in English: a test reads the Russian strings for words the app does not use.
 */
import type { PlanItem } from '../../types/container.ts';
import { dayText, NBSP, plural } from './words.ts';

/** Test topics: over this many questions a topic is split… */
export const TEST_SPLIT_OVER = 30;
/** …into equal parts of at most this many. */
export const TEST_PART = 25;
/** Test questions without topics: blocks of this many (the study block, SESSION_SIZE). */
export const TEST_BLOCK = 20;
export const ORAL_SPLIT_OVER = 12;
export const ORAL_PART = 10;
export const ORAL_BLOCK = 10;
/** Grouping by lecture gives way to blocks when it makes more topics than this… */
export const LECTURE_MAX_TOPICS = 8;
/** …averaging under this many questions. */
export const LECTURE_MIN_AVG = 3;

/** A question's progress, as the bar shows it: blue learned, yellow started, empty not yet. */
export type Step = 'none' | 'started' | 'done';

/** An oral question's block kind as `learn_left` says it (lib/exams/cheatSheet.ts blockKind; 'none': not in the lectures). */
export type OralKind = 'lines' | 'unwritten' | 'rebuilt' | 'none' | 'gap' | 'unmapped' | 'unverified';
/** The kinds in the plan (oralParts.ts IN_PLAN): only they make topics. */
export const ORAL_IN_PLAN: ReadonlySet<OralKind> = new Set<OralKind>(['lines', 'unwritten', 'rebuilt']);

/** One oral question of `learn_left`. */
export interface LearnLeftQuestion {
  id: string;
  position: number;
  /** The department's number («5», «12а»), empty when the list has none. */
  label: string;
  section: number | null;
  /** Index into the exam's `lectures` of the lecture that answers it (most fragments; on a tie the earlier lecture). */
  lecture: number | null;
  kind: OralKind;
  /** 0 not answered · 1 some main points named · 2 every main point named, waiting for another day · 3 learned. */
  state: 0 | 1 | 2 | 3;
  /** Main points with a current series (named, or learned) and main points in all. */
  named: number;
  of: number;
  /** epoch ms: when the question was learned (the latest of its main points). */
  learnedAt: number | null;
  /** epoch ms, state 2: from when an answer makes it learned (another day and 20 hours; not today after a peek). */
  readyAt: number | null;
  /** The last checked answer missed a main point. */
  missed: boolean;
}

/** One oral exam of `learn_left`. */
export interface LearnLeftExam {
  examId: string;
  title: string;
  mappingState: string;
  lectures: Array<{ id: string; title: string }>;
  sectionTitles: string[];
  /** Questions in the lectures without points yet, and the AI units writing them takes. */
  toWrite: number;
  units: number;
  questions: LearnLeftQuestion[];
}

export interface TopicQuestion {
  id: string;
  /** The number the student sees: the department's label or the position. */
  n: string;
  pos: number;
  kind: 't' | 'o';
  step: Step;
  learnedAt: number | null;
  /** Oral only. */
  oral?: { state: 0 | 1 | 2 | 3; named: number; of: number; missed: boolean; readyAt: number | null; written: boolean };
}

export interface Topic {
  /** Stable across reads: the session end compares topics before and after by it. */
  key: string;
  /** The topic as shown, with «, часть 2 из 4». */
  title: string;
  /** The topic's own name. */
  name: string;
  part: { n: number; of: number } | null;
  /** An oral topic of a mixed subject with no test topic of its name: «устно». */
  oralTag: boolean;
  questions: TopicQuestion[];
  /** The file's topic number: a tap opens «Начать 20 вопросов по теме»; null for blocks and oral topics. */
  testTopic: number | null;
}

export type TopicSource = 'file' | 'sections' | 'lectures' | 'blocks' | 'oral_blocks';

/** Why an oral question is not in the count. */
export type OutReason = 'none' | 'gap' | 'unmapped' | 'unverified';
export interface OutQuestion {
  id: string;
  n: string;
  pos: number;
  reason: OutReason;
}

export interface TopicList {
  topics: Topic[];
  sources: TopicSource[];
  out: OutQuestion[];
  /** Oral questions in the plan with no points written yet. */
  unwritten: number;
  /** An oral part with no lectures (or nothing checked against them): the card asks for lectures. */
  noLectures: boolean;
  kind: 'test' | 'oral' | 'mixed' | 'empty';
}

interface Group {
  key: string;
  name: string;
  questions: TopicQuestion[];
  testTopic: number | null;
  oral: boolean;
  /** Blocks are never merged. */
  block: boolean;
}

// ───────────────────────────────────────────── questions ─────────────────────────────────────────────

/** A test item of the plan as a topic's question: learned when it is in the figure (a due check stays learned). */
export function testQuestion(item: PlanItem): TopicQuestion {
  const u = item.u;
  const done = Boolean(u && u.twoDaysAt !== null);
  const started = !done && Boolean(u && u.seriesAt !== null);
  return {
    id: item.id,
    n: String(item.o),
    pos: item.o,
    kind: 't',
    step: done ? 'done' : started ? 'started' : 'none',
    learnedAt: done && u ? u.twoDaysAt : null,
  };
}

/** The department's number of an oral question («5.» and «5)» read «5»), else its position. */
export function oralNumber(q: Pick<LearnLeftQuestion, 'label' | 'position'>): string {
  const label = typeof q.label === 'string' ? q.label.trim().replace(/[.)]\s*$/, '').trim() : '';
  return label || String(q.position);
}

export function oralQuestion(q: LearnLeftQuestion): TopicQuestion {
  return {
    id: q.id,
    n: oralNumber(q),
    pos: q.position,
    kind: 'o',
    step: q.state === 3 ? 'done' : q.state > 0 ? 'started' : 'none',
    learnedAt: q.state === 3 ? q.learnedAt : null,
    oral: { state: q.state, named: q.named, of: q.of, missed: q.missed, readyAt: q.readyAt, written: q.kind === 'lines' },
  };
}

// ───────────────────────────────────────────── grouping ─────────────────────────────────────────────

function blocks(prefix: string, questions: TopicQuestion[], size: number, label: (first: TopicQuestion, last: TopicQuestion, from: number, to: number) => string): Group[] {
  const out: Group[] = [];
  for (let i = 0; i < questions.length; i += size) {
    const chunk = questions.slice(i, i + size);
    out.push({
      key: `${prefix}${i / size + 1}`,
      name: label(chunk[0], chunk[chunk.length - 1], i + 1, i + chunk.length),
      questions: chunk,
      testTopic: null,
      oral: false,
      block: true,
    });
  }
  return out;
}

const rangeName = (from: string, to: string) => (from === to ? `Вопрос${NBSP}${from}` : `Вопросы ${from}–${to}`);

/**
 * The test topics of one subject, unsplit: its keyed items (`f: 't'`, not set aside) by the file's topics in file order;
 * `titles[n - 1]` names topic n.
 */
export function testGroups(items: readonly PlanItem[], subjectId: string, titles: readonly string[] | null): { groups: Group[]; sources: TopicSource[] } {
  const own = items.filter((item) => item && item.f === 't' && item.s === subjectId).slice().sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (own.length === 0) return { groups: [], sources: [] };
  const byTopic = new Map<number, Group>();
  const order: Group[] = [];
  const loose: TopicQuestion[] = [];
  for (const item of own) {
    const q = testQuestion(item);
    const tp = typeof item.tp === 'number' && Number.isInteger(item.tp) && item.tp > 0 ? item.tp : null;
    if (tp === null) {
      loose.push(q);
      continue;
    }
    let group = byTopic.get(tp);
    if (!group) {
      const title = (titles?.[tp - 1] ?? '').trim();
      group = { key: `t:${subjectId}:${tp}`, name: title || `Тема ${tp}`, questions: [], testTopic: tp, oral: false, block: false };
      byTopic.set(tp, group);
      order.push(group);
    }
    group.questions.push(q);
  }
  const allBlocks = () => blocks(`t:${subjectId}:b`, own.map(testQuestion), TEST_BLOCK, (_a, _b, from, to) => rangeName(String(from), String(to)));
  // No topics, or one topic that is the whole subject and too big: the study blocks in file order.
  if (order.length === 0 || (order.length === 1 && loose.length === 0 && order[0].questions.length > TEST_SPLIT_OVER)) {
    return { groups: allBlocks(), sources: ['blocks'] };
  }
  const groups = [...order];
  const sources: TopicSource[] = ['file'];
  if (loose.length > 0) {
    groups.push(...blocks(`t:${subjectId}:x`, loose, TEST_BLOCK, (first, last) => rangeName(first.n, last.n)));
    sources.push('blocks');
  }
  return { groups: groups.sort((a, b) => a.questions[0].pos - b.questions[0].pos), sources };
}

const OUT_REASON: Partial<Record<OralKind, OutReason>> = { none: 'none', gap: 'gap', unmapped: 'unmapped', unverified: 'unverified' };

/** The oral topics of one exam, unsplit, with the questions outside the plan. */
export function oralGroups(exam: LearnLeftExam): { groups: Group[]; sources: TopicSource[]; out: OutQuestion[]; unwritten: number; noLectures: boolean } {
  const ordered = exam.questions.slice().sort((a, b) => a.position - b.position);
  const inPlan = ordered.filter((q) => ORAL_IN_PLAN.has(q.kind));
  const out: OutQuestion[] = ordered
    .filter((q) => !ORAL_IN_PLAN.has(q.kind))
    .map((q) => ({ id: q.id, n: oralNumber(q), pos: q.position, reason: OUT_REASON[q.kind] ?? 'gap' }));
  const unwritten = inPlan.filter((q) => q.kind !== 'lines').length;
  const noLectures = exam.lectures.length === 0 || (inPlan.length === 0 && ordered.length > 0 && ordered.every((q) => q.kind === 'unmapped'));
  if (inPlan.length === 0) return { groups: [], sources: [], out, unwritten, noLectures };
  const prefix = `o:${exam.examId}:`;
  const oralBlocks = () => blocks(`${prefix}b`, inPlan.map(oralQuestion), ORAL_BLOCK, (first, last) => rangeName(first.n, last.n));

  const grouped = (keyOf: (q: LearnLeftQuestion) => number | null, nameOf: (k: number) => string, tag: string): Group[] => {
    const map = new Map<string, Group>();
    const list: Group[] = [];
    for (const q of inPlan) {
      const k = keyOf(q);
      const id = k === null ? 'rest' : String(k);
      let group = map.get(id);
      if (!group) {
        group = { key: `${prefix}${tag}${id}`, name: k === null ? 'Другие вопросы' : nameOf(k), questions: [], testTopic: null, oral: true, block: false };
        map.set(id, group);
        list.push(group);
      }
      group.questions.push(oralQuestion(q));
    }
    return list;
  };

  const titles = exam.sectionTitles;
  if (titles.length > 0 && inPlan.some((q) => q.section !== null)) {
    const groups = grouped((q) => q.section, (k) => (titles[k - 1] ?? '').trim() || `Раздел ${k}`, 's');
    return { groups, sources: ['sections'], out, unwritten, noLectures };
  }
  if (exam.lectures.length > 0 && inPlan.some((q) => q.lecture !== null)) {
    const groups = grouped(
      (q) => (q.lecture !== null && q.lecture >= 0 && q.lecture < exam.lectures.length ? q.lecture : null),
      (k) => exam.lectures[k]?.title.trim() || `Лекция ${k + 1}`,
      'l',
    );
    if (!(groups.length > LECTURE_MAX_TOPICS && inPlan.length / groups.length < LECTURE_MIN_AVG)) {
      return { groups, sources: ['lectures'], out, unwritten, noLectures };
    }
  }
  return { groups: oralBlocks(), sources: ['oral_blocks'], out, unwritten, noLectures };
}

/** A topic title as compared across a mixed subject: case, «ё», punctuation and spaces aside. */
export function sameTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function split(group: Group, over: number, size: number): Topic[] {
  const n = group.questions.length;
  const base = { name: group.name, oralTag: false, testTopic: group.testTopic };
  if (n <= over) return [{ ...base, key: group.key, title: group.name, part: null, questions: group.questions }];
  const parts = Math.ceil(n / size);
  const small = Math.floor(n / parts);
  const extra = n % parts;
  const out: Topic[] = [];
  let at = 0;
  for (let i = 0; i < parts; i += 1) {
    const take = small + (i < extra ? 1 : 0);
    out.push({
      ...base,
      key: `${group.key}:p${i + 1}`,
      title: `${group.name}, часть ${i + 1} из ${parts}`,
      part: { n: i + 1, of: parts },
      questions: group.questions.slice(at, at + take),
    });
    at += take;
  }
  return out;
}

/**
 * One subject's topics (or one oral exam's): the test part from the plan's items, the oral part from `learn_left`.
 * A mixed subject merges an oral topic into the test topic of the same title; the rest of the oral topics follow.
 */
export function buildTopics(input: {
  subjectId?: string | null;
  items?: readonly PlanItem[] | null;
  titles?: readonly string[] | null;
  oral?: LearnLeftExam | null;
}): TopicList {
  const test = input.subjectId && input.items ? testGroups(input.items, input.subjectId, input.titles ?? null) : { groups: [], sources: [] as TopicSource[] };
  const oral = input.oral ? oralGroups(input.oral) : null;
  const mixed = test.groups.length > 0 && oral !== null && (oral.groups.length > 0 || oral.out.length > 0);
  const topics: Topic[] = [];
  const named = new Map<string, Group>();
  for (const group of test.groups) if (!group.block) named.set(sameTitle(group.name), group);
  const rest: Group[] = [];
  for (const group of oral?.groups ?? []) {
    const target = test.groups.length > 0 && !group.block ? named.get(sameTitle(group.name)) : undefined;
    if (target) target.questions = [...target.questions, ...group.questions];
    else rest.push(group);
  }
  for (const group of test.groups) topics.push(...split(group, TEST_SPLIT_OVER, TEST_PART));
  for (const group of rest) {
    const parts = split(group, ORAL_SPLIT_OVER, ORAL_PART);
    for (const part of parts) part.oralTag = test.groups.length > 0;
    topics.push(...parts);
  }
  const sources = [...test.sources, ...(oral?.sources ?? [])];
  return {
    topics,
    sources: sources.filter((source, i) => sources.indexOf(source) === i),
    out: oral?.out ?? [],
    unwritten: oral?.unwritten ?? 0,
    noLectures: Boolean(oral?.noLectures) && test.groups.length === 0,
    kind: mixed ? 'mixed' : test.groups.length > 0 ? 'test' : oral && (oral.groups.length > 0 || oral.out.length > 0) ? 'oral' : 'empty',
  };
}

// ───────────────────────────────────────────── counts ─────────────────────────────────────────────

export function isClosed(topic: Topic): boolean {
  return topic.questions.length > 0 && topic.questions.every((q) => q.step === 'done');
}

export function leftIn(topic: Topic): number {
  return topic.questions.filter((q) => q.step !== 'done').length;
}

/** The latest moment one of its questions was learned: «выучена 19 октября». */
export function closedAt(topic: Topic): number | null {
  let at: number | null = null;
  for (const q of topic.questions) if (q.learnedAt !== null && (at === null || q.learnedAt > at)) at = q.learnedAt;
  return at;
}

export interface TopicTally {
  total: number;
  left: number;
  open: Topic[];
  closed: Topic[];
  /** Something was started or learned: before that the card says «12 тем», not «12 тем из 12». */
  begun: boolean;
}

export function tally(topics: readonly Topic[]): TopicTally {
  const open = topics.filter((topic) => !isClosed(topic));
  const closed = topics.filter(isClosed);
  const begun = topics.some((topic) => topic.questions.some((q) => q.step !== 'none'));
  return { total: topics.length, left: open.length, open, closed, begun };
}

/** The open topic closest to closing: the fewest questions left (the earlier one on a tie). */
export function nearest(topics: readonly Topic[]): Topic | null {
  let best: Topic | null = null;
  for (const topic of topics) {
    if (isClosed(topic)) continue;
    if (best === null || leftIn(topic) < leftIn(best)) best = topic;
  }
  return best;
}

/**
 * What a session changed (the session end): topics closed by it, topics an error opened again, and the open topic
 * closest to closing. `before` and `after` are the same subject's topics before the session and after it.
 */
export function topicChange(before: readonly Topic[], after: readonly Topic[]): { closed: Topic[]; reopened: Topic[]; near: Topic | null } {
  const was = new Map(before.map((topic) => [topic.key, isClosed(topic)]));
  const closed = after.filter((topic) => isClosed(topic) && was.get(topic.key) === false);
  const reopened = after.filter((topic) => !isClosed(topic) && was.get(topic.key) === true);
  return { closed, reopened, near: nearest(after) };
}

/**
 * Topics a session closed, read after it (the bot keeps no state from before): closed now, with a question of the
 * session (`ids`) learned at or after `since` (the session's start, epoch ms).
 */
export function closedSince(topics: readonly Topic[], ids: ReadonlySet<string>, since: number): Topic[] {
  return topics.filter((topic) => isClosed(topic) && topic.questions.some((q) => ids.has(q.id) && q.learnedAt !== null && q.learnedAt >= since));
}

/**
 * The topics as they would be with these questions learned and these lost (the session's results when the plan could
 * not be read again after it): `gained` reached the figure, `dropped` left it after an error.
 */
export function withResults(topics: readonly Topic[], gained: ReadonlySet<string>, dropped: ReadonlySet<string>): Topic[] {
  return topics.map((topic) => ({
    ...topic,
    questions: topic.questions.map((q) =>
      gained.has(q.id) ? { ...q, step: 'done' as const } : dropped.has(q.id) ? { ...q, step: 'none' as const, learnedAt: null } : q,
    ),
  }));
}

// ───────────────────────────────────────────── words ─────────────────────────────────────────────
// Plain words (owner, 2026-10-21): the result, one short sentence per thought, numbers first with their noun.

const gl = (n: number, one: string, few: string, many: string) => `${n}${NBSP}${plural(n, one, few, many)}`;
export const topicsWord = (n: number) => gl(n, 'тема', 'темы', 'тем');
export const questionsWord = (n: number) => gl(n, 'вопрос', 'вопроса', 'вопросов');
const leftVerb = (n: number, one: string) => plural(n, one, 'Осталось', 'Осталось');

/** The big number's words: «темы из 3» after «2»; nothing begun: «темы» alone after «12». */
export function countWords(left: number, total: number, begun: boolean): string {
  const word = plural(left, 'тема', 'темы', 'тем');
  return begun ? `${word} из${NBSP}${total}` : word;
}

/** «Осталось 9 тем из 12.» («Осталась 1 тема из 12.») */
export function topicsLeftLine(left: number, total: number): string {
  return `${leftVerb(left, 'Осталась')} ${topicsWord(left)} из${NBSP}${total}.`;
}

/** «Осталось выучить 9 тем из 12» on «Сегодня» and in the bot, as a link's words. */
export function learnLeftLine(left: number, total: number): string {
  return `Осталось выучить ${gl(left, 'тему', 'темы', 'тем')} из${NBSP}${total}`;
}

/** The row under a topic: «Осталось 8 вопросов из 20», not begun «20 вопросов, ещё не начинали». */
export function topicRowLine(topic: Topic): string {
  const left = leftIn(topic);
  const total = topic.questions.length;
  if (topic.questions.every((q) => q.step === 'none')) return `${questionsWord(total)}, ещё не начинали`;
  return `${leftVerb(left, 'Остался')} ${questionsWord(left)} из${NBSP}${total}`;
}

/** The fold of closed topics: «Выучена 1 тема», «Выучены 2 темы», «Выучено 5 тем». */
export function closedFoldLine(n: number): string {
  return `${plural(n, 'Выучена', 'Выучены', 'Выучено')} ${topicsWord(n)}`;
}

/** A closed topic's date: «выучена 19 октября». */
export function closedOnLine(at: number | null, day: (ms: number) => string): string {
  return at === null ? 'выучена' : `выучена ${dayText(day(at))}`;
}

/** An oral question in an open row, by its state. */
export function oralStateLine(q: TopicQuestion, now: number): string {
  const o = q.oral;
  if (!o) return '';
  if (!o.written) return 'Пунктов ответа пока нет.';
  if (o.state === 3) return 'Выучен.';
  if (o.state === 2) return o.readyAt !== null && o.readyAt <= now ? 'Ответ полный. Ответьте ещё раз сегодня, и вопрос выучен.' : 'Ответ полный. Ответьте ещё раз в другой день, и вопрос выучен.';
  if (o.state === 1) return `В ответе ${o.named} ${plural(o.named, 'главный пункт', 'главных пункта', 'главных пунктов')} из${NBSP}${o.of}.`;
  return o.missed ? 'В прошлый раз ответ был неполным.' : 'Ещё не отвечали.';
}

/** «Вопросы 8 и 16», «Вопрос 8», «Вопросы 3, 5 и 9», «7 вопросов». */
function numbersOf(list: readonly OutQuestion[]): { lead: string; one: boolean } {
  if (list.length === 1) return { lead: `Вопрос${NBSP}${list[0].n}`, one: true };
  if (list.length <= 4) {
    const ns = list.map((q) => q.n);
    return { lead: `Вопросы ${ns.slice(0, -1).join(', ')} и${NBSP}${ns[ns.length - 1]}`, one: false };
  }
  return { lead: questionsWord(list.length), one: false };
}

const OUT_WHY: Record<OutReason, [string, string]> = {
  none: ['его нет в лекциях', 'их нет в лекциях'],
  gap: ['для него не получилось составить пункты ответа', 'для них не получилось составить пункты ответа'],
  unmapped: ['его ещё не сверили с лекциями', 'их ещё не сверили с лекциями'],
  unverified: ['его сверили с лекциями только по словам', 'их сверили с лекциями только по словам'],
};

/** «Вопросы 8 и 16 не считаем, их нет в лекциях.» — one line per reason, in this order. */
export function outLines(out: readonly OutQuestion[]): Array<{ reason: OutReason; text: string }> {
  const lines: Array<{ reason: OutReason; text: string }> = [];
  for (const reason of ['none', 'unmapped', 'unverified', 'gap'] as const) {
    const list = out.filter((q) => q.reason === reason);
    if (list.length === 0) continue;
    const { lead, one } = numbersOf(list);
    lines.push({ reason, text: `${lead} не считаем, ${OUT_WHY[reason][one ? 0 : 1]}.` });
  }
  return lines;
}

export const NO_LECTURES_LINE = 'Темы появятся, когда к экзамену будут лекции. По ним Meldy проверяет ответы.';
export const ALL_CLOSED_LINE = 'Все темы выучены. Иногда вопросы будут возвращаться, чтобы не забылись.';
export const CARD_TITLE = 'Осталось выучить';
export const ORAL_TAG = 'устно';

/** «Как считается», the rule (the one place it is said). */
export function howLines(list: Pick<TopicList, 'kind' | 'sources'>): string[] {
  const lines: string[] = [];
  if (list.kind === 'test' || list.kind === 'mixed') {
    lines.push('Вопрос выучен, когда вы ответили на него верно в два разных дня. Между ответами должно пройти не меньше 20 часов. После ошибки вопрос снова нужно выучить.');
  }
  if (list.kind === 'oral' || list.kind === 'mixed') {
    lines.push('Устный вопрос выучен, когда вы сами назвали все его главные пункты в два разных дня. Пункт, названный после вопроса экзаменатора или после подсказки, не считаем.');
  }
  lines.push('Тема выучена, когда выучен каждый её вопрос.');
  const from: Record<TopicSource, string> = {
    file: 'Темы взяты из файла с вопросами.',
    sections: 'Темы взяты из разделов списка кафедры.',
    lectures: 'Темы взяты из лекций, в которых есть ответ.',
    blocks: 'В файле нет тем, поэтому вопросы разбиты по 20 по порядку.',
    oral_blocks: 'Тем нет, поэтому вопросы разбиты по 10 по порядку.',
  };
  for (const source of list.sources) lines.push(from[source]);
  return lines;
}

/** The session end's ribbon: «Тема выучена», «Выучены 2 темы». */
export function closedRibbon(n: number): string {
  return n === 1 ? 'Тема выучена' : `${plural(n, 'Выучена', 'Выучены', 'Выучено')} ${topicsWord(n)}`;
}

/** Under the closed topic's bar: «Все 20 вопросов выучены.» */
export function closedTopicLine(topic: Topic): string {
  const n = topic.questions.length;
  return n === 1 ? 'Его вопрос выучен.' : `Все ${questionsWord(n)} выучены.`;
}

/** «В теме «Массивы и коллекции» осталось 3 вопроса.» */
export function nearLine(topic: Topic): string {
  const left = leftIn(topic);
  return `В теме «${topic.title}» ${left === 1 ? 'остался' : 'осталось'} ${questionsWord(left)}.`;
}

/** After «Осталось 9 тем из 12.»: «Почти готова тема «Массивы и коллекции», в ней ещё 3 вопроса.» */
export function nearestLine(topic: Topic): string {
  return `Почти готова тема «${topic.title}», в ней ещё ${questionsWord(leftIn(topic))}.`;
}

/** «Из-за ошибки тема «…» снова не выучена.» */
export function reopenedLine(topic: Topic): string {
  return `Из-за ошибки тема «${topic.title}» снова не выучена.`;
}

/** The oral answer's protocol and the bot: «Тема «…» выучена.» */
export function topicClosedLine(topic: Pick<Topic, 'title'>): string {
  return `Тема «${topic.title}» выучена.`;
}

/** The oral answer's protocol: «В теме «…» осталось 2 вопроса из 6.» */
export function topicLeftLine(topic: Topic): string {
  const left = leftIn(topic);
  return `В теме «${topic.title}» ${left === 1 ? 'остался' : 'осталось'} ${questionsWord(left)} из${NBSP}${topic.questions.length}.`;
}

/** «Сегодня можно выучить 4 вопроса.» — questions whose main points were all named on another day, ready now. */
export function readyTodayLine(n: number): string {
  return `Сегодня можно выучить ${questionsWord(n)}.`;
}

/** The oral questions an answer now makes learned: state 2 and its moment has come. */
export function readyNow(exam: LearnLeftExam, now: number): string[] {
  return exam.questions.filter((q) => q.state === 2 && q.readyAt !== null && q.readyAt <= now).map((q) => q.id);
}

/** The next moment one more becomes ready, or null. */
export function nextReady(exam: LearnLeftExam, now: number): number | null {
  let next: number | null = null;
  for (const q of exam.questions) if (q.state === 2 && q.readyAt !== null && q.readyAt > now && (next === null || q.readyAt < next)) next = q.readyAt;
  return next;
}

// ───────────────────────────────────────────── the wire ─────────────────────────────────────────────

const KINDS: ReadonlySet<string> = new Set(['lines', 'unwritten', 'rebuilt', 'none', 'gap', 'unmapped', 'unverified']);

function rec(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const s = (value: unknown, max = 400) => (typeof value === 'string' ? value.slice(0, max) : '');
const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null);
const ms = (value: unknown) => {
  const n = int(value);
  return n === null ? null : n * 1000;
};

/**
 * `learn_left` / `bot_learn_left` exams: {exam_id, title, mapping_state, lectures: [[id, title]], section_titles,
 * to_write, units, q: [[id, position, label, section, lecture, kind, state, named, of, learned_at, ready_at, missed]]}
 * with moments in epoch seconds. A row it cannot read is left out.
 */
export function parseLearnLeft(raw: unknown): LearnLeftExam[] {
  const list = rec(raw) && Array.isArray(raw.exams) ? raw.exams : Array.isArray(raw) ? raw : [];
  const out: LearnLeftExam[] = [];
  for (const entry of list) {
    if (!rec(entry) || typeof entry.exam_id !== 'string') continue;
    const lectures = (Array.isArray(entry.lectures) ? entry.lectures : [])
      .filter((row): row is unknown[] => Array.isArray(row) && typeof row[0] === 'string')
      .map((row) => ({ id: row[0] as string, title: s(row[1]) }));
    const questions: LearnLeftQuestion[] = [];
    for (const row of Array.isArray(entry.q) ? entry.q : []) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const kind = typeof row[5] === 'string' && KINDS.has(row[5]) ? (row[5] as OralKind) : 'gap';
      const state = int(row[6]);
      questions.push({
        id: row[0],
        position: int(row[1]) ?? 0,
        label: s(row[2], 16),
        section: int(row[3]),
        lecture: int(row[4]),
        kind,
        state: state === 1 || state === 2 || state === 3 ? state : 0,
        named: Math.max(0, int(row[7]) ?? 0),
        of: Math.max(0, int(row[8]) ?? 0),
        learnedAt: ms(row[9]),
        readyAt: ms(row[10]),
        missed: row[11] === 1 || row[11] === true,
      });
    }
    out.push({
      examId: entry.exam_id,
      title: s(entry.title, 200),
      mappingState: s(entry.mapping_state, 16),
      lectures,
      sectionTitles: (Array.isArray(entry.section_titles) ? entry.section_titles : []).map((title) => s(title, 200)),
      toWrite: Math.max(0, int(entry.to_write) ?? 0),
      units: Math.max(0, int(entry.units) ?? 0),
      questions,
    });
  }
  return out;
}
