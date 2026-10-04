import { describe, expect, it } from 'vitest';
import { formatShortMoment, sheetHeader, subjectOf } from './format';

describe('subjectOf', () => {
  it.each([
    ['Экзамен: цифровая экономика', 'Цифровая экономика'],
    ['Зачёт. Микроэкономика', 'Микроэкономика'],
    ['Зачет: история России', 'История России'],
    ['Коллоквиум — линейная алгебра', 'Линейная алгебра'],
    ['коллоквиум - теория вероятностей', 'Теория вероятностей'],
    ['  Экзамен :  макроэкономика ', 'Макроэкономика'],
    ['Микроэкономика', 'Микроэкономика'],
    ['Экзамен по микроэкономике', 'Экзамен по микроэкономике'],
    ['Экзаменационные вопросы: право', 'Экзаменационные вопросы: право'],
    ['Экзамен:', 'Экзамен:'],
    ['Цифровая экономика: экзамен', 'Цифровая экономика: экзамен'],
  ])('%s → %s', (title, subject) => {
    expect(subjectOf(title)).toBe(subject);
  });
});

describe('sheetHeader', () => {
  it('names the subject and what the list is for, once', () => {
    expect(sheetHeader('Экзамен: цифровая экономика', 'exam')).toBe('Цифровая экономика: вопросы к экзамену');
    expect(sheetHeader('Микроэкономика', 'credit')).toBe('Микроэкономика: вопросы к зачёту');
    expect(sheetHeader('История', 'colloquium')).toBe('История: вопросы к коллоквиуму');
  });

  it('keeps a title that still says what kind of exam it is', () => {
    expect(sheetHeader('Экзамен по микроэкономике', 'exam')).toBe('Экзамен по микроэкономике');
    expect(sheetHeader('Вопросы к зачёту по праву', 'credit')).toBe('Вопросы к зачёту по праву');
  });
});

describe('formatShortMoment', () => {
  it('dates a moment with the short month and the clock, the year only when it is not this year', () => {
    const now = new Date(2026, 9, 5, 12, 0);
    expect(formatShortMoment(new Date(2026, 9, 3, 14, 2).toISOString(), now)).toBe('3 окт., 14:02');
    expect(formatShortMoment(new Date(2026, 8, 29, 9, 5).toISOString(), now)).toBe('29 сент., 9:05');
    expect(formatShortMoment(new Date(2025, 9, 3, 14, 2).toISOString(), now)).toBe('3 окт. 2025, 14:02');
    expect(formatShortMoment(null, now)).toBe('');
  });
});
