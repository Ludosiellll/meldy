/**
 * The cheat sheet's words (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05, section 8).
 * Rules from the critics: no «завтра» (the 20-hour rule may need a later moment), no «забыли» (a
 * missed point is the protocol's verdict, not a fact about memory), the words of the protocol
 * («только упомянут»), and nothing that claims learning: an erased line proves only that the point
 * was named on two different days.
 */
import { formatShortDay, formatShortMoment } from '../../../lib/exams/format';
import { pluralRu } from '../../conversation/visuals';
import { lecturesGenitive } from '../sheetModel';
import { localDayOf, type ChangeSummary, type LineEvent, type LineStatus, type QuietReason, type SheetBlock, type SheetCounts } from '../../../lib/exams/cheatSheet';
import type { WriteStatus } from '../../../api/cheatSheet';

const NBSP = ' ';

export function linesWord(count: number): string {
  return pluralRu(count, ['строка', 'строки', 'строк']);
}

export function questionsWord(count: number): string {
  return pluralRu(count, ['вопрос', 'вопроса', 'вопросов']);
}

export function unitsWord(count: number): string {
  return pluralRu(count, ['единица', 'единицы', 'единиц']);
}

/** «строк осталось из 47» under the big number. */
export function counterLabel(counts: Pick<SheetCounts, 'left' | 'total'>): string {
  const verb = counts.left % 10 === 1 && counts.left % 100 !== 11 ? 'осталась' : 'осталось';
  return `${linesWord(counts.left)} ${verb} из${NBSP}${counts.total}`;
}

/** While the first lines are being written: «строк написано» under their number (not «6 из 6 осталось»). */
export function writtenLabel(total: number): string {
  return `${linesWord(total)} ${pluralRu(total, ['написана', 'написаны', 'написано'])}`;
}

/**
 * «главных — 28 из 33 · стёрты наполовину — 3 · пора проверить — 1 · 9 вопросов без пунктов» (as «43
 * строки осталось из 47» above it: main lines left of all main lines); empty parts are left out.
 * Due lines are not «left» (they are erased, waiting for a check), so nothing here says «из них».
 * «Без пунктов» are the questions the lectures do not answer or that are not checked against them:
 * the ones that can still be written are counted by «Дописать N вопросов».
 */
export function counterDetails(counts: SheetCounts): string {
  const parts: string[] = [];
  // Each part holds together on one row, and no row starts with «·»: a break falls only after a dot.
  if (counts.essentialTotal > 0 && counts.essentialTotal !== counts.total) {
    parts.push(`главных${NBSP}—${NBSP}${counts.essentialLeft}${NBSP}из${NBSP}${counts.essentialTotal}`);
  }
  if (counts.rubbed > 0) parts.push(`стёрты${NBSP}наполовину${NBSP}—${NBSP}${counts.rubbed}`);
  if (counts.due > 0) parts.push(`пора${NBSP}проверить${NBSP}—${NBSP}${counts.due}`);
  const without = counts.gaps + counts.unmapped + counts.unverified;
  if (without > 0) parts.push(`${without}${NBSP}${questionsWord(without)} без${NBSP}пунктов`);
  return parts.join(`${NBSP}· `);
}

/** The rule, under the counter on every size: the sheet's promise stays on screen after the first-use tip. */
export const SHEET_RULE = 'Строки стирают только ответы: назвали пункт — наполовину, назвали снова в другой день — совсем.';

function day(date: string): string {
  return formatShortDay(date).replace(/ /g, NBSP);
}

function moment(iso: string): string {
  return formatShortMoment(iso).replace(/ (?=\S+,)/, NBSP);
}

const WORDS: Record<LineEvent['word'], string> = {
  named: 'назван',
  mentioned: 'только упомянут',
  wrong: 'назван с ошибкой',
  missing: 'не назван',
  after_question: 'назван только после вопроса экзаменатора',
  after_peek: 'назван после подсматривания, не в счёт',
};

