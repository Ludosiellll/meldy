import { describe, expect, it } from 'vitest';
import { PASTE_REFUSED, PASTE_WORD_LIMIT, pasteAllowed, wordCount } from './pasteGuard';

describe('«Чистый ответ»: what may be pasted into an answer (Н7)', () => {
  it('counts words, not signs: hyphenated words and numbers are one word each', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  ,  — ')).toBe(0);
    expect(wordCount('эластичность спроса')).toBe(2);
    expect(wordCount('кто-то сказал: P > MC, 2 + 2 = 4')).toBe(7);
    expect(wordCount('O’Neil и d’Alembert')).toBe(3);
  });

  it('lets a term or a short phrase in, up to 8 words', () => {
    expect(PASTE_WORD_LIMIT).toBe(8);
    expect(pasteAllowed('эластичность')).toBe(true);
    expect(pasteAllowed('ценовая эластичность спроса по цене')).toBe(true);
    expect(pasteAllowed('раз два три четыре пять шесть семь восемь')).toBe(true);
  });

  it('refuses a ready answer: more than 8 words', () => {
    expect(pasteAllowed('раз два три четыре пять шесть семь восемь девять')).toBe(false);
    expect(
      pasteAllowed('Эластичность показывает, на сколько процентов изменится спрос, если цена изменится на один процент.'),
    ).toBe(false);
  });

  it('says why in plain words', () => {
    expect(PASTE_REFUSED).toBe('Готовый текст вставить нельзя. Скажите ответ или наберите его сами, тогда он считается честно.');
  });
});
