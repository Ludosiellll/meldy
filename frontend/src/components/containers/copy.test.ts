import { describe, expect, it } from 'vitest';
import source from './copy.ts?raw';
import * as copy from './copy';
import { SETTINGS } from './copyImport';
import { comesBackWhen } from './model';

/**
 * Spec 2026-10-09 §16 #45: one source of the screens' words, and a test that fails on the banned ones — «контейнер»,
 * «тест» (as the content's name), «повторени», «на проверку», «спорн», «пробн», «засчитан», «сгорел», «готов на»,
 * «выучен», «сдашь», «отстаёте», «преподавател», «колледж», «аккредитац», «копи». Stricter forms ride along: «засчит»
 * (any form, §16 #55 rejected «засчитан(о)»), «сгор», «по сроку», «правильный ответ», «верный ответ —», «Нажал не туда».
 */
const BANNED: Array<[string, RegExp]> = [
  ['контейнер', /контейнер/i],
  ['тест', /тест/i],
  ['повторени', /повторени/i],
  ['на проверку', /на проверку/i],
  ['спорн', /спорн/i],
  ['пробн', /пробн/i],
  ['засчитан / засчит', /засчит/i],
  ['сгорел / сгор', /сгор/i],
  ['готов на', /готов на/i],
  ['сдашь', /сдашь/i],
  ['отстаёте', /отста[её]те/i],
  ['преподавател', /преподавател/i],
  ['колледж', /колледж/i],
  ['аккредитац', /аккредитац/i],
  ['копи', /копи/i],
  ['по сроку', /по сроку/i],
  ['правильный ответ', /правильн\S* ответ/i],
  ['верный ответ —', /верный ответ\s*—/i],
  ['Нажал не туда (без «и»)', /нажал не туда/i],
];

/**
 * The owner's plain words (2026-10-21, Decision Log): the result, not the counting rule or our own terms. «выучен»
 * left the banned list that day («Выучено 46 вопросов из 240»); these joined it, for every rendered line.
 */
const PLAIN_WORDS: Array<[string, RegExp]> = [
  ['в счёт / в счёте', /в счёт/i],
  ['вернётся / вернутся', /вернётся|вернутся/i],
  ['верно с первого раза', /с первого раза/i],
  ['ошибок сейчас', /ошибок сейчас/i],
  ['подсмотр', /подсмотр/i],
  ['по правилу', /по правилу/i],
  ['Теперь N из M — верно в два разных дня', /— верно в два разных дня/i],
];

/** Every string the module can say: its constants and its functions called with typical arguments. */
function rendered(): string[] {
  const out: string[] = [];
  const argSets: unknown[][] = [
    [],
    [1],
    [2],
    [5],
    [21],
    [1, 1],
    [2, 3],
    [5, 20],
    [12, 40, 'после'],
    ['28 октября', 19],
    ['28 октября', -1],
    ['28 октября', 0],
    ['28 октября', 1],
    ['25 октября', '28 октября', 15],
    ['28 октября · 960 вопросов', 960, 4],
    [90, 45, false],
    [70, 35, true],
    [{ newItems: 30, reviews: 60, oral: 10 }],
    [{ twoDays: 61, keyed: 240, seen: 180, today: 25, dateText: '12 января', passed: false }],
    [{ twoDays: 0, inPlan: 0, questions: 120, today: 0, dateText: null }],
    [{ twoDays: 0, inPlan: 16, questions: 20, today: 16, dateText: '21 октября' }],
    ['21 октября', null],
    [{ twoDays: 12, keyed: 18, seen: 18, errors: 2 }],
    [{ keyed: 20, twoDays: 8, errors: 3 }],
    [['А', 'В'], true],
    [['Г'], false],
    ['Invoke', true],
    [45, '28 октября', 700, 960],
    [38, 40, [7, 22]],
    [40, 40, []],
    [12, 40, '18:40'],
    [9, 2],
    [1, 0],
    [3, '19:00'],
    [3, null],
    ['17:00'],
    [null],
    [6, 3, 1],
    ['15 октября', 31, 40],
    [34, 40],
    [[5, 12, 25, 50]],
    ['Базы данных', 20],
    ['37'],
    [true],
    [false],
  ];
  for (const value of Object.values(copy)) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) out.push(...value.map(String));
    else if (typeof value === 'function') {
      for (const args of argSets) {
        try {
          const result = (value as (...a: unknown[]) => unknown)(...args);
          if (typeof result === 'string') out.push(result);
          else if (Array.isArray(result)) out.push(...result.filter((part): part is string => typeof part === 'string'));
        } catch {
          // Arguments of another shape: other sets cover it.
        }
      }
    }
  }
  return out;
}