/** One line of the line's history: «5 окт., 19:40 — назван» («—» never starts a row). */
export function historyLine(event: LineEvent): string {
  return `${moment(event.at)}${NBSP}— ${WORDS[event.word]}`;
}

/**
 * The pencil note under a line (Onest, graphite), or null. Only readable lines carry one: the
 * words of a rubbed line would give it away. Due lines say why they show through.
 */
export function lineNote(status: LineStatus, peekedNow = false): string | null {
  if (peekedNow) return 'подсмотрели — сегодня не сотрётся';
  const last = [...status.history].reverse().find((event) => event.outcome !== 'skipped') ?? null;
  // Uncovered today (a peek or an opened line of the self-test): today's naming will not count.
  if (status.peekedToday && (status.state === 'fresh' || status.state === 'rubbed' || status.state === 'due')) {
    return 'подсмотрели — сегодня не сотрётся';
  }
  switch (status.state) {
    case 'missed':
      return last ? `${day(last.date)} ${WORDS[last.word]}` : null;
    case 'returned':
      // The line was erased; then its point was not named: «пункт» keeps the two subjects apart.
      return `была стёрта${status.wasErasedOn ? ` ${day(status.wasErasedOn)}` : ''}${NBSP}· ${last ? `${day(last.date)} пункт ${WORDS[last.word]}` : 'пункт не назван'}`;
    case 'due':
      return status.erasedOn ? `стёрта ${day(status.erasedOn)}${NBSP}· пора проверить` : 'пора проверить';
    default:
      return null;
  }
}

const REASON_NO_OVERLAP = 'Ни одного фрагмента с этими словами';
const REASON_NO_SUPPORT = 'Нет подтверждающего фрагмента';

/**
 * The note Meldy prints under a question (spec 2.1), in the words of «Вопросы» (WhyPanel), or null.
 * An unwritten question has none of its own: the column says the sheet is not written, and the
 * page adds what went wrong when a write failed.
 */
export function blockNote(
  block: Pick<SheetBlock, 'kind' | 'coverage' | 'coverageMethod' | 'coverageReason' | 'missing' | 'partial'>,
  lectureCount: number,
  options: { anyWritten?: boolean } = {},
): string | null {
  switch (block.kind) {
    case 'gap': {
      // The mapping found the question, but writing its points found nothing to write.
      if (block.coverage !== 'none') return 'В лекциях не нашлось пунктов ответа';
      if (block.coverageReason === REASON_NO_SUPPORT) return 'Нет фрагмента, который подтверждает ответ';
      const lectures =
        lectureCount === 1 ? 'В лекции' : lectureCount > 1 ? `Ни в одной из ${lectureCount}${NBSP}${lecturesGenitive(lectureCount)}` : 'Ни в одной лекции';
      if (block.coverageReason === REASON_NO_OVERLAP) return `${lectures} нет фрагмента с этими словами`;
      return `${lectures} нет фрагмента об этом`;
    }
    case 'unmapped':
      return 'Вопрос ещё не сверен с лекциями';
    case 'unverified':
      return 'Проверено только по словам — сверьте ещё раз';
    case 'rebuilt':
      return 'Пункты пересобраны — строки надо написать заново';
    case 'unwritten':
      // Nothing under a question would read as «all erased»: say it is not written yet — once some of
      // the sheet is (before that the column says the whole sheet is not written).
      return options.anyWritten ? 'Ещё не написано' : null;
    case 'lines':
    default: {
      const parts: string[] = [];
      if (block.partial) parts.push(block.missing ? `Не хватает: ${block.missing}` : 'В лекциях не всё');
      if (block.coverageMethod === 'manual') parts.push('Отмечено вами — Meldy этого не проверял');
      return parts.length > 0 ? parts.join(`${NBSP}· `) : null;
    }
  }
}

