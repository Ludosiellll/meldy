import { describe, expect, it } from 'vitest';
import { stripEdges, stripScrollFor } from './scrollStrip';

describe('stripEdges: which ends of a sideways row are hidden (phone audit 47.3)', () => {
  it('a row that fits has none', () => {
    expect(stripEdges(0, 358, 358)).toEqual({ start: false, end: false });
    expect(stripEdges(0, 358, 359)).toEqual({ start: false, end: false });
  });
  it('the start, then the middle, then the end of a longer row', () => {
    expect(stripEdges(0, 358, 416)).toEqual({ start: false, end: true });
    expect(stripEdges(30, 358, 416)).toEqual({ start: true, end: true });
    expect(stripEdges(58, 358, 416)).toEqual({ start: true, end: false });
    expect(stripEdges(57.5, 358, 416)).toEqual({ start: true, end: false });
  });
});

describe('stripScrollFor: the chosen tab clear of the faded ends', () => {
  const row = { scrollLeft: 0, clientWidth: 358, scrollWidth: 416 };
  it('leaves a tab in view where it is', () => {
    expect(stripScrollFor({ left: 0, width: 92 }, row)).toBe(0);
    expect(stripScrollFor({ left: 110, width: 100 }, row)).toBe(0);
  });
  it('brings the last tab in, as far as the row goes', () => {
    expect(stripScrollFor({ left: 346, width: 70 }, row)).toBe(58);
  });
  it('brings the first tab back when the row was scrolled', () => {
    expect(stripScrollFor({ left: 0, width: 92 }, { ...row, scrollLeft: 58 })).toBe(0);
  });
  it('a tab wider than the room shows its start', () => {
    expect(stripScrollFor({ left: 100, width: 400 }, { scrollLeft: 0, clientWidth: 300, scrollWidth: 900 })).toBe(68);
  });
});
