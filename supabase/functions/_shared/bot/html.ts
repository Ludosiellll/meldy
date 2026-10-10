/**
 * HTML for Telegram's parse_mode=HTML (spec §3): escaping, the typography of the site, and the visible length that
 * Telegram's 4096 limit counts.
 *
 * - `typo` glues with a no-break space what must not break at a line end: a number and the word after it («20 вопросов»,
 *   «3 ноября»), «N из M», a short word and the next one («в два», «из 960»), « ·», « —» and «№ » — the same rules
 *   as the site's `glue` (components/containers/copy.ts). It runs on plain text, never on code.
 * - Builders escape what they wrap; `<code>` never goes inside `<b>` (Telegram drops bold around code).
 */

export const NBSP = ' ';
/** After the option letter in letter mode (Z2): «<b>А</b> Изменения…». */
export const EN_SPACE = ' ';

export function esc(text: string): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SHORT_WORD = /(^|[\s(«„"'—–-])(в|во|к|ко|с|со|у|о|об|и|а|я|на|по|за|из|до|не|но|от|без|для|при) (?=\S)/giu;

/** The site's glue on plain text: no-break spaces where a line must not break. Idempotent. */
export function typo(text: string): string {
  return String(text)
    .replace(/(\d) (?=[^\s\d—–-])/g, `$1${NBSP}`)
    // Twice: «и в два» has two short words in a row, and one match takes the space it ends with.
    .replace(SHORT_WORD, `$1$2${NBSP}`)
    .replace(SHORT_WORD, `$1$2${NBSP}`)
    .replace(/ ·/g, `${NBSP}·`)
    .replace(/№ /g, `№${NBSP}`)
    .replace(/ —/g, `${NBSP}—`);
}

/** Plain text: glued and escaped. */
export function t(text: string): string {
  return esc(typo(text));
}

/** Bold text (one place per state: the question, the answer from the file, the title). */
export function b(text: string): string {
  return `<b>${t(text)}</b>`;
}

/** Inline code: verbatim, escaped, never glued. */
export function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}

/**
 * A code block: `<pre>` as the site shows it (monospace, no language). A question's code may be C#, SQL, a shell
 * command and its output or a table (stemCode.ts finds them all), so no single language label is true for every block;
 * a caller that knows the language passes it (`<pre><code class="language-…">`).
 */
export function pre(text: string, lang: string | null = null): string {
  if (lang && /^[a-z0-9+#-]{1,20}$/.test(lang)) return `<pre><code class="language-${lang}">${esc(text)}</code></pre>`;
  return `<pre>${esc(text)}</pre>`;
}

/** «ёлочки» around a name. */
export function quoted(text: string): string {
  return `«${text}»`;
}

/** Lines of a message: null / undefined / false are left out, '' is an empty line. */
export function lines(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === 'string').join('\n');
}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"' };

/** The text Telegram shows: tags removed, entities decoded. */
export function visibleText(html: string): string {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|amp|quot);/g, (_, name: string) => ENTITY[name])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/** Length as Telegram counts it after parsing (UTF-16 code units), for the 4096 limit. */
export function visibleLength(html: string): number {
  return visibleText(html).length;
}

/** «6 480»: thousands apart with a no-break space. */
export function thousands(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
