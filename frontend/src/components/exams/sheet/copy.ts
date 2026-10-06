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
import type { ChangeSummary, LineEvent, LineStatus, SheetBlock, SheetCounts } from '../../../lib/exams/cheatSheet';
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

/** «главных — 21 · пора проверить — 3 · 9 вопросов без пунктов»; empty parts are left out. */
export function counterDetails(counts: SheetCounts): string {
  const parts: string[] = [];
  if (counts.essentialTotal > 0 && counts.essentialTotal !== counts.total) parts.push(`главных${NBSP}— ${counts.essentialLeft}`);
  if (counts.due > 0) parts.push(`пора проверить${NBSP}— ${counts.due}`);
  if (counts.withoutLines > 0) parts.push(`${counts.withoutLines}${NBSP}${questionsWord(counts.withoutLines)} без пунктов`);
  return parts.join(' · ');
}

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
  if (peekedNow) return 'Подсмотрели — сегодня эта строка не сотрётся';
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
): string | null {
  switch (block.kind) {
    case 'gap': {
      // The mapping found the question, but writing its points found nothing to write.
      if (block.coverage !== 'none') return 'В лекциях не нашлось пунктов ответа';
      if (block.coverageReason === REASON_NO_SUPPORT) return 'Нет фрагмента, который подтверждает ответ';
      const lectures = lectureCount > 0 ? `Ни в одной из ${lectureCount}${NBSP}${lecturesGenitive(lectureCount)}` : 'Ни в одной лекции';
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
      return null;
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

type ChangeCounts = Pick<ChangeSummary, 'erased' | 'rubbed' | 'returned' | 'missed'> & Partial<Pick<ChangeSummary, 'due' | 'checked'>>;

/** «2 строки стёрлись, 3 — наполовину, 1 вернулась»: the noun once, after the first number. Null when nothing changed. */
export function changeParts(summary: ChangeCounts): string | null {
  const items: Array<{ count: number; verb: string }> = [];
  const checked = summary.checked ?? 0;
  if (summary.erased > 0) items.push({ count: summary.erased, verb: singular(summary.erased) ? 'стёрлась' : 'стёрлись' });
  if (summary.rubbed > 0) items.push({ count: summary.rubbed, verb: '— наполовину' });
  if (checked > 0) items.push({ count: checked, verb: singular(checked) ? 'прошла проверку' : 'прошли проверку' });
  if (summary.returned > 0) items.push({ count: summary.returned, verb: singular(summary.returned) ? 'вернулась' : 'вернулись' });
  if (summary.missed > 0) items.push({ count: summary.missed, verb: singular(summary.missed) ? 'не прозвучала' : 'не прозвучали' });
  if (items.length === 0) return null;
  return items.map((item, index) => (index === 0 ? `${item.count}${NBSP}${linesWord(item.count)} ${item.verb}` : `${item.count}${NBSP}${item.verb}`)).join(', ');
}

/** «После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.» Null when nothing changed. */
export function changeSentence(summary: ChangeCounts): string | null {
  const parts = changeParts(summary);
  return parts ? `После ответа: ${parts}.` : null;
}

/** The answer's protocol (spec 4.2): «На шпаргалке: 2 строки стёрлись» — or why nothing changed. */
export function protocolSheetLine(summary: ChangeCounts): string {
  const parts = changeParts(summary);
  return parts ? `На шпаргалке: ${parts}` : 'На шпаргалке строки не изменились: стирает только пункт, названный в другой день';
}

/** The price under «Написать шпаргалку». */
export function priceLine(toWrite: number, units: number, left: number | null): string {
  const base = `${toWrite}${NBSP}${questionsWord(toWrite)} — ${units}${NBSP}${unitsWord(units)} ИИ`;
  return left === null ? base : `${base} · сегодня осталось ${left}`;
}

/** The result of one written question when it went wrong, for the block on the sheet. */
export function writeStatusNote(status: WriteStatus): string | null {
  switch (status) {
    case 'unverifiable':
      return 'В лекциях слишком мало текста об этом — пункты не выписать.';
    case 'failed':
      return 'Не удалось написать. Попробуйте ещё раз.';
    case 'busy':
      return 'ИИ сейчас занят — допишем при следующей записи.';
    case 'limit':
      return 'Лимит ИИ на сегодня кончился — допишем после его обновления.';
    case 'auth':
      return 'Сессия истекла — войдите снова и допишите.';
    default:
      return null;
  }
}
