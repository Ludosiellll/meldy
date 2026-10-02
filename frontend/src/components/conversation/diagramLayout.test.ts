import { describe, expect, it } from 'vitest';
import {
  labelRect,
  layoutDiagram,
  pointInRect,
  polylineHitsRect,
  rectsOverlap,
  segmentIntersectsRect,
  simpleCycleOrder,
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

/** Ни одна подпись не лежит на линии (своей или чужой), на блоке или на другой подписи. */
function expectLabelsClear(layout: DiagramLayout) {
  const labelled = layout.edges.filter(edge => edge.labelText);
  const rects = labelled.map(edge =>
    labelRect(edge.labelText as string, edge.labelX as number, edge.labelY as number, edge.labelAnchor ?? 'middle'),
  );
  labelled.forEach((edge, index) => {
    const rect = rects[index];
    const ink = { x: rect.x + 3, y: rect.y + 4, w: rect.w - 6, h: rect.h - 8 };
    for (const other of layout.edges) {
      expect(polylineHitsRect(other.points, ink), `label of ${edge.key} is crossed by ${other.key}`).toBe(false);
    }
    for (const box of layout.boxes) expect(rectsOverlap(rect, box), `label of ${edge.key} on ${box.id}`).toBe(false);
    rects.slice(index + 1).forEach((other, offset) => {
      expect(rectsOverlap(rect, other), `label of ${edge.key} on label of ${labelled[index + 1 + offset].key}`).toBe(false);
    });
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(layout.width);
  });
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

  it('draws a simple cycle as a ring that visibly closes', () => {
    const cycle = layoutDiagram(
      chainNodes,
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a', label: 'снова' }],
      600,
    );
    expect(cycle.kind).toBe('cycle');
    // Первый узел сверху, дальше по часовой стрелке.
    const [a, b, c] = ['a', 'b', 'c'].map(id => cycle.boxes.find(box => box.id === id) as LayoutBox);
    expect(a.y).toBeLessThan(b.y);
    expect(b.x).toBeGreaterThan(c.x);
    const closing = cycle.edges.find(edge => edge.from === 'c' && edge.to === 'a');
    expect(closing?.routed).toBe(false);
    expect(closing?.d).toMatch(/A/);
    expect(closing?.labelText).toBe('снова');
    expectClean(cycle);
    expectLabelsClear(cycle);
  });

  it('keeps the carbon cycle a ring on desktop and on a phone, with every label whole', () => {
    const nodes = [
      { id: 'a', label: 'Атмосфера' },
      { id: 'p', label: 'Растения' },
      { id: 'n', label: 'Животные' },
      { id: 'd', label: 'Разложение' },
    ];
    const edges = [
      { from: 'a', to: 'p', label: 'фотосинтез' },
      { from: 'p', to: 'n', label: 'питание' },
      { from: 'n', to: 'd' },
      { from: 'd', to: 'a', label: 'дыхание' },
    ];
    for (const width of [587, 323]) {
      const layout = layoutDiagram(nodes, edges, width);
      expect(layout.kind).toBe('cycle');
      for (const edge of layout.edges) {
        if (edge.label) expect(edge.labelText).toBe(edge.label);
      }
      expectClean(layout);
      expectLabelsClear(layout);
    }
  });

  it('falls back to layers when a ring would cut labels or squeeze arcs', () => {
    const nodes = Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, label: `Стадия клеточного цикла ${index + 1}` }));
    const edges = nodes.map((node, index) => ({ from: node.id, to: nodes[(index + 1) % 6].id, label: 'переход к следующей' }));
    const layout = layoutDiagram(nodes, edges, 306);
    expect(layout.kind).not.toBe('cycle');
    expectClean(layout);
    // Цикл внутри большей схемы (модель памяти) кольцом не рисуется.
    expect(simpleCycleOrder(memoryNodes, memoryEdges)).toBeNull();
    expect(layoutDiagram(memoryNodes, memoryEdges, 590).kind).toBe('layered-horizontal');
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
    expectLabelsClear(layout);
  });

  it('draws flows as curves from their own places on the box sides, labels off the lines', () => {
    const nodes = [
      { id: 'l', label: 'Свет' },
      { id: 'w', label: 'Вода' },
      { id: 'co2', label: 'Углекислый газ' },
      { id: 'c', label: 'Хлоропласт' },
      { id: 'o', label: 'Кислород' },
      { id: 'g', label: 'Глюкоза' },
    ];
    const edges = [
      { from: 'l', to: 'c', label: 'энергия' },
      { from: 'w', to: 'c' },
      { from: 'co2', to: 'c' },
      { from: 'c', to: 'o', label: 'выделяется' },
      { from: 'c', to: 'g' },
    ];
    for (const width of [684, 587]) {
      const layout = layoutDiagram(nodes, edges, width);
      expect(layout.kind).toBe('layered-horizontal');
      const hub = layout.boxes.find(box => box.id === 'c') as LayoutBox;
      const incoming = layout.edges.filter(edge => edge.to === 'c');
      expect(incoming.every(edge => edge.curve && !edge.routed)).toBe(true);
      // Три стрелки входят в левую сторону блока в разных местах, не ближе 10 px.
      const ends = incoming.map(edge => (edge.curve as NonNullable<typeof edge.curve>)[3]).sort((p, q) => p.y - q.y);
      ends.forEach(end => {
        expect(end.x).toBeCloseTo(hub.x - 2, 5);
        expect(end.y).toBeGreaterThan(hub.y);
        expect(end.y).toBeLessThan(hub.y + hub.h);
      });
      for (let index = 1; index < ends.length; index += 1) expect(ends[index].y - ends[index - 1].y).toBeGreaterThanOrEqual(10);
      expectClean(layout);
      expectLabelsClear(layout);
    }
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
    expectLabelsClear(layout);
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
    // Перенос — по слогам: после гласной, по три буквы с каждой стороны.
    expect(wrapLabel('Электрофизиологический', 11, 3, 16)).toEqual(['Электрофи-', 'зиологиче-', 'ский']);
    expect(wrapLabel('Хлоропласт', 9, 2, 0)).toEqual(['Хлоро-', 'пласт']);
    expect(wrapLabel('Углекислый газ', 9, 2, 0)).toEqual(['Углеки-', 'слый газ']);
    expect(wrapLabel('Сине-зелёные водоросли', 8, 4, 0)).toEqual(['Сине-', 'зелёные', 'водоро-', 'сли']);
    // Строка не начинается с й, ь или ъ, даже когда слог не нашёлся.
    for (const line of wrapLabel('Музейный', 5, 3, 0).slice(1)) expect(line[0]).not.toMatch(/[йьъ]/i);
  });

  it('keeps short words whole in phone rows by giving each row its own box width', () => {
    const nodes = [
      { id: 'l', label: 'Свет' },
      { id: 'w', label: 'Вода' },
      { id: 'co2', label: 'Углекислый газ' },
      { id: 'c', label: 'Хлоропласт' },
      { id: 'o', label: 'Кислород' },
      { id: 'g', label: 'Глюкоза' },
    ];
    const edges = [
      { from: 'l', to: 'c', label: 'энергия' },
      { from: 'w', to: 'c' },
      { from: 'co2', to: 'c' },
      { from: 'c', to: 'o', label: 'выделяется' },
      { from: 'c', to: 'g' },
    ];
    for (const width of [294, 309]) {
      const layout = layoutDiagram(nodes, edges, width);
      expect(layout.kind).toBe('layered-vertical');
      const hub = layout.boxes.find(box => box.id === 'c') as LayoutBox;
      const input = layout.boxes.find(box => box.id === 'l') as LayoutBox;
      expect(hub.w).toBeGreaterThan(input.w);
      expect(hub.lines).toEqual(['Хлоропласт']);
      expectClean(layout);
      expectLabelsClear(layout);
    }
  });
});
