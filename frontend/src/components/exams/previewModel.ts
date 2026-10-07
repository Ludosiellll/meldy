/**
 * The editable preview of a question list (tickets spec 3.3): rows are questions or section
 * headings; a row can be edited, deleted, merged with the next one, split in two or turned into a
 * heading. Known tickets point at rows by key, so every edit keeps them consistent: a deleted row
 * leaves its ticket, a merged row hands its place to the row it joined.
 *
 * Pure functions: the editor keeps the state, tests call them directly.
 */
import type { DraftQuestion, DraftTicket, ExamQuestion, LayoutMode, ParseResult, TicketLayout } from '../../api/exams';
import { LABEL_MAX_CHARS, MAX_QUESTIONS, MAX_SECTIONS, QUESTION_MAX_CHARS, QUESTION_MIN_CHARS } from '../../api/exams';
import { normalizeForMatch, wordStem } from '../conversation/visuals';

export interface PreviewRow {
  /** Stable key: the question id for a saved question, a local key otherwise. */
  key: string;
  /** Saved question id (edit mode). */
  id: string | null;
  kind: 'question' | 'section';
  /** The department's number of the question ('' when the list had none). */
  label: string;
  text: string;
  /** Parser notes: joined_lines, long, short, duplicate_removed. */
  flags: string[];
}

export interface PreviewState {
  rows: PreviewRow[];
  tickets: DraftTicket[];
}

export const EMPTY_PREVIEW: PreviewState = { rows: [], tickets: [] };

export const FLAG_NOTES: Record<string, string> = {
  joined_lines: 'Склеены строки переноса — сверьте с исходником.',
  long: 'Очень длинная строка — возможно, склеились два вопроса.',
  short: 'Короткая строка — может быть, это заголовок?',
  duplicate_removed: 'Повтор этого вопроса убран из списка.',
};

