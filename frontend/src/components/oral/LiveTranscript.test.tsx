import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import LiveTranscript from './LiveTranscript';

afterEach(() => {
  cleanup();
});

/** jsdom has no layout: the window gets a height, a content height and a clamped scroll position. */
function measure(frame: HTMLElement, clientHeight: number, contentHeight: () => number) {
  let top = 0;
  Object.defineProperty(frame, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(frame, 'scrollHeight', { configurable: true, get: () => Math.max(clientHeight, contentHeight()) });
  Object.defineProperty(frame, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, Math.max(clientHeight, contentHeight()) - clientHeight));
    },
  });
}

describe('<LiveTranscript>', () => {
  it('keeps the newest words in view in a scrolling window, and leaves a reader who scrolled up alone', () => {
    const props = { label: 'Ваш ответ, 0:40', underlined: new Set<number>(), seed: 1 };
    let said = 'Обучение — это подбор весов.';
    let interim = '';
    // 26 px a line, about 40 characters a line at 390 px.
    const contentHeight = () => Math.ceil((said.length + interim.length) / 40) * 26;
    const view = render(<LiveTranscript {...props} finalText={said} interimText={interim} />);
    const frame = view.container.querySelector<HTMLElement>('.or-said-window')!;
    measure(frame, 200, contentHeight);

    const rerender = () => view.rerender(<LiveTranscript {...props} finalText={said} interimText={interim} />);
    // Final words beyond the window's height: it scrolls to them.
    said += ' Сначала прямой проход: данные идут через слои к предсказанию.'.repeat(6);
    rerender();
    const afterFinal = frame.scrollTop;
    expect(afterFinal).toBeGreaterThan(0);
    expect(afterFinal).toBe(frame.scrollHeight - 200);
    // Words still being recognised are followed too.
    interim = ' потом обратное распространение ошибки считает градиент по каждому весу';
    rerender();
    expect(frame.scrollTop).toBeGreaterThan(afterFinal);
    expect(frame.scrollTop).toBe(frame.scrollHeight - 200);

    // The student scrolls up to reread: new words do not pull the window down.
    frame.scrollTop = 26;
    fireEvent.scroll(frame);
    said += ' Скорость обучения: большая ускоряет обучение, но может вызвать колебания.';
    interim = '';
    rerender();
    expect(frame.scrollTop).toBe(26);

    // Back near the bottom (within 32 px): it follows again.
    frame.scrollTop = frame.scrollHeight - 200 - 20;
    fireEvent.scroll(frame);
    said += ' Adam подбирает шаг для каждого параметра отдельно.';
    rerender();
    expect(frame.scrollTop).toBe(frame.scrollHeight - 200);
  });

  it('does not touch the scroll position of a window that has nothing to scroll', () => {
    const view = render(<LiveTranscript label="Ваш ответ, 0:05" finalText="Обучение" interimText="" underlined={new Set()} seed={1} />);
    const frame = view.container.querySelector<HTMLElement>('.or-said-window')!;
    let writes = 0;
    Object.defineProperty(frame, 'clientHeight', { configurable: true, get: () => 88 });
    Object.defineProperty(frame, 'scrollHeight', { configurable: true, get: () => 88 });
    Object.defineProperty(frame, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => {
        writes += 1;
      },
    });
    view.rerender(<LiveTranscript label="Ваш ответ, 0:06" finalText="Обучение — это подбор весов" interimText="" underlined={new Set()} seed={1} />);
    expect(writes).toBe(0);
  });
});
