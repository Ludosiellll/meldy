/**
 * «Обновить из файла» (Concept 1 §3.4: the author's «⋯» of a subject; /exams/import?from=c:<id>&subject=<id>), pure.
 *
 * container_items_add inserts a ref once (`<import id>:<n>`), and a new file is a new import: by refs alone every
 * question of the file would be added again. So the page compares the file with the subject's saved questions itself:
 *
 * - A question is the same when its text and its set of options are the same — case, «ё», spaces, quotes and the closing
 *   punctuation aside, options in any order (a short answer: the text alone). The same question is not added again.
 * - A key never changes here (spec: a key changes only in «Ключи», where the change starts the count again for
 *   everyone and the group is told). A same question whose key in the file differs is only listed, with its number.
 * - A question of the file that is not in the subject is new: it is added, at the end of the subject. Its topic is the
 *   subject's topic of the same name, or a new topic after the subject's own (at most 99, the tail merged into the
 *   99th, as at the first import).
 * - The subject's questions that the file no longer has stay, with their answers: deleting is the author's choice.
 * - Open questions are not added: the oral part of a subject is its own exam, changed on its own page.
 */
import type { ItemInput, SummarySubject, TestItem } from '../../../types/container';
import { activeSubjects, itemInputs, shortNorm, subjectOrder, TOPIC_CAP, type DraftItem, type DraftSubject, type PicturePlace } from './importModel';

/** One subject of the file, its oral parts joined: what can update the exam's subject. */
export interface UpdateSource {
  key: string;
  fileId: string;
  /** Its files in order (a subject of variants has several): the questions go in their order. */
  fileIds: string[];
  title: string;
  test: DraftItem[];
  blocked: DraftItem[];
  oral: number;
  skippedKinds: number;
  allNoKey: boolean;
  /** Every question read in it: with variants, open, and the kinds not in the plan. */
  found: number;
}

export interface UpdatePlan {
  /** New questions with variants, in file order: they are added. */
  add: DraftItem[];
  /** New questions that cannot be saved as they are (too few or too many options): in the queue. */
  blocked: DraftItem[];
  /** Questions of the file already in the subject: not added again. */
  same: number;
  /** Of those, the ones whose key in the file differs from the subject's: listed, never changed here. */
  keyDiffers: Array<{ item: DraftItem; saved: TestItem }>;
  /** The subject's questions the file does not have: they stay. */
  notInFile: number;
  /** The subject's topic titles after the update, when the file brings new topics; null when nothing changes. */
  topics: string[] | null;
  /** The topic number in the subject of each new question (by uid). */
  topicOf: Record<string, number | null>;
}

/** Text as the comparison sees it. */
export function sameText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!?…]+$/u, '');
}

const SEP = '\u0001';
const SEP_OPTIONS = '\u0002';

function identity(stem: string, kind: string, options: readonly string[]): string {
  const head = sameText(stem);
  if (kind === 'short') return `short${SEP}${head}`;
  return `${head}${SEP}${options.map(sameText).sort().join(SEP_OPTIONS)}`;
}

/** The key as a set of option texts (a short answer: its accepted forms); null when there is none. */
function keyOf(kind: string, options: readonly string[], correct: readonly number[], answers: readonly string[]): string | null {
  if (kind === 'short') return answers.length ? answers.map(shortNorm).sort().join(SEP_OPTIONS) : null;
  if (correct.length === 0) return null;
  return correct
    .map((index) => sameText(options[index] ?? ''))
    .sort()
    .join(SEP_OPTIONS);
}

/**
 * The pictures of a question as the comparison sees them: the hashes (a draft names a picture by its sha256, a saved
 * question by «<container>/<sha256>.<ext>»), so the same words under other pictures are another question.
 */
