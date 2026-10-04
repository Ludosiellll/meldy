/**
 * Which pencil mark a question of the exam sheet gets, and its seed (contracts §8 with the
 * redesign amendment: every mark in blue pencil, readiness as ring / line / wavy line).
 *
 * The geometry is the app-wide vocabulary of components/marks (built on the landing's
 * handStroke.ts). The seed is a hash of exam id + question position, so a mark looks the same on
 * every render, on every device and in tests; the readiness mark of the same row uses its own seed.
 */
import type { CoverageValue } from '../../api/exams';
import type { Readiness } from '../../lib/learning/readiness';
import { seedFrom, type MarkKind, type TextMarkKind } from '../marks';

/** A question as the sheet shows it: a stored coverage, being checked right now, or not mapped yet. */
export type SheetCoverage = CoverageValue | 'checking' | 'unmapped';

export type CoverageMarkKind = Extract<MarkKind, 'tick' | 'cup' | 'dash' | 'dtick' | 'dot'>;

/** Coverage on the left margin: tick, open cup, dash (the boldest), dashed tick, dot. */
export const COVERAGE_MARK: Record<SheetCoverage, CoverageMarkKind | null> = {
  full: 'tick',
  partial: 'cup',
  none: 'dash',
  unverified: 'dtick',
  checking: 'dot',
  unmapped: null,
};

/** Readiness on the number: ring (подтверждено), line (засчитано, не подтверждено), wavy line (не засчитано). */
export const READINESS_MARK: Record<Readiness, TextMarkKind | null> = {
  confirmed: 'ring',
  once: 'under',
  not_passed: 'wave',
  untested: null,
};

/** The words read out instead of the coverage mark (the mark itself is aria-hidden). */
export const COVERAGE_WORDS: Record<SheetCoverage, string> = {
  full: 'есть в лекциях',
  partial: 'есть частично',
  none: 'нет ни в одной лекции',
  unverified: 'найдено только по словам',
  checking: 'проверяется',
  unmapped: 'ещё не сверено с лекциями',
};

/**
 * The words of a status pill on the sheet (the legend's own words); the long words above are what a
 * screen reader hears. «не сверено» has no pill on a row: before the mapping there is nothing to mark.
 */
export const COVERAGE_PILL_WORDS: Record<SheetCoverage, string> = {
  full: 'есть в лекциях',
  partial: 'частично',
  none: 'нет ни в одной',
  unverified: 'только по словам',
  checking: 'проверяется',
  unmapped: 'не сверено',
};

/** The marks stand inside status pills (Meldy 2026-10-04): this share of their margin size. */
export const PILL_MARK_SCALE = 0.64;

/** Size of each margin mark on the sheet (spec 3.8); the dash is drawn with the bold weight. */
export const COVERAGE_MARK_SIZE: Record<CoverageMarkKind, { width: number; height: number; weight?: number }> = {
  tick: { width: 25, height: 21 },
  cup: { width: 24, height: 14 },
  dash: { width: 25, height: 10, weight: 3.4 },
  dtick: { width: 25, height: 21 },
  dot: { width: 12, height: 12 },
};

/** Seed of a question's coverage mark: hash(exam id + position). */
export function markSeed(examId: string, position: number): number {
  return seedFrom(examId, position);
}

/** Seed of the same question's readiness mark (a different stroke on the same row). */
export function readinessSeed(examId: string, position: number): number {
  return seedFrom(examId, position, 'number');
}

/** Seed of the margin stroke that marks the selected row. */
export function selectionSeed(examId: string, position: number): number {
  return seedFrom(examId, position, 'selected');
}

export function coverageMark(coverage: SheetCoverage): CoverageMarkKind | null {
  return COVERAGE_MARK[coverage];
}

export function readinessMark(readiness: Readiness): TextMarkKind | null {
  return READINESS_MARK[readiness];
}
