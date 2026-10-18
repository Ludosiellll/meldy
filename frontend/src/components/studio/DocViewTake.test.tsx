import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc } from '../../lib/studio/doc';
import type { DocBlock, TestDoc } from '../../types/testDoc';
import DocView, { type TakeProps } from './DocView';
import type { DocItem } from './docRun';
import { DOC } from './copyStudio';

/** DocView's mode «take» (release 47.2): the quiz keeps the answers and the step, the page draws them. */

const single: DocItem = { id: 'i1', kind: 'single', stem: 'Какая кислота сильная?', options: ['Угольная', 'Серная', 'Кремниевая'], code: false };
const multiple: DocItem = { id: 'i2', kind: 'multiple', stem: 'Что растворимо?', options: ['NaOH', 'Cu(OH)₂', 'KOH'], code: false };
const short: DocItem = { id: 'i3', kind: 'short', stem: 'Реакция кислоты с основанием?', options: [], code: false };
const items = new Map([single, multiple, short].map((item) => [item.id, item]));

function page(layout: TestDoc['layout']): TestDoc {
  const blocks: DocBlock[] = [
    { type: 'note', id: 'note', tone: 'tip', text: 'Подсказка перед первым' },
    { type: 'question', id: 'q1', item_id: 'i1', points: 2, required: true },
    { type: 'page', id: 'p2', title: 'Часть 2' },
    { type: 'question', id: 'q2', item_id: 'i2', points: 1, required: false },
    { type: 'question', id: 'q3', item_id: 'i3', points: 3, required: false },
  ];
  return { ...emptyDoc('Кислоты'), theme: { ...emptyDoc('Кислоты').theme, accent: { custom: '#3fb68b' } }, layout, blocks };
}

function take(over: Partial<TakeProps> = {}) {
  const props: TakeProps = {
    mode: 'take',
    doc: page('pages'),
    items,
    dark: false,
    answers: {},
    onAnswer: vi.fn(),
    at: 0,
    canBack: true,
    onBack: vi.fn(),
    onNext: vi.fn(),
    onFinish: vi.fn(),
    ...over,
  };
  return { props, ...render(<DocView {...props} />) };
}

afterEach(() => cleanup());

describe('DocView «take»: a quiz «как в студии» draws its page', () => {
  it('the step it is given, in the page’s theme, the custom accent nudged for white text', () => {
    const { container } = take({ at: 1, stepLabel: 'Страница 2 из 2', top: <p>сверху</p>, under: <p>Сохранено</p> });
    expect((container.querySelector('.dv') as HTMLElement).style.getPropertyValue('--qt-fill')).not.toBe('#3fb68b');
    expect(screen.getByRole('heading', { name: 'Часть 2' })).toBeInTheDocument();
    expect(screen.queryByText('Какая кислота сильная?')).toBeNull();
    expect(screen.getByText('Что растворимо?')).toBeInTheDocument();
    expect(screen.getByText('сверху')).toBeInTheDocument();
    expect(screen.getByText('Сохранено')).toBeInTheDocument();
    // Arriving at a step: the focus on the line that names it, for a screen reader.
    expect(document.activeElement).toHaveTextContent('Страница 2 из 2');
  });

  it('the options in the attempt’s order; a press hands the file index to the caller', () => {
    const { props } = take({ orders: new Map([['i1', [2, 0, 1]]]) });
    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.textContent)).toEqual(['АКремниевая', 'БУгольная', 'ВСерная']);
    fireEvent.click(options[2]);
    expect(props.onAnswer).toHaveBeenCalledWith('i1', { chosen: [1] });
    // An order that is not one of the options is not used.
    cleanup();
    take({ orders: new Map([['i1', [0, 0, 1]]]) });
    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual(['АУгольная', 'БСерная', 'ВКремниевая']);
  });

  it('the caller’s answers show as chosen; the words of a short answer are kept to 200 characters', () => {
    const { props } = take({ at: 1, answers: { i2: { chosen: [0, 2] }, i3: { text: 'нейтрализация' } } });
    expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true']);
    const field = screen.getByRole('textbox');
    expect(field).toHaveValue('нейтрализация');
    expect(field).toHaveAttribute('maxLength', '200');
    fireEvent.change(field, { target: { value: 'обмен' } });
    expect(props.onAnswer).toHaveBeenCalledWith('i3', { text: 'обмен' });
  });

  it('required questions it names: marked, a line in the question, the list said', () => {
    take({ missing: [1] });
    expect(document.querySelector('.dv-q')).toHaveAttribute('data-missing');
    expect(screen.getByText(DOC.needAnswer)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(DOC.missing([1]));
  });

  it('«Дальше», «Назад» and «Завершить» call back; «Назад» only after the first step and when going back is allowed', () => {
    const first = take();
    expect(screen.queryByRole('button', { name: DOC.back })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: DOC.next }));
    expect(first.props.onNext).toHaveBeenCalledTimes(1);
    cleanup();
    const last = take({ at: 1 });
    fireEvent.click(screen.getByRole('button', { name: DOC.back }));
    expect(last.props.onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: DOC.finish }));
    expect(last.props.onFinish).toHaveBeenCalledTimes(1);
    cleanup();
    take({ at: 1, canBack: false });
    expect(screen.queryByRole('button', { name: DOC.back })).toBeNull();
  });

  it('the buttons are pinned on «По одному» and «По страницам», not on one page; one page is one step', () => {
    take({ doc: page('pages') });
    expect(document.querySelector('.dv-nav')).toHaveAttribute('data-pinned');
    cleanup();
    take({ doc: page('one_by_one') });
    expect(document.querySelector('.dv-nav')).toHaveAttribute('data-pinned');
    expect(screen.getByText('Подсказка перед первым')).toBeInTheDocument();
    cleanup();
    take({ doc: page('one_page') });
    expect(document.querySelector('.dv-nav')).not.toHaveAttribute('data-pinned');
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByRole('button', { name: DOC.finish })).toBeInTheDocument();
  });

  it('a jump from «Все вопросы» takes the focus to that question', () => {
    take({ doc: page('one_page'), jump: { blockId: 'q3', key: 1 } });
    expect(document.activeElement?.id).toBe('dv-q-q3');
  });
});
