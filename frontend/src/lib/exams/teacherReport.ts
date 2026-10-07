/**
 * «Отчёт сверки для преподавателя» (/exams/:id/report): the exam's questions in the department's order,
 * each with what the mapping found in the student's lectures — the verdict in words, the lecture's own
 * fragment (lecture title and fragment number; the fragment's text as stored, never the model's words),
 * what a «частично» question lacks — and the answer points of the cheat sheet. The page prints it for a
 * teacher to mark by hand and sign, and offers the same table as a CSV file.
 *
 * Pure module: the page passes the exam bundle (api/exams loadExamBundle), the cheat sheet's questions
 * (api/cheatSheet fetchSheet) and whether a mapping run holds the exam now. Nothing here reads the
 * network or storage.
 */
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { ExamBundle, ExamQuestion, NearestItem } from '../../api/exams';
import { blockKind, cleanMissing, POINTS_NOT_WRITTEN, type SheetQuestion } from './cheatSheet';
import { fragmentNumber, KIND_LABELS, subjectOf } from './format';
import { fragmentView, type Span } from '../../utils/fragmentText';
import { pluralRu } from '../../components/conversation/visuals';
import { genitiveOf, numberOf } from '../../components/exams/sheetModel';

/**
 * What the mapping says about a question, as the report tells it:
 * - full, partial, none — checked against the lectures;
 * - words — the model did not answer, matched by words only («проверено только по словам»);
 * - manual — the student marked it «есть в лекции» by hand, Meldy did not check it;
 * - unmapped — not checked yet (the run did not get to it, or the question is new).
 * The last three are «не проверено ИИ» in the counts.
 */
export type ReportVerdict = 'full' | 'partial' | 'none' | 'words' | 'manual' | 'unmapped';

export const VERDICT_TITLES: Record<ReportVerdict, string> = {
  full: 'Есть в лекциях',
  partial: 'Есть частично',
  none: 'Нет в лекциях',
  words: 'Проверено только по словам',
  manual: 'Отмечено студентом',
  unmapped: 'Не сверено',
};

/** The CSV column «есть в лекциях»: short words a spreadsheet filter can group by. */
export const VERDICT_CELLS: Record<ReportVerdict, string> = {
  full: 'есть',
  partial: 'частично',
  none: 'нет',
  words: 'не проверено: только по словам',
  manual: 'не проверено: отмечено студентом',
  unmapped: 'не проверено: не сверено',
};

export const CSV_COLUMNS = [
  '№',
  'вопрос',
  'есть в лекциях',
  'лекция',
  'фрагмент',
  'цитата',
  'чего не хватает',
  'пункты',
  'пометка преподавателя',
  'комментарий',
] as const;

/** The line of the honest note at the end of the report, word for word (Ф1: no grades, no «засчитано»). */
export const GRADE_LINE = 'Отметку ставит преподаватель; Meldy проверяет только, назвали ли пункты из своих лекций';

/** Fixed reasons of the mapping (backend exams_map.py); the client compares them word for word, as WhyPanel does. */
const REASON_NO_OVERLAP = 'Ни одного фрагмента с этими словами';
const REASON_NO_SUPPORT = 'Нет подтверждающего фрагмента';

export interface ReportEvidence {
  materialId: string;
  /** The lecture's title as the app shows it; '' when it has none. */
  lecture: string;
  /** «фрагмент 14»; null when the fragment has no number. */
  fragment: number | null;
  /** The lecture was taken out of the exam after the mapping. */
  removed: boolean;
  /** The lecture's own heading line of the fragment, if it starts with one (utils/fragmentText). */
  heading: string | null;
  /** The fragment's text, its lines joined as the app joins them; a table row reads «ячейка — ячейка; …». */
  body: string;
  /**
   * Where the quote the mapping verified is (evidence focus), in heading and in body: the report prints the
   * whole fragment and underlines this place. Null when it is not there (rows mapped before it was stored).
   */
  headingFocus: Span | null;
  bodyFocus: Span | null;
}

