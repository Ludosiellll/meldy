import { describe, expect, it } from 'vitest';
import source from './copyImport.ts?raw';
import * as copy from './copyImport';
import { count, dayText, errorText, IMPORT, INVITE, JOIN, KEYS, lettersText, MEMBERS, nb, NBSP, plural, QUEUE } from './copyImport';

/**
 * Spec §16 #45: one source of words, and a test that fails on the banned ones. The list is the spec's (plus the design
 * critique's B5 additions); «копи» is banned on the page of the group link only (decision 52: no «копия» there).
 */
const BANNED = [
  'контейнер',
  'тест',
  'повторени',
  'на проверку',
  'спорн',
  'пробн',
  'засчитан',
  'сгорел',
  'готов на',
  'сдашь',
  'отстаёте',
  'преподавател',
  'колледж',
  'аккредитац',
  'правильный ответ',
  'верный ответ —',
  'по сроку',
];
const JOIN_BANNED = [...BANNED, 'копи'];

/** Every string an export can make: plain strings, nested objects, and functions called with sample arguments. */
function strings(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => strings(entry, depth + 1));
  if (typeof value === 'function') {
    const out: string[] = [];
    const samples: unknown[][] = [
      [],
      [1],
      [2, 5],
      [21, 60, 3],
      ['Базы данных', 'Сети', 'X'],
      [5, 'Базы данных'],
      ['Базы данных', 240, 2],
      [12, 60],
      [45, '28 октября', 700, 960, 75],
      [[1, 3]],
      [['12', '40'], 2],
    ];
    for (const args of samples) {
      try {
        const result = (value as (...rest: unknown[]) => unknown)(...args);
        out.push(...strings(result, depth + 1));
      } catch {
        // a sample that does not fit this function
      }
    }
    return out;
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap((entry) => strings(entry, depth + 1));
  return [];
}

/** The source's string and template literals, comments left out. */
function literals(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return Array.from(code.matchAll(/'([^'\n]*)'|`([^`]*)`/g)).map((match) => match[1] ?? match[2] ?? '');
}

