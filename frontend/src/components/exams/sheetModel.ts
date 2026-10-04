/**
 * What the exam sheet shows for each question and the sentences of Meldy's column (contracts §8,
 * tickets spec 3.4, redesign spec 5.9). Pure: the page passes rows, journal states and the live
 * mapping run; nothing here reads the network or storage.
 */
import type { ExamQuestion, TicketLayout } from '../../api/exams';
import { emptyQuestionState, READINESS_LABELS, type QuestionState, type Readiness, type SelfRating } from '../../lib/learning/readiness';
import {
  layoutShares,
  layoutSharesIf,
  percent,
  type LayoutShares,
  type ShareInput,
  type ShareQuestion,
  type ShareResult,
} from '../../lib/exams/ticketMath';
import { daysUntil, formatDay, fragmentNumber, questionNumber } from '../../lib/exams/format';
import { pluralRu } from '../conversation/visuals';
import { ty } from '../landing/typo';
import type { SheetCoverage } from './marks';

export const NBSP = ' ';

/**
 * Russian typesetting of a dynamic line: a one- or two-letter word and a number stay with the next
 * word («9 лекций», «3 октября»), « · » and «%» never start a line (no lookbehind: Safari).
 */
export function glue(text: string): string {
  return ty(text)
    .replace(/(\d) (?=[а-яёА-ЯЁa-zA-Z%])/g, `$1${NBSP}`)
    .replace(/ ·/g, `${NBSP}·`);
}

/** «, с 7 окт.» without a doubled period at the end of a sentence. */
export function endSentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/** «35 %» with a no-break space, as the Russian typesetting of the spec asks. */
export function pct(value: number): string {
  return `${value}${NBSP}%`;
}

export function sheetCoverage(question: Pick<ExamQuestion, 'coverage'>, checking: boolean): SheetCoverage {
  if (checking) return 'checking';
  return question.coverage ?? 'unmapped';
}

export function isManual(question: Pick<ExamQuestion, 'coverage_method'>): boolean {
  return question.coverage_method === 'manual';
}

/** «фрагмент 14», «фрагменты 1, 4, 5» for the evidence of one lecture. */
export function fragmentsPhrase(sourceIds: string[]): string {
  const numbers = Array.from(new Set(sourceIds.map(fragmentNumber).filter((n): n is number => n !== null))).sort((a, b) => a - b);
  if (numbers.length === 0) return '';
  return numbers.length === 1 ? `фрагмент ${numbers[0]}` : `фрагменты ${numbers.join(', ')}`;
}

export interface Footnote {
  /** Full lecture title (the sheet clamps it to two lines; the why panel shows it whole). */
  title: string;
  /** «фрагмент 14» or «фрагменты 1, 4, 5»; '' for a mark made by hand. */
  fragments: string;
  manual: boolean;
  /** The lecture the note cites ('' for a mark made by hand): «там же» compares it with the row above. */
  materialId: string;
}

/** The right-margin note of a row: the lecture and its fragments, «отмечено вами», or nothing. */
export function footnoteOf(question: Pick<ExamQuestion, 'coverage' | 'coverage_method' | 'evidence'>): Footnote | null {
  if (question.coverage_method === 'manual') return { title: 'отмечено вами', fragments: '', manual: true, materialId: '' };
  if ((question.coverage !== 'full' && question.coverage !== 'partial') || question.evidence.length === 0) return null;
  const first = question.evidence[0];
  const sameLecture = question.evidence.filter((item) => item.material_id === first.material_id);
  return {
    title: first.material_title.trim() || 'Лекция',
    fragments: fragmentsPhrase(sameLecture.map((item) => item.source_id)),
    manual: false,
    materialId: first.material_id,
  };
}

/** How a margin note reads on the sheet: the lecture on its first mention, «там же» after it. */
export interface NoteView {
  /** «Нейронные сети и глубокое обучение» or «там же»; «отмечено вами» for a hand mark. */
  lead: string;
  /** «фрагмент 4» (after a comma), '' when there is none. */
  fragments: string;
  /** The lecture is named here (not «там же»). */
  named: boolean;
}

/** A long title is cut at a word so that «, фрагмент 12» still fits in the two lines of the margin. */
const NOTE_CHARS = 54;

