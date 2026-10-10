import { describe, expect, it } from 'vitest';
import source from './copy.ts?raw';
import * as copy from './copy';

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
    expect(copy.planTitleText(90, 45, false).split(copy.NBSP).join(' ')).toBe('Сегодня 90 вопросов, около 45 минут');
    expect(copy.planTitleText(1, 1, true).split(copy.NBSP).join(' ')).toBe('Сегодня остался 1 вопрос, около 1 минуты');
    expect(copy.planParts({ newItems: 30, reviews: 60, oral: 0 }).split(copy.NBSP).join(' ')).toBe('30 новых и 60 знакомых.');
    expect(copy.planParts({ newItems: 1, reviews: 2, oral: 5 }).split(copy.NBSP).join(' ')).toBe('1 новый, 2 знакомых и 5 устных.');
    expect(copy.sessionTime(20, 0, 11).split(copy.NBSP).join(' ')).toBe('20 вопросов за 11 минут');
    expect(copy.sessionTime(20, 7, 21).split(copy.NBSP).join(' ')).toBe('20 вопросов и 7 повторов за 21 минуту');
    expect(copy.noKeyLine(4).split(copy.NBSP).join(' ')).toBe('4 вопроса без ключа не идут в занятия.');
    expect(copy.noKeyLine(1).split(copy.NBSP).join(' ')).toBe('1 вопрос без ключа не идёт в занятия.');
    expect(copy.keyFixedLine(1).split(copy.NBSP).join(' ')).toBe('Автор исправил ключ в 1 вопросе — счёт по нему начнётся заново.');
    expect(copy.keyFixedLine(2).split(copy.NBSP).join(' ')).toBe('Автор исправил ключ в 2 вопросах — счёт по ним начнётся заново.');
    expect(copy.mockFinishLine(38, 40, [7, 22]).split(copy.NBSP).join(' ')).toBe('Ответили на 38 из 40. Без ответа: 7, 22 — они считаются ошибками.');
    expect(copy.verdictWrong(['Г'], true).split(copy.NBSP).join(' ')).toBe('Неверно: в файле Г. Вернётся через пару вопросов и завтра.');
    expect(copy.verdictWrong(['А', 'В'], false).split(copy.NBSP).join(' ')).toBe('Неверно. В файле верны: А и В. Вернётся завтра.');
  });
});
