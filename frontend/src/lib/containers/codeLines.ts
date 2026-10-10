/**
 * A line that reads as code, by the signs of C-like languages (braces, semicolons, operators, a keyword). Pure, no
 * imports: components/containers/model.ts re-exports it, lib/containers/stemCode.ts builds the split of a question on
 * it, and the Telegram bot runs a byte-exact copy (scripts/sync_bot_plan.mjs) for its questions and their options.
 */

/**
 * A code-like line: braces, semicolons, operators or a keyword, and few Cyrillic letters once its comments and string
 * literals are left out («Console.WriteLine(c); // целочисленное деление» is code).
 */
export function codeLike(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (/^(\/\/|\/\*|#|--\s)/.test(text)) return true;
  const bare = text
    .replace(/\/\*.*?\*\//g, ' ')
    .replace(/\/\/.*$/, ' ')
    .replace(/\s--\s.*$/, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""')
    .trim();
  const letters = bare.match(/[a-zа-яё]/gi) ?? [];
  const cyrillic = bare.match(/[а-яё]/gi) ?? [];
  if (letters.length > 0 && cyrillic.length / letters.length > 0.5) return false;
  if (/^\s{2,}|\t/.test(line)) return true;
  if (/[;{}]|=>|==|!=|\+\+|::|<\/?\w+>|\w\(.*\)|\[\d*\]/.test(bare)) return true;
  return /^(int|var|let|const|string|bool|double|float|char|long|class|struct|public|private|protected|static|void|for|while|if|else|return|using|namespace|import|from|def|print|console|select|insert|update|delete|create|alter|drop|begin|end|function|new)\b/i.test(bare);
}
