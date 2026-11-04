/**
 * A subject's name from its file's name, when the file has no heading (Concept 1 §3.2, «Subject names», rule 2):
 * drop the extension, «_» and «-», the leading words that name the file's kind rather than the subject, and years and
 * marks at the end; capitalise the first letter. «Банк_тестов_по_БД_2026.docx» → «БД». Null when nothing is left
 * (the caller then says «Предмет N»).
 */

const LEADING = /^(?:банк\p{L}*|тест\p{L}*|вопрос\p{L}*|задани\p{L}*|по|к)\s+/iu;
const TRAILING = /\s+(?:(?:19|20)\d{2}(?:[-–/.](?:19|20)?\d{2})?|v\d+|в\d+|итог\p{L}*|финал\p{L}*|final|копия|copy|\(\d+\)|\d+)$/iu;

const NUMBERED = /(?:^|\s)(?:вариант|variant|билет|часть|модуль|раздел|блок)\s*№?\s*\d+$/iu;

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
    // «Вариант 1», «Билет 12», «Часть 2»: the number is the name (owner, 2026-10-14: six variants of one test).
    if (NUMBERED.test(name)) break;
    const next = name.replace(TRAILING, '').trim();
    if (next === name) break;
    name = next;
  }
  name = name.replace(/^[\s.,;:()«»"']+|[\s.,;:()«»"']+$/g, '');
  if (!/\p{L}/u.test(name)) return null;
  return name.charAt(0).toLocaleUpperCase('ru-RU') + name.slice(1);
}

// «КПиЯП_Вариант_3», «вариант №3», «Вар 3», «вар.3», «variant 3»: the variant's number in a file's name.
const VARIANT_IN_NAME = /(?:^|[\s(,.])(?:вариант|вар|variant|var)\.?\s*№?\s*(\d{1,3})(?!\d)/iu;

/**
 * The variant a file's name gives and the subject's name without it (owner, 2026-11-04: «КПиЯП_Вариант_1.docx» …
 * «КПиЯП_Вариант_12.docx» are one subject): «КПиЯП_Вариант_1.docx» → { variant: 1, base: «КПиЯП» }. A name without a
 * variant keeps all of it as the base («Тест.docx» → «Тест»); base is null when nothing is left («Вариант_1.docx»).
 */
export function variantFromFileName(fileName: string): { variant: number | null; base: string | null } {
  const name = fileName
    .trim()
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[_\s]+/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .trim();
  const match = VARIANT_IN_NAME.exec(name);
  if (!match) return { variant: null, base: subjectFromFileName(name) };
  const rest = `${name.slice(0, match.index)} ${name.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
  return { variant: Number(match[1]), base: rest ? subjectFromFileName(rest) : null };
}

/** A subject's name as two files are compared by it: case, «ё», quotes, spaces and the closing punctuation aside. */
export function subjectNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!?…]+$/u, '');
}