let localCounter = 0;
function localKey(prefix: string): string {
  localCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${localCounter}`;
}

function withoutKey(tickets: DraftTicket[], key: string): DraftTicket[] {
  return tickets.map((ticket) => ({ ...ticket, keys: ticket.keys.filter((item) => item !== key) }));
}

function replaceKey(tickets: DraftTicket[], from: string, to: string): DraftTicket[] {
  return tickets.map((ticket) => ({
    ...ticket,
    keys: Array.from(new Set(ticket.keys.map((item) => (item === from ? to : item)))),
  }));
}

/** Preview of a fresh parse: one row per question, a heading row where a new section starts. */
export function previewFromParse(result: ParseResult): PreviewState {
  const titles = new Map(result.sections.map((section) => [section.index, section.title]));
  const rows: PreviewRow[] = [];
  let currentSection: number | null = null;
  for (const question of result.questions) {
    if (question.section !== null && question.section !== currentSection) {
      currentSection = question.section;
      rows.push({
        key: localKey('s'),
        id: null,
        kind: 'section',
        label: '',
        text: titles.get(question.section)?.trim() || `Раздел ${question.section}`,
        flags: [],
      });
    }
    rows.push({ key: `p${question.position}`, id: null, kind: 'question', label: question.label, text: question.text, flags: question.flags });
  }
  const known = new Set(rows.map((row) => row.key));
  const tickets = result.tickets
    .map((ticket) => ({ number: ticket.number, keys: ticket.positions.map((position) => `p${position}`).filter((key) => known.has(key)) }))
    .filter((ticket) => ticket.keys.length > 0);
  return { rows, tickets };
}

/** Preview of a saved exam (edit mode): rows keyed by question id, headings from the layout. */
export function previewFromExam(questions: ExamQuestion[], layout: TicketLayout): PreviewState {
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const rows: PreviewRow[] = [];
  let currentSection: number | null = null;
  for (const question of ordered) {
    if (question.section !== null && question.section !== currentSection) {
      currentSection = question.section;
      const title = layout.section_titles?.[question.section - 1]?.trim();
      rows.push({ key: localKey('s'), id: null, kind: 'section', label: '', text: title || `Раздел ${question.section}`, flags: [] });
    }
    rows.push({ key: question.id, id: question.id, kind: 'question', label: question.label, text: question.text, flags: [] });
  }
  const known = new Set(rows.map((row) => row.key));
  const tickets = (layout.tickets ?? [])
    .map((ticket) => ({ number: ticket.number, keys: ticket.question_ids.filter((id) => known.has(id)) }))
    .filter((ticket) => ticket.keys.length > 0);
  return { rows, tickets };
}

function matchKey(text: string): string {
  return normalizeForMatch(text);
}

/**
 * A list pasted again while editing: questions whose text is unchanged keep their saved id (and
 * their marks and answers); the rest become new questions.
 */
export function keepSavedQuestions(preview: PreviewState, saved: ExamQuestion[]): PreviewState {
  const pool = new Map<string, ExamQuestion[]>();
  for (const question of saved) {
    const key = matchKey(question.text);
    pool.set(key, [...(pool.get(key) ?? []), question]);
  }
  let tickets = preview.tickets;
  const rows = preview.rows.map((row) => {
    if (row.kind !== 'question') return row;
    const candidates = pool.get(matchKey(row.text));
    const match = candidates?.shift();
    if (!match) return row;
    tickets = replaceKey(tickets, row.key, match.id);
    return { ...row, key: match.id, id: match.id };
  });
  return { rows, tickets };
}

export function editRow(state: PreviewState, key: string, text: string): PreviewState {
  return { ...state, rows: state.rows.map((row) => (row.key === key ? { ...row, text, flags: row.flags.filter((flag) => flag === 'duplicate_removed') } : row)) };
}

export function editLabel(state: PreviewState, key: string, label: string): PreviewState {
  return { ...state, rows: state.rows.map((row) => (row.key === key ? { ...row, label: label.slice(0, LABEL_MAX_CHARS) } : row)) };
}

export function removeRow(state: PreviewState, key: string): PreviewState {
  return { rows: state.rows.filter((row) => row.key !== key), tickets: withoutKey(state.tickets, key).filter((ticket) => ticket.keys.length > 0) };
}

/** Joins a question with the next question row (a line broken in two); the next row's place in tickets goes to this one. */
export function mergeWithNext(state: PreviewState, key: string): PreviewState {
  const index = state.rows.findIndex((row) => row.key === key);
  const next = state.rows[index + 1];
  if (index < 0 || !next || state.rows[index].kind !== 'question' || next.kind !== 'question') return state;
  const current = state.rows[index];
  const joined = `${current.text.trim()} ${next.text.trim()}`.trim();
  const rows = [...state.rows];
  rows.splice(index, 2, { ...current, text: joined, flags: [] });
  return { rows, tickets: replaceKey(state.tickets, next.key, current.key) };
}

/** Where to split a text without a caret: the sentence end closest to the middle, else a space. */
export function splitPoint(text: string): number {
  const middle = text.length / 2;
  let best = -1;
  const sentence = /[.?!;](\s+)/g;
  let match: RegExpExecArray | null;
  while ((match = sentence.exec(text)) !== null) {
    const at = match.index + 1;
    if (at <= 0 || at >= text.length) continue;
    if (best < 0 || Math.abs(at - middle) < Math.abs(best - middle)) best = at;
  }
  if (best > 0) return best;
  const space = text.lastIndexOf(' ', Math.floor(middle));
  return space > 0 ? space : -1;
}

/** Splits a question in two at `at` (a caret position) or at the best sentence end. */
export function splitRow(state: PreviewState, key: string, at?: number): PreviewState {
  const index = state.rows.findIndex((row) => row.key === key);
  const row = state.rows[index];
  if (!row || row.kind !== 'question') return state;
  const point = at !== undefined && at > 0 && at < row.text.length ? at : splitPoint(row.text);
  if (point <= 0) return state;
  const first = row.text.slice(0, point).trim();
  const second = row.text.slice(point).trim();
  if (!first || !second) return state;
  const rows = [...state.rows];
  rows.splice(index, 1, { ...row, text: first, flags: [] }, { key: localKey('n'), id: null, kind: 'question', label: '', text: second, flags: [] });
  return { ...state, rows };
}

/** A question becomes a section heading (it leaves its ticket), or a heading becomes a question again. */
export function toggleSection(state: PreviewState, key: string): PreviewState {
  const row = state.rows.find((item) => item.key === key);
  if (!row) return state;
  if (row.kind === 'question') {
    return {
      rows: state.rows.map((item) => (item.key === key ? { ...item, kind: 'section' as const, flags: [] } : item)),
      tickets: withoutKey(state.tickets, key).filter((ticket) => ticket.keys.length > 0),
    };
  }
  // A heading that was a saved question keeps its id, so turning it back keeps its marks.
  return { ...state, rows: state.rows.map((item) => (item.key === key ? { ...item, kind: 'question' as const } : item)) };
}

/** Adds an empty question at the end (typed by hand). */
export function addQuestion(state: PreviewState): { state: PreviewState; key: string } {
  const key = localKey('n');
  return { state: { ...state, rows: [...state.rows, { key, id: null, kind: 'question', label: '', text: '', flags: [] }] }, key };
}

/** Questions in order with their section numbers (1-based count of headings above; none before the first). */
export function draftQuestions(state: PreviewState): DraftQuestion[] {
  const out: DraftQuestion[] = [];
  let section = 0;
  for (const row of state.rows) {
    if (row.kind === 'section') {
      section += 1;
      continue;
    }
    out.push({ key: row.key, id: row.id, label: row.label, section: section > 0 ? Math.min(section, MAX_SECTIONS) : null, text: row.text });
  }
  return out;
}

export function sectionTitles(state: PreviewState): string[] {
  return state.rows.filter((row) => row.kind === 'section').map((row) => row.text.trim());
}

export function questionCount(state: PreviewState): number {
  return state.rows.filter((row) => row.kind === 'question').length;
}

/** Sections that actually hold questions (what «one from each section» can use). */
export function filledSectionCount(state: PreviewState): number {
  return new Set(draftQuestions(state).map((question) => question.section).filter((section) => section !== null)).size;
}

/** Whether a ticket layout can be used for this list: known tickets need tickets, sections need one section per question. */
export function layoutFits(mode: LayoutMode, state: PreviewState, perTicket: number): boolean {
  if (mode === 'fixed') return state.tickets.length > 0;
  if (mode === 'sections') {
    const sections = filledSectionCount(state);
    return sections > 0 && sections === perTicket;
  }
  return true;
}

/**
 * «Как составлены билеты» while the student has not chosen it (Jury_Check item 10, answer 7):
 * the department's tickets when the list had «Билет № N» blocks; one question from each section
 * when the list has as many sections with questions as a ticket has questions (two or more: with a
 * single section it is the same as random tickets); otherwise random tickets.
 */
export function defaultLayoutMode(state: PreviewState, perTicket: number): LayoutMode {
  if (state.tickets.length > 0) return 'fixed';
  const sections = filledSectionCount(state);
  if (sections >= 2 && sections === perTicket) return 'sections';
  return 'random';
}

/**
 * The layout in force: the student's explicit choice (or the layout stored with an exam being
 * edited) while it still fits the list, otherwise the default for the list as it is now. It is
 * recomputed whenever the list or the number of questions per ticket changes, and a choice that
 * stops fitting comes back when it fits again.
 */
export function chosenLayout(choice: LayoutMode | null, state: PreviewState, perTicket: number): LayoutMode {
  if (choice && layoutFits(choice, state, perTicket)) return choice;
  return defaultLayoutMode(state, perTicket);
}

/** A plain problem with a row that blocks saving, or null. */
export function rowProblem(row: PreviewRow): string | null {
  if (row.kind === 'section') return row.text.trim() ? null : 'Пустой заголовок раздела.';
  const length = row.text.trim().length;
  if (length < QUESTION_MIN_CHARS) return 'Слишком короткий вопрос: допишите или удалите строку.';
  if (length > QUESTION_MAX_CHARS) return `Слишком длинный вопрос: до ${QUESTION_MAX_CHARS} знаков. Разбейте его.`;
  return null;
}

/** The first problem of the whole list, or null when it can be saved. */
export function listProblem(state: PreviewState): string | null {
  const count = questionCount(state);
  if (count === 0) return 'В списке нет ни одного вопроса.';
  if (count > MAX_QUESTIONS) return `Можно до ${MAX_QUESTIONS} вопросов. Разбейте список на два экзамена.`;
  if (sectionTitles(state).length > MAX_SECTIONS) return `Разделов может быть до ${MAX_SECTIONS}.`;
  return state.rows.some((row) => rowProblem(row) !== null) ? 'Исправьте строки, отмеченные в списке.' : null;
}

/** Inserts a typed question at row index `at` (a line the parser skipped, turned into a question). */
export function insertQuestion(state: PreviewState, at: number, text: string): PreviewState {
  const index = Math.min(Math.max(0, at), state.rows.length);
  const rows = [...state.rows];
  rows.splice(index, 0, { key: localKey('n'), id: null, kind: 'question', label: '', text: text.trim(), flags: [] });
  return { ...state, rows };
}

/** Row index of the `n`-th question (0-based), or the end of the list. */
export function rowIndexOfQuestion(state: PreviewState, n: number): number {
  let seen = 0;
  for (let i = 0; i < state.rows.length; i += 1) {
    if (state.rows[i].kind !== 'question') continue;
    if (seen === n) return i;
    seen += 1;
  }
  return state.rows.length;
}

export interface SkippedLine {
  key: string;
  text: string;
  /** How many recognised questions come before it in the source. */
  beforeQuestion: number;
}

const LEADING_NUMBER = /^\s*(вопрос\s*)?№?\s*\d{1,3}(\.\d{1,2})?[.)]?\s*/i;
// No \b: in JavaScript it is ASCII-only and never matches after a Cyrillic letter.
const TICKET_LINE = /^(экзаменационный\s+)?билет(?![а-яё])/i;

/**
 * Lines of the pasted text that the parser dropped (it reports only their count): each one is
 * shown at its place with «Это вопрос». Found by matching every source line against the
 * recognised questions in order; headings, ticket lines and table rows are not reported.
 */
export function skippedLines(result: ParseResult, limit = 8): SkippedLine[] {
  if (!result.warnings.some((warning) => warning.code === 'unparsed_lines')) return [];
  const questions = result.questions.map((question) => normalizeForMatch(question.text));
  const titles = result.sections.map((section) => normalizeForMatch(section.title)).filter(Boolean);
  const out: SkippedLine[] = [];
  let next = 0;
  for (const raw of result.source_text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const norm = normalizeForMatch(line.replace(LEADING_NUMBER, ''));
    if (!norm) continue;
    let found = -1;
    for (let j = Math.max(0, next - 1); j < questions.length; j += 1) {
      if (questions[j].includes(norm) || (questions[j] && norm.includes(questions[j]))) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      next = found + 1;
      continue;
    }
    if (titles.some((title) => title.includes(norm) || norm.includes(title))) continue;
    if (TICKET_LINE.test(line) || line.includes(' | ')) continue;
    out.push({ key: `skip-${out.length}-${next}`, text: line.slice(0, 200), beforeQuestion: next });
    if (out.length >= limit) break;
  }
  return out;
}

function stemsOf(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .split(' ')
      .filter((word) => word.length >= 4)
      .map(wordStem),
  );
}

/**
 * Lectures to tick in advance (tickets spec 3.3): those whose subject or title share a word stem
 * with the exam's title, plus every lecture with text whose subject is unknown — a text-only import
 * has subject '' (contracts §8) and a file name for a title, so nothing says it belongs to another
 * course. Every lecture with text when none matches by words.
 */
export function suggestedMaterialIds(
  materials: Array<{ id: string; title: string; subject: string; textLength: number }>,
  examTitle: string,
): string[] {
  const withText = materials.filter((material) => material.textLength > 0);
  const wanted = stemsOf(examTitle);
  if (wanted.size === 0) return withText.map((material) => material.id);
  const byWords = new Set(withText.filter((material) => sharesStem(material, wanted)).map((material) => material.id));
  if (byWords.size === 0) return withText.map((material) => material.id);
  return withText.filter((material) => byWords.has(material.id) || material.subject.trim() === '').map((material) => material.id);
}

function sharesStem(material: { title: string; subject: string }, wanted: Set<string>): boolean {
  const stems = stemsOf(`${material.subject} ${material.title}`);
  for (const stem of wanted) if (stems.has(stem)) return true;
  return false;
}

/**
 * Why suggestedMaterialIds ticked what it ticked: the exam has no title yet (all lectures), the title
 * matched some lectures, or it matched none (all lectures again).
 */
export function suggestionReason(
  materials: Array<{ title: string; subject: string; textLength: number }>,
  examTitle: string,
): 'no-title' | 'by-title' | 'no-match' {
  const wanted = stemsOf(examTitle);
  if (wanted.size === 0) return 'no-title';
  return materials.some((material) => material.textLength > 0 && sharesStem(material, wanted)) ? 'by-title' : 'no-match';
}

// «по дисциплине», «по учебной дисциплине», «по курсу», «по учебному предмету» — in any letter case.
const TITLE_HINT = /по\s+(?:учебн(?:ой|ому)\s+)?(?:курсу|дисциплине|предмету)\s*[«"„“]?([^»"“”\n]{3,80})/i;
/** How far into the header the subject is looked for: a header with «УТВЕРЖДАЮ» and signatures runs long. */
const TITLE_HEADER_LINES = 20;
const QUESTION_LINE = /^\s*(?:вопрос\s*)?№?\s*\d{1,3}(?:\.\d{1,2})?[.)]\s/i;

/** The subject named in the list's header («Вопросы к экзамену по курсу «Микроэкономика»»), or ''. */
export function suggestedTitle(result: Pick<ParseResult, 'source_text'>): string {
  // Blank lines do not count (a DOCX gives one between blocks); the header ends at the first numbered question.
  const header = result.source_text.split(/\r?\n/).filter((line) => line.trim() !== '');
  for (const line of header.slice(0, TITLE_HEADER_LINES)) {
    if (QUESTION_LINE.test(line)) break;
    const match = TITLE_HINT.exec(line);
    if (match) return match[1].trim().replace(/[.:;,»"“”]+$/, '').slice(0, 120);
  }
  return '';
}
