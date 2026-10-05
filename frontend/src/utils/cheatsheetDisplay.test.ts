import { describe, expect, it } from 'vitest';
import { displayCheatsheet } from './cheatsheetDisplay';

describe('displayCheatsheet', () => {
  it('drops the first heading that only says the name: the card already says «Выжимка»', () => {
    expect(displayCheatsheet('# Экспресс-шпаргалка\n## Суть в 3 словах\nСпрос и предложение')).toBe('## Суть в 3 словах\nСпрос и предложение');
    expect(displayCheatsheet('## Экспресс-шпаргалка\n\n- главное')).toBe('- главное');
    expect(displayCheatsheet('# Выжимка\n\n- уже новое имя')).toBe('- уже новое имя');
    expect(displayCheatsheet('###### Выжимка\n- a')).toBe('- a');
  });

  it('ignores case, trailing spaces, blank lines before it and Windows line ends', () => {
    expect(displayCheatsheet('# ЭКСПРЕСС-ШПАРГАЛКА\n- a')).toBe('- a');
    expect(displayCheatsheet('# экспресс-шпаргалка   \n- a')).toBe('- a');
    expect(displayCheatsheet('\n\n  # Экспресс-шпаргалка\r\n- a')).toBe('\n\n- a');
  });

  it('also covers the older «⚡ Экспресс-шпаргалка» and a plain «Шпаргалка»; words after the name stay as the heading', () => {
    expect(displayCheatsheet('# ⚡ Экспресс-шпаргалка\n- a')).toBe('- a');
    expect(displayCheatsheet('# ⚡️ Экспресс - шпаргалка\n- a')).toBe('- a');
    expect(displayCheatsheet('# Шпаргалка\n\n- Главное')).toBe('- Главное');
    expect(displayCheatsheet('# Экспресс-шпаргалка: Денежный рынок\n- a')).toBe('# Денежный рынок\n- a');
    expect(displayCheatsheet('## Выжимка — Спрос\n\n- a')).toBe('## Спрос\n- a');
  });

  it('keeps a text that is only the heading, under the new name', () => {
    expect(displayCheatsheet('# Экспресс-шпаргалка')).toBe('# Выжимка');
    expect(displayCheatsheet('# Выжимка\n\n')).toBe('# Выжимка');
  });

  it('leaves every other text as it is', () => {
    const texts = [
      '# Главное\n\nЭкспресс-шпаргалка не нужна',
      '# Денежный рынок\n# Экспресс-шпаргалка',
      'Экспресс-шпаргалка\n\n- без решётки это не заголовок',
      '#Экспресс-шпаргалка',
      '# Шпаргалки и конспекты',
      '# Выжимки из лекций',
      '- # Экспресс-шпаргалка',
      '',
    ];
    for (const text of texts) expect(displayCheatsheet(text)).toBe(text);
  });
});