/**
 * Margin notes of the visible rows, in order (redesign critique 3): the lecture is named on the first
 * row of a section and whenever it differs from the note right above; otherwise the note is one line,
 * «там же, фрагмент 4». «Там же» means the line above, so a row without a note (a dash, a question
 * not mapped yet) and a hand mark interrupt the run: the next note names its lecture again (redesign
 * critique 7 of round 2). Rows come already filtered, so after a filter change the first note names its
 * lecture too.
 */
export function marginNotes(rows: Array<{ section: number | null; footnote: Footnote | null }>): Array<NoteView | null> {
  let lastMaterial: string | null = null;
  let lastSection: number | null | undefined;
  return rows.map((row) => {
    if (row.section !== null && row.section !== lastSection) lastMaterial = null;
    if (row.section !== null) lastSection = row.section;
    const note = row.footnote;
    if (!note) {
      lastMaterial = null;
      return null;
    }
    if (note.manual) {
      lastMaterial = null;
      return { lead: note.title, fragments: '', named: false };
    }
    if (lastMaterial !== null && note.materialId && note.materialId === lastMaterial) {
      return { lead: 'там же', fragments: note.fragments, named: false };
    }
    lastMaterial = note.materialId || null;
    const room = Math.max(16, NOTE_CHARS - (note.fragments ? note.fragments.length + 2 : 0));
    return { lead: shortenTitle(note.title, room), fragments: note.fragments, named: true };
  });
}

