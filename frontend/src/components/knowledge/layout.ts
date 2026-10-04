/**
 * Geometry of the knowledge map. Deterministic: the same lectures and concepts always give the same
 * picture, on every device and in tests (no randomness, no DOM measuring: text widths come from
 * textMetrics.ts).
 *
 * The lectures of a map are index cards in rows, in their order (left to right, row by row, as a
 * table of contents reads), the cards of a row of one size; with several exams on one map each exam
 * starts its own rows under its name. Between the rows run bands, and the concepts live there: a
 * concept is put in the band next to its lectures, as close as it can get to the middle of them, so a
 * concept of two neighbouring lectures sits right between them and a concept that runs through the
 * course sits in the middle of the band. Concepts of a single lecture (shown on request) sit in the
 * band next to their card. Words never overlap each other or a card: each takes the free place
 * nearest to where it belongs (candidates ordered by distance, checked against a grid of occupied
 * boxes). The number of cards per row is chosen so that the whole map fits the sheet at the largest
 * scale. Edges are gentle quadratic curves from a word to a card.
 */
import { seedFrom, seededRandom } from '../marks';
import type { MapView } from './model';
import { numberBoxWidth } from './NumberMark';
import { fitText, textWidth, wrapLines } from './textMetrics';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardBox extends Box {
  id: string;
  /** The title as the card sets it (the card clamps to these lines; the full title is in the panel). */
  lines: string[];
  /** Exam questions on the card: rows of question ids and how many did not fit («ещё 3»). */
  questions: QuestionRows;
  hasNote: boolean;
}

export interface QuestionRows {
  rows: string[][];
  rest: number;
}

export interface WordBox extends Box {
  key: string;
  /** The label as drawn (cut with «…» when it is very long). */
  text: string;
  /** Shared by two or more lectures of the map (single-lecture words are drawn quieter). */
  inside: boolean;
}

export interface GroupBox extends Box {
  id: string;
  text: string;
}

export interface Pt2 {
  x: number;
  y: number;
}

export interface EdgeGeo {
  id: string;
  conceptKey: string;
  lectureId: string;
  /** From the word, through the control point, to the card. */
  from: Pt2;
  control: Pt2;
  to: Pt2;
  d: string;
  seed: number;
}

export interface MapLayout {
  width: number;
  height: number;
  cards: CardBox[];
  cardById: Map<string, CardBox>;
  words: WordBox[];
  wordByKey: Map<string, WordBox>;
  groups: GroupBox[];
  edges: EdgeGeo[];
  edgeById: Map<string, EdgeGeo>;
}

/** Card metrics (px at 100 %). The CSS of the card (knowledge.css) uses the same numbers. */
export const CARD = {
  width: 240,
  padTop: 11,
  padBottom: 13,
  padLeft: 12,
  padRight: 14,
  numberCol: 26,
  titleSize: 16,
  titleLine: 21,
  maxTitleLines: 4,
  questionsGap: 5,
  questionsLine: 24,
  noteGap: 3,
  noteLine: 20,
} as const;

/**
 * Concept words: Literata 15 on one line. A word shared by three lectures or more is set at 560, the
 * others at 420; boxes are measured one step heavier (600 / 500), so the text always fits.
 */
export const WORD = {
  size: 15,
  height: 30,
  padX: 8,
  maxWidth: 300,
} as const;

export function wordFont(lectures: number): 'serif500' | 'serif600' {
  return lectures >= 3 ? 'serif600' : 'serif500';
}

const GAP_X = 20;
const WORD_GAP = 6;
const WORD_CARD_GAP = 12;
const MARGIN = 28;
/** A band between two rows of cards: at least this high; rows of words are WORD_ROW apart. */
const BAND_MIN = 92;
const BAND_PAD = 22;
const WORD_ROW = 40;
/** Share of a band's row that words fill in practice (they sit near their lectures, not packed). */
const BAND_FILL = 0.5;
const GROUP_LABEL = 30;

