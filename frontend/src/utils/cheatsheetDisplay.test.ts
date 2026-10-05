import { describe, expect, it } from 'vitest';
import { displayCheatsheet } from './cheatsheetDisplay';

describe('displayCheatsheet', () => {
  it('shows the old first heading «Экспресс-шпаргалка» as «Выжимка» at the same level', () => {
    expect(displayCheatsheet('# Экспресс-шпаргалка\n## Суть в 3 словах\nСпрос и предложение')).toBe(
      '# Выжимка\n## Суть в 3 словах\nСпрос и предложение',
    );
    expect(displayCheatsheet('## Экспресс-шпаргалка\n\n- главное')).toBe('## Выжимка\n\n- главное');
    expect(displayCheatsheet('###### Экспресс-шпаргалка')).toBe('###### Выжимка');
  });

  it('ignores case, trailing spaces, blank lines before it and Windows line ends', () => {
    expect(displayCheatsheet('# ЭКСПРЕСС-ШПАРГАЛКА\n- a')).toBe('# Выжимка\n- a');
    expect(displayCheatsheet('# экспресс-шпаргалка   \n- a')).toBe('# Выжимка   \n- a');
    expect(displayCheatsheet('\n\n  # Экспресс-шпаргалка\r\n- a')).toBe('\n\n  # Выжимка\r\n- a');
  });

  it('also covers the older «⚡ Экспресс-шпаргалка», a plain «Шпаргалка» and words after the name', () => {
    expect(displayCheatsheet('# ⚡ Экспресс-шпаргалка\n- a')).toBe('# Выжимка\n- a');
    expect(displayCheatsheet('# \u26A1\uFE0F Экспресс - шпаргалка\n- a')).toBe('# Выжимка\n- a');
    expect(displayCheatsheet('# Шпаргалка\n\n- Главное')).toBe('# Выжимка\n\n- Главное');
    expect(displayCheatsheet('# Экспресс-шпаргалка: Денежный рынок\n- a')).toBe('# Выжимка: Денежный рынок\n- a');
  });

  it('leaves every other text as it is', () => {
    const texts = [
      '# Главное\n\nЭкспресс-шпаргалка не нужна',
      '# Денежный рынок\n# Экспресс-шпаргалка',
      'Экспресс-шпаргалка\n\n- без решётки это не заголовок',
      '#Экспресс-шпаргалка',
      '# Шпаргалки и конспекты',
      '- # Экспресс-шпаргалка',
      '# Выжимка\n\n- уже новое имя',
      '',
    ];
    for (const text of texts) expect(displayCheatsheet(text)).toBe(text);
  });
});