export interface ReportPoint {
  text: string;
  /** A main point («главный»). */
  main: boolean;
}

/**
 * The answer points of a question (the cheat sheet's rubric):
 * written — the points; none — no points for these lectures: a «нет» question, or points Meldy could not
 * confirm with quotes from the lectures (POINTS_NOT_WRITTEN); unwritten — not written yet; loading — the cheat
 * sheet is still being read; unknown — it did not load.
 */
export type ReportPoints =
  | { kind: 'written'; points: ReportPoint[] }
  | { kind: 'none' }
  | { kind: 'unwritten' }
  | { kind: 'loading' }
  | { kind: 'unknown' };

export interface ReportItem {
  id: string;
  /** The department's number, else the position («12», «5а»). */
  number: string;
  /** The section's heading, on the first question of each section only. */
  sectionTitle: string | null;
  text: string;
  verdict: ReportVerdict;
  /**
   * Where the quote would stand when there is none: why (none, words, manual, unmapped). Empty for a
   * question with quotes.
   */
  note: string;
  /** «частично»: what the lectures lack, as it goes after «Не хватает:» ('' otherwise). */
  missing: string;
  evidence: ReportEvidence[];
  /** none, words: the closest fragment the search found (not evidence; WhyPanel's «Ближе всего»). */
  nearest: NearestItem | null;
  points: ReportPoints;
}

export interface ReportLecture {
  id: string;
  title: string;
  /** Questions whose quotes come from this lecture. */
  cited: number;
  /** Added to the exam after the mapping: it was not part of it. */
  addedAfter: boolean;
  /** Quoted by the mapping, but taken out of the exam since (its title comes from the quote). */
  removed: boolean;
}

export interface ReportCounts {
  total: number;
  full: number;
  partial: number;
  none: number;
  /** Not checked by the model: words + manual + unmapped. */
  unchecked: number;
  words: number;
  manual: number;
  unmapped: number;
}

/** What the page shows: the report, or an empty state that says what to do first. */
export type ReportState = 'ready' | 'unmapped' | 'no-lectures' | 'no-questions';

/** The mapping at the moment the report was made. */
export type ReportMapping = 'done' | 'running' | 'interrupted' | 'none';

export interface TeacherReport {
  state: ReportState;
  mapping: ReportMapping;
  examId: string;
  /** The subject («Макроэкономика»), as the exam page heads it. */
  title: string;
  /** «Экзамен», «Зачёт», «Коллоквиум». */
  kind: string;
  /** «24 января 2027»; '' without a date. */
  examDay: string;
  /** The date of the mapping, with the year: «7 октября 2026, 14:02»; '' before any mapping. */
  mappedAt: string;
  /** When this report was made: «7 октября 2026, 15:20». */
  madeAt: string;
  /** 'yyyy-MM-dd' of madeAt, for the file name. */
  madeOn: string;
  lectures: ReportLecture[];
  counts: ReportCounts;
  /** Sentences about what the report lacks (an interrupted mapping, lectures changed, points missing); printed. */
  notes: string[];
  items: ReportItem[];
}

/** The cheat sheet as the page read it: its questions, a read still going on, or a failed read. */
export type ReportSheet =
  | { status: 'ready'; questions: readonly SheetQuestion[]; writing?: boolean }
  | { status: 'loading' }
  | { status: 'error' };

export interface ReportInput {
  bundle: ExamBundle;
  sheet: ReportSheet;
  /** A mapping run holds the exam now (this tab's run, or a fresh lock of another one). */
  running?: boolean;
  now?: Date;
}

// ------------------------------------------------------------------------------------- words

function questionsWord(count: number): string {
  return pluralRu(count, ['вопрос', 'вопроса', 'вопросов']);
}

/** After «из»: «из 1 вопроса», «из 40 вопросов». */
function ofQuestions(count: number): string {
  return genitiveOf(count, 'вопроса', 'вопросов');
}

function lecturesWord(count: number): string {
  return pluralRu(count, ['лекция', 'лекции', 'лекций']);
}

