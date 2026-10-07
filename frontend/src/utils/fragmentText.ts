/**
 * Заголовок фрагмента лекции отдельной строкой.
 *
 * Фрагменты лекции (source_chunks, вырезки листа, цитаты «Разговора») часто начинаются
 * с заголовка раздела на своей строке: «Обучение нейронной сети\nОбучение сети заключается…».
 * Если склеить строки через пробел, заголовок сливается с первым предложением и читается
 * как его начало. splitFragmentHeading отделяет такую первую строку, а остальной текст
 * собирает в одну строку.
 *
 * Правило повторяет backend oral._looks_like_heading (короткая строка без точки или «…»
 * в конце) и добавляет защиту от двух ложных случаев:
 * - жёсткий перенос строки из PDF: «…составил\n7 % при…», «…в подборе\nвесов…»;
 * - окно вырезки, начатое посреди текста (exams_map._excerpt_window): «…динамику ставки\nЦБ…».
 *
 * Первая непустая строка — заголовок, только если одновременно:
 * 1) за ней есть ещё непустая строка;
 * 2) в ней 2–120 знаков и не больше 14 слов;
 * 3) она начинается с заглавной буквы, цифры или «;
 * 4) она не кончается (после закрывающих кавычек и скобок) на . … ! ? : ; , или тире;
 * 5) следующая строка начинается с заглавной буквы, цифры или «;
 * 6) она не длиннее 60 % следующей строки — кроме строк с номером раздела («1.2.», «3)»).
 * body — остальные строки (или все, если заголовка нет) через один пробел.
 */

export interface FragmentParts {
  heading: string | null;
  body: string;
}

const HEADING_MIN_CHARS = 2;
const HEADING_MAX_CHARS = 120;
const HEADING_MAX_WORDS = 14;
const HEADING_MAX_RATIO = 0.6;

/** Строка начинается с заглавной буквы, цифры или открывающей «ёлочки». */
const STARTS_LIKE_SENTENCE = /^[\p{Lu}\p{Nd}«]/u;
/** Закрывающие кавычки и скобки, которые не мешают увидеть знак в конце строки. */
const TRAILING_CLOSERS = /[\s»"'”’)\]]+$/u;
/** Знаки, после которых строка — продолжение текста, а не заголовок (включая тире). */
const ENDS_LIKE_SENTENCE = /[.…!?:;,\-‐‑‒–—―]$/u;
/** Номер раздела в начале строки: «1.», «1.2.», «1.2.3.», «3)», «2.1)». Годы («2023.») не подходят. */
const SECTION_NUMBER = /^\d{1,3}(?:\.\d{1,3})*[.)](?=\s)/u;

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function wordCount(line: string): number {
  return line.split(/\s+/u).filter(Boolean).length;
}

function looksLikeHeading(line: string, next: string): boolean {
  const length = line.length;
  if (length < HEADING_MIN_CHARS || length > HEADING_MAX_CHARS) return false;
  if (wordCount(line) > HEADING_MAX_WORDS) return false;
  if (!STARTS_LIKE_SENTENCE.test(line)) return false;
  if (ENDS_LIKE_SENTENCE.test(line.replace(TRAILING_CLOSERS, ''))) return false;
  if (!STARTS_LIKE_SENTENCE.test(next)) return false;
  if (!SECTION_NUMBER.test(line) && length > HEADING_MAX_RATIO * next.length) return false;
  return true;
}

export function splitFragmentHeading(text: string): { heading: string | null; body: string } {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => collapse(line));
  const firstIndex = lines.findIndex((line) => line.length > 0);
  if (firstIndex < 0) return { heading: null, body: '' };
  const rest = lines.slice(firstIndex + 1).filter((line) => line.length > 0);
  const first = lines[firstIndex];
  if (rest.length > 0 && looksLikeHeading(first, rest[0])) {
    return { heading: first, body: collapse(rest.join(' ')) };
  }
  return { heading: null, body: collapse([first, ...rest].join(' ')) };
}

// ── Фрагмент для показа: строки таблиц, место ответа и окно вокруг него ─────────────────────

/** Промежуток [начало, конец) в единицах UTF-16 строки, как у slice. */
export type Span = readonly [number, number];

export interface FragmentView {
  /** Заголовок раздела отдельной строкой, как у splitFragmentHeading. */
  heading: string | null;
  /** Остальной текст одной строкой; строки таблиц — «ячейка — ячейка; …». */
  body: string;
  /** Место проверенной цитаты (evidence[].focus сервера) в заголовке и в тексте; null — не задето. */
  headingFocus: Span | null;
  bodyFocus: Span | null;
}

/**
 * evidence[].focus сервера (exams_map) — кодовые точки Unicode текста, как он хранится (счёт Python), а
 * строка браузера — UTF-16: «𝑥» там одна точка, здесь два знака. Негодный focus (не два целых, начало не
 * меньше конца, за пределами текста) — null: показ как без него.
 */
