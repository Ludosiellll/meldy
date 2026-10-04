import type { Flashcard } from '../types';

/**
 * The cards an analysis made for a material (materials.flashcards_json), in either stored shape:
 * `{ flashcards: [...] }` or the older bare array. Cards without a question or an answer are left
 * out, as review never takes them. Used by «Сегодня» and «Прогресс» to see cards that have not
 * reached review yet.
 */
export function analysisCards(flashcardsJson: unknown): Flashcard[] {
  const items: unknown[] = Array.isArray(flashcardsJson)
    ? flashcardsJson
    : Array.isArray((flashcardsJson as { flashcards?: unknown } | null)?.flashcards)
      ? (flashcardsJson as { flashcards: unknown[] }).flashcards
      : [];
  return items.filter((card): card is Flashcard => {
    const c = card as Partial<Flashcard> | null;
    return typeof c?.question === 'string' && c.question.trim() !== '' && typeof c?.answer === 'string' && c.answer.trim() !== '';
  });
}
