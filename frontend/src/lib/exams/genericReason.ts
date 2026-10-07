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
const GENERIC_WORD = new RegExp(
  '^(?:' +
    [
      'в|во|на|о|об|по|и|из|с|со|к|для|это|этот|этом|эти|этих|данн(?:ый|ом|ых|ые)|\\d+',
      'вопрос[\\p{L}\\p{N}_]*|ответ(?:а|е|ом|ы|ов|ам|ах)?|тем(?:а|ы|у|е|ой)',
      'фрагмент[\\p{L}\\p{N}_]*|материал(?:ы|а|е|ов|ам|ах|ами)?|лекци[\\p{L}\\p{N}_]*|текст(?:а|е|ы|ов|ах)?',
      'приложенн[\\p{L}\\p{N}_]*|предоставленн[\\p{L}\\p{N}_]*|представленн[\\p{L}\\p{N}_]*',
      'полностью|целиком|полн(?:ый|ая|ое|ые|ого|ую|ом|ым|ой|ых)|исчерпывающ[\\p{L}\\p{N}_]*|подробн[\\p{L}\\p{N}_]*|достаточн[\\p{L}\\p{N}_]*',
      'раскрыт[\\p{L}\\p{N}_]*|раскрыва[\\p{L}\\p{N}_]*|освещ(?:ен|ена|ено|ены|ается|аются)|содерж[\\p{L}\\p{N}_]*|есть|имеет[\\p{L}\\p{N}_]*|имеют[\\p{L}\\p{N}_]*',
      'присутству[\\p{L}\\p{N}_]*|изложен[\\p{L}\\p{N}_]*|приведен[\\p{L}\\p{N}_]*|дан|дана|дано|даны|описан(?:а|о|ы)?|рассмотрен(?:а|о|ы)?',
      'отвеча[\\p{L}\\p{N}_]*|часть|части|частичн[\\p{L}\\p{N}_]*|информаци[\\p{L}\\p{N}_]*|необходим[\\p{L}\\p{N}_]*|весь|вся|все|всего',
    ].join('|') +
    ')$',
  'u',
);

/** Words as the server splits them: \w+ of Python, letters, digits and «_» of the NFC text. */
const WORD = /[\p{L}\p{N}_]+/gu;

export function isGenericReason(reason: string | null | undefined): boolean {
  if (typeof reason !== 'string') return false;
  const words = reason.normalize('NFC').match(WORD) ?? [];
  return words.length > 0 && words.every((word) => GENERIC_WORD.test(word.toLowerCase().replace(/ё/g, 'е')));
}
