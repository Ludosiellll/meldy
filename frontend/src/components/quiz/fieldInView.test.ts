import { afterEach, describe, expect, it, vi } from 'vitest';
import { fieldDelta, visibleEdges } from './fieldInView';

describe('fieldDelta: the least scroll that shows a field between the edges (phone audit 47.3)', () => {
  const edges = { top: 52, bottom: 382 };
  it('leaves a field in view alone', () => {
    expect(fieldDelta({ top: 100, bottom: 154 }, edges)).toBe(0);
  });
  it('brings a field under the lower edge up', () => {
    expect(fieldDelta({ top: 360, bottom: 414 }, edges)).toBe(32);
  });
  it('brings a field above the upper edge down', () => {
    expect(fieldDelta({ top: 20, bottom: 74 }, edges)).toBe(-32);
  });
  it('a field taller than the room: its top wins', () => {
    expect(fieldDelta({ top: 200, bottom: 700 }, edges)).toBe(148);
  });
});

describe('visibleEdges', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  const box = (element: Element, top: number, bottom: number) => {
    element.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) });
  };

  it('takes the room’s top line and a pinned bar at the bottom of what is shown away', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(390);
    const top = document.createElement('header');
    top.className = 'sf-room-bar';
    box(top, 0, 44);
    const bar = document.createElement('div');
    bar.className = 'ct-bar';
    bar.style.position = 'sticky';
    box(bar, 310, 390);
    document.body.append(top, bar);
    expect(visibleEdges()).toEqual({ top: 52, bottom: 302 });
    // A bar in the page's flow (a phone turned sideways) is content, not an edge.
    bar.style.position = 'relative';
    expect(visibleEdges()).toEqual({ top: 52, bottom: 382 });
  });
});
