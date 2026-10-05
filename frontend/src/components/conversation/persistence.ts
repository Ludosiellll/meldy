import { supabase } from '../../lib/supabase';
import type { ConversationTerm } from './types';
import { AI_LIMIT_MESSAGE, formatLimitReset, nextLimitReset } from '../../api/limits';

/** Лимиты сервера: /api/podcast/generate — 20 000 символов, /api/podcast/visuals — 15 000 символов и 40 реплик. */
export const CONVERSATION_CONTEXT_LIMIT = 20000;
export const VISUALS_CONTEXT_LIMIT = 15000;
export const VISUALS_MAX_LINES = 40;

export interface MaterialSnapshot {
  summaryJson: Record<string, unknown>;
  originalText: string;
}

export class ConversationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Свежая копия summary_json и исходного текста материала. */
export async function loadMaterialSnapshot(materialId: string): Promise<MaterialSnapshot> {
  const { data, error } = await supabase
    .from('materials')
    .select('summary_json, original_text')
    .eq('id', materialId)
    .single();
  if (error || !data) throw new ConversationError('Не удалось открыть материал. Попробуйте ещё раз.');
  return {
    summaryJson: isRecord(data.summary_json) ? data.summary_json : {},
    originalText: typeof data.original_text === 'string' ? data.original_text : '',
  };
}

/** Текст, по которому сервер составляет разговор: исходник или конспект, до 20 000 символов. */
export function conversationContext(snapshot: MaterialSnapshot, limit = CONVERSATION_CONTEXT_LIMIT): string {
  const content = typeof snapshot.summaryJson.content === 'string' ? snapshot.summaryJson.content : '';
  const source = snapshot.originalText.trim() ? snapshot.originalText : content;
  return source.trim().slice(0, limit).trim();
}

export function conversationTerms(snapshot: MaterialSnapshot, fallback?: ConversationTerm[] | null): ConversationTerm[] {
  const raw = Array.isArray(snapshot.summaryJson.terms) ? snapshot.summaryJson.terms : fallback ?? [];
  return raw
    .filter(
      (item): item is ConversationTerm =>
        isRecord(item) && typeof item.term === 'string' && typeof item.definition === 'string',
    )
    .slice(0, 30)
    .map(item => ({ term: item.term, definition: item.definition }));
}

export const NOT_OWNER_MESSAGE = 'Этот материал нельзя изменить: он принадлежит другому пользователю.';

/**
 * Меняет в summary_json только ключи из patch. summary_json читается заново
 * прямо перед записью: всё, что успело измениться за время ответа модели
 * (разговор, выжимка, сохранённые в другой вкладке или другой задачей),
 * остаётся как есть. Служебный _startTab в базу не попадает. Если запись не
 * изменила ни одной строки (материал чужой), это ошибка: энергию за такую
 * работу списывать нельзя.
 */
export async function patchSummaryJson(
  materialId: string,
  patch: Record<string, unknown>,
  saveError = 'Не удалось сохранить изменения. Попробуйте ещё раз.',
): Promise<Record<string, unknown>> {
  const fresh = await loadMaterialSnapshot(materialId);
  const next: Record<string, unknown> = { ...fresh.summaryJson, ...patch };
  delete next._startTab;
  const { data, error } = await supabase
    .from('materials')
    .update({ summary_json: next })
    .eq('id', materialId)
    .select('id');
  if (error) throw new ConversationError(saveError);
  if (Array.isArray(data) && data.length === 0) throw new ConversationError(NOT_OWNER_MESSAGE);
  return next;
}

/** Сохраняет реплики в summary_json.podcast, остальные поля не трогает. */
export function saveConversationLines(materialId: string, lines: unknown[]): Promise<Record<string, unknown>> {
  return patchSummaryJson(materialId, { podcast: lines }, 'Не удалось сохранить разговор. Попробуйте ещё раз.');
}

/** Сохраняет выжимку в summary_json.cheatsheet, остальные поля не трогает. */
export function saveCheatsheet(materialId: string, cheatsheet: string): Promise<Record<string, unknown>> {
  return patchSummaryJson(materialId, { cheatsheet }, 'Не удалось сохранить выжимку. Попробуйте ещё раз.');
}

export async function postJson(url: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ConversationError('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  if (response.status === 429) {
    // The daily AI limit (code ai_limit, the dialog opens from lib/apiAuth) is not «busy»: a minute will not help.
    let code: unknown = null;
    try {
      code = ((await response.json()) as { code?: unknown })?.code;
    } catch {
      code = null;
    }
    if (code === 'ai_limit') throw new ConversationError(`${AI_LIMIT_MESSAGE} Он обновится в ${formatLimitReset(nextLimitReset())}.`);
    throw new ConversationError('Сервис сейчас занят. Подождите минуту и попробуйте ещё раз.');
  }
  if (!response.ok) {
    // Сервер отвечает понятным русским текстом в detail — показываем его, иначе общую фразу.
    let detail: unknown = null;
    try {
      detail = ((await response.json()) as { detail?: unknown })?.detail;
    } catch {
      detail = null;
    }
    if (typeof detail === 'string' && /[А-Яа-яЁё]/.test(detail) && detail.length <= 200) {
      throw new ConversationError(detail);
    }
    throw new ConversationError('Сервер не смог выполнить запрос. Попробуйте ещё раз.');
  }
  try {
    return await response.json();
  } catch {
    throw new ConversationError('Сервер вернул непонятный ответ. Попробуйте ещё раз.');
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ConversationError ? error.message : fallback;
}
