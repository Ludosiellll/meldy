/**
 * «Чистый ответ» (Н7, 2026-10-07). The cheat sheet promises that only the student's answers erase its
 * lines; a ready text pasted into the answer field (from a lecture or a chat bot) would erase them with
 * words nobody said or typed. So a paste or a drop of more than PASTE_WORD_LIMIT words into an answer
 * field is refused, and the field says why; a term or a short phrase (up to 8 words) still goes in.
 * «Вставить ответ примера» in /try is a button that sets the example's own answer, not a paste.
 */

/** A term, a formula or a short phrase fits; a ready answer does not. */
export const PASTE_WORD_LIMIT = 8;

/** Under the field, when a paste was refused. */
export const PASTE_REFUSED =
  'Готовый текст вставить нельзя: ответ нужно сказать или набрать самому — так шпаргалка стирается честно.';

/** Letters or digits, with inner hyphens and apostrophes («кто-то», «O’Neil» are one word each). */
const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

/** How many words a piece of text has; signs and punctuation are no words. */
export function wordCount(text: string): number {
  return typeof text === 'string' ? (text.match(WORD) ?? []).length : 0;
}

/** Whether a pasted or dropped piece of text may go into an answer field. */
export function pasteAllowed(text: string): boolean {
  return wordCount(text) <= PASTE_WORD_LIMIT;
}
