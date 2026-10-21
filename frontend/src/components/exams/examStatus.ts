/**
 * The status at the top of the exam page (owner, 2026-10-07: «вот я попал на этот экран и вообще не ебу что от
 * меня требуется или что мне донести пытаются»). One block says what Meldy did with this exam, what it found and
 * the one thing to do next; the rest of the page only details it. Pure: the page passes what it knows (rows,
 * the mapping run, the cheat sheet, the answers) and gets one state with its words, its action and what the
 * page should hide or step down. Nothing here reads the network.
 *
 * The states, first match wins:
 *  empty → mapping → waiting → failed → interrupted → no-lectures → unmapped → lectures-changed → some-unmapped
 *  → nothing-found → unverified → writing → loading → write-sheet → ready → answering.
 * No percentages here: the shares of tickets stay in the column and in «Как считается».
 */
import { examMappingCost } from '../../lib/plans';
import { shortTitle } from '../../lib/exams/format';
import { pluralRu } from '../conversation/visuals';
import type { CoverageCounts } from './sheetModel';

/** A question is «nothing found» territory when this share of the list is in no lecture (with lectures attached). */
export const NOTHING_FOUND_SHARE = 0.7;
/** A lecture's title inside the headline is cut to this many characters. */
const TITLE_CHARS = 32;

/**
 * Which of the student's lectures fit the questions (the lecture-fit check of the editor, POST
 * /api/exams/lecture-fit, when the page learns it). Until then 'unknown': the words cover both causes of an
 * empty mapping — the right lectures were not chosen, or the student has none yet.
 */
export type LectureFit = { state: 'unknown' } | { state: 'none' } | { state: 'some'; titles: string[] };

export type ExamStatusKey =
  | 'empty'
  | 'mapping'
  | 'waiting'
  | 'failed'
  | 'interrupted'
  | 'no-lectures'
  | 'unmapped'
  | 'lectures-changed'
  | 'some-unmapped'
  | 'nothing-found'
  | 'unverified'
  | 'writing'
  | 'loading'
  | 'write-sheet'
  | 'ready'
  | 'answering';

export type ExamStatusAction =
  /** Start or continue a mapping run of what needs it. */
  | { kind: 'map'; label: string }
  /** Check again the questions found only by words. */
  | { kind: 'recheck'; label: string }
  /** The exam's lectures in the editor (/exams/:id/edit#lectures): choose others or add new ones. */
  | { kind: 'lectures'; label: string }
  /** The list of questions in the editor. */
  | { kind: 'list'; label: string }
  /** Write the cheat sheet (`count` questions when the units left do not cover all). */
  | { kind: 'write'; label: string; count: number | null }
  /** Draw a ticket in the chosen way. */
  | { kind: 'draw'; label: string }
  /** Draw from the questions whose lines an answer erases now (/draw?mode=awaiting). */
  | { kind: 'awaiting'; label: string };

/** Whose move it is: the student's (yellow flag), Meldy's while it works (sky), answering (green). */
export type ExamStatusTone = 'you' | 'meldy' | 'ready';

export interface ExamStatus {
  key: ExamStatusKey;
  tone: ExamStatusTone;
  /** The flag over the headline: the step of the way (lectures → mapping → cheat sheet → answers). */
  flag: string;
  /** The headline in three parts: the middle one, its key words, stays on one line (empty: none). */
  title: { lead: string; mark: string; tail: string };
  text: string | null;
  /**
   * The same in one short line for a phone (10_Project/Phone_Declutter_2026-10-08: «heading and one line»): what to
   * do and what it costs. Every state with a `text` has one (a server's message: its first sentence; nothing found: the
   * way out); null only where there is no text either (loading).
   */
  brief: string | null;
  action: ExamStatusAction | null;
  /** Why the action is not available now (the daily limit); the action stays where it is, unavailable. */
  blocked: string | null;
  /** «Тянуть билет» is offered as a quiet link beside the action (false: not at all, e.g. an empty list). */
  draw: boolean;
  /** The column's ticket shares say nothing now (nothing checked yet, nothing found): hidden. */
  hideCoverage: boolean;
  /** «В лекции нет фрагмента об этом» would stand under almost every question: said once, here. */
  quietGaps: boolean;
}

