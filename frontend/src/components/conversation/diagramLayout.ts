import type { DiagramEdge, DiagramNode } from './types';

/* ── Подписи ────────────────────────────────────────────────────────────── */

const VOWELS = new Set([...'аеёиоуыэюяaeiouy']);
const NO_LINE_START = new Set([...'йьъ']);

/**
 * Место переноса длинного слова не дальше max букв: после гласной, по три буквы
 * с каждой стороны, новая строка не начинается с й, ь или ъ и сама содержит
 * гласную («Хлоро-пласт», «Электрофи-зиологиче-ский»). -1, если такого места нет.
 */
function hyphenPoint(word: string, max: number): number {
  for (let point = Math.min(max, word.length - 3); point >= 3; point -= 1) {
    const right = word.slice(point).toLowerCase();
    if (!VOWELS.has(word[point - 1].toLowerCase())) continue;
    if (NO_LINE_START.has(right[0])) continue;
    if (![...right].some(char => VOWELS.has(char))) continue;
    return point;
  }
  return -1;
}

/**
 * Разбивает подпись на строки по словам; лишнее заканчивается многоточием.
 * Слова длиннее строки переносятся по слогам (по дефису, если он есть), только
 * если в них не меньше hyphenateFrom букв (0 — переносить любые).
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
        const dash = rest.lastIndexOf('-', limit - 1);
        let cut: number;
        let piece: string;
        if (dash >= 2) {
          cut = dash + 1;
          piece = rest.slice(0, cut);
        } else {
          const point = hyphenPoint(rest, limit - 1);
          cut = point > 0 ? point : limit - 1;
          while (point <= 0 && cut > 2 && NO_LINE_START.has(rest[cut].toLowerCase())) cut -= 1;
          piece = `${rest.slice(0, cut)}-`;
        }
        lines.push(piece);
        rest = rest.slice(cut);
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

/* ── Типы ───────────────────────────────────────────────────────────────── */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutBox {
  id: string;
  label: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  /** Слой в порядке чтения (колонка, строка или место на кольце): по нему схема проявляется. */
  layer: number;
}

export type Curve = [Point, Point, Point, Point];

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
  /** Ломаная линии связи: у кривой и дуги — частые точки на ней, у прямой — концы, у обходной — углы. */
  points: Point[];
  /** SVG-путь линии. */
  d: string;
  /** true, если линия обходит другие блоки. */
  routed: boolean;
  /** Кубическая кривая между блоками соседних слоёв. */
  curve?: Curve;
  /** Радиусы дуги кольца (у связей круговорота). */
  arc?: { rx: number; ry: number };
}

export interface DiagramLayout {
  kind: 'layered-horizontal' | 'layered-vertical' | 'cycle';
  width: number;
  height: number;
  boxes: LayoutBox[];
  edges: LayoutEdge[];
  /** Кегль узлов (Literata), px. */
  fontSize: number;
  /** Кегль подписей связей, px. */
  labelSize: number;
  /** Высота строки узла, px. */
  lineHeight: number;
  /** Во сколько раз раскладка крупнее базовой сетки (все отступы растут вместе с кеглем). */
  unit: number;
}

/* ── Константы ──────────────────────────────────────────────────────────── */

/*
 * Схема «Разговора» на листе (спека интерьера 5.7, шаг А): узлы — слова Literata без рамок,
 * прямоугольники узлов — невидимая геометрия. Раскладка считается в базовой сетке (строка
 * узла — 17 единиц) и затем масштабируется под кегль: при Literata 20 одна единица — 24/17 px,
 * строка узла — 24 px, все промежутки растут в той же пропорции.
 *
 * Ширина букв замерена в Chromium (Literata 420, кириллица, оптический размер по кеглю):
 * в среднем 0,60 em, в худшем слове 0,62 em; полужирный корень — 0,62–0,64 em. Оценка
 * спеки (10,5 px при кегле 20, то есть 0,525 em) слова не вмещала, поэтому здесь 0,63 em:
 * CHAR_WIDTH 8,93 единицы = 12,6 px при кегле 20. Подписи связей — Literata 400 кеглем 0,875
 * от узла (17,5 px при 20, 14 px при 16), 0,62 em на букву.
 *
 * С редизайна 2026-10-04 узлы набраны Onest (--ph-serif = Onest). Onest уже Literata: замер в
 * Chromium — 12,0 px на букву кириллицы при кегле 20 против 12,8 у Literata, — поэтому ширины
 * Literata выше остаются надёжной верхней оценкой и подписи не наезжают друг на друга.
 */

/** Кегль узлов на листе компьютера и телефона, px. */
export const DIAGRAM_FONT = { desktop: 20, phone: 16.5, min: 16 } as const;
/** Подписи связей — 0,875 кегля узла: 17,5 px при 20, 14,4 при 16,5, 14 при 16. */
export const DIAGRAM_LABEL_RATIO = 0.875;
/** Высота строки узла к кеглю (Literata 20/24). */
export const DIAGRAM_LINE_RATIO = 1.2;
/** Не мельче этого после уменьшения схемы через viewBox. */
export const DIAGRAM_MIN_NODE_PX = 16;
export const DIAGRAM_MIN_LABEL_PX = 14;
/** Уже этого лист телефонный: узлы набираются кеглем 16,5. */
export const DIAGRAM_PHONE_WIDTH = 480;

/** Строка узла в базовой сетке. */
const LINE_HEIGHT = 17;
const CHAR_EM = 0.63;
const LABEL_CHAR_EM = 0.62;
/** Кегль узла в базовой сетке: строка 17 = 1,2 кегля. */
const BASE_FONT = LINE_HEIGHT / DIAGRAM_LINE_RATIO;
const CHAR_WIDTH = CHAR_EM * BASE_FONT; // 8,93
const LABEL_CHAR_WIDTH = LABEL_CHAR_EM * DIAGRAM_LABEL_RATIO * BASE_FONT; // 7,69
const LABEL_MAX_CHARS = 22;
/** Половина строки подписи (1,2 её кегля). */
const LABEL_HALF_HEIGHT = (DIAGRAM_LINE_RATIO * DIAGRAM_LABEL_RATIO * BASE_FONT) / 2; // 7,44
const BOX_PADDING_X = 8;
const BOX_PADDING_Y = 10;
const GAP_X = 44;
const GAP_Y = 30;
const ROW_GAP = 36;
/** Между рядами с подписанными связями — больше места, чтобы подписи не теснились на линиях. */
const ROW_GAP_LABELED = 50;
const MARGIN = 6;
const MIN_BOX_W = 96;
/** Узел не шире 12em: 12 кеглей текста и поля. */
const MAX_BOX_W = Math.round(12 * BASE_FONT + 2 * 8);
const HYPHENATE_FROM = 16;
const PARALLEL_OFFSET = 5;
const RECIPROCAL_LABEL_OFFSET = 10;
const LABEL_OFFSET = 8;
/** Наконечник стрелки (шеврон) кончается в 2 px от блока. */
const ARROW_GAP = 2;
/** Обходная линия идёт по промежутку между колонками на этом расстоянии от узла (промежуток не уже 44). */
const GAP_ROUTE = 14;
/** Наконечники, сходящиеся к одному блоку, — не ближе этого друг к другу. */
const MIN_SLOT_GAP = 10;
const CURVE_SAMPLES = 24;