export interface LayoutOptions {
  /** Width to height of the sheet the map is drawn for (default 2.2): the rows follow its shape. */
  aspect?: number;
  /** At most this many cards in a row (a phone: as many as fit its width at full size). */
  maxPerRow?: number;
}

/** How many cards fit side by side in `width` px at full size. */
export function cardsAcross(width: number): number {
  return Math.max(1, Math.floor((width - 2 * MARGIN + GAP_X) / (CARD.width + GAP_X)));
}

export function cardHeight(lines: number, questionRows: number, hasNote: boolean): number {
  return (
    CARD.padTop +
    lines * CARD.titleLine +
    (questionRows > 0 ? CARD.questionsGap + questionRows * CARD.questionsLine : 0) +
    (hasNote ? CARD.noteGap + CARD.noteLine : 0) +
    CARD.padBottom
  );
}

export const CARD_TITLE_WIDTH = CARD.width - CARD.padLeft - CARD.padRight - CARD.numberCol;

/** «вопросы» before the numbers of a card (Onest 14) and the room it takes. */
export const QUESTIONS_LABEL = 'вопросы';
export const QUESTIONS_LABEL_WIDTH = Math.ceil(textWidth(QUESTIONS_LABEL, 'sans400', 14)) + 6;
/** Room kept for «ещё 12» at the end of the last row. */
const MORE_WIDTH = 58;
export const MAX_QUESTION_ROWS = 2;

/**
 * Question numbers in rows of the card's width (at most two rows; the rest is «ещё N»). Computed
 * here, not by the browser, so the card's height is known before it is drawn.
 */
export function packQuestionRows(
  items: Array<{ id: string; number: string }>,
  width = CARD_TITLE_WIDTH - QUESTIONS_LABEL_WIDTH,
  maxRows = MAX_QUESTION_ROWS,
): QuestionRows {
  const rows: string[][] = [[]];
  let used = 0;
  for (let i = 0; i < items.length; i += 1) {
    const w = numberBoxWidth(items[i].number);
    const lastRow = rows.length === maxRows;
    const room = width - (lastRow && i < items.length - 1 ? MORE_WIDTH : 0);
    if (used + w <= room) {
      rows[rows.length - 1].push(items[i].id);
      used += w;
      continue;
    }
    if (!lastRow && rows[rows.length - 1].length > 0) {
      rows.push([]);
      used = 0;
      i -= 1;
      continue;
    }
    return { rows: rows.filter((row) => row.length > 0), rest: items.length - i };
  }
  return { rows: rows.filter((row) => row.length > 0), rest: 0 };
}

/** True when a card has a line of notes (open mistakes, due cards, or no glossary because the lecture is text only). */
export function hasCardNote(lecture: { openMistakes: unknown[]; dueCards: number; textOnly: boolean; termCount: number }): boolean {
  return lecture.openMistakes.length > 0 || lecture.dueCards > 0 || (lecture.textOnly && lecture.termCount === 0);
}

export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** Occupied boxes in a coarse grid: collision tests look only at nearby boxes. */
class Grid {
  private cells = new Map<number, Array<{ box: Box; gap: number }>>();

  constructor(private readonly size = 96) {}

  private static key(gx: number, gy: number): number {
    return (gx + 32768) * 65536 + (gy + 32768);
  }

  /** `gap` is the room this box keeps around itself. */
  add(box: Box, gap: number): void {
    const x0 = Math.floor((box.x - gap) / this.size);
    const x1 = Math.floor((box.x + box.w + gap) / this.size);
    const y0 = Math.floor((box.y - gap) / this.size);
    const y1 = Math.floor((box.y + box.h + gap) / this.size);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const key = Grid.key(gx, gy);
        const list = this.cells.get(key);
        if (list) list.push({ box, gap });
        else this.cells.set(key, [{ box, gap }]);
      }
    }
  }

  hits(box: Box, gap: number): boolean {
    const x0 = Math.floor((box.x - gap) / this.size);
    const x1 = Math.floor((box.x + box.w + gap) / this.size);
    const y0 = Math.floor((box.y - gap) / this.size);
    const y1 = Math.floor((box.y + box.h + gap) / this.size);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const list = this.cells.get(Grid.key(gx, gy));
        if (!list) continue;
        for (const item of list) if (overlaps(box, item.box, Math.max(gap, item.gap))) return true;
      }
    }
    return false;
  }
}

