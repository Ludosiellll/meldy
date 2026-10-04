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
