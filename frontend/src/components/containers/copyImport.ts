/**
 * Every Russian line of the import page, «Ключи», the exam's «Настройки», «Пригласить группу» and the page of the
 * group link /g/<код> (package D3a). Sources: spec v2.2 (meldy-notes 10_Project/Exam_Container_Spec_2026-10-09.md:
 * §3 words, decisions 5–7, 21, 22, 24, 34, 44, 52), Concept 1 §3.1–3.2, §3.11–3.12, and the design critique's table of
 * replacements (Critic_v2_Design.md, except the word §16 #55 rejects), plus the student critique's import points
 * (В3–В6). One home for the words: copyImport.test.ts fails on the banned ones (spec §16 #45).
 *
 * Numbers and their words are glued with a no-break space (`nb`), so «240 / вопросов» never breaks on a phone.
 */
import { ALL_QUESTIONS_MINUTES as ALL_QUESTIONS_MIN } from './allQuestionsMinutes';

export const NBSP = '\u00a0';

/** «1 вопрос», «2 вопроса», «5 вопросов». */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count)) % 100;
  if (n >= 11 && n <= 14) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** A number and its word: «240 вопросов». */
export function count(n: number, one: string, few: string, many: string): string {
  return `${n}${NBSP}${plural(n, one, few, many)}`;
}

