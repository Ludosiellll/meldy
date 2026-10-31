/**
 * A number question in the class game (20261102090100_live_numbers.sql, CONTRACT §3, §15): how a number is said on the
 * screens, the right answer with its tolerance and unit, what the phone's keypad may type, and the projector's number
 * line (where the class's answers fell, the right value and its band). Pure: the screens draw what these return.
 * Grading is the server's (public.meldy_number_right, its twin lib/kinds/number.ts); nothing here grades.
 */
import { numberRight, typedNumber } from '../kinds/number';
import type { NumberSpread } from './types';

const MINUS = '−';
/** Between thousands: a narrow no-break space («12 500»), as Russian typography sets numbers of five digits and more. */
const THIN = ' ';
const NBSP = ' ';

/** A JavaScript number as plain decimal digits (no exponent: 1e-7 → «0.0000001»). */
export function plainDecimal(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * A number as the room reads it: «3,14», «−12», «12 500», «1 000 000,5». From a canonical decimal («-1000000.5»), a
 * JSON number (a tolerance) or the keypad's text («-12,5»); anything that is no number comes back as it was.
 */
export function numberText(value: string | number): string {
  const raw = typeof value === 'number' ? plainDecimal(value) : value.trim();
  const m = /^([+\-−]?)(\d*)(?:[.,](\d*))?$/.exec(raw);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return raw;
  const negative = m[1] === '-' || m[1] === MINUS;
  const whole = m[2] === '' ? '0' : m[2];
  const grouped = whole.length >= 5 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, THIN) : whole;
  const fraction = m[3];
  return `${negative ? MINUS : ''}${grouped}${fraction !== undefined && fraction !== '' ? `,${fraction}` : fraction === '' ? ',' : ''}`;
}

/** «42 м», «9,8 или 9,81 м/с²», «100 ± 25 °C»: the accepted numbers, the tolerance when there is one, the unit. */
export function numberAnswer(forms: readonly string[] | null | undefined, tolerance: number | string | null | undefined, unit: string | null | undefined): string {
  const values = (forms ?? []).map(numberText);
  const tol = tolerance === null || tolerance === undefined || Number(tolerance) === 0 ? null : numberText(tolerance);
  const u = unit ? `${NBSP}${unit}` : '';
  return `${values.join(' или ')}${tol ? `${NBSP}±${NBSP}${tol}` : ''}${u}`;
}

/** A typed answer with the unit after it («12,5 м»), as the phone and the review show it. */
export function typedText(typed: string, unit: string | null | undefined): string {
  return `${numberText(typed)}${unit ? `${NBSP}${unit}` : ''}`;
}

// ─────────────────────────────────────────── the keypad ───────────────────────────────────────────

/** The longest text the keypad builds (a number rule's limit is 40 characters; nobody needs more than this). */
export const PAD_MAX = 16;

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | '-' | 'back';

/**
 * The keypad's text after one key: digits, one comma (a first comma writes «0,»), «−» turns the sign over, «⌫»
 * takes the last character. The text is never longer than PAD_MAX.
 */
export function padPress(text: string, key: PadKey): string {
  if (key === 'back') return text.slice(0, -1);
  if (key === '-') return text.startsWith('-') ? text.slice(1) : `-${text}`;
  if (text.replace('-', '').length >= PAD_MAX) return text;
  if (key === ',') {
    if (text.includes(',')) return text;
    return /\d$/.test(text) ? `${text},` : `${text}0,`;
  }
  return `${text}${key}`;
}

/** The keypad's text as a key of a hardware keyboard would type it (null: not a key of the pad). */
export function padKeyOf(key: string): PadKey | null {
  if (/^[0-9]$/.test(key)) return key as PadKey;
  if (key === ',' || key === '.') return ',';
  if (key === '-' || key === MINUS) return '-';
  if (key === 'Backspace') return 'back';
  return null;
}

