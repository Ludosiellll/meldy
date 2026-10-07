import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider } from '../reel/engine';
import { SheetCaption, StageSheet, type StageQuestion } from './StageSheet';

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

const QUESTION: StageQuestion = {
  number: 7,
  text: 'Эластичность спроса и выручка продавца.',
  lines: [
    { text: 'выручка = цена × количество', essential: true, from: 'rubbed', steps: [{ at: 1000, to: 'erased' }] },
    { text: 'эластичный: снижение цены → выручка ↑', essential: true, from: 'fresh', steps: [{ at: 1200, to: 'rubbed' }] },
    { text: 'неэластичный: выручка ↑ при повышении цены', essential: true, from: 'fresh', steps: [{ at: 1500, to: 'missed', note: 'назван только после вопроса экзаменатора' }] },
    { text: 'единичная эластичность: выручка не меняется', essential: false, from: 'fresh', noteRow: true },
  ],
};

describe('the cheat sheet on the stage', () => {
  it('prints the question and writes the lines by hand, main points with «•», the others with «–»', () => {
    const { container } = mount(<StageSheet questions={[QUESTION]} width={474} zoom={1.74} seed="test" />);
    expect(container.querySelector('.ss-qh')?.textContent).toBe('7.Эластичность спроса и выручка продавца.');
    expect(Array.from(container.querySelectorAll('.ss-bullet')).map((bullet) => bullet.textContent)).toEqual(['•', '•', '•', '–']);
    // The arrows are drawn; the characters stay in the text for copying and reading.
    expect(container.querySelectorAll('.ss-ink')[1].textContent?.replace(/\u00a0/g, ' ')).toBe('эластичный: снижение цены → выручка ↑');
    // The paper takes its scaled room in the layout.
    const box = container.querySelector('.ss-box') as HTMLElement;
    expect(box.style.width).toBe(`${Math.round(474 * 1.74)}px`);
  });

  it('masks a line by its state at the clock\'s moment, the bullet fading with it', () => {
    const { container, seek } = mount(<StageSheet questions={[QUESTION]} width={474} seed="test" />);
    const inks = () => Array.from(container.querySelectorAll('.ss-ink')).map((ink) => ink.classList.contains('is-masked'));
    const bullets = () => Array.from(container.querySelectorAll<HTMLElement>('.ss-bullet')).map((bullet) => Number(bullet.style.opacity));
    seek(0);
    expect(inks()).toEqual([true, false, false, false]);
    expect(bullets()).toEqual([0.3, 1, 1, 1]);
    seek(5000);
    expect(inks()).toEqual([true, true, false, false]);
    expect(bullets()).toEqual([0.12, 0.3, 1, 1]);
  });

  it('keeps a row for every note it will show, and shows the note once its line has moved', () => {
    const { container, seek } = mount(<StageSheet questions={[QUESTION]} width={474} seed="test" />);
    const notes = Array.from(container.querySelectorAll<HTMLElement>('.ss-note'));
    expect(notes.map((note) => note.hidden)).toEqual([true, true, false, false]);
    seek(1000);
    expect(notes[2].style.visibility).toBe('hidden');
    seek(5000);
    expect(notes[2].textContent).toBe('назван только после вопроса экзаменатора');
    expect(notes[2].style.visibility).toBe('visible');
    // A reserved row stays empty.
    expect(notes[3].textContent).toBe('');
  });

  it('writes a later date in the corner over the earlier one', () => {
    const { container, seek } = mount(
      <StageSheet questions={[QUESTION]} width={474} seed="test" dates={[{ at: -1, text: '7 окт.' }, { at: 2000, text: '8 окт.' }]} />,
    );
    const dates = Array.from(container.querySelectorAll<HTMLElement>('.ss-date'));
    seek(100);
    expect(dates.map((date) => date.style.opacity)).toEqual(['1', '0']);
    seek(3000);
    expect(dates.map((date) => date.style.opacity)).toEqual(['0', '1']);
  });

  it('says what the answer did from its moment until the next one', () => {
    const { container, seek } = mount(
      <SheetCaption
        items={[
          { at: 1000, until: 2000, text: 'После ответа: 1\u00a0строка стёрлась.' },
          { at: 3000, text: 'После ответа: 1\u00a0вернулась.' },
        ]}
      />,
    );
    const caps = Array.from(container.querySelectorAll<HTMLElement>('.ss-cap-t'));
    seek(1500);
    expect(caps.map((cap) => cap.style.opacity)).toEqual(['1', '0']);
    seek(2500);
    expect(caps.map((cap) => cap.style.opacity)).toEqual(['0', '0']);
    seek(3500);
    expect(caps.map((cap) => cap.style.opacity)).toEqual(['0', '1']);
  });
});
