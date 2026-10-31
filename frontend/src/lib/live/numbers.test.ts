/**
 * A number question's words, keypad and line (lib/live/numbers.ts, 20261102090100_live_numbers.sql): numbers said the
 * Russian way, the right answer with its tolerance and unit, the keypad's text, and the projector's number line (the
 * bands always on it, wild answers counted at the ends, «inside» decided exactly as the server does).
 */
import { describe, expect, it } from 'vitest';
import { numberRight } from '../kinds/number';
import { numberAnswer, numberLine, numberText, padKeyOf, padPress, padReady, plainDecimal, typedText, type PadKey } from './numbers';

const THIN = ' ';
const NB = ' ';

describe('numbers said on the screens', () => {
  it('a decimal comma, a real minus, thousands apart from five digits on', () => {
    expect(numberText('3.14')).toBe('3,14');
    expect(numberText('-12')).toBe('−12');
    expect(numberText('1000')).toBe('1000');
    expect(numberText('12500')).toBe(`12${THIN}500`);
    expect(numberText('-1000000.5')).toBe(`−1${THIN}000${THIN}000,5`);
    expect(numberText('-12,5')).toBe('−12,5');
    expect(numberText('0,')).toBe('0,');
    expect(numberText(0.5)).toBe('0,5');
    expect(numberText(0.00001)).toBe('0,00001');
    expect(numberText('сорок')).toBe('сорок');
  });

  it('a JavaScript number without an exponent', () => {
    expect(plainDecimal(1e-7)).toBe('0.0000001');
    expect(plainDecimal(25)).toBe('25');
    expect(plainDecimal(Number.NaN)).toBe('0');
  });

  it('the right answer: every accepted number, the tolerance when there is one, the unit', () => {
    expect(numberAnswer(['42'], null, null)).toBe('42');
    expect(numberAnswer(['42'], 0, 'м')).toBe(`42${NB}м`);
    expect(numberAnswer(['9.8', '9.81'], null, 'м/с²')).toBe(`9,8 или 9,81${NB}м/с²`);
    expect(numberAnswer(['100'], 25, '°C')).toBe(`100${NB}±${NB}25${NB}°C`);
    expect(numberAnswer(['3.1416'], '0.00001', null)).toBe(`3,1416${NB}±${NB}0,00001`);
    expect(typedText('-12,5', 'м')).toBe(`−12,5${NB}м`);
  });
});

describe('the keypad', () => {
  const type = (keys: PadKey[]) => keys.reduce((t, k) => padPress(t, k), '');

  it('digits, one comma (a first one writes «0,»), the sign turned over, «⌫»', () => {
    expect(type(['1', '2', ',', '5'])).toBe('12,5');
    expect(type([',', '5'])).toBe('0,5');
    expect(type(['1', ',', ',', '2'])).toBe('1,2');
    expect(type(['4', '-', '2'])).toBe('-42');
    expect(type(['4', '-', '-'])).toBe('4');
    expect(type(['4', '2', 'back'])).toBe('4');
    expect(type(['back'])).toBe('');
    expect(type(['-'])).toBe('-');
  });

  it('never longer than sixteen characters of number', () => {
    const t = type(Array.from({ length: 30 }, () => '9' as const));
    expect(t).toBe('9'.repeat(16));
    expect(padPress(`-${t}`, '9')).toBe(`-${t}`);
    expect(padPress(t, 'back')).toBe('9'.repeat(15));
  });

  it('a computer keyboard types into it', () => {
    expect(padKeyOf('7')).toBe('7');
    expect(padKeyOf('.')).toBe(',');
    expect(padKeyOf(',')).toBe(',');
    expect(padKeyOf('-')).toBe('-');
    expect(padKeyOf('Backspace')).toBe('back');
    expect(padKeyOf('a')).toBeNull();
    expect(padKeyOf('Enter')).toBeNull();
  });

  it('«Ответить» only for a number the server reads', () => {
    expect(padReady('')).toBe(false);
    expect(padReady('-')).toBe(false);
    expect(padReady('0,')).toBe(true);
    expect(padReady('-12,5')).toBe(true);
    expect(padReady(',')).toBe(false);
  });
});

describe('the projector\'s number line', () => {
  it('the band and the right value always on it; a wild answer counted at its end, not squashing the rest', () => {
    const v = numberLine(['42'], 2, [['38', 2], ['41', 3], ['42', 9], ['43', 2], ['47', 1], ['100000', 1], ['-5000', 1]])!;
    expect(v.min).toBeLessThanOrEqual(40);
    expect(v.max).toBeGreaterThanOrEqual(44);
    expect(v.max).toBeLessThan(1000);
    expect(v.below).toBe(1);
    expect(v.above).toBe(1);
    expect(v.rights).toHaveLength(1);
    const r = v.rights[0];
    expect(r.from).toBeLessThan(r.x);
    expect(r.to).toBeGreaterThan(r.x);
    expect(r.label).toBe('42');
    expect(v.dots.map((d) => [d.value, d.ok])).toEqual([['38', false], ['41', true], ['42', true], ['43', true], ['47', false]]);
    expect(v.top).toBe(9);
    for (const d of v.dots) expect(d.x).toBeGreaterThanOrEqual(0);
    for (const d of v.dots) expect(d.x).toBeLessThanOrEqual(1);
  });

  it('«inside the band» exactly as the server: 1.1 is within 0.1 of 1 (a double says no)', () => {
    expect(Math.abs(1.1 - 1) <= 0.1).toBe(false);
    const v = numberLine(['1'], 0.1, [['1.1', 1], ['0.9', 1], ['1.1000001', 1]])!;
    const ok = Object.fromEntries(v.dots.map((d) => [d.value, d.ok]));
    expect(ok).toEqual({ '1.1': true, '0.9': true, '1.1000001': false });
    for (const [value, inside] of Object.entries(ok)) expect(numberRight(value, ['1'], 0.1, null)).toBe(inside);
  });

  it('ticks on round values; a line even when everyone typed the exact answer', () => {
    const v = numberLine(['5'], null, [['5', 12]])!;
    expect(v.max).toBeGreaterThan(v.min);
    expect(v.ticks.length).toBeGreaterThanOrEqual(3);
    expect(v.ticks.every((t) => /^[−\d ,]+$/.test(t.label))).toBe(true);
    expect(v.dots).toEqual([{ value: '5', x: v.rights[0].x, n: 12, ok: true }]);
    expect(numberLine(['0.25'], null, [])!.ticks.some((t) => t.label.includes(','))).toBe(true);
  });

  it('several accepted values each with its band; no line without one', () => {
    const v = numberLine(['9.8', '10'], 0.05, [['9.8', 3], ['10', 2]])!;
    expect(v.rights.map((r) => r.label)).toEqual(['9,8', '10']);
    expect(v.dots.every((d) => d.ok)).toBe(true);
    expect(numberLine([], null, [['1', 1]])).toBeNull();
  });
});
