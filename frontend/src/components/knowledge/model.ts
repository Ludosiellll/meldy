/**
 * The knowledge map's model: what the map shows, before any geometry.
 *
 * Nodes are the student's lectures and the concepts of their glossaries (summary_json.terms). A
 * concept is the same in two lectures when its words have the same stems («Денежный мультипликатор»
 * and «денежного мультипликатора»), so it becomes a bridge between them. Exam questions are attached
 * to the lectures their mapping cites (coverage «есть» or «частично», evidence); their readiness
 * comes from the answer journal (lib/learning/readiness.ts). Open mistakes of the diary belong to
 * their lecture (material_id) and, by words, to the concepts they mention. Pure: no network, no
 * storage, no DOM.
 */
import type { CoverageValue, EvidenceItem, ExamKind } from '../../api/exams';
import type { QuestionState, Readiness } from '../../lib/learning/readiness';
import { daysUntil, questionNumber } from '../../lib/exams/format';
import { orderExamLectures } from '../../lib/lectureOrder';
import { normalizeForMatch, wordStem } from '../conversation/visuals';
import { stripSourceMarkers } from '../summary/sourceMarkers';
import { displayMaterialTitle } from '../../utils/materialTitle';

// ---------------------------------------------------------------------------------------------
// Input rows (as read from Supabase, defensively typed)

export interface RawMaterial {
  id: string;
  title?: string | null;
  subject?: string | null;
  created_at?: string | null;
  summary_json?: unknown;
}

export interface RawMistake {
  id: string;
  question?: string | null;
  topic?: string | null;
  is_resolved?: boolean | null;
  material_id?: string | null;
  origin?: string | null;
  created_at?: string | null;
}

export interface RawExam {
  id: string;
  title: string;
  kind: ExamKind;
  exam_date: string | null;
  created_at: string;
  /** The exam's lectures in the order they were added. */
  materials: Array<{ id: string; addedAt?: string }>;
}

export interface RawQuestion {
  id: string;
  exam_id: string;
  position: number;
  label: string;
  text: string;
  question_hash: string | null;
  coverage: CoverageValue | null;
  coverage_method: string | null;
  evidence: EvidenceItem[];
}

export interface KnowledgeInput {
  materials: RawMaterial[];
  mistakes: RawMistake[];
  exams: RawExam[];
  questions: RawQuestion[];
  /** Question states by question hash (statesByHash of the journal); empty when it was not read. */
  states: Map<string, QuestionState>;
  /** Review cards that are due, by material id. */
  dueByMaterial: Map<string, number>;
  now?: Date;
}

// ---------------------------------------------------------------------------------------------
// Terms of a summary

export interface ParsedTerm {
  term: string;
  definition: string;
  sourceIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && /^S\d{1,4}$/.test(id.trim())).map((id) => id.trim())));
}

/** The summary of a material as an object (older rows keep JSON as a string or Markdown directly). */
function summaryObject(raw: unknown): { summary: Record<string, unknown> | null; text: string } {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { summary: null, text: value as string };
    }
  }
  if (!isRecord(value)) return { summary: null, text: typeof value === 'string' ? value : '' };
  const content = typeof value.content === 'string' ? value.content : typeof value.raw === 'string' ? value.raw : '';
  return { summary: value, text: content };
}

/** True when the lecture was imported as text only (no summary, no glossary). */
export function isTextOnly(raw: unknown): boolean {
  const { summary } = summaryObject(raw);
  return Boolean(summary && (summary.text_only === true || summary.text_only === 'true'));
}

/**
 * The glossary of a summary: summary_json.terms, or for older rows the «Термины» section of the
 * Markdown (**термин** — определение), or bold terms with a definition anywhere in the text.
 */
