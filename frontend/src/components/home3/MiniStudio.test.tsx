import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MiniStudio, { TestQr } from './MiniStudio';
import { BUILDER_SECTION, EXAMPLE } from './copy3';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

const take = () => screen.getByText('Так увидит участник').parentElement as HTMLElement;

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));

async function sheet(name: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  return fs.readFileSync(HERE.slice(0, HERE.lastIndexOf('/')) + '/' + name, 'utf8');
}

/** A window as wide as a phone (the studio's phone layout, max-width 699 px) or wider. */
function windowIs(phone: boolean) {
  const media = vi.fn((query: string) => ({ matches: phone && query === '(max-width: 699px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: media });
}

/** The page's blocks in order, by their words (the chosen one's tools left out). */
const pageBlocks = (container: HTMLElement) => [...container.querySelectorAll('.ms-canvas .ms-blk')].map((block) => block.firstElementChild?.textContent);

describe('the small studio on the landing', () => {
  it('starts with a heading and question 1 on the page and in the participant’s view', () => {
    render(<MiniStudio />);
    expect(screen.getAllByText('Часть 1. Выручка')).toHaveLength(2);
    expect(within(take()).getByText(EXAMPLE.testStem)).toBeInTheDocument();
  });

  it('adds a block by a press, after the selected one, and the participant sees it', () => {
    render(<MiniStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить блок «Видео»' }));
    expect(screen.getByText('Добавлен блок «Видео».')).toBeInTheDocument();
    expect(within(take()).getByText('Разбор на графике, 4 минуты')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить блок «Один ответ»' }));
    expect(within(take()).getByText('Что показывает коэффициент эластичности спроса?')).toBeInTheDocument();
  });

  it('a pressed block that lands below the page’s visible part is scrolled into it, on the page alone', () => {
    const { container } = render(<MiniStudio />);
    const canvas = container.querySelector('.ms-canvas') as HTMLElement;
    const page = vi.spyOn(window, 'scrollTo');
    const scrolled = vi.fn();
    canvas.scrollTo = scrolled as unknown as HTMLElement['scrollTo'];
    Object.defineProperty(canvas, 'scrollTop', { configurable: true, value: 40 });
    // the canvas shows 0…400 px; the blocks are 130 px tall, 10 px apart, the first at 100
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      if (this === canvas) return DOMRect.fromRect({ x: 0, y: 0, width: 500, height: 400 });
      const index = [...canvas.querySelectorAll('.ms-blk')].indexOf(this);
      return DOMRect.fromRect({ x: 0, y: 100 + index * 140, width: 460, height: 130 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить блок «Видео»' }));
    // the third block ends at 510: 110 px lower, and 12 px of air under it
    expect(scrolled).toHaveBeenCalledWith({ top: 40 + 110 + 12, behavior: 'smooth' });
    expect(page).not.toHaveBeenCalled();
    // with less motion asked for, it jumps; a block already in view moves nothing
    const media = vi.fn((query: string) => ({ matches: query.includes('reduce') }) as MediaQueryList);
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: media });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Добавить блок «Текст»' }));
      expect(scrolled).toHaveBeenLastCalledWith({ top: 40 + 250 + 12, behavior: 'auto' });
      scrolled.mockClear();
      fireEvent.click(screen.getAllByText('Часть 1. Выручка')[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Добавить блок «Заголовок»' }));
      expect(scrolled).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('moves and removes the selected block', () => {
    render(<MiniStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Поднять блок' }));
    expect(screen.getByText('Блок теперь 1-й из 2.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить блок' }));
    expect(within(take()).queryByText(EXAMPLE.testStem)).toBeNull();
  });

  it('changes the look: colour, font and background are the page’s and the participant’s', () => {
    const { container } = render(<MiniStudio />);
    const studio = container.querySelector('.ms') as HTMLElement;
    fireEvent.click(screen.getByRole('radio', { name: 'Зелёный' }));
    expect(studio.style.getPropertyValue('--ms-acc')).toBe('#1f8a4c');
    fireEvent.click(screen.getByRole('radio', { name: 'С засечками' }));
    expect(studio.dataset.font).toBe('serif');
    fireEvent.click(screen.getByRole('radio', { name: 'Картинка' }));
    expect(studio.dataset.bg).toBe('image');
  });

  it('lets the participant answer and shows the message by points', () => {
    render(<MiniStudio />);
    const view = take();
    fireEvent.click(within(view).getByLabelText('Вырастет'));
    fireEvent.click(within(view).getByRole('button', { name: 'Завершить' }));
    expect(within(view).getByText('1 из 1')).toBeInTheDocument();
    expect(within(view).getByText('2 из 2 баллов, это 100 %')).toBeInTheDocument();
    expect(within(view).getByText('Отлично')).toBeInTheDocument();
    fireEvent.click(within(view).getByRole('button', { name: 'Пройти ещё раз' }));
    expect(within(view).getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
  });

  it('removing the chosen block leaves none chosen: the next block goes to the end of the page', () => {
    const { container } = render(<MiniStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить блок' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить блок «Текст»' }));
    expect(pageBlocks(container)).toEqual(['Часть 1. Выручка', 'После каждого ответа будет пояснение.']);
  });

  it('a block moved by its tools past the page’s visible part is brought into it', () => {
    const { container } = render(<MiniStudio />);
    const canvas = container.querySelector('.ms-canvas') as HTMLElement;
    const scrolled = vi.fn();
    canvas.scrollTo = scrolled as unknown as HTMLElement['scrollTo'];
    Object.defineProperty(canvas, 'scrollTop', { configurable: true, value: 0 });
    // the canvas shows 0…300 px; the blocks are 130 px tall, 10 px apart, the first at 100
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      if (this === canvas) return DOMRect.fromRect({ x: 0, y: 0, width: 500, height: 300 });
      const index = [...canvas.querySelectorAll('.ms-blk')].indexOf(this);
      return DOMRect.fromRect({ x: 0, y: 100 + index * 140, width: 460, height: 130 });
    });
    fireEvent.click(screen.getAllByText('Часть 1. Выручка')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Опустить блок' }));
    expect(pageBlocks(container)[1]).toBe('Часть 1. Выручка');
    // the heading is second now and ends at 370: 70 px under the canvas, and 12 px of air
    expect(scrolled).toHaveBeenCalledWith({ top: 70 + 12, behavior: 'smooth' });
  });

  it('on a wider screen the chosen block’s tools stand over its corner, with no bar under the page', () => {
    windowIs(false);
    const { container } = render(<MiniStudio />);
    const tools = container.querySelector('.ms-tools') as HTMLElement;
    expect(tools.closest('.ms-blk.is-sel')).not.toBeNull();
    expect(container.querySelector('.ms-bar')).toBeNull();
  });

  it('on a phone the chosen block’s tools stand in a bar under the page, so they cover no block', () => {
    windowIs(true);
    const { container } = render(<MiniStudio />);
    expect(container.querySelector('.ms-blk .ms-tools')).toBeNull();
    const bar = container.querySelector('.ms-bar') as HTMLElement;
    expect(bar.previousElementSibling).toBe(container.querySelector('.ms-canvas'));
    // the question 1 is chosen: its kind, its points and its moves
    expect(bar.querySelector('.ms-bar-l')?.textContent).toBe('Один ответ');
    fireEvent.click(within(bar).getByRole('button', { name: 'Добавить балл' }));
    expect(screen.getByText('3 балла')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Поднять блок' }));
    expect(screen.getByText('Блок теперь 1-й из 2.')).toBeInTheDocument();
    expect(pageBlocks(container)[0]).toMatch(/^Вопрос на/);
    // a heading has no points
    fireEvent.click(screen.getAllByText('Часть 1. Выручка')[0]);
    expect(bar.querySelector('.ms-bar-l')?.textContent).toBe('Заголовок');
    expect(within(bar).queryByRole('button', { name: 'Добавить балл' })).toBeNull();
    // with no block chosen the bar stays, its tools inactive
    fireEvent.click(within(bar).getByRole('button', { name: 'Удалить блок' }));
    expect(container.querySelector('.ms-bar')).toBe(bar);
    expect(bar.querySelector('.ms-bar-l')?.textContent).toBe('');
    for (const name of ['Поднять блок', 'Опустить блок', 'Удалить блок']) expect(within(bar).getByRole('button', { name })).toBeDisabled();
  });

  it('the look’s row fades on the side where more of it is (a phone scrolls it sideways)', () => {
    const { container } = render(<MiniStudio />);
    const look = container.querySelector('.ms-look') as HTMLElement;
    expect(look.className).toBe('ms-look');
    Object.defineProperty(look, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(look, 'clientWidth', { configurable: true, value: 330 });
    const at = (left: number) => {
      Object.defineProperty(look, 'scrollLeft', { configurable: true, value: left });
      fireEvent.scroll(look);
      return [look.classList.contains('is-back'), look.classList.contains('is-more')];
    };
    expect(at(0)).toEqual([false, true]);
    expect(at(120)).toEqual([true, true]);
    expect(at(270)).toEqual([true, false]);
    // within the row's padding of an end counts as the end
    expect(at(262)).toEqual([true, false]);
    expect(at(8)).toEqual([false, true]);
  });

  it('names its participant’s view as the phone’s lead above it does', () => {
    render(<MiniStudio />);
    expect(screen.getByRole('button', { name: BUILDER_SECTION.takeTab })).toBeInTheDocument();
    expect(BUILDER_SECTION.tryTextPhone).toContain(`«${BUILDER_SECTION.takeTab}»`);
    expect(BUILDER_SECTION.tryTextPhone).not.toMatch(/справа/i);
  });

  it('on a phone gives the participant’s view the page’s place (its rule outweighs the wider screens’ grid area)', async () => {
    const css = (await sheet('miniStudio.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const phone = css.indexOf('.ms > .ms-take {');
    expect(phone).toBeGreaterThan(0);
    expect(css.slice(css.lastIndexOf('@media', phone), phone)).toMatch(/^@media \(max-width: 699px\)/);
    expect(css.slice(phone, css.indexOf('}', phone))).toMatch(/grid-row: 2 \/ 4;\s*grid-column: 1;/);
    // the wider screens' rule is plainer (one class) and comes later: the phone's needs the weight of two
    expect(css.indexOf('.ms-take {\n  grid-area: take;')).toBeGreaterThan(phone);
  });

  it('draws the QR code of the example test’s link', () => {
    const { container } = render(<TestQr />);
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/);
  });
});
