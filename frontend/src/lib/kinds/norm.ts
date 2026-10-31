/**
 * The short answer's normal form as the server compares it (public.meldy_short_norm): lower case, ё → е, every run of
 * whitespace → one space, trimmed, one final «.» dropped. The same function as components/containers/model.ts
 * shortNorm, kept here so the kinds' pure modules import nothing from the screens (norm.test.ts holds them equal).
 */
/** JavaScript's \s plus U+200B (zero width space), as the screens' shortNorm. */
const WHITE = new RegExp(`[\\s${String.fromCharCode(0x200b)}]+`, 'g');

export function shortNorm(value: string): string {
  let t = value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(WHITE, ' ')
    .trim();
  if (t.endsWith('.')) t = t.slice(0, -1);
  return t.trimEnd();
}
