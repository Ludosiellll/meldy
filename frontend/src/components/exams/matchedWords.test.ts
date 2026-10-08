import { describe, expect, it } from 'vitest';
import { distinctWords, isGenericWord, telling, wordStem } from './matchedWords';

describe('matchedWords', () => {
  it('gives the forms of one word one stem; Latin, numbers and short words stay as they are', () => {
    expect(wordStem('запросе')).toBe(wordStem('запроса'));
    expect(wordStem('выполнения')).toBe(wordStem('выполнение'));
    expect(wordStem('Ключами')).toBe(wordStem('ключи'));
    expect(wordStem('ёмкости')).toBe(wordStem('емкость'));
    expect(wordStem('SQL')).toBe('sql');
    expect(wordStem('B-дерево')).toBe('b-дерево');
    expect(wordStem('ЦБ')).toBe('цб');
  });

  it('tells the words of a question’s form from the words of its subject', () => {
    for (const word of ['Назначение', 'выполнения', 'виды', 'Особенности', 'примеров', 'понятия']) expect(isGenericWord(word)).toBe(true);
    for (const word of ['запросе', 'индекс', 'инфляции', 'транзакция']) expect(isGenericWord(word)).toBe(false);
  });

  it('keeps each word once in its first spelling, lower-cased unless it is an abbreviation', () => {
    expect(distinctWords(['Назначение', 'выполнения', 'запросе', 'запроса', '', ' '])).toEqual(['назначение', 'выполнения', 'запросе']);
    expect(distinctWords(['SQL', 'sql', 'ЦБ'])).toEqual(['SQL', 'ЦБ']);
  });

  it('names the subject’s words when there are any, else says that only the form matched', () => {
    // The audit's example of 2026-10-08.
    expect(telling(['Назначение', 'выполнения', 'запросе', 'запроса'])).toEqual({ words: ['запросе'], generic: false });
    expect(telling(['Назначение', 'выполнения'])).toEqual({ words: ['назначение', 'выполнения'], generic: true });
    expect(telling([])).toEqual({ words: [], generic: false });
  });
});
