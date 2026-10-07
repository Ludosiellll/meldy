import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { gluedArrows, SheetText } from './SheetText';

afterEach(cleanup);

const NBSP = ' ';

describe('SheetText', () => {
  it('glues ↑ ↓ to the word before them and → to the word after it', () => {
    expect(gluedArrows('цена ↑ → спрос ↓')).toBe(`цена${NBSP}↑ →${NBSP}спрос${NBSP}↓`);
  });

  it('keeps a word and its arrow in one unbreakable piece: an arrow never starts a row alone', () => {
    const { container } = render(<SheetText text="ставка ↑ → кредиты дороже → инфляция ↓" seedBase="k" />);
    const pieces = [...container.querySelectorAll('.cs-glue')].map((node) => node.textContent?.replace(/ /g, ' '));
    expect(pieces).toEqual(['ставка ↑', '→ кредиты', '→ инфляция ↓']);
    // The words and the real characters are all there, for copying and for screen readers.
    expect(container.textContent?.replace(/ /g, ' ')).toBe('ставка ↑ → кредиты дороже → инфляция ↓');
    expect(container.querySelectorAll('svg.cs-arrow-ink')).toHaveLength(4);
  });

  it('a line without arrows is plain text', () => {
    const { container } = render(<SheetText text="спрос = зависимость покупок от цены" seedBase="k" />);
    expect(container.querySelector('.cs-glue')).toBeNull();
    expect(container.textContent).toBe('спрос = зависимость покупок от цены');
  });
});