describe('copy.ts: the words of the exam screens', () => {
  it('has none of the banned words in its source', () => {
    // «Верный ответ — …» is said for a key the author set, never for the file's (release 47, M10: «В файле» would
    // claim a file that does not exist); the lines rendered below, with the file's key, still may not say it.
    for (const [name, pattern] of BANNED.filter(([word]) => word !== 'верный ответ —')) {
      const line = source.split('\n').find((text) => pattern.test(text));
      expect(line, `«${name}» in copy.ts: ${line}`).toBeUndefined();
    }
  });

  it('says none of them in any line it renders', () => {
    const lines = rendered();
    expect(lines.length).toBeGreaterThan(150);
    for (const [name, pattern] of [...BANNED, ...PLAIN_WORDS]) {
      const hit = lines.find((text) => pattern.test(text));
      expect(hit, `«${name}» rendered: ${hit}`).toBeUndefined();
    }
  });

  it('names the figure «выучено» (the owner, 2026-10-21) and calls the content «экзамен»', () => {
    expect(copy.TWO_DAYS).toBe('выучено');
    expect(copy.nowFigure(147, 960).split(copy.NBSP).join(' ')).toBe('Выучено 147 вопросов из 960');
    expect(copy.nowFigure(21, 960).split(copy.NBSP).join(' ')).toBe('Выучен 21 вопрос из 960');
    expect(copy.nowFigure(3, 960).split(copy.NBSP).join(' ')).toBe('Выучено 3 вопроса из 960');
    expect(copy.rightIn(17, 20, 11).split(copy.NBSP).join(' ')).toBe('17 из 20 верно за 11 минут');
    expect(copy.MISCLICK).toBe('Нажали не туда?');
    expect(copy.DOUBT).toBe('Сомневаюсь в ключе');
    expect(copy.KEY_WRONG).toBe('Ключ неверный?');
    expect(copy.MULTIPLE_HINT.split(copy.NBSP).join(' ')).toBe('Верных ответов несколько — отметьте все.');
  });

  it('glues numbers to their words and keeps the Russian plurals', () => {
    expect(copy.q(1)).toBe('1 вопрос');
    expect(copy.q(3)).toBe('3 вопроса');
    expect(copy.q(11)).toBe('11 вопросов');
    expect(copy.q(21)).toBe('21 вопрос');
    expect(copy.glue('Сегодня 90 вопросов')).toBe(`Сегодня 90${copy.NBSP}вопросов`);
    expect(copy.paceSet(45)).toBe('Поставить 45');
    expect(copy.paceKeep(60)).toBe('Оставить 60');
    expect(copy.sessionTime(20, 0, 11).split(copy.NBSP).join(' ')).toBe('20 вопросов за 11 минут');
    expect(copy.sessionTime(20, 7, 21).split(copy.NBSP).join(' ')).toBe('20 вопросов и 7 повторов за 21 минуту');
    expect(copy.noKeyLine(4).split(copy.NBSP).join(' ')).toBe('4 вопроса без ключа не попадут в занятия.');
    expect(copy.noKeyLine(1).split(copy.NBSP).join(' ')).toBe('1 вопрос без ключа не попадёт в занятия.');
    expect(copy.keyFixedLine(1).split(copy.NBSP).join(' ')).toBe('Автор исправил ключ в 1 вопросе. Его нужно выучить заново.');
    expect(copy.keyFixedLine(2).split(copy.NBSP).join(' ')).toBe('Автор исправил ключ в 2 вопросах. Их нужно выучить заново.');
    expect(copy.mockFinishLine(38, 40, [7, 22]).split(copy.NBSP).join(' ')).toBe('Ответили на 38 из 40. Вопросы 7 и 22 без ответа, они будут ошибками.');
    // the end of a session: what comes back, «завтра» or the next study day (settings.study_weekdays)
    const ends = (text: string) => text.split(copy.NBSP).join(' ');
    expect(ends(copy.errorsBack(1))).toBe('1 ошибку повторим завтра.');
    expect(ends(copy.errorsBack(3, '12 октября'))).toBe('3 ошибки повторим 12 октября.');
    expect(ends(copy.firstCountLine('17:00'))).toBe('Ответьте верно ещё раз завтра после 17:00, и первые вопросы будут выучены.');
    expect(ends(copy.firstCountLine(null, '12 октября'))).toBe('Ответьте верно ещё раз 12 октября, и первые вопросы будут выучены.');
    expect(ends(copy.tooEarlyLine(2, null, '12 октября'))).toBe('2 вопроса ещё не выучены, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз 12 октября.');
    expect(ends(copy.tooEarlyLine(1, '18:05'))).toBe('1 вопрос ещё не выучен, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз после 18:05.');
    expect(ends(copy.studyDaysRow(31))).toBe('Дни занятий: Пн–Пт');
    expect(ends(copy.studyDaysRow(1 + 4 + 16 + 32))).toBe('Дни занятий: Пн, Ср, Пт, Сб');
    expect(ends(copy.studyDaysRow(96))).toBe('Дни занятий: Сб, Вс');
    expect(ends(copy.studyDaysRow(63 + 64 - 2))).toBe('Дни занятий: Пн, Ср–Вс');
    // the key in the file's own words, as the bot says it («В файле — DHCP»), never a letter of the shuffled screen (m2)
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    expect(plain(copy.verdictWrong(['7 12'], true))).toBe('Неверно. В файле — 7 12. Повторим через пару вопросов и завтра.');
    expect(plain(copy.verdictDontKnow(['DHCP'], false))).toBe('В файле — DHCP. Повторим завтра.');
    expect(plain(copy.verdictWrong(['string', 'object'], false))).toBe('Неверно. В файле верны: string и object. Повторим завтра.');
    expect(plain(copy.verdictWrong(['Параллельные транзакции не видят…'], false))).toBe('Неверно. В файле — Параллельные транзакции не видят… Повторим завтра.');
    expect(plain(copy.verdictShortWrong('ROLLBACK', true))).toBe('Неверно. В файле — ROLLBACK. Повторим через пару вопросов и завтра.');
    expect(plain(copy.shortDontKnow('32', false))).toBe('В файле — 32. Повторим завтра.');
    // several long ones: the options marked above
    const long = ['Транзакция выполняется целиком', 'Изменения сохраняются даже после сбоя', 'Данные остаются согласованными'];
    expect(plain(copy.verdictWrong(long, false))).toBe('Неверно. В файле верны 3 варианта, они отмечены выше. Повторим завтра.');
    // the file's key, said with its source: as before
    expect(plain(copy.verdictWrong(['7 12'], true, undefined, 'bold'))).toBe('Неверно. В файле — 7 12. Повторим через пару вопросов и завтра.');
    expect(plain(copy.verdictDontKnow(['DHCP'], false, undefined, 'key_list'))).toBe('В файле — DHCP. Повторим завтра.');
    expect(plain(copy.startSubject('Базы данных', 17))).toBe('Начать: Базы данных, 17 вопросов');
    expect(plain(copy.aloudSubject('Гражданское право', 3))).toBe('Ответить вслух: Гражданское право, 3 вопроса');
  });

  it('a key the author set is no file’s: «Верный ответ — …» (release 47, M10)', () => {
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    expect(plain(copy.verdictWrong(['7 12'], true, undefined, 'manual'))).toBe('Неверно. Верный ответ — 7 12. Повторим через пару вопросов и завтра.');
    expect(plain(copy.verdictDontKnow(['DHCP'], false, 'в понедельник', 'manual'))).toBe('Верный ответ — DHCP. Повторим в понедельник.');
    expect(plain(copy.verdictWrong(['string', 'object'], false, undefined, 'key_text'))).toBe('Неверно. Верные ответы: string и object. Повторим завтра.');
    expect(plain(copy.verdictShortWrong('ROLLBACK', false, undefined, 'manual'))).toBe('Неверно. Верный ответ — ROLLBACK. Повторим завтра.');
    expect(plain(copy.shortDontKnow('32', false, undefined, 'none'))).toBe('Верный ответ — 32. Повторим завтра.');
    const long = ['Транзакция выполняется целиком', 'Изменения сохраняются даже после сбоя', 'Данные остаются согласованными'];
    expect(plain(copy.verdictWrong(long, false, undefined, 'manual'))).toBe('Неверно. Верны 3 варианта, они отмечены выше. Повторим завтра.');
    // the tag beside the key after an answer
    expect(copy.keyTag('manual')).toBe('Верный ответ');
    expect(copy.keyTag('bold')).toBe(copy.TAG_FILE);
    expect(copy.keyTag(undefined)).toBe(copy.TAG_FILE);
    // a key from the file's marks, key column, key list or markup, or «первый вариант»: «В файле»
    for (const source of ['bold', 'underline', 'italic', 'color', 'highlight', 'shade', 'marker', 'key_column', 'answer_line', 'key_list', 'gift', 'first_option']) {
      expect(copy.keyFromFile(source), source).toBe(true);
    }
    for (const source of ['manual', 'key_text', 'none']) expect(copy.keyFromFile(source), source).toBe(false);
  });

  it('an oral subject’s row says it is oral, in the word «Настройки» uses (usability check 2026-10-10, m7)', () => {
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    // The QA's row read «0 из 16 · сегодня 16», like a subject with variants.
    expect(plain(copy.subjectRowOral({ twoDays: 0, seen: 0, inPlan: 16, questions: 20, today: 16, dateText: null }))).toBe('устный · 16 вопросов · сегодня 16');
    expect(plain(copy.subjectRowOral({ twoDays: 3, seen: 9, inPlan: 16, questions: 20, today: 0, dateText: '25 октября' }))).toBe('устный · 25 октября · видели 9 из 16 · выучено 3');
    // none in the plan yet: «устных» says it
    expect(plain(copy.subjectRowOral({ twoDays: 0, seen: 0, inPlan: 0, questions: 60, today: 0, dateText: null }))).toBe('60 устных · нужны лекции');
    expect(copy.ORAL_ROW).toBe(SETTINGS.oralRow);
    // a subject with variants stays as it was
    expect(plain(copy.subjectRowTest({ twoDays: 0, keyed: 14, seen: 0, today: 7, dateText: null, passed: false }))).toBe('14 вопросов · сегодня 7');
  });

  it('a row names what its numbers count: «0 из 373» after 40 answers read as «nothing seen» (the owner, 2026-10-14)', () => {
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    expect(plain(copy.subjectRowTest({ twoDays: 0, keyed: 373, seen: 40, today: 147, dateText: null, passed: false }))).toBe('видели 40 из 373 · сегодня 147');
    expect(plain(copy.subjectRowTest({ twoDays: 12, keyed: 373, seen: 200, today: 90, dateText: null, passed: false }))).toBe('видели 200 из 373 · выучено 12 · сегодня 90');
    expect(plain(copy.topicRow({ twoDays: 0, keyed: 27, seen: 0, errors: 0 }))).toBe('не начинали');
    expect(plain(copy.topicRow({ twoDays: 2, keyed: 27, seen: 10, errors: 3 }))).toBe('видели 10 из 27 · выучено 2 · 3 ошибки');
  });

  it('«Сегодня»: the date and the exam’s one size, or the date alone while the size is not known (m6)', () => {
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    expect(plain(copy.todayMeta('21 октября', 54))).toBe('21 октября · 54 вопроса');
    expect(plain(copy.todayMeta('21 октября', null))).toBe('21 октября');
    expect(plain(copy.todayMeta(null, 54))).toBe('54 вопроса');
    expect(copy.todayMeta(null, null)).toBe('');
  });

  it('a mistake comes back on the next study day: every day the same bytes as «завтра» always said, else its day', () => {
    // Every day (127): exactly the lines as they were before the days of the week.
    const tomorrow = comesBackWhen('2026-10-09', 127);
    expect(tomorrow).toBe('завтра');
    expect(copy.verdictWrong(['7 12'], true, tomorrow)).toBe(copy.glue('Неверно. В файле — 7 12. Повторим через пару вопросов и завтра.'));
    expect(copy.verdictDontKnow(['DHCP'], false, tomorrow)).toBe(copy.glue('В файле — DHCP. Повторим завтра.'));
    expect(copy.verdictShortWrong('ROLLBACK', false, tomorrow)).toBe(copy.glue('Неверно. В файле — ROLLBACK. Повторим завтра.'));
    expect(copy.shortDontKnow('32', true, tomorrow)).toBe(copy.glue('В файле — 32. Повторим через пару вопросов и завтра.'));
    expect(copy.misclickLine(tomorrow)).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому повторим вопрос завтра.');
    expect(copy.misclickLine()).toBe(copy.misclickLine(tomorrow));
    expect(copy.mockErrors(1, 0, tomorrow)).toBe(copy.glue('1 ошибка. Повторим её завтра.'));
    expect(copy.mockErrors(2, 2)).toBe(copy.glue('2 ошибки, из них 2 без ответа. Повторим их завтра.'));
    expect(copy.errorsBack(1, tomorrow)).toBe(copy.errorsBack(1));
    // Friday 9 October, Saturday off: Sunday; Saturday and Sunday off: Monday.
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    const sunday = comesBackWhen('2026-10-09', 127 - 32);
    const monday = comesBackWhen('2026-10-09', 31);
    expect(plain(copy.verdictWrong(['7 12'], true, sunday))).toBe('Неверно. В файле — 7 12. Повторим через пару вопросов и в воскресенье.');
    expect(plain(copy.verdictDontKnow(['DHCP'], false, monday))).toBe('В файле — DHCP. Повторим в понедельник.');
    expect(plain(copy.verdictShortWrong('ROLLBACK', true, monday))).toBe('Неверно. В файле — ROLLBACK. Повторим через пару вопросов и в понедельник.');
    expect(plain(copy.shortDontKnow('32', false, sunday))).toBe('В файле — 32. Повторим в воскресенье.');
    expect(plain(copy.misclickLine(monday))).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому повторим вопрос в понедельник.');
    expect(plain(copy.errorsBack(1, sunday))).toBe('1 ошибку повторим в воскресенье.');
    expect(plain(copy.errorsBack(5, monday))).toBe('5 ошибок повторим в понедельник.');
    expect(plain(copy.tooEarlyLine(2, null, monday))).toBe('2 вопроса ещё не выучены, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз в понедельник.');
    expect(plain(copy.mockErrors(1, 0, sunday))).toBe('1 ошибка. Повторим её в воскресенье.');
    expect(plain(copy.mockErrors(3, 1, monday))).toBe('3 ошибки, из них 1 без ответа. Повторим их в понедельник.');
    // «во вторник» (Tuesdays only, on Wednesday) and a date (Fridays only, on Friday); the preposition keeps its word.
    const tuesday = comesBackWhen('2026-10-07', 2);
    const date = comesBackWhen('2026-10-09', 16);
    expect(plain(copy.verdictWrong(['DHCP'], false, tuesday))).toBe('Неверно. В файле — DHCP. Повторим во вторник.');
    expect(plain(copy.verdictDontKnow(['DHCP'], true, date))).toBe('В файле — DHCP. Повторим через пару вопросов и 16 октября.');
    expect(plain(copy.misclickLine(date))).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому повторим вопрос 16 октября.');
    expect(plain(copy.mockErrors(2, 0, tuesday))).toBe('2 ошибки. Повторим их во вторник.');
    expect(copy.misclickLine(monday)).toContain(`в${copy.NBSP}понедельник`);
    expect(copy.verdictDontKnow(['DHCP'], true, tuesday)).toContain(`и${copy.NBSP}во${copy.NBSP}вторник`);
  });
});
