import type { DiagramEdge, DiagramNode } from './types';

/**
 * Разбивает подпись на строки по словам; лишнее заканчивается многоточием.
 * Слова длиннее строки переносятся с дефисом, только если в них не меньше
 * hyphenateFrom букв (0 — переносить любые).
 */
export function wrapLabel(label: string, maxChars: number, maxLines: number, hyphenateFrom = 0): string[] {
  const limit = Math.max(4, Math.floor(maxChars));
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  const pushWord = (word: string) => {
    let rest = word;
    if (rest.length >= hyphenateFrom) {
      while (rest.length > limit) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        lines.push(rest.slice(0, limit - 1) + '-');
        rest = rest.slice(limit - 1);
      }
    }
    if (!currentLine) currentLine = rest;
    else if (currentLine.length + 1 + rest.length <= limit) currentLine += ` ${rest}`;
    else {
      lines.push(currentLine);
      currentLine = rest;
    }
  };

  words.forEach(pushWord);
  if (currentLine) lines.push(currentLine);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.length >= limit ? last.slice(0, limit - 1) : last}…`;
  return kept;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutBox {
  id: string;
  label: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge {
  key: string;
  from: string;
  to: string;
  /** Полная подпись связи (для подсказки). */
  label?: string;
  /** То, что помещается на схеме. */
  labelText?: string;
  labelX?: number;
  labelY?: number;
  labelAnchor?: 'start' | 'middle' | 'end';
  /** Ломаная линии связи: у прямой — две точки, у обходной — больше. */
  points: Point[];
  /** SVG-путь линии со скруглёнными углами. */
  d: string;
  /** true, если линия обходит другие блоки. */
  routed: boolean;
}

export interface DiagramLayout {
  kind: 'layered-horizontal' | 'layered-vertical';
  width: number;
  height: number;
  boxes: LayoutBox[];
  edges: LayoutEdge[];
}

const CHAR_WIDTH = 7.4; // ~13px Inter для кириллицы
const LABEL_CHAR_WIDTH = 6.2; // ~11px подписи связей
const LABEL_MAX_CHARS = 22;
const LABEL_HALF_HEIGHT = 7;
const LINE_HEIGHT = 17;
const BOX_PADDING_X = 8;
const BOX_PADDING_Y = 10;
const GAP_X = 44;
const GAP_Y = 30;
const ROW_GAP = 36;
const MARGIN = 6;
const MIN_BOX_W = 96;
const HYPHENATE_FROM = 16;
const PARALLEL_OFFSET = 5;
const RECIPROCAL_LABEL_OFFSET = 10;
const LABEL_OFFSET = 8;

/* ── Геометрия ─────────────────────────────────────────────────────────── */

/** Пересекает ли отрезок pq прямоугольник (расширенный на pad). Liang–Barsky. */
export function segmentIntersectsRect(
  p: Point,
  q: Point,
  rect: { x: number; y: number; w: number; h: number },
  pad = 0,
): boolean {
  const xmin = rect.x - pad;
  const xmax = rect.x + rect.w + pad;
  const ymin = rect.y - pad;
  const ymax = rect.y + rect.h + pad;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, p.x - xmin],
    [dx, xmax - p.x],
    [-dy, p.y - ymin],
    [dy, ymax - p.y],
  ];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

export function pointInRect(point: Point, rect: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.w + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.h + pad
  );
}

function center(box: LayoutBox): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Точка на границе прямоугольника по направлению к (tx, ty). */
function clipToBox(box: LayoutBox, tx: number, ty: number, pad: number): Point {
  const c = center(box);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = box.w / 2 + pad;
  const halfH = box.h / 2 + pad;
  const scale = Math.min(dx === 0 ? Infinity : halfW / Math.abs(dx), dy === 0 ? Infinity : halfH / Math.abs(dy));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Путь по ломаной со скруглёнными углами. */
export function pathFromPoints(points: Point[], radius = 6): string {
  const clean = points.filter(
    (point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.5,
  );
  const fmt = (value: number) => Math.round(value * 10) / 10;
  if (clean.length < 2) return '';
  let d = `M${fmt(clean[0].x)},${fmt(clean[0].y)}`;
  for (let index = 1; index < clean.length - 1; index += 1) {
    const a = clean[index - 1];
    const p = clean[index];
    const b = clean[index + 1];
    const inLength = Math.hypot(p.x - a.x, p.y - a.y);
    const outLength = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const p1 = { x: p.x - ((p.x - a.x) / inLength) * r, y: p.y - ((p.y - a.y) / inLength) * r };
    const p2 = { x: p.x + ((b.x - p.x) / outLength) * r, y: p.y + ((b.y - p.y) / outLength) * r };
    d += `L${fmt(p1.x)},${fmt(p1.y)}Q${fmt(p.x)},${fmt(p.y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  const last = clean[clean.length - 1];
  return `${d}L${fmt(last.x)},${fmt(last.y)}`;
}

/* ── Слои ──────────────────────────────────────────────────────────────── */

/**
 * Обратные связи (те, что замыкают цикл). Обход в глубину начинается с узлов
 * без входящих связей, поэтому цикл «A → B → C → A» читается слева направо.
 */
function findBackEdges(nodes: DiagramNode[], edges: DiagramEdge[]): Set<number> {
  const adjacency = new Map<string, { to: string; index: number }[]>();
  const indegree = new Map<string, number>();
  nodes.forEach(node => {
    adjacency.set(node.id, []);
    indegree.set(node.id, 0);
  });
  edges.forEach((edge, index) => {
    adjacency.get(edge.from)?.push({ to: edge.to, index });
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  });
  const order = [
    ...nodes.filter(node => (indegree.get(node.id) ?? 0) === 0),
    ...nodes.filter(node => (indegree.get(node.id) ?? 0) !== 0),
  ];
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<number>();

  const visit = (id: string) => {
    state.set(id, 1);
    for (const { to, index } of adjacency.get(id) ?? []) {
      const next = state.get(to) ?? 0;
      if (next === 1) back.add(index);
      else if (next === 0) visit(to);
    }
    state.set(id, 2);
  };

  order.forEach(node => {
    if ((state.get(node.id) ?? 0) === 0) visit(node.id);
  });
  return back;
}

/** Слои по длиннейшему пути от узлов без входящих связей (граф без циклов). */
function computeLayers(nodes: DiagramNode[], edges: { from: string; to: string }[]): string[][] {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  nodes.forEach(node => {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  });
  edges.forEach(edge => {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const layerOf = new Map<string, number>();
  const queue = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0).map(node => node.id);
  queue.forEach(id => layerOf.set(id, 0));
  const remaining = new Map(indegree);

  while (queue.length) {
    const id = queue.shift() as string;
    for (const next of outgoing.get(id) ?? []) {
      layerOf.set(next, Math.max(layerOf.get(next) ?? 0, (layerOf.get(id) ?? 0) + 1));
      remaining.set(next, (remaining.get(next) ?? 1) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }

  const layers: string[][] = [];
  nodes.forEach(node => {
    const layer = layerOf.get(node.id) ?? 0;
    (layers[layer] ??= []).push(node.id);
  });
  const compact = layers.filter(Boolean);

  // Один проход по барицентрам: узлы ставим рядом с их предшественниками.
  const position = new Map<string, number>();
  compact.forEach((layer, layerIndex) => {
    if (layerIndex > 0) {
      const weight = (id: string) => {
        const parents = edges.filter(edge => edge.to === id).map(edge => position.get(edge.from) ?? 0);
        return parents.length ? parents.reduce((sum, value) => sum + value, 0) / parents.length : 0;
      };
      layer.sort((a, b) => weight(a) - weight(b));
    }
    layer.forEach((id, index) => position.set(id, index));
  });
  return compact;
}

/* ── Блоки ─────────────────────────────────────────────────────────────── */

function longestWord(label: string): number {
  return Math.max(0, ...label.split(/\s+/).map(word => word.length));
}

function makeBox(node: DiagramNode, width: number, maxLines: number): Omit<LayoutBox, 'x' | 'y' | 'h'> {
  const capacity = (width - BOX_PADDING_X * 2) / CHAR_WIDTH;
  // Перенос внутри слова — только для очень длинных слов или если слово иначе не влезает.
  const hyphenateFrom = longestWord(node.label) > capacity ? 0 : HYPHENATE_FROM;
  const lines = wrapLabel(node.label, capacity, maxLines, hyphenateFrom);
  return { id: node.id, label: node.label, lines, w: width };
}

function boxHeight(lineCount: number): number {
  return Math.max(1, lineCount) * LINE_HEIGHT + BOX_PADDING_Y * 2;
}

/* ── Связи ─────────────────────────────────────────────────────────────── */

type Orientation = 'horizontal' | 'vertical';

interface ConnectOptions {
  orientation: Orientation;
  width: number;
  layerOf: Map<string, number>;
}

function edgeKey(edge: DiagramEdge): string {
  return `${edge.from}->${edge.to}`;
}

function anchorFor(nx: number): 'start' | 'middle' | 'end' {
  return nx > 0.35 ? 'start' : nx < -0.35 ? 'end' : 'middle';
}

function polylineHitsBoxes(points: Point[], boxes: LayoutBox[], skip: Set<string>): boolean {
  for (let index = 1; index < points.length; index += 1) {
    for (const box of boxes) {
      if (skip.has(box.id)) continue;
      if (segmentIntersectsRect(points[index - 1], points[index], box, 3)) return true;
    }
  }
  return false;
}

function fitLabel(label: string, availablePx: number): string | undefined {
  const chars = Math.floor(availablePx / LABEL_CHAR_WIDTH);
  if (chars < 4) return undefined;
  return wrapLabel(label, Math.min(LABEL_MAX_CHARS, chars), 1)[0];
}

function connect(boxes: LayoutBox[], edges: DiagramEdge[], options: ConnectOptions): LayoutEdge[] {
  const { orientation, width, layerOf } = options;
  const byId = new Map(boxes.map(box => [box.id, box]));
  const present = new Set(edges.map(edge => `${edge.from}\u0000${edge.to}`));
  const minTop = Math.min(...boxes.map(box => box.y));
  const maxBottom = Math.max(...boxes.map(box => box.y + box.h));
  const maxRight = Math.max(...boxes.map(box => box.x + box.w));
  let topLanes = 0;
  let bottomLanes = 0;
  let sideLanes = 0;
  let elbows = 0;

  return edges.flatMap((edge): LayoutEdge[] => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const reciprocal = present.has(`${edge.to}\u0000${edge.from}`);
    const fromLayer = layerOf.get(edge.from) ?? 0;
    const toLayer = layerOf.get(edge.to) ?? 0;
    const forward = fromLayer < toLayer || (fromLayer === toLayer && edge.from < edge.to);
    const skip = new Set([from.id, to.id]);
    const base: Pick<LayoutEdge, 'key' | 'from' | 'to' | 'label'> = { key: edgeKey(edge), from: edge.from, to: edge.to };
    if (edge.label) base.label = edge.label;

    // Нормаль к общему направлению пары (от верхнего слоя к нижнему): «вверх» или «вправо».
    const a = center(forward ? from : to);
    const b = center(forward ? to : from);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / length;
    let ny = (b.x - a.x) / length;
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const side = reciprocal ? (forward ? 1 : -1) : 1;
    const shift = reciprocal ? side * PARALLEL_OFFSET : 0;

    const fc = center(from);
    const tc = center(to);
    const start0 = clipToBox(from, tc.x, tc.y, 2);
    const end0 = clipToBox(to, fc.x, fc.y, 5);
    const straight = [
      { x: start0.x + nx * shift, y: start0.y + ny * shift },
      { x: end0.x + nx * shift, y: end0.y + ny * shift },
    ];

    if (!polylineHitsBoxes(straight, boxes, skip)) {
      const laid: LayoutEdge = { ...base, points: straight, d: pathFromPoints(straight), routed: false };
      if (edge.label) {
        const offset = reciprocal ? PARALLEL_OFFSET + RECIPROCAL_LABEL_OFFSET : LABEL_OFFSET;
        const mid = { x: (straight[0].x + straight[1].x) / 2, y: (straight[0].y + straight[1].y) / 2 };
        laid.labelText = wrapLabel(edge.label, LABEL_MAX_CHARS, 1)[0];
        laid.labelX = mid.x + nx * offset * side;
        laid.labelY = mid.y + ny * offset * side;
        laid.labelAnchor = anchorFor(nx * side);
      }
      return [laid];
    }

    // Линия прошла бы через другой блок — ведём её в обход.
    if (orientation === 'horizontal') {
      const corridor = (where: 'top' | 'bottom'): Point[] | null => {
        const lane = where === 'top' ? topLanes : bottomLanes;
        const y = where === 'top' ? minTop - 18 - lane * 14 : maxBottom + 18 + lane * 14;
        const inset = ((lane % 3) - 1) * 10;
        const sx = fc.x + inset;
        const tx = tc.x - inset;
        const sy = where === 'top' ? from.y : from.y + from.h;
        const ty = where === 'top' ? to.y - 5 : to.y + to.h + 5;
        const points = [
          { x: sx, y: sy },
          { x: sx, y },
          { x: tx, y },
          { x: tx, y: ty },
        ];
        return polylineHitsBoxes(points, boxes, skip) ? null : points;
      };
      let where: 'top' | 'bottom' = 'top';
      let points = corridor('top');
      if (!points) {
        const below = corridor('bottom');
        if (below) {
          points = below;
          where = 'bottom';
        }
      }
      // Обход не нашёлся — всё равно верхний коридор: он хотя бы не прячет стрелку.
      if (!points) {
        const y = minTop - 18 - topLanes * 14;
        points = [
          { x: fc.x, y: from.y },
          { x: fc.x, y },
          { x: tc.x, y },
          { x: tc.x, y: to.y - 5 },
        ];
        where = 'top';
      }
      if (where === 'top') topLanes += 1;
      else bottomLanes += 1;
      const laid: LayoutEdge = { ...base, points, d: pathFromPoints(points), routed: true };
      if (edge.label) {
        const y = points[1].y;
        laid.labelText = fitLabel(edge.label, Math.abs(points[2].x - points[1].x) + 40);
        laid.labelX = (points[1].x + points[2].x) / 2;
        laid.labelY = where === 'top' ? y - LABEL_OFFSET : y + LABEL_OFFSET + 1;
        laid.labelAnchor = 'middle';
      }
      return [laid];
    }

    // Сверху вниз: горизонтальные участки идут по промежуткам между рядами,
    // вертикальный — по свободной полосе справа от всех блоков.
    const up = toLayer < fromLayer;
    const adjacent = Math.abs(toLayer - fromLayer) <= 1;
    const lane = adjacent ? elbows : sideLanes;
    if (adjacent) elbows += 1;
    else sideLanes += 1;
    const inset = (lane % 2) * 10;
    const sx = from.x + from.w - 16 - inset;
    const tx = to.x + to.w - 16 - inset;
    const laneShift = (lane % 3) * 4;
    const sGap = up ? from.y - ROW_GAP / 2 - laneShift : from.y + from.h + ROW_GAP / 2 + laneShift;
    const tGap = up ? to.y + to.h + ROW_GAP / 2 + laneShift : to.y - ROW_GAP / 2 - laneShift;
    const laneX = maxRight + 14 + lane * 12;
    const points: Point[] = adjacent
      ? [
          { x: sx, y: up ? from.y : from.y + from.h },
          { x: sx, y: sGap },
          { x: tx, y: sGap },
          { x: tx, y: up ? to.y + to.h + 5 : to.y - 5 },
        ]
      : [
          { x: sx, y: up ? from.y : from.y + from.h },
          { x: sx, y: sGap },
          { x: laneX, y: sGap },
          { x: laneX, y: tGap },
          { x: tx, y: tGap },
          { x: tx, y: up ? to.y + to.h + 5 : to.y - 5 },
        ];
    const laid: LayoutEdge = { ...base, points, d: pathFromPoints(points), routed: true };
    if (edge.label) {
      if (adjacent) {
        laid.labelText = fitLabel(edge.label, Math.max(Math.abs(tx - sx), width / 2));
        laid.labelX = (sx + tx) / 2;
        laid.labelY = sGap - LABEL_OFFSET;
        laid.labelAnchor = 'middle';
      } else {
        laid.labelText = fitLabel(edge.label, width - MARGIN - (laneX + 6));
        laid.labelX = laneX + 6;
        laid.labelY = (sGap + tGap) / 2;
        laid.labelAnchor = 'start';
      }
    }
    return [laid];
  });
}

/** Сдвигает схему вниз, если обходные линии или подписи ушли выше верхнего края. */
function fitVertically(boxes: LayoutBox[], edges: LayoutEdge[], baseHeight: number): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.h);
  }
  for (const edge of edges) {
    for (const point of edge.points) {
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    if (edge.labelText && edge.labelY !== undefined) {
      minY = Math.min(minY, edge.labelY - LABEL_HALF_HEIGHT);
      maxY = Math.max(maxY, edge.labelY + LABEL_HALF_HEIGHT);
    }
  }
  const shift = Math.max(0, MARGIN - minY);
  if (shift > 0) {
    boxes.forEach(box => {
      box.y += shift;
    });
    edges.forEach(edge => {
      edge.points = edge.points.map(point => ({ x: point.x, y: point.y + shift }));
      edge.d = pathFromPoints(edge.points);
      if (edge.labelY !== undefined) edge.labelY += shift;
    });
  }
  return Math.ceil(Math.max(baseHeight + shift, maxY + shift + MARGIN));
}

/* ── Раскладка ─────────────────────────────────────────────────────────── */

/**
 * Раскладка схемы слоями в порядке чтения: слева направо, а если не помещается —
 * сверху вниз. Циклы не меняют порядок: связь, которая замыкает цикл, рисуется
 * в обход. Встречные связи (A → B и B → A) идут двумя параллельными линиями,
 * подписи — по разные стороны.
 */
export function layoutDiagram(nodes: DiagramNode[], edges: DiagramEdge[], availableWidth: number): DiagramLayout {
  const width = Math.max(260, Math.floor(availableWidth));
  const back = findBackEdges(nodes, edges);
  const layerEdges = edges.map((edge, index) => (back.has(index) ? { from: edge.to, to: edge.from } : edge));
  const layers = computeLayers(nodes, layerEdges);
  const layerOf = new Map<string, number>();
  layers.forEach((layer, index) => layer.forEach(id => layerOf.set(id, index)));
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const wordChars = Math.max(0, ...nodes.map(node => longestWord(node.label)));

  // Промежуток между колонками вмещает самую длинную подпись соседних связей.
  const adjacentLabelChars = Math.max(
    0,
    ...edges
      .filter(edge => edge.label && Math.abs((layerOf.get(edge.from) ?? 0) - (layerOf.get(edge.to) ?? 0)) === 1)
      .map(edge => Math.min(LABEL_MAX_CHARS, (edge.label as string).length)),
  );
  const gapX = Math.max(GAP_X, Math.ceil(adjacentLabelChars * LABEL_CHAR_WIDTH + 16));
  const columns = layers.length;
  const horizontalBoxW = Math.min(200, Math.floor((width - MARGIN * 2 - gapX * (columns - 1)) / columns));
  const capacity = (horizontalBoxW - BOX_PADDING_X * 2) / CHAR_WIDTH;

  if (horizontalBoxW >= MIN_BOX_W && wordChars <= capacity) {
    // Слева направо: каждый слой — колонка.
    const boxW = horizontalBoxW;
    const prepared = new Map(nodes.map(node => [node.id, makeBox(node, boxW, 3)]));
    const h = boxHeight(Math.max(...[...prepared.values()].map(box => box.lines.length)));
    const tallest = Math.max(...layers.map(layer => layer.length));
    const height = tallest * h + (tallest - 1) * GAP_Y + MARGIN * 2;
    const totalW = columns * boxW + (columns - 1) * gapX;
    const offsetX = (width - totalW) / 2;
    const boxes: LayoutBox[] = [];
    layers.forEach((layer, layerIndex) => {
      const columnH = layer.length * h + (layer.length - 1) * GAP_Y;
      const top = (height - columnH) / 2;
      layer.forEach((id, index) => {
        const box = prepared.get(id) ?? makeBox(nodeById.get(id) as DiagramNode, boxW, 3);
        boxes.push({ ...box, x: offsetX + layerIndex * (boxW + gapX), y: top + index * (h + GAP_Y), h });
      });
    });
    const laid = connect(boxes, edges, { orientation: 'horizontal', width, layerOf });
    const fitted = fitVertically(boxes, laid, height);
    return { kind: 'layered-horizontal', width, height: fitted, boxes, edges: laid };
  }

  // Сверху вниз: каждый слой — строка.
  const widest = Math.max(...layers.map(layer => layer.length));
  const gapBetween = width < 480 ? 14 : GAP_X;

  const place = (reserve: number, leftAligned: boolean) => {
    const boxW = Math.max(
      72,
      Math.min(220, Math.floor((width - MARGIN * 2 - reserve - gapBetween * (widest - 1)) / widest)),
    );
    const prepared = new Map(nodes.map(node => [node.id, makeBox(node, boxW, 2)]));
    const h = boxHeight(Math.max(...[...prepared.values()].map(box => box.lines.length)));
    const height = layers.length * h + (layers.length - 1) * ROW_GAP + MARGIN * 2;
    const boxes: LayoutBox[] = [];
    layers.forEach((layer, layerIndex) => {
      const rowW = layer.length * boxW + (layer.length - 1) * gapBetween;
      const left = leftAligned ? MARGIN : (width - reserve - rowW) / 2;
      layer.forEach((id, index) => {
        const box = prepared.get(id) ?? makeBox(nodeById.get(id) as DiagramNode, boxW, 2);
        boxes.push({ ...box, x: left + index * (boxW + gapBetween), y: MARGIN + layerIndex * (h + ROW_GAP), h });
      });
    });
    const laid = connect(boxes, edges, { orientation: 'vertical', width, layerOf });
    return { boxes, laid, height };
  };

  let attempt = place(0, false);
  let lanes = attempt.laid.filter(edge => edge.routed && edge.points.length > 4).length;
  // Обходным связям нужна полоса справа: освобождаем её и раскладываем заново.
  for (let pass = 0; pass < 3 && lanes > 0; pass += 1) {
    const labelChars = Math.max(
      0,
      ...attempt.laid
        .filter(edge => edge.routed && edge.points.length > 4 && edge.label)
        .map(edge => Math.min(LABEL_MAX_CHARS, (edge.label as string).length)),
    );
    const reserve = 14 + lanes * 12 + (labelChars ? labelChars * LABEL_CHAR_WIDTH + 8 : 0);
    attempt = place(reserve, true);
    const next = attempt.laid.filter(edge => edge.routed && edge.points.length > 4).length;
    if (next <= lanes) break;
    lanes = next;
  }
  const fitted = fitVertically(attempt.boxes, attempt.laid, attempt.height);
  return { kind: 'layered-vertical', width, height: fitted, boxes: attempt.boxes, edges: attempt.laid };
}
