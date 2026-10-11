import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CheatsheetSheet, { cheatsheetText } from './CheatsheetSheet';

afterEach(cleanup);

describe('<CheatsheetSheet> — «Выжимка» on the lecture page and on the analysis result', () => {
  it('names the card «Выжимка», as the picker does, and says what it is for', () => {
    render(<CheatsheetSheet text={'## Суть\n\nКлетка — основа жизни.'} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Выжимка' })).toBeInTheDocument();
    expect(screen.getByText('Главное из материала для быстрого повторения')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Суть' })).toBeInTheDocument();
  });

  it('shows the text without the fragment marks and without its old first heading', () => {
    render(<CheatsheetSheet text={'# Экспресс-шпаргалка\n\n- **АТФ:** источник энергии [S02].\n- Рибосомы [S01, S03] синтезируют белок.'} />);
    const text = document.querySelector('.xp-md')?.textContent ?? '';
    expect(text).not.toMatch(/\[S0|шпаргалка/i);
    expect(text).toContain('АТФ: источник энергии.');
    expect(text).toContain('Рибосомы синтезируют белок.');
  });

  it('keeps its formulas as formulas', () => {
    render(<CheatsheetSheet text={'Закон Ома: $I = \\frac{U}{R}$'} />);
    expect(document.querySelector('.xp-md .katex')).not.toBeNull();
  });

  it('gives the same text for copying', () => {
    expect(cheatsheetText('# Выжимка\n\nГлавное [S01].')).toBe('Главное.');
  });
});
