import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LectureDesk, { LABELS, exitPoint, mapEdges } from './LectureDesk';
import { EXAM, MAP, TALK } from './lecture';

const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ');

describe('LectureDesk', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('shows the conversation, the concept map and the oral exam under plain headings', () => {
    const { container } = render(<LectureDesk />);
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([LABELS.talk, LABELS.map, LABELS.exam]);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d+ из \d+/);
    expect(container.querySelector('svg.lucide')).toBeNull();
    expect(container.querySelector('[style*="rotate"]')).toBeNull();
  });

  it('plays the conversation as exchanges the visitor steps through, with the visual for the active one', () => {
    vi.useFakeTimers();
    const { container } = render(<LectureDesk />);
    const exchanges = screen.getAllByRole('button', { pressed: undefined }).filter(b => b.classList.contains('lp-ex'));
    expect(exchanges).toHaveLength(TALK.length);
    expect(exchanges[0]).toHaveAttribute('aria-pressed', 'true');
    expect(plain(exchanges[1].textContent)).toContain(plain(TALK[1].lines[1][1]));
    const screenEl = () => container.querySelector('.lp-talk-screen')!;
    expect(screenEl().textContent).toContain(TALK[0].visual.title);

    fireEvent.click(exchanges[1]);
    expect(exchanges[1]).toHaveAttribute('aria-pressed', 'true');
    expect(exchanges[0]).toHaveAttribute('aria-pressed', 'false');
    // fade-through: the old visual leaves, the new one is already there
    expect(container.querySelectorAll('.lp-vis.is-out')).toHaveLength(1);
    expect(container.querySelector('.lp-vis.is-in')?.textContent).toContain(TALK[1].visual.title);
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelectorAll('.lp-vis')).toHaveLength(1);
    expect(screenEl().textContent).toContain(TALK[1].visual.title);

    fireEvent.keyDown(exchanges[1], { key: 'ArrowDown' });
    expect(exchanges[2]).toHaveAttribute('aria-pressed', 'true');
    expect(plain(screenEl().textContent).replace(/\u202F/g, ' ')).toContain('8 800');
  });

  it('draws the map with edges that start and end on the node boxes', () => {
    const box = { cx: 100, cy: 50, hw: 60, hh: 15 };
    expect(exitPoint(box, 100, 200)).toEqual({ x: 100, y: 65 });
    expect(exitPoint(box, 400, 50)).toEqual({ x: 160, y: 50 });
    const boxes = Object.fromEntries(MAP.nodes.map(n => [n.id, { cx: n.x * 4, cy: n.y * 2.4 + 20, hw: 70, hh: 16 }]));
    const edges = mapEdges(boxes);
    expect(edges).toHaveLength(MAP.edges.length);
    edges.forEach((edge, i) => {
      const [, x0, y0, x1, y1] = edge.d.match(/^M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)$/)!.map(Number);
      const a = boxes[MAP.edges[i].from];
      const b = boxes[MAP.edges[i].to];
      const onBorder = (p: { x: number; y: number }, r: typeof a) =>
        Math.abs(Math.abs(p.x - r.cx) - r.hw) < 0.06 || Math.abs(Math.abs(p.y - r.cy) - r.hh) < 0.06;
      expect(onBorder({ x: x0, y: y0 }, a)).toBe(true);
      expect(onBorder({ x: x1, y: y1 }, b)).toBe(true);
      expect(edge.head).toMatch(new RegExp(`L${x1.toFixed(1)} ${y1.toFixed(1)}L`));
    });
    render(<LectureDesk />);
    expect(screen.getByRole('img', { name: /^Карта понятий лекции: эластичность спроса → эластичный спрос \(\|E\| > 1\)/ })).toBeInTheDocument();
  });

  it('shows one exam turn: the question, an answer and the examiner’s note', () => {
    const { container } = render(<LectureDesk />);
    const turns = Array.from(container.querySelectorAll('.lp-exam .lp-line')).map(p => plain(p.textContent));
    expect(turns).toEqual([`Экзаменатор${plain(EXAM.question)}`, `Вы${plain(EXAM.answer)}`, `Экзаменатор${plain(EXAM.note)}`]);
  });
});