/* ── Геометрия ─────────────────────────────────────────────────────────── */

/** Пересекает ли отрезок pq прямоугольник (расширенный на pad). Liang–Barsky. */
export function segmentIntersectsRect(p: Point, q: Point, rect: Rect, pad = 0): boolean {
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

export function pointInRect(point: Point, rect: Rect, pad = 0): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.w + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.h + pad
  );
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

export function polylineHitsRect(points: Point[], rect: Rect, pad = 0): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (segmentIntersectsRect(points[index - 1], points[index], rect, pad)) return true;
  }
  return false;
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

const fmt = (value: number) => Math.round(value * 10) / 10;

/** Путь по ломаной со скруглёнными углами. */
export function pathFromPoints(points: Point[], radius = 6): string {
  const clean = points.filter(
    (point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.5,
  );
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

export function bezierPoint(curve: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * curve[0].x + 3 * u * u * t * curve[1].x + 3 * u * t * t * curve[2].x + t * t * t * curve[3].x,
    y: u * u * u * curve[0].y + 3 * u * u * t * curve[1].y + 3 * u * t * t * curve[2].y + t * t * t * curve[3].y,
  };
}

function bezierPath(curve: Curve): string {
  const [a, b, c, d] = curve;
  return `M${fmt(a.x)},${fmt(a.y)}C${fmt(b.x)},${fmt(b.y)} ${fmt(c.x)},${fmt(c.y)} ${fmt(d.x)},${fmt(d.y)}`;
}

function sampleCurve(curve: Curve, count = CURVE_SAMPLES): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => bezierPoint(curve, index / count));
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

/**
 * Те же строки, но ровнее: слова переносятся так, чтобы самая длинная строка была как можно
 * короче («Подорожание / снижает выручку», а не «Подорожание снижает / выручку»). Только для
 * подписей, которые уже легли целыми словами, без переносов и многоточия; число строк не меняется.
 */
export function balanceLines(lines: string[], capacity: number): string[] {
  if (lines.length < 2) return lines;
  const words = lines.join(' ').split(' ');
  const count = lines.length;
  if (words.length < count || lines.some(line => line.endsWith('-') || line.endsWith('…'))) return lines;
  const limit = Math.max(4, Math.floor(capacity));
  // best[i][k]: самая короткая «самая длинная строка», если первые i слов разложены на k строк.
  const width = (from: number, to: number) => words.slice(from, to).join(' ').length;
  const best: number[][] = Array.from({ length: words.length + 1 }, () => Array(count + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: words.length + 1 }, () => Array(count + 1).fill(-1));
  best[0][0] = 0;
  for (let k = 1; k <= count; k += 1) {
    for (let i = 1; i <= words.length; i += 1) {
      for (let j = k - 1; j < i; j += 1) {
        if (!Number.isFinite(best[j][k - 1])) continue;
        const line = width(j, i);
        if (line > limit) continue;
        const worst = Math.max(best[j][k - 1], line);
        if (worst < best[i][k]) {
          best[i][k] = worst;
          cut[i][k] = j;
        }
      }
    }
  }
  if (!Number.isFinite(best[words.length][count])) return lines;
  const result: string[] = [];
  for (let i = words.length, k = count; k > 0; k -= 1) {
    const j = cut[i][k];
    result.unshift(words.slice(j, i).join(' '));
    i = j;
  }
  return result;
}

function makeBox(node: DiagramNode, width: number, maxLines: number): Omit<LayoutBox, 'x' | 'y' | 'h' | 'layer'> {
  const capacity = (width - BOX_PADDING_X * 2) / CHAR_WIDTH;
  // Перенос внутри слова — только для очень длинных слов или если слово иначе не влезает, и только по слогам.
  const hyphenateFrom = longestWord(node.label) > capacity ? 0 : HYPHENATE_FROM;
  const lines = balanceLines(wrapLabel(node.label, capacity, maxLines, hyphenateFrom), capacity);
  return { id: node.id, label: node.label, lines, w: width };
}

function boxHeight(lineCount: number): number {
  return Math.max(1, lineCount) * LINE_HEIGHT + BOX_PADDING_Y * 2;
}

/* ── Связи ─────────────────────────────────────────────────────────────── */

type Orientation = 'horizontal' | 'vertical';