describe('copyImport: the words of the import, keys, settings and group screens', () => {
  it('has none of the banned words, in any line it can make (spec §16 #45)', () => {
    const made = Object.entries(copy)
      .filter(([name]) => name !== 'JOIN')
      .flatMap(([, value]) => strings(value));
    expect(made.length).toBeGreaterThan(200);
    const found = made.flatMap((line) => BANNED.filter((word) => line.toLowerCase().includes(word)).map((word) => `${word}: ${line}`));
    expect(found).toEqual([]);
  });

  it('says nothing of a copy on the page of the group link (decision 52)', () => {
    const lines = strings(JOIN);
    expect(lines.length).toBeGreaterThan(20);
    const found = lines.flatMap((line) => JOIN_BANNED.filter((word) => line.toLowerCase().includes(word)).map((word) => `${word}: ${line}`));
    expect(found).toEqual([]);
    // The member is told that the author sees their name.
    expect(JOIN.lede).toMatch(/имя/);
  });

  it('has none of the banned words in the source either (a branch the samples miss)', () => {
    const found = literals(source).flatMap((line) => BANNED.filter((word) => line.toLowerCase().includes(word)).map((word) => `${word}: ${line}`));
    expect(found).toEqual([]);
  });

  it('declines numbers and glues them to their words', () => {
    expect([1, 2, 5, 11, 21, 104].map((n) => count(n, 'вопрос', 'вопроса', 'вопросов'))).toEqual(
      ['1 вопрос', '2 вопроса', '5 вопросов', '11 вопросов', '21 вопрос', '104 вопроса'].map((text) => text.replace(' ', NBSP)),
    );
    expect(plural(12, 'а', 'б', 'в')).toBe('в');
    expect(nb('240 вопросов · ключ жирным, № 37')).toBe(`240${NBSP}вопросов${NBSP}· ключ жирным, №${NBSP}37`);
    expect(dayText('2026-10-28')).toBe(`28${NBSP}октября`);
    expect(dayText('not a day')).toBe('');
    expect(lettersText([1, 3])).toBe('Б и Г');
    expect(lettersText([0, 2, 3])).toBe('А, В и Г');
  });

  it('the question editor of release 47: the explanation’s label, changes not saved, the line under the options', () => {
    expect(copy.EDITOR.explanation).toBe('Пояснение — ученик увидит его вместе с верным ответом');
    expect(copy.EDITOR.unsaved(3)).toBe('В вопросе 3 есть несохранённые правки');
    expect(copy.EDITOR.discard).toBe('Не сохранять');
    expect(copy.EDITOR.saveNext).toBe('Сохранить и следующий');
    expect(copy.EDITOR.optionPicture('Б')).toBe('Картинка к варианту Б');
    const { ticked } = copy.EDITOR;
    // The decided words (release 47, M5): how many are ticked and what the student does; the ticks show which.
    expect(ticked([], false)).toBe('Не отмечен ни один верный — ученик выберет один вариант');
    expect(ticked([], true)).toBe('Не отмечен ни один верный — ученик может отметить несколько');
    expect(ticked([1], false)).toBe('Отмечен 1 верный — ученик выберет один вариант');
    expect(ticked([1], true)).toBe('Отмечен 1 верный — ученик может отметить несколько');
    expect(ticked([0, 2], true)).toBe('Отмечено 2 верных — ученик выберет несколько');
    expect(ticked([0, 2], false, true)).toBe('Отмечено 2 верных — ученик выберет несколько. Вопрос сохранится как «Несколько ответов»');
    expect(ticked([0, 1, 2, 3, 4], true)).toBe('Отмечено 5 верных — ученик выберет несколько');
    // No exclamation marks in the editor's words.
    expect(strings(copy.EDITOR).filter((line) => line.includes('!'))).toEqual([]);
  });

  it('uses the corrected lines of the design table, not the concept’s', () => {
    expect(IMPORT.lede).toBe('Один общий файл или по файлу на предмет.');
    expect(IMPORT.problems(11)).toBe(`Проверьте 11${NBSP}вопросов — можно и после сохранения.`);
    expect(IMPORT.spotCheck).toBe('Сверить ключ на трёх вопросах');
    expect(IMPORT.minutes).toBe('Время в день');
    expect(IMPORT.readAsOral).toBe('Прочитать как устные вопросы ›');
    expect(IMPORT.partTitle('Гражданское право', 2)).toBe('Гражданское право, часть 2');
    expect(QUEUE.pickKey).toBe('Какой вариант верный? Нажмите его.');
    expect(QUEUE.imageOk).toBe('Вопрос понятен без картинки');
    expect(QUEUE.noKey).toBe('Ответ в файле не отмечен. Отметьте верный, если знаете, или пропустите — вопрос подождёт.');
    expect(IMPORT.tgIphone).toBe('Файл из Telegram сначала сохраните в «Файлы».');
    expect(IMPORT.tgAndroid).toContain('Сохранить в загрузки');
    expect(IMPORT.updateSave(12)).toBe(`Добавить 12${NBSP}вопросов`);
    expect(IMPORT.updateSave(1)).toBe(`Добавить 1${NBSP}вопрос`);
    expect(KEYS.changed(true)).toBe('Ключ изменён. Счёт по этому вопросу начнётся заново, у вас и у группы.');
    expect(KEYS.changed(false)).toBe('Ключ изменён. Счёт по этому вопросу начнётся заново.');
    expect(INVITE.lede(4, 960)).toBe(`По ссылке каждый получит весь экзамен: 4${NBSP}предмета, 960${NBSP}вопросов. Прогресс у каждого свой, а исправленный вами ключ придёт всем.`);
    // The group's one line (usability check m3): who is in now, «Пока никто не вошёл» only before anyone came in.
    expect(MEMBERS.inExam(12, true)).toBe(`В экзамене 12${NBSP}участников`);
    expect(MEMBERS.inExam(21, true)).toBe(`В экзамене 21${NBSP}участник`);
    expect(MEMBERS.inExam(0, true)).toBe('Сейчас в экзамене никого');
    expect(MEMBERS.inExam(0, false)).toBe('Пока никто не вошёл');
    expect(INVITE.message('Аккредитация', 4, 960, 'https://x/g/1')).toBe(
      `Готовимся вместе в Meldy: «Аккредитация», 4${NBSP}предмета, 960${NBSP}вопросов. Ссылка: https://x/g/1`,
    );
    expect(JOIN.meta(4, 960, '28 октября')).toBe(`4${NBSP}предмета,${NBSP}960${NBSP}вопросов${NBSP}· экзамен${NBSP}28${NBSP}октября`);
    expect(JOIN.opening).toBe('Открываем экзамен…');
  });

  it('shows our Russian line for a known code, the layer’s Russian message otherwise, never English', () => {
    const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
    expect(errorText(coded('MC009', 'the container has members'))).toMatch(/участники/);
    expect(errorText(coded('MC004', 'no seat'), JOIN.errors)).toBe(JOIN.errors.MC004);
    expect(errorText(coded('x', 'Сервер занят.'))).toBe('Сервер занят.');
    expect(errorText(coded('x', 'boom'), {}, 'Запасная строка.')).toBe('Запасная строка.');
    expect(errorText('nothing')).toBe('Не получилось. Попробуйте ещё раз.');
  });
});
