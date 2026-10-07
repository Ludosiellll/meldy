import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { shape } from './geometry';
import { MarginStroke, Mark, PencilBrace } from './PencilSvg';
import { mergeRows, PencilOval, PencilUnder, TextMark } from './TextMarks';

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<Mark>', () => {
  it('renders an aria-hidden SVG with the deterministic path of its seed', () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<Mark kind="tick" seed={41} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('data-mark', 'tick');
    const d = svg.querySelector('path')!.getAttribute('d');
    expect(d).toBe(shape('tick', 25, 21, 41)[0].d);

    rerender(<Mark kind="tick" seed={41} />);
    expect(container.querySelector('path')!.getAttribute('d')).toBe(d);
    rerender(<Mark kind="tick" seed={42} />);
    expect(container.querySelector('path')!.getAttribute('d')).not.toBe(d);
  });

  it('draws a new judgement in through a mask and leaves old marks still', () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<Mark kind="dash" seed={3} animate delayMs={120} />);
    let svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-drawn', 'live');
    const stroke = svg.querySelector('mask path')!;
    expect(stroke).toHaveClass('sf-mark-draw');
    expect(stroke).toHaveAttribute('pathLength', '1');
    expect((stroke as SVGPathElement).style.animationDelay).toBe('120ms');

    rerender(<Mark kind="dash" seed={3} />);
    svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-drawn', 'still');
    expect(svg.querySelector('mask')).toBeNull();
  });

  it('never animates under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    const { container } = render(<Mark kind="tick" seed={3} animate />);
    expect(container.querySelector('svg')).toHaveAttribute('data-drawn', 'still');
    expect(container.querySelector('mask')).toBeNull();
  });

  it('uses graphite for the student’s own hand', () => {
    stubReducedMotion(false);
    const { container } = render(<Mark kind="under" seed={3} width={40} height={6} hand="graphite" />);
    expect(container.querySelector('svg')).toHaveClass('sf-mark-graphite');
  });

  it('draws the examiner brace and the margin stroke', () => {
    stubReducedMotion(false);
    const { container } = render(
      <div>
        <PencilBrace seed={8} />
        <MarginStroke seed={9} />
      </div>,
    );
    expect(container.querySelector('[data-mark="brace"]')).not.toBeNull();
    expect(container.querySelector('.sf-margin-stroke [data-mark="vline"]')).not.toBeNull();
  });
});

describe('text marks', () => {
  it('rings a number and keeps the number as text', () => {
    stubReducedMotion(false);
    const { container } = render(
      <TextMark kind="ring" seed={12}>
        12
      </TextMark>,
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    const wrapper = container.querySelector('.sf-textmark')!;
    expect(wrapper).toHaveAttribute('data-mark', 'ring');
    expect(wrapper.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives the same oval for the same seed', () => {
    stubReducedMotion(false);
    const first = render(<PencilOval seed={5}>Засчитано</PencilOval>);
    const d1 = first.container.querySelector('path')!.getAttribute('d');
    first.unmount();
    const second = render(<PencilOval seed={5}>Засчитано</PencilOval>);
    expect(second.container.querySelector('path')!.getAttribute('d')).toBe(d1);
  });

  it('strikes a figure out with an aria-hidden, deterministic stroke that is drawn in only when asked', () => {
    stubReducedMotion(false);
    const first = render(
      <TextMark kind="strike" seed={311}>
        60 %
      </TextMark>,
    );
    expect(screen.getByText('60 %')).toBeInTheDocument();
    const wrapper = first.container.querySelector('.sf-textmark')!;
    expect(wrapper).toHaveAttribute('data-mark', 'strike');
    const svg = wrapper.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-drawn', 'still');
    const d1 = svg.querySelector('path')!.getAttribute('d');
    first.unmount();
    const again = render(
      <TextMark kind="strike" seed={311}>
        60 %
      </TextMark>,
    );
    expect(again.container.querySelector('path')!.getAttribute('d')).toBe(d1);
    again.unmount();
    const live = render(
      <TextMark kind="strike" seed={311} animate>
        60 %
      </TextMark>,
    );
    expect(live.container.querySelector('svg')).toHaveAttribute('data-drawn', 'live');
    live.unmount();
    // Under reduced motion it is simply there.
    stubReducedMotion(true);
    const still = render(
      <TextMark kind="strike" seed={311} animate>
        60 %
      </TextMark>,
    );
    expect(still.container.querySelector('svg')).toHaveAttribute('data-drawn', 'still');
  });

  it('underlines every line the words occupy, one stroke per line', () => {
    stubReducedMotion(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return host;
    });
    const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      const list = [
        { left: 10, top: 20, width: 60, height: 24, right: 70, bottom: 44, x: 10, y: 20 },
        { left: 0, top: 48, width: 30, height: 24, right: 30, bottom: 72, x: 0, y: 48 },
      ];
      return Object.assign(list, { item: (index: number) => list[index] }) as unknown as DOMRectList;
    });
    const { container } = render(<PencilUnder seed={7}>процентного изменения цены</PencilUnder>, { container: host });
    expect(screen.getByText('процентного изменения цены')).toBeInTheDocument();
    expect(container.querySelectorAll('.sf-under-ink')).toHaveLength(2);
    offsetParent.mockRestore();
    rects.mockRestore();
    host.remove();
  });

  it('with `watch`, measures again when the words change, not on every render of new children', () => {
    stubReducedMotion(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return host;
    });
    const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      const list = [{ left: 10, top: 20, width: 60, height: 24, right: 70, bottom: 44, x: 10, y: 20 }];
      return Object.assign(list, { item: (index: number) => list[index] }) as unknown as DOMRectList;
    });
    const tree = (words: string) => (
      <PencilUnder seed={7} kind="wave" watch={words}>
        <span>{words}</span>
      </PencilUnder>
    );
    const view = render(tree('спрос ↓'), { container: host });
    const measured = rects.mock.calls.length;
    expect(measured).toBeGreaterThan(0);
    expect(host.querySelectorAll('.sf-under-ink')).toHaveLength(1);
    // The parent renders again with a new element for the same words: no new measure (no layout).
    view.rerender(tree('спрос ↓'));
    view.rerender(tree('спрос ↓'));
    expect(rects.mock.calls.length).toBe(measured);
    // Other words: measured again.
    view.rerender(tree('спрос ↑'));
    expect(rects.mock.calls.length).toBeGreaterThan(measured);
    offsetParent.mockRestore();
    rects.mockRestore();
    host.remove();
  });

  it('draws nothing where there is no layout (and keeps the words)', () => {
    stubReducedMotion(false);
    const { container } = render(<PencilUnder seed={7}>выбор</PencilUnder>);
    expect(screen.getByText('выбор')).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });
});

describe('mergeRows', () => {
  it('draws one stroke per row of words: an arrow drawn inside the words does not cut the wave', () => {
    // «ставка ↑ → кредиты»: text, an arrow's box (shorter, on the baseline), text — one row; then a second row.
    const rows = mergeRows([
      { x: 0, y: 0, w: 60, h: 27 },
      { x: 62, y: 4, w: 11, h: 18 },
      { x: 75, y: 0, w: 80, h: 27 },
      { x: 0, y: 24, w: 90, h: 27 },
    ]);
    expect(rows).toEqual([
      { x: 0, y: 0, w: 155, h: 27 },
      { x: 0, y: 24, w: 90, h: 27 },
    ]);
  });
});
