/**
 * Вставленный текст лекции: пределы, название для библиотеки и файл для /api/analyze.
 *
 * Пределы считаются по тексту без пробелов по краям. 300 символов — меньше модели
 * не из чего сделать карточки; 80 000 — столько любой из провайдеров примет без
 * молчаливой обрезки.
 */
import { pluralRu } from '../components/conversation/visuals';

export const PASTE_MIN_CHARS = 300;
export const PASTE_MAX_CHARS = 80_000;
export const PASTED_TEXT_FILE_NAME = 'pasted-text.txt';
export const PASTED_TEXT_FALLBACK_TITLE = 'Вставленный текст';
const TITLE_MAX_CHARS = 80;

/** «5 364» с неразрывным пробелом между разрядами. */
export function formatCount(count: number): string {
  return count.toLocaleString('ru-RU');
}

/** «5 364 символа». */
export function charactersLabel(count: number): string {
  return `${formatCount(count)} ${pluralRu(count, ['символ', 'символа', 'символов'])}`;
}

function cleanTitleLine(line: string): string {
  return line
    .replace(/[*_`]+/g, '')
    .replace(/^[\s#>«»"'„“”\-–—+•]+/, '')
    .replace(/[\s«»"'„“”\-–—:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit + 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > limit / 2 ? slice.slice(0, lastSpace) : text.slice(0, limit);
  return cut.replace(/[\s,;:–—-]+$/, '').trim();
}

/** Название материала: первая непустая строка без разметки, до 80 символов по границе слова. */
export function pastedTextTitle(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const clean = cleanTitleLine(line);
    if (clean) return cutAtWord(clean, TITLE_MAX_CHARS);
  }
  return PASTED_TEXT_FALLBACK_TITLE;
}

/** Файл для того же пути, что и загрузка .txt: имя только латиницей. */
export function pastedTextFile(text: string): File {
  return new File([text], PASTED_TEXT_FILE_NAME, { type: 'text/plain;charset=utf-8' });
}

/** Почему этот текст нельзя отправить, или null. */
export function pastedTextProblem(text: string): string | null {
  const length = text.trim().length;
  if (length === 0) return 'Вставьте текст';
  if (length < PASTE_MIN_CHARS) return `Нужно хотя бы ${formatCount(PASTE_MIN_CHARS)} символов, сейчас ${formatCount(length)}`;
  if (length > PASTE_MAX_CHARS) {
    return `Это ${charactersLabel(length)}, за один раз можно до ${formatCount(PASTE_MAX_CHARS)}. Разделите текст на части`;
  }
  return null;
}