export function extractTerms(raw: unknown): ParsedTerm[] {
  const { summary, text } = summaryObject(raw);
  const structured = summary && Array.isArray(summary.terms) ? summary.terms : [];
  const terms: ParsedTerm[] = [];
  for (const item of structured) {
    if (!isRecord(item) || typeof item.term !== 'string') continue;
    // The fragment marks the model copied («[S01]») are not words of the glossary.
    const term = stripSourceMarkers(item.term).trim();
    const definition = typeof item.definition === 'string' ? stripSourceMarkers(item.definition).trim() : '';
    if (term && definition) terms.push({ term, definition, sourceIds: cleanSourceIds(item.source_ids) });
  }
  if (terms.length > 0) return dedupeTerms(terms);
  if (!text.trim()) return [];

  const sections = text.split(/(?=^##\s)/gm);
  const glossary = sections.find((section) => /термин|терминология|глоссар/i.test(section)) ?? '';
  const listed = /(?:^|\n)\s*(?:\d+\.|[-*])\s+\*\*([^*]+)\*\*\s*(?:—|–|-|:)\s*([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = listed.exec(glossary)) !== null) terms.push({ term: match[1].trim(), definition: match[2].trim(), sourceIds: [] });
  if (terms.length === 0) {
    const inline = /\*\*([^*]+)\*\*\s*(?:—|–|-|:)\s*([^\n]+)/g;
    while ((match = inline.exec(text)) !== null) {
      const term = match[1].trim();
      const definition = match[2].trim();
      if (term.length <= 48 && definition.length > 5) terms.push({ term, definition, sourceIds: [] });
    }
  }
  return dedupeTerms(terms);
}

function dedupeTerms(terms: ParsedTerm[]): ParsedTerm[] {
  const seen = new Set<string>();
  return terms.filter(({ term, definition }) => {
    const key = conceptKey(term);
    if (!key || !definition || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Words

/** Lower case, ё → е, words only. */
export function tokensOf(text: string): string[] {
  return normalizeForMatch(text).split(' ').filter(Boolean);
}

/** A word of three letters or fewer is matched whole («ток», «ввп»): its stem ends with this mark. */
const WHOLE = '$';

/**
 * Stems of a term's words (the same rough stems «Разговор» uses to find a term in a line); a short
 * word is kept whole and marked, so it never matches the start of a longer word.
 */
export function stemsOf(term: string): string[] {
  return tokensOf(term).map((word) => (word.length <= 3 ? `${word}${WHOLE}` : wordStem(word)));
}

/**
 * The key two lectures share a concept by: the stems of its words. «Инфляция спроса» and «инфляции
 * спроса» get one key. Empty for a term without letters (a number) or of a single letter.
 */
export function conceptKey(term: string): string {
  const key = stemsOf(term).join(' ');
  const bare = key.split(WHOLE).join('');
  if (bare.length < 2 || /^[\d ]+$/.test(bare)) return '';
  return key;
}

/**
 * True when the words of a text contain the term's words in order, each word starting with the
 * term's stem («ставк» finds «ставки», «ставкой»). A short word must match a whole word, so «ток» is
 * not found in «поток» or «токен».
 */
export function containsStems(tokens: string[], stems: string[]): boolean {
  if (stems.length === 0 || tokens.length < stems.length) return false;
  for (let start = 0; start + stems.length <= tokens.length; start += 1) {
    let ok = true;
    for (let offset = 0; offset < stems.length; offset += 1) {
      const token = tokens[start + offset];
      const stem = stems[offset];
      const match = stem.endsWith(WHOLE) ? token === stem.slice(0, -1) : token.startsWith(stem);
      if (!match) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The whole picture (built once per load)

export interface LectureTerm {
  key: string;
  term: string;
  definition: string;
  sourceIds: string[];
}

export interface Lecture {
  id: string;
  /** For people: displayMaterialTitle (file names become words). */
  title: string;
  subject: string;
  createdAt: string;
  terms: LectureTerm[];
  textOnly: boolean;
  openMistakes: RawMistake[];
  dueCards: number;
}

export interface ConceptDefinition {
  lectureId: string;
  text: string;
  sourceIds: string[];
}

export interface Concept {
  key: string;
  label: string;
  stems: string[];
  /** Every lecture of the student where the term appears, oldest first. */
  lectureIds: string[];
  definitions: ConceptDefinition[];
}

export interface ExamEntry {
  id: string;
  title: string;
  kind: ExamKind;
  examDate: string | null;
  createdAt: string;
  /** Calendar days to the exam (negative when it is over), null without a date. */
  daysLeft: number | null;
  /** The exam's lectures that still exist, in the order they were added. */
  lectureIds: string[];
}

export interface QuestionView {
  id: string;
  examId: string;
  /** The department's number when there is one, otherwise the position. */
  number: string;
  position: number;
  text: string;
  hash: string | null;
  coverage: CoverageValue | null;
  manual: boolean;
  readiness: Readiness;
  state: QuestionState | null;
  /** The lectures the mapping cites for this question (coverage «есть» or «частично»), with fragments. */
  lectures: Array<{ lectureId: string; sourceIds: string[] }>;
  tokens: string[];
}

export interface KnowledgeBase {
  lectures: Lecture[];
  lectureById: Map<string, Lecture>;
  concepts: Map<string, Concept>;
  exams: ExamEntry[];
  questionsByExam: Map<string, QuestionView[]>;
  openMistakes: Array<RawMistake & { tokens: string[] }>;
  now: Date;
}

function byTime(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Upcoming exams by date, then the ones without a date (newest first), then past ones (latest first). */
function orderExams(exams: ExamEntry[]): ExamEntry[] {
  const upcoming = exams.filter((exam) => exam.daysLeft !== null && exam.daysLeft >= 0).sort((a, b) => (a.daysLeft! - b.daysLeft!) || a.id.localeCompare(b.id));
  const undated = exams.filter((exam) => exam.daysLeft === null).sort((a, b) => byTime(b.createdAt, a.createdAt) || a.id.localeCompare(b.id));
  const past = exams.filter((exam) => exam.daysLeft !== null && exam.daysLeft < 0).sort((a, b) => (b.daysLeft! - a.daysLeft!) || a.id.localeCompare(b.id));
  return [...upcoming, ...undated, ...past];
}

export function buildKnowledgeBase(input: KnowledgeInput): KnowledgeBase {
  const now = input.now ?? new Date();
  const openMistakes = input.mistakes
    .filter((mistake) => mistake && typeof mistake.id === 'string' && mistake.is_resolved !== true)
    .map((mistake) => ({ ...mistake, tokens: tokensOf(`${mistake.topic ?? ''} ${mistake.question ?? ''}`) }));

  const lectures: Lecture[] = input.materials
    .filter((material) => material && typeof material.id === 'string')
    .map((material) => {
      const terms = extractTerms(material.summary_json).map((term) => ({ key: conceptKey(term.term), term: term.term, definition: term.definition, sourceIds: term.sourceIds }));
      return {
        id: material.id,
        title: displayMaterialTitle(material.title ?? ''),
        subject: typeof material.subject === 'string' ? material.subject.trim() : '',
        createdAt: typeof material.created_at === 'string' ? material.created_at : '',
        terms: terms.filter((term) => term.key),
        textOnly: isTextOnly(material.summary_json),
        openMistakes: openMistakes.filter((mistake) => mistake.material_id === material.id),
        dueCards: input.dueByMaterial.get(material.id) ?? 0,
      };
    })
    .sort((a, b) => byTime(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
  const lectureById = new Map(lectures.map((lecture) => [lecture.id, lecture]));

  // Concepts: one per key; the label is the form most lectures use (the earliest one on a tie).
  const forms = new Map<string, Map<string, number>>();
  const concepts = new Map<string, Concept>();
  for (const lecture of lectures) {
    for (const term of lecture.terms) {
      let concept = concepts.get(term.key);
      if (!concept) {
        concept = { key: term.key, label: term.term, stems: term.key.split(' '), lectureIds: [], definitions: [] };
        concepts.set(term.key, concept);
        forms.set(term.key, new Map());
      }
      if (!concept.lectureIds.includes(lecture.id)) {
        concept.lectureIds.push(lecture.id);
        concept.definitions.push({ lectureId: lecture.id, text: term.definition, sourceIds: term.sourceIds });
      }
      const counts = forms.get(term.key)!;
      counts.set(term.term, (counts.get(term.term) ?? 0) + 1);
    }
  }
  for (const concept of concepts.values()) {
    let best = concept.label;
    let bestCount = 0;
    for (const [form, count] of forms.get(concept.key)!) {
      if (count > bestCount) {
        best = form;
        bestCount = count;
      }
    }
    concept.label = best;
  }

  const exams = orderExams(
    input.exams
      .filter((exam) => exam && typeof exam.id === 'string')
      .map((exam) => ({
        id: exam.id,
        title: exam.title.trim() || 'Экзамен',
        kind: exam.kind,
        examDate: exam.exam_date,
        createdAt: exam.created_at,
        daysLeft: daysUntil(exam.exam_date, now),
        // Numbered as «Лекции» numbers them (lib/lectureOrder): «Лекция 1» is the same lecture on both pages.
        lectureIds: orderExamLectures(exam.materials, (id) => lectureById.get(id)?.createdAt)
          .map((item) => item.id)
          .filter((id) => lectureById.has(id)),
      })),
  );

  const questionsByExam = new Map<string, QuestionView[]>();
  for (const row of input.questions) {
    if (!row || typeof row.id !== 'string') continue;
    const state = row.question_hash ? input.states.get(row.question_hash) ?? null : null;
    const cited = row.coverage === 'full' || row.coverage === 'partial' ? row.evidence : [];
    const byLecture = new Map<string, string[]>();
    for (const item of cited) {
      if (!item.material_id || !lectureById.has(item.material_id)) continue;
      const list = byLecture.get(item.material_id) ?? [];
      if (item.source_id && !list.includes(item.source_id)) list.push(item.source_id);
      byLecture.set(item.material_id, list);
    }
    const view: QuestionView = {
      id: row.id,
      examId: row.exam_id,
      number: questionNumber(row.label.replace(/[.)]\s*$/, ''), row.position),
      position: row.position,
      text: row.text,
      hash: row.question_hash,
      coverage: row.coverage,
      manual: row.coverage_method === 'manual',
      readiness: state?.readiness ?? 'untested',
      state,
      lectures: Array.from(byLecture, ([lectureId, sourceIds]) => ({ lectureId, sourceIds })),
      tokens: tokensOf(row.text),
    };
    const list = questionsByExam.get(row.exam_id) ?? [];
    list.push(view);
    questionsByExam.set(row.exam_id, list);
  }
  for (const list of questionsByExam.values()) list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  return { lectures, lectureById, concepts, exams, questionsByExam, openMistakes, now };
}

/** The exams that have at least one lecture on the map (the others have nothing to draw). */
export function examsWithLectures(base: KnowledgeBase): ExamEntry[] {
  return base.exams.filter((exam) => exam.lectureIds.length > 0);
}

/** The map opens on the nearest exam: the next one by date, else the newest without a date, else all lectures. */
export function defaultExamId(base: KnowledgeBase): string | null {
  const exams = examsWithLectures(base);
  const upcoming = exams.find((exam) => exam.daysLeft !== null && exam.daysLeft >= 0);
  if (upcoming) return upcoming.id;
  const undated = exams.find((exam) => exam.daysLeft === null);
  return undated ? undated.id : null;
}

/** Subjects of the lectures (the empty subject is «Без предмета»), most lectures first. */
export function subjectsOf(base: KnowledgeBase): Array<{ subject: string; count: number }> {
  const counts = new Map<string, number>();
  for (const lecture of base.lectures) counts.set(lecture.subject, (counts.get(lecture.subject) ?? 0) + 1);
  return Array.from(counts, ([subject, count]) => ({ subject, count })).sort(
    (a, b) => b.count - a.count || (a.subject === '' ? 1 : b.subject === '' ? -1 : a.subject.localeCompare(b.subject, 'ru')),
  );
}

// ---------------------------------------------------------------------------------------------
// One map: a scope (an exam or all lectures, optionally one subject) and what it shows

export interface ScopeOptions {
  /** null: all lectures. */
  examId: string | null;
  /** null: every subject; '' is «Без предмета». Applies to «Все лекции» only. */
  subject: string | null;
  /** Show the concepts of a single lecture too (next to its card). */
  showAll: boolean;
}

export interface MapLecture {
  id: string;
  title: string;
  subject: string;
  createdAt: string;
  /** Position in its group, as the Library numbers its lists. */
  number: number;
  groupId: string;
  textOnly: boolean;
  termCount: number;
  /** Exam questions the mapping found in this lecture (position order). */
  questions: QuestionView[];
  openMistakes: RawMistake[];
  dueCards: number;
  /** Keys of every concept of the lecture. */
  conceptKeys: string[];
}

export interface MapConcept {
  key: string;
  label: string;
  stems: string[];
  /** The lectures of this map where the term appears, in map order. */
  lectureIds: string[];
  /** Every lecture of the student with this term (other exams included). */
  allLectureIds: string[];
  definitions: ConceptDefinition[];
  shared: boolean;
  /** Open mistakes of the diary that mention the term (and are not tied to another lecture). */
  openMistakes: RawMistake[];
  weak: boolean;
  /** Questions of the selected exam whose text contains the term. */
  questionIds: string[];
}

export interface MapGroup {
  id: string;
  label: string;
  lectureIds: string[];
}

export interface MapEdge {
  id: string;
  conceptKey: string;
  lectureId: string;
}

export interface MapCounts {
  readiness: Record<Readiness, number>;
  /** Questions with coverage «нет ни в одной лекции». */
  none: number;
  openMistakes: number;
  dueCards: number;
  /** Concepts shared by two or more lectures of this map. */
  shared: number;
  /** Concepts of the lectures of this map. */
  concepts: number;
  weak: number;
  /** Concepts left off the map by the caps. */
  hidden: number;
}

export interface MapView {
  key: string;
  exam: ExamEntry | null;
  lectures: MapLecture[];
  lectureById: Map<string, MapLecture>;
  groups: MapGroup[];
  /** The concepts drawn on the map. */
  concepts: MapConcept[];
  /** Every concept of the lectures of this map, drawn or not. */
  conceptByKey: Map<string, MapConcept>;
  edges: MapEdge[];
  questions: QuestionView[];
  questionById: Map<string, QuestionView>;
  /** Questions that are in no lecture («нет ни в одной лекции»). */
  unplaced: QuestionView[];
  counts: MapCounts;
}

/** Concepts shared by lectures, at most this many on the map (the rest stay in the list and the panels). */
export const MAX_SHARED = 120;
/** Concepts of one lecture with open mistakes, shown even when only shared ones are. */
export const MAX_WEAK_SINGLE = 40;
/** Every concept («все понятия»), at most this many. */
export const MAX_ALL = 400;

export const OTHER_GROUP = 'other';

function conceptPriority(a: MapConcept, b: MapConcept): number {
  return (
    b.lectureIds.length - a.lectureIds.length ||
    Number(b.weak) - Number(a.weak) ||
    b.questionIds.length - a.questionIds.length ||
    a.label.localeCompare(b.label, 'ru') ||
    a.key.localeCompare(b.key)
  );
}

export function buildMapView(base: KnowledgeBase, options: ScopeOptions): MapView {
  const exam = options.examId ? base.exams.find((item) => item.id === options.examId) ?? null : null;

  // Lectures and their groups, in map order.
  const groups: MapGroup[] = [];
  if (exam) {
    groups.push({ id: exam.id, label: exam.title, lectureIds: [...exam.lectureIds] });
  } else {
    const taken = new Set<string>();
    const wanted = (id: string) => {
      const lecture = base.lectureById.get(id);
      return Boolean(lecture) && !taken.has(id) && (options.subject === null || lecture!.subject === options.subject);
    };
    for (const item of examsWithLectures(base)) {
      const ids = item.lectureIds.filter(wanted);
      ids.forEach((id) => taken.add(id));
      if (ids.length) groups.push({ id: item.id, label: item.title, lectureIds: ids });
    }
    // Lectures outside every exam: newest first, as the Library lists them.
    const rest = base.lectures.filter((lecture) => wanted(lecture.id)).reverse().map((lecture) => lecture.id);
    if (rest.length) groups.push({ id: OTHER_GROUP, label: groups.length ? 'Другие материалы' : 'Все лекции', lectureIds: rest });
  }

  const questions = exam ? base.questionsByExam.get(exam.id) ?? [] : [];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const orderIds = groups.flatMap((group) => group.lectureIds);
  const inScope = new Set(orderIds);
  const orderIndex = new Map(orderIds.map((id, index) => [id, index]));

  const lectures: MapLecture[] = [];
  for (const group of groups) {
    group.lectureIds.forEach((id, index) => {
      const lecture = base.lectureById.get(id)!;
      lectures.push({
        id,
        title: lecture.title,
        subject: lecture.subject,
        createdAt: lecture.createdAt,
        number: index + 1,
        groupId: group.id,
        textOnly: lecture.textOnly,
        termCount: lecture.terms.length,
        questions: questions.filter((question) => question.lectures.some((item) => item.lectureId === id)),
        openMistakes: lecture.openMistakes,
        dueCards: lecture.dueCards,
        conceptKeys: lecture.terms.map((term) => term.key),
      });
    });
  }
  const lectureById = new Map(lectures.map((lecture) => [lecture.id, lecture]));

  // Concepts of the lectures of this map.
  const conceptByKey = new Map<string, MapConcept>();
  for (const lecture of lectures) {
    for (const key of lecture.conceptKeys) {
      if (conceptByKey.has(key)) continue;
      const concept = base.concepts.get(key);
      if (!concept) continue;
      const here = concept.lectureIds.filter((id) => inScope.has(id)).sort((a, b) => orderIndex.get(a)! - orderIndex.get(b)!);
      const all = new Set(concept.lectureIds);
      const mistakes = base.openMistakes.filter(
        (mistake) => (!mistake.material_id || all.has(mistake.material_id)) && containsStems(mistake.tokens, concept.stems),
      );
      conceptByKey.set(key, {
        key,
        label: concept.label,
        stems: concept.stems,
        lectureIds: here,
        allLectureIds: concept.lectureIds,
        definitions: concept.definitions.filter((item) => inScope.has(item.lectureId)).sort((a, b) => orderIndex.get(a.lectureId)! - orderIndex.get(b.lectureId)!),
        shared: here.length >= 2,
        openMistakes: mistakes,
        weak: mistakes.length > 0,
        questionIds: questions.filter((question) => containsStems(question.tokens, concept.stems)).map((question) => question.id),
      });
    }
  }

  const all = Array.from(conceptByKey.values()).sort(conceptPriority);
  const shared = all.filter((concept) => concept.shared);
  let shown: MapConcept[];
  if (options.showAll) {
    shown = all.slice(0, MAX_ALL);
  } else {
    const weakSingle = all.filter((concept) => !concept.shared && concept.weak).slice(0, MAX_WEAK_SINGLE);
    shown = [...shared.slice(0, MAX_SHARED), ...weakSingle];
  }
  const edges: MapEdge[] = [];
  for (const concept of shown) {
    for (const lectureId of concept.lectureIds) edges.push({ id: `${concept.key}→${lectureId}`, conceptKey: concept.key, lectureId });
  }

  const readiness: Record<Readiness, number> = { confirmed: 0, once: 0, not_passed: 0, untested: 0 };
  const attached = new Set<string>();
  for (const lecture of lectures) for (const question of lecture.questions) attached.add(question.id);
  for (const id of attached) readiness[questionById.get(id)!.readiness] += 1;
  const unplaced = questions.filter((question) => question.coverage === 'none');
  const eligible = options.showAll ? all.length : shared.length + all.filter((concept) => !concept.shared && concept.weak).length;

  return {
    key: `${exam ? exam.id : 'all'}|${options.subject ?? '*'}|${options.showAll ? 'all' : 'shared'}`,
    exam,
    lectures,
    lectureById,
    groups,
    concepts: shown,
    conceptByKey,
    edges,
    questions,
    questionById,
    unplaced,
    counts: {
      readiness,
      none: unplaced.length,
      openMistakes: lectures.reduce((sum, lecture) => sum + lecture.openMistakes.length, 0),
      dueCards: lectures.reduce((sum, lecture) => sum + lecture.dueCards, 0),
      shared: shared.length,
      concepts: all.length,
      weak: all.filter((concept) => concept.weak).length,
      hidden: Math.max(0, eligible - shown.length),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Neighbourhoods, search and highlights (node ids: 'l:<lecture id>', 'c:<concept key>')

export type NodeId = string;

export const lectureNode = (id: string): NodeId => `l:${id}`;
export const conceptNode = (key: string): NodeId => `c:${key}`;

export interface Neighbourhood {
  /** The node and its direct neighbours. */
  nodes: Set<NodeId>;
  /** Edges touching the node. */
  edges: Set<string>;
  /** For a lecture: where its shared concepts lead (the other lectures and those edges). */
  far: Set<NodeId>;
  farEdges: Set<string>;
}

export function neighbourhood(view: MapView, node: NodeId): Neighbourhood {
  const result: Neighbourhood = { nodes: new Set([node]), edges: new Set(), far: new Set(), farEdges: new Set() };
  if (node.startsWith('c:')) {
    const key = node.slice(2);
    for (const edge of view.edges) {
      if (edge.conceptKey !== key) continue;
      result.edges.add(edge.id);
      result.nodes.add(lectureNode(edge.lectureId));
    }
    return result;
  }
  const lectureId = node.slice(2);
  const concepts = new Set<string>();
  for (const edge of view.edges) {
    if (edge.lectureId !== lectureId) continue;
    result.edges.add(edge.id);
    result.nodes.add(conceptNode(edge.conceptKey));
    concepts.add(edge.conceptKey);
  }
  for (const edge of view.edges) {
    if (edge.lectureId === lectureId || !concepts.has(edge.conceptKey)) continue;
    result.farEdges.add(edge.id);
    result.far.add(lectureNode(edge.lectureId));
  }
  return result;
}

/** Normalised search text: lower case, ё → е, single spaces. */
export function normalizeQuery(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Lectures and drawn concepts whose name contains the query. */
export function searchNodes(view: MapView, query: string): Set<NodeId> {
  const needle = normalizeQuery(query);
  const found = new Set<NodeId>();
  if (!needle) return found;
  for (const lecture of view.lectures) if (normalizeQuery(lecture.title).includes(needle)) found.add(lectureNode(lecture.id));
  for (const concept of view.concepts) if (normalizeQuery(concept.label).includes(needle)) found.add(conceptNode(concept.key));
  return found;
}

export type Highlight = { kind: 'readiness'; value: Readiness } | { kind: 'mistakes' } | { kind: 'due' };

export function highlightKey(highlight: Highlight | null): string {
  if (!highlight) return '';
  return highlight.kind === 'readiness' ? `rd:${highlight.value}` : highlight.kind;
}

/** What a legend filter lights up: the lectures (and concepts) it is about. */
export function highlightNodes(view: MapView, highlight: Highlight): Set<NodeId> {
  const lit = new Set<NodeId>();
  if (highlight.kind === 'readiness') {
    for (const lecture of view.lectures) {
      if (lecture.questions.some((question) => question.readiness === highlight.value)) lit.add(lectureNode(lecture.id));
    }
  } else if (highlight.kind === 'mistakes') {
    for (const lecture of view.lectures) if (lecture.openMistakes.length > 0) lit.add(lectureNode(lecture.id));
    for (const concept of view.concepts) if (concept.weak) lit.add(conceptNode(concept.key));
  } else {
    for (const lecture of view.lectures) if (lecture.dueCards > 0) lit.add(lectureNode(lecture.id));
  }
  return lit;
}
