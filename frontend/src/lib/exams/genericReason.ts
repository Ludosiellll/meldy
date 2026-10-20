/**
 * A mapping reason that says nothing about the content: every word of it is a word of a general verdict
 * («Вопрос полностью раскрыт в приложенных фрагментах», «Ответ есть во фрагментах», «Фрагменты содержат
 * ответ»). The why panel shows nothing instead of such a line under «Есть в ваших лекциях».
 *
 * The same list as backend exams_map._GENERIC_REASON_WORD_RE (forms in lower case, «ё» as «е»): the server
 * no longer stores such reasons, and the rows mapped before (live run 07.10: 12 of 15 «есть») are hidden
 * here. Exact forms where a stem would catch a topic word: «ответ» but not «ответственность», «тема» but not
 * «температура», «освещена» but not «освещённость».
 */
const GENERIC_EXACT = new RegExp(
  '^(?:' +
    [
      'в|во|на|о|об|по|и|из|с|со|к|для|это|этот|этом|эти|этих|данн(?:ый|ом|ых|ые)|\\d+',
      'ответ(?:а|е|ом|ы|ов|ам|ах)?|тем(?:а|ы|у|е|ой)',
      'материал(?:ы|а|е|ов|ам|ах|ами)?|текст(?:а|е|ы|ов|ах)?',
      'полностью|целиком|полн(?:ый|ая|ое|ые|ого|ую|ом|ым|ой|ых)',
      'освещ(?:ен|ена|ено|ены|ается|аются)|есть',
      'дан|дана|дано|даны|описан(?:а|о|ы)?|рассмотрен(?:а|о|ы)?',
      'часть|части|весь|вся|все|всего',
    ].join('|') +
    ')$',
  'u',
);
/** The stems that take any ending (letters, digits, «_»). */
const GENERIC_STEM = new RegExp(
  '^(?:' +
    [
      'вопрос|фрагмент|лекци',
      'приложенн|предоставленн|представленн',
      'исчерпывающ|подробн|достаточн',
      'раскрыт|раскрыва|содерж|имеет|имеют',
      'присутству|изложен|приведен',
      'отвеча|частичн|информаци|необходим',
    ].join('|') +
    ')[\\p{L}\\p{N}_]*$',
  'u',
);

/**
 * The list as two expressions with the same matches as one (the exact forms; the stems with any ending): a word is
 * generic when either matches the whole of it. As one expression, with the letter class after every stem, the
 * browser built that class 21 times on the first use — 25 ms on a computer, 45 ms of a phone's tap on a question
 * (smoothness audit 20.10); here it is built once.
 */
const isGenericWord = (word: string) => GENERIC_EXACT.test(word) || GENERIC_STEM.test(word);

/** Words as the server splits them: \w+ of Python, letters, digits and «_» of the NFC text. */
const WORD = /[\p{L}\p{N}_]+/gu;

export function isGenericReason(reason: string | null | undefined): boolean {
  if (typeof reason !== 'string') return false;
  const words = reason.normalize('NFC').match(WORD) ?? [];
  return words.length > 0 && words.every((word) => isGenericWord(word.toLowerCase().replace(/ё/g, 'е')));
}

/** Builds the expressions before the first question is opened (idle time after the sheet appears). */
export function warmGenericReason(): void {
  isGenericReason('Вопрос раскрыт полностью');
}