/** Where a straight line from the box's centre towards `target` leaves the box (plus `pad`). */
export function boxExit(box: Box, target: Pt2, pad: number): Pt2 {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = box.w / 2 + pad;
  const hh = box.h / 2 + pad;
  const scale = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function edgeGeometry(id: string, conceptKey: string, lectureId: string, word: Box, card: Box): EdgeGeo {
  const wordCentre = { x: word.x + word.w / 2, y: word.y + word.h / 2 };
  const cardCentre = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
  const from = boxExit(word, cardCentre, 3);
  const to = boxExit(card, wordCentre, 4);
  const seed = seedFrom('km-edge', conceptKey, lectureId);
  const rnd = seededRandom(seed);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bow = (rnd() < 0.5 ? -1 : 1) * length * (0.05 + rnd() * 0.06);
  const control = { x: (from.x + to.x) / 2 + (-dy / length) * bow, y: (from.y + to.y) / 2 + (dx / length) * bow };
  const f = { x: round1(from.x), y: round1(from.y) };
  const c = { x: round1(control.x), y: round1(control.y) };
  const t = { x: round1(to.x), y: round1(to.y) };
  return { id, conceptKey, lectureId, from: f, control: c, to: t, d: `M${f.x} ${f.y}Q${c.x} ${c.y} ${t.x} ${t.y}`, seed };
}

/**
 * Candidate positions round a target: a spiral, stretched sideways because words are wide and bands
 * are low. The first free one wins.
 */
function* spiral(cx: number, cy: number, limit = 6000): Generator<Pt2> {
  yield { x: cx, y: cy };
  for (let j = 1; j < limit; j += 1) {
    const theta = j * 0.42;
    const r = 1.4 * theta;
    yield { x: cx + r * Math.cos(theta) * 2.4, y: cy + r * Math.sin(theta) * 0.8 };
  }
}

interface CardSize {
  id: string;
  lines: string[];
  questions: QuestionRows;
  hasNote: boolean;
  w: number;
  h: number;
}

interface WordSize {
  key: string;
  text: string;
  w: number;
  h: number;
  lectureIds: string[];
  inside: boolean;
}

interface RowPlan {
  groupId: string;
  ids: string[];
  /** The first row of its group (its name goes above it when the map has several groups). */
  first: boolean;
}

/** A group's lectures in rows of at most `perRow`, as even as possible (9 → 5 + 4). */
function planRows(groups: Array<{ id: string; lectureIds: string[] }>, perRow: number): RowPlan[] {
  const rows: RowPlan[] = [];
  for (const group of groups) {
    const total = group.lectureIds.length;
    if (!total) continue;
    const count = Math.ceil(total / perRow);
    const size = Math.ceil(total / count);
    for (let start = 0, index = 0; start < total; start += size, index += 1) {
      rows.push({ groupId: group.id, ids: group.lectureIds.slice(start, start + size), first: index === 0 });
    }
  }
  return rows;
}

/**
 * The band a word lives in: between the rows of its lectures, or next to their row — the band
 * inside the same exam's rows when there is one (band r runs under row r).
 */
function bandOf(rowsOfWord: number[], rows: RowPlan[]): number {
  const count = rows.length;
  if (count <= 1) return 0;
  const low = Math.min(...rowsOfWord);
  const high = Math.max(...rowsOfWord);
  if (low !== high) return Math.min(count - 2, Math.floor((low + high - 1) / 2));
  const above = low > 0 && rows[low - 1].groupId === rows[low].groupId;
  const below = low < count - 1 && rows[low + 1].groupId === rows[low].groupId;
  if (below || (!above && low < count - 1)) return low;
  return low - 1;
}

interface Plan {
  rows: RowPlan[];
  bands: number[];
  bandOfWord: Map<string, number>;
  width: number;
  height: number;
  rowHeights: number[];
  labelAbove: number[];
}

function makePlan(perRow: number, groups: Array<{ id: string; lectureIds: string[] }>, cards: Map<string, CardSize>, words: WordSize[], multiGroup: boolean): Plan {
  const rows = planRows(groups, perRow);
  const rowOf = new Map<string, number>();
  rows.forEach((row, index) => row.ids.forEach((id) => rowOf.set(id, index)));
  const widest = rows.reduce((max, row) => Math.max(max, row.ids.length), 0);
  const innerWidth = widest * CARD.width + (widest - 1) * GAP_X;
  const bandCount = Math.max(1, rows.length - 1);
  const load = new Array<number>(bandCount).fill(0);
  const bandOfWord = new Map<string, number>();
  for (const word of words) {
    const lectureRows = word.lectureIds.map((id) => rowOf.get(id)).filter((row): row is number => row !== undefined);
    if (!lectureRows.length) continue;
    const band = bandOf(lectureRows, rows);
    bandOfWord.set(word.key, band);
    load[band] += word.w + 2 * WORD_GAP + 8;
  }
  const labelAbove = rows.map((row, index) => (multiGroup && row.first ? GROUP_LABEL : 0) + (index === 0 ? 0 : 0));
  const bands = load.map((total, index) => {
    const wordRows = total > 0 ? Math.ceil(total / Math.max(1, innerWidth * BAND_FILL)) : 0;
    const height = Math.max(BAND_MIN, wordRows * WORD_ROW + 2 * BAND_PAD);
    // A band under the last row exists only for a single row (its concepts go there).
    return rows.length <= 1 && total === 0 && index === 0 ? 0 : height;
  });
  const rowHeights = rows.map((row) => row.ids.reduce((max, id) => Math.max(max, cards.get(id)?.h ?? 0), 0));
  const height =
    2 * MARGIN +
    rowHeights.reduce((sum, h) => sum + h, 0) +
    labelAbove.reduce((sum, h) => sum + h, 0) +
    (rows.length > 1 ? bands.reduce((sum, h) => sum + h, 0) : bands[0] ?? 0);
  return { rows, bands, bandOfWord, width: innerWidth + 2 * MARGIN, height, rowHeights, labelAbove };
}

export function layoutMap(view: MapView, options: LayoutOptions = {}): MapLayout {
  const aspect = Math.min(3.2, Math.max(0.5, options.aspect ?? 2.2));
  // ---- sizes
  const cardSizes: CardSize[] = view.lectures.map((lecture) => {
    const wrapped = wrapLines(lecture.title, CARD_TITLE_WIDTH, 'serif600', CARD.titleSize);
    const lines = wrapped.slice(0, CARD.maxTitleLines);
    const questions = packQuestionRows(lecture.questions.map((question) => ({ id: question.id, number: question.number })));
    const hasNote = hasCardNote(lecture);
    return { id: lecture.id, lines, questions, hasNote, w: CARD.width, h: cardHeight(lines.length, questions.rows.length, hasNote) };
  });
  const cardSize = new Map(cardSizes.map((card) => [card.id, card]));
  const wordSizes: WordSize[] = view.concepts.map((concept) => {
    const font = wordFont(concept.lectureIds.length);
    const text = fitText(concept.label, WORD.maxWidth - 2 * WORD.padX, font, WORD.size);
    return {
      key: concept.key,
      text,
      w: Math.ceil(textWidth(text, font, WORD.size) + 2 * WORD.padX),
      h: WORD.height,
      lectureIds: concept.lectureIds,
      inside: concept.lectureIds.length >= 2,
    };
  });
  const groups = view.groups.filter((group) => group.lectureIds.length > 0);
  const multiGroup = groups.length > 1;
  const empty: MapLayout = { width: 0, height: 0, cards: [], cardById: new Map(), words: [], wordByKey: new Map(), groups: [], edges: [], edgeById: new Map() };
  if (cardSizes.length === 0) return empty;

  // ---- how many cards per row: the plan that fits a sheet of this shape at the largest scale
  const largestGroup = groups.reduce((max, group) => Math.max(max, group.lectureIds.length), 1);
  const widest = Math.max(1, Math.min(largestGroup, options.maxPerRow ?? largestGroup));
  let plan: Plan | null = null;
  let bestScale = -1;
  for (let perRow = 1; perRow <= widest; perRow += 1) {
    const candidate = makePlan(perRow, groups, cardSize, wordSizes, multiGroup);
    const scale = Math.min((aspect * 1000) / candidate.width, 1000 / candidate.height);
    if (scale > bestScale + 1e-9) {
      bestScale = scale;
      plan = candidate;
    }
  }
  const { rows, bands, bandOfWord, rowHeights, labelAbove } = plan!;
  const innerWidth = plan!.width - 2 * MARGIN;

  // ---- cards: rows centred; the first row hugs the band under it, the last the band above it
  const cards: CardBox[] = [];
  const groupBoxes: GroupBox[] = [];
  const bandTop: number[] = [];
  let y = MARGIN;
  rows.forEach((row, index) => {
    if (labelAbove[index]) {
      const group = groups.find((item) => item.id === row.groupId);
      const rowWidth = row.ids.length * CARD.width + (row.ids.length - 1) * GAP_X;
      const x0 = MARGIN + (innerWidth - rowWidth) / 2;
      const text = fitText(group?.label ?? '', Math.max(120, rowWidth), 'sans500', 15);
      groupBoxes.push({ id: row.groupId, text, x: x0, y: y + 2, w: Math.ceil(textWidth(text, 'sans500', 15) + 4), h: 24 });
      y += labelAbove[index];
    }
    const rowWidth = row.ids.length * CARD.width + (row.ids.length - 1) * GAP_X;
    const x0 = MARGIN + (innerWidth - rowWidth) / 2;
    const height = rowHeights[index];
    // Index cards of a row are one size: the tallest card's height.
    row.ids.forEach((id, column) => {
      const size = cardSize.get(id)!;
      cards.push({ id, lines: size.lines, questions: size.questions, hasNote: size.hasNote, x: x0 + column * (CARD.width + GAP_X), y, w: size.w, h: height });
    });
    y += height;
    if (index < rows.length - 1 || rows.length === 1) {
      bandTop.push(y);
      y += bands[Math.min(index, bands.length - 1)] ?? 0;
    }
  });
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const rowOf = new Map<string, number>();
  rows.forEach((row, index) => row.ids.forEach((id) => rowOf.set(id, index)));

  const grid = new Grid();
  for (const card of cards) grid.add(card, WORD_CARD_GAP);
  for (const group of groupBoxes) grid.add(group, WORD_GAP);

  // Offsets round a target, nearest first; moving sideways costs less than up or down (bands are low).
  // Beyond this reach a word takes the spiral's first free place.
  const reachX = Math.min(innerWidth, 1100);
  const reachY = Math.min(bands.reduce((max, h) => Math.max(max, h), 0), 240);
  const offsets: Array<[number, number, number]> = [];
  for (let dx = -reachX; dx <= reachX; dx += 7) {
    for (let dy = -reachY; dy <= reachY; dy += 5) offsets.push([dx, dy, Math.abs(dx) + 2.4 * Math.abs(dy)]);
  }
  offsets.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);

  function place(w: number, h: number, target: Pt2, area: Box): Box;
  function place(w: number, h: number, target: Pt2, area: Box, onlyArea: true): Box | null;
  function place(w: number, h: number, target: Pt2, area: Box, onlyArea = false): Box | null {
    for (const [dx, dy] of offsets) {
      const x = target.x + dx;
      const y = target.y + dy;
      if (x - w / 2 < area.x || x + w / 2 > area.x + area.w || y - h / 2 < area.y || y + h / 2 > area.y + area.h) continue;
      const box = { x: x - w / 2, y: y - h / 2, w, h };
      if (!grid.hits(box, WORD_GAP)) return box;
    }
    if (onlyArea) return null;
    // The band is full: the nearest free place anywhere.
    for (const p of spiral(target.x, target.y)) {
      const box = { x: p.x - w / 2, y: p.y - h / 2, w, h };
      if (!grid.hits(box, WORD_GAP)) return box;
    }
    return { x: target.x - w / 2, y: target.y - h / 2, w, h };
  }

  // ---- words: the most connected first, each in its band near the middle of its lectures
  const order = [...wordSizes].sort((a, b) => b.lectureIds.length - a.lectureIds.length);
  const words: WordBox[] = [];
  for (const word of order) {
    const band = bandOfWord.get(word.key);
    if (band === undefined) continue;
    const top = bandTop[Math.min(band, bandTop.length - 1)];
    const height = bands[Math.min(band, bands.length - 1)];
    const centres = word.lectureIds.map((id) => cardById.get(id)).filter((card): card is CardBox => Boolean(card)).map((card) => card.x + card.w / 2);
    const above = word.lectureIds.filter((id) => (rowOf.get(id) ?? 0) <= band).length;
    const below = word.lectureIds.length - above;
    const room = Math.max(0, height / 2 - WORD.height / 2 - BAND_PAD / 2);
    const lean = rows.length === 1 ? -1 : (below - above) / Math.max(1, above + below);
    const target = {
      x: Math.min(MARGIN + innerWidth - word.w / 2, Math.max(MARGIN + word.w / 2, centres.reduce((sum, x) => sum + x, 0) / Math.max(1, centres.length))),
      y: top + height / 2 + lean * room * 0.7,
    };
    // A word of lectures on one side of the band keeps to that side's half first.
    const full = { x: MARGIN - 8, y: top + 6, w: innerWidth + 16, h: height - 12 };
    const half =
      above === 0 || below === 0
        ? { ...full, y: above === 0 ? top + height * 0.4 : full.y, h: height * 0.6 - 6 }
        : null;
    const box = half && half.h >= word.h ? place(word.w, word.h, target, half, true) ?? place(word.w, word.h, target, full) : place(word.w, word.h, target, full);
    grid.add(box, WORD_GAP);
    words.push({ key: word.key, text: word.text, inside: word.inside, ...box });
  }

  // ---- bounds: everything moves so that the top-left corner is at (MARGIN, MARGIN)
  const all: Box[] = [...cards, ...words, ...groupBoxes];
  const minX = Math.min(...all.map((box) => box.x));
  const minY = Math.min(...all.map((box) => box.y));
  const maxX = Math.max(...all.map((box) => box.x + box.w));
  const maxY = Math.max(...all.map((box) => box.y + box.h));
  for (const box of all) {
    box.x = round1(box.x - minX + MARGIN);
    box.y = round1(box.y - minY + MARGIN);
  }
  const wordByKey = new Map(words.map((word) => [word.key, word]));

  const edges: EdgeGeo[] = [];
  for (const edge of view.edges) {
    const word = wordByKey.get(edge.conceptKey);
    const card = cardById.get(edge.lectureId);
    if (!word || !card) continue;
    edges.push(edgeGeometry(edge.id, edge.conceptKey, edge.lectureId, word, card));
  }

  return {
    width: Math.ceil(maxX - minX + 2 * MARGIN),
    height: Math.ceil(maxY - minY + 2 * MARGIN),
    cards,
    cardById,
    words,
    wordByKey,
    groups: groupBoxes,
    edges,
    edgeById: new Map(edges.map((edge) => [edge.id, edge])),
  };
}
