import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClozeText from './ClozeText';
import KindBody from './KindBody';
import MatchBoard from './MatchBoard';
import OrderList from './OrderList';
import { readText } from './ReadAloud';

afterEach(cleanup);

describe('OrderList: put in order with the keyboard', () => {
  it('Space takes a row, ↓ moves it, Space puts it down, and the live region says where', () => {
    const changes: number[][] = [];
    const { rerender } = render(<OrderList items={['Один', 'Два', 'Три']} value={[0, 1, 2]} onChange={(next) => changes.push(next)} />);
    const grip = screen.getByRole('button', { name: 'Переставить: «Один»' });
    fireEvent.keyDown(grip, { key: ' ' });
    expect(grip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Взята строка «Один», место 1 из 3');
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(changes[changes.length - 1]).toEqual([1, 0, 2]);
    rerender(<OrderList items={['Один', 'Два', 'Три']} value={[1, 0, 2]} onChange={(next) => changes.push(next)} />);
    expect(screen.getByRole('status').textContent).toBe('«Один» — место 2 из 3.');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Переставить: «Один»' }), { key: ' ' });
    expect(screen.getByRole('status').textContent).toBe('Строка «Один» поставлена на место 2 из 3.');
  });
  it('Escape puts everything back', () => {
    const changes: number[][] = [];
    render(<OrderList items={['a', 'b']} value={[0, 1]} onChange={(next) => changes.push(next)} />);
    const grip = screen.getByRole('button', { name: 'Переставить: «a»' });
    fireEvent.keyDown(grip, { key: 'Enter' });
    fireEvent.keyDown(grip, { key: 'Escape' });
    expect(changes[changes.length - 1]).toEqual([0, 1]);
    expect(screen.getByRole('status').textContent).toBe('Перестановка отменена.');
  });
  it('the arrows on a row move it too; the first cannot go up', () => {
    const onChange = vi.fn();
    render(<OrderList items={['a', 'b', 'c']} value={[2, 0, 1]} onChange={onChange} />);
    expect((screen.getByRole('button', { name: 'Выше: «c»' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ниже: «c»' }));
    expect(onChange).toHaveBeenCalledWith([0, 2, 1]);
  });
  it('after the answer each row says whether it stands right', () => {
    render(<OrderList items={['a', 'b', 'c']} value={[1, 0, 2]} review={{ key: [0, 1, 2] }} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText(/верное место/)).toHaveLength(2);
    expect(screen.getByText('на месте')).toBeTruthy();
  });
});

describe('MatchBoard: a list per row', () => {
  it('a right item chosen in one row leaves the row it was on', () => {
    const onChange = vi.fn();
    render(<MatchBoard left={['Франция', 'Германия']} right={['Париж', 'Берлин', 'Рим']} value={[0, -1]} onChange={onChange} />);
    const second = screen.getByLabelText('Германия') as HTMLSelectElement;
    expect(within(second).getAllByRole('option').map((o) => o.textContent)).toEqual(['Выбрать', 'Париж', 'Берлин', 'Рим']);
    fireEvent.change(second, { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith([-1, 0]);
    expect(screen.getByRole('status').textContent).toBe('«Париж» — к строке «Германия».');
  });
  it('the review names the right pair', () => {
    render(<MatchBoard left={['Франция', 'Германия']} right={['Париж', 'Берлин']} value={[1, 0]} review={{ key: [0, 1] }} />);
    expect(screen.getByText('верно: Париж')).toBeTruthy();
    expect(screen.getByText('верно: Берлин')).toBeTruthy();
  });
});

describe('ClozeText and the other fields', () => {
  it('a field per gap, labelled for screen readers', () => {
    const onChange = vi.fn();
    render(<ClozeText stem="Столица — ___, основана в ___ году" value={['', '']} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Пропуск 2 из 2'), { target: { value: '1147' } });
    expect(onChange).toHaveBeenCalledWith(['', '1147']);
  });
  it('an order question is answered only once a row moved or the order is kept', () => {
    const onChange = vi.fn();
    render(<KindBody kind="order" stem="По порядку" options={['a', 'b']} initialOrder={[1, 0]} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Оставить такой порядок' }));
    expect(onChange).toHaveBeenCalledWith([1, 0]);
  });
  it('a number shows its unit and empties to null', () => {
    const onChange = vi.fn();
    render(<KindBody kind="number" stem="g" options={[]} unit="м/с²" value="9,8" onChange={onChange} />);
    expect(screen.getByText('м/с²')).toBeTruthy();
    act(() => {
      fireEvent.change(screen.getByLabelText('Ваш ответ — число'), { target: { value: '' } });
    });
    expect(onChange).toHaveBeenCalledWith(null);
  });
  it('reads a question aloud without its dollars and with its gaps', () => {
    expect(readText({ kind: 'cloze', stem: 'Формула $F = ma$: сила ___', options: [] })).toBe('Формула F = ma: сила пропуск');
    expect(readText({ kind: 'single', stem: 'Да?', options: ['да', 'нет'] })).toBe('Да? А: да. Б: нет.');
  });
});