/** «Ни в одной из 5 лекций», «В лекции», «Ни в одной лекции». */
function noLecturePrefix(lectureCount: number): string {
  if (lectureCount === 1) return 'В лекции';
  if (lectureCount > 1) {
    const genitive = lectureCount % 10 === 1 && lectureCount % 100 !== 11 ? 'лекции' : 'лекций';
    return `Ни в одной из ${lectureCount} ${genitive}`;
  }
  return 'Ни в одной лекции';
}

/** A full date with the year (a signed document outlives the year): «7 октября 2026, 14:02». */
export function reportMoment(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMMM yyyy, H:mm', { locale: ru });
}

/** «24 января 2027» for a 'yyyy-MM-dd' day. */
export function reportDay(key: string | null | undefined): string {
  const match = typeof key === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMMM yyyy', { locale: ru });
}

export function verdictOf(question: Pick<ExamQuestion, 'coverage' | 'coverage_method'>): ReportVerdict {
  if (question.coverage === 'full' && question.coverage_method === 'manual') return 'manual';
  switch (question.coverage) {
    case 'full':
      return 'full';
    case 'partial':
      return 'partial';
    case 'none':
      return 'none';
    case 'unverified':
      return 'words';
    default:
      return 'unmapped';
  }
}

/** The sentence that stands where a question without quotes would have them. */
function noteOf(question: ExamQuestion, verdict: ReportVerdict, lectureCount: number, mapping: ReportMapping): string {
  switch (verdict) {
    case 'none':
      if (question.coverage_reason === REASON_NO_SUPPORT) return 'Похожие места есть, но нет фрагмента, который подтверждает ответ.';
      if (question.coverage_reason === REASON_NO_OVERLAP) return `${noLecturePrefix(lectureCount)} нет фрагмента с этими словами.`;
      return `${noLecturePrefix(lectureCount)} нет фрагмента об этом.`;
    case 'words':
      return 'ИИ не проверил этот вопрос: он сопоставлен с лекциями только по совпадению слов.';
    case 'manual':
      return 'Студент сам отметил, что ответ есть в лекциях. Meldy это не проверял.';
    case 'unmapped':
      if (mapping === 'running') return 'Сверка до этого вопроса ещё не дошла.';
      if (mapping === 'interrupted') return 'Сверка прервалась раньше, чем дошла до этого вопроса.';
      return 'Вопрос ещё не сверен с лекциями.';
    default:
      return '';
  }
}

function pointsOf(question: SheetQuestion | undefined, sheet: ReportSheet): ReportPoints {
  if (sheet.status === 'loading') return { kind: 'loading' };
  if (sheet.status !== 'ready' || !question) return { kind: 'unknown' };
  const kind = blockKind(question);
  if (kind === 'lines' && question.rubric) {
    return { kind: 'written', points: question.rubric.points.map((point) => ({ text: point.title.trim(), main: point.essential })) };
  }
  if (kind === 'gap') return { kind: 'none' };
  return { kind: 'unwritten' };
}

// ------------------------------------------------------------------------------------- the report

