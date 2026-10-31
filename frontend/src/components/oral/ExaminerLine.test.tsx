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

  it('a line that comes and goes (a hint, the microphone’s line) moves the block up once and never back down', () => {
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
    const margins = [block.style.marginTop];
    // «Говорите, я слушаю» comes and goes three times: the block is 40 px taller, then as before.
    for (const next of [480, 440, 480, 440, 480, 440]) {
      blockHeight = next;
      act(() => observed?.());
      margins.push(block.style.marginTop);
    }
    // Before the fix: 162, 122, 162, 122, 162, 122, 162 — up and down at every change.
    expect(margins).toEqual(['162px', '122px', '122px', '122px', '122px', '122px', '122px']);
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

  describe('on a phone: the question and the answer above the answer bar (jury QA of /try, 2026-10-11)', () => {
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    /** A 360×800 phone: the room's top line to 64 px, the follow-up's answer bar pinned from 724 px; the window at `scrollY`. */
    function phone(block: () => DOMRect, scrollY = 1200) {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
      vi.stubGlobal('innerHeight', 800);
      vi.stubGlobal('scrollY', scrollY);
      const scrollTo = vi.fn();
      vi.stubGlobal('scrollTo', scrollTo);
      const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.classList.contains('sf-room-bar')) return rect(0, 64);
        if (this.classList.contains('or-acts')) return rect(724, 76);
        if (this.classList.contains('or-examiner')) return block();
        return rect(0, 0);
      });
      return { scrollTo, spy };
    }
    const room = (question = 'Какие крайние случаи ценовой эластичности спроса бывают?') => (
      <div>
        <header className="sf-room-bar" />
        <ExaminerLine question={question} alignTo="p5">
          <textarea aria-label="Ответ на вопрос экзаменатора" />
          <div className="or-acts" style={{ position: 'fixed' }}>
            <button type="button">Готово</button>
          </div>
        </ExaminerLine>
      </div>
    );

    it('when the question comes, before it is seen: the least scroll that clears the bar', () => {
      // At 360×800 the question ended at 738 px and the field at 866 px — under the bar from 724 px.
      const { scrollTo, spy } = phone(() => rect(601, 265));
      render(room());
      // The band is 76..712 (12 px of air): the block's end goes up by 866 − 712.
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith({ top: 1200 + 866 - 712, behavior: 'instant' });
      spy.mockRestore();
    });

    it('a block in the band already is left where it is', () => {
      const { scrollTo, spy } = phone(() => rect(300, 265));
      render(room());
      expect(scrollTo).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('a block taller than the band shows its question first', () => {
      const { scrollTo, spy } = phone(() => rect(601, 700));
      render(room());
      expect(scrollTo).toHaveBeenCalledWith({ top: 1200 + 601 - 76, behavior: 'instant' });
      spy.mockRestore();
    });

    it('grown under the eye (the transcript opens), it follows smoothly; scrolled away from, it stays', () => {
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
      let box = rect(300, 265);
      let blockHeight = 265;
      const { scrollTo, spy } = phone(() => box);
      const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('or-examiner') ? blockHeight : 0;
      });
      render(room());
      expect(scrollTo).not.toHaveBeenCalled();
      // The transcript under the question: 120 px more, its end under the bar.
      blockHeight = 385;
      box = rect(400, 385);
      act(() => observed?.());
      expect(scrollTo).toHaveBeenCalledWith({ top: 1200 + 785 - 712, behavior: 'smooth' });
      // The student scrolled up to the answer sheet (the block's top below the band): nothing moves when it grows.
      scrollTo.mockClear();
      blockHeight = 410;
      box = rect(760, 410);
      act(() => observed?.());
      expect(scrollTo).not.toHaveBeenCalled();
      spy.mockRestore();
      height.mockRestore();
    });
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
