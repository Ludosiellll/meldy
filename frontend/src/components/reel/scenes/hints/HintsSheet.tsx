/**
 * The cheat sheet's look in chapter 04 — the design decided on 2026-10-10: a list in Meldy's own style (Onest
 * question titles, a dot for a main point, a dash for a detail); a line named once has a yellow dot and muted words,
 * an erased one is faint and struck through; beside it the count of lines left and a map, one rounded square per line
 * (ink — left, yellow — named once, an outline — erased).
 *
 * Only this file and hints.css draw the sheet: the scene (../Hints.tsx) places it and the model (./model.ts) says what
 * every line is at every moment. Another design replaces these two files and keeps the story.
 */
import { useRef } from 'react';
import { ORAL, SUBJECTS } from '../../content';
import { opacity, put, text as setText, useEls, useFrame } from '../../engine';
import { Roller } from '../../parts';
import { clamp, ease, mix, pulse, seg } from '../../timeline';
import { LIST, MOVE_MS, SECOND_AT, SECOND_DAY_AT, SHEET_AT, STROKE_MS, TOTAL_LINES, countsOf, dayLabel, firstIndex, mapAt, type LineFrame } from './model';
import './hints.css';

const INK = [11, 18, 28];
const MUTED = [75, 81, 91];
const FAINT = [138, 143, 151];
const YELLOW = [233, 177, 60];

const rgb = (a: readonly number[], b: readonly number[], p: number) =>
  `rgb(${Math.round(mix(a[0], b[0], p))},${Math.round(mix(a[1], b[1], p))},${Math.round(mix(a[2], b[2], p))})`;

/** The map: squares of 8 px every 11 px, as many columns as its width holds. */
export const MAP_BOX = { width: 420, cell: 8, pitch: 11 } as const;
const COLS = Math.floor((MAP_BOX.width + MAP_BOX.pitch - MAP_BOX.cell) / MAP_BOX.pitch);
const ROWS = Math.ceil(TOTAL_LINES / COLS);
export const MAP_HEIGHT = ROWS * MAP_BOX.pitch - (MAP_BOX.pitch - MAP_BOX.cell);

/** «строка осталась», «строки осталось», «строк осталось» after the count. */
const NOUNS = ['строка осталась', 'строки осталось', 'строк осталось'] as const;
function nounOf(n: number): number {
  const a = n % 100;
  const b = n % 10;
  if (a >= 11 && a <= 14) return 2;
  if (b === 1) return 0;
  if (b >= 2 && b <= 4) return 1;
  return 2;
}

/** A stroke over the line (s 0 → 1), then the line settles in its new state (u 0 → 1). */
function phases(frame: LineFrame) {
  if (!frame.move) return { s: 1, u: 1 };
  const t = frame.p * MOVE_MS;
  return { s: ease.inOut(clamp(t / STROKE_MS)), u: ease.brand(clamp((t - STROKE_MS) / (MOVE_MS - STROKE_MS))) };
}

interface LineEls {
  txt?: HTMLElement;
  strike?: HTMLElement;
  ink?: HTMLElement;
  yellow?: HTMLElement;
}

