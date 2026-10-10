/**
 * The answer of GET /api/oral/sheet as the client reads it (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05, 3.2):
 * `parseSheetResponse` keeps what the screens and the plan may trust (the server is trusted; a broken proxy or an old
 * build is not). Pure: no network, no storage, no clock — api/cheatSheet.ts (which re-exports all of it) parses the
 * Space's answer with it, and the Telegram bot parses the same JSON from `meldy_private.oral_sheet_for` (through
 * `bot_oral_inputs`) with a copy of this file, so both plan the oral questions from the same sheet.
 */
import type { SheetCoverage, SheetMaterial, SheetPoint, SheetQuestion, SheetRubric } from './cheatSheet.ts';

export interface SheetJobInfo {
  /** stopping: «Остановить» was pressed; the questions already started are being finished. */
  state: 'running' | 'stopping';
  done: number;
  total: number;
  startedAt: string | null;
}

export interface SheetResponse {
  examId: string;
  mappingState: string;
  questions: SheetQuestion[];
  /** Questions that can be written and are not. */
  toWrite: number;
  /** Their price in AI units. */
  units: number;
  /** Questions in the lectures whose points failed the quote check twice: they cannot be written (not in toWrite). */
  unwritable: number;
  /** A writing job the server is running for this exam now. */
  job: SheetJobInfo | null;
}

export class SheetError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, options: { status?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = 'SheetError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

export const SHEET_LOAD_MESSAGE = 'Шпаргалка не загрузилась. Проверьте связь и нажмите «Повторить».';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HASH = /^[0-9a-f]{32}$/;
const POINT_ID = /^p[1-6]$/;
const SOURCE_ID = /^M\d{1,2}:S\d{1,3}$/;
const COVERAGES: ReadonlySet<string> = new Set(['full', 'partial', 'none', 'unverified']);
const METHODS: ReadonlySet<string> = new Set(['llm', 'lexical', 'manual']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function parsePoint(value: unknown): SheetPoint | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 4);
  const title = str(value.title, 240).trim();
  if (!POINT_ID.test(id) || !title) return null;
  return {
    id,
    title,
    short: str(value.short, 80).trim(),
    essential: value.essential === true,
    source_quote: str(value.source_quote, 400),
    source_ids: (Array.isArray(value.source_ids) ? value.source_ids : []).filter(
      (item): item is string => typeof item === 'string' && SOURCE_ID.test(item),
    ),
  };
}

export function parseRubric(value: unknown): SheetRubric | null {
  if (!isRecord(value)) return null;
  const rubricId = str(value.rubric_id, 64);
  if (!UUID.test(rubricId)) return null;
  const coverage = value.coverage === 'partial' || value.coverage === 'none' ? value.coverage : 'full';
  const seen = new Set<string>();
  const points: SheetPoint[] = [];
  for (const item of Array.isArray(value.points) ? value.points : []) {
    const point = parsePoint(item);
    if (point && !seen.has(point.id)) {
      seen.add(point.id);
      points.push(point);
    }
  }
  const materials: SheetMaterial[] = (Array.isArray(value.materials) ? value.materials : [])
    .filter(isRecord)
    .map((item) => ({ key: str(item.key, 8), material_id: str(item.material_id, 64), title: str(item.title, 200) }))
    .filter((item) => item.key && item.material_id);
  return {
    rubric_id: rubricId.toLowerCase(),
    built_at: typeof value.built_at === 'string' && value.built_at ? value.built_at : null,
    coverage,
    coverage_note: str(value.coverage_note, 400),
    materials,
    points: coverage === 'none' ? [] : points,
  };
}

export function parseSheetQuestion(value: unknown): SheetQuestion | null {
  if (!isRecord(value)) return null;
  const questionId = str(value.question_id, 64);
  const text = str(value.text, 1000).trim();
  if (!UUID.test(questionId) || !text) return null;
  const position = count(value.position);
  const coverage = typeof value.coverage === 'string' && COVERAGES.has(value.coverage) ? (value.coverage as SheetCoverage) : null;
  const method = typeof value.coverage_method === 'string' && METHODS.has(value.coverage_method) ? value.coverage_method : null;
  const hash = str(value.question_hash, 64).toLowerCase();
  return {
    question_id: questionId,
    position: position || 1,
    label: str(value.label, 16),
    section: typeof value.section === 'number' && Number.isFinite(value.section) ? value.section : null,
    text,
    question_hash: HASH.test(hash) ? hash : '',
    coverage,
    coverage_method: method as SheetQuestion['coverage_method'],
    coverage_reason: str(value.coverage_reason, 400),
    missing_note: str(value.missing_note, 400),
    rubric: parseRubric(value.rubric),
    rebuilt: value.rebuilt === true,
    unwritable: value.unwritable === true,
  };
}

export function parseSheetResponse(value: unknown): SheetResponse {
  if (!isRecord(value) || !Array.isArray(value.questions)) throw new SheetError(SHEET_LOAD_MESSAGE);
  const questions = value.questions.map(parseSheetQuestion).filter((item): item is SheetQuestion => item !== null);
  const job =
    isRecord(value.job) && (value.job.state === 'running' || value.job.state === 'stopping')
      ? {
          state: value.job.state === 'stopping' ? ('stopping' as const) : ('running' as const),
          done: count(value.job.done),
          total: count(value.job.total),
          startedAt: str(value.job.started_at, 40) || null,
        }
      : null;
  return {
    examId: str(value.exam_id, 64),
    mappingState: str(value.mapping_state, 16),
    questions,
    toWrite: count(value.to_write),
    units: count(value.units),
    unwritable: count(value.unwritable),
    job,
  };
}
