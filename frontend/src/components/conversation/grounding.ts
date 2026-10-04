import type { ChartVisual, ConversationSource, TimelineVisual } from './types';
import { splitFragmentHeading } from '../../utils/fragmentText';

/**
 * Какие фрагменты исходника действительно содержат числа графика или даты
 * хронологии. Та же проверка, что у сервера (backend/utils.py: SourceFacts),
 * повторена здесь, чтобы подпись «фрагмент 3» была правдой и для старых
 * разговоров, и для source_ids, подобранных по словам.
 */

// Число исходника: цифры, группы тысяч через пробел («12 500»), дробная часть
// («12,5»). Минус считается знаком, только если стоит отдельно («−40», «до -5»),
// а не внутри диапазона «1941-1945».
const SOURCE_NUMBER = /[-−–]?\d+(?:[^\S\r\n\t]\d{3}(?!\d))*(?:[.,]\d+)*/gu;
/** Перед знаком минус стоит слово, число или скобка: это диапазон («1941-1945»), а не знак. */
const GLUED_BEFORE_SIGN = /[\p{L}\p{N}_.,)\]]/u;
const SIGNS = /^[-−–]/;
const GROUP_SPACE = /[^\S\r\n\t]/;

/** Значения одного числа без пробелов: разделитель групп — только перед тремя цифрами. */
function plainReadings(compact: string): number[] {
  const groups = compact.split(/[.,]/);
  const texts: string[] = [];
  if (groups.length === 1) texts.push(compact);
  else if (groups[0]) {
    if (groups.slice(1).every(group => group.length === 3)) texts.push(groups.join(''));
    if (groups[groups.length - 1] && groups.slice(1, -1).every(group => group.length === 3)) {
      texts.push(`${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`);
    }
  }
  return texts.map(Number).filter(Number.isFinite);
}

/** Все правдоподобные значения числа из исходника (см. _number_readings на сервере). */
export function numberReadings(token: string): number[] {
  const negative = SIGNS.test(token);
  let pieces = token.replace(SIGNS, '').split(GROUP_SPACE);
  const readings: number[] = [];
  const add = (values: number[], signed: boolean) => values.forEach(value => readings.push(signed && negative ? -value : value));
  let signed = true;
  while (pieces.length > 1 && pieces[0].length > 3) {
    add(plainReadings(pieces[0]), signed);
    signed = false;
    pieces = pieces.slice(1);
  }
  add(plainReadings(pieces.join('')), signed);
  if (pieces.length >= 3) pieces.forEach((piece, index) => add(plainReadings(piece), signed && index === 0));
  return readings;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class SourceFacts {
  private readonly numbers: number[];
  private readonly normalized: string;

  constructor(text: string) {
    this.numbers = [...text.matchAll(SOURCE_NUMBER)].flatMap(match => {
      const index = match.index ?? 0;
      const glued = SIGNS.test(match[0]) && index > 0 && GLUED_BEFORE_SIGN.test(text[index - 1]);
      return numberReadings(glued ? match[0].slice(1) : match[0]);
    });
    this.normalized = normalize(text);
  }

  hasNumber(value: number): boolean {
    return this.numbers.some(number => Math.abs(value - number) <= 1e-9 * Math.max(1, Math.abs(number)));
  }

  hasDate(date: string): boolean {
    const normalized = normalize(date);
    // Дата стоит с начала слова и не продолжается цифрами: «85» не находится в «1885».
    if (normalized && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(normalized)}(?!\\d)`, 'u').test(this.normalized)) return true;
    const digits = date.match(/\d+/g) ?? [];
    return digits.length > 0 && digits.every(part => part.length >= 3 && this.hasNumber(Number(part)));
  }
}

/**
 * Фрагменты, где есть все значения: сначала те из ids реплики, что их содержат,
 * иначе первый фрагмент со всеми значениями, иначе наименьший набор (до трёх),
 * покрывающий их вместе. [] — если исходника нет или значения не нашлись.
 */
function coveringIds(checks: ((facts: SourceFacts) => boolean)[], ids: string[], sources: ConversationSource[] | null | undefined): string[] {
  if (!checks.length || !sources?.length) return [];
  const everything = checks.length;
  const covers = new Map<string, Set<number>>();
  const order: string[] = [];
  for (const source of sources) {
    if (!source || typeof source.id !== 'string' || typeof source.text !== 'string') continue;
    const id = source.id.trim().toUpperCase();
    const facts = new SourceFacts(source.text);
    const covered = new Set(checks.flatMap((check, index) => (check(facts) ? [index] : [])));
    if (covered.size) {
      covers.set(id, covered);
      order.push(id);
    }
  }
  const own = ids.map(id => id.toUpperCase()).filter(id => covers.has(id));
  for (const id of [...own, ...order]) {
    if ((covers.get(id) as Set<number>).size === everything) return [id];
  }
  const chosen: string[] = [];
  const done = new Set<number>();
  while (done.size < everything && chosen.length < 3) {
    let best: string | null = null;
    let gain = 0;
    for (const id of [...own, ...order]) {
      const fresh = [...(covers.get(id) as Set<number>)].filter(index => !done.has(index)).length;
      if (fresh > gain) {
        best = id;
        gain = fresh;
      }
    }
    if (!best) break;
    chosen.push(best);
    (covers.get(best) as Set<number>).forEach(index => done.add(index));
  }
  if (done.size < everything) return [];
  return chosen.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export function chartSourceIds(visual: ChartVisual, ids: string[], sources: ConversationSource[] | null | undefined): string[] {
  return coveringIds(
    visual.data.map(point => (facts: SourceFacts) => facts.hasNumber(point.value)),
    ids,
    sources,
  );
}

export function timelineSourceIds(visual: TimelineVisual, ids: string[], sources: ConversationSource[] | null | undefined): string[] {
  return coveringIds(
    visual.events.map(event => (facts: SourceFacts) => facts.hasDate(event.date)),
    ids,
    sources,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Показ цитат (только отрисовка: что сохранено, не меняется)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Текст фрагмента по id (S03, s03, « S03 »), или null, если его нет. */
export function fragmentText(sources: ConversationSource[] | null | undefined, id: string): string | null {
  const wanted = id.trim().toUpperCase();
  const match = (sources ?? []).find(source => source && typeof source.id === 'string' && source.id.trim().toUpperCase() === wanted);
  return match && typeof match.text === 'string' && match.text.trim() ? match.text.trim() : null;
}

/**
 * Заголовок лекции в сверенной цитате — отдельной строкой (записка жюри, п. 12).
 *
 * Перевод строки после заголовка теряется ещё до показа: sanitizeVisual склеивает пробелы
 * («Обучение нейронной сети Обучение сети заключается…»). Поэтому заголовок ищем в самом
 * фрагменте, откуда взята цитата: если фрагмент начинается с заголовка, а сохранённый текст
 * цитаты — с того же заголовка и пробела, заголовок встаёт своей строкой, остальное — под
 * ним (обрезка «…» остаётся как есть). Иначе null, и цитата показывается как прежде.
 */
export function quoteHeading(text: string, fragment: string | null | undefined): { heading: string; rest: string } | null {
  if (!fragment) return null;
  const { heading } = splitFragmentHeading(fragment);
  if (!heading || !text.startsWith(`${heading} `)) return null;
  const rest = text.slice(heading.length + 1).trim();
  return rest ? { heading, rest } : null;
}