function pictureIdentity(images: Partial<{ stem: string[]; options: string[][] }> | null | undefined): string {
  if (!images) return '';
  const hash = (name: string) => name.replace(/^.*\//, '').replace(/[.].*$/, '');
  const stem = (images.stem ?? []).map(hash).join(',');
  const options = (images.options ?? []).map((list) => list.map(hash).join(',')).filter(Boolean).sort().join(';');
  return stem || options ? `${SEP}${stem}${SEP}${options}` : '';
}

const draftIdentity = (item: DraftItem) => identity(item.text, item.kind, item.options) + pictureIdentity(item.images);
const savedIdentity = (item: TestItem) => identity(item.stem, item.kind, item.options) + pictureIdentity(item.images);

/** The file's subjects (their parts of a long oral list joined), each a possible source of the update. */
export function updateSources(subjects: readonly DraftSubject[]): UpdateSource[] {
  const byKey = new Map<string, UpdateSource>();
  for (const subject of activeSubjects(subjects)) {
    const key = subject.key.replace(/#\d+$/, '');
    let source = byKey.get(key);
    if (!source) {
      source = {
        key,
        fileId: subject.fileId,
        fileIds: subject.files.map((entry) => entry.id),
        title: subject.part ? subject.title.replace(/, часть \d+$/, '') : subject.title,
        test: [],
        blocked: [],
        oral: 0,
        skippedKinds: 0,
        allNoKey: false,
        found: 0,
      };
      byKey.set(key, source);
    }
    source.test.push(...subject.test);
    source.blocked.push(...subject.blocked);
    source.oral += subject.oral.length;
    source.skippedKinds += subject.skippedKinds;
    source.allNoKey = source.allNoKey || subject.allNoKey;
    source.found += subject.test.length + subject.blocked.length + subject.oral.length + subject.skippedKinds;
  }
  return [...byKey.values()];
}

/**
 * The source that most likely is this subject: the most questions already in it, then the same name, then the first.
 * Null when the file has nothing.
 */
export function bestSource(sources: readonly UpdateSource[], saved: readonly TestItem[], title: string): UpdateSource | null {
  if (sources.length === 0) return null;
  const known = new Set(saved.map(savedIdentity));
  const name = sameText(title);
  let best = sources[0];
  let bestScore = -1;
  for (const source of sources) {
    const matches = [...source.test, ...source.blocked].filter((item) => known.has(draftIdentity(item))).length;
    const score = matches * 2 + (sameText(source.title) === name ? 1 : 0);
    if (score > bestScore) {
      best = source;
      bestScore = score;
    }
  }
  return best;
}

/** What the file brings to the subject (see the header). */
export function planUpdate(source: UpdateSource | null, saved: readonly TestItem[], subject: Pick<SummarySubject, 'topic_titles'>): UpdatePlan {
  const plan: UpdatePlan = { add: [], blocked: [], same: 0, keyDiffers: [], notInFile: 0, topics: null, topicOf: {} };
  const savedBy = new Map<string, TestItem>();
  for (const item of [...saved].sort((a, b) => a.position - b.position)) {
    const key = savedIdentity(item);
    if (!savedBy.has(key)) savedBy.set(key, item);
  }
  const inFile = new Set<string>();
  for (const item of source ? subjectOrder([...source.test, ...source.blocked], source.fileIds) : []) {
    const key = draftIdentity(item);
    inFile.add(key);
    const match = savedBy.get(key);
    if (match) {
      plan.same += 1;
      const fileKey = keyOf(item.kind, item.options, item.correct, item.answers);
      if (fileKey !== null && fileKey !== keyOf(match.kind, match.options, match.correct, match.answers)) {
        plan.keyDiffers.push({ item, saved: match });
      }
      continue;
    }
    (item.blocked ? plan.blocked : plan.add).push(item);
  }
  plan.notInFile = saved.filter((item) => !inFile.has(savedIdentity(item))).length;

  // Topics: the subject's own by name, else new ones after them.
  const titles = subject.topic_titles;
  const byTitle = new Map<string, number>();
  titles.forEach((title, index) => {
    const key = sameText(title);
    if (!byTitle.has(key)) byTitle.set(key, index + 1);
  });
  const used = Math.max(titles.length, ...saved.map((item) => item.topic ?? 0));
  const added: string[] = [];
  for (const item of plan.add) {
    if (!item.topicTitle) {
      plan.topicOf[item.uid] = null;
      continue;
    }
    const key = sameText(item.topicTitle);
    let topic = byTitle.get(key);
    if (topic === undefined) {
      if (used + added.length < TOPIC_CAP) {
        added.push(item.topicTitle.slice(0, 200));
        topic = used + added.length;
        byTitle.set(key, topic);
      } else {
        topic = TOPIC_CAP;
      }
    }
    plan.topicOf[item.uid] = topic;
  }
  if (added.length > 0) {
    const gap = Array.from({ length: used - titles.length }, (_, index) => `Тема ${titles.length + index + 1}`);
    plan.topics = [...titles, ...gap, ...added];
  }
  return plan;
}

/** The new questions as container_items_add takes them, with the subject's topic numbers (refs: each one's file). */
export function updateItemInputs(plan: UpdatePlan, importId: string | ((fileId: string) => string), place?: PicturePlace): ItemInput[] {
  return itemInputs({ test: plan.add.map((item) => ({ ...item, topic: plan.topicOf[item.uid] ?? null })) }, importId, place);
}

// ─────────────────────────────── variants into a subject the exam already has ───────────────────────────────

/** What a subject of variants brings to the exam's subject of the same name: the update plan, as «Обновить из файла». */
export interface JoinPlan {
  subjectId: string;
  plan: UpdatePlan;
}

/**
 * «Куда добавить: к …» with a subject of variants whose name the exam already has (owner, 2026-11-04: variants 1–6 one
 * day, 7–12 the next): its new variants land in that subject rather than in a second subject of the same name. Only a
 * subject made of variants (two files or more) without an oral part joins; any other is added as a new subject, as
 * before. The subject's key → the id of the exam's subject (its first of that name).
 */
export function joinTargets(subjects: readonly DraftSubject[], existing: ReadonlyArray<{ id: string; title: string }>): Record<string, string> {
  const byName = new Map<string, string>();
  for (const subject of existing) {
    const name = sameText(subject.title);
    if (!byName.has(name)) byName.set(name, subject.id);
  }
  const out: Record<string, string> = {};
  for (const subject of activeSubjects(subjects)) {
    if (subject.files.length < 2 || subject.part !== null || subject.oral.length > 0) continue;
    const id = byName.get(sameText(subject.title));
    if (id) out[subject.key] = id;
  }
  return out;
}

/**
 * The plan of each joining subject against the exam's saved questions: the same question is not added again, a key in
 * the file that differs is only listed, new topics («Вариант 7» …) go after the subject's own.
 */
export function joinPlans(
  subjects: readonly DraftSubject[],
  targets: Readonly<Record<string, string>>,
  saved: { subjects: ReadonlyArray<Pick<SummarySubject, 'id' | 'topic_titles'>>; items: readonly TestItem[] },
): Record<string, JoinPlan> {
  const out: Record<string, JoinPlan> = {};
  for (const source of updateSources(subjects)) {
    const subjectId = targets[source.key];
    const target = subjectId ? saved.subjects.find((subject) => subject.id === subjectId) : undefined;
    if (!subjectId || !target) continue;
    const items = saved.items.filter((item) => item.subject_id === subjectId);
    out[source.key] = { subjectId, plan: planUpdate(source, items, target) };
  }
  return out;
}
