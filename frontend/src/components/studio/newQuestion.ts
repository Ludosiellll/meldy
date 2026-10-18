import { DRAFT_WORDS } from '../../lib/studio/checker';
import { emptyDraft, inputOf, type Draft } from '../containers/keys/editorModel';
import type { ItemInput } from '../../types/container';
import { BUILD } from '../test/copyTest';
import type { QuestionType } from './copyStudio';

/**
 * A question new from the palette (spec §47.6): the row comes first (container_items_add takes only a valid one: a
 * stem, 2–8 options, a short answer's form), then its block. It starts with the palette's words (lib/studio/checker.ts
 * DRAFT_WORDS — «Проверка теста» says while they stay) and no key, except a short answer, which the database cannot
 * keep without one form: its form is the word «ответ» until the author writes the real ones.
 */
export function draftOf(type: QuestionType): Draft {
  const option = (text: string) => ({ text, pictures: [] as string[] });
  const base = emptyDraft();
  switch (type) {
    case 'short':
      return { ...base, stem: DRAFT_WORDS.stem, short: true, options: [], forms: DRAFT_WORDS.form };
    case 'truefalse':
      return { ...base, stem: DRAFT_WORDS.statement, options: [option(BUILD.trueWord), option(BUILD.falseWord)], keepOrder: true };
    case 'multiple':
      return { ...base, stem: DRAFT_WORDS.stem, options: [1, 2, 3, 4].map((n) => option(DRAFT_WORDS.option(n))), multiple: true };
    case 'single':
      return { ...base, stem: DRAFT_WORDS.stem, options: [1, 2, 3, 4].map((n) => option(DRAFT_WORDS.option(n))) };
  }
}

/** The row of a new question for container_items_add (its number comes from buildModel.numbered). */
export function draftInput(type: QuestionType, ref: string): ItemInput {
  return inputOf(draftOf(type), '', ref);
}
