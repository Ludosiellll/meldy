import { describe, expect, it } from 'vitest';
import {
  layoutDiagram,
  pointInRect,
  segmentIntersectsRect,
  wrapLabel,
  type DiagramLayout,
  type LayoutBox,
} from './diagramLayout';
import type { DiagramEdge, DiagramNode } from './types';

function overlaps(a: LayoutBox, b: LayoutBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Общие проверки: блоки в пределах холста и не пересекаются, линии и подписи не лежат на чужих блоках. */
function expectClean(layout: DiagramLayout) {
  const { boxes, edges, width, height } = layout;
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(width + 0.5);
    expect(box.y + box.h).toBeLessThanOrEqual(height + 0.5);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      expect(overlaps(boxes[i], boxes[j]), `${boxes[i].id} overlaps ${boxes[j].id}`).toBe(false);
    }
  }
  for (const edge of edges) {
    const third = boxes.filter(box => box.id !== edge.from && box.id !== edge.to);
    for (let index = 1; index < edge.points.length; index += 1) {
      for (const box of third) {
        expect(
          segmentIntersectsRect(edge.points[index - 1], edge.points[index], box),
          `${edge.key} crosses ${box.id}`,
        ).toBe(false);
      }
    }
    for (const point of edge.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(height);
    }
    if (edge.labelText) {
      const label = { x: edge.labelX as number, y: edge.labelY as number };
      for (const box of boxes) {
        expect(pointInRect(label, box), `label of ${edge.key} sits on ${box.id}`).toBe(false);
      }
    }
  }
}

const memoryNodes: DiagramNode[] = [
  { id: 'sens', label: 'Сенсорная память' },
  { id: 'short', label: 'Кратковременная' },
  { id: 'long', label: 'Долговременная' },
];
const memoryEdges: DiagramEdge[] = [
  { from: 'sens', to: 'short', label: 'внимание' },
  { from: 'short', to: 'long', label: 'повторение' },
  { from: 'long', to: 'short', label: 'извлечение' },
];

