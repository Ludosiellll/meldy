/**
 * Gaps of a cloze question (docs/kinds/CONTRACT.md §1): a gap is a run of three or more underscores in the stem; the
 * row's answers hold one element per gap, its accepted forms joined by a newline.
 */
export const GAP_RE = /_{3,}/g;
export const GAPS_MAX = 10;
export const GAP_FORMS_MAX = 10;
export const GAP_TEXT_MAX = 200;

/** The number of gaps in a stem (public.meldy_cloze_gaps). */
export function gapCount(stem: string): number {
  return (stem.match(GAP_RE) ?? []).length;
}

/** The stem cut at its gaps: the text pieces around them (pieces.length = gaps + 1). */
export function gapPieces(stem: string): string[] {
  return stem.split(GAP_RE);
}

/** The accepted forms of each gap, from the row's answers. */
export function gapForms(answers: readonly string[]): string[][] {
  return answers.map((gap) => gap.split('\n').map((form) => form.trim()).filter((form) => form !== ''));
}

/** The row's answers from the forms of each gap (each form trimmed, empty ones dropped). */
export function answersOfGaps(gaps: readonly (readonly string[])[]): string[] {
  return gaps.map((forms) => forms.map((form) => form.trim()).filter((form) => form !== '').join('\n'));
}