export function buildTeacherReport(input: ReportInput): TeacherReport {
  const { bundle, sheet } = input;
  const now = input.now ?? new Date();
  const { exam } = bundle;
  const questions = bundle.questions;
  const current = new Set(bundle.materialIds);
  const lectureCount = bundle.materials.length;

  const mappedCount = questions.filter((question) => question.coverage !== null).length;
  const unmappedCount = questions.length - mappedCount;
  let mapping: ReportMapping;
  if (input.running) mapping = 'running';
  // A failed run, or a lock nobody holds any more (the page passes running for a fresh one).
  else if (exam.mapping_state === 'failed' || exam.mapping_state === 'running') mapping = unmappedCount > 0 ? 'interrupted' : 'done';
  else mapping = mappedCount > 0 ? 'done' : 'none';

  let state: ReportState = 'ready';
  if (questions.length === 0) state = 'no-questions';
  else if (lectureCount === 0) state = 'no-lectures';
  else if (mappedCount === 0) state = 'unmapped';

  const sheetById = new Map<string, SheetQuestion>();
  if (sheet.status === 'ready') for (const question of sheet.questions) sheetById.set(question.question_id, question);

  const sectionTitles = exam.ticket_layout.section_titles ?? [];
  let previousSection: number | null = null;
  const counts: ReportCounts = { total: questions.length, full: 0, partial: 0, none: 0, unchecked: 0, words: 0, manual: 0, unmapped: 0 };
  const cited = new Map<string, Set<string>>();
  const removedTitles = new Map<string, string>();

  const items: ReportItem[] = questions.map((question) => {
    const verdict = verdictOf(question);
    counts[verdict] += 1;
    if (verdict === 'words' || verdict === 'manual' || verdict === 'unmapped') counts.unchecked += 1;

    const section = question.section;
    const sectionTitle =
      section !== null && section !== previousSection ? sectionTitles[section - 1]?.trim() || `Раздел ${section}` : null;
    if (section !== null) previousSection = section;

    const evidence: ReportEvidence[] =
      verdict === 'full' || verdict === 'partial'
        ? question.evidence.map((item) => {
            const parts = fragmentView(item.excerpt, item.focus);
            const removed = item.material_id !== '' && !current.has(item.material_id);
            if (item.material_id) {
              const quoting = cited.get(item.material_id) ?? new Set<string>();
              quoting.add(question.id);
              cited.set(item.material_id, quoting);
              if (removed && !removedTitles.has(item.material_id)) removedTitles.set(item.material_id, item.material_title);
            }
            return {
              materialId: item.material_id,
              lecture: item.material_title.trim(),
              fragment: fragmentNumber(item.source_id),
              removed,
              heading: parts.heading,
              body: parts.body,
              headingFocus: parts.headingFocus,
              bodyFocus: parts.bodyFocus,
            };
          })
        : [];

    return {
      id: question.id,
      number: numberOf(question),
      sectionTitle,
      text: question.text.trim(),
      verdict,
      note: evidence.length > 0 ? '' : verdict === 'full' || verdict === 'partial' ? 'Цитата не сохранилась.' : noteOf(question, verdict, lectureCount, mapping),
      missing: verdict === 'partial' ? cleanMissing(question.missing_note) : '',
      evidence,
      nearest: verdict === 'none' || verdict === 'words' ? question.nearest[0] ?? null : null,
      points: pointsOf(sheetById.get(question.id), sheet),
    };
  });

  // The lectures: the exam's own (a natural order of titles: «Лекция 2» before «Лекция 10»), then the ones
  // quoted by the mapping and taken out of the exam since.
  const mappedIds = new Set(exam.mapped_material_ids);
  const knowsMapped = Boolean(exam.mapped_at) && mappedIds.size > 0;
  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'ru', { numeric: true, sensitivity: 'base' });
  const lectures: ReportLecture[] = [
    ...bundle.materials
      .map((material) => ({
        id: material.id,
        title: material.title,
        cited: cited.get(material.id)?.size ?? 0,
        addedAfter: knowsMapped && !mappedIds.has(material.id),
        removed: false,
      }))
      .sort(byTitle),
    ...[...removedTitles.entries()]
      .map(([id, title]) => ({ id, title, cited: cited.get(id)?.size ?? 0, addedAfter: false, removed: true }))
      .sort(byTitle),
  ];

  const notes: string[] = [];
  if (state === 'ready') {
    if (mapping === 'running') {
      notes.push(`Сверка ещё шла, когда составлен отчёт: проверено ${mappedCount} из ${questions.length} ${ofQuestions(questions.length)}.`);
    } else if (mapping === 'interrupted') {
      notes.push(`Сверка прервалась: проверено ${mappedCount} из ${questions.length} ${ofQuestions(questions.length)}. Остальные отмечены «не сверено».`);
    } else if (unmappedCount > 0) {
      const verb = unmappedCount % 10 === 1 && unmappedCount % 100 !== 11 ? 'не сверен' : 'не сверены';
      const marked = unmappedCount === 1 ? 'он отмечен' : 'они отмечены';
      notes.push(`${unmappedCount} ${questionsWord(unmappedCount)} ещё ${verb} с лекциями: в отчёте ${marked} «не сверено».`);
    }
    const added = lectures.filter((lecture) => lecture.addedAfter).length;
    const removedCount = knowsMapped ? exam.mapped_material_ids.filter((id) => !current.has(id)).length : 0;
    if (added > 0 || removedCount > 0) {
      // «добавлена 1 лекция», «добавлено 2 лекции»: the verb agrees with the number.
      const one = (count: number) => count % 10 === 1 && count % 100 !== 11;
      const parts: string[] = [];
      if (added > 0) parts.push(`${one(added) ? 'добавлена' : 'добавлено'} ${added} ${lecturesWord(added)}`);
      if (removedCount > 0) parts.push(`${one(removedCount) ? 'убрана' : 'убрано'} ${removedCount} ${lecturesWord(removedCount)}`);
      notes.push(`После сверки ${parts.join(', ')}: отчёт показывает сверку с прежним набором лекций.`);
    }
    if (sheet.status === 'error') notes.push('Пункты ответов не загрузились, поэтому в отчёте их нет.');
    else if (sheet.status === 'ready' && sheet.writing) notes.push('Пункты ответов ещё пишутся: у части вопросов их пока нет.');
  }

  const mappedAtIso =
    exam.mapped_at ??
    questions.reduce<string | null>((oldest, question) => {
      if (!question.mapped_at || question.coverage === null) return oldest;
      return oldest === null || Date.parse(question.mapped_at) < Date.parse(oldest) ? question.mapped_at : oldest;
    }, null);

  return {
    state,
    mapping,
    examId: exam.id,
    title: subjectOf(exam.title) || 'Экзамен',
    kind: KIND_LABELS[exam.kind],
    examDay: reportDay(exam.exam_date),
    mappedAt: reportMoment(mappedAtIso),
    madeAt: format(now, 'd MMMM yyyy, H:mm', { locale: ru }),
    madeOn: format(now, 'yyyy-MM-dd'),
    lectures,
    counts,
    notes,
    items,
  };
}

