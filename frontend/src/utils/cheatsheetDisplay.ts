/**
 * The lecture's «Выжимка» (summary_json.cheatsheet) as it is shown. Until 2026-10-05 it was called
 * «Шпаргалка», and texts saved before then start with the heading the analysis asked for:
 * «# Экспресс-шпаргалка» (at first «# ⚡ Экспресс-шпаргалка»), or a plain «# Шпаргалка». That first
 * heading reads «Выжимка» at the same level, and words after the old name stay
 * («## Экспресс-шпаргалка: Спрос» → «## Выжимка: Спрос»). Only the screen changes: the saved text stays
 * as it is. «Шпаргалка» is now the name of the exam's cheat sheet (lib/exams/cheatSheet.ts).
 */
const OLD_HEADING = /^(\s*#{1,6}[ \t]+)(?:⚡\uFE0F?[ \t]*)?(?:экспресс[ \t]*[-‐‑‒–—]?[ \t]*)?шпаргалка(?![\p{L}\p{N}])/iu;

export function displayCheatsheet(markdown: string): string {
  return markdown.replace(OLD_HEADING, '$1Выжимка');
}
