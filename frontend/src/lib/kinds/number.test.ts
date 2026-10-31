import { describe, expect, it } from 'vitest';
import vectorsRaw from '../../../../contracts/kinds/number_vectors.json?raw';
import { canonicalNumber, canonicalTolerance, numberRight, typedNumber } from './number';

interface NumberCase {
  name: string;
  text: string | null;
  answers: string[];
  tolerance: string | null;
  unit: string | null;
  right: boolean;
}
const V = JSON.parse(vectorsRaw) as { cases: NumberCase[] };

describe('numberRight — the twin of public.meldy_number_right', () => {
  it(`agrees with every shared case (${V.cases.length})`, () => {
    const wrong = V.cases.filter((c) => numberRight(c.text, c.answers, c.tolerance, c.unit) !== c.right).map((c) => c.name);
    expect(wrong).toEqual([]);
  });
  it('reads the tolerance PostgREST sends as a JSON number exactly', () => {
    expect(numberRight('1.1', ['1'], 0.1, null)).toBe(true);
    expect(numberRight('1.1000001', ['1'], 0.1, null)).toBe(false);
    expect(numberRight('0.30000001', ['0.3'], 1e-7, null)).toBe(true);
  });
  it('gives the number text it read', () => {
    expect(typedNumber(' 9,8 м/с ', 'м/с')).toBe('9.8');
    expect(typedNumber('abc', null)).toBeNull();
  });
});

describe('the editor writes canonical numbers', () => {
  it('normalises what an author types', () => {
    expect(canonicalNumber('3,14')).toBe('3.14');
    expect(canonicalNumber('+7')).toBe('7');
    expect(canonicalNumber('1 000')).toBe('1000');
    expect(canonicalNumber('.5')).toBe('0.5');
    expect(canonicalNumber('-.5')).toBe('-0.5');
    expect(canonicalNumber('−2')).toBe('-2');
    expect(canonicalNumber('5.')).toBe('5');
    expect(canonicalNumber('пять')).toBeNull();
    expect(canonicalNumber('1e3')).toBeNull();
  });
  it('reads a tolerance', () => {
    expect(canonicalTolerance('')).toBeNull();
    expect(canonicalTolerance('0,5')).toBe('0.5');
    expect(canonicalTolerance('.25')).toBe('0.25');
    expect(canonicalTolerance('-1')).toBeUndefined();
    expect(canonicalTolerance('0.1234567')).toBeUndefined();
  });
});