/** «Не проверено ИИ: 2 — только по словам, 1 — отмечен студентом.» Null when every question was checked. */
export function uncheckedLine(counts: ReportCounts): string | null {
  if (counts.unchecked === 0) return null;
  const parts: string[] = [];
  if (counts.words > 0) parts.push(`${counts.words} — только по словам`);
  if (counts.manual > 0) parts.push(`${counts.manual} — ${counts.manual === 1 ? 'отмечен' : 'отмечены'} студентом`);
  if (counts.unmapped > 0) parts.push(`${counts.unmapped} — ещё не ${counts.unmapped === 1 ? 'сверен' : 'сверены'}`);
  return `Не проверено ИИ: ${parts.join(', ')}.`;
}

/**
 * «Лекция «Денежный рынок», фрагмент 14», as «почему» of the exam page captions a fragment; a title that
 * says «Лекция» itself is not prefixed twice: «Лекция 3. Инфляция», фрагмент 4.
 */
export function evidenceCaption(item: Pick<ReportEvidence, 'lecture' | 'fragment' | 'removed'>): string {
  const title = item.lecture || 'без названия';
  const lecture = /^лекция(?!\p{L})/iu.test(title) ? `«${title}»` : `Лекция «${title}»`;
  const where = `${lecture}, ${item.fragment === null ? 'фрагмент' : `фрагмент ${item.fragment}`}`;
  return item.removed ? `${where} — лекция убрана из экзамена` : where;
}

/** The plain sentence for points that are not there. */
export function pointsNote(points: ReportPoints): string {
  switch (points.kind) {
    case 'none':
      // Shown only for a question the lectures have (a «нет» one prints no points at all): never «нет в лекциях».
      return `${POINTS_NOT_WRITTEN}.`;
    case 'unwritten':
      return 'Пункты ещё не написаны.';
    case 'loading':
      return 'Пункты загружаются…';
    case 'unknown':
      return 'Пункты не загрузились.';
    default:
      return '';
  }
}

