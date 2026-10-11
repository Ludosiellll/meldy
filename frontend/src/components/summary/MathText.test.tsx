import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import MathText, { formulaHtml, shortenPieces, splitMath } from './MathText';

afterEach(cleanup);

/** The fragment of a page from Wikipedia that the fragment panel showed raw (QA 2026-10-11, L-url-23-fragment-10). */
const WIKI =
  'В нём для треугольника $\\triangle ABC$ с прямым углом при вершине $C$ возникают соотношения подобия: ' +
  '$\\triangle ABC\\sim \\triangle ACH$, из чего следуют соотношения: ${\\frac {a}{c}}={\\frac {|HB|}{a}},\\quad {\\frac {b}{c}}={\\frac {|AH|}{b}}$.';

describe('splitMath: a lecture fragment in text and formulas', () => {
  it('finds the formulas of a page from the web', () => {
    const pieces = splitMath(WIKI);
    expect(pieces.filter(piece => piece.kind === 'math').map(piece => piece.value)).toEqual([
      '\\triangle ABC',
      'C',
      '\\triangle ABC\\sim \\triangle ACH',
      '{\\frac {a}{c}}={\\frac {|HB|}{a}},\\quad {\\frac {b}{c}}={\\frac {|AH|}{b}}',
    ]);
    // Nothing is lost or added: the pieces put together give the text back.
    expect(pieces.map(piece => (piece.kind === 'math' ? `$${piece.value}$${piece.tail ?? ''}` : piece.value)).join('')).toBe(WIKI);
  });

  it('keeps the punctuation after a short formula with it, so a line never starts with «, C»', () => {
    const pieces = splitMath('вершинам $A$, $B$, $C$ соответственно; длинная ${\\frac {a}{c}}={\\frac {|HB|}{a}}$, конец');
    expect(pieces.filter(piece => piece.kind === 'math').map(piece => [piece.value, piece.tail])).toEqual([
      ['A', ','],
      ['B', ','],
      ['C', undefined],
      // A long formula keeps KaTeX's own line breaks: the comma stays text.
      ['{\\frac {a}{c}}={\\frac {|HB|}{a}}', undefined],
    ]);
    const { container } = render(
      <p>
        <MathText text="вершинам $A$, $B$, $C$ соответственно" />
      </p>,
    );
    const runs = Array.from(container.querySelectorAll<HTMLElement>('.sv-math-run'));
    expect(runs).toHaveLength(2);
    expect(runs.every(run => run.style.whiteSpace === 'nowrap' && run.textContent?.endsWith(','))).toBe(true);
  });

  it('reads $$…$$ as a display formula', () => {
    expect(splitMath('Итак: $$a^{2}+b^{2}=c^{2}$$ — теорема.')).toEqual([
      { kind: 'text', value: 'Итак: ' },
      { kind: 'math', value: 'a^{2}+b^{2}=c^{2}', display: true },
      { kind: 'text', value: ' — теорема.' },
    ]);
  });

  it('leaves money, a lone dollar and an escaped one as text', () => {
    for (const text of ['Цена 5$ и 10$ за штуку.', 'Было $5, стало $10.', 'Курс $ к рублю.', 'Знак \\$ в тексте $', 'Пусто: $$ и всё.']) {
      expect(splitMath(text)).toEqual([{ kind: 'text', value: text }]);
    }
  });

  it('keeps a text without dollars as one piece', () => {
    expect(splitMath('Клетка — единица живого.')).toEqual([{ kind: 'text', value: 'Клетка — единица живого.' }]);
  });
});

describe('shortenPieces: a long fragment is cut at a word, never inside a formula', () => {
  it('stops before a formula that does not fit, and adds «…»', () => {
    const pieces = splitMath('Короткое начало $\\frac{a}{b}$ и хвост');
    expect(shortenPieces(pieces, 20)).toEqual([
      { kind: 'text', value: 'Короткое начало ' },
      { kind: 'text', value: '…' },
    ]);
  });

  it('cuts plain text at the last whole word, as before', () => {
    const text = 'Первое второе третье четвёртое';
    expect(shortenPieces(splitMath(text), 17)).toEqual([
      { kind: 'text', value: 'Первое второе' },
      { kind: 'text', value: '…' },
    ]);
    expect(`${text.slice(0, 17).replace(/\s+\S*$/, '')}…`).toBe('Первое второе…');
  });

  it('keeps whole formulas that fit', () => {
    const pieces = splitMath('Пусть $x$ и $y$ — числа, а дальше длинный текст без конца');
    const short = shortenPieces(pieces, 20);
    expect(short.filter(piece => piece.kind === 'math').map(piece => piece.value)).toEqual(['x', 'y']);
    expect(short[short.length - 1]).toEqual({ kind: 'text', value: '…' });
  });
});

describe('<MathText>', () => {
  it('draws the formulas with KaTeX and leaves no raw LaTeX in sight', () => {
    const { container } = render(
      <p>
        <MathText text={WIKI} />
      </p>,
    );
    expect(container.querySelectorAll('.sv-math .katex')).toHaveLength(4);
    // What a reader sees (the KaTeX HTML; its MathML copy is for screen readers) has no «$» and no «\triangle».
    const visible = Array.from(container.querySelectorAll('.katex-html'))
      .map(node => node.textContent)
      .join(' ');
    expect(visible).toContain('ABC');
    const textOutside = Array.from(container.querySelector('p')?.childNodes ?? [])
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('');
    expect(textOutside).not.toMatch(/\$|\\triangle|\\frac/);
    expect(textOutside).toContain('с прямым углом при вершине');
  });

  it('shows a formula KaTeX cannot read as it was written', () => {
    expect(formulaHtml('\\frac{a}{')).toBeNull();
    const { container } = render(
      <p>
        <MathText text={'Сломанная $\\frac{a}{$ формула.'} />
      </p>,
    );
    expect(container.textContent).toBe('Сломанная $\\frac{a}{$ формула.');
    expect(container.querySelector('.katex')).toBeNull();
  });

  it('never runs markup from a lecture: \\href and \\htmlClass stay inert', () => {
    const { container } = render(
      <p>
        <MathText text={'Ссылка $\\href{javascript:alert(1)}{x}$ и класс $\\htmlClass{evil}{y}$.'} />
      </p>,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('.evil')).toBeNull();
  });
});
