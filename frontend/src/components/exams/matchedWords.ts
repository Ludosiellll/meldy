/**
 * The words a question shares with its nearest lecture fragment (`nearest.matched` of the mapping, one entry per
 * word form as the lecture spells it), as «Почему» names them. Audit of 2026-10-08: «совпали слова «Назначение»,
 * «выполнения», «запросе», «запроса»» — two forms of one word, and words any exam question has, read as if Meldy had
 * almost found the answer. Here a word is named once per stem, and words of the question's form («назначение»,
 * «виды», «особенности») are told apart from the words of its subject. Pure; no dictionary, only common endings.
 */

/** Inflection endings, longest first; a stem keeps at least three letters. */
const ENDINGS = [
  'иями', 'ями', 'ами', 'иях', 'ием', 'ией', 'ого', 'его', 'ому', 'ему',
  'ях', 'ах', 'ов', 'ев', 'ей', 'ой', 'ом', 'ем', 'ам', 'ям', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ие', 'ые',
  'их', 'ых', 'ым', 'им', 'ую', 'юю', 'ия', 'ию', 'ии', 'ья', 'ье', 'ьи', 'ью',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь',
];

/** «запросе», «запроса» → «запрос»; «выполнения», «выполнение» → «выполнен»; Latin and numbers stay as they are. */
export function wordStem(word: string): string {
  const lower = word.trim().toLowerCase().replace(/ё/g, 'е');
  if (!/^[а-я]+$/.test(lower)) return lower;
  for (const ending of ENDINGS) {
    if (lower.endsWith(ending) && lower.length - ending.length >= 3) return lower.slice(0, -ending.length);
  }
  return lower;
}

/**
 * Words of the form of an exam question, not of its subject: they match a fragment of any lecture. Kept as stems
 * (wordStem), so every form of them counts.
 */
const GENERIC = new Set(
  [
    'назначение', 'понятие', 'определение', 'сущность', 'роль', 'значение', 'особенность', 'особенности', 'основной',
    'основные', 'вид', 'виды', 'тип', 'типы', 'классификация', 'принцип', 'принципы', 'характеристика', 'этап', 'этапы',
    'применение', 'использование', 'выполнение', 'сравнение', 'пример', 'примеры', 'задача', 'задачи', 'влияние',
    'отличие', 'различие', 'достоинство', 'недостаток', 'недостатки', 'преимущество', 'общий', 'общие', 'современный',
    'главный', 'важный', 'описание', 'раскрытие', 'содержание', 'вопрос',
  ].map(wordStem),
);

/** A word of the question's form («Назначение», «выполнения»), not of its subject. */
export function isGenericWord(word: string): boolean {
  return GENERIC.has(wordStem(word));
}

/** «Назначение» → «назначение» at the start of a lecture's sentence; «SQL», «ЦБ», «B-дерево» keep their letters. */
function readable(word: string): string {
  const rest = word.slice(1);
  return rest === rest.toLowerCase() ? word.toLowerCase() : word;
}

/** The words once per stem, in their first spelling, empty entries left out. */
export function distinctWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const stem = wordStem(word);
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(readable(word));
  }
  return out;
}

/**
 * What the matched words say: the subject's words when there are any («запросе»), else only the question's form —
 * `generic` then (nothing alike was found, the words alone matched).
 */
export function telling(words: readonly string[]): { words: string[]; generic: boolean } {
  const all = distinctWords(words);
  const specific = all.filter((word) => !isGenericWord(word));
  if (specific.length > 0) return { words: specific, generic: false };
  return { words: all, generic: all.length > 0 };
}
