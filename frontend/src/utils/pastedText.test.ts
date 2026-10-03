import { describe, expect, it } from 'vitest';
import {
  PASTE_MAX_CHARS,
  PASTE_MIN_CHARS,
  PASTED_TEXT_FALLBACK_TITLE,
  charactersLabel,
  pastedTextFile,
  pastedTextProblem,
  pastedTextTitle,
} from './pastedText';

describe('pastedTextTitle', () => {
  it('takes the first non-empty line', () => {
    expect(pastedTextTitle('\n\n  Лекция 3. Эластичность спроса  \nТекст лекции')).toBe('Лекция 3. Эластичность спроса');
  });

  it('strips markdown markers, quotes and extra spaces', () => {
    expect(pastedTextTitle('## **Эластичность   спроса**\nТекст')).toBe('Эластичность спроса');
    expect(pastedTextTitle('> «Цитата из учебника»:\nТекст')).toBe('Цитата из учебника');
    expect(pastedTextTitle('- пункт списка')).toBe('пункт списка');
  });

  it('skips lines that are only markup', () => {
    expect(pastedTextTitle('***\n---\nНастоящий заголовок')).toBe('Настоящий заголовок');
  });

  it('cuts a long first line at a word boundary within 80 characters', () => {
    const line =
      'Нейронная сеть — это математическая модель, вдохновлённая структурой биологического мозга, и она состоит из слоёв';
    const title = pastedTextTitle(line);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(line.startsWith(title)).toBe(true);
    expect(line[title.length]).toBe(' ');
  });

  it('falls back to «Вставленный текст»', () => {
    expect(pastedTextTitle('   \n\n ')).toBe(PASTED_TEXT_FALLBACK_TITLE);
    expect(pastedTextTitle('***')).toBe(PASTED_TEXT_FALLBACK_TITLE);
  });
});

describe('pastedTextProblem', () => {
  it('measures limits on the trimmed length', () => {
    const exactlyMin = 'а'.repeat(PASTE_MIN_CHARS);
    expect(pastedTextProblem(`   ${exactlyMin}   `)).toBeNull();
    expect(pastedTextProblem(`   ${'а'.repeat(PASTE_MIN_CHARS - 1)}      `)).toBe('Нужно хотя бы 300 символов, сейчас 299');
    expect(pastedTextProblem('а'.repeat(PASTE_MAX_CHARS))).toBeNull();
    expect(pastedTextProblem(`\n${'а'.repeat(PASTE_MAX_CHARS)}\n\n`)).toBeNull();
    expect(pastedTextProblem('а'.repeat(PASTE_MAX_CHARS + 1))).toBe(
      `Это ${(80001).toLocaleString('ru-RU')} символ, за один раз можно до ${(80000).toLocaleString('ru-RU')}. Разделите текст на части`,
    );
    expect(pastedTextProblem('  ')).toBe('Вставьте текст');
  });

  it('uses the right plural form in the counter', () => {
    expect(charactersLabel(1)).toBe('1 символ');
    expect(charactersLabel(3)).toBe('3 символа');
    expect(charactersLabel(5364)).toBe(`${(5364).toLocaleString('ru-RU')} символа`);
    expect(charactersLabel(92000)).toBe(`${(92000).toLocaleString('ru-RU')} символов`);
  });
});

describe('pastedTextFile', () => {
  it('is a UTF-8 text file with an ASCII name whose text round-trips', async () => {
    const text = 'Энтропия — мера беспорядка.\r\nВторая строка\tс табуляцией, «кавычками» и ёлкой.';
    const file = pastedTextFile(text);
    expect(file.name).toBe('pasted-text.txt');
    expect(file.type).toMatch(/^text\/plain/);
    expect(await file.text()).toBe(text);
  });
});
