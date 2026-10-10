import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearningEvent } from '../../../api/learning';
import { buildSheet, localDayOf, type SheetBlock, type SheetQuestion } from '../../../lib/exams/cheatSheet';
import { createDrawnStore, mapLines, SheetMap, squareState } from './SheetMap';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = new Date(2026, 9, 5, 12, 0).getTime();
const DAY = 24 * 3600 * 1000;

function question(position: number, points: number, extra: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: `q${position}`,
    position,
    label: '',
    section: null,
    text: `Вопрос ${position}`,
    question_hash: String(position).padStart(32, '0'),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: {
      rubric_id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
      built_at: null,
      coverage: 'full',
      coverage_note: '',
      materials: [],
      points: Array.from({ length: points }, (_, index) => ({
        id: `p${index + 1}`,
        title: `Пункт ${index + 1} вопроса ${position}`,
        short: `пункт ${index + 1}`,
        essential: index === 0,
        source_quote: '',
        source_ids: [],
      })),
    },
    ...extra,
  };
}

let sequence = 0;
function named(q: SheetQuestion, pointId: string, at: number): LearningEvent {
  sequence += 1;
  return {
    id: `e${sequence}`,
    created_at: new Date(at).toISOString(),
    local_date: localDayOf(at),
    material_id: null,
    kind: 'oral_point',
    item_key: `oral:${q.rubric!.rubric_id}:${pointId}`,
    correct: true,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: `s${sequence}`,
    payload: { v: 1, rubric_id: q.rubric!.rubric_id, point_id: pointId, question_hash: q.question_hash, title: '', status: 'covered' },
  };
}

/** Two questions: the first point of the first erased (named on two days), its second named once; the rest there. */
function sheet(): SheetBlock[] {
  const q1 = question(1, 3);
  const q2 = question(2, 2);
  return buildSheet([q1, q2], [named(q1, 'p1', NOW - 3 * DAY), named(q1, 'p1', NOW - DAY), named(q1, 'p2', NOW - DAY)], NOW).blocks;
}

const squares = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.cs-sq')].map((square) => square.dataset.s);
const legend = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.cs-legend > span')].map((item) => [item.querySelector('i')?.dataset.s, item.textContent]);

describe('the map of the lines', () => {
  it('says how a square stands for each state of a line', () => {
    expect(squareState('fresh')).toBe('left');
    expect(squareState('missed')).toBe('left');
    expect(squareState('returned')).toBe('left');
    expect(squareState('rubbed')).toBe('half');
    expect(squareState('due')).toBe('due');
    expect(squareState('erased')).toBe('gone');
  });

  it('draws one square per line in the sheet’s order, each line once', () => {
    const blocks = sheet();
    expect(mapLines(blocks).map((line) => line.key)).toEqual(blocks.flatMap((block) => block.lines.map((line) => line.key)));
    // Two questions of the same text share their lines (as the count does): one square each.
    expect(mapLines([...blocks, blocks[0]])).toHaveLength(5);
    const { container } = render(<SheetMap blocks={blocks} />);
    expect(squares(container)).toEqual(['gone', 'half', 'left', 'left', 'left']);
    // For the eye: the count beside it says it in words.
    expect(container.querySelector('.cs-map')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.cs-legend')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keys the squares in one line under the map, «пора проверить» only while a line is due', () => {
    const { container, rerender } = render(<SheetMap blocks={sheet()} />);
    expect(legend(container)).toEqual([
      ['left', 'осталось'],
      ['half', 'названо один раз'],
      ['gone', 'стёрто'],
    ]);
    const due = sheet().map((block, index) =>
      index === 0 ? { ...block, lines: block.lines.map((line, at) => (at === 0 ? { ...line, status: { ...line.status, state: 'due' as const } } : line)) } : block,
    );
    rerender(<SheetMap blocks={due} />);
    expect(squares(container)[0]).toBe('due');
    expect(legend(container).map(([state]) => state)).toEqual(['left', 'half', 'gone', 'due']);
  });

  it('lays the squares out in one even grid: 12 px for a few lines, smaller on a phone and for hundreds', () => {
    const { container, rerender } = render(<SheetMap blocks={sheet()} />);
    const map = () => container.querySelector<HTMLElement>('.cs-map')!;
    expect(map().style.getPropertyValue('--cs-sq')).toBe('12px');
    rerender(<SheetMap blocks={sheet()} compact />);
    expect(container.querySelector('.cs-mapbox')).toHaveAttribute('data-compact', '');
    expect(map().style.getPropertyValue('--cs-sq')).toBe('8px');
    const many = buildSheet(
      Array.from({ length: 60 }, (_, index) => question(index + 1, 10)),
      [],
      NOW,
    ).blocks;
    rerender(<SheetMap blocks={many} />);
    expect(container.querySelectorAll('.cs-sq')).toHaveLength(600);
    expect(parseInt(map().style.getPropertyValue('--cs-sq'), 10)).toBeLessThan(12);
  });

  it('follows what the paper draws, then the sheet as it is', () => {
    const blocks = sheet();
    const drawn = createDrawnStore();
    const { container } = render(<SheetMap blocks={blocks} drawn={drawn} />);
    const key = blocks[0].lines[0].key;
    act(() => drawn.set({ states: new Map([[key, 'rubbed']]), motions: new Map() }));
    expect(squares(container)[0]).toBe('half');
    act(() => drawn.set({ states: new Map([[key, 'erased']]), motions: new Map([[key, { anim: 'erase', delay: 120, ms: 560 }]]) }));
    const first = container.querySelector<HTMLElement>('.cs-sq')!;
    expect([first.dataset.s, first.dataset.anim, first.style.getPropertyValue('--cs-delay'), first.style.getPropertyValue('--cs-ms')]).toEqual(['gone', 'erase', '120ms', '560ms']);
    act(() => drawn.set({ states: new Map(), motions: new Map() }));
    expect(first.dataset.anim).toBeUndefined();
    expect(squares(container)[0]).toBe('gone');
  });

  it('a square under the pointer lights its line; a click brings the line into view for a moment', () => {
    vi.useFakeTimers();
    const blocks = sheet();
    const { container } = render(
      <>
        <SheetMap blocks={blocks} />
        <ul>
          {blocks.flatMap((block) => block.lines).map((line) => (
            <li key={line.key} className="cs-line" data-key={line.key} />
          ))}
        </ul>
      </>,
    );
    const lines = [...container.querySelectorAll<HTMLElement>('li.cs-line')];
    const squareEls = [...container.querySelectorAll<HTMLElement>('.cs-sq')];
    fireEvent.mouseOver(squareEls[3]);
    expect(lines.map((line) => line.hasAttribute('data-hot'))).toEqual([false, false, false, true, false]);
    fireEvent.mouseOver(squareEls[1]);
    expect(lines.map((line) => line.hasAttribute('data-hot'))).toEqual([false, true, false, false, false]);
    fireEvent.mouseLeave(container.querySelector('.cs-map')!);
    expect(lines.some((line) => line.hasAttribute('data-hot'))).toBe(false);
    const scrolled = vi.fn();
    Object.defineProperty(lines[4], 'scrollIntoView', { configurable: true, value: scrolled });
    fireEvent.click(squareEls[4]);
    expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(lines[4].hasAttribute('data-hot')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(lines[4].hasAttribute('data-hot')).toBe(false);
  });
});