/** Whether the keypad's text is a number the server reads (a sign or a comma alone is not). */
export function padReady(text: string): boolean {
  return /\d/.test(text) && typedNumber(text, null) !== null;
}

// ─────────────────────────────────────────── the number line ───────────────────────────────────────────

export interface LineDot {
  /** The value (canonical text) and its place on the line, 0..1. */
  value: string;
  x: number;
  n: number;
  /** Within the tolerance of a right value. */
  ok: boolean;
}

export interface NumberLineView {
  min: number;
  max: number;
  ticks: Array<{ x: number; label: string }>;
  /** Each right value: its place and its band (the tolerance) on the line, 0..1. */
  rights: Array<{ x: number; from: number; to: number; label: string }>;
  dots: LineDot[];
  /** Answers off the line to the left and to the right (outliers), by count. */
  below: number;
  above: number;
  /** The largest count of one value (the dots' scale). */
  top: number;
}

const STEPS = [1, 2, 2.5, 5];

/** A round step that cuts `span` into about `want` parts. */
function niceStep(span: number, want: number): number {
  const raw = span / want;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const s of STEPS) if (s * p >= raw) return s * p;
  return 10 * p;
}

/** The value at share `q` (0..1) of a sorted list weighted by counts. */
function quantile(sorted: Array<{ v: number; n: number }>, q: number): number {
  const total = sorted.reduce((s, d) => s + d.n, 0);
  let seen = 0;
  for (const d of sorted) {
    seen += d.n;
    if (seen >= q * total) return d.v;
  }
  return sorted[sorted.length - 1].v;
}

/**
 * The projector's number line: the right values with their bands always on it, the class's answers around them. The
 * line covers the bands and the middle 80 % of the answers (by count), with a margin: a few wild answers do not squash
 * the rest; they are counted at the ends instead (`below`, `above`). Ticks fall on round values.
 */
export function numberLine(forms: readonly string[], tolerance: number | string | null | undefined, spread: NumberSpread | null | undefined): NumberLineView | null {
  const rights = forms.map(Number).filter((v) => Number.isFinite(v));
  if (rights.length === 0) return null;
  const tol = Math.max(0, Number(tolerance ?? 0) || 0);
  const answers = (spread ?? [])
    .map(([text, n]) => ({ text, v: Number(text), n }))
    .filter((d) => Number.isFinite(d.v) && Number.isInteger(d.n) && d.n > 0)
    .sort((a, b) => a.v - b.v);
  let lo = Math.min(...rights) - tol;
  let hi = Math.max(...rights) + tol;
  if (answers.length > 0) {
    lo = Math.min(lo, quantile(answers, 0.1));
    hi = Math.max(hi, quantile(answers, 0.9));
  }
  if (hi - lo <= 0) {
    const half = Math.max(1, Math.abs(lo) * 0.2);
    lo -= half;
    hi += half;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const step = niceStep(hi - lo, 6);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const at = (v: number) => (v - min) / (max - min);
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks: NumberLineView['ticks'] = [];
  for (let v = min, i = 0; v <= max + step / 2 && i < 40; v = min + ++i * step) {
    ticks.push({ x: at(v), label: numberText(plainDecimal(Number(v.toFixed(Math.min(20, decimals + 2))))) });
  }
  // exact, as the server: |1.1 − 1| ≤ 0.1 in doubles is false
  const near = (text: string) => numberRight(text, forms, tolerance ?? null, null);
  let below = 0;
  let above = 0;
  const dots: LineDot[] = [];
  for (const d of answers) {
    if (d.v < min) below += d.n;
    else if (d.v > max) above += d.n;
    else dots.push({ value: d.text, x: at(d.v), n: d.n, ok: near(d.text) });
  }
  return {
    min,
    max,
    ticks,
    rights: rights.map((r, i) => ({ x: at(r), from: at(r - tol), to: at(r + tol), label: numberText(forms[i]) })),
    dots,
    below,
    above,
    top: Math.max(1, ...answers.map((d) => d.n)),
  };
}