/**
 * When a naming erases a rubbed line, while that moment is ahead: « после 7 окт., 15:40», or « 8 окт.
 * или позже» when the moment is a local midnight (a day boundary, not a time anyone picked).
 */
function erasableWhen(erasableFrom: string, now: number): string | null {
  const at = Date.parse(erasableFrom);
  if (!Number.isFinite(at) || at <= now) return null;
  const local = new Date(at);
  if (local.getHours() === 0 && local.getMinutes() === 0) return ` ${day(localDayOf(at))} или позже`;
  return ` после ${moment(erasableFrom)}`;
}

/**
 * For a rubbed line: «Сотрётся совсем, если назовёте пункт снова после 7 окт., 15:40.» — or, once that
 * moment has come, «Назовёте пункт в ответе снова — сотрётся совсем.» (no moment that is already past).
 */
export function erasableSentence(status: LineStatus, now: number = Date.now()): string | null {
  if (status.state !== 'rubbed' || !status.erasableFrom) return null;
  const when = erasableWhen(status.erasableFrom, now);
  return when ? `Сотрётся совсем, если назовёте пункт снова${when}.` : 'Назовёте пункт в ответе снова — сотрётся совсем.';
}

/** What the screen reader hears for a line: the words only where the eye can read them too. */
export function lineLabel(text: string, status: LineStatus, essential: boolean, now: number = Date.now()): string {
  const kind = essential ? 'Главный пункт' : 'Пункт';
  // A line is erased; a point is named: «Строка главного пункта стёрта наполовину».
  const line = essential ? 'Строка главного пункта' : 'Строка пункта';
  switch (status.state) {
    case 'rubbed': {
      const when = status.erasableFrom ? erasableWhen(status.erasableFrom, now) : null;
      const rest = status.erasableFrom ? (when ? `; сотрётся совсем, если назовёте пункт снова${when}` : '; назовёте пункт в ответе снова — сотрётся совсем') : '';
      return `${line} стёрта наполовину${rest}. Подсмотреть`;
    }
    case 'erased':
      return `${line} стёрта${status.erasedOn ? ` ${day(status.erasedOn)}` : ''}`;
    case 'due':
      return `${line} стёрта${status.erasedOn ? ` ${day(status.erasedOn)}` : ''}, пора проверить. Подсмотреть`;
    case 'missed':
    case 'returned':
      return `${kind}: ${text}. ${lineNote(status) ?? ''}`.trim();
    default:
      return `${kind}: ${text}`;
  }
}

function singular(count: number): boolean {
  return count % 10 === 1 && count % 100 !== 11;
}

/**
 * «2 строки стёрлись, 3 — наполовину, 1 вернулась, 2 остались»: the noun once, after the first number;
 * «— наполовину» only right after «стёрлись», else «стёрлись наполовину». Null when nothing changed.
 */
export function changeParts(summary: ChangeSummary): string | null {
  const items: string[] = [];
  const add = (count: number, words: string) => items.push(items.length === 0 ? `${count}${NBSP}${linesWord(count)} ${words}` : `${count}${NBSP}${words}`);
  if (summary.erased > 0) add(summary.erased, singular(summary.erased) ? 'стёрлась' : 'стёрлись');
  if (summary.rubbed > 0) {
    if (summary.erased > 0) items.push(`${summary.rubbed}${NBSP}—${NBSP}наполовину`);
    else add(summary.rubbed, singular(summary.rubbed) ? 'стёрлась наполовину' : 'стёрлись наполовину');
  }
  if (summary.checked > 0) add(summary.checked, singular(summary.checked) ? 'прошла проверку' : 'прошли проверку');
  if (summary.returned > 0) add(summary.returned, singular(summary.returned) ? 'вернулась' : 'вернулись');
  // A fresh line the answer did not name: still there, now with a wave («не стёрлась», not «осталась»,
  // which the counter above already says of every line left).
  if (summary.stayed > 0) add(summary.stayed, singular(summary.stayed) ? 'не стёрлась' : 'не стёрлись');
  return items.length > 0 ? items.join(', ') : null;
}

