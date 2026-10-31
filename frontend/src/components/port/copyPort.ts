/**
 * The words of release 49's «Скачать тест файлом», «Сгенерировать вопросы» and «Тест из лекции» (spec meldy-notes
 * 10_Project/Test_Builder_Spec_2026-10-18.md, «Выпуск 49»). Plain Russian, numbers glued to their words (nb).
 */
import { NBSP, count, nb, plural } from '../containers/copyImport';
import type { ExportFormat } from '../../api/testPort';

const questions = (n: number) => count(n, 'вопрос', 'вопроса', 'вопросов');
/** «1 вопрос … вошёл», «21 вопрос … вошёл», но «11 вопросов … вошли». */
const one = (n: number) => n % 10 === 1 && n % 100 !== 11;
const ofQuestions = (n: number) => `${n}${NBSP}${plural(n, 'вопроса', 'вопросов', 'вопросов')}`;

export const PORT = {
  // ── export
  exportOpen: 'Скачать',
  exportOpenLong: 'Скачать тест файлом',
  exportTitle: 'Скачать тест файлом',
  exportLead: 'Файл откроет Moodle, другая система тестов или Kahoot. Тест в Meldy останется как есть.',
  formatsLabel: 'Формат файла',
  formats: {
    moodle: { name: 'Moodle XML', lead: 'Все виды вопросов: для Moodle и систем, которые читают этот формат.' },
    gift: { name: 'GIFT', lead: 'Текстовый формат Moodle. Без вопросов на порядок; пропуск — один на вопрос.' },
    aiken: { name: 'Aiken', lead: 'Простой текст. Только вопросы с одним верным ответом, без пояснений.' },
    kahoot: { name: 'Kahoot', lead: 'Таблица для импорта в Kahoot: вопросы с двумя–четырьмя вариантами.' },
  } satisfies Record<ExportFormat, { name: string; lead: string }>,
  counting: 'Смотрим, что войдёт в файл…',
  willGo: (n: number, total: number) =>
    nb(n === total ? `В файл войдут все ${questions(n)}.` : `В файл ${one(n) ? 'войдёт' : 'войдут'} ${n} из ${ofQuestions(total)}.`),
  noneGo: 'Ни один вопрос не подходит для этого формата.',
  left: 'Не войдут:',
  leftLine: (number: string, reason: string) => nb(`№ ${number} — ${reason}`),
  picturesLost: (n: number) => nb(`Картинки в файл не переносятся: ${questions(n)} уйдут без них.`),
  download: 'Скачать файл',
  downloaded: (name: string) => `Файл «${name}» скачан.`,
  noItems: 'В тесте пока нет вопросов.',
  // ── generate
  generateOpen: 'Сгенерировать из лекции, текста или файла',
  generateShort: 'Сгенерировать',
  generateTitle: 'Сгенерировать вопросы',
  generateLead: 'Вопросы с одним верным ответом. У каждого — фраза из текста, по которой сверен ответ.',
  sourcesLabel: 'Откуда',
  sources: { lecture: 'Из лекции', text: 'Из текста', file: 'Из файла' },
  lecture: 'Лекция',
  lectureNone: 'Лекция не выбрана',
  lecturesLoading: 'Загружаем лекции…',
  noLectures: 'Лекций пока нет. Вставьте текст или выберите файл.',
  text: 'Текст',
  textHint: 'Абзац или несколько. Вопросы будут только о том, что в тексте есть.',
  file: 'Файл',
  fileHint: 'PDF, Word, PowerPoint, TXT, MD или HTML с текстом. Сканы не подойдут.',
  fileChosen: (name: string) => `Выбран файл «${name}»`,
  countLabel: 'Сколько вопросов',
  cost: (units: number) =>
    nb(`Спишет ${count(units, 'единицу', 'единицы', 'единиц')} дневного лимита ИИ. Если ни один вопрос не сверится с текстом, единицы вернутся.`),
  run: 'Сгенерировать',
  running: 'Составляем вопросы и сверяем ответы с текстом. Это около минуты.',
  found: (n: number, dropped: number) =>
    nb(`Готово: ${questions(n)}.${dropped > 0 ? ` Ещё ${dropped} ${one(dropped) ? 'не вошёл: его' : 'не вошли: их'} ответа нет в тексте.` : ''}`),
  again: 'Начать заново',
  // ── the list of questions to add
  checked: 'Ответ сверен с фразой',
  doubt: 'Проверьте ответ: фраза подходит не только к нему',
  right: 'верный',
  pick: (n: number) => (n > 0 ? nb(`Добавить ${questions(n)} в тест`) : 'Отметьте вопросы'),
  adding: 'Добавляем…',
  added: (n: number) => nb(`${questions(n)} в конце теста.`),
  // ── lecture → test
  lectureMake: 'Сделать контрольную',
  lectureAdd: 'Добавить в тест',
  lectureLead: 'Вопросы самопроверки с пояснением и фразой из лекции.',
  lectureTitle: 'Вопросы из лекции',
  lectureLoading: 'Собираем вопросы и сверяем ответы с лекцией…',
  lectureDropped: (n: number) => nb(`${questions(n)} ${one(n) ? 'не вошёл: его' : 'не вошли: их'} ответа нет в тексте лекции.`),
  testsLabel: 'В какой тест',
  testsLoading: 'Загружаем ваши тесты…',
  noTests: 'Своих тестов пока нет. Нажмите «Сделать контрольную» — тест появится.',
  makeGo: 'Сделать контрольную',
  making: 'Сохраняем тест…',
  addedTo: (n: number, title: string) => nb(`${questions(n)} ${one(n) ? 'добавлен' : 'добавлены'} в тест «${title}».`),
  openStudio: 'Открыть в студии',
  failed: 'Не получилось. Повторите через минуту.',
  close: 'Закрыть',
} as const;
