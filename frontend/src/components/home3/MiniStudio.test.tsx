import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MiniStudio, { TestQr } from './MiniStudio';
import { EXAMPLE } from './copy3';

afterEach(cleanup);

const take = () => screen.getByText('Так увидит участник').parentElement as HTMLElement;

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

  it('draws the QR code of the example test’s link', () => {
    const { container } = render(<TestQr />);
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/);
  });
});