interface LabelCandidate {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

/** Связь до расстановки подписей: где её можно подписать, по порядку предпочтения. */
interface PendingEdge {
  edge: LayoutEdge;
  text?: string;
  candidates: LabelCandidate[];
}

function edgeKey(edge: DiagramEdge): string {
  return `${edge.from}->${edge.to}`;
}

function anchorFor(nx: number): 'start' | 'middle' | 'end' {
  return nx > 0.35 ? 'start' : nx < -0.35 ? 'end' : 'middle';
}

function polylineHitsBoxes(points: Point[], boxes: LayoutBox[], skip: Set<string>): boolean {
  for (const box of boxes) {
    if (skip.has(box.id)) continue;
    if (polylineHitsRect(points, box, 3)) return true;
  }
  return false;
}

function fitLabel(label: string, availablePx: number): string | undefined {
  const chars = Math.floor(availablePx / LABEL_CHAR_WIDTH);
  if (chars < 4) return undefined;
  return wrapLabel(label, Math.min(LABEL_MAX_CHARS, chars), 1)[0];
}

/**
 * Точки входа и выхода на стороне блока длиной side: равномерно, но не ближе
 * MIN_SLOT_GAP друг к другу; если столько наконечников не помещается, все
 * сходятся в середину стороны и рисуются одним.
 */
function slotOffsets(count: number, side: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [side / 2];
  const gap = Math.max(MIN_SLOT_GAP, side / (count + 1));
  const span = gap * (count - 1);
  if (span > side - 12) return Array.from({ length: count }, () => side / 2);
  const start = (side - span) / 2;
  return Array.from({ length: count }, (_, index) => start + index * gap);
}

interface ConnectOptions {
  orientation: Orientation;
  width: number;
  layerOf: Map<string, number>;
  /** Промежуток между рядами (для обходных линий сверху вниз). */
  rowGap?: number;
}

function connect(boxes: LayoutBox[], edges: DiagramEdge[], options: ConnectOptions): PendingEdge[] {
  const { orientation, width, layerOf } = options;
  const rowGap = options.rowGap ?? ROW_GAP;
  const horizontal = orientation === 'horizontal';
  const byId = new Map(boxes.map(box => [box.id, box]));
  const present = new Set(edges.map(edge => `${edge.from}\u0000${edge.to}`));
  const minTop = Math.min(...boxes.map(box => box.y));
  const maxBottom = Math.max(...boxes.map(box => box.y + box.h));
  const maxRight = Math.max(...boxes.map(box => box.x + box.w));
  let topLanes = 0;
  let bottomLanes = 0;
  let sideLanes = 0;
  let elbows = 0;

  // Связи вперёд без встречной пары рисуются плавной кривой от своего места на стороне блока.
  // Кривая, которая даже из середин сторон задела бы чужой блок, сразу идёт в обход и места на стороне не занимает.
  const layerIndex = (id: string) => layerOf.get(id) ?? 0;
  const curvable = edges.filter(edge => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || layerIndex(edge.from) >= layerIndex(edge.to) || present.has(`${edge.to}\u0000${edge.from}`)) {
      return false;
    }
    const probe = curveBetween(from, to, (horizontal ? from.h : from.w) / 2, (horizontal ? to.h : to.w) / 2, horizontal);
    return !polylineHitsBoxes(sampleCurve(probe), boxes, new Set([from.id, to.id]));
  });
  const across = (box: LayoutBox) => (horizontal ? box.y + box.h / 2 : box.x + box.w / 2);
  const outSlot = new Map<string, number>();
  const inSlot = new Map<string, number>();
  for (const box of boxes) {
    const side = horizontal ? box.h : box.w;
    const outgoing = curvable
      .filter(edge => edge.from === box.id)
      .sort((a, b) => across(byId.get(a.to) as LayoutBox) - across(byId.get(b.to) as LayoutBox));
    slotOffsets(outgoing.length, side).forEach((offset, index) => outSlot.set(edgeKey(outgoing[index]), offset));
    const incoming = curvable
      .filter(edge => edge.to === box.id)
      .sort((a, b) => across(byId.get(a.from) as LayoutBox) - across(byId.get(b.from) as LayoutBox));
    slotOffsets(incoming.length, side).forEach((offset, index) => inSlot.set(edgeKey(incoming[index]), offset));
  }
  const degreeOut = (id: string) => curvable.filter(edge => edge.from === id).length;
  const degreeIn = (id: string) => curvable.filter(edge => edge.to === id).length;

  return edges.flatMap((edge): PendingEdge[] => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const reciprocal = present.has(`${edge.to}\u0000${edge.from}`);
    const fromLayer = layerIndex(edge.from);
    const toLayer = layerIndex(edge.to);
    const forward = fromLayer < toLayer || (fromLayer === toLayer && edge.from < edge.to);
    const skip = new Set([from.id, to.id]);
    const base: Pick<LayoutEdge, 'key' | 'from' | 'to' | 'label'> = { key: edgeKey(edge), from: edge.from, to: edge.to };
    if (edge.label) base.label = edge.label;
    const fullText = edge.label ? wrapLabel(edge.label, LABEL_MAX_CHARS, 1)[0] : undefined;

    /* 1. Кривая между слоями. */
    const outOffset = outSlot.get(edgeKey(edge));
    const inOffset = inSlot.get(edgeKey(edge));
    if (outOffset !== undefined && inOffset !== undefined) {
      const curve = curveBetween(from, to, outOffset, inOffset, horizontal);
      const samples = sampleCurve(curve);
      if (!polylineHitsBoxes(samples, boxes, skip)) {
        const laid: LayoutEdge = { ...base, points: samples, d: bezierPath(curve), routed: false, curve };
        return [{ edge: laid, text: fullText, candidates: fullText ? curveLabelCandidates(curve, horizontal, degreeOut(edge.from), degreeIn(edge.to)) : [] }];
      }
    }

    /* 2. Прямая (встречные связи — две параллельные линии с подписями по разные стороны). */
    const a = center(forward ? from : to);
    const b = center(forward ? to : from);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / length;
    let ny = (b.x - a.x) / length;
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const sideSign = reciprocal ? (forward ? 1 : -1) : 1;
    const shift = reciprocal ? sideSign * PARALLEL_OFFSET : 0;
    const fc = center(from);
    const tc = center(to);
    const start0 = clipToBox(from, tc.x, tc.y, 2);
    const end0 = clipToBox(to, fc.x, fc.y, ARROW_GAP + 1);
    const straight = [
      { x: start0.x + nx * shift, y: start0.y + ny * shift },
      { x: end0.x + nx * shift, y: end0.y + ny * shift },
    ];
    if (!polylineHitsBoxes(straight, boxes, skip)) {
      const laid: LayoutEdge = { ...base, points: straight, d: pathFromPoints(straight), routed: false };
      const candidates: LabelCandidate[] = [];
      if (fullText) {
        const mid = { x: (straight[0].x + straight[1].x) / 2, y: (straight[0].y + straight[1].y) / 2 };
        const offset = reciprocal ? PARALLEL_OFFSET + RECIPROCAL_LABEL_OFFSET : LABEL_OFFSET;
        for (const extra of [0, 6, 12]) {
          candidates.push({
            x: mid.x + nx * (offset + extra) * sideSign,
            y: mid.y + ny * (offset + extra) * sideSign,
            anchor: anchorFor(nx * sideSign),
          });
        }
        if (!reciprocal) candidates.push({ x: mid.x - nx * offset, y: mid.y - ny * offset, anchor: anchorFor(-nx) });
      }
      return [{ edge: laid, text: fullText, candidates }];
    }

    /* 3. Линия прошла бы через другой блок — ведём её в обход. */
    if (horizontal) {
      const corridor = (where: 'top' | 'bottom'): Point[] | null => {
        const lane = where === 'top' ? topLanes : bottomLanes;
        const y = where === 'top' ? minTop - 18 - lane * 14 : maxBottom + 18 + lane * 14;
        const inset = ((lane % 3) - 1) * 10;
        const sx = fc.x + inset;
        const tx = tc.x - inset;
        const sy = where === 'top' ? from.y : from.y + from.h;
        const ty = where === 'top' ? to.y - ARROW_GAP : to.y + to.h + ARROW_GAP;
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
      // Сверху и снизу узла мешают соседи по колонке: линия выходит вбок, в промежуток между
      // колонками (там узлов не бывает), поднимается над всеми узлами и опускается к цели тоже
      // по промежутку. Так линия не идёт через слова ни при какой раскладке колонок.
      let lane = 1;
      if (!points) {
        const y = minTop - 18 - topLanes * 14;
        const outX = from.x + from.w + GAP_ROUTE;
        const inX = to.x - GAP_ROUTE;
        const side = [
          { x: from.x + from.w, y: fc.y },
          { x: outX, y: fc.y },
          { x: outX, y },
          { x: inX, y },
          { x: inX, y: tc.y },
          { x: to.x - ARROW_GAP, y: tc.y },
        ];
        if (!polylineHitsBoxes(side, boxes, skip)) {
          points = side;
          lane = 2;
        } else {
          // Обход не нашёлся и так — всё равно верхний коридор: он хотя бы не прячет стрелку.
          points = [
            { x: fc.x, y: from.y },
            { x: fc.x, y },
            { x: tc.x, y },
            { x: tc.x, y: to.y - ARROW_GAP },
          ];
        }
        where = 'top';
      }
      if (where === 'top') topLanes += 1;
      else bottomLanes += 1;
      const laid: LayoutEdge = { ...base, points, d: pathFromPoints(points, 10), routed: true };
      const text = edge.label ? fitLabel(edge.label, Math.abs(points[lane + 1].x - points[lane].x) + 40) : undefined;
      const laneY = points[lane].y;
      const midX = (points[lane].x + points[lane + 1].x) / 2;
      const outward = where === 'top' ? -1 : 1;
      const candidates: LabelCandidate[] = text
        ? [
            { x: midX, y: laneY + outward * LABEL_OFFSET, anchor: 'middle' },
            { x: midX, y: laneY - outward * (LABEL_OFFSET + 1), anchor: 'middle' },
            { x: midX, y: laneY + outward * (LABEL_OFFSET + 8), anchor: 'middle' },
          ]
        : [];
      return [{ edge: laid, text, candidates }];
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
    const sGap = up ? from.y - rowGap / 2 - laneShift : from.y + from.h + rowGap / 2 + laneShift;
    const tGap = up ? to.y + to.h + rowGap / 2 + laneShift : to.y - rowGap / 2 - laneShift;
    const laneX = maxRight + 14 + lane * 12;
    const points: Point[] = adjacent
      ? [
          { x: sx, y: up ? from.y : from.y + from.h },
          { x: sx, y: sGap },
          { x: tx, y: sGap },
          { x: tx, y: up ? to.y + to.h + ARROW_GAP : to.y - ARROW_GAP },
        ]
      : [
          { x: sx, y: up ? from.y : from.y + from.h },
          { x: sx, y: sGap },
          { x: laneX, y: sGap },
          { x: laneX, y: tGap },
          { x: tx, y: tGap },
          { x: tx, y: up ? to.y + to.h + ARROW_GAP : to.y - ARROW_GAP },
        ];
    const laid: LayoutEdge = { ...base, points, d: pathFromPoints(points, 10), routed: true };
    if (!edge.label) return [{ edge: laid, candidates: [] }];
    if (adjacent) {
      const text = fitLabel(edge.label, Math.max(Math.abs(tx - sx), width / 2));
      const midX = (sx + tx) / 2;
      return [
        {
          edge: laid,
          text,
          candidates: [
            { x: midX, y: sGap - LABEL_OFFSET, anchor: 'middle' },
            { x: midX, y: sGap + LABEL_OFFSET + 1, anchor: 'middle' },
          ],
        },
      ];
    }
    const text = fitLabel(edge.label, width - MARGIN - (laneX + 6));
    return [
      {
        edge: laid,
        text,
        candidates: [
          { x: laneX + 6, y: (sGap + tGap) / 2, anchor: 'start' },
          { x: laneX + 6, y: (sGap + tGap) / 2 + 16, anchor: 'start' },
          { x: laneX + 6, y: (sGap + tGap) / 2 - 16, anchor: 'start' },
        ],
      },
    ];
  });
}