function shortenTitle(title: string, max: number): string {
  const clean = title.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

// ---------------------------------------------------------------------------------------------
// Filters: the legend above the sheet (coverage), the readiness legend and the self-rating counts

export type SheetFilter =
  | 'all'
  | 'cov:full'
  | 'cov:partial'
  | 'cov:none'
  | 'cov:unverified'
  | 'cov:unmapped'
  | 'rd:confirmed'
  | 'rd:once'
  | 'rd:not_passed'
  | 'rd:untested'
  | 'sr:know'
  | 'sr:unsure'
  | 'sr:dont_know'
  | 'sr:none';

export interface FilterSubject {
  coverage: SheetCoverage;
  readiness: Readiness;
  selfRating: SelfRating | null;
}

export function matchesFilter(filter: SheetFilter, item: FilterSubject): boolean {
  if (filter === 'all') return true;
  const [group, value] = filter.split(':');
  if (group === 'cov') {
    if (value === 'unmapped') return item.coverage === 'unmapped' || item.coverage === 'checking';
    return item.coverage === value;
  }
  if (group === 'rd') return item.readiness === value;
  if (value === 'none') return item.selfRating === null;
  return item.selfRating === value;
}

export const FILTER_NAMES: Record<SheetFilter, string> = {
  all: 'все вопросы',
  'cov:full': 'есть в лекциях',
  'cov:partial': 'есть частично',
  'cov:none': 'нет ни в одной лекции',
  'cov:unverified': 'найдено только по словам',
  'cov:unmapped': 'ещё не сверено',
  'rd:confirmed': 'подтверждено',
  'rd:once': 'засчитано, не подтверждено',
  'rd:not_passed': 'не засчитано',
  'rd:untested': 'не проверялось',
  'sr:know': '«знаю»',
  'sr:unsure': '«плаваю»',
  'sr:dont_know': '«не знаю»',
  'sr:none': 'без самооценки',
};

/** Every value a sheet filter can take: `/exams/:id?filter=cov:none` is checked against this list. */
export const SHEET_FILTERS = Object.keys(FILTER_NAMES) as SheetFilter[];

/** A filter from the address (`?filter=…`); anything that is not a known filter shows every question. */
export function sheetFilterOf(value: string | null | undefined): SheetFilter {
  return typeof value === 'string' && (SHEET_FILTERS as string[]).includes(value) ? (value as SheetFilter) : 'all';
}

export interface CoverageCounts {
  total: number;
  full: number;
  partial: number;
  none: number;
  unverified: number;
  unmapped: number;
  checking: number;
}

export function coverageCounts(items: Array<{ coverage: SheetCoverage }>): CoverageCounts {
  const counts: CoverageCounts = { total: items.length, full: 0, partial: 0, none: 0, unverified: 0, unmapped: 0, checking: 0 };
  for (const item of items) counts[item.coverage] += 1;
  return counts;
}

export interface RatingCounts {
  know: number;
  unsure: number;
  dont_know: number;
  none: number;
}

export function ratingCounts(items: Array<{ selfRating: SelfRating | null }>): RatingCounts {
  const counts: RatingCounts = { know: 0, unsure: 0, dont_know: 0, none: 0 };
  for (const item of items) {
    if (item.selfRating) counts[item.selfRating] += 1;
    else counts.none += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Ticket shares

export interface ShareSubject {
  id: string;
  section: number | null;
  coverage: SheetCoverage;
}

function ticketsOf(layout: TicketLayout) {
  return (layout.tickets ?? []).map((ticket) => ({ number: ticket.number, questionIds: ticket.question_ids }));
}

/** A question whose coverage is not known yet: it widens a range instead of counting as absent. */
function unknownCoverage(coverage: SheetCoverage): boolean {
  return coverage === 'unverified' || coverage === 'unmapped' || coverage === 'checking';
}

function coverageInput(questions: ShareSubject[], layout: TicketLayout): ShareInput {
  const shareQuestions: ShareQuestion[] = questions.map((question) => ({
    id: question.id,
    section: question.section,
    status: question.coverage === 'full' ? 'yes' : unknownCoverage(question.coverage) ? 'maybe' : 'no',
  }));
  return { mode: layout.mode, perTicket: layout.per_ticket, questions: shareQuestions, tickets: ticketsOf(layout) };
}

/**
 * Shares by coverage: full (also marked by hand) qualifies. A question checked only by words, not
 * mapped yet or being checked right now is unknown, so it widens the range instead of counting as
 * absent. «Частично» counts as «нет».
 */
export function coverageShares(questions: ShareSubject[], layout: TicketLayout): LayoutShares {
  return layoutShares(coverageInput(questions, layout));
}

/**
 * The same shares if every «частично» question were closed (counted as «есть»): the number of the
 * action line «Закройте 7 вопросов «частично» — оба вопроса будут в лекциях в 60 % билетов».
 */
export function closedPartialShares(questions: ShareSubject[], layout: TicketLayout): LayoutShares {
  const partial = questions.filter((question) => question.coverage === 'partial').map((question) => question.id);
  return layoutSharesIf(coverageInput(questions, layout), partial);
}

/** Shares by answers: only confirmed questions qualify. */
export function confirmedShares(
  questions: Array<{ id: string; section: number | null; readiness: Readiness }>,
  layout: TicketLayout,
): LayoutShares {
  return layoutShares({
    mode: layout.mode,
    perTicket: layout.per_ticket,
    questions: questions.map((question) => ({
      id: question.id,
      section: question.section,
      status: question.readiness === 'confirmed' ? 'yes' : 'no',
    })),
    tickets: ticketsOf(layout),
  });
}

/** Questions per ticket of a share (fixed tickets may differ in size: the stored per_ticket then). */
export function perTicketOf(result: ShareResult, fallback: number): number {
  if (result.ok && (result.mode === 'random' || result.mode === 'sections')) return result.q;
  return fallback;
}

/** «вопрос» / «оба вопроса» / «все три вопроса» / «все четыре вопроса». */
export function allQuestionsWord(perTicket: number): string {
  if (perTicket <= 1) return 'вопрос';
  if (perTicket === 2) return 'оба вопроса';
  if (perTicket === 3) return 'все три вопроса';
  return 'все четыре вопроса';
}

const PER_TICKET_WORDS: Record<number, string> = { 1: 'один', 2: 'два', 3: 'три', 4: 'четыре' };

/** «40 вопросов, в билете два» / «… по вопросу из каждого раздела» / «… 20 билетов кафедры». */
export function layoutPhrase(total: number, layout: TicketLayout): string {
  const head = `${total} ${pluralRu(total, ['вопрос', 'вопроса', 'вопросов'])}`;
  if (layout.mode === 'fixed' && (layout.tickets?.length ?? 0) > 0) {
    const count = layout.tickets!.length;
    return `${head}, ${count} ${pluralRu(count, ['билет', 'билета', 'билетов'])} по списку кафедры`;
  }
  if (layout.mode === 'sections') return `${head}, в билете по вопросу из каждого раздела`;
  return `${head}, в билете ${PER_TICKET_WORDS[layout.per_ticket] ?? layout.per_ticket}`;
}

/** The share as shown: «35 %», or «35–41 %» when some questions were checked only by words. */
export function shareText(shares: LayoutShares, which: 'all' | 'atLeastOne'): string | null {
  if (!shares.low.ok) return null;
  const low = percent(shares.low[which]);
  if (shares.isRange && shares.high.ok) {
    const high = percent(shares.high[which]);
    if (high !== low) return `${low}–${high}${NBSP}%`;
  }
  return pct(low);
}

/** Genitive after «из» and «нет»: «из 21 вопроса», «9 вопросов нет». */
export function genitiveOf(count: number, one: string, many: string): string {
  return count % 10 === 1 && count % 100 !== 11 ? one : many;
}

/**
 * The share of questions as shown (Jury_Check item 12): «60 %», or «43–68 %» while some questions
 * were checked only by words or are not checked yet — the same unknowns that widen the ticket range.
 */
export function questionShareText(counts: CoverageCounts): string {
  if (counts.total <= 0) return pct(0);
  const low = Math.round((counts.full / counts.total) * 100);
  const high = Math.round(((counts.full + counts.unverified + counts.unmapped + counts.checking) / counts.total) * 100);
  return high !== low ? `${low}–${high}${NBSP}%` : pct(low);
}

/** «вопросов нет ни в одной лекции» beside the figure «9» (one: «вопроса»). */
export function noneLabel(count: number): string {
  return `${genitiveOf(count, 'вопроса', 'вопросов')} нет ни в одной лекции`;
}

/** The accessible name of the figure that filters the sheet: «9 вопросов нет ни в одной лекции. Показать их». */
export function noneFigureName(count: number): string {
  return `${count} ${noneLabel(count)}. Показать ${count === 1 ? 'его' : 'их'}`;
}

/**
 * Line (c) of peak 1, in place of «хотя бы один — 85 %»: «в 15 % билетов нет ни одного вопроса с
 * отметкой «есть»» (known tickets: «в 3 из 20 билетов …»; a range while some questions are unknown).
 * «Частично» counts as «нет» here, so the line never says «ни одного вопроса из ваших лекций». Null
 * for one question per ticket (the question share says it) and when there is no ticket share.
 */
export function noneTicketsLine(shares: LayoutShares): string | null {
  const { low, high } = shares;
  if (!low.ok) return null;
  const tail = `нет ни одного вопроса с отметкой «есть»`;
  if (low.mode === 'fixed') {
    // The low bound counts unknown questions as absent: it has the most tickets without «есть».
    const most = low.tickets - low.anyCount;
    const least = high.ok && high.mode === 'fixed' ? high.tickets - high.anyCount : most;
    const count = least !== most ? `${least}–${most}` : String(most);
    return `в ${count} из ${low.tickets} ${genitiveOf(low.tickets, 'билета', 'билетов')} ${tail}`;
  }
  if (low.q <= 1) return null;
  const most = percent(low.none);
  const least = shares.isRange && high.ok ? percent(high.none) : most;
  const share = least !== most ? `${least}–${most}${NBSP}%` : pct(most);
  return `в ${share} билетов ${tail}`;
}

export interface ClosePartialLine {
  /** «7 вопросов «частично»»: a link that filters the sheet to «частично». */
  link: string;
  /** «— оба вопроса будут в лекциях в 60 % билетов.» */
  rest: string;
  /** The whole sentence, «Закройте 7 вопросов «частично» — …». */
  text: string;
}

/**
 * The action line under «Как считается» (Jury_Check item 10): «Закройте 7 вопросов «частично» — оба
 * вопроса будут в лекциях в 60 % билетов.» It is computed by the same layout with «частично» counted
 * as «есть» (a range while some questions are unknown); one question per ticket reads «… — в лекциях
 * будет 78 % вопросов». Null without «частично» questions and when closing them does not raise the
 * share.
 */
export function closePartialLine(partial: number, shares: LayoutShares, closed: LayoutShares): ClosePartialLine | null {
  if (partial <= 0 || !shares.low.ok || !closed.low.ok) return null;
  const link = `${partial} ${pluralRu(partial, ['вопрос', 'вопроса', 'вопросов'])} «частично»`;
  let rest: string;
  if (closed.low.mode === 'fixed' && shares.low.mode === 'fixed') {
    if (closed.low.allCount <= shares.low.allCount) return null;
    const most = closed.high.ok && closed.high.mode === 'fixed' ? closed.high.allCount : closed.low.allCount;
    const count = most !== closed.low.allCount ? `${closed.low.allCount}–${most}` : String(closed.low.allCount);
    rest = `— все вопросы будут в лекциях в ${count} из ${closed.low.tickets} ${genitiveOf(closed.low.tickets, 'билета', 'билетов')}.`;
  } else {
    if (percent(closed.low.all) <= percent(shares.low.all)) return null;
    const value = shareText(closed, 'all') ?? pct(percent(closed.low.all));
    const q = perTicketOf(closed.low, 2);
    rest = q <= 1 ? `— в лекциях будет ${value} вопросов.` : `— ${allQuestionsWord(q)} будут в лекциях в ${value} билетов.`;
  }
  return { link, rest, text: `Закройте ${link} ${rest}` };
}

/** The caveat under the pair: what a «ticket» is in this calculation. Always visible. */
export function caveatSentence(shares: LayoutShares, total: number): string {
  const head = 'Это доля билетов, а не вероятность сдать';
  if (!shares.low.ok) return `${head}.`;
  if (shares.low.mode === 'fixed') return `${head}: считаем по списку билетов кафедры.`;
  if (shares.low.mode === 'sections') return `${head}: считаем, что в билете по одному случайному вопросу из каждого раздела.`;
  const q = shares.low.q;
  if (q <= 1) return `${head}: считаем, что билет — один случайный вопрос из${NBSP}${total}.`;
  const words: Record<number, string> = { 2: 'два случайных вопроса', 3: 'три случайных вопроса', 4: 'четыре случайных вопроса' };
  return `${head}: считаем, что билет — ${words[q] ?? `${q} случайных вопроса`} из${NBSP}${total}.`;
}

/** «3 вопроса ещё не сверены с лекциями — доля билетов: 35–41 %.» */
export function unmappedSentence(count: number, shares: LayoutShares): string {
  const verb = count % 10 === 1 && count % 100 !== 11 ? 'не сверен' : 'не сверены';
  const head = `${count} ${pluralRu(count, ['вопрос', 'вопроса', 'вопросов'])} ещё ${verb} с лекциями`;
  const range = shareText(shares, 'all');
  return range && shares.isRange ? `${head} — доля билетов: ${range}.` : `${head}.`;
}

/** «12 вопросов проверены только по словам — доля билетов: 35–41 %.» */
export function unverifiedSentence(count: number, shares: LayoutShares): string {
  const verb = count % 10 === 1 && count % 100 !== 11 ? 'проверен' : 'проверены';
  const head = `${count} ${pluralRu(count, ['вопрос', 'вопроса', 'вопросов'])} ${verb} только по словам`;
  const range = shareText(shares, 'all');
  return range && shares.isRange ? `${head} — доля билетов: ${range}.` : `${head}.`;
}

// ---------------------------------------------------------------------------------------------
// Answers aloud and self-assessment

export interface AnswerSummary {
  total: number;
  confirmed: number;
  once: number;
  notPassed: number;
  untested: number;
  since: string | null;
}

/**
 * «Подтверждено ответами — 6 из 40.» or null when there were no answers yet. No date here: «с 1 окт.»
 * after a zero read as a claim; the date of the change belongs to peak 3 («С 1 октября: 0 → 1.»).
 */
export function confirmedSentence(summary: AnswerSummary): string | null {
  if (summary.confirmed + summary.once + summary.notPassed === 0) return null;
  return endSentence(`Подтверждено ответами — ${summary.confirmed} из ${summary.total}`);
}

export const NO_ANSWERS_SENTENCE = 'Ответов по билетам ещё не было. Каждый ответ проверяется по вашим лекциям.';
/** A passed answer is «засчитан» («зачёт» is a kind of exam), and a typed answer counts as a spoken one. */
export const CONFIRMED_MEANING = 'Подтверждено — значит, засчитано дважды, в разные дни.';
export const NOT_ENOUGH_CONFIDENCE =
  'Сравнить уверенность с ответами пока нельзя: нужно хотя бы три ответа на вопросы с отметкой «знаю».';

/** «Вы отметили «знаю» у 18 вопросов. Из 10 таких, на которые вы ответили, засчитано 8.» — only with enough data. */
export function confidenceSentence(value: { ratedKnow: number; ratedKnowAnswered: number; ratedKnowPassed: number; enoughData: boolean }): string {
  if (!value.enoughData) return NOT_ENOUGH_CONFIDENCE;
  const genitive = genitiveOf(value.ratedKnow, 'вопроса', 'вопросов');
  return `Вы отметили «знаю» у ${value.ratedKnow} ${genitive}. Из ${value.ratedKnowAnswered} таких, на которые вы ответили, засчитано ${value.ratedKnowPassed}.`;
}

/** Calendar days from a local day to today (0 for today), or null. */
export function daysAgo(key: string | null | undefined, now: Date = new Date()): number | null {
  const days = daysUntil(key, now);
  return days === null ? null : -days;
}

/**
 * The age of a confirmation, counted from the last засчитанный answer (the moment the 14-day rule
 * uses): «Подтверждено сегодня.», «Подтверждено вчера.», «Подтверждено 3 октября — 2 дня назад.»,
 * and when it is stale «Подтверждено 16 дней назад — пора проверить.» Null unless confirmed.
 */
export function confirmedAgeSentence(state: Pick<QuestionState, 'readiness' | 'lastPassDate' | 'stale'>, now: Date = new Date()): string | null {
  if (state.readiness !== 'confirmed') return null;
  const days = daysAgo(state.lastPassDate, now);
  if (days === null) return 'Подтверждено.';
  if (state.stale) return `Подтверждено ${days} ${pluralRu(days, ['день', 'дня', 'дней'])} назад — пора проверить.`;
  if (days <= 0) return 'Подтверждено сегодня.';
  if (days === 1) return 'Подтверждено вчера.';
  return `Подтверждено ${formatDay(state.lastPassDate, now)} — ${days} ${pluralRu(days, ['день', 'дня', 'дней'])} назад.`;
}

/**
 * What a screen reader hears after a question's number: «подтверждено 2 дня назад», «подтверждено 16
 * дней назад, пора проверить», «засчитано, не подтверждено»; '' for a question never answered.
 */
export function readinessWords(state: Pick<QuestionState, 'readiness' | 'lastPassDate' | 'stale'>, now: Date = new Date()): string {
  if (state.readiness === 'untested') return '';
  if (state.readiness !== 'confirmed') return READINESS_LABELS[state.readiness];
  const days = daysAgo(state.lastPassDate, now);
  if (days === null) return READINESS_LABELS.confirmed;
  const age = days <= 0 ? 'сегодня' : days === 1 ? 'вчера' : `${days} ${pluralRu(days, ['день', 'дня', 'дней'])} назад`;
  return `подтверждено ${age}${state.stale ? ', пора проверить' : ''}`;
}

/** Question states with the student's latest self-rating taps applied over the journal. */
export function withRatingOverrides(
  states: Map<string, QuestionState>,
  overrides: Record<string, SelfRating | undefined>,
): Map<string, QuestionState> {
  const entries = Object.entries(overrides).filter((entry): entry is [string, SelfRating] => Boolean(entry[1]));
  if (entries.length === 0) return states;
  const next = new Map(states);
  for (const [hash, rating] of entries) {
    const base: QuestionState = next.get(hash) ?? emptyQuestionState();
    next.set(hash, { ...base, selfRating: rating });
  }
  return next;
}

/** The department's number of a question when it has one, otherwise its position. */
export function numberOf(question: Pick<ExamQuestion, 'label' | 'position'>): string {
  return questionNumber(question.label.replace(/[.)]\s*$/, ''), question.position);
}

/** «Ни в одной из 9 лекций» needs the genitive plural except after 1 (and not 11). */
export function lecturesGenitive(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? 'лекции' : 'лекций';
}

export function lecturesPhrase(count: number): string {
  return `${count} ${pluralRu(count, ['лекция', 'лекции', 'лекций'])}`;
}