export interface ExamStatusInput {
  /** Questions of the list. */
  total: number;
  /** The exam's lectures now. */
  lectures: ReadonlyArray<{ id: string; title: string }>;
  /** The exam is a copy from a classmate's group link: the author chose the lectures and wrote the sheet. */
  copy: boolean;
  /** Coverage of the rows as the page shows them (a run going on included). */
  coverage: CoverageCounts;
  mapping: {
    phase: 'idle' | 'running' | 'waiting' | 'interrupted' | 'failed';
    /** How far a run going on, or one that stopped, got. */
    progress: { checked: number; total: number } | null;
    /** A failed run's message in the server's words. */
    message: string | null;
    /** Lectures added and removed since the last finished run. */
    added: number;
    removed: number;
    /** Units the next run takes (0: nothing goes to the model). */
    cost: number;
    /** The daily limit does not cover a run: what is left and when it renews. */
    limit: { remaining: number; resetAt: string } | null;
  };
  sheet: {
    state: 'loading' | 'ready' | 'error';
    /** Questions with their points written, questions that can still be written and their price. */
    written: number;
    toWrite: number;
    units: number;
    /** The sheet is being written now. */
    writing: { done: number; total: number } | null;
    /** Units left today (null: unknown). */
    unitsLeft: number | null;
    /** «3:00»: when the daily limit renews. */
    resetAt: string;
    /** Lines on the sheet and lines still there. */
    lines: { left: number; total: number };
    /** Questions whose line an answer erases now. */
    erasable: number;
    /** «Следующие строки можно стереть после 9 окт., 15:40.» (copy.nextErasableLine), or null. */
    nextErasable: string | null;
  };
  answers: {
    state: 'loading' | 'ready' | 'error';
    /** Questions answered at least once; never answered; confirmed. */
    answered: number;
    untested: number;
    confirmed: number;
  };
  /** «Тянуть билет» or «Тянуть вопрос», as the page's button says it. */
  drawLabel: string;
  lectureFit?: LectureFit;
}

// ------------------------------------------------------------------------------------------- words

function questions(count: number): string {
  return `${count} ${pluralRu(count, ['вопрос', 'вопроса', 'вопросов'])}`;
}

/** «из 18 вопросов», «из 1 вопроса», «из 21 вопроса». */
function ofQuestions(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'вопроса' : 'вопросов'}`;
}

/**
 * The draw from the questions whose lines an answer erases today, as the button says it: «Тянуть билет из 4 вопросов»
 * (the bar at the bottom of a phone stands far from the headline that names them: «из них» said nothing there); one
 * question per ticket: «Тянуть один из 4 вопросов».
 */
export function awaitingDrawLabel(drawLabel: string, count: number): string {
  if (drawLabel === 'Тянуть вопрос' && count > 1) return `Тянуть один из ${ofQuestions(count)}`;
  return `${drawLabel} из ${ofQuestions(count)}`;
}

/** The plain draw beside it (a phone's «⋯»): «Тянуть билет из всех вопросов», «Тянуть вопрос из всего списка». */
export function allDrawLabel(drawLabel: string): string {
  return drawLabel === 'Тянуть вопрос' ? 'Тянуть вопрос из всего списка' : `${drawLabel} из всех вопросов`;
}

function lectures(count: number): string {
  return `${count} ${pluralRu(count, ['лекция', 'лекции', 'лекций'])}`;
}

/** «с 3 лекциями», «с 21 лекцией». */
function withLectures(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'лекцией' : 'лекциями'}`;
}