export function codePointSpan(text: string, focus: unknown): Span | null {
  if (!Array.isArray(focus) || focus.length !== 2) return null;
  const [start, end] = focus as unknown[];
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start) return null;
  let point = 0;
  let from = -1;
  for (let unit = 0; ; ) {
    if (point === start) from = unit;
    if (point === end) return from >= 0 ? [from, unit] : null;
    if (unit >= text.length) return null;
    unit += (text.codePointAt(unit) ?? 0) > 0xffff ? 2 : 1;
    point += 1;
  }
}

/** Знак показа и место в исходном тексте, откуда он (вставленный знак — место того, что он заменил). */
interface Atom {
  ch: string;
  at: number;
}

const SPACE_CHAR = /\s/u;
/** Строка таблицы DOCX или PPTX: ячейки через « | » (backend parser._table_rows, utils._table_row). */
const TABLE_CELL_SEPARATOR = ' | ';
const SENTENCE_LIKE_START = /^[\p{Lu}\p{Nd}«"„“(]/u;
const ENDS_WITH_STOP = /[.!?…:;,]$/u;

function atomsOf(text: string, from: number, to: number): Atom[] {
  const atoms: Atom[] = [];
  for (let index = from; index < to; index += 1) atoms.push({ ch: text[index], at: index });
  return atoms;
}

function inserted(text: string, at: number): Atom[] {
  return Array.from(text, (ch) => ({ ch, at }));
}

/** Пробелы и переносы — один пробел, по краям — ничего (как collapse выше). */
function collapseAtoms(atoms: Atom[]): Atom[] {
  const out: Atom[] = [];
  let gap: Atom | null = null;
  for (const atom of atoms) {
    if (SPACE_CHAR.test(atom.ch)) {
      if (out.length > 0 && gap === null) gap = { ch: ' ', at: atom.at };
      continue;
    }
    if (gap) out.push(gap);
    gap = null;
    out.push(atom);
  }
  return out;
}

/** «Уровень изоляции | «Грязное» чтение | …» → «Уровень изоляции — «Грязное» чтение — …»; висящая «|» обрезанного фрагмента пропадает. */
function tableRowAtoms(atoms: Atom[]): Atom[] {
  const cells: Atom[][] = [[]];
  const pipes: number[] = [];
  for (const atom of atoms) {
    if (atom.ch === '|') {
      pipes.push(atom.at);
      cells.push([]);
    } else {
      cells[cells.length - 1].push(atom);
    }
  }
  const out: Atom[] = [];
  cells.forEach((cell, index) => {
    const content = collapseAtoms(cell);
    if (content.length === 0) return;
    if (out.length > 0) out.push(...inserted(' — ', pipes[index - 1]));
    out.push(...content);
  });
  return out;
}

interface Line {
  start: number;
  end: number;
  table: boolean;
}

function filledLines(text: string): Line[] {
  const lines: Line[] = [];
  for (let from = 0; from <= text.length; ) {
    const newline = text.indexOf('\n', from);
    const end = newline < 0 ? text.length : newline;
    const raw = text.slice(from, end);
    if (raw.trim() !== '') lines.push({ start: from, end, table: raw.includes(TABLE_CELL_SEPARATOR) });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}

function lineAtoms(text: string, line: Line): Atom[] {
  const atoms = atomsOf(text, line.start, line.end);
  return line.table ? tableRowAtoms(atoms) : collapseAtoms(atoms);
}

/**
 * Строки одной строкой. Строки таблицы подряд — через «; »; после последней, если дальше идёт текст, — «. »
 * (или «; », если текст начинается не как предложение): иначе «нет — нет — нет Ни на одном уровне…».
 */
function joinedAtoms(text: string, lines: Line[]): Atom[] {
  const out: Atom[] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    const atoms = lineAtoms(text, line);
    if (atoms.length === 0) continue;
    if (previous !== null && out.length > 0) {
      let joint = ' ';
      if (previous.table && !ENDS_WITH_STOP.test(out[out.length - 1].ch)) {
        joint = line.table || !SENTENCE_LIKE_START.test(atoms[0].ch) ? '; ' : '. ';
      }
      out.push(...inserted(joint, line.start - 1));
    }
    out.push(...atoms);
    previous = line;
  }
  return out;
}

const OPENERS: Record<string, string> = { '«': '»', '(': ')', '„': '“', '“': '”' };

/** Знаки, где хоть один знак — из исходного промежутка [from, to); края без пробелов, кавычки цитаты — парами. */
function spanOf(atoms: Atom[], [from, to]: Span): Span | null {
  let first = atoms.findIndex((atom) => atom.at >= from && atom.at < to);
  if (first < 0) return null;
  let last = first;
  for (let index = first; index < atoms.length; index += 1) if (atoms[index].at >= from && atoms[index].at < to) last = index;
  while (first <= last && atoms[first].ch === ' ') first += 1;
  while (last >= first && atoms[last].ch === ' ') last -= 1;
  if (first > last) return null;
  let end = last + 1;
  const inside = atoms.slice(first, end).map((atom) => atom.ch);
  for (const [open, close] of Object.entries(OPENERS)) {
    const unclosed = inside.filter((ch) => ch === open).length - inside.filter((ch) => ch === close).length;
    if (unclosed > 0 && atoms[end]?.ch === close) end += 1;
    if (unclosed < 0 && atoms[first - 1]?.ch === open) first -= 1;
  }
  return [first, end];
}

const text = (atoms: Atom[]) => atoms.map((atom) => atom.ch).join('');

/**
 * Фрагмент лекции для показа: заголовок раздела отдельной строкой (как splitFragmentHeading), остальное одной
 * строкой, строки таблицы — «ячейка — ячейка; …» (в базе текст не меняется), и где в этом место проверенной
 * цитаты: focus — evidence[].focus сервера (кодовые точки исходного текста).
 */
export function fragmentView(source: string, focus?: unknown): FragmentView {
  const value = String(source ?? '');
  const lines = filledLines(value);
  const headed = splitFragmentHeading(value).heading !== null && lines.length > 1;
  const headingAtoms = headed ? lineAtoms(value, lines[0]) : [];
  const bodyAtoms = joinedAtoms(value, headed ? lines.slice(1) : lines);
  const span = codePointSpan(value, focus);
  const heading = headed && headingAtoms.length > 0 ? text(headingAtoms) : null;
  return {
    heading,
    body: text(bodyAtoms),
    headingFocus: span && heading !== null ? spanOf(headingAtoms, span) : null,
    bodyFocus: span ? spanOf(bodyAtoms, span) : null,
  };
}

/** Строки таблиц в цитате для показа (протокол ответа): «ячейка — ячейка; …». Текст без таблиц — как есть. */
export function readableTableText(source: string): string {
  const value = String(source ?? '');
  if (!value.includes(TABLE_CELL_SEPARATOR)) return value;
  return text(joinedAtoms(value, filledLines(value)));
}

/** Конец предложения: знак, закрывающие кавычки и скобки, пробел, дальше — как начало предложения. */
const SENTENCE_GAP = /[.!?…]["»”’)\]]*\s+(?=[\p{Lu}\p{Nd}«"„“(])/gu;
/** «1. Целостность сущностей», «7. Ограничения целостности»: номер пункта, а не конец предложения. */
const LIST_NUMBER_BEFORE = /(?:^|\s)\d{1,2}$/u;

function sentenceStarts(value: string): number[] {
  const starts = [0];
  for (const match of value.matchAll(SENTENCE_GAP)) {
    const at = match.index ?? 0;
    if (LIST_NUMBER_BEFORE.test(value.slice(Math.max(0, at - 4), at))) continue;
    starts.push(at + match[0].length);
  }
  return starts;
}

/**
 * Окно длинного текста вокруг места ответа: около limit знаков, целыми предложениями, где можно, — сначала
 * предложения с ответом, затем следующие (ответ обычно продолжается) и предыдущие по очереди, пока помещаются.
 * Предложение с ответом длиннее limit (или текст без точек, как строки таблицы) — окно по словам вокруг места.
 * Возвращает [начало, конец) окна в text; «…» по обрезанным краям ставит показ.
 */
export function focusWindow(value: string, focus: Span, limit: number): Span {
  if (value.length <= limit) return [0, value.length];
  const starts = sentenceStarts(value);
  const sentences: Span[] = starts.map((start, index) => [start, index + 1 < starts.length ? starts[index + 1] : value.length]);
  const first = sentences.findIndex(([, end]) => end > focus[0]);
  const last = sentences.findIndex(([, end]) => end >= focus[1]);
  let start = sentences[Math.max(0, first)][0];
  let end = sentences[last < 0 ? sentences.length - 1 : last][1];
  if (end - start > limit) return wordWindow(value, focus, limit);
  let before = Math.max(0, first) - 1;
  let after = (last < 0 ? sentences.length - 1 : last) + 1;
  for (let grew = true; grew; ) {
    grew = false;
    if (after < sentences.length && sentences[after][1] - start <= limit) {
      end = sentences[after][1];
      after += 1;
      grew = true;
    }
    if (before >= 0 && end - sentences[before][0] <= limit) {
      start = sentences[before][0];
      before -= 1;
      grew = true;
    }
  }
  return [start, trimmedEnd(value, start, end)];
}

function trimmedEnd(value: string, start: number, end: number): number {
  let cut = end;
  while (cut > start && SPACE_CHAR.test(value[cut - 1])) cut -= 1;
  return cut;
}

/** Окно по словам: место ответа и вокруг него поровну, края — на границе слова. */
function wordWindow(value: string, focus: Span, limit: number): Span {
  const room = Math.max(0, limit - (focus[1] - focus[0]));
  let start = Math.max(0, focus[0] - Math.floor(room / 2));
  let end = Math.min(value.length, start + Math.max(limit, focus[1] - focus[0]));
  start = Math.max(0, Math.min(start, end - limit));
  if (start > 0) {
    const space = value.indexOf(' ', start);
    if (space >= 0 && space < focus[0]) start = space + 1;
  }
  if (end < value.length) {
    const space = value.lastIndexOf(' ', end);
    if (space >= focus[1]) end = space;
  }
  return [start, trimmedEnd(value, start, Math.max(end, focus[1]))];
}
