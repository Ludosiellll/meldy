/**
 * The lecture's «Выжимка» (summary_json.cheatsheet) as it is shown. Its card already carries the
 * name «Выжимка», while the text itself starts with a heading the analysis asked for: «# Выжимка»
 * since 2026-10-05, before that «# Экспресс-шпаргалка» (at first «# ⚡ Экспресс-шпаргалка», or a
 * plain «# Шпаргалка»). That first heading is not shown, so the name is not said twice and the old
 * name never appears; words after the name stay as the heading («## Экспресс-шпаргалка: Спрос» →
 * «## Спрос»). Only the screen changes: the saved text stays as it is. «Шпаргалка» is now the name of
 * the exam's cheat sheet (lib/exams/cheatSheet.ts).
 */
const NAME_HEADING =
  /^(\s*?)([ \t]*)(#{1,6})[ \t]+(?:⚡️?[ \t]*)?(?:(?:экспресс[ \t]*[-‐‑‒–—]?[ \t]*)?шпаргалка|выжимка)(?![\p{L}\p{N}])[ \t]*(?:[:—–-][ \t]*([^\r\n]*?))?[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/iu;

export function displayCheatsheet(markdown: string): string {
  const match = NAME_HEADING.exec(markdown);
  if (!match) return markdown;
  const [whole, before, indent, hashes, topic] = match;
  const rest = markdown.slice(whole.length);
  if (topic && topic.trim()) return `${before}${indent}${hashes} ${topic.trim()}\n${rest}`;
  // A text that is only the heading keeps it, under its new name.
  if (!rest.trim()) return `${before}${indent}${hashes} Выжимка`;
  return `${before}${rest}`;
}
