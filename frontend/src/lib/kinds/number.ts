/**
 * The number rule (docs/kinds/CONTRACT.md §1.1): the TypeScript twin of public.meldy_number_right. The shared cases are
 * contracts/kinds/number_vectors.json; the arithmetic is exact (BigInt decimals), as the server's numeric is — a double
 * would make |1.1 − 1| ≤ 0.1 false.
 */
import { shortNorm } from './norm';

/** The whitespace the rule removes: meldy_short_norm's set. */
/** meldy_short_norm's whitespace: \t \n \v \f \r, space, U+00A0, U+1680, U+2000–U+200B, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. */
const SPACE_CHARS = String.fromCharCode(0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680) + `${String.fromCharCode(0x2000)}-${String.fromCharCode(0x200b)}` +
  String.fromCharCode(0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff);
const SPACE = new RegExp(`[${SPACE_CHARS}]+`, 'g');
const TYPED = /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/;
/** An accepted number as stored: an optional minus, digits, an optional fraction. */
export const CANONICAL_NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;
export const NUMBER_MAX_CHARS = 40;

interface Decimal {
  units: bigint; // the value × 10^scale
  scale: number;
}

function decimal(text: string): Decimal {
  let t = text;
  let negative = false;
  if (t.startsWith('+') || t.startsWith('-')) {
    negative = t.startsWith('-');
    t = t.slice(1);
  }
  const [whole, fraction = ''] = t.split('.');
  const digits = `${whole || '0'}${fraction}`;
  const units = BigInt(digits);
  return { units: negative ? -units : units, scale: fraction.length };
}

function scaled(value: Decimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

/** The rule's text: whitespace removed, «,» → «.», «−» → «-», then meldy_short_norm. */
function clean(text: string): string {
  return shortNorm(text.replace(SPACE, '').replace(/,/g, '.').replace(/−/g, '-'));
}

/** What is left of a typed answer once the unit is cut off: the number's text, or null when it is not a number. */
export function typedNumber(text: string, unit: string | null): string | null {
  if (text.length > 1000) return null;
  let t = clean(text);
  if (unit !== null) {
    const u = clean(unit);
    if (u !== '' && t.length > u.length && t.endsWith(u)) t = t.slice(0, -u.length);
  }
  if (t.length > NUMBER_MAX_CHARS || !TYPED.test(t)) return null;
  return t;
}

/** Tolerance as the column gives it (PostgREST sends numeric as a JSON number; a string is read the same way). */
function toleranceOf(tolerance: number | string | null | undefined): Decimal {
  if (tolerance === null || tolerance === undefined) return { units: 0n, scale: 0 };
  const text = typeof tolerance === 'number' ? numberText(tolerance) : tolerance.trim();
  return TYPED.test(text) ? decimal(text) : { units: 0n, scale: 0 };
}

/** A JavaScript number as plain decimal digits (no exponent). */
function numberText(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(20).replace(/\.?0+$/, '');
}

/** Whether a typed answer is one of the accepted numbers within the tolerance. */
export function numberRight(
  text: string | null | undefined,
  answers: readonly string[],
  tolerance: number | string | null | undefined,
  unit: string | null | undefined,
): boolean {
  if (text === null || text === undefined) return false;
  const typed = typedNumber(text, unit ?? null);
  if (typed === null) return false;
  const x = decimal(typed);
  const tol = toleranceOf(tolerance);
  return answers.some((answer) => {
    if (answer.length > NUMBER_MAX_CHARS || !CANONICAL_NUMBER.test(answer)) return false;
    const a = decimal(answer);
    const scale = Math.max(x.scale, a.scale, tol.scale);
    const diff = scaled(x, scale) - scaled(a, scale);
    return (diff < 0n ? -diff : diff) <= scaled(tol, scale);
  });
}

/**
 * An accepted number as the editor writes it: spaces gone, «,» → «.», «−» → «-», a leading «+» and a trailing «.»
 * dropped, «.5» → «0.5». null when it is not a number (the field shows the problem).
 */
export function canonicalNumber(text: string): string | null {
  let t = text.replace(SPACE, '').replace(/,/g, '.').replace(/−/g, '-');
  if (t.startsWith('+')) t = t.slice(1);
  if (t.endsWith('.')) t = t.slice(0, -1);
  if (t.startsWith('.')) t = `0${t}`;
  else if (t.startsWith('-.')) t = `-0${t.slice(1)}`;
  return CANONICAL_NUMBER.test(t) && t.length <= NUMBER_MAX_CHARS ? t : null;
}

/** A tolerance as the editor writes it: «0,5» → «0.5»; null when empty; undefined when it is not a number ≥ 0 with at most six decimals. */
export function canonicalTolerance(text: string): string | null | undefined {
  const t = text.replace(SPACE, '').replace(/,/g, '.');
  if (t === '') return null;
  const normal = t.startsWith('.') ? `0${t}` : t.endsWith('.') ? t.slice(0, -1) : t;
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(normal) || Number(normal) > 1e9) return undefined;
  return normal;
}