/**
 * Кривая от точки на стороне источника (правой или нижней) к точке на стороне
 * цели (левой или верхней): выходит и входит под прямым углом к стороне.
 */
function curveBetween(from: LayoutBox, to: LayoutBox, outOffset: number, inOffset: number, horizontal: boolean): Curve {
  if (horizontal) {
    const s = { x: from.x + from.w, y: from.y + outOffset };
    const t = { x: to.x - ARROW_GAP, y: to.y + inOffset };
    const c = Math.max(24, (t.x - s.x) * 0.5);
    return [s, { x: s.x + c, y: s.y }, { x: t.x - c, y: t.y }, t];
  }
  const s = { x: from.x + outOffset, y: from.y + from.h };
  const t = { x: to.x + inOffset, y: to.y - ARROW_GAP };
  const c = Math.max(18, (t.y - s.y) * 0.5);
  return [s, { x: s.x, y: s.y + c }, { x: t.x, y: t.y - c }, t];
}

/**
 * Где подписать кривую. Подпись не ложится на сам штрих: она стоит у того конца,
 * где блок не делится с другими связями, и с той стороны, куда кривая не
 * уходит (над началом, если кривая идёт вниз, и под ним, если вверх). Если
 * общий блок с обеих сторон или ни с одной — сначала середина, со смещением от
 * линии.
 */
