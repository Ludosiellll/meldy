import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider } from '../reel/engine';
import { CHANGE_MS, type ListLine } from './listLine';
import { ListCaption, StageCount, StageList, StageMap, leftLabel, progressOf } from './StageList';
import { counterLabel } from '../exams/sheet/copy';

afterEach(cleanup);

/** A clock that only moves when the test seeks it. */
const still = { request: () => 0, cancel: () => {}, now: () => 0 };

function mount(ui: ReactNode) {
  const clock = new ReelClock(10_000, still);
  const view = render(
    <ClockProvider value={clock}>
      <SceneProvider value={{ from: 0, to: 10_000 }}>{ui}</SceneProvider>
    </ClockProvider>,
  );
  const seek = (t: number) =>
    act(() => {
      clock.seek(t);
    });
  return { ...view, seek };
}

const NOTE = 'назван только после вопроса экзаменатора';
const LINES: ListLine[] = [
  { text: 'выручка = цена × количество', essential: true, from: 'rubbed', steps: [{ at: 1000, to: 'erased' }] },
  { text: 'эластичный: снижение цены → выручка ↑', essential: true, from: 'fresh', steps: [{ at: 1200, to: 'rubbed' }] },
  { text: 'неэластичный: выручка ↑ при повышении цены', essential: true, from: 'fresh', steps: [{ at: 1500, to: 'missed', note: NOTE }] },
  { text: 'единичная эластичность: выручка не меняется', essential: false, from: 'fresh' },
];
const QUESTION = { number: 7, text: 'Эластичность спроса и выручка продавца.', lines: LINES };

const scaleOf = (el: Element) => {
  const match = /scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform);
  return match ? Number(match[1]) : NaN;
};

describe('the cheat sheet on a reel\'s stage', () => {
  it('prints the question and its lines in type: a dot for a main point, a dash for a detail — no paper, no handwriting', () => {
    const { container } = mount(<StageList questions={[QUESTION]} />);
    expect(container.querySelector('.sl-qh')?.textContent).toBe('7.Эластичность спроса и выручка продавца.');
    expect(Array.from(container.querySelectorAll('.sl-words')).map((words) => words.textContent)).toEqual(LINES.map((line) => line.text));
    expect(Array.from(container.querySelectorAll('[data-a="mark"]')).map((mark) => mark.className)).toEqual([
      'sl-mark sl-mark--main',
      'sl-mark sl-mark--main',
      'sl-mark sl-mark--main',
      'sl-mark sl-mark--detail',
    ]);
    expect(container.querySelector('svg, canvas, [class*="paper"], [class*="ink-"]')).toBeNull();
  });

  it('draws each look at the clock\'s moment: ink marker, yellow dot, or a strike and no marker', () => {
    const { container, seek } = mount(<StageList questions={[QUESTION]} />);
    const marks = () => Array.from(container.querySelectorAll('[data-a="mark"]')).map(scaleOf);
    const dots = () => Array.from(container.querySelectorAll('[data-a="dot"]')).map(scaleOf);
    const strikes = () => Array.from(container.querySelectorAll<HTMLElement>('.sl-words')).map((words) => Number(words.style.getPropertyValue('--sl-s')));
    seek(0);
    expect(marks()).toEqual([0, 1, 1, 1]);
    expect(dots()).toEqual([1, 0, 0, 0]);
    expect(strikes()).toEqual([0, 0, 0, 0]);
    seek(5000);
    expect(marks()).toEqual([0, 0, 1, 1]);
    expect(dots()).toEqual([0, 1, 0, 0]);
    expect(strikes()).toEqual([1, 0, 0, 0]);
  });

  it('runs the strike left to right before the words fade, and never blends ink into yellow', () => {
    const at = (p: number) => progressOf({ state: 'erased', from: 'rubbed', look: 'gone', fromLook: 'once', p, note: null, noteBefore: null });
    expect(at(0)).toEqual({ colour: 0, strike: 0 });
    expect(at(0.3).strike).toBeGreaterThan(at(0.3).colour);
    expect(at(1)).toEqual({ colour: 1, strike: 1 });
    const { container, seek } = mount(<StageList questions={[QUESTION]} />);
    // Halfway through a naming the ink marker is gone before the yellow dot springs up: never both at once, half-way.
    seek(1200 + CHANGE_MS.once * 0.4);
    const mark = scaleOf(container.querySelectorAll('[data-a="mark"]')[1]);
    const dot = scaleOf(container.querySelectorAll('[data-a="dot"]')[1]);
    expect(Math.min(mark, dot)).toBeLessThan(0.05);
  });

  it('brings the note with its step', () => {
    const { container, seek } = mount(<StageList questions={[QUESTION]} />);
    const notes = () => Array.from(container.querySelectorAll<HTMLElement>('[data-a="note"]'));
    expect(notes().map((note) => note.hidden)).toEqual([true, true, false, true]);
    seek(1400);
    expect(Number(notes()[2].style.opacity)).toBe(0);
    seek(3000);
    expect(notes()[2].textContent).toBe(NOTE);
    expect(Number(notes()[2].style.opacity)).toBe(1);
  });

  it('maps the lines one square each: ink while a line stands, yellow once named, an empty outline once erased', () => {
    const { container, seek } = mount(<StageMap groups={[LINES, [{ text: '', essential: true, from: 'erased' }]]} />);
    const squares = () =>
      Array.from(container.querySelectorAll('.sl-map > i')).map((square) => [scaleOf(square.children[0]), scaleOf(square.children[1])]);
    seek(0);
    expect(squares()).toEqual([
      [0, 1],
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 0],
    ]);
    seek(5000);
    expect(squares()).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 0],
      [0, 0],
    ]);
  });

  it('counts the lines left in the exam page\'s words, down by one as the strike ends', () => {
    for (const left of [1, 2, 5, 11, 21, 23, 38, 41]) {
      expect(leftLabel(left, 47)).toBe(counterLabel({ left, total: 47 }));
    }
    const { container, seek } = mount(<StageCount lines={LINES} />);
    seek(0);
    expect(container.querySelector('[data-a="n"]')?.textContent).toBe('4');
    seek(5000);
    expect(container.querySelector('[data-a="n"]')?.textContent).toBe('3');
    expect(container.querySelector('[data-a="label"]')?.textContent).toBe(leftLabel(3, 4));
  });

  it('says what the answer did under the sheet from its moment on', () => {
    const { container, seek } = mount(<ListCaption items={[{ at: 2000, text: 'После ответа: 1 строка стёрлась.' }]} />);
    const cap = () => container.querySelector<HTMLElement>('.sl-cap-t')!;
    seek(1900);
    expect(Number(cap().style.opacity)).toBe(0);
    seek(3000);
    expect(Number(cap().style.opacity)).toBe(1);
    expect(cap().textContent).toBe('После ответа: 1 строка стёрлась.');
  });
});