/** Paints one line of the list for its frame. Colours and opacity only: nothing is laid out again. */
function paintLine(frame: LineFrame, { txt, strike, ink, yellow }: LineEls) {
  const { s, u } = phases(frame);
  if (frame.state === 'left') {
    put(txt, 'color', rgb(INK, INK, 0));
    opacity(txt, 1);
    opacity(ink, 1);
    opacity(yellow, 0);
    opacity(strike, 0);
    return;
  }
  if (frame.state === 'half') {
    // Named once: a stroke runs over the line and lifts; the words go muted, the dot turns yellow.
    put(txt, 'color', rgb(INK, MUTED, u));
    opacity(txt, 1);
    opacity(ink, 1 - u);
    opacity(yellow, u);
    put(yellow, 'transform', `scale(${(1 + 0.6 * Math.sin(Math.PI * u)).toFixed(3)})`);
    put(strike, 'clip-path', `inset(-30% ${((1 - s) * 100).toFixed(2)}% -30% 0)`);
    opacity(strike, frame.move ? 1 - u : 0);
    return;
  }
  // Erased: the stroke runs over the line and stays; the words under it give way to the struck ghost.
  put(strike, 'clip-path', `inset(-30% ${((1 - s) * 100).toFixed(2)}% -30% 0)`);
  opacity(strike, 1);
  put(txt, 'color', rgb(MUTED, MUTED, 0));
  opacity(txt, 1 - u);
  opacity(ink, 0);
  opacity(yellow, frame.move ? 1 - u : 0);
  put(yellow, 'transform', 'scale(1)');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** The squares of question 12's named lines: ringed in blue while they are answered, and they pop as they change. */
const HOT = new Set(ORAL.points.flatMap((point, line) => (point.namedAfter !== null ? [firstIndex(ORAL.number) + line] : [])));

/** Where square `i` sits on the map (before the canvas's 4 px margin). */
const cellX = (i: number) => (i % COLS) * MAP_BOX.pitch;
const cellY = (i: number) => Math.floor(i / COLS) * MAP_BOX.pitch;

/** Draws one square for its line's frame (and the blue ring of a square of question 12). */
export function drawCell(ctx: CanvasRenderingContext2D, i: number, frame: LineFrame, ring: number) {
  const { cell } = MAP_BOX;
  const x = cellX(i);
  const y = cellY(i);
  const { u } = phases(frame);
  const hot = HOT.has(i);
  const pop = hot && frame.move ? 1 + 0.55 * Math.sin(Math.PI * clamp(frame.p * 1.3)) : 1;
  const size = cell * pop;
  const ox = x + (cell - size) / 2;
  const oy = y + (cell - size) / 2;
  if (frame.state !== 'gone') {
    ctx.globalAlpha = 1;
    ctx.fillStyle = frame.state === 'left' ? rgb(INK, INK, 0) : frame.move ? rgb(INK, YELLOW, u) : rgb(YELLOW, YELLOW, 0);
    roundRect(ctx, ox, oy, size, size, 2.6 * pop);
    ctx.fill();
  } else {
    // Erased: an outline; while it goes, the yellow fades out of it.
    if (frame.move) {
      ctx.globalAlpha = 1 - u;
      ctx.fillStyle = rgb(YELLOW, YELLOW, 0);
      roundRect(ctx, ox, oy, size, size, 2.6 * pop);
      ctx.fill();
    }
    ctx.globalAlpha = 0.5 * (frame.move ? u : 1);
    ctx.strokeStyle = rgb(FAINT, FAINT, 0);
    ctx.lineWidth = 1.5;
    roundRect(ctx, ox + 0.75, oy + 0.75, size - 1.5, size - 1.5, 2.2 * pop);
    ctx.stroke();
  }
  if (hot && ring > 0) {
    ctx.globalAlpha = ring;
    ctx.strokeStyle = '#2869dd';
    ctx.lineWidth = 2;
    roundRect(ctx, x - 3.5, y - 3.5, cell + 7, cell + 7, 4.5);
    ctx.stroke();
  }
}

/**
 * What a square looks like at a frame, as one number: everything drawCell paints follows from it (and from the ring, for
 * the squares of question 12). A square at rest is its state; a moving one changes with every frame.
 */
export function cellLook(frame: LineFrame): number {
  const state = frame.state === 'left' ? 0 : frame.state === 'half' ? 1 : 2;
  return frame.move ? (state + 1) * 10 + frame.p : state;
}

/**
 * The area a square paints in: its own 8 px with a pixel around it (the 3 px gap keeps neighbours apart); a square of
 * question 12 reaches 5 px further, with its pop (×1.55) and its ring.
 */
export function cellBox(i: number): { x: number; y: number; w: number; h: number } {
  const reach = HOT.has(i) ? 5 : 1;
  return { x: cellX(i) - reach, y: cellY(i) - reach, w: MAP_BOX.cell + 2 * reach, h: MAP_BOX.cell + 2 * reach };
}

const meets = (a: ReturnType<typeof cellBox>, b: ReturnType<typeof cellBox>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Past this many changed squares a frame draws the whole map (the wave while the days run by). */
const WHOLE_MAP_FROM = TOTAL_LINES / 3;

/**
 * The squares to draw again: those whose look changed since the last frame drawn, and every square whose area reaches
 * into theirs (only the neighbours of a square of question 12 do). Null: the whole map.
 */
export function squaresToDraw(looks: Float64Array, before: Float64Array | null, ring: number, ringBefore: number): { changed: number[]; draw: number[] } | null {
  if (!before) return null;
  const changed: number[] = [];
  for (let i = 0; i < looks.length; i += 1) {
    if (looks[i] !== before[i] || (ring !== ringBefore && HOT.has(i))) changed.push(i);
  }
  if (changed.length > WHOLE_MAP_FROM) return null;
  const marked = new Uint8Array(looks.length);
  for (const i of changed) {
    const box = cellBox(i);
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    for (let r = row - 1; r <= row + 1; r += 1) {
      for (let c = col - 1; c <= col + 1; c += 1) {
        const j = r * COLS + c;
        if (c < 0 || c >= COLS || r < 0 || j >= looks.length || marked[j]) continue;
        if (j === i || meets(cellBox(j), box)) marked[j] = 1;
      }
    }
  }
  const draw: number[] = [];
  for (let j = 0; j < marked.length; j += 1) if (marked[j]) draw.push(j);
  return { changed, draw };
}

/**
 * Draws the map for the frames of the lines. Only the squares that changed since the last frame are drawn again,
 * clipped to their areas and in the map's order, so the canvas ends up as a whole redraw would leave it: the map used to
 * draw all its 898 squares on every frame of the chapter (7–14 ms a frame on a phone, measurement 2026-10-19), and a
 * frame where nothing changed now leaves the canvas as it is.
 */
function drawMap(ctx: CanvasRenderingContext2D, frames: readonly LineFrame[], ring: number, last: { looks: Float64Array | null; ring: number }) {
  const looks = new Float64Array(frames.length);
  for (let i = 0; i < frames.length; i += 1) looks[i] = cellLook(frames[i]);
  const plan = squaresToDraw(looks, last.looks, ring, last.ring);
  last.looks = looks;
  last.ring = ring;
  if (plan && plan.changed.length === 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (!plan) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.translate(4, 4);
    for (let i = 0; i < frames.length; i += 1) drawCell(ctx, i, frames[i], ring);
    return;
  }
  ctx.translate(4, 4);
  ctx.save();
  ctx.beginPath();
  for (const i of plan.changed) {
    const box = cellBox(i);
    ctx.rect(box.x, box.y, box.w, box.h);
  }
  ctx.clip();
  for (const i of plan.changed) {
    const box = cellBox(i);
    ctx.clearRect(box.x, box.y, box.w, box.h);
  }
  for (const i of plan.draw) drawCell(ctx, i, frames[i], ring);
  ctx.restore();
}

const IN_JSDOM = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

/** The map on its own canvas inside the side card (it moves with the card). */
function MapCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  /** What the canvas holds: every square's look and the ring, as last drawn. */
  const last = useRef<{ looks: Float64Array | null; ring: number }>({ looks: null, ring: 0 });
  useFrame((l) => {
    if (IN_JSDOM || !canvas.current) return;
    if (!context.current) context.current = canvas.current.getContext('2d');
    const ctx = context.current;
    // Drawn from just before the sheet shows (it is hidden under the answer until then).
    if (!ctx || l < SHEET_AT - 200) return;
    const ring = seg(l, SHEET_AT + 200, 300) * (1 - seg(l, SECOND_AT + MOVE_MS + 400, 400));
    drawMap(ctx, mapAt(l), ring, last.current);
  });
  return <canvas ref={canvas} className="mr-h-canvas" width={MAP_BOX.width + 8} height={MAP_HEIGHT + 8} aria-hidden="true" />;
}

const ORAL_QUESTIONS = SUBJECTS[3].oral;
const LIST_LINES = LIST.flatMap((question) => question.lines.map((line, index) => ({ question: question.number, index, line })));

export default function HintsSheet() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);

  useFrame((l) => {
    const frames = mapAt(l);
    const counts = countsOf(frames);

    // The list: each line as the model has it.
    const txts = all('txt');
    const strikes = all('strike');
    const inks = all('ink');
    const yellows = all('yellow');
    LIST_LINES.forEach((entry, k) => {
      paintLine(frames[firstIndex(entry.question) + entry.index], { txt: txts[k], strike: strikes[k], ink: inks[k], yellow: yellows[k] });
    });

    // Question 12 is lit while it is answered.
    opacity(one('focus'), seg(l, SHEET_AT + 150, 350) * (1 - seg(l, SECOND_AT + MOVE_MS + 500, 500)));

    // The day: it turns to another day, then runs to the exam.
    setText(one('day'), dayLabel(l));
    const turn = pulse(l, SECOND_DAY_AT - 40, 460);
    put(one('day-chip'), 'transform', `scale(${(1 + 0.12 * turn).toFixed(3)})`);
    opacity(one('day-hl'), turn);

    // The count: lines left, its noun in three forms shown by opacity (so nothing is laid out again).
    const form = nounOf(counts.left);
    all('noun').forEach((noun, index) => opacity(noun, index === form ? 1 : 0));
    setText(one('gone'), String(counts.gone));
    setText(one('half'), String(counts.half));
  });

  return (
    <div ref={root} className="mr-layer">
      <div data-a="list" className="mr-card mr-h-list">
        <div className="mr-h-top">
          <span className="mr-h-seg">
            <b>Шпаргалка</b>
            <span>Вопросы</span>
          </span>
          <span data-a="day-chip" className="mr-h-day">
            <i data-a="day-hl" className="mr-h-day-hl" style={{ opacity: 0 }} />
            <span data-a="day">{dayLabel(0)}</span>
          </span>
        </div>
        {LIST.map((question) => (
          <div key={question.number} className="mr-h-q">
            {question.number === ORAL.number ? <span data-a="focus" className="mr-h-focus" style={{ opacity: 0 }} /> : null}
            <p className="mr-h-qt">
              <b>{question.number}.</b>
              <span>{question.title}</span>
            </p>
            {question.lines.map((line) => (
              <div key={line.text} className={`mr-h-l${line.main ? '' : ' mr-h-l--detail'}`}>
                <span className="mr-h-mark">
                  <i data-a="ink" />
                  <i data-a="yellow" className="mr-h-y" style={{ opacity: 0 }} />
                </span>
                <span className="mr-h-tx">
                  <span data-a="txt">{line.text}</span>
                  <span data-a="strike" className="mr-h-strike" style={{ opacity: 0 }}>
                    {line.text}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div data-a="side" className="mr-card mr-h-side">
        <span className="mr-h-tag">Шпаргалка</span>
        <div className="mr-h-count">
          <b>
            <Roller value={(l) => countsOf(mapAt(l)).left} digits={3} />
          </b>
          <span className="mr-h-noun">
            {NOUNS.map((noun) => (
              <span key={noun} data-a="noun" style={{ opacity: 0 }}>
                {noun} из {TOTAL_LINES}
              </span>
            ))}
          </span>
        </div>
        <p className="mr-h-sub">
          стёрто <span data-a="gone">0</span> · названо один раз <span data-a="half">0</span> · {ORAL_QUESTIONS} вопросов
        </p>
        <div className="mr-h-map">
          <MapCanvas />
        </div>
        <div className="mr-h-legend">
          <span>
            <i />
            осталось
          </span>
          <span>
            <i className="mr-h-y" />
            названо один раз
          </span>
          <span>
            <i className="mr-h-o" />
            стёрто
          </span>
        </div>
      </div>
    </div>
  );
}