/** Why the named lines were too soon, in the words of the rule («в другой день») and its 20 hours. */
const TOO_SOON: Record<Extract<QuietReason, { kind: 'wait' }>['why'], string> = {
  day: 'в тот же день',
  hours: 'меньше чем через 20 часов',
  both: 'в тот же день или меньше чем через 20 часов',
};

/** «После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.» — or «После ответа строки не изменились.» */
export function changeSentence(summary: ChangeSummary): string {
  const parts = changeParts(summary);
  return parts ? `После ответа: ${parts}.` : 'После ответа строки не изменились.';
}

/**
 * Under that sentence, smaller: the lines the answer named and left as they were, and why — named
 * again too soon («1 строка названа снова меньше чем через 20 часов: сотрётся совсем, если назовёте
 * её после 7 окт., 14:05.»), uncovered the same day, or (when nothing changed) already erased. Null
 * when there is nothing to explain.
 */
export function changeNote(summary: ChangeSummary, quiet: QuietReason | null, now: number = Date.now()): string | null {
  if (!quiet) return null;
  if (quiet.kind === 'peek') return 'Подсмотренное сегодня ответ не стирает.';
  if (quiet.kind === 'erased') return changeParts(summary) ? null : 'Названные пункты уже стёрты.';
  if (quiet.count < 1) return null;
  const one = singular(quiet.count);
  const head = `${quiet.count}${NBSP}${linesWord(quiet.count)} ${one ? 'названа' : 'названы'} снова ${TOO_SOON[quiet.why]}`;
  const erases = one ? 'сотрётся' : 'сотрутся';
  const them = one ? 'её' : 'их';
  const when = erasableWhen(quiet.from, now);
  return when ? `${head}: ${erases} совсем, если назовёте ${them}${when}.` : `${head}: назовёте ${them} ещё раз — ${erases} совсем.`;
}

/** The answer's protocol (spec 4.2): «На шпаргалке: 2 строки стёрлись» — or that nothing changed, and why, briefly. */
export function protocolSheetLine(summary: ChangeSummary, quiet: QuietReason | null = null): string {
  const parts = changeParts(summary);
  if (parts) return `На шпаргалке: ${parts}`;
  const why =
    quiet?.kind === 'wait'
      ? `: названо снова ${TOO_SOON[quiet.why]}`
      : quiet?.kind === 'peek'
        ? ': подсмотренное в тот же день не стирается'
        : quiet?.kind === 'erased'
          ? ': названные пункты уже стёрты'
          : '';
  return `На шпаргалке строки не изменились${why}`;
}

/** The price under «Написать шпаргалку». */
export function priceLine(toWrite: number, units: number, left: number | null): string {
  const base = `${toWrite}${NBSP}${questionsWord(toWrite)} — ${units}${NBSP}${unitsWord(units)} ИИ`;
  return left === null ? base : `${base} · сегодня осталось ${left}`;
}

/**
 * The result of one written question when it went wrong, for the block on the sheet. Nothing is
 * written again by itself: the words say what the student can do. `reset` — «3:00», when the limit
 * renews.
 */
export function writeStatusNote(status: WriteStatus, reset: string | null = null): string | null {
  switch (status) {
    case 'unverifiable':
      return 'В лекциях слишком мало текста об этом — пункты не выписать.';
    case 'failed':
      return 'Не удалось написать. Попробуйте ещё раз.';
    case 'busy':
      return 'ИИ был занят — вопрос не написан. Допишите его позже.';
    case 'limit':
      return reset ? `Дневной лимит ИИ кончился. Дописать можно после ${reset}.` : 'Дневной лимит ИИ кончился. Дописать можно после его обновления.';
    case 'auth':
      return 'Сессия истекла — войдите снова и допишите.';
    default:
      return null;
  }
}
