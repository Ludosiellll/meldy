import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ExaminerLine, { ExaminerThinking, questionSize } from './ExaminerLine';
import LiveTranscript from './LiveTranscript';
import { underlinedFinalWords } from '../../lib/oral/rubricMatch';
import { DEMO_RUBRIC } from '../../lib/oral/testing/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<ExaminerLine>', () => {
  it('shows the examiner’s question in quotes and plays it again on request', () => {
    const onRepeat = vi.fn();
    render(
      <ExaminerLine question="А что будет, если взять слишком большую скорость обучения?" onRepeat={onRepeat}>
        <button type="button">Отвечать</button>
      </ExaminerLine>,
    );
    expect(screen.getByRole('region', { name: 'Экзаменатор' })).toBeInTheDocument();
    expect(screen.getByText('«А что будет, если взять слишком большую скорость обучения?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить вопрос' }));
    expect(onRepeat).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Отвечать' })).toBeInTheDocument();
  });

  it('stands at the height of the asked row on a desktop, never past the window', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('innerHeight', 900);
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-point') === 'p4') return rect(400, 52) as DOMRect;
      if (this.classList.contains('or-examiner')) return rect(100, 200) as DOMRect;
      return rect(0, 0) as DOMRect;
    });
    const { container } = render(
      <div>
        <div data-point="p4" />
        <ExaminerLine question="Вопрос?" alignTo="p4" />
      </div>,
    );
    // 400 − 100 − 18 = 282 px lower, inside the 900 px window: margin 28 + 282.
    expect((container.querySelector('.or-examiner') as HTMLElement).style.marginTop).toBe('310px');
    spy.mockRestore();
  });

  it('sets a short question at 40 px, a longer one at 32 px and a long one at 26 px (Jury_Check item 9)', () => {
    const short = 'А что будет, если взять слишком большую скорость обучения?';
    const medium = 'А что будет с выручкой кофейни, если она поднимет цену на капучино, а спрос на него эластичен по цене?';
    const long = `${medium} И как это зависит от того, есть ли у капучино заменители рядом, например чай или какао в соседнем кафе?`;
    expect(short.length).toBeLessThanOrEqual(90);
    expect(medium.length).toBeGreaterThan(90);
    expect(medium.length).toBeLessThanOrEqual(140);
    expect(long.length).toBeGreaterThan(140);
    expect([short, medium, long].map(questionSize)).toEqual(['l', 'm', 's']);
    expect(questionSize('x'.repeat(90))).toBe('l');
    expect(questionSize('x'.repeat(91))).toBe('m');
    expect(questionSize('x'.repeat(140))).toBe('m');
    expect(questionSize('x'.repeat(141))).toBe('s');
    expect(questionSize('x'.repeat(200))).toBe('s');
    const { container, rerender } = render(<ExaminerLine question={short} />);
    expect(container.querySelector('.or-examiner-q')).toHaveAttribute('data-size', 'l');
    rerender(<ExaminerLine question={long} />);
    expect(container.querySelector('.or-examiner-q')).toHaveAttribute('data-size', 's');
  });

  it('keeps a tall block inside the window, and places it again when it grows', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('innerHeight', 720);
    let observed: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observed = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let blockHeight = 440;
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-point') === 'p4') return rect(450, 52) as DOMRect;
      // The block's natural place (its own margin reset): top 130.
      if (this.classList.contains('or-examiner')) return rect(130, blockHeight) as DOMRect;
      return rect(0, 0) as DOMRect;
    });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('or-examiner') ? blockHeight : 0;
    });
    const { container } = render(
      <div>
        <div data-point="p4" />
        <ExaminerLine question="Вопрос?" alignTo="p4" />
      </div>,
    );
    const block = container.querySelector('.or-examiner') as HTMLElement;
    // The row wants 450 − 130 − 18 = 302 px; the window leaves 720 − 570 − 16 = 134: margin 28 + 134.
    expect(block.style.marginTop).toBe('162px');
    // A hint makes it taller: it moves up so its buttons stay in view.
    blockHeight = 480;
    act(() => observed?.());
    expect(block.style.marginTop).toBe(`${28 + (720 - 130 - 480 - 16)}px`);
    // The same height again (the margin moved it, nothing grew): no new measurement.
    const calls = spy.mock.calls.length;
    act(() => observed?.());
    expect(spy.mock.calls.length).toBe(calls);
    spy.mockRestore();
    height.mockRestore();
  });

  it('stays in the column’s flow on a phone', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const { container } = render(
      <div>
        <div data-point="p4" />
        <ExaminerLine question="Вопрос?" alignTo="p4" />
      </div>,
    );
    expect((container.querySelector('.or-examiner') as HTMLElement).style.marginTop).toBe('');
  });

  it('says «Экзаменатор слушает ответ…» while the follow-up is chosen', () => {
    render(<ExaminerThinking />);
    expect(screen.getByRole('status')).toHaveTextContent('Экзаменатор слушает ответ…');
  });
});

describe('<LiveTranscript>', () => {
  it('underlines only final words that opened a point and shows interim words apart', () => {
    const finalText = 'Обучение — это подбор весов, которые минимизируют функцию потерь.';
    const named = new Set(['p1']);
    const { container } = render(
      <LiveTranscript
        label="Ваш ответ, 0:18"
        finalText={finalText}
        interimText="сначала прямой проход"
        underlined={underlinedFinalWords(DEMO_RUBRIC.points, named, finalText)}
        seed={7}
      />,
    );
    expect(screen.getByText('Ваш ответ, 0:18')).toBeInTheDocument();
    const underlined = Array.from(container.querySelectorAll('.sf-under')).map((node) => node.textContent);
    // Only the words that opened the point, not every key word (redesign critique 4).
    expect(underlined).toEqual(['потерь']);
    expect(container.querySelector('.or-interim')).toHaveTextContent('сначала прямой проход');
    expect(container.querySelector('.or-said-window')).toHaveAttribute('aria-live', 'off');
  });
});
