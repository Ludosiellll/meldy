import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import MeldyDot, { endsWithStop } from './MeldyDot';

afterEach(cleanup);

// The styles are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/components/dot/'));
async function css(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  return fs.readFileSync(`${SRC}/${path}`, 'utf8');
}

describe('MeldyDot: the yellow dot of the wordmark as a character', () => {
  it('is a decoration: hidden from screen readers, two eyes, its size on the element', () => {
    const { container } = render(<MeldyDot size={30} />);
    const dot = container.querySelector('.md') as HTMLElement;
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot.style.getPropertyValue('--md-size')).toBe('30px');
    expect(dot.querySelectorAll('.md-b b')).toHaveLength(2);
    expect(dot).toHaveAttribute('data-move', 'still');
    expect(container.textContent).toBe('');
  });

  it('says how it moves and where it looks, and keeps the caller’s class', () => {
    const { container } = render(<MeldyDot move="hop" look="ahead" className="ag-dot-on-bar" />);
    const dot = container.querySelector('.md') as HTMLElement;
    expect(dot).toHaveAttribute('data-move', 'hop');
    expect(dot).toHaveAttribute('data-look', 'ahead');
    expect(dot.className).toBe('md ag-dot-on-bar');
  });

  it('stands still under «меньше движения», here and where the stylesheets draw it themselves', async () => {
    const [dotCss, oralCss] = await Promise.all([css('components/dot/dot.css'), css('components/oral/oral.css')]);
    expect(dotCss).toMatch(/prefers-reduced-motion: reduce\)\s*{[^}]*\.md-b[^}]*animation: none/);
    expect(oralCss).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.or-line\[role='status'\]::before \{ animation: none; \}/);
  });

  it('the status pill of the oral answer carries the dot’s face, with a jump that stays inside the pill', async () => {
    const [oralCss, rootCss] = await Promise.all([css('components/oral/oral.css'), css('index.css')]);
    const rule = /\.sf-page \.or-line\[role='status'\]::before \{([^}]*)\}/.exec(oralCss)?.[1] ?? '';
    expect(rule).toContain('var(--m-dot-face)');
    expect(rule).toContain('m-dot-hop');
    expect(rule).toContain('--m-dot-rise: -34%');
    expect(rootCss).toMatch(/--m-dot-face: url\("data:image\/svg\+xml,/);
    expect(rootCss).toContain('@keyframes m-dot-hop');
    expect(rootCss).toContain('translateY(var(--m-dot-rise, -66%))');
  });
});

describe('endsWithStop: a title that already has its full stop gets no second one', () => {
  it.each([
    ['Тема 1.2. Операторы и выражения', false],
    ['Что такое транзакция?', true],
    ['Массивы.', true],
    ['Циклы… ', true],
    ['Готово!', true],
    ['', false],
  ])('%s → %s', (title, expected) => {
    expect(endsWithStop(title)).toBe(expected);
  });
});