// ------------------------------------------------------------------------------------- CSV

/**
 * One CSV cell. Excel in Russian splits columns by «;», so a cell with «;», «,», a quote, a line break
 * or edge spaces goes in quotes, its quotes doubled. A cell that starts like a formula («=», «+», «-»,
 * «@», a tab) gets a leading apostrophe, so a spreadsheet shows the text instead of computing it.
 */
export function csvCell(value: string): string {
  let text = value.replace(/\r\n?/g, '\n');
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[";,\n\t]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function lectureCells(evidence: ReportEvidence[]): { lecture: string; fragment: string; quote: string } {
  if (evidence.length === 0) return { lecture: '', fragment: '', quote: '' };
  // The lectures in the order they are quoted, each with its fragment numbers.
  const groups = new Map<string, { title: string; numbers: string[] }>();
  for (const item of evidence) {
    const title = item.lecture || 'без названия';
    const key = item.materialId || `title:${title}`;
    const group = groups.get(key) ?? { title, numbers: [] };
    groups.set(key, group);
    if (item.fragment !== null && !group.numbers.includes(String(item.fragment))) group.numbers.push(String(item.fragment));
  }
  const text = (item: ReportEvidence) => (item.heading ? `${item.heading}\n${item.body}` : item.body);
  const lectures = [...groups.values()];
  return {
    lecture: lectures.map((group) => group.title).join('; '),
    // One lecture: «12, 14»; several: their numbers in the same order, «12, 14; 4».
    fragment: lectures.map((group) => group.numbers.join(', ')).join('; '),
    quote:
      evidence.length === 1
        ? text(evidence[0])
        : evidence.map((item) => `[${evidenceCaption(item)}]\n${text(item)}`).join('\n\n'),
  };
}

function pointsCell(item: ReportItem): string {
  if (item.verdict === 'none') return item.points.kind === 'written' ? pointsList(item.points.points) : 'нет: ответа в лекциях не нашлось';
  if (item.points.kind === 'written') return pointsList(item.points.points);
  if (item.points.kind === 'none') return POINTS_NOT_WRITTEN.replace(/^Пункты /, '');
  if (item.points.kind === 'unknown') return 'не загрузились';
  if (item.points.kind === 'loading') return 'загружаются';
  return 'ещё не написаны';
}

function pointsList(points: ReportPoint[]): string {
  return points.map((point, index) => `${index + 1}. ${point.text}${point.main ? ' (главный)' : ''}`).join('\n');
}

/** The rows of the CSV, header first; the teacher's two columns are left empty. */
export function reportRows(report: Pick<TeacherReport, 'items'>): string[][] {
  return [
    [...CSV_COLUMNS],
    ...report.items.map((item) => {
      const cells = lectureCells(item.evidence);
      return [item.number, item.text, VERDICT_CELLS[item.verdict], cells.lecture, cells.fragment, cells.quote, item.missing, pointsCell(item), '', ''];
    }),
  ];
}

/** The CSV file: UTF-8 with a byte order mark (Excel then reads Cyrillic), «;» between cells, CRLF between rows. */
export function reportCsv(report: Pick<TeacherReport, 'items'>): string {
  return `\uFEFF${reportRows(report)
    .map((row) => row.map(csvCell).join(';'))
    .join('\r\n')}\r\n`;
}

/** «Отчёт сверки - Макроэкономика - 2026-10-07»: no characters a file system refuses. */
export function reportFileBase(report: Pick<TeacherReport, 'title' | 'madeOn'>): string {
  // eslint-disable-next-line no-control-regex
  const subject = report.title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return [`Отчёт сверки`, subject, report.madeOn].filter(Boolean).join(' - ');
}

/** The page's title while the report is open: Chrome names the saved PDF after it. */
export function reportDocumentTitle(report: Pick<TeacherReport, 'title'>): string {
  return `Отчёт сверки — ${report.title}`;
}