/** «по 3 лекциям», «по 21 лекции». */
function byLectures(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'лекции' : 'лекциям'}`;
}

function units(count: number): string {
  return `${count} ${pluralRu(count, ['единица', 'единицы', 'единиц'])} ИИ`;
}

/** «10 единиц ИИ» after «за» / «стоит»: the accusative of «единица» is «единицу». */
function unitsAcc(count: number): string {
  return `${count} ${pluralRu(count, ['единицу', 'единицы', 'единиц'])} ИИ`;
}

function quoted(title: string): string {
  return `«${shortTitle(title.trim() || 'Лекция', TITLE_CHARS)}»`;
}

/** «Это стоит 10 единиц ИИ.» or nothing when the run costs nothing. */
function costSentence(cost: number): string {
  return cost > 0 ? ` Это стоит ${unitsAcc(cost)}.` : '';
}

/** «Сегодня осталось 4 единицы ИИ, а сверка расходует 10. Лимит обновится в 3:00.» */
export function mappingLimitLine(limit: { remaining: number; resetAt: string }, cost: number): string {
  if (limit.remaining <= 0) return `Дневной лимит ИИ на сегодня исчерпан. Он обновится в ${limit.resetAt}.`;
  const left = limit.remaining % 10 === 1 && limit.remaining % 100 !== 11 ? 'осталась' : 'осталось';
  return `Сегодня ${left} ${units(limit.remaining)}, а сверка расходует ${cost > 0 ? cost : 10}. Лимит обновится в ${limit.resetAt}.`;
}

/** «Дневной лимит ИИ исчерпан: сверка … не запущена. Лимит обновится в 3:00.» → its first sentence, then the rest. */
function splitMessage(message: string): { head: string; rest: string } {
  const clean = message.trim().replace(/\s+/g, ' ');
  const match = /^(.+?[.!?])\s+(.+)$/.exec(clean);
  if (!match) return { head: clean.replace(/[.!]$/, ''), rest: '' };
  return { head: match[1].replace(/[.!]$/, ''), rest: match[2] };
}

/** The first sentence of a text (a phone's one line under a server's message). */
function firstSentence(text: string): string {
  return /^(.+?[.!?])\s/.exec(text)?.[1] ?? text;
}

const ERASE_RULE = 'названный пункт стирает строку наполовину, названный снова в другой день — совсем';

function plain(text: string): ExamStatus['title'] {
  return { lead: text, mark: '', tail: '' };
}

function marked(lead: string, mark: string, tail = ''): ExamStatus['title'] {
  return { lead, mark, tail };
}

/** The headline as one string (tests, a screen reader's name of the block). */
export function statusTitleText(status: Pick<ExamStatus, 'title'>): string {
  return `${status.title.lead}${status.title.mark}${status.title.tail}`;
}

// ------------------------------------------------------------------------------------------- the picker

const BASE = { blocked: null, draw: true, hideCoverage: false, quietGaps: false, brief: null } as const;

/** Questions found in the lectures (fully or partly; a mark made by hand counts as found). */
function foundCount(coverage: CoverageCounts): number {
  return coverage.full + coverage.partial;
}

/**
 * Every question checked and at least 70 % of them in no lecture: the lectures say nothing about this list. Shared
 * with «Сегодня» (pages/Dashboard.tsx), so its exam card offers the same next step as the exam page.
 */
export function mostlyNone(counts: { total: number; none: number; unmapped: number; checking?: number }): boolean {
  if (counts.total === 0 || counts.unmapped + (counts.checking ?? 0) > 0) return false;
  return counts.none > 0 && counts.none >= NOTHING_FOUND_SHARE * counts.total;
}

/** Mapped to the end, lectures attached, and at least 70 % of the list is in no lecture. */
export function isNothingFound(input: Pick<ExamStatusInput, 'total' | 'lectures' | 'coverage'>): boolean {
  return input.lectures.length > 0 && mostlyNone({ ...input.coverage, total: input.total });
}

export function examStatus(input: ExamStatusInput): ExamStatus {
  const status = pickStatus(input);
  // (Almost) every question in no lecture — also while the student is fixing it («После сверки добавлено 2 лекции»):
  // a «0 %» beside the list and «нет в лекции» under every question say nothing new.
  return mostlyNone({ ...input.coverage, total: input.total }) ? { ...status, hideCoverage: true, quietGaps: true } : status;
}

function pickStatus(input: ExamStatusInput): ExamStatus {
  const { total, coverage, mapping, sheet, answers } = input;
  const lectureCount = input.lectures.length;
  const mapped = coverage.full + coverage.partial + coverage.none + coverage.unverified;
  const unmapped = coverage.unmapped + coverage.checking;
  const limit = mapping.limit ? mappingLimitLine(mapping.limit, mapping.cost) : null;

  if (total === 0) {
    return {
      ...BASE,
      key: 'empty',
      tone: 'you',
      flag: 'Вопросы',
      title: marked('В экзамене пока ', 'нет вопросов'),
      text: 'Вставьте список вопросов кафедры — Meldy сверит его с вашими лекциями.',
      brief: 'Вставьте список вопросов кафедры.',
      action: { kind: 'list', label: 'Добавить вопросы' },
      draw: false,
      hideCoverage: true,
    };
  }

  if (mapping.phase === 'running') {
    const progress = mapping.progress;
    return {
      ...BASE,
      key: 'mapping',
      tone: 'meldy',
      flag: 'Сверка с лекциями',
      title: plain('Meldy сверяет вопросы с лекциями'),
      text: `${progress ? `Проверено ${progress.checked} из ${progress.total}. ` : ''}Пометки появляются в списке по ходу проверки; не закрывайте вкладку, пока сверка не закончится.`,
      brief: `${progress ? `Проверено ${progress.checked} из ${progress.total}. ` : ''}Не закрывайте вкладку.`,
      action: null,
      hideCoverage: true,
    };
  }

  if (mapping.phase === 'waiting') {
    return {
      ...BASE,
      key: 'waiting',
      tone: 'meldy',
      flag: 'Сверка с лекциями',
      title: plain('Сверка уже идёт'),
      text: 'Её запустили в другой вкладке или на другом устройстве. Список обновится сам, когда она закончится.',
      brief: 'Список обновится сам, когда она закончится.',
      action: null,
      hideCoverage: true,
    };
  }

  if (mapping.phase === 'failed' && mapping.message) {
    const { head, rest } = splitMessage(mapping.message);
    const text = rest || 'Повторите сверку через минуту.';
    return {
      ...BASE,
      key: 'failed',
      tone: 'you',
      flag: 'Сверка с лекциями',
      title: plain(head),
      text,
      brief: firstSentence(text),
      action: { kind: 'map', label: 'Повторить сверку' },
      blocked: limit,
      hideCoverage: mapped === 0 || unmapped > 0,
    };
  }

  if (mapping.phase === 'interrupted') {
    const progress = mapping.progress;
    const rest = progress ? Math.max(0, progress.total - progress.checked) : 0;
    const price = mapping.cost > 0 ? ` за ${unitsAcc(mapping.cost)}` : '';
    return {
      ...BASE,
      key: 'interrupted',
      tone: 'you',
      flag: 'Сверка с лекциями',
      title: marked('Сверка ', 'прервалась'),
      text: !progress
        ? `Проверка не успела начаться. Запустите сверку ещё раз${price}.`
        : rest > 0
          ? `Проверено ${progress.checked} из ${progress.total}. Продолжите — Meldy проверит ${rest === 1 ? 'оставшийся вопрос' : `оставшиеся ${questions(rest)}`}${price}.`
          : `Проверено ${progress.checked} из ${progress.total}, но сверка не успела завершиться. Запустите её ещё раз${price}.`,
      brief: progress && rest > 0 ? `Проверено ${progress.checked} из ${progress.total}.${mapping.cost > 0 ? ` Продолжение стоит ${unitsAcc(mapping.cost)}.` : ''}` : `Запустите сверку ещё раз${price}.`,
      action: { kind: 'map', label: 'Продолжить сверку' },
      blocked: limit,
      hideCoverage: true,
    };
  }

  if (lectureCount === 0) {
    return {
      ...BASE,
      key: 'no-lectures',
      tone: 'you',
      flag: 'Лекции',
      title: marked('К экзамену ', 'не добавлены', ' лекции'),
      text: 'Meldy ищет ответы на вопросы в ваших лекциях. Добавьте лекции по этому предмету, и он отметит, на какие вопросы в них есть ответ.',
      brief: 'Meldy ищет ответы на вопросы в ваших лекциях.',
      action: { kind: 'lectures', label: 'Добавить лекции' },
      hideCoverage: true,
    };
  }

  if (mapped === 0) {
    const where =
      lectureCount === 1
        ? `по лекции ${quoted(input.lectures[0].title)} и отметит, где в ней есть ответ`
        : `по ${byLectures(lectureCount)} и отметит, где в них есть ответ`;
    const what = total === 1 ? `Meldy проверит вопрос ${where}.` : `Meldy проверит каждый из ${ofQuestions(total)} ${where}.`;
    return {
      ...BASE,
      key: 'unmapped',
      tone: 'you',
      flag: 'Сверка с лекциями',
      title: marked('Вопросы ещё ', 'не сверены', ' с лекциями'),
      text: `${what}${costSentence(mapping.cost)}`,
      brief: mapping.cost > 0 ? `Сверка стоит ${unitsAcc(mapping.cost)}.` : 'Meldy отметит, где в лекциях есть ответ.',
      action: { kind: 'map', label: 'Сверить с лекциями' },
      blocked: limit,
      hideCoverage: true,
    };
  }

  if (mapping.added > 0 || mapping.removed > 0) {
    const one = (count: number) => count % 10 === 1 && count % 100 !== 11;
    const { added, removed } = mapping;
    let title: ExamStatus['title'];
    let text: string;
    if (added > 0 && removed === 0) {
      title = marked('После сверки ', `${one(added) ? 'добавлена' : 'добавлено'} ${lectures(added)}`);
      text = `Пометки в списке сделаны без ${one(added) ? 'неё' : 'них'}. Сверьте заново — Meldy проверит вопросы и по ${one(added) ? 'новой лекции' : 'новым лекциям'}.`;
    } else if (removed > 0 && added === 0) {
      title = marked('После сверки ', `${one(removed) ? 'убрана' : 'убрано'} ${lectures(removed)}`);
      text = `В списке остались пометки по ${one(removed) ? 'убранной лекции' : 'убранным лекциям'}. Сверьте заново, чтобы они совпадали с лекциями экзамена.`;
    } else {
      title = marked('После сверки лекции ', 'изменились');
      text = 'Пометки в списке сделаны по прежнему набору лекций. Сверьте заново, чтобы Meldy учёл изменения.';
    }
    return {
      ...BASE,
      key: 'lectures-changed',
      tone: 'you',
      flag: 'Сверка с лекциями',
      title,
      text: `${text}${costSentence(mapping.cost)}`,
      brief: `Сверьте заново${mapping.cost > 0 ? ` — это стоит ${unitsAcc(mapping.cost)}` : ''}.`,
      action: { kind: 'map', label: 'Сверить заново' },
      blocked: limit,
    };
  }

  if (unmapped > 0) {
    const verb = unmapped % 10 === 1 && unmapped % 100 !== 11 ? 'сверен' : 'сверены';
    return {
      ...BASE,
      key: 'some-unmapped',
      tone: 'you',
      flag: 'Сверка с лекциями',
      title: marked(`${questions(unmapped)} ещё `, `не ${verb}`, ' с лекциями'),
      text: `${unmapped === 1 ? 'Его' : 'Их'} добавили или изменили после сверки. Meldy проверит только ${unmapped === 1 ? 'его' : 'их'}${mapping.cost > 0 ? ` — это стоит ${unitsAcc(mapping.cost)}` : ''}.`,
      brief: `Meldy проверит только ${unmapped === 1 ? 'его' : 'их'}${mapping.cost > 0 ? ` — это стоит ${unitsAcc(mapping.cost)}` : ''}.`,
      action: { kind: 'map', label: 'Сверить с лекциями' },
      blocked: limit,
    };
  }

  if (isNothingFound(input)) return nothingFound(input);

  const answering = answers.state === 'ready' && answers.answered > 0;

  if (coverage.unverified > 0 && !answering) {
    const count = coverage.unverified;
    const one = count % 10 === 1 && count % 100 !== 11;
    const them = count === 1 ? 'его' : 'их';
    return {
      ...BASE,
      key: 'unverified',
      tone: 'you',
      flag: 'Сверка с лекциями',
      title: marked(`${questions(count)} ${one ? 'проверен' : 'проверены'} `, 'только по словам'),
      text: `Сервис был занят, и Meldy сравнил ${them} с лекциями только по совпадению слов. Проверьте ${them} снова — это стоит ${unitsAcc(examMappingCost(count))}.`,
      brief: `Проверьте ${them} снова — это стоит ${unitsAcc(examMappingCost(count))}.`,
      action: { kind: 'recheck', label: 'Проверить снова' },
      blocked: limit,
    };
  }

  if (sheet.writing) {
    const { done, total: all } = sheet.writing;
    return {
      ...BASE,
      key: 'writing',
      tone: 'meldy',
      flag: 'Шпаргалка',
      title: plain('Meldy пишет шпаргалку'),
      text: `${all > 0 ? `Готово ${done} из ${all}. ` : ''}Страницу можно закрыть — шпаргалка допишется.`,
      brief: `${all > 0 ? `Готово ${done} из ${all}. ` : ''}Страницу можно закрыть.`,
      action: null,
    };
  }

  if (sheet.state === 'loading' || answers.state === 'loading') {
    // A moment while the sheet and the answers are read: «Тянуть билет» already stands where it most likely stays.
    return {
      ...BASE,
      key: 'loading',
      tone: 'ready',
      flag: 'Ответы',
      title: plain(''),
      text: null,
      action: { kind: 'draw', label: input.drawLabel },
    };
  }

  if (sheet.state === 'ready' && sheet.toWrite > 0 && (sheet.written === 0 || !answering)) return writeSheet(input);

  if (!answering) return ready(input);
  return answeringStatus(input);
}

function nothingFound(input: ExamStatusInput): ExamStatus {
  const { coverage, total, copy } = input;
  const found = foundCount(coverage);
  const lectureCount = input.lectures.length;
  const one = lectureCount === 1;
  const place = copy ? (one ? `В лекции ${quoted(input.lectures[0].title)} ` : 'В лекциях из ссылки ') : one ? `В лекции ${quoted(input.lectures[0].title)} ` : 'В выбранных лекциях ';
  const title = marked(place, found === 0 ? 'нет ответов' : 'почти нет ответов', ' на эти вопросы');
  const fit = input.lectureFit ?? { state: 'unknown' };

  // What Meldy did and found, in one sentence.
  let did: string;
  if (found > 0) did = `Ответ нашёлся только для ${ofQuestions(found)} из ${total}.`;
  else if (copy) did = `${one ? 'Эту лекцию' : 'Эти лекции'} выбрал автор ссылки, и Meldy не нашёл в ${one ? 'ней' : 'них'} ни одного ответа.`;
  else if (total === 1) did = `Meldy сверил вопрос с ${one ? 'ней' : withLectures(lectureCount)} и ответа не нашёл.`;
  else did = `Meldy сверил с ${one ? 'ней' : withLectures(lectureCount)} все ${questions(total)} и не нашёл ни одного ответа.`;

  // The way out: choose other lectures or add new ones, then check again. A phone says only the way out, in one short
  // line (the headline already says that nothing was found; the button names the step).
  const cost = examMappingCost(coverage.none + coverage.partial + coverage.unverified);
  let next: string;
  let brief: string;
  let action: ExamStatusAction;
  const topics = found > 0 ? 'по темам остальных' : 'по темам вопросов';
  // A copy from a group link keeps its other way out: the author's new link.
  const orAuthor = copy ? ' — или попросите у автора новую ссылку' : '';
  if (fit.state === 'some' && fit.titles.length > 0) {
    const named = fit.titles.slice(0, 2).map(quoted).join(' и ');
    const more = fit.titles.length > 2 ? ` и ещё ${fit.titles.length - 2}` : '';
    next =
      fit.titles.length === 1
        ? `Подходит ваша лекция ${named}: выберите её и сверьте заново${orAuthor}.`
        : `Подходят ваши лекции ${named}${more}: выберите их и сверьте заново${orAuthor}.`;
    brief = fit.titles.length === 1 ? `Подходит ваша лекция ${named}.` : `Подходят ваши лекции ${named}${more}.`;
    action = { kind: 'lectures', label: fit.titles.length === 1 ? 'Выбрать лекцию' : 'Выбрать лекции' };
  } else if (copy) {
    next = `Добавьте свои лекции ${topics} и сверьте заново${cost > 0 ? ` (${unitsAcc(cost)})` : ''}${orAuthor}.`;
    brief = 'Добавьте свои лекции или попросите у автора новую ссылку.';
    action = { kind: 'lectures', label: 'Добавить свои лекции' };
  } else if (fit.state === 'none') {
    next = `Среди ваших лекций подходящих нет. Добавьте лекции ${topics} и сверьте заново.`;
    brief = 'Среди ваших лекций подходящих нет.';
    action = { kind: 'lectures', label: 'Добавить лекции' };
  } else {
    next = `Выберите лекции ${topics} или добавьте новые, потом сверьте заново.`;
    brief = `Выберите лекции ${topics} или добавьте новые.`;
    action = { kind: 'lectures', label: 'Выбрать или добавить лекции' };
  }
  return {
    ...BASE,
    // Nothing found at all: a ticket has no points to check an answer against, so it is not offered even quietly.
    draw: found > 0,
    key: 'nothing-found',
    tone: 'you',
    flag: copy ? 'Лекции из ссылки' : 'Сверка с лекциями',
    title,
    text: `${did} ${next}`,
    brief,
    action,
    hideCoverage: true,
    quietGaps: true,
  };
}

function writeSheet(input: ExamStatusInput): ExamStatus {
  const { sheet, coverage, total } = input;
  const found = foundCount(coverage);
  const affordable = sheet.unitsLeft === null ? sheet.toWrite : Math.min(sheet.toWrite, sheet.unitsLeft);
  const first = sheet.written === 0;
  let blocked: string | null = null;
  let count: number | null = null;
  let label = first ? 'Написать шпаргалку' : 'Дописать шпаргалку';
  let tail = '';
  if (affordable <= 0) {
    blocked = `Дневной лимит ИИ на сегодня кончился. Написать шпаргалку можно после ${sheet.resetAt}.`;
  } else if (affordable < sheet.toWrite) {
    count = affordable;
    label = `Написать ${questions(affordable)}`;
    tail = ` Сегодня хватит на ${questions(affordable)}, остальные — после ${sheet.resetAt}.`;
  }
  const price = sheet.units > 0 ? ` Это стоит ${unitsAcc(sheet.units)}.` : '';
  if (first) {
    return {
      ...BASE,
      key: 'write-sheet',
      tone: 'you',
      flag: 'Шпаргалка',
      title: found >= total ? marked('В лекциях ', 'есть ответы', ` на все ${questions(total)}`) : marked('В лекциях ', 'есть ответы', ` на ${questions(found)} из ${total}`),
      text: `Теперь Meldy выпишет из лекций пункты ответа — получится шпаргалка, строки которой стирают ваши ответы.${price}${tail}`,
      brief: `Meldy выпишет из них пункты ответа.${price}${tail}`,
      action: { kind: 'write', label, count },
      blocked,
    };
  }
  return {
    ...BASE,
    key: 'write-sheet',
    tone: 'you',
    flag: 'Шпаргалка',
    title: marked('Шпаргалка написана ', 'не полностью'),
    text: `У ${ofQuestions(sheet.toWrite)} ещё нет пунктов ответа. Допишите ${sheet.toWrite === 1 ? 'его' : 'их'}.${price}${tail}`,
    // The phone shows the brief under the title alone: it names what to write, not «его» after «Шпаргалка».
    brief: `Допишите ${questions(sheet.toWrite)}.${price}${tail}`,
    action: { kind: 'write', label, count },
    blocked,
  };
}

function ready(input: ExamStatusInput): ExamStatus {
  const { sheet, copy } = input;
  const draw: ExamStatusAction = { kind: 'draw', label: input.drawLabel };
  const ticket = input.drawLabel === 'Тянуть вопрос' ? 'вопрос' : 'билет';
  if (copy) {
    return {
      ...BASE,
      key: 'ready',
      tone: 'ready',
      flag: 'Из ссылки группы',
      title: marked('Экзамен из ссылки группы ', 'готов'),
      text: `Вопросы уже сверены с лекциями автора, шпаргалка написана. Тяните ${ticket} и отвечайте вслух: ${ERASE_RULE}.`,
      brief: `Тяните ${ticket} и отвечайте вслух.`,
      action: draw,
    };
  }
  if (sheet.state === 'ready' && sheet.lines.total > 0) {
    return {
      ...BASE,
      key: 'ready',
      tone: 'ready',
      flag: 'Ответы',
      title: marked('Шпаргалка ', 'готова', ' — можно отвечать'),
      text: `Тяните ${ticket} и отвечайте вслух: ${ERASE_RULE}.`,
      brief: `Тяните ${ticket} и отвечайте вслух.`,
      action: draw,
    };
  }
  return {
    ...BASE,
    key: 'ready',
    tone: 'ready',
    flag: 'Ответы',
    title: marked('Можно ', 'отвечать', ' на билеты'),
    text: `Тяните ${ticket} и отвечайте вслух — Meldy проверит ответ по вашим лекциям.`,
    brief: `Тяните ${ticket} и отвечайте вслух.`,
    action: draw,
  };
}

function answeringStatus(input: ExamStatusInput): ExamStatus {
  const { sheet, answers } = input;
  const draw: ExamStatusAction = { kind: 'draw', label: input.drawLabel };
  const base = { ...BASE, key: 'answering' as const, tone: 'ready' as const, flag: 'Ответы' };
  if (sheet.state === 'ready' && sheet.erasable > 0) {
    const count = sheet.erasable;
    return {
      ...base,
      // «строки шпаргалки»: on «Вопросы» the sheet is not on screen, and «стереть строки» alone said nothing (audit
      // 2026-10-08). The marked words never wrap: two of them fit a 320 px phone.
      title: marked('Сегодня можно стереть ', 'строки шпаргалки', ` у ${ofQuestions(count)}`),
      text: `Их пункты вы уже называли в другой день. Назовёте снова — строки сотрутся совсем.`,
      brief: 'Назовите их пункты снова в ответе.',
      action: { kind: 'awaiting', label: awaitingDrawLabel(input.drawLabel, count) },
    };
  }
  if (sheet.state === 'ready' && sheet.nextErasable) {
    return {
      ...base,
      title: plain(sheet.nextErasable.replace(/\.$/, '')),
      text: answers.untested > 0 ? `А пока отвечайте на вопросы, которых ещё не было: их ${answers.untested}.` : 'А пока можно повторить другие вопросы.',
      brief: 'А пока отвечайте на другие вопросы.',
      action: draw,
    };
  }
  if (sheet.state === 'ready' && sheet.lines.total > 0) {
    const { left, total } = sheet.lines;
    const verb = left % 10 === 1 && left % 100 !== 11 ? 'осталась' : 'осталось';
    return {
      ...base,
      title: plain(`На шпаргалке ${verb} ${left} ${pluralRu(left, ['строка', 'строки', 'строк'])} из ${total}`),
      text: `Отвечайте дальше: ${ERASE_RULE}.`,
      brief: 'Отвечайте дальше: ответы стирают строки.',
      action: draw,
    };
  }
  return {
    ...base,
    title: plain(`Выучено: ${answers.confirmed} из ${input.total}`),
    text: 'Вопрос выучен, когда вы дважды, в разные дни, ответили на него полно.',
    brief: 'Отвечайте дальше.',
    action: draw,
  };
}