function curveLabelCandidates(curve: Curve, horizontal: boolean, fromDegree: number, toDegree: number): LabelCandidate[] {
  const [s, , , t] = curve;
  const near: { source: LabelCandidate[]; target: LabelCandidate[] } = { source: [], target: [] };
  if (horizontal) {
    const descends = t.y > s.y + 1;
    const ascends = t.y < s.y - 1;
    const sourceAbove = { x: s.x + 8, y: s.y - 9, anchor: 'start' as const };
    const sourceBelow = { x: s.x + 8, y: s.y + 10, anchor: 'start' as const };
    near.source = ascends ? [sourceBelow, sourceAbove] : [sourceAbove, sourceBelow];
    const targetAbove = { x: t.x - 10, y: t.y - 9, anchor: 'end' as const };
    const targetBelow = { x: t.x - 10, y: t.y + 10, anchor: 'end' as const };
    // Кривая приходит снизу — над концом свободно; сверху — свободно под ним.
    near.target = descends ? [targetBelow, targetAbove] : [targetAbove, targetBelow];
    // Ещё по одному месту чуть дальше от линии — для тесных пучков.
    near.source.push({ ...near.source[0], y: near.source[0].y + (near.source[0].y < s.y ? -9 : 9) });
    near.target.push({ ...near.target[0], y: near.target[0].y + (near.target[0].y < t.y ? -9 : 9) });
  } else {
    const goesRight = t.x > s.x + 1;
    const goesLeft = t.x < s.x - 1;
    const sourceLeft = { x: s.x - 6, y: s.y + 10, anchor: 'end' as const };
    const sourceRight = { x: s.x + 6, y: s.y + 10, anchor: 'start' as const };
    near.source = goesRight ? [sourceLeft, sourceRight] : [sourceRight, sourceLeft];
    const targetLeft = { x: t.x - 6, y: t.y - 10, anchor: 'end' as const };
    const targetRight = { x: t.x + 6, y: t.y - 10, anchor: 'start' as const };
    near.target = goesLeft ? [targetLeft, targetRight] : goesRight ? [targetRight, targetLeft] : [targetRight, targetLeft];
  }
  const mid = bezierPoint(curve, 0.5);
  const dx = curve[3].x + curve[2].x - curve[1].x - curve[0].x;
  const dy = curve[3].y + curve[2].y - curve[1].y - curve[0].y;
  const length = Math.hypot(dx, dy) || 1;
  let mx = -dy / length;
  let my = dx / length;
  if (my > 0 || (my === 0 && mx < 0)) {
    mx = -mx;
    my = -my;
  }
  const middle: LabelCandidate[] = [
    { x: mid.x + mx * 10, y: mid.y + my * 10, anchor: anchorFor(mx) },
    { x: mid.x - mx * 10, y: mid.y - my * 10, anchor: anchorFor(-mx) },
  ];
  // Запасные места: на четверти и трёх четвертях кривой, по обе стороны.
  const along: LabelCandidate[] = [0.3, 0.7].flatMap(t => {
    const point = bezierPoint(curve, t);
    return [
      { x: point.x + mx * 10, y: point.y + my * 10, anchor: anchorFor(mx) },
      { x: point.x - mx * 10, y: point.y - my * 10, anchor: anchorFor(-mx) },
    ];
  });
  const sharedSource = fromDegree > 1;
  const sharedTarget = toDegree > 1;
  if (sharedTarget && !sharedSource) return [...near.source, ...middle, ...near.target, ...along];
  if (sharedSource && !sharedTarget) return [...near.target, ...middle, ...near.source, ...along];
  return [...middle, ...near.source, ...near.target, ...along];
}

/**
 * Прямоугольник текста подписи с ореолом фона. unit — масштаб раскладки (layout.unit), если
 * координаты взяты из готовой схемы; в базовой сетке — 1.
 */
export function labelRect(text: string, x: number, y: number, anchor: 'start' | 'middle' | 'end', unit = 1): Rect {
  const w = text.length * LABEL_CHAR_WIDTH * unit;
  const half = LABEL_HALF_HEIGHT * unit;
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x: x0 - 2 * unit, y: y - half - unit, w: w + 4 * unit, h: half * 2 + 2 * unit };
}

/** Полоса самих букв подписи, без ореола: линия через неё перечёркивает текст. */
function labelInkRect(text: string, x: number, y: number, anchor: 'start' | 'middle' | 'end'): Rect {
  const w = text.length * LABEL_CHAR_WIDTH;
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x: x0 + 1, y: y - 4, w: Math.max(0, w - 2), h: 8 };
}

/**
 * Расставляет подписи: каждой — первое место из её списка, где подпись не
 * ложится ни на одну линию, ни на блок, ни на другую подпись и не выходит за
 * ширину схемы. Если чистого места нет, — место с наименьшим ущербом.
 */
/**
 * Запасные места подписи вдоль самой линии: на пяти точках ломаной по обе стороны, дальше и ближе.
 * Нужны, когда ни одно обычное место не свободно от узлов (тесный телефонный лист).
 */
function alongCandidates(points: Point[]): LabelCandidate[] {
  if (points.length < 2) return [];
  const result: LabelCandidate[] = [];
  for (const share of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const index = Math.min(points.length - 2, Math.max(0, Math.floor(share * (points.length - 1))));
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const offset of [LABEL_OFFSET + 4, -(LABEL_OFFSET + 4), LABEL_OFFSET + 16, -(LABEL_OFFSET + 16)]) {
      result.push({ x: mid.x + nx * offset, y: mid.y + ny * offset, anchor: anchorFor(Math.sign(offset) * nx) });
    }
  }
  return result;
}

/** Подпись на узле или за краем схемы не читается: такой цены место не годится вовсе. */
const UNREADABLE = 50;

function placeLabels(pending: PendingEdge[], boxes: LayoutBox[], width: number): LayoutEdge[] {
  const placed: Rect[] = [];
  const strokes = pending.map(item => item.edge.points);
  const costOf = (text: string, candidate: LabelCandidate) => {
    const rect = labelRect(text, candidate.x, candidate.y, candidate.anchor);
    const ink = labelInkRect(text, candidate.x, candidate.y, candidate.anchor);
    let cost = 0;
    if (rect.x < 0 || rect.x + rect.w > width) cost += 100;
    if (boxes.some(box => rectsOverlap(rect, box, 1))) cost += 50;
    if (placed.some(other => rectsOverlap(rect, other))) cost += 20;
    // Линия через буквы хуже, чем линия, которую только прикрывает ореол подписи.
    for (const points of strokes) {
      if (polylineHitsRect(points, ink)) cost += 5;
      else if (polylineHitsRect(points, rect)) cost += 1;
    }
    return cost;
  };
  for (const item of pending) {
    const { edge, text } = item;
    if (!text || item.candidates.length === 0) continue;
    let best: { candidate: LabelCandidate; cost: number } | null = null;
    for (const candidate of [...item.candidates, ...alongCandidates(edge.points)]) {
      const cost = costOf(text, candidate);
      if (!best || cost < best.cost) best = { candidate, cost };
      if (cost === 0) break;
    }
    // Ни одного места вне узлов и в пределах схемы: подпись не рисуется поверх слов, она остаётся
    // в подсказке и в описании схемы для программ чтения с экрана.
    if (!best || best.cost >= UNREADABLE) continue;
    edge.labelText = text;
    edge.labelX = best.candidate.x;
    edge.labelY = best.candidate.y;
    edge.labelAnchor = best.candidate.anchor;
    placed.push(labelRect(text, best.candidate.x, best.candidate.y, best.candidate.anchor));
  }
  return pending.map(item => item.edge);
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
      if (edge.curve) {
        edge.curve = edge.curve.map(point => ({ x: point.x, y: point.y + shift })) as Curve;
        edge.d = bezierPath(edge.curve);
      } else {
        edge.d = pathFromPoints(edge.points, edge.routed ? 10 : 6);
      }
      if (edge.labelY !== undefined) edge.labelY += shift;
    });
  }
  return Math.ceil(Math.max(baseHeight + shift, maxY + shift + MARGIN));
}

