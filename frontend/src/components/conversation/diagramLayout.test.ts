import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_FONT,
  DIAGRAM_MIN_LABEL_PX,
  DIAGRAM_MIN_NODE_PX,
  balanceLines,
  diagramUnit,
  fitDiagram,
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

/** Content widths of the sheet: 1032 at 1440 px, 1040 at 1280×720, 624 on a tablet, 326 on a 390 px phone. */
const DESKTOP = 1032;
const TABLET = 624;
const PHONE = 326;
/** The phone font, as fitDiagram picks it for a sheet narrower than 480 px. */
const phone = (nodes: DiagramNode[], edges: DiagramEdge[], width = PHONE) => layoutDiagram(nodes, edges, width, DIAGRAM_FONT.phone);

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
  const u = layout.unit;
  const labelled = layout.edges.filter(edge => edge.labelText);
  const rects = labelled.map(edge =>
    labelRect(edge.labelText as string, edge.labelX as number, edge.labelY as number, edge.labelAnchor ?? 'middle', u),
  );
  labelled.forEach((edge, index) => {
    const rect = rects[index];
    const ink = { x: rect.x + 3 * u, y: rect.y + 4 * u, w: rect.w - 6 * u, h: rect.h - 8 * u };
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
    const chain = layoutDiagram(chainNodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], DESKTOP);
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
      DESKTOP,
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
    const desktop = layoutDiagram(nodes, edges, DESKTOP);
    expect(desktop.kind).toBe('cycle');
    // On a phone the labels are Literata 14,4 px: inside a 280-unit ring «фотосинтез» and «дыхание» would
    // lie on each other, so the cycle goes in rows and the closing edge goes round them — labels still whole.
    const narrow = phone(nodes, edges);
    expect(['cycle', 'layered-vertical']).toContain(narrow.kind);
    if (narrow.kind !== 'cycle') expect(narrow.edges.find(edge => edge.key === 'd->a')?.routed).toBe(true);
    for (const layout of [desktop, narrow]) {
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
    const layout = phone(nodes, edges, 306);
    expect(layout.kind).not.toBe('cycle');
    expectClean(layout);
    // Цикл внутри большей схемы (модель памяти) кольцом не рисуется.
    expect(simpleCycleOrder(memoryNodes, memoryEdges)).toBeNull();
    expect(layoutDiagram(memoryNodes, memoryEdges, DESKTOP).kind).toBe('layered-horizontal');
  });

  it('draws reciprocal edges as two lines with labels on opposite sides', () => {
    const layout = layoutDiagram(memoryNodes, memoryEdges, DESKTOP);
    const u = layout.unit;
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
    expect(Math.abs(forward.points[0].y - reverse.points[0].y)).toBeGreaterThanOrEqual(9 * u);
    // «повторение» над своей линией, «извлечение» — под своей.
    expect(forward.labelY as number).toBeLessThan(forward.points[0].y);
    expect(reverse.labelY as number).toBeGreaterThan(reverse.points[0].y);
    expect(Math.abs((forward.labelY as number) - (reverse.labelY as number))).toBeGreaterThanOrEqual(24 * u);
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
    for (const width of [DESKTOP, 900]) {
      const layout = layoutDiagram(nodes, edges, width);
      const u = layout.unit;
      expect(layout.kind).toBe('layered-horizontal');
      const hub = layout.boxes.find(box => box.id === 'c') as LayoutBox;
      const incoming = layout.edges.filter(edge => edge.to === 'c');
      expect(incoming.every(edge => edge.curve && !edge.routed)).toBe(true);
      // Три стрелки входят в левую сторону узла в разных местах, не ближе 10 единиц сетки (14 px при кегле 20).
      const ends = incoming.map(edge => (edge.curve as NonNullable<typeof edge.curve>)[3]).sort((p, q) => p.y - q.y);
      ends.forEach(end => {
        expect(end.x).toBeCloseTo(hub.x - 2 * u, 5);
        expect(end.y).toBeGreaterThan(hub.y);
        expect(end.y).toBeLessThan(hub.y + hub.h);
      });
      for (let index = 1; index < ends.length; index += 1) expect(ends[index].y - ends[index - 1].y).toBeGreaterThanOrEqual(10 * u);
      expectClean(layout);
      expectLabelsClear(layout);
    }
  });

  it('switches to rows on a phone and never splits ordinary words', () => {
    const layout = phone(memoryNodes, memoryEdges);
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
    for (const layout of [layoutDiagram(chainNodes, edges, DESKTOP), phone(chainNodes, edges)]) {
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
      for (const layout of [phone(nodes, edges), layoutDiagram(nodes, edges, DESKTOP)]) {
        expect(layout.boxes).toHaveLength(count);
        expectClean(layout);
      }
    }
  });

  it('wraps a layer wider than a phone sheet into more rows instead of pushing nodes off the edge', () => {
    const nodes = ['Подорожание снижает выручку', 'Кредит', 'Градиент', 'Хлоропласт', 'Центральный банк', 'Кредит', 'Эластичность'].map((label, index) => ({
      id: `n${index}`,
      label,
    }));
    for (const width of [306, PHONE]) {
      const layout = phone(nodes, [{ from: 'n0', to: 'n3', label: '|E| > 1' }], width);
      expect(new Set(layout.boxes.map(box => box.y)).size).toBeGreaterThan(2);
      expectClean(layout);
    }
  });

  it('lays out wide layers and isolated nodes without overlaps', () => {
    const nodes = Array.from({ length: 7 }, (_, index) => ({ id: `n${index}`, label: `Узел ${index + 1}` }));
    const star = nodes.slice(1).map(node => ({ from: 'n0', to: node.id }));
    for (const width of [PHONE, DESKTOP]) {
      const font = width < 480 ? DIAGRAM_FONT.phone : DIAGRAM_FONT.desktop;
      expectClean(layoutDiagram(nodes, star, width, font));
      expectClean(layoutDiagram(nodes, [{ from: 'n0', to: 'n1' }, { from: 'n2', to: 'n3' }], width, font));
    }
  });

  it('switches to rows when there are too many layers for the width', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, label: `Шаг ${index + 1}` }));
    const edges = many.slice(1).map((node, index) => ({ from: many[index].id, to: node.id }));
    const layout = layoutDiagram(many, edges, TABLET);
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
    for (const width of [306, PHONE]) {
      const layout = phone(nodes, edges, width);
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

/* ── Literata on the sheet (spec 5.7, step A) ─────────────────────────────── */

/** Deterministic random numbers for the generated diagrams (the same LCG as the landing strokes). */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const WORDS = [
  'Спрос', 'Предложение', 'Цена', 'Эластичность', 'Выручка', 'Инфляция', 'Ставка', 'Центральный банк', 'Кредит',
  'Обучение сети', 'Функция потерь', 'Градиент', 'Кратковременная память', 'Долговременная', 'Повторение',
  'Подорожание снижает выручку', 'Хлоропласт', 'Углекислый газ', 'Денежный мультипликатор', 'Безработица',
];
const EDGE_WORDS = ['ведёт к', 'снижает', 'растёт', '|E| > 1', 'внимание', 'энергия', 'если цена растёт', 'дыхание'];

function randomDiagram(random: () => number): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const count = 2 + Math.floor(random() * 6); // 2–7 nodes, like sanitizeVisual allows
  const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, label: WORDS[Math.floor(random() * WORDS.length)] }));
  const edges: DiagramEdge[] = [];
  const seen = new Set<string>();
  const wanted = 1 + Math.floor(random() * Math.min(10, count * 2));
  for (let attempt = 0; attempt < 40 && edges.length < wanted; attempt += 1) {
    const from = Math.floor(random() * count);
    const to = Math.floor(random() * count);
    const key = `${from}-${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    const label = random() < 0.45 ? EDGE_WORDS[Math.floor(random() * EDGE_WORDS.length)] : undefined;
    edges.push(label ? { from: `n${from}`, to: `n${to}`, label } : { from: `n${from}`, to: `n${to}` });
  }
  if (!edges.length) edges.push({ from: 'n0', to: 'n1' });
  return { nodes, edges };
}

describe('diagram on the paper sheet: Literata 20, a scale rule, no overlaps', () => {
  it('recomputes the grid for Literata 20 (24 px lines) and the phone size 16,5', () => {
    expect(diagramUnit(20)).toBeCloseTo(24 / 17, 10);
    const nodes = [{ id: 'a', label: 'Эластичность спроса' }, { id: 'b', label: 'Подорожание снижает выручку' }];
    const edges = [{ from: 'a', to: 'b', label: '|E| > 1' }];
    const desktop = layoutDiagram(nodes, edges, DESKTOP);
    expect([desktop.fontSize, desktop.lineHeight, desktop.labelSize]).toEqual([20, 24, 17.5]);
    const narrow = phone(nodes, edges);
    expect([narrow.fontSize, narrow.lineHeight, narrow.labelSize]).toEqual([16.5, 19.8, 14.44]);
    expect(layoutDiagram(nodes, edges, PHONE, DIAGRAM_FONT.min).labelSize).toBe(14);
    for (const layout of [desktop, narrow]) {
      for (const box of layout.boxes) {
        // A node is at most 12em wide, and every line fits it at the measured Literata width (0,63 em).
        const text = box.w - 2 * 8 * layout.unit;
        expect(text).toBeLessThanOrEqual(12 * layout.fontSize + 0.5);
        for (const line of box.lines) expect(line.length * 0.63 * layout.fontSize).toBeLessThanOrEqual(text + 0.5);
      }
    }
  });

  it('balances the lines of a node: «Подорожание / снижает выручку»', () => {
    expect(balanceLines(['Подорожание снижает', 'выручку'], 19)).toEqual(['Подорожание', 'снижает выручку']);
    expect(balanceLines(['Один'], 10)).toEqual(['Один']);
    // Hyphenated or cut labels keep their greedy lines.
    expect(balanceLines(['Электрофи-', 'зиологиче-', 'ский'], 11)).toEqual(['Электрофи-', 'зиологиче-', 'ский']);
    expect(balanceLines(['Очень', 'длинная…'], 12)).toEqual(['Очень', 'длинная…']);
    const nodes = [{ id: 'a', label: 'Подорожание снижает выручку' }, { id: 'b', label: 'Выручка' }];
    const box = layoutDiagram(nodes, [{ from: 'a', to: 'b' }], DESKTOP).boxes.find(item => item.id === 'a') as LayoutBox;
    expect(box.lines).toEqual(['Подорожание', 'снижает выручку']);
  });

  it('never overlaps nodes in 300 random diagrams on a 1112 px and a 306 px sheet, and keeps the type readable', () => {
    let labelled = 0;
    let dropped = 0;
    const random = lcg(20261004);
    for (let run = 0; run < 150; run += 1) {
      const { nodes, edges } = randomDiagram(random);
      for (const [width, height] of [[1112, 300], [306, 250]] as const) {
        const fit = fitDiagram(nodes, edges, width, height);
        const { layout } = fit;
        const where = `run ${run} at ${width}: ${JSON.stringify({ nodes: nodes.map(node => node.label), edges })}`;
        expect(layout.boxes, where).toHaveLength(nodes.length);
        for (let i = 0; i < layout.boxes.length; i += 1) {
          for (let j = i + 1; j < layout.boxes.length; j += 1) {
            expect(overlaps(layout.boxes[i], layout.boxes[j]), `${where}: ${layout.boxes[i].id} on ${layout.boxes[j].id}`).toBe(false);
          }
          const box = layout.boxes[i];
          expect(box.x, where).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w, where).toBeLessThanOrEqual(layout.width + 0.5);
        }
        for (const edge of layout.edges) {
          // Words have no frames now: a line through a third word would cross it out.
          for (const box of layout.boxes) {
            if (box.id === edge.from || box.id === edge.to) continue;
            for (let index = 1; index < edge.points.length; index += 1) {
              expect(segmentIntersectsRect(edge.points[index - 1], edge.points[index], box), `${where}: ${edge.key} through ${box.id}`).toBe(false);
            }
          }
          if (!edge.labelText) continue;
          const label = { x: edge.labelX as number, y: edge.labelY as number };
          for (const box of layout.boxes) expect(pointInRect(label, box), `${where}: label of ${edge.key} on ${box.id}`).toBe(false);
        }
        for (const edge of layout.edges) {
          if (!edge.label) continue;
          labelled += 1;
          if (!edge.labelText) dropped += 1;
        }
        // After the scale rule: nodes at 16 px and more, edge labels at 14 px and more.
        expect(layout.fontSize * fit.scale, where).toBeGreaterThanOrEqual(DIAGRAM_MIN_NODE_PX - 1e-6);
        expect(layout.labelSize * fit.scale, where).toBeGreaterThanOrEqual(DIAGRAM_MIN_LABEL_PX - 1e-6);
        expect(fit.width, where).toBeLessThanOrEqual(width + 0.5);
      }
    }
    // A label with no free place is left to the tooltip and the description rather than drawn over a word: rare.
    expect(dropped / labelled).toBeLessThan(0.01);
  });

  it('shrinks through the viewBox only down to 16/14 px, then sets the diagram at 16 and lets the sheet grow', () => {
    const tall = Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, label: `Шаг ${index + 1} обработки сигнала` }));
    const chain = tall.slice(1).map((node, index) => ({ from: tall[index].id, to: node.id }));
    const natural = layoutDiagram(tall, chain, TABLET);
    expect(natural.kind).toBe('layered-vertical');

    // Room enough: as it is, Literata 20.
    const roomy = fitDiagram(tall, chain, TABLET, natural.height + 10);
    expect([roomy.scale, roomy.layout.fontSize, roomy.overflow]).toEqual([1, 20, false]);

    // A little short: the viewBox shrinks, nodes stay at 16 px or more (scale 0,8 at the least on a computer).
    const snug = fitDiagram(tall, chain, TABLET, Math.ceil(natural.height * 0.85));
    expect(snug.layout.fontSize).toBe(20);
    expect(snug.scale).toBeCloseTo(Math.ceil(natural.height * 0.85) / natural.height, 2);
    expect(snug.layout.fontSize * snug.scale).toBeGreaterThanOrEqual(16);
    expect(snug.overflow).toBe(false);

    // Too short for 0,8: shrinking would go under 16 px, so the diagram is laid out again at 16 px — here
    // three columns fit at 16 px where rows were needed at 20 px…
    const flow = [{ id: 'a', label: 'Свет' }, { id: 'b', label: 'Хлоропласт' }, { id: 'c', label: 'Глюкоза' }];
    const flowEdges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    expect(layoutDiagram(flow, flowEdges, 500).kind).toBe('layered-vertical');
    const columns = layoutDiagram(flow, flowEdges, 500, DIAGRAM_FONT.min);
    expect(columns.kind).toBe('layered-horizontal');
    const relaid = fitDiagram(flow, flowEdges, 500, columns.height + 20);
    expect([relaid.layout.fontSize, relaid.layout.kind, relaid.scale, relaid.overflow]).toEqual([16, 'layered-horizontal', 1, false]);
    // …and if even that is too tall, the sheet grows (overflow) instead of shrinking the type.
    const small = layoutDiagram(tall, chain, TABLET, DIAGRAM_FONT.min);
    const grown = fitDiagram(tall, chain, TABLET, 120);
    expect([grown.layout.fontSize, grown.scale, grown.overflow]).toEqual([16, 1, true]);
    expect(grown.height).toBe(small.height);

    // A phone has almost no room to shrink: 16,5 × 0,97 is already 16.
    const phoneFit = fitDiagram(tall, chain, PHONE, 200);
    expect(phoneFit.layout.fontSize).toBe(16);
    expect(phoneFit.layout.fontSize * phoneFit.scale).toBeGreaterThanOrEqual(16);
  });
});
