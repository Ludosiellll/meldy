import { describe, expect, it } from 'vitest';
import source from './copy.ts?raw';
import * as copy from './copy';
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
  ['выучен', /выучен/i],
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
    for (const [name, pattern] of BANNED) {
      const line = source.split('\n').find((text) => pattern.test(text));
      expect(line, `«${name}» in copy.ts: ${line}`).toBeUndefined();
    }
  });

  it('says none of them in any line it renders', () => {
    const lines = rendered();
    expect(lines.length).toBeGreaterThan(150);
    for (const [name, pattern] of BANNED) {
      const hit = lines.find((text) => pattern.test(text));
      expect(hit, `«${name}» rendered: ${hit}`).toBeUndefined();
    }
  });

  it('names the figure only «верно в два разных дня» and calls the content «экзамен»', () => {
    expect(copy.TWO_DAYS).toBe('верно в два разных дня');
    expect(copy.nowFigure(147, 960).split(copy.NBSP).join(' ')).toBe('Теперь 147 из 960 — верно в два разных дня');
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
    expect(copy.noKeyLine(4).split(copy.NBSP).join(' ')).toBe('4 вопроса без ключа не идут в занятия.');
    expect(copy.noKeyLine(1).split(copy.NBSP).join(' ')).toBe('1 вопрос без ключа не идёт в занятия.');
    expect(copy.keyFixedLine(1).split(copy.NBSP).join(' ')).toBe('Автор исправил ключ в 1 вопросе — счёт по нему начнётся заново.');
    expect(copy.keyFixedLine(2).split(copy.NBSP).join(' ')).toBe('Автор исправил ключ в 2 вопросах — счёт по ним начнётся заново.');
    expect(copy.mockFinishLine(38, 40, [7, 22]).split(copy.NBSP).join(' ')).toBe('Ответили на 38 из 40. Без ответа: 7, 22 — они считаются ошибками.');
    // the end of a session: what comes back, «завтра» or the next study day (settings.study_weekdays)
    const ends = (text: string) => text.split(copy.NBSP).join(' ');
    expect(ends(copy.errorsBack(1))).toBe('1 ошибка вернётся завтра.');
    expect(ends(copy.errorsBack(3, '12 октября'))).toBe('3 ошибки вернутся 12 октября.');
    expect(ends(copy.firstCountLine('17:00'))).toBe('Первые войдут в счёт завтра после 17:00 — если снова ответите верно.');
    expect(ends(copy.firstCountLine(null, '12 октября'))).toBe('Первые войдут в счёт 12 октября — если снова ответите верно.');
    expect(ends(copy.tooEarlyLine(2, null, '12 октября'))).toBe('На 2 вопроса вы снова ответили верно, но раньше чем через 20 часов: они войдут в счёт, если ответите 12 октября.');
    expect(ends(copy.tooEarlyLine(1, '18:05'))).toBe('На 1 вопрос вы снова ответили верно, но раньше чем через 20 часов: он войдёт в счёт, если ответите после 18:05.');
    expect(ends(copy.studyDaysRow(31))).toBe('Дни занятий: Пн–Пт');
    expect(ends(copy.studyDaysRow(1 + 4 + 16 + 32))).toBe('Дни занятий: Пн, Ср, Пт, Сб');
    expect(ends(copy.studyDaysRow(96))).toBe('Дни занятий: Сб, Вс');
    expect(ends(copy.studyDaysRow(63 + 64 - 2))).toBe('Дни занятий: Пн, Ср–Вс');
    // the key in the file's own words, as the bot says it («В файле — DHCP»), never a letter of the shuffled screen (m2)
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    expect(plain(copy.verdictWrong(['7 12'], true))).toBe('Неверно. В файле — 7 12. Вернётся через пару вопросов и завтра.');
    expect(plain(copy.verdictDontKnow(['DHCP'], false))).toBe('В файле — DHCP. Вернётся завтра.');
    expect(plain(copy.verdictWrong(['string', 'object'], false))).toBe('Неверно. В файле верны: string и object. Вернётся завтра.');
    expect(plain(copy.verdictWrong(['Параллельные транзакции не видят…'], false))).toBe('Неверно. В файле — Параллельные транзакции не видят… Вернётся завтра.');
    expect(plain(copy.verdictShortWrong('ROLLBACK', true))).toBe('Неверно. В файле — ROLLBACK. Вернётся через пару вопросов и завтра.');
    expect(plain(copy.shortDontKnow('32', false))).toBe('В файле — 32. Вернётся завтра.');
    // several long ones: the options marked above
    const long = ['Транзакция выполняется целиком', 'Изменения сохраняются даже после сбоя', 'Данные остаются согласованными'];
    expect(plain(copy.verdictWrong(long, false))).toBe('Неверно. В файле верны 3 варианта — они отмечены выше. Вернётся завтра.');
    expect(plain(copy.startSubject('Базы данных', 17))).toBe('Начать: Базы данных — 17 вопросов');
    expect(plain(copy.aloudSubject('Гражданское право', 3))).toBe('Ответить вслух: Гражданское право — 3 вопроса');
  });

  it('a mistake comes back on the next study day: every day the same bytes as «завтра» always said, else its day', () => {
    // Every day (127): exactly the lines as they were before the days of the week.
    const tomorrow = comesBackWhen('2026-10-09', 127);
    expect(tomorrow).toBe('завтра');
    expect(copy.verdictWrong(['7 12'], true, tomorrow)).toBe(copy.glue('Неверно. В файле — 7 12. Вернётся через пару вопросов и завтра.'));
    expect(copy.verdictDontKnow(['DHCP'], false, tomorrow)).toBe(copy.glue('В файле — DHCP. Вернётся завтра.'));
    expect(copy.verdictShortWrong('ROLLBACK', false, tomorrow)).toBe(copy.glue('Неверно. В файле — ROLLBACK. Вернётся завтра.'));
    expect(copy.shortDontKnow('32', true, tomorrow)).toBe(copy.glue('В файле — 32. Вернётся через пару вопросов и завтра.'));
    expect(copy.misclickLine(tomorrow)).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому вопрос вернётся завтра.');
    expect(copy.misclickLine()).toBe(copy.misclickLine(tomorrow));
    expect(copy.mockErrors(1, 0, tomorrow)).toBe(copy.glue('Одна ошибка: она вернётся завтра.'));
    expect(copy.mockErrors(2, 2)).toBe(copy.glue('Ошибки — 2, из них без ответа 2: они вернутся завтра.'));
    expect(copy.errorsBack(1, tomorrow)).toBe(copy.errorsBack(1));
    // Friday 9 October, Saturday off: Sunday; Saturday and Sunday off: Monday.
    const plain = (text: string) => text.split(copy.NBSP).join(' ');
    const sunday = comesBackWhen('2026-10-09', 127 - 32);
    const monday = comesBackWhen('2026-10-09', 31);
    expect(plain(copy.verdictWrong(['7 12'], true, sunday))).toBe('Неверно. В файле — 7 12. Вернётся через пару вопросов и в воскресенье.');
    expect(plain(copy.verdictDontKnow(['DHCP'], false, monday))).toBe('В файле — DHCP. Вернётся в понедельник.');
    expect(plain(copy.verdictShortWrong('ROLLBACK', true, monday))).toBe('Неверно. В файле — ROLLBACK. Вернётся через пару вопросов и в понедельник.');
    expect(plain(copy.shortDontKnow('32', false, sunday))).toBe('В файле — 32. Вернётся в воскресенье.');
    expect(plain(copy.misclickLine(monday))).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому вопрос вернётся в понедельник.');
    expect(plain(copy.errorsBack(1, sunday))).toBe('1 ошибка вернётся в воскресенье.');
    expect(plain(copy.errorsBack(5, monday))).toBe('5 ошибок вернутся в понедельник.');
    expect(plain(copy.tooEarlyLine(2, null, monday))).toBe('На 2 вопроса вы снова ответили верно, но раньше чем через 20 часов: они войдут в счёт, если ответите в понедельник.');
    expect(plain(copy.mockErrors(1, 0, sunday))).toBe('Одна ошибка: она вернётся в воскресенье.');
    expect(plain(copy.mockErrors(3, 1, monday))).toBe('Ошибки — 3, из них без ответа 1: они вернутся в понедельник.');
    // «во вторник» (Tuesdays only, on Wednesday) and a date (Fridays only, on Friday); the preposition keeps its word.
    const tuesday = comesBackWhen('2026-10-07', 2);
    const date = comesBackWhen('2026-10-09', 16);
    expect(plain(copy.verdictWrong(['DHCP'], false, tuesday))).toBe('Неверно. В файле — DHCP. Вернётся во вторник.');
    expect(plain(copy.verdictDontKnow(['DHCP'], true, date))).toBe('В файле — DHCP. Вернётся через пару вопросов и 16 октября.');
    expect(plain(copy.misclickLine(date))).toBe('Ошибку не считаем. Ответ вы уже видели, поэтому вопрос вернётся 16 октября.');
    expect(plain(copy.mockErrors(2, 0, tuesday))).toBe('Ошибки — 2: они вернутся во вторник.');
    expect(copy.misclickLine(monday)).toContain(`в${copy.NBSP}понедельник`);
    expect(copy.verdictDontKnow(['DHCP'], true, tuesday)).toContain(`и${copy.NBSP}во${copy.NBSP}вторник`);
  });
});
