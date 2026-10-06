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
import type { ChangeSummary, LineEvent, LineStatus, QuietReason, SheetBlock, SheetCounts } from '../../../lib/exams/cheatSheet';
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
  return `${linesWord(total)} ${total % 10 === 1 && total % 100 !== 11 ? 'написана' : 'написано'}`;
}

/**
 * «из них главных — 21 · наполовину — 5 · пора проверить — 3 · 9 вопросов без пунктов»; empty parts
 * are left out. «Без пунктов» are the questions the lectures do not answer or that are not checked
 * against them: the ones that can still be written are counted by «Дописать N вопросов».
 */
export function counterDetails(counts: SheetCounts): string {
  const parts: string[] = [];
  // Each part holds together on one row: a line break falls only between the parts.
  if (counts.essentialTotal > 0 && counts.essentialTotal !== counts.total) parts.push(`из${NBSP}них главных${NBSP}—${NBSP}${counts.essentialLeft}`);
  if (counts.rubbed > 0) parts.push(`наполовину${NBSP}—${NBSP}${counts.rubbed}`);
  if (counts.due > 0) parts.push(`пора${NBSP}проверить${NBSP}—${NBSP}${counts.due}`);
  const without = counts.gaps + counts.unmapped + counts.unverified;
  if (without > 0) parts.push(`${without}${NBSP}${questionsWord(without)} без${NBSP}пунктов`);
  return parts.join(' · ');
}

/** The rule, under the counter: the sheet's promise stays on screen after the first-use tip. */
export const SHEET_RULE = 'Стирают строки только ответы: назвали пункт — наполовину, назвали снова в другой день — совсем.';
export const SHEET_RULE_SHORT = 'Стирают строки только ответы.';

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
  after_question: 'только после вопроса экзаменатора',
  after_peek: 'назван после подсказки — не считается',
};

/** One line of the line's history: «5 окт., 19:40 — назван». */
export function historyLine(event: LineEvent): string {
  return `${moment(event.at)} — ${WORDS[event.word]}`;
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
      return `была стёрта ${status.wasErasedOn ? day(status.wasErasedOn) : ''} · ${last ? `${day(last.date)} ${WORDS[last.word]}` : 'не названа'}`.replace(/\s+·/, ' ·');
    case 'due':
      return status.erasedOn ? `стёрта ${day(status.erasedOn)} · пора проверить` : 'пора проверить';
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
      return parts.length > 0 ? parts.join(' · ') : null;
    }
  }
}

/** The part of a rubbed line's sentence after «Сотрётся, если назовёте снова»: the moment, while it is ahead. */
function erasableWhen(erasableFrom: string, now: number): string | null {
  const at = Date.parse(erasableFrom);
  return Number.isFinite(at) && at > now ? ` после ${moment(erasableFrom)}` : null;
}

/**
 * For a rubbed line: «Сотрётся, если назовёте снова после 7 окт., 15:40.» — or, once that moment has
 * come, «Назовёте в ответе снова — сотрётся.» (no moment that is already past).
 */
export function erasableSentence(status: LineStatus, now: number = Date.now()): string | null {
  if (status.state !== 'rubbed' || !status.erasableFrom) return null;
  const when = erasableWhen(status.erasableFrom, now);
  return when ? `Сотрётся, если назовёте снова${when}.` : 'Назовёте в ответе снова — сотрётся.';
}

/** What the screen reader hears for a line: the words only where the eye can read them too. */
export function lineLabel(text: string, status: LineStatus, essential: boolean, now: number = Date.now()): string {
  const kind = essential ? 'Главный пункт' : 'Пункт';
  switch (status.state) {
    case 'rubbed': {
      const when = status.erasableFrom ? erasableWhen(status.erasableFrom, now) : null;
      const rest = status.erasableFrom ? (when ? `; сотрётся, если назовёте снова${when}` : '; назовёте в ответе снова — сотрётся') : '';
      return `${kind} стёрт наполовину${rest}. Подсмотреть`;
    }
    case 'erased':
      return `${kind} стёрт${status.erasedOn ? ` ${day(status.erasedOn)}` : ''}`;
    case 'due':
      return `${kind} стёрт${status.erasedOn ? ` ${day(status.erasedOn)}` : ''}, пора проверить. Подсмотреть`;
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
  if (summary.stayed > 0) add(summary.stayed, singular(summary.stayed) ? 'осталась' : 'остались');
  return items.length > 0 ? items.join(', ') : null;
}

/** Why nothing changed, after «строки не изменились» (empty without a reason of the answer's own). */
function quietTail(quiet: QuietReason | null, now: number): string {
  if (!quiet) return '';
  if (quiet.kind === 'peek') return ': подсмотренная строка в тот же день не стирается';
  if (quiet.kind === 'erased') return ': названные пункты уже стёрты';
  const when = erasableWhen(quiet.from, now);
  return `: названное сотрётся, если назовёте его снова${when ?? ''}`;
}

/**
 * After a change: the lines the answer named and left as they were, and why — named again too soon
 * (the rule says «в другой день», and the moment says when), or uncovered the same day. Empty when
 * there are none.
 */
function alsoTail(quiet: QuietReason | null, now: number): string {
  if (quiet?.kind === 'peek') return ' Подсмотренное сегодня ответ не стирает.';
  if (quiet?.kind !== 'wait' || quiet.count < 1) return '';
  const one = quiet.count % 10 === 1 && quiet.count % 100 !== 11;
  const head = `${quiet.count}${NBSP}${linesWord(quiet.count)} ${one ? 'названа' : 'названы'} снова слишком рано`;
  const erases = one ? 'сотрётся' : 'сотрутся';
  const them = one ? 'её' : 'их';
  const when = erasableWhen(quiet.from, now);
  return when ? ` ${head}: ${erases} совсем, если назвать ${them}${when}.` : ` ${head}: назовёте ${them} ещё раз — ${erases} совсем.`;
}

/**
 * «После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.» — or that nothing changed, and why;
 * after a change, the named lines that stayed as they were, and why.
 */
export function changeSentence(summary: ChangeSummary, quiet: QuietReason | null = null, now: number = Date.now()): string {
  const parts = changeParts(summary);
  return parts ? `После ответа: ${parts}.${alsoTail(quiet, now)}` : `После ответа строки не изменились${quietTail(quiet, now)}.`;
}

/** The answer's protocol (spec 4.2): «На шпаргалке: 2 строки стёрлись» — or that nothing changed, and why. */
export function protocolSheetLine(summary: ChangeSummary, quiet: QuietReason | null = null, now: number = Date.now()): string {
  const parts = changeParts(summary);
  return parts ? `На шпаргалке: ${parts}` : `На шпаргалке строки не изменились${quietTail(quiet, now)}`;
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
      return reset ? `Лимит ИИ на сегодня кончился. Дописать можно после ${reset}.` : 'Лимит ИИ на сегодня кончился. Дописать можно после его обновления.';
    case 'auth':
      return 'Сессия истекла — войдите снова и допишите.';
    default:
      return null;
  }
}