/* ── Кольцо ─────────────────────────────────────────────────────────────── */

/** Порядок обхода, если схема — ровно один простой цикл из 3–6 узлов, иначе null. */
export function simpleCycleOrder(nodes: DiagramNode[], edges: DiagramEdge[]): string[] | null {
  const count = nodes.length;
  if (count < 3 || count > 6 || edges.length !== count) return null;
  const next = new Map<string, string>();
  const indegree = new Map<string, number>();
  for (const edge of edges) {
    if (next.has(edge.from)) return null;
    next.set(edge.from, edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (!next.has(node.id) || indegree.get(node.id) !== 1) return null;
  }
  const order = [nodes[0].id];
  let current = next.get(nodes[0].id) as string;
  while (current !== nodes[0].id) {
    if (order.length >= count) return null;
    order.push(current);
    current = next.get(current) as string;
  }
  return order.length === count ? order : null;
}

const RING_MIN_ARC = 24;

/**
 * Круговорот (углерода, воды, клетки) рисуется кольцом: так видно главное — что
 * цикл замыкается. Кольцо берётся, только если всё читается без потерь: подписи
 * узлов и связей целиком, ни одна подпись не легла на блок, линию или другую
 * подпись, каждая дуга длиннее 24 px. Иначе — обычная раскладка слоями.
 */
function layoutRing(nodes: DiagramNode[], edges: DiagramEdge[], width: number, order: string[]): DiagramLayout | null {
  const count = order.length;
  const phone = width < 420;
  const boxW = phone ? 108 : 124;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const prepared = order.map(id => makeBox(nodeById.get(id) as DiagramNode, boxW, 2));
  if (prepared.some(box => box.lines.join(' ') !== box.label)) return null;
  const boxH = boxHeight(Math.max(...prepared.map(box => box.lines.length)));
  const rx = Math.min(width / 2 - boxW / 2 - MARGIN - 2, 200);
  if (rx < 60) return null;
  const ry = phone ? rx * 0.95 : count === 3 ? Math.min(rx * 0.5, 90) : Math.min(rx * 0.55, 110);
  const height = Math.ceil(2 * ry + boxH + 2 * MARGIN + 24);
  const cx = width / 2;
  const cy = height / 2;
  const angle = (index: number) => -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const at = (theta: number): Point => ({ x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) });
  const boxes: LayoutBox[] = prepared.map((box, index) => {
    const p = at(angle(index));
    return { ...box, x: p.x - boxW / 2, y: p.y - boxH / 2, h: boxH, layer: index };
  });
  for (let i = 0; i < boxes.length; i += 1) {
    if (boxes[i].x < 0 || boxes[i].x + boxes[i].w > width) return null;
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (rectsOverlap(boxes[i], boxes[j], 6)) return null;
    }
  }

  const indexOf = new Map(order.map((id, index) => [id, index]));
  const laid: LayoutEdge[] = [];
  for (const edge of edges) {
    const index = indexOf.get(edge.from) as number;
    const from = boxes[index];
    const to = boxes[(index + 1) % count];
    const t0 = angle(index);
    const t1 = t0 + (2 * Math.PI) / count;
    // Дуга обрезается по краям блоков: начало в 3 px от источника, наконечник в 2 px от цели.
    const steps = 360;
    let startAngle = t0;
    let endAngle = t1;
    for (let k = 0; k <= steps; k += 1) {
      const theta = t0 + ((t1 - t0) * k) / steps;
      if (!pointInRect(at(theta), from, 3)) {
        startAngle = theta;
        break;
      }
    }
    for (let k = steps; k >= 0; k -= 1) {
      const theta = t0 + ((t1 - t0) * k) / steps;
      if (!pointInRect(at(theta), to, ARROW_GAP + 1)) {
        endAngle = theta;
        break;
      }
    }
    if (endAngle <= startAngle) return null;
    const points = Array.from({ length: 25 }, (_, k) => at(startAngle + ((endAngle - startAngle) * k) / 24));
    let arcLength = 0;
    for (let k = 1; k < points.length; k += 1) arcLength += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
    if (arcLength < RING_MIN_ARC) return null;
    const p0 = points[0];
    const p1 = points[points.length - 1];
    const result: LayoutEdge = {
      key: edgeKey(edge),
      from: edge.from,
      to: edge.to,
      points,
      d: `M${fmt(p0.x)},${fmt(p0.y)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(p1.x)},${fmt(p1.y)}`,
      routed: false,
      arc: { rx, ry },
    };
    if (edge.label) {
      result.label = edge.label;
      // Середина дуги; подпись снаружи кольца, а на узком экране — внутри.
      const middle = (startAngle + endAngle) / 2;
      const point = at(middle);
      const cos = Math.cos(middle);
      const sin = Math.sin(middle);
      const push = phone ? -14 : 14;
      const x = point.x + cos * push;
      const y = point.y + sin * push;
      const outward: 'start' | 'middle' | 'end' = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
      const anchor = phone ? (outward === 'start' ? 'end' : outward === 'end' ? 'start' : 'middle') : outward;
      const text = wrapLabel(edge.label, LABEL_MAX_CHARS, 1)[0];
      if (text !== edge.label) return null;
      result.labelText = text;
      result.labelX = x;
      result.labelY = y;
      result.labelAnchor = anchor;
    }
    laid.push(result);
  }

  // Подписи целиком, на своих местах и ни на что не ложатся.
  const rects: Rect[] = [];
  for (const edge of laid) {
    if (!edge.labelText) continue;
    const rect = labelRect(edge.labelText, edge.labelX as number, edge.labelY as number, edge.labelAnchor ?? 'middle');
    if (rect.x < 0 || rect.x + rect.w > width || rect.y < 0 || rect.y + rect.h > height) return null;
    if (boxes.some(box => rectsOverlap(rect, box, 1))) return null;
    if (rects.some(other => rectsOverlap(rect, other))) return null;
    if (laid.some(other => polylineHitsRect(other.points, rect))) return null;
    rects.push(rect);
  }
  return { kind: 'cycle', width, height, boxes, edges: laid, ...BASE_METRICS };
}