/** No-break spaces where Russian typesetting asks: after a number before a word, before «·», after «№». */
export function nb(text: string): string {
  return text
    .replace(/(\d) (?=[а-яёА-ЯЁa-zA-Z%])/g, `$1${NBSP}`)
    .replace(/ ·/g, `${NBSP}·`)
    .replace(/№ /g, `№${NBSP}`);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** '2026-10-28' → «28 октября» (no year: the dates are this season's); '' for a malformed day. */
/** The question editor in «Вопросы и ключи» (keys/QuestionEditor.tsx; spec 2026-10-16 part 1). */
export const EDITOR = {
  label: 'Правка вопроса',
  kindChoice: 'Выбор из вариантов',
  kindShort: 'Короткий ответ',
  stem: 'Текст вопроса',
  code: 'Текст — код: показывать как есть',
  pictures: 'Картинки',
  addPicture: 'Картинка',
  addPictureFull: 'Добавить картинку',
  /** The picture button of an option's row (an icon: its name is read out). */
  optionPicture: (l: string) => `Картинка к варианту ${l}`,
  removePicture: 'Убрать картинку',
  pasteHint: 'Картинку можно вставить в поле: Ctrl+V.',
  options: 'Варианты ответа',
  option: (l: string) => `Вариант ${l}`,
  right: (l: string) => `Вариант ${l} верный`,
  rightWord: 'верный',
  addOption: 'Добавить вариант',
  removeOption: (l: string) => `Убрать вариант ${l}`,
  removeWord: 'Убрать',
  keepOrder: 'Не перемешивать варианты',
  forms: 'Принятые ответы через «;»',
  explanation: 'Пояснение — ученик увидит его вместе с верным ответом',
  /** The explanation's heading where it is shown: after an answer in a «занятие», in «Вопросы и ключи». */
  explanationShown: 'Пояснение',
  /** Near the limit: «1 850 из 2000». */
  explanationCount: (n: number, max: number) => `${n} из ${max}`,
  save: 'Сохранить',
  /** A new question in «Конструктор»: saved, and a blank one of the same kind opens under it. */
  saveNext: 'Сохранить и следующий',
  add: 'Добавить вопрос',
  cancel: 'Отмена',
  /** Another question, «Добавить вопрос» or a way off the page while this one holds changes. */
  unsaved: (n: number) => `В вопросе ${n} есть несохранённые правки`,
  discard: 'Не сохранять',
  /**
   * The live line under the options (release 47, M5): how many are ticked and what the student does — «Отмечен 1
   * верный — ученик выберет один вариант», «Отмечено 2 верных — ученик выберет несколько». The ticks themselves show
   * which. `multiple` — the author chose several answers; `forced` — the author chose one answer and ticked several:
   * the question is saved with several, and the line says so.
   */
  ticked: (marked: readonly number[], multiple: boolean, forced = false) => {
    const n = marked.length;
    const does = n >= 2 ? 'ученик выберет несколько' : multiple ? 'ученик может отметить несколько' : 'ученик выберет один вариант';
    const head = n === 0 ? 'Не отмечен ни один верный' : `${plural(n, 'Отмечен', 'Отмечено', 'Отмечено')} ${n} ${plural(n, 'верный', 'верных', 'верных')}`;
    return `${head} — ${does}${forced ? '. Вопрос сохранится как «Несколько ответов»' : ''}`;
  },
  /** A question with several answers and one tick: back to one answer. */
  makeSingle: 'Сделать с одним ответом',
  saving: 'Сохраняем…',
  uploading: 'Загружаем картинку…',
  resets: 'Меняется ключ или число вариантов: у участников этот вопрос начнётся заново.',
  noKey: 'Не отмечен верный вариант: без ключа вопрос не попадёт в занятия.',
  nothing: 'Ничего не изменилось.',
  pictureType: 'Это не картинка. Подойдут JPEG, PNG, GIF, WebP и фото с телефона.',
  pictureSize: 'Картинка больше 3 МБ даже после сжатия.',
  /** A HEIC photo the browser cannot draw (pictureFromFile 'heic'). */
  /** Device-neutral (live check of 47.4: «телефон не отдаёт» was said on a computer too). */
  pictureHeic: 'Этот браузер не открывает фото HEIC. Сохраните его как JPEG или PNG и загрузите снова.',
  pictureFailed: 'Картинка не сохранилась. Попробуйте ещё раз.',
  problems: {
    stem: 'Напишите текст вопроса или добавьте картинку.',
    stem_long: 'Текст вопроса длиннее 4000 знаков.',
    option_empty: 'В каждом варианте нужен текст или картинка.',
    option_long: 'Вариант длиннее 600 знаков.',
    options_few: 'Нужно хотя бы два варианта.',
    options_many: 'Вариантов не больше восьми.',
    options_size: 'Варианты вместе слишком длинные: сократите их.',
    forms: 'Напишите от одного до десяти принятых ответов через «;».',
    form_long: 'Принятый ответ длиннее 200 знаков.',
    explanation_long: 'Пояснение длиннее 2000 знаков.',
  },
} as const;

export function dayText(day: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (!match) return '';
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (month < 1 || month > 12 || date < 1 || date > 31) return '';
  return `${date}${NBSP}${MONTHS[month - 1]}`;
}

const questions = (n: number) => count(n, 'вопрос', 'вопроса', 'вопросов');
const subjects = (n: number) => count(n, 'предмет', 'предмета', 'предметов');

/** «А», «Б», «В» … the option letters of a question, in file order. */
export const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У', 'Ф'];
export const letter = (index: number) => LETTERS[index] ?? String(index + 1);
/** «Б и Г», «А, В и Г». */
export function lettersText(indices: readonly number[]): string {
  const list = indices.map(letter);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`;
}

// ─────────────────────────────────────────────── /exams/import ───────────────────────────────────────────────

export const IMPORT = {
  title: 'Новый экзамен',
  titleAdd: 'Добавить предмет',
  crumb: 'Экзамены',
  docTitle: 'Новый экзамен',
  lede: 'Один общий файл или по файлу на предмет.',
  pick: 'Выбрать файлы',
  pasteLink: 'Вставить список текстом',
  formats: 'Word, Excel, PDF, TXT, CSV, HTML или Moodle XML. Сканы подходят только для списков без вариантов',
  dropTitle: 'Загрузите вопросы',
  dropLede: 'Перетащите сюда файлы, по одному на предмет или один на все.',
  dropping: 'Отпустите файлы, и Meldy их разберёт',
  sideTitle: 'Что сделает Meldy',
  side: [
    'Найдёт предметы, темы и вопросы. Номера останутся как в файле.',
    'С вариантами возьмёт ключ из оформления: жирный, подчёркивание, цвет, «+» или строка «1 – б». Ключей ИИ не придумывает и лимит не тратит.',
    'Без вариантов — это устные вопросы. Ответы на них Meldy проверит по вашим лекциям.',
  ],
  tgAndroid: 'Файл в Telegram? Нажмите ⋮ у файла → «Сохранить в загрузки» и выберите его здесь.',
  tgIphone: 'Файл из Telegram сначала сохраните в «Файлы».',
  pasteLabel: 'Список вопросов',
  pastePlaceholder: '1. Какой тип хранит целые числа?\nа) int\nб) string\nв) bool\n\n2. …',
  pasteGo: 'Разобрать',
  pasteCancel: 'Отмена',
  pasteEmpty: 'Сначала вставьте сюда список.',
  pasteName: 'Текст',

  reading: (n: number) => `Читаем ${count(n, 'файл', 'файла', 'файлов')}`,
  readingWait: 'читаем…',
  readFailed: 'не открылся',
  removeFile: 'Убрать файл',
  retryFile: 'Попробовать ещё раз',
  addFile: 'Добавить ещё файл',
  fileFound: (n: number) => questions(n),

  found: (subjectCount: number, questionCount: number) =>
    subjectCount === 1 ? `Нашли ${questions(questionCount)}` : `Нашли ${subjects(subjectCount)} и ${questions(questionCount)}`,
  rowTest: (n: number) => questions(n),
  rowOral: (n: number) => count(n, 'устный вопрос', 'устных вопроса', 'устных вопросов'),
  rowOralTail: (n: number) => count(n, 'устный', 'устных', 'устных'),
  rowRange: (from: number, to: number) => `вопросы ${from}–${to}`,
  rowNoKey: 'ключа нет',

  problems: (n: number) => `Проверьте ${questions(n)}. Можно и после сохранения.`,
  problemsGo: 'Проверить',
  spotCheck: 'Сверить ключ на трёх вопросах',
  spotCheckLede: 'Совпадает ли ответ с файлом?',
  spotCheckWrong: 'Не совпадает?',
  spotCheckFile: 'В файле',
  readAsOral: 'Прочитать как устные вопросы ›',
  readAsTest: 'Прочитать как вопросы с вариантами ›',
  rereading: 'Читаем заново…',
  oralCost: (n: number) =>
    `Пункты ответа к ${count(n, 'устному вопросу', 'устным вопросам', 'устным вопросам')} Meldy составит по вашим лекциям. По частям, сколько позволит дневной лимит ИИ.`,
  oralAnswers: 'Ответы к открытым вопросам из файла не переносятся: устные ответы Meldy сверяет с вашими лекциями.',
  notInPlan: (n: number) =>
    `${count(n, 'вопрос', 'вопроса', 'вопросов')} на порядок и соответствие пока не ${n % 10 === 1 && n % 100 !== 11 ? 'идёт' : 'идут'} в занятия.`,
  imageLost: (labels: string[], n: number) =>
    n === 1
      ? `Картинка в № ${labels[0] ?? ''} не перенеслась. Без неё вопрос не попадёт в занятия.`
      : labels.length === n
        ? `Картинки в № ${labels.join(', ')} не перенеслись. Без них эти вопросы не попадут в занятия.`
        : `Картинки в ${count(n, 'вопросе', 'вопросах', 'вопросах')} не перенеслись. Без них эти вопросы не попадут в занятия.`,
  imageLostGo: 'Посмотреть',
  blocked: (n: number) =>
    n % 10 === 1 && n % 100 !== 11
      ? `${questions(n)} не сохранится: у него не хватает вариантов. Проверьте его.`
      : `${questions(n)} не сохранятся: у них не хватает вариантов. Проверьте их.`,
  split: (title: string, n: number, parts: number) =>
    `В «${title}» ${count(n, 'устный вопрос', 'устных вопроса', 'устных вопросов')}, а в устном предмете помещается 150. Разделили на ${parts} ${plural(parts, 'часть', 'части', 'частей')}.`,
  partTitle: (title: string, part: number) => `${title}, часть ${part}`,
  topicsMerged: (title: string, n: number) => `В «${title}» ${count(n, 'тема', 'темы', 'тем')}, а можно не больше 99. Вопросы тем после 99-й добавлены в 99-ю.`,
  removedSubjects: (n: number) => `Убрано: ${subjects(n)}.`,
  restoreSubjects: 'Вернуть',
  noKeyTitle: 'Ответы в файле не отмечены.',
  noKeyIn: (title: string) => `«${title}»: ответы в файле не отмечены.`,
  noKeyPaste: 'Вставить ключ списком',
  noKeyFile: 'Ключ в другом файле',
  noKeyLater: 'Отмечать по ходу',
  noKeyOral: 'Это устные вопросы',
  pdfNote: 'Это скан: вопросы прочитаны списком, без вариантов и ключей. Если есть этот файл в Word, загрузите его.',

  target: 'Куда добавить',
  targetNew: 'Новый экзамен',
  targetTo: (title: string) => `К «${title}»`,
  /** Two targets of one name: the date and the size, as «Экзамены» says them; a copy equal in both: the day it was made. */
  targetDetail: (day: string, n: number) => `${day || 'дата не указана'} · ${questions(n)}`,
  targetMade: (day: string, time: string | null) => (time ? `создан ${day} в ${time}` : `создан ${day}`),
  name: 'Название',
  /** An oral exam joins as subject 1: it is named, the rows above are the other subjects (usability check 2026-10-10, m4). */
  nameWith: (title: string, n: number) => `В экзамене будут «${title}» и ещё ${subjects(n)}. Название`,
  /** «Добавить предмет» of an exam: the student's oral exams outside any exam join it as they are. */
  oralOffer: 'Или устный экзамен, который уже есть',
  oralOfferMeta: (day: string, n: number) => `устный · ${day || 'дата не указана'} · ${questions(n)}`,
  namePlaceholder: 'Например, Зимняя сессия',
  nameTwo: (a: string, b: string) => `${a} и ${b}`,
  nameMissing: 'Назовите экзамен.',
  date: 'Дата экзамена',
  dates: 'У предметов разные даты',
  oneDate: 'Одна дата для всех',
  subjectDate: (title: string) => `Дата: ${title}`,
  noDate: 'Дату можно не указывать. Тогда будет по 15 новых вопросов в день на предмет.',
  minutes: 'Время в день',
  // «Все вопросы» (lib/containers/plan.ts ALL_QUESTIONS_MIN, minutes_per_day 300): no minutes cap, every question shown.
  minuteOption: (n: number) => (n >= ALL_QUESTIONS_MIN ? 'Все вопросы' : `${n}${NBSP}минут`),
  // «Как можно быстрее» (owner, 2026-10-14): the new questions spread evenly to the date, or as soon as they fit.
  tempo: 'Новые вопросы',
  tempoOption: (tempo: 'date' | 'fast') => (tempo === 'fast' ? 'Как можно быстрее' : 'Равномерно до даты'),

  save: 'Сохранить',
  saveAdd: (n: number) => `Добавить ${subjects(n)}`,
  saving: 'Сохраняем…',
  nextLectures: 'Дальше добавьте лекции. По ним Meldy проверит устные ответы.',
  savingItems: (done: number, total: number) => `Сохраняем вопросы: ${done} из ${total}`,
  saveRetry: 'Не всё сохранилось. Нажмите ещё раз: сохранённое не повторится.',
  saveFailed: 'Не сохранилось. Проверьте связь и нажмите ещё раз.',
  tooManySubjects: (n: number) => `В экзамене помещается 20 предметов, а здесь ${n}. Уберите лишние.`,
  tooManyItems: (n: number) =>
    `В экзамене помещается 2000 вопросов с вариантами, а здесь ${n}. Уберите предмет или загрузите часть файлов в другой экзамен.`,
  nothingLeft: 'Все предметы убраны. Верните предмет или выберите другой файл.',
  signedOut: 'Войдите в аккаунт, чтобы сохранить экзамен.',

  // one subject's preview
  back: 'Все предметы',
  fromHeading: 'из заголовка в файле',
  fromFile: (name: string) => `из названия файла «${name}»`,
  fromNumber: 'название не нашлось, назовите предмет',
  rename: 'Переименовать',
  more: (title: string) => `Ещё: ${title}`,
  renameLabel: 'Название предмета',
  renameDone: 'Готово',
  removeSubject: 'Убрать предмет',
  restoreSubject: 'Вернуть предмет',
  numbers: (first: string, last: string, missing: number[], more: number) =>
    `№ ${first}–${last}` + (missing.length ? `, не нашли № ${missing.join(', ')}${more > 0 ? ` и ещё ${more}` : ''}` : ''),
  topicsLine: (n: number) => count(n, 'тема', 'темы', 'тем'),
  topicsTitle: 'Темы',
  noTopic: 'Без темы',
  otherWay: 'Отмечен по-другому?',
  detailProblems: (parts: string[], n: number) => `Проверьте ${n}: ${parts.join(', ')}.`,
  restart: 'Похоже, в файле несколько предметов: нумерация вопросов начинается заново.',
  merge: 'Оставить одним',
  unmerge: 'Разделить на предметы',

  // the key: «Как в файле отмечен ответ?»
  keyTitle: 'Как в файле отмечен ответ?',
  keyAuto: 'Как нашёл Meldy',
  keyFirst: 'Первый вариант всегда верный',
  keyNone: 'Ответы в файле не отмечены',
  keyMarker: 'Знаком «+»',
  keyListLabel: 'Ключ отдельным списком',
  keyListPlaceholder: '1 – б, 2 – а, 3 – г…',
  keyListHint: 'Meldy сверит номера с файлом.',
  keyListGo: 'Проверить ключ',
  keyListEmpty: 'Вставьте ключ: номер вопроса и букву ответа.',
  keyListResult: (keyed: number, total: number) => `Ключ подошёл к ${keyed} из ${total}.`,
  keyClose: 'Готово',
  // a key kept in another file (owner, 2026-10-14): one section per variant, the test's own variant is taken
  keyFileLabel: 'Ключ отдельным файлом',
  keyFileHint: 'Word, Excel или TXT: таблица «1 | А» или строки «1 – А». Если в файле несколько вариантов, Meldy возьмёт тот, что указан в файле с вопросами.',
  keyFilePick: 'Выбрать файл ключа',
  keyFileOther: 'Другой файл',
  keyFileRemove: 'Убрать',
  keyFileUsed: (title: string, keyed: number, total: number) =>
    title ? `Взяли «${title}»: ключ подошёл к ${keyed} из ${total}.` : `Ключ подошёл к ${keyed} из ${total}.`,
  keyFileChoose: 'Какой вариант взять?',
  keyFileSection: (variant: number | null, index: number, count: number) =>
    `${variant !== null ? `Вариант ${variant}` : `Часть ${index + 1}`} · ${count} ${plural(count, 'ответ', 'ответа', 'ответов')}`,

  // «Обновить из файла» (?from=c:<id>&subject=<id>): a newer file of one subject. New questions are added; the ones
  // already there stay as they are, keys included (a key changes only in «Ключи»).
  titleUpdate: 'Обновить из файла',
  updateDropTitle: 'Новая версия файла',
  updateLede: (title: string) =>
    `Файл предмета «${title}». Новые вопросы добавятся, а те, что уже есть, останутся как были, с ключами и ответами.`,
  updateLoading: 'Загружаем вопросы предмета…',
  updateLoadFailed: 'Вопросы предмета не загрузились. Проверьте связь и обновите страницу.',
  updateNotFound: 'Этого предмета в экзамене нет. Возможно, его уже убрали.',
  updateAuthorOnly: 'Вопросы из файла добавляет автор экзамена.',
  updateToExam: 'К экзамену',
  updateWhich: 'Какой предмет из файла',
  updateRowNew: 'Новые, добавятся',
  updateRowSame: 'Уже в предмете',
  updateRowKey: 'Ключ в файле другой',
  updateRowGone: 'Есть в предмете, нет в файле',
  updateRowOral: 'Устные, сюда не добавляются',
  updateKeyLine: 'Ключ здесь не меняется. Его меняют в «Вопросах и ключах», вопрос можно найти по номеру.',
  updateKeyItem: (no: string, file: string, now: string | null) => `${no ? `№ ${no}` : 'Без номера'}: в файле ${file}, сейчас ${now ?? 'без ключа'}`,
  updateKeyShort: (no: string) => `${no ? `№ ${no}` : 'Без номера'}: в файле другие ответы`,
  updateKeyMore: (n: number) => `и ещё ${n}`,
  updateToKeys: 'Сверить ключи',
  updateGoneLine: 'Вопросы, которых нет в файле, остаются с ответами. Лишний можно удалить в «Вопросах и ключах».',
  updateSave: (n: number) => `Добавить ${questions(n)}`,
  updateNothing: 'Новых вопросов в файле нет.',
  updateDone: 'Готово',
} as const;

/** «Проверьте 7: в 4 нет ответа, в 2 выделено два, 1 повторяется.» — one part per kind of problem. */
export const PROBLEM_PARTS: Record<string, (n: number) => string> = {
  image: (n) => `в ${n} не перенеслась картинка`,
  no_options: (n) => `в ${n} нет вариантов`,
  few_options: (n) => `в ${n} один вариант`,
  many_options: (n) => `в ${n} больше 8 вариантов`,
  empty_option: (n) => `в ${n} пустой вариант`,
  same_options: (n) => `в ${n} одинаковые варианты`,
  several: (n) => `в ${n} выделено два`,
  key_conflict: (n) => `в ${n} ключ и выделение расходятся`,
  key_invalid: (n) => `в ${n} ключ не подходит`,
  key_letter: (n) => `в ${n} буква ключа читается двояко`,
  partial: (n) => `в ${n} выделение неполное`,
  no_key: (n) => `в ${n} нет ответа`,
  duplicate: (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'повторяется' : 'повторяются'}`,
  too_long: (n) => `${n} длиннее предела`,
};

/** Signal words in «Как в файле отмечен ответ?»: «Жирным — 229». */
export const SIGNAL_WORDS: Record<string, string> = {
  bold: 'Жирным',
  underline: 'Подчёркиванием',
  italic: 'Курсивом',
  color: 'Цветом',
  highlight: 'Маркером',
  shade: 'Заливкой',
};

/** The second line of a subject row: «ключ жирным» (Concept 1 §3.2). */
export const KEY_WORDS: Record<string, string> = {
  bold: 'ключ жирным',
  underline: 'ключ подчёркиванием',
  italic: 'ключ курсивом',
  color: 'ключ цветом',
  highlight: 'ключ маркером',
  shade: 'ключ заливкой',
  marker: 'ключ «+»',
  key_column: 'ключ в столбце',
  answer_line: 'ключ строкой «Ответ»',
  key_list: 'ключ строкой в конце',
  key_text: 'ключ из вашего списка',
  gift: 'ключ из разметки',
  first_option: 'ключ — первый вариант',
  manual: 'ключ отмечен вами',
  none: 'ключа нет',
};

/** «Ответ выделен жирным в 229 из 236.» (one subject's preview). */
export function keyShareLine(source: string, keyed: number, total: number): string {
  const tail = ` в ${keyed} из ${total}.`;
  switch (source) {
    case 'bold': return `Ответ выделен жирным${tail}`;
    case 'underline': return `Ответ подчёркнут${tail}`;
    case 'italic': return `Ответ выделен курсивом${tail}`;
    case 'color': return `Ответ выделен цветом${tail}`;
    case 'highlight': return `Ответ выделен маркером${tail}`;
    case 'shade': return `Ответ выделен заливкой${tail}`;
    case 'marker': return `Ответ отмечен знаком «+»${tail}`;
    case 'key_column': return `Ответ взят из столбца ключа${tail}`;
    case 'answer_line': return `Ответ взят из строки «Ответ»${tail}`;
    case 'key_list': return `Ответ взят из ключа в конце файла${tail}`;
    case 'key_text': return `Ответ взят из вашего ключа${tail}`;
    case 'gift': return `Ответ взят из разметки файла${tail}`;
    case 'first_option': return `Верным считается первый вариант${tail}`;
    case 'manual': return `Ответ отмечен вами${tail}`;
    default: return 'Ответы в файле не отмечены.';
  }
}

/** The importer's error codes (backend/bank_api.py, bank_parse.py) and ours, in the words of the spec. */
export const PARSE_ERRORS: Record<string, string> = {
  old_doc: 'Это файл Word старого формата (.doc). Откройте его в Word или Google Документах и сохраните как DOCX.',
  unsupported: 'Этот формат не читаем. Подойдут Word (DOCX), Excel (XLSX), PDF, текст (TXT, MD, CSV), HTML и Moodle XML.',
  scan_pdf: 'В этом PDF нет текста — это скан. Пришлите Word или текстовый файл.',
  too_many: 'В файле больше 2000 вопросов, а в экзамен помещается 2000. Разделите файл и загрузите части в разные экзамены.',
  too_much_text: 'В файле больше 2 000 000 знаков. Разделите его на части и загрузите по очереди.',
  file_too_big: 'Файл больше 15 МБ. Сохраните его без картинок или разделите на части.',
  empty_file: 'Файл пустой. Выберите другой файл.',
  unreadable: 'Не удалось прочитать файл. Сохраните его заново в Word как DOCX и загрузите снова.',
  no_items: 'Не нашли вопросов. Проверьте, что в файле есть пронумерованные вопросы.',
  auth: 'Войдите в аккаунт и загрузите файл снова.',
  rate_limited: 'Много файлов за минуту. Подождите минуту и загрузите снова.',
  network: 'Нет связи с сервером. Проверьте интернет и загрузите файл снова.',
  unknown: 'Файл не прочитался. Попробуйте ещё раз.',
};

// ─────────────────────────────────────────────── the problem queue ───────────────────────────────────────────────

export const QUEUE = {
  title: 'Проверить',
  position: (at: number, of: number) => `${at} из ${of}`,
  done: 'Готово',
  context: (subject: string, label: string, topic: string | null) =>
    [subject, label ? `№ ${label}` : null, topic].filter(Boolean).join(' · '),
  pickKey: 'Какой вариант верный? Нажмите его.',
  pickKeys: 'Отметьте все верные варианты.',
  saveKeys: 'Сохранить ключ',
  pickDrop: 'Нажмите вариант, который нужно убрать.',
  noKey: 'Ответ в файле не отмечен. Отметьте верный, если знаете, или пропустите и вернитесь к нему позже.',
  several: (marked: number[]) => (marked.length >= 2 ? `В файле выделены ${marked.length === 2 ? 'два ответа' : 'несколько ответов'}: ${lettersText(marked)}.` : 'В файле выделено несколько ответов.'),
  bothRight: (n: number) => (n === 2 ? 'Верны оба' : 'Верны все'),
  keyConflict: 'Ключ списком и выделение в файле не совпадают.',
  keyInvalid: 'Ключ к этому вопросу не подходит к его вариантам.',
  keyLetter: 'Буква в ключе читается двояко: русская или латинская.',
  partial: 'Ответ в файле выделен не целиком.',
  noOptions: 'У вопроса нет вариантов.',
  fewOptions: 'Вариант всего один.',
  manyOptions: 'Вариантов больше восьми. Столько в занятии не поместится.',
  emptyOption: (at: number) => `Пустой вариант ${letter(at)}.`,
  sameOptions: (same: number[]) => `Варианты ${lettersText(same)} одинаковые.`,
  duplicate: (a: string, b: string) => `№ ${a} и № ${b} одинаковые.`,
  duplicateSame: 'Такой же вопрос в файле уже есть.',
  image: 'Картинка из файла не перенеслась. Без неё вопрос не попадёт в занятия.',
  // A picture that came, with a Word shape over it that did not (a red ring round an arrow, a box over a label).
  imageMark: 'Картинка перенеслась, а пометка поверх неё (стрелка, рамка, заливка из Word) нет. Без неё вопрос не попадёт в занятия.',
  tooLong: 'Текст длиннее предела: сохранится его начало.',
  keepOral: 'Оставить устным',
  keepOne: 'Оставить один',
  keepBoth: 'Оставить оба',
  imageOk: 'Вопрос понятен без картинки',
  keepAsIs: 'Оставить так',
  remove: 'Удалить вопрос',
  skip: 'Пропустить',
  empty: 'Проверять нечего.',
  finished: (fixed: number, of: number) => `Проверили ${fixed} из ${of}.`,
  code: 'Код',
  shortForms: 'Ответы через точку с запятой',
  saveForms: 'Сохранить ответы',
  emptyText: '(пусто)',
  tagKey: 'ключ',
  tagMarked: 'выделен',
  tagDropped: 'убран',
} as const;

// ───────────────────────────── the review of a file (import/BankReview.tsx) ─────────────────────────────

const units = (n: number) => count(n, 'единица', 'единицы', 'единиц');

/**
 * The review screen of one file: the questions the importer is unsure of, next to the file's lines, with one-press fixes.
 * The model pass is offered in plain words with its price; what the model read is labelled as such.
 */
export const REVIEW = {
  title: 'Сомнительные места',
  file: (name: string) => `Файл «${name}»`,
  counts: (total: number, doubtful: number, checked: number) =>
    nb([count(total, 'вопрос', 'вопроса', 'вопросов'), `сомнительных: ${doubtful}`, checked ? `проверено: ${checked}` : null].filter(Boolean).join(' · ')),
  onlyDoubtful: 'Только сомнительные',
  none: 'Сомнительных мест нет.',
  allChecked: 'Все сомнительные места проверены.',
  aiButton: 'Разобрать сложные места',
  aiNote: (n: number) => nb(`Отправим в модель только непонятные куски файла, ${units(n)}.`),
  aiResets: 'Правки на этой странице сбросятся.',
  aiRunning: 'Модель читает непонятные куски файла.',
  aiDone: (n: number) => nb(`Сложные места разобраны. Списано ${units(n)}.`),
  aiFailed: 'Не получилось разобрать сложные места. Остался разбор по правилам, попробуйте ещё раз.',
  aiBusy: 'Модель сейчас занята. Попробуйте через минуту.',
  fromModel: 'Прочитано моделью',
  same: 'Модель прочитала так же',
  differ: 'Модель прочитала иначе',
  modelOnly: 'Этот вопрос нашла только модель',
  keyRejected: 'Модель назвала ответ, но в файле он не отмечен, поэтому ключа нет.',
  takeModel: 'Взять версию модели',
  takeRules: 'Взять прежний разбор',
  other: (text: string) => `Другая версия: «${text}»`,
  /** Only the key differs: «Другая версия: ключ В вместо А», «… без ключа». */
  otherKey: (word: string, theirs: string, ours: string) =>
    theirs ? `Другая версия: ${word} ${theirs}${ours ? ` вместо ${ours}` : ''}` : 'Другая версия: без ключа',
  otherOptions: (list: string) => `Другая версия: варианты ${list}`,
  inFile: 'Как в файле',
  noFragment: 'Строк файла для этого вопроса нет.',
  picture: '[картинка]',
  cell: (cell: string) => {
    const m = /^T(\d+) R(\d+) C(\d+)$/.exec(cell);
    return m ? `табл. ${m[1]}, стр. ${m[2]}, кол. ${m[3]}` : cell;
  },
  number: (label: string, position: number) => (label ? `№ ${label}` : `Вопрос ${position}`),
  answer: 'Ответ:',
  noAnswer: 'Ответ не отмечен',
  pickKey: 'Нажмите верный вариант.',
  pickKeys: 'Нажмите все верные варианты.',
  mergeNext: 'Соединить со следующим',
  joinUp: 'Это вариант вопроса выше',
  splitHere: 'Отсюда новый вопрос',
  notQuestion: 'Это не вопрос',
  keep: 'Оставить как есть',
  checked: 'Проверено',
  undo: 'Отменить правку',
  done: 'Готово',
  back: 'Назад',
  pageLine: (name: string, n: number) =>
    nb(`В файле «${name}» ${count(n, 'сомнительное место', 'сомнительных места', 'сомнительных мест')}.`),
  pageGo: 'Посмотреть',
  doubts: {
    structure: 'С вариантами что-то не так: их мало, слишком много или они пустые.',
    option_merged: 'В вариант попал лишний текст: другой вариант, строка ответа или следующий вопрос.',
    stem_merged: 'В тексте вопроса, похоже, два вопроса.',
    options_in_stem: 'Варианты остались в тексте вопроса.',
    stem_fragment: 'Похоже на вариант вопроса выше, а не на отдельный вопрос.',
    options_unread: 'Под вопросом есть варианты, которые не прочитались.',
    options_count: 'Необычное число вариантов.',
    options_unlike: 'Вариантов не столько, сколько у соседних вопросов.',
    unnumbered: 'У вопроса нет номера, а у соседних есть.',
    open_among_choice: 'Вопрос без вариантов среди вопросов с вариантами.',
    joined_lines: 'Строки файла склеены: проверьте, где кончается вопрос.',
    no_key: 'Ответ в файле не отмечен.',
    key: 'Ключ в файле прочитан не наверняка.',
    key_split: 'Ответ в файле стоял у всего склеенного куска, а не у этого вопроса. Отметьте верный вариант.',
  } as Record<string, string>,
} as const;

// ─────────────────────────────────────────────── «Ключи» (the author) ───────────────────────────────────────────────

export const KEYS = {
  title: 'Вопросы и ключи',
  docTitle: 'Вопросы и ключи',
  noKeyRow: 'Без ключа',
  noKeyMeta: (n: number) => `${questions(n)} не ${n % 10 === 1 && n % 100 !== 11 ? 'идёт' : 'идут'} в занятия`,
  doubtsRow: 'Сомневаются в ключе',
  doubtsOwnRow: 'Отложены вами',
  manualRow: 'Ключ поставили вы',
  rowCount: (n: number) => questions(n),
  allGood: 'У всех вопросов есть ключ, сомнений нет.',
  check: (n: number) => `Проверить ${questions(n)}`,
  findTitle: 'Найти вопрос по номеру или словам',
  findSubject: 'Предмет',
  findNumber: 'Номер в файле или слова из вопроса',
  findPlaceholder: '134 или слова',
  notFound: (subject: string, no: string) => `В «${subject}» нет № ${no}.`,
  notFoundWords: (subject: string) => `В «${subject}» нет вопроса с этими словами.`,
  foundWords: (n: number, shown: number) => (n > shown ? `Нашлось ${questions(n)}, показаны первые ${shown}.` : `Нашлось ${questions(n)}.`),
  more: 'Показать ещё',
  edit: 'Изменить',
  add: 'Добавить вопрос',
  addContext: (subject: string, no: string) => `Новый вопрос · ${subject} · № ${no}`,
  added: (no: string) => `Вопрос № ${no} добавлен.`,
  edited: 'Сохранено.',
  editedReset: (group: boolean) =>
    group ? 'Сохранено. Счёт по этому вопросу начнётся заново, у вас и у группы.' : 'Сохранено. Счёт по этому вопросу начнётся заново.',
  twice: (n: number) => `Такой номер в предмете встречается ${n} раза: показан первый.`,
  current: (letters: string) => `Ключ сейчас: ${letters}.`,
  currentShort: (forms: string) => `Ключ сейчас: ${forms}.`,
  noKeyNow: 'Ключа пока нет.',
  doubters: (n: number) =>
    `${n % 10 === 1 && n % 100 !== 11 ? 'Сомневается' : 'Сомневаются'} ${count(n, 'участник', 'участника', 'участников')}.`,
  doubtOwn: 'Вы отложили этот вопрос. Его не будет в занятиях, пока вы не решите.',
  proposed: (letters: string) => `Предлагают: ${letters}.`,
  majority: (letters: string) => `Больше половины ответивших впервые выбрали один и тот же неверный вариант: ${letters}.`,
  notes: 'Комментарии',
  keep: 'Ключ верный',
  kept: 'Ключ оставлен. Вопрос снова в занятиях.',
  changed: (group: boolean) =>
    group ? 'Ключ изменён. Счёт по этому вопросу начнётся заново, у вас и у группы.' : 'Ключ изменён. Счёт по этому вопросу начнётся заново.',
  removeAsk: (label: string, group: boolean) =>
    `Удалить № ${label}? Ответы по нему пропадут${group ? ' у всех участников' : ''}.`,
  removeYes: 'Удалить',
  removeNo: 'Отмена',
  removed: 'Вопрос удалён.',
  savedKeep: 'Сохранено. Счёт по вопросу не сбрасывается.',
  queueEnd: 'Это все вопросы списка.',
  next: 'Дальше',
  loading: 'Загружаем вопросы…',
  authorOnly: 'Вопросы и ключи правит автор экзамена. Если ключ кажется неверным, нажмите «Сомневаюсь в ключе» после ответа.',
  toExam: 'К экзамену',
  loadFailed: 'Вопросы не загрузились. Проверьте связь и обновите страницу.',
  retry: 'Повторить',
} as const;

// ─────────────────────────────────────────────── «Настройки» ───────────────────────────────────────────────

export const SETTINGS = {
  title: 'Настройки',
  docTitle: 'Настройки экзамена',
  name: 'Название',
  date: 'Дата экзамена',
  dates: 'У предметов разные даты',
  oneDate: 'Одна дата для всех',
  oralDate: 'дата на странице предмета',
  noDate: 'Дата не указана. Пока по 15 новых вопросов в день на предмет.',
  minutes: 'Время в день',
  // A member has «Моя дата экзамена» too (release 47): «Даты ставит автор экзамена» is no longer the whole truth.
  minutesMember: 'Время в день и дни занятий видите только вы.',
  // Spec §3: the student sets «минуты и дни недели» (usability check m6).
  days: 'Дни занятий',
  dayShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  dayFull: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
  daysLeast: 'Нужен хотя бы один день занятий.',
  // The lines under «Время в день» are the plan's own (lib/containers/words.ts: need, short, short_max, window_ahead).
  more: 'Подробнее',
  subjects: 'Предметы',
  addSubject: 'Добавить предмет',
  subjectMore: (title: string) => `Ещё: ${title}`,
  rename: 'Переименовать',
  renameDone: 'Готово',
  renameCancel: 'Отмена',
  removeSubject: 'Убрать предмет',
  removeSubjectAsk: (title: string) => `Убрать «${title}»? Его вопросы и ответы по ним пропадут.`,
  removeOralAsk: (title: string) => `Убрать «${title}» из экзамена? Устный предмет останется в «Экзаменах» отдельно.`,
  removeMixedAsk: (title: string) =>
    `Убрать «${title}»? Вопросы с вариантами и ответы по ним пропадут, устная часть останется в «Экзаменах» отдельно.`,
  removeSubjectYes: 'Убрать',
  lastSubject: 'Это единственный предмет. Чтобы убрать его, удалите экзамен.',
  oralRow: 'устный',
  group: 'Группа',
  invite: 'Пригласить группу',
  who: 'Кто вошёл',
  remove: 'Удалить экзамен',
  removeAsk: (title: string, oral: boolean) =>
    `Удалить «${title}»? Вопросы, ответы и прогресс пропадут.${oral ? ' Устные предметы останутся в «Экзаменах» отдельно.' : ''}`,
  removeYes: 'Удалить экзамен',
  removeNo: 'Отмена',
  hasMembers: (n: number) =>
    `Сначала уберите участников: в экзамене ${count(n, 'участник', 'участника', 'участников')}. Тогда экзамен можно будет удалить.`,
  leave: 'Выйти из экзамена',
  leaveAsk: (title: string) => `Выйти из «${title}»? Ваши ответы сохранятся: если войдёте снова по ссылке, продолжите с того же места.`,
  leaveYes: 'Выйти',
  // «Моя дата экзамена» (release 47): a member's own date, or the author's after «Только для меня».
  ownDate: 'Моя дата экзамена',
  ownDateClear: 'Убрать',
  ownDateNote: (authorDay: string) => (authorDay ? `Только для вас. У автора ${authorDay}.` : 'Только для вас. У автора дата не указана.'),
  ownDateNoteOwner: (commonDay: string) => (commonDay ? `Только для вас. У участников ${commonDay}.` : 'Только для вас.'),
  ownDatePast: 'Нужна дата не раньше сегодняшней.',
  ownDateRange: 'Нужна дата не раньше сегодняшней и не дальше чем через два года.',
  ownDateCleared: 'Ваша дата убрана.',
  save: 'Сохранить',
  saving: 'Сохраняем…',
  saved: 'Сохранено.',
  nameMissing: 'Назовите экзамен.',
  loadFailed: 'Настройки не загрузились. Проверьте связь и обновите страницу.',
  retry: 'Повторить',
} as const;

// ─────────────────────────────────────────────── «Пригласить группу» ───────────────────────────────────────────────

export const INVITE = {
  title: 'Пригласить группу',
  close: 'Закрыть',
  lede: (subjectCount: number, questionCount: number) =>
    `По ссылке каждый получит весь экзамен: ${subjectCount > 1 ? `${subjects(subjectCount)}, ` : ''}${questions(questionCount)}. Прогресс у каждого свой, а исправленный вами ключ придёт всем.`,
  noKey: (n: number) =>
    n % 10 === 1 && n % 100 !== 11
      ? `${questions(n)} пока без ключа: участникам он придёт, когда вы отметите ответ.`
      : `${questions(n)} пока без ключа: участникам они придут, когда вы отметите ответ.`,
  consent: 'Делюсь с группой вопросами, ключами из файлов, текстом моих лекций и пунктами ответа. Мои ответы и прогресс никто не увидит.',
  create: 'Создать ссылку',
  creating: 'Создаём ссылку…',
  linkLabel: 'Ссылка для группы',
  copy: 'Скопировать',
  copied: 'Скопировано',
  textLabel: 'Текст для беседы группы',
  copyText: 'Скопировать текст',
  message: (title: string, subjectCount: number, questionCount: number, url: string) =>
    `Готовимся вместе в Meldy: «${title}», ${subjectCount > 1 ? `${subjects(subjectCount)}, ` : ''}${questions(questionCount)}. Ссылка: ${url}`,
  once: 'Meldy не хранит саму ссылку. Она останется только на этом устройстве. Если потеряете её, создайте новую, а эту закройте.',
  onceLost: 'Ссылку видно только сейчас, Meldy её не хранит. Если потеряете, создайте новую, а эту закройте.',
  openElsewhere: 'Ссылка открыта, но сама она осталась на устройстве, где её создали.',
  // Said before «Создать новую ссылку» is pressed: the new link closes every open one (usability check M2).
  newLinkNote: 'Новая ссылка заменит открытую: по старой больше никто не войдёт.',
  newLink: 'Создать новую ссылку',
  // A link whose seats are all taken (decision 52 counted them under the link; the one group line now counts who is in):
  // nobody else can come in by it, so the way on is a new link.
  full: (seats: number) => `Мест по этой ссылке больше нет: заняты все ${seats}.`,
  who: 'Кто вошёл',
  revoke: 'Закрыть ссылку',
  revokeAsk: 'По ней больше никто не войдёт. Кто уже вошёл, останется в экзамене.',
  revokeYes: 'Да, закрыть',
  revokeNo: 'Отмена',
  revoked: 'Ссылка закрыта. По ней больше никто не войдёт.',
  /** The link as a QR over the whole screen (release 47.3; lib/quizzes/qr.ts draws it on the device). */
  qr: 'Показать QR',
  qrTitle: 'QR-код ссылки для группы',
  qrHint: 'Наведите камеру телефона на код или наберите адрес.',
  qrClose: 'Закрыть',
  copiedLink: 'Ссылка скопирована.',
  copiedText: 'Текст скопирован.',
  copyFailed: 'Не получилось скопировать: выделите текст и скопируйте его сами.',
  made: 'Ссылка создана. Отправьте её группе.',
  errors: {
    MC007: 'Открытых ссылок может быть до 10. Закройте одну из старых.',
    MC008: 'Отметьте согласие: в экзамене есть устные предметы.',
    '22023': 'Пока делиться нечем: ни у одного вопроса нет ключа.',
    network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  } as Record<string, string>,
  failed: 'Ссылка не создалась. Попробуйте ещё раз.',
} as const;

export const MEMBERS = {
  title: 'Кто вошёл',
  // The group's one line, the same in «Пригласить группу» and «Настройки» (usability check m3): who is in the exam now,
  // never the seats of one link; «Пока никто не вошёл» only before anyone came in.
  inExam: (active: number, ever: boolean) =>
    active > 0
      ? `В экзамене ${count(active, 'участник', 'участника', 'участников')}`
      : ever
        ? 'Сейчас в экзамене никого'
        : 'Пока никто не вошёл',
  empty: 'Пока никто не вошёл.',
  // Nobody to list: everyone who came in left on their own (they are not listed; a left member rejoins by a link).
  allLeft: 'Все вышли сами. Вернуться они могут по ссылке.',
  since: (day: string) => `с ${day}`,
  remove: 'Убрать',
  removeAsk: (name: string) => `Убрать из экзамена: ${name}? Экзамен у участника пропадёт, его ответы останутся у него.`,
  removeYes: 'Убрать',
  removeNo: 'Отмена',
  removedTitle: 'Убраны',
  restore: 'Вернуть',
  removeAll: 'Убрать всех',
  removeAllAsk: (n: number) => `Убрать всех: ${count(n, 'участника', 'участников', 'участников')}? Экзамен у них пропадёт, ответы останутся у них.`,
  noName: 'Без имени',
  loadFailed: 'Список не загрузился. Попробуйте ещё раз.',
  retry: 'Повторить',
} as const;

/**
 * The address of an exam (or a test) that is no longer the user's (P0002: the database says «not found» to a
 * non-member): the author deleted it, the member left, or the author removed them. Another try changes nothing, so no
 * «Повторить» (usability check m2).
 *
 * The server says nothing of a container that is gone, so an old address says neutral words (live check of release
 * 47.2: a deleted test's address said «Этого экзамена…»). Where the page knows the kind (its summary read before),
 * the words name it: GONE_EXAM here, a test's in components/test/copyTest.ts (goneWords picks).
 */
export const GONE = {
  title: 'Этой страницы больше нет в вашем списке',
  text: 'Её удалили, или вы больше не участник: вышли сами или автор убрал вас.',
} as const;
export const GONE_EXAM = {
  title: 'Этого экзамена больше нет в вашем списке',
  text: 'Его удалили, вы из него вышли или автор убрал вас.',
} as const;

// ─────────────────────────────────────────────── /g/<код> (no «копия» here: spec §16 #52) ───────────────────────────────

export const JOIN = {
  docTitle: 'Приглашение к экзамену',
  title: (title: string) => `Вас пригласили готовиться к экзамену «${title}» в Meldy`,
  // Each part holds together, so a phone breaks the line only after «·» (as on /join).
  meta: (subjectCount: number, questionCount: number, day: string | null) =>
    [
      [subjectCount > 1 ? subjects(subjectCount) : null, questionCount > 0 ? questions(questionCount) : null].filter(Boolean).join(', '),
      day ? `экзамен ${day}` : null,
    ]
      .filter(Boolean)
      .map((part) => (part as string).replace(/\s/g, NBSP))
      .join(`${NBSP}· `),
  lede: 'Вопросы и ключи из файлов автора, его исправления придут и вам. Ваши ответы и прогресс не видит никто. Автор увидит только ваше имя среди вошедших.',
  oral: 'С устными предметами придут текст лекций автора и пункты ответа.',
  google: 'Войти через Google',
  or: 'или',
  mail: 'Войти по почте',
  mailHere: 'Войти по почте здесь',
  register: 'Создать аккаунт',
  opening: 'Открываем экзамен…',
  loading: 'Открываем приглашение…',
  failedTitle: 'Приглашение не открылось',
  own: 'Это ваша ссылка',
  ownLede: 'Однокурсники, которые по ней войдут, получат весь экзамен. Их ответов и прогресса вы не увидите, только имена.',
  openExam: 'Открыть экзамен',
  unreadable: 'Ссылка не распознана. Проверьте, что она пришла целиком, или попросите прислать её ещё раз.',
  // A link the database does not know: its exam was deleted (the links go with it) or the code came cut. A closed link
  // is not this: it says «revoked» (usability check m10).
  status: {
    not_found: 'Ссылка не работает: экзамен удалили или она пришла не целиком.',
    revoked: 'Автор закрыл эту ссылку. Попросите у него новую.',
    expired: 'Срок действия ссылки закончился. Попросите у автора новую.',
    full: 'По этой ссылке мест больше нет: все места заняты.',
    removed: 'Автор убрал вас из этого экзамена. Если это ошибка, попросите его вернуть вас.',
  } as Record<string, string>,
  errors: {
    MC001: 'Ссылка не работает: экзамен удалили или она пришла не целиком.',
    MC002: 'Автор закрыл эту ссылку. Попросите у него новую.',
    MC003: 'Срок действия ссылки закончился. Попросите у автора новую.',
    MC004: 'По этой ссылке мест больше нет: все места заняты.',
    MC005: 'Это ваша ссылка: экзамен уже ваш.',
    MC006: 'Автор убрал вас из этого экзамена. Если это ошибка, попросите его вернуть вас.',
    network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  } as Record<string, string>,
  failed: 'Не получилось открыть экзамен. Попробуйте ещё раз.',
  retry: 'Попробовать ещё раз',
  today: 'На «Сегодня»',
  example: 'Попробовать на примере',
  what: 'Что такое Meldy',
} as const;

// ─────────────────────────────────────────────── errors of the container functions ───────────────────────────────

/** SQLSTATEs of spec §8 in the words of these screens (the API layer's own text is the fallback). */
export const RPC_ERRORS: Record<string, string> = {
  MC007: 'В экзамене помещается 20 предметов и 2000 вопросов с вариантами.',
  MC009: 'В экзамене есть участники. Сначала уберите их — тогда экзамен можно будет удалить.',
  '42501': 'Это может изменить только автор экзамена.',
  P0002: 'Экзамен не найден: возможно, его уже удалили.',
  '22023': 'Сервер не принял данные. Обновите страницу и попробуйте ещё раз.',
  '28000': 'Войдите в аккаунт и попробуйте ещё раз.',
  network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  unavailable: 'Экзамены с предметами пока недоступны на сервере.',
};

/** The Russian line for an error of the container API: ours by code, else the API's own message. */
export function errorText(error: unknown, table: Record<string, string> = RPC_ERRORS, fallback = 'Не получилось. Попробуйте ещё раз.'): string {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
  if (code && table[code]) return table[code];
  if (code && RPC_ERRORS[code]) return RPC_ERRORS[code];
  const message = error instanceof Error ? error.message.trim() : '';
  // An English text from a layer that did not translate it is never shown.
  return message && /[а-яё]/i.test(message) ? message : fallback;
}
