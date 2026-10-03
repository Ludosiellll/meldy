import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import LiveTranscript from './LiveTranscript';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom has no layout: every underlined word gets one line box inside a positioned parent. */
function layoutUnderlines() {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    return this.parentElement;
  });
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => [{ left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30, x: 10, y: 10 }] as unknown as DOMRectList,
  );
}

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

  it('draws a new underline in once and keeps the lines of a restored answer still', () => {
    layoutUnderlines();
    const finalText = 'Обучение — это подбор весов, которые минимизируют функцию потерь. Потом прямой проход.';
    const indexOf = (word: string) => finalText.toLowerCase().replace(/[^а-яё ]/g, ' ').split(/\s+/).filter(Boolean).indexOf(word);
    const restored = new Set([indexOf('потерь')]);
    const view = render(<LiveTranscript label="Ваш ответ, 0:18" finalText={finalText} interimText="" underlined={restored} seed={3} drawNew />);
    const drawn = () =>
      Array.from(view.container.querySelectorAll('.sf-under')).map((node) => [node.textContent, node.querySelector('svg')?.getAttribute('data-drawn')]);
    // The restored answer: its line is simply there.
    expect(drawn()).toEqual([['потерь', 'still']]);
    // A point named now: its words draw in; the old line stays still.
    view.rerender(
      <LiveTranscript label="Ваш ответ, 0:19" finalText={finalText} interimText="" underlined={new Set([...restored, indexOf('прямой'), indexOf('проход')])} seed={3} drawNew />,
    );
    expect(drawn()).toEqual([
      ['потерь', 'still'],
      ['прямой проход', 'live'],
    ]);
  });
});