/* ── Раскладка ─────────────────────────────────────────────────────────── */

/** Типографика базовой сетки (unit 1): кегль узла 14,17, строка 17. */
const BASE_METRICS = {
  fontSize: BASE_FONT,
  labelSize: DIAGRAM_LABEL_RATIO * BASE_FONT,
  lineHeight: LINE_HEIGHT,
  unit: 1,
} as const;

/**
 * Раскладка в базовой сетке. Простой цикл из 3–6 узлов — кольцом, если он так читается
 * целиком. Остальное — слоями в порядке чтения: слева направо, а если не
 * помещается — сверху вниз. Связи между соседними слоями — плавные кривые от
 * своих мест на сторонах блоков; связь, которая замыкает цикл или пропускает
 * слой, идёт в обход. Встречные связи (A → B и B → A) — две параллельные линии,
 * подписи по разные стороны.
 */
function layoutBase(nodes: DiagramNode[], edges: DiagramEdge[], availableWidth: number): DiagramLayout {
  const width = Math.max(260, Math.floor(availableWidth));

  const ringOrder = simpleCycleOrder(nodes, edges);
  if (ringOrder) {
    const ring = layoutRing(nodes, edges, width, ringOrder);
    if (ring) return ring;
  }

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
  const horizontalBoxW = Math.min(MAX_BOX_W, Math.floor((width - MARGIN * 2 - gapX * (columns - 1)) / columns));
  const capacity = (horizontalBoxW - BOX_PADDING_X * 2) / CHAR_WIDTH;

  if (horizontalBoxW >= MIN_BOX_W && wordChars <= capacity) {
    // Слева направо: каждый слой — колонка. Если ширина остаётся, промежутки
    // между колонками растут (до 140 px): кривым и подписям нужно место.
    const boxW = horizontalBoxW;
    const spare = width - MARGIN * 2 - columns * boxW - gapX * (columns - 1);
    const columnGap = columns > 1 ? Math.max(gapX, Math.min(140, gapX + spare / (columns - 1))) : gapX;
    const prepared = new Map(nodes.map(node => [node.id, makeBox(node, boxW, 3)]));
    const h = boxHeight(Math.max(...[...prepared.values()].map(box => box.lines.length)));
    const tallest = Math.max(...layers.map(layer => layer.length));
    const height = tallest * h + (tallest - 1) * GAP_Y + MARGIN * 2;
    const totalW = columns * boxW + (columns - 1) * columnGap;
    const offsetX = (width - totalW) / 2;
    const boxes: LayoutBox[] = [];
    layers.forEach((layer, layerIndex) => {
      const columnH = layer.length * h + (layer.length - 1) * GAP_Y;
      const top = (height - columnH) / 2;
      layer.forEach((id, index) => {
        const box = prepared.get(id) ?? makeBox(nodeById.get(id) as DiagramNode, boxW, 3);
        boxes.push({ ...box, x: offsetX + layerIndex * (boxW + columnGap), y: top + index * (h + GAP_Y), h, layer: layerIndex });
      });
    });
    const laid = placeLabels(connect(boxes, edges, { orientation: 'horizontal', width, layerOf }), boxes, width);
    const fitted = fitVertically(boxes, laid, height);
    return { kind: 'layered-horizontal', width, height: fitted, boxes, edges: laid, ...BASE_METRICS };
  }

  // Сверху вниз: каждый слой — строка. У каждой строки своя ширина блоков:
  // один блок в строке не сжимается до ширины трёх, и слова не рвутся зря.
  const gapBetween = width < 480 ? 14 : GAP_X;
  const rowGap = edges.some(edge => edge.label && Math.abs((layerOf.get(edge.from) ?? 0) - (layerOf.get(edge.to) ?? 0)) === 1)
    ? ROW_GAP_LABELED
    : ROW_GAP;

  const place = (reserve: number, leftAligned: boolean) => {
    const rowBoxW = (count: number) =>
      Math.max(72, Math.min(MAX_BOX_W, Math.floor((width - MARGIN * 2 - reserve - gapBetween * (count - 1)) / count)));
    // Слой шире листа (на телефоне шесть узлов без связей в одном слое) переносится на следующие
    // строки: узлы не выходят за край. Строки и есть слои для линий: связь через строку идёт в обход.
    const perRow = Math.max(1, Math.floor((width - MARGIN * 2 - reserve + gapBetween) / (72 + gapBetween)));
    const rows: { ids: string[]; layer: number }[] = [];
    layers.forEach((layer, layerIndex) => {
      for (let start = 0; start < layer.length; start += perRow) rows.push({ ids: layer.slice(start, start + perRow), layer: layerIndex });
    });
    const rowOf = new Map<string, number>();
    rows.forEach((row, rowIndex) => row.ids.forEach(id => rowOf.set(id, rowIndex)));
    const prepared = new Map<string, Omit<LayoutBox, 'x' | 'y' | 'h' | 'layer'>>();
    rows.forEach(row => {
      const boxW = rowBoxW(row.ids.length);
      // Три строки, как у колонок: подпись узла не обрезается многоточием (на телефоне «Подорожание
      // снижает выручку» в две строки по 13 букв не влезает).
      row.ids.forEach(id => prepared.set(id, makeBox(nodeById.get(id) as DiagramNode, boxW, 3)));
    });
    const h = boxHeight(Math.max(...[...prepared.values()].map(box => box.lines.length)));
    const height = rows.length * h + (rows.length - 1) * rowGap + MARGIN * 2;
    const boxes: LayoutBox[] = [];
    rows.forEach((row, rowIndex) => {
      const boxW = rowBoxW(row.ids.length);
      const rowW = row.ids.length * boxW + (row.ids.length - 1) * gapBetween;
      const left = leftAligned ? MARGIN : (width - reserve - rowW) / 2;
      row.ids.forEach((id, index) => {
        const box = prepared.get(id) as Omit<LayoutBox, 'x' | 'y' | 'h' | 'layer'>;
        boxes.push({ ...box, x: left + index * (boxW + gapBetween), y: MARGIN + rowIndex * (h + rowGap), h, layer: row.layer });
      });
    });
    const pending = connect(boxes, edges, { orientation: 'vertical', width, layerOf: rowOf, rowGap });
    return { boxes, pending, height };
  };

  let attempt = place(0, false);
  const lanesOf = (pending: PendingEdge[]) => pending.filter(item => item.edge.routed && item.edge.points.length > 4).length;
  let lanes = lanesOf(attempt.pending);
  // Обходным связям нужна полоса справа: освобождаем её и раскладываем заново.
  for (let pass = 0; pass < 3 && lanes > 0; pass += 1) {
    const labelChars = Math.max(
      0,
      ...attempt.pending
        .filter(item => item.edge.routed && item.edge.points.length > 4 && item.edge.label)
        .map(item => Math.min(LABEL_MAX_CHARS, (item.edge.label as string).length)),
    );
    const reserve = 14 + lanes * 12 + (labelChars ? labelChars * LABEL_CHAR_WIDTH + 8 : 0);
    attempt = place(reserve, true);
    const next = lanesOf(attempt.pending);
    if (next <= lanes) break;
    lanes = next;
  }
  const laid = placeLabels(attempt.pending, attempt.boxes, width);
  const fitted = fitVertically(attempt.boxes, laid, attempt.height);
  return { kind: 'layered-vertical', width, height: fitted, boxes: attempt.boxes, edges: laid, ...BASE_METRICS };
}

