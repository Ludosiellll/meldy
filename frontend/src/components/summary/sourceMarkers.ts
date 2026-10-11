/**
 * The marks the model copies from its input into the text it writes: «[S02]», «[S01, S03]», runs like «[S04], [S05]».
 * They are references for the code (fragmentModel reads them as a section's fragments), never words for the student:
 * every place that shows model text takes them out (QA 2026-10-11: «[S01]» stood in the summary's term definitions).
 * Its own module, so the podcast's pictures (conversation/visuals) use it without importing the summary's model.
 */
export const SOURCE_MARK = String.raw`\[\s*S\d{1,3}(?:\s*[,;]\s*S?\d{1,3})*\s*\]`;
const MARK_RUN = new RegExp(String.raw`[ \t]*${SOURCE_MARK}(?:[ \t]*,?[ \t]*${SOURCE_MARK})*`, 'g');

/** Drops «[S02]», «[S01, S03]» and runs like «[S04], [S05]» the model copied from its input. */
export function stripSourceMarkers(text: string): string {
  return text.replace(MARK_RUN, '');
}
