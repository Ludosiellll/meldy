/**
 * A subject's name from its file's name, when the file has no heading (Concept 1 §3.2, «Subject names», rule 2):
 * drop the extension, «_» and «-», the leading words that name the file's kind rather than the subject, and years and
 * marks at the end; capitalise the first letter. «Банк_тестов_по_БД_2026.docx» → «БД». Null when nothing is left
 * (the caller then says «Предмет N»).
 */

const LEADING = /^(?:банк\p{L}*|тест\p{L}*|вопрос\p{L}*|задани\p{L}*|по|к)\s+/iu;
const TRAILING = /\s+(?:(?:19|20)\d{2}(?:[-–/.](?:19|20)?\d{2})?|v\d+|в\d+|итог\p{L}*|финал\p{L}*|final|копия|copy|\(\d+\)|\d+)$/iu;

export function subjectFromFileName(fileName: string): string | null {
  let name = fileName.trim();
  // The extension: «.docx», «.txt» …; a name without one keeps its last word.
  name = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  name = name.replace(/[_\s]+/g, ' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const next = name.replace(LEADING, '');
    if (next === name) break;
    name = next;
  }
  for (let guard = 0; guard < 8; guard += 1) {
    const next = name.replace(TRAILING, '').trim();
    if (next === name) break;
    name = next;
  }
  name = name.replace(/^[\s.,;:()«»"']+|[\s.,;:()«»"']+$/g, '');
  if (!/\p{L}/u.test(name)) return null;
  return name.charAt(0).toLocaleUpperCase('ru-RU') + name.slice(1);
}