/* ── Кегль ──────────────────────────────────────────────────────────────── */

/** Во сколько раз раскладка при этом кегле крупнее базовой сетки. */
export function diagramUnit(fontSize: number): number {
  return (fontSize * DIAGRAM_LINE_RATIO) / LINE_HEIGHT;
}

const scalePoint = (point: Point, k: number): Point => ({ x: point.x * k, y: point.y * k });
/** Кегли без хвоста плавающей точки: 20, а не 20,000000000000004. */
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Та же схема, крупнее в k раз: геометрия растёт целиком, поэтому ничего не начинает пересекаться. */
function scaleLayout(base: DiagramLayout, k: number): DiagramLayout {
  const boxes = base.boxes.map(box => ({ ...box, x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k }));
  const edges = base.edges.map(edge => {
    const points = edge.points.map(point => scalePoint(point, k));
    const scaled: LayoutEdge = { ...edge, points };
    if (edge.labelX !== undefined) scaled.labelX = edge.labelX * k;
    if (edge.labelY !== undefined) scaled.labelY = edge.labelY * k;
    if (edge.curve) {
      scaled.curve = edge.curve.map(point => scalePoint(point, k)) as Curve;
      scaled.d = bezierPath(scaled.curve);
    } else if (edge.arc) {
      scaled.arc = { rx: edge.arc.rx * k, ry: edge.arc.ry * k };
      const p0 = points[0];
      const p1 = points[points.length - 1];
      scaled.d = `M${fmt(p0.x)},${fmt(p0.y)}A${fmt(scaled.arc.rx)} ${fmt(scaled.arc.ry)} 0 0 1 ${fmt(p1.x)},${fmt(p1.y)}`;
    } else {
      scaled.d = pathFromPoints(points, (edge.routed ? 10 : 6) * k);
    }
    return scaled;
  });
  return {
    kind: base.kind,
    width: base.width * k,
    height: Math.ceil(base.height * k),
    boxes,
    edges,
    fontSize: round2(base.fontSize * k),
    labelSize: round2(base.labelSize * k),
    lineHeight: round2(base.lineHeight * k),
    unit: k,
  };
}

/**
 * Раскладка схемы под ширину листа и кегль узлов (по умолчанию Literata 20). Алгоритм
 * считает в базовой сетке и масштабирует результат, поэтому при любом кегле схема та же:
 * узлы не пересекаются, линии не идут через чужие узлы, подписи не ложатся на линии.
 */
export function layoutDiagram(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  availableWidth: number,
  fontSize: number = DIAGRAM_FONT.desktop,
): DiagramLayout {
  const k = diagramUnit(fontSize);
  return scaleLayout(layoutBase(nodes, edges, availableWidth / k), k);
}

export interface DiagramFit {
  layout: DiagramLayout;
  /** Уменьшение через viewBox (1 — без уменьшения). */
  scale: number;
  /** Размер схемы на экране, px. */
  width: number;
  height: number;
  /** Схема выше отведённого места: лист растёт (до 520 px), а дальше прокручивается. */
  overflow: boolean;
}

/**
 * Правило масштаба (спека 5.7, шаг А). Лист фиксирован по высоте, поэтому схема в 4 уровня и
 * больше может не влезть:
 * 1. влезает при своём кегле (20, на телефоне 16,5) — как есть;
 * 2. иначе уменьшаем через viewBox, пока узлы не мельче 16 px, а подписи связей — 14 px
 *    (на компьютере масштаб не ниже 0,8, на телефоне уменьшать почти некуда);
 * 3. иначе раскладываем заново кеглем 16; не влезает и так — лист растёт по высоте
 *    (overflow), а последнее средство — прокрутка внутри листа.
 */
export function fitDiagram(nodes: DiagramNode[], edges: DiagramEdge[], width: number, height: number): DiagramFit {
  const available = Math.max(1, Math.floor(width));
  const room = Math.max(1, Math.floor(height));
  const fontSize = available < DIAGRAM_PHONE_WIDTH ? DIAGRAM_FONT.phone : DIAGRAM_FONT.desktop;
  const first = layoutDiagram(nodes, edges, available, fontSize);
  const scale = Math.min(1, available / first.width, room / first.height);
  if (scale >= 1) return { layout: first, scale: 1, width: first.width, height: first.height, overflow: false };
  if (first.fontSize * scale >= DIAGRAM_MIN_NODE_PX - 1e-9 && first.labelSize * scale >= DIAGRAM_MIN_LABEL_PX - 1e-9) {
    return { layout: first, scale, width: first.width * scale, height: first.height * scale, overflow: false };
  }
  const small = layoutDiagram(nodes, edges, available, DIAGRAM_FONT.min);
  // Уже 260 единиц сетки раскладка не бывает: на самом узком телефоне её сжимает ширина.
  const narrow = Math.min(1, available / small.width);
  const shown = small.height * narrow;
  return { layout: small, scale: narrow, width: small.width * narrow, height: shown, overflow: shown > room + 0.5 };
}
