import { afterEach, describe, expect, it } from 'vitest';
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

  it('moves and removes the selected block', () => {
    render(<MiniStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Выше' }));
    expect(screen.getByText('Блок на месте 1 из 2.')).toBeInTheDocument();
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
    expect(within(view).getByText('100 % · 2 из 2 баллов')).toBeInTheDocument();
    expect(within(view).getByText('Отлично')).toBeInTheDocument();
    fireEvent.click(within(view).getByRole('button', { name: 'Пройти ещё раз' }));
    expect(within(view).getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
  });

  it('draws the QR code of the example test’s link', () => {
    const { container } = render(<TestQr />);
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/);
  });
});