describe('diagram layout', () => {
  const chainNodes = [
    { id: 'a', label: 'Испарение' },
    { id: 'b', label: 'Конденсация' },
    { id: 'c', label: 'Осадки' },
  ];

  it('lays out a chain left to right in reading order', () => {
    const chain = layoutDiagram(chainNodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 600);
    expect(chain.kind).toBe('layered-horizontal');
    expect(chain.boxes.map(box => box.id)).toEqual(['a', 'b', 'c']);
    expect(chain.boxes[0].x).toBeLessThan(chain.boxes[1].x);
    expect(chain.boxes[1].x).toBeLessThan(chain.boxes[2].x);
    expectClean(chain);
  });

  it('keeps a cycle in reading order and routes the closing edge around the boxes', () => {
    const cycle = layoutDiagram(
      chainNodes,
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a', label: 'снова' }],
      600,
    );
    expect(cycle.kind).toBe('layered-horizontal');
    const x = Object.fromEntries(cycle.boxes.map(box => [box.id, box.x]));
    expect(x.a).toBeLessThan(x.b);
    expect(x.b).toBeLessThan(x.c);
    const closing = cycle.edges.find(edge => edge.from === 'c' && edge.to === 'a');
    expect(closing?.routed).toBe(true);
    expect(closing?.labelText).toBe('снова');
    expectClean(cycle);
  });

  it('draws reciprocal edges as two lines with labels on opposite sides', () => {
    const layout = layoutDiagram(memoryNodes, memoryEdges, 590);
    expect(layout.kind).toBe('layered-horizontal');
    const x = Object.fromEntries(layout.boxes.map(box => [box.id, box.x]));
    expect(x.sens).toBeLessThan(x.short);
    expect(x.short).toBeLessThan(x.long);

    const forward = layout.edges.find(edge => edge.key === 'short->long');
    const reverse = layout.edges.find(edge => edge.key === 'long->short');
    expect(forward && reverse).toBeTruthy();
    if (!forward || !reverse) return;
    expect(forward.routed).toBe(false);
    expect(reverse.routed).toBe(false);
    // Две параллельные линии, а не одна.
    expect(Math.abs(forward.points[0].y - reverse.points[0].y)).toBeGreaterThanOrEqual(9);
    // «повторение» над своей линией, «извлечение» — под своей.
    expect(forward.labelY as number).toBeLessThan(forward.points[0].y);
    expect(reverse.labelY as number).toBeGreaterThan(reverse.points[0].y);
    expect(Math.abs((forward.labelY as number) - (reverse.labelY as number))).toBeGreaterThanOrEqual(24);
    expect(forward.labelText).toBe('повторение');
    expect(reverse.labelText).toBe('извлечение');
    expectClean(layout);
  });

  it('switches to rows on a phone and never splits ordinary words', () => {
    const layout = layoutDiagram(memoryNodes, memoryEdges, 324);
    expect(layout.kind).toBe('layered-vertical');
    const y = Object.fromEntries(layout.boxes.map(box => [box.id, box.y]));
    expect(y.sens).toBeLessThan(y.short);
    expect(y.short).toBeLessThan(y.long);
    for (const box of layout.boxes) {
      expect(box.lines.join(' ')).toBe(box.label);
      expect(box.lines.some(line => line.endsWith('-'))).toBe(false);
    }
    expectClean(layout);
  });

  it('routes a skip-layer edge around the middle box', () => {
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c', label: 'напрямую' }];
    for (const width of [590, 342]) {
      const layout = layoutDiagram(chainNodes, edges, width);
      const skip = layout.edges.find(edge => edge.key === 'a->c');
      expect(skip?.routed).toBe(true);
      expect(skip?.labelText).toBe('напрямую');
      expectClean(layout);
    }
  });

  it('keeps 3–7 node cycles readable at phone and desktop widths', () => {
    for (const count of [3, 4, 5, 6, 7]) {
      const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, label: `Этап номер ${index + 1}` }));
      const edges = nodes.map((node, index) => ({ from: node.id, to: nodes[(index + 1) % count].id, label: 'дальше' }));
      for (const width of [342, 590]) {
        const layout = layoutDiagram(nodes, edges, width);
        expect(layout.boxes).toHaveLength(count);
        expectClean(layout);
      }
    }
  });

  it('lays out wide layers and isolated nodes without overlaps', () => {
    const nodes = Array.from({ length: 7 }, (_, index) => ({ id: `n${index}`, label: `Узел ${index + 1}` }));
    const star = nodes.slice(1).map(node => ({ from: 'n0', to: node.id }));
    for (const width of [342, 590]) {
      expectClean(layoutDiagram(nodes, star, width));
      expectClean(layoutDiagram(nodes, [{ from: 'n0', to: 'n1' }, { from: 'n2', to: 'n3' }], width));
    }
  });

  it('switches to rows when there are too many layers for the width', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, label: `Шаг ${index + 1}` }));
    const edges = many.slice(1).map((node, index) => ({ from: many[index].id, to: node.id }));
    const layout = layoutDiagram(many, edges, 340);
    expect(layout.kind).toBe('layered-vertical');
    expectClean(layout);
  });

  it('wraps long labels into a limited number of lines', () => {
    expect(wrapLabel('Очень длинная подпись для узла схемы', 12, 2)).toEqual(['Очень', 'длинная…']);
    expect(wrapLabel('Короткая', 12, 2)).toEqual(['Короткая']);
    expect(wrapLabel('Кратковременная память', 11, 3, 16)).toEqual(['Кратковременная', 'память']);
    expect(wrapLabel('Электрофизиологический', 11, 3, 16)).toEqual(['Электрофиз-', 'иологическ-', 'ий']);
  });
});
