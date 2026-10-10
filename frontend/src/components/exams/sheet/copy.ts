/**
 * The cheat sheet's words (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05, section 8).
 * Rules from the critics: no «завтра» (the 20-hour rule may need a later moment), no «забыли» (a
 * missed point is the protocol's verdict, not a fact about memory), the words of the protocol
 * («только упомянут»), and nothing that claims learning: an erased line proves only that the point
 * was named on two different days.
 */
import { formatDay, formatMappedAt, formatShortDay, formatShortMoment } from '../../../lib/exams/format';
import { pluralRu } from '../../conversation/visuals';
import { lecturesGenitive } from '../sheetModel';
import { localDayOf, POINTS_NOT_WRITTEN, type ChangeSummary, type LineEvent, type LineStatus, type QuietReason, type SheetBlock, type SheetCounts } from '../../../lib/exams/cheatSheet';
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

/**
 * A line's words with no arrow alone at the start of a row: ↑ and ↓ hold on to the word before them, → ⇒ ← to
 * the word after them (a no-break space instead of the space).
 */
export function gluedArrows(text: string): string {
  return text.replace(/[ \t]+([↑↓])/g, `${NBSP}$1`).replace(/([→⇒←])[ \t]+/g, `$1${NBSP}`);
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
 * «главных строк — 28 из 33 · стёрты наполовину — 3 · пора проверить — 1 · у 9 вопросов нет пунктов ответа» (as
 * «43 строки осталось из 47» above it: main lines left of all main lines); empty parts are left out. «Главных — 28
 * из 33» did not say of what, «9 вопросов без пунктов» not of what points (audit of 2026-10-08).
 * Due lines are not «left» (they are erased, waiting for a check), so nothing here says «из них».
 * The questions without answer points are the ones the lectures do not answer or that are not checked against
 * them: the ones that can still be written are counted by «Дописать N вопросов».
 */
export function counterDetails(counts: SheetCounts): string {
  const parts: string[] = [];
  // Each part holds together on one row, and no row starts with «·»: a break falls only after a dot.
  if (counts.essentialTotal > 0 && counts.essentialTotal !== counts.total) {
    parts.push(`главных${NBSP}строк${NBSP}—${NBSP}${counts.essentialLeft}${NBSP}из${NBSP}${counts.essentialTotal}`);
  }
  if (counts.rubbed > 0) parts.push(`стёрты${NBSP}наполовину${NBSP}—${NBSP}${counts.rubbed}`);
  if (counts.due > 0) parts.push(`пора${NBSP}проверить${NBSP}—${NBSP}${counts.due}`);
  const without = counts.gaps + counts.unmapped + counts.unverified;
  if (without > 0) parts.push(`у${NBSP}${without}${NBSP}${questionsGenitive(without)}${NBSP}нет${NBSP}пунктов${NBSP}ответа`);
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

/** Days and moments as a screen reader says them: «6 октября», not «6 окт». */
type Say = { day: (date: string) => string; moment: (iso: string) => string; dot: string };
const WRITTEN: Say = { day, moment, dot: `${NBSP}· ` };
const SPOKEN: Say = { day: (date) => formatDay(date), moment: (iso) => formatMappedAt(iso), dot: ', ' };

/**
 * The local day of an answer in this time zone — the day its history line shows with its time —
 * else the day recorded with it (a note and the history never name two days for one answer).
 */
function dayOf(at: string | null, recorded: string | null): string | null {
  const time = at ? Date.parse(at) : NaN;
  return Number.isFinite(time) ? localDayOf(time) : recorded;
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
 * The small caption under a line, or null: when a point was missed, that a line came back, why a due line is
 * there to check, and that a line uncovered today will not erase today. A line named once has none of its own
 * (its yellow dot says it). `spoken`: the same note for a screen reader (whole month names, commas for the dots).
 */
export function lineNote(status: LineStatus, peekedNow = false, spoken = false): string | null {
  const say = spoken ? SPOKEN : WRITTEN;
  if (peekedNow) return 'подсмотрели — сегодня не сотрётся';
  const last = [...status.history].reverse().find((event) => event.outcome !== 'skipped') ?? null;
  // Uncovered today (a peek or an opened line of the self-test): today's naming will not count.
  if (status.peekedToday && (status.state === 'fresh' || status.state === 'rubbed' || status.state === 'due')) {
    return 'подсмотрели — сегодня не сотрётся';
  }
  const lastDay = last ? dayOf(last.at, last.date) : null;
  switch (status.state) {
    case 'missed':
      return last && lastDay ? `${say.day(lastDay)} ${WORDS[last.word]}` : null;
    case 'returned': {
      // The line was erased; then its point was not named: «пункт» keeps the two subjects apart.
      const erased = dayOf(status.wasErasedAt, status.wasErasedOn);
      return `была стёрта${erased ? ` ${say.day(erased)}` : ''}${say.dot}${last && lastDay ? `${say.day(lastDay)} пункт ${WORDS[last.word]}` : 'пункт не назван'}`;
    }
    case 'due': {
      const erased = dayOf(status.erasedAt, status.erasedOn);
      return erased ? `стёрта ${say.day(erased)}${say.dot}пора проверить` : 'пора проверить';
    }
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
      // The mapping found the question, but its points could not be written: not «нет в лекциях».
      if (block.coverage !== 'none') return POINTS_NOT_WRITTEN;
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
function erasableWhen(erasableFrom: string, now: number, say: Say = WRITTEN): string | null {
  const at = Date.parse(erasableFrom);
  if (!Number.isFinite(at) || at <= now) return null;
  const local = new Date(at);
  if (local.getHours() === 0 && local.getMinutes() === 0) return ` ${say.day(localDayOf(at))} или позже`;
  return ` после ${say.moment(erasableFrom)}`;
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

/**
 * The state of a line the yellow dot or the strike marks (rubbed, due, erased), as a screen reader hears it:
 * whole month names, and when a naming erases it. Null for the lines that are simply there.
 */
export function lineLabel(status: LineStatus, essential: boolean, now: number = Date.now()): string | null {
  // A line is erased; a point is named: «Строка главного пункта стёрта наполовину».
  const line = essential ? 'Строка главного пункта' : 'Строка пункта';
  const erased = dayOf(status.erasedAt, status.erasedOn);
  switch (status.state) {
    case 'rubbed': {
      const when = status.erasableFrom ? erasableWhen(status.erasableFrom, now, SPOKEN) : null;
      const rest = status.erasableFrom ? (when ? `; сотрётся совсем, если назовёте пункт снова${when}` : '; назовёте пункт в ответе снова — сотрётся совсем') : '';
      return `${line} стёрта наполовину${rest}.`;
    }
    case 'erased':
      return `${line} стёрта${erased ? ` ${SPOKEN.day(erased)}` : ''}.`;
    case 'due':
      return `${line} стёрта${erased ? ` ${SPOKEN.day(erased)}` : ''}, пора проверить.`;
    default:
      return null;
  }
}

/**
 * A line for a screen reader, at the level of the eye: every line shows its words now (a line named once in
 * a quieter ink, an erased one struck through), so every line is named by them — speech input says what it
 * sees («цена ↑ → спрос ↓») — and described by the rest. A line that is simply there: main or not, the whole
 * point when the line is its short form, its caption. A line named once, due or erased: main or not and its
 * state (the whole point and the lecture's words stay behind «Подсмотреть» in its details).
 */
export function lineSpeech(
  line: { text: string; title: string; essential: boolean },
  status: LineStatus,
  peeked = false,
  now: number = Date.now(),
): { name: string; description: string | null } {
  const text = line.text.trim();
  const title = line.title.trim();
  const name = text || title;
  const readable = peeked || status.state === 'fresh' || status.state === 'missed' || status.state === 'returned';
  if (!readable) return { name, description: lineLabel(status, line.essential, now) };
  const note = lineNote(status, peeked, true);
  const parts = [line.essential ? 'Главный пункт' : 'Пункт', title && title !== text ? `Полностью: ${title.replace(/[.!?…]+$/u, '')}` : null, note ? note.charAt(0).toUpperCase() + note.slice(1) : null];
  return { name, description: `${parts.filter(Boolean).join('. ')}.` };
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
  // A fresh line the answer did not name: still there, now with its «не назван» caption («не стёрлась», not
  // «осталась», which the counter above already says of every line left).
  if (summary.stayed > 0) add(summary.stayed, singular(summary.stayed) ? 'не стёрлась' : 'не стёрлись');
  return items.length > 0 ? items.join(', ') : null;
}

/** Why the named lines were too soon, in the words of the rule («в другой день») and its 20 hours. */
const TOO_SOON: Record<Extract<QuietReason, { kind: 'wait' }>['why'], string> = {
  day: 'в тот же день',
  hours: 'меньше чем через 20 часов',
  both: 'в тот же день или меньше чем через 20 часов',
};

/**
 * «После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.» — or «После ответа строки не
 * изменились.» `on`: the answer's day when it was not today («После ответа 4 окт.: …»): a replay
 * tells what the answer did then.
 */
export function changeSentence(summary: ChangeSummary, on: string | null = null): string {
  const parts = changeParts(summary);
  const answer = on ? `После ответа ${day(on)}` : 'После ответа';
  return parts ? `${answer}: ${parts}.` : `${answer} строки не изменились.`;
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
  const wait = when ? `${head}: ${erases} совсем, если назовёте ${them}${when}.` : `${head}: назовёте ${them} ещё раз — ${erases} совсем.`;
  return quiet.peek ? `${wait} Подсмотренное сегодня ответ не стирает.` : wait;
}

/** The answer's protocol (spec 4.2): «На шпаргалке: 2 строки стёрлись» — or that nothing changed, and why, briefly. */
export function protocolSheetLine(summary: ChangeSummary, quiet: QuietReason | null = null): string {
  const parts = changeParts(summary);
  if (parts) return `На шпаргалке: ${parts}`;
  const why =
    quiet?.kind === 'wait'
      ? `: названо снова ${TOO_SOON[quiet.why]}${quiet.peek ? ' или после подсматривания' : ''}`
      : quiet?.kind === 'peek'
        ? ': подсмотренное в тот же день не стирается'
        : quiet?.kind === 'erased'
          ? ': названные пункты уже стёрты'
          : '';
  return `На шпаргалке строки не изменились${why}`;
}

/** «вопроса» after «у 1», «у 21»; «вопросов» after «у 3», «у 11». */
function questionsGenitive(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? 'вопроса' : 'вопросов';
}

/**
 * «Сегодня» (Сегодня-lite), above «Тянуть билет из них»: the questions with a line an answer erases now —
 * «Сегодня можно стереть строки шпаргалки у 3 вопросов — назовите их пункты снова.» The lines are the cheat
 * sheet's and the answer erases them: «Можно стереть: 3 вопроса» read as «удалить 3 вопроса» (audit 2026-10-08).
 */
export function erasableLine(count: number): string {
  const them = count === 1 ? 'его' : 'их';
  return `Сегодня можно стереть строки шпаргалки у${NBSP}${count}${NBSP}${questionsGenitive(count)} — назовите ${them} пункты снова.`;
}

/**
 * «Сегодня» when nothing can be erased now: «Следующие строки можно стереть после 9 окт., 15:40.», or
 * «… 9 окт. или позже.» when the moment is a local midnight. Null when no line waits for such a moment
 * (nothing named yet, or only missed lines) or the moment is already past.
 */
export function nextErasableLine(next: string | null, now: number = Date.now()): string | null {
  const when = next ? erasableWhen(next, now) : null;
  return when ? `Следующие строки можно стереть${when}.` : null;
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
      return `${POINTS_NOT_WRITTEN}.`;
    case 'failed':
      return 'Не удалось написать. Попробуйте ещё раз.';
    case 'busy':
      return 'ИИ был занят — вопрос не написан. Допишите его позже.';
    case 'capped':
      return reset ? `Сервер на сегодня исчерпал запись шпаргалок — допишите после ${reset}.` : 'Сервер на сегодня исчерпал запись шпаргалок — допишите позже.';
    case 'limit':
      return reset ? `Дневной лимит ИИ кончился. Дописать можно после ${reset}.` : 'Дневной лимит ИИ кончился. Дописать можно после его обновления.';
    case 'auth':
      return 'Сессия истекла — войдите снова и допишите.';
    default:
      return null;
  }
}
