/**
 * Release 49: the test out of Meldy and a test out of a lecture (backend/port_api.py).
 *
 * - exportTest: POST /api/tests/export — GIFT, Moodle XML, Aiken or Kahoot's spreadsheet, with the questions the format
 *   cannot hold named by number and reason. No AI, no units.
 * - fromLecture: POST /api/tests/from-lecture — the lecture's own self-test as test questions, each with a quote of the
 *   lecture and its key checked against it. No AI, no units (the questions are the lecture's).
 * - generateTest: POST /api/tests/generate — new questions from a lecture, a text or a file; costs what «Тест заново»
 *   of a lecture costs (AI_COSTS.analysisSection), and nothing when no question checks against the text.
 */
import type { ItemInput, TestItem } from '../types/container';
import { EXPLANATION_MAX } from '../types/container';

export type ExportFormat = 'moodle' | 'gift' | 'aiken' | 'kahoot';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['moodle', 'gift', 'aiken', 'kahoot'];

export interface ExportSkip {
  number: string;
  reason: string;
}
export interface ExportResult {
  name: string;
  mime: string;
  /** The file, base64. */
  data: string;
  count: number;
  total: number;
  skipped: ExportSkip[];
  pictures_lost: number;
}

/** A generated or a lecture question: a single-answer question with the lecture's sentence behind its key. */
export interface PortItem {
  stem: string;
  options: string[];
  correct: number[];
  /** The model's explanation followed by «Из лекции «…»: «quote»» (≤ EXPLANATION_MAX). */
  explanation: string;
  quote: string;
  source_id: string | null;
  /** The quote names the right option and no other option fits it as well. */
  checked: boolean;
}
export interface PortItems {
  title: string;
  items: PortItem[];
  /** Questions not offered: their answer is not in the text. */
  dropped: number;
}

export type GenerateSource = { material_id: string } | { text: string } | { file: File };
export const GENERATE_COUNTS = [5, 10, 15, 20] as const;

export class PortError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const FAILED = 'Не получилось. Повторите через минуту.';

async function call(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new PortError('aborted', 'Остановлено.', 0);
    throw new PortError('network', 'Нет связи. Повторите, когда интернет вернётся.', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === 'string' && /[а-яё]/i.test(body.detail) && response.status < 500 ? body.detail : FAILED;
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : `http_${response.status}`;
    throw new PortError(code, response.status === 504 ? 'Модель не ответила вовремя. Повторите через минуту.' : detail, response.status);
  }
  if (!isRecord(body)) throw new PortError('bad_shape', FAILED, response.status);
  return body;
}

/** The test's questions as the export takes them: in the order the author sees, numbered as on the page. */
export function exportRows(items: readonly TestItem[], numbers?: ReadonlyMap<string, number>) {
  return items.map((item, index) => ({
    number: String(numbers?.get(item.id) ?? index + 1),
    kind: item.kind,
    stem: item.stem,
    options: item.options,
    correct: item.correct,
    answers: item.answers,
    explanation: item.explanation ?? '',
    tolerance: item.tolerance ?? null,
    unit: item.unit ?? null,
    partial: Boolean(item.partial),
    keep_order: item.keep_order,
    code: item.code,
    pictures: Boolean(item.images && ((item.images.stem?.length ?? 0) > 0 || (item.images.options ?? []).some((list) => list.length > 0))),
  }));
}

export async function exportTest(format: ExportFormat, title: string, items: readonly TestItem[], numbers?: ReadonlyMap<string, number>, signal?: AbortSignal): Promise<ExportResult> {
  const body = await call('/api/tests/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, title, items: exportRows(items, numbers) }),
    signal,
  });
  return body as unknown as ExportResult;
}

/** The exported file as a download («Скачать файл»). */
export function saveExport(result: Pick<ExportResult, 'name' | 'mime' | 'data'>): void {
  const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = result.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function portItems(body: unknown): PortItems {
  const raw = isRecord(body) ? body : {};
  const items = (Array.isArray(raw.items) ? raw.items : []).filter(isRecord).map((item) => ({
    stem: String(item.stem ?? ''),
    options: Array.isArray(item.options) ? item.options.map(String) : [],
    correct: Array.isArray(item.correct) ? item.correct.filter((n): n is number => Number.isInteger(n)) : [],
    explanation: String(item.explanation ?? '').slice(0, EXPLANATION_MAX),
    quote: String(item.quote ?? ''),
    source_id: typeof item.source_id === 'string' ? item.source_id : null,
    checked: item.checked === true,
  }));
  return { title: String(raw.title ?? ''), items: items.filter((item) => item.stem && item.options.length >= 2 && item.correct.length === 1), dropped: Number(raw.dropped) || 0 };
}

export async function fromLecture(materialId: string, signal?: AbortSignal): Promise<PortItems> {
  return portItems(await call('/api/tests/from-lecture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ material_id: materialId }),
    signal,
  }));
}

export async function generateTest(source: GenerateSource, count: number, signal?: AbortSignal): Promise<PortItems> {
  if ('file' in source) {
    const form = new FormData();
    form.append('file', source.file);
    form.append('count', String(count));
    return portItems(await call('/api/tests/generate', { method: 'POST', body: form, signal }));
  }
  return portItems(await call('/api/tests/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...source, count }),
    signal,
  }));
}

/** The chosen questions as container_items_add takes them (single, the author's key, the quote in the explanation). */
export function portInputs(items: readonly PortItem[], refPrefix: string): ItemInput[] {
  return items.map((item, index) => ({
    ref: `${refPrefix}:${index + 1}`,
    stem: item.stem,
    options: item.options,
    correct: item.correct,
    kind: 'single',
    key_source: 'manual',
    keep_order: false,
    flags: [],
    explanation: item.explanation,
  }));
}
