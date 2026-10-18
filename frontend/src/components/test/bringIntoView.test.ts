import { afterEach, describe, expect, it, vi } from 'vitest';
import { bringIntoView } from './bringIntoView';

/** An element that reports this box (the window is 800 px tall, nothing at the top or bottom). */
function box(top: number, bottom: number): Element {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) });
  return element;
}

describe('bringIntoView: a saved card stays where the author sees it (release 47, M2)', () => {
  const scroll = vi.fn();
  afterEach(() => {
    vi.restoreAllMocks();
    scroll.mockReset();
  });
  const setup = (reduced = false) => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1000);
    vi.spyOn(window, 'scrollTo').mockImplementation(scroll as never);
    window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce') })) as never;
  };

  it('does nothing when the card and its button are in view', () => {
    setup();
    bringIntoView(box(100, 300), box(260, 300));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('brings a card below the window up so it ends at the bottom edge', () => {
    setup();
    bringIntoView(box(700, 1000), box(950, 1000));
    expect(scroll).toHaveBeenCalledWith({ top: 1000 + 1000 - 788, behavior: 'smooth' });
  });

  it('brings a card above the window down to the top edge', () => {
    setup();
    bringIntoView(box(-200, 100), box(60, 100));
    expect(scroll).toHaveBeenCalledWith({ top: 1000 - 200 - 12, behavior: 'smooth' });
  });

  it('a card taller than the window: the button that has the focus wins; no animation when less motion is asked', () => {
    setup(true);
    bringIntoView(box(-500, 1200), box(1150, 1200));
    expect(scroll).toHaveBeenCalledWith({ top: 1000 + 1200 - 788, behavior: 'auto' });
  });

  it('a document without layout (zero boxes) is left alone', () => {
    setup();
    bringIntoView(box(0, 0), box(0, 0));
    expect(scroll).not.toHaveBeenCalled();
  });
});
