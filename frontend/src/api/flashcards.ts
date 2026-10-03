import { Flashcard } from '../types';
import { supabase } from '../lib/supabase';
import { localDate, newEventId } from './learning';

/**
 * Review cards (`public.flashcard_progress`, contracts §6.6).
 *
 * - The due queue puts cards made from an examiner's follow-up question (origin 'oral_followup')
 *   first, then the oldest due date first.
 * - A review goes through the `review_flashcard` RPC: one transaction with a row lock, SM-2 on the
 *   server, `last_reviewed_at` and one `card_review` journal event. The same client_event_id for
 *   the same card is a no-op, so a retry after a lost response never reviews a card twice. Only
 *   when the function does not exist yet (PGRST202) the old SELECT + UPDATE path runs.
 */

export interface DueCard {
  id: string;
  user_id?: string;
  material_id: string | null;
  question: string;
  answer: string;
  ease_factor?: number | null;
  interval_days?: number | null;
  repetitions?: number | null;
  next_review?: string | null;
  last_reviewed_at?: string | null;
  /** 'analysis' (cards from an analysis) or 'oral_followup' (an examiner's follow-up question). */
  origin?: string | null;
  source_ids?: string[] | null;
  [column: string]: unknown;
}

export interface ReviewResult {
  card_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review: string | null;
  last_reviewed_at: string | null;
  /** True when this client_event_id was already applied: nothing changed this time. */
  duplicate: boolean;
}

export const REVIEW_SAVE_FAILED = 'Ответ не сохранён. Проверьте соединение и попробуйте ещё раз.';
export const REVIEW_SIGNED_OUT = 'Ответ не сохранён: войдите в аккаунт и повторите.';
export const REVIEW_CARD_MISSING = 'Карточка для повторения не найдена.';
export const REVIEW_INVALID = 'Ответ не сохранён: оценка карточки не прошла проверку.';
export const SYNC_FAILED = 'Карточки не добавлены в повторение. Повторите попытку.';

/** A review or a card write failed; `message` is ready for the screen, `code` is for logs. */
export class FlashcardSaveError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'FlashcardSaveError';
    this.code = code;
  }
}

const DEFAULT_DUE_LIMIT = 20;
const SOURCE_ID = /^S\d{1,3}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return null;
}

/** The column does not exist on this database yet (the journal migration is not applied there). */
function isMissingColumn(error: unknown): boolean {
  const code = errorCode(error);
  return code === '42703' || code === 'PGRST204';
}

function dueLimit(limit: number | undefined): number {
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 1000) : DEFAULT_DUE_LIMIT;
}

/** Due cards of the user (optionally of one material): follow-up cards first, then by due date. */
export async function getDueCards(userId: string, opts: { materialId?: string; limit?: number } = {}): Promise<DueCard[]> {
  const run = async (byOrigin: boolean) => {
    let query = supabase
      .from('flashcard_progress')
      .select('*')
      .eq('user_id', userId)
      .lte('next_review', new Date().toISOString());
    if (opts.materialId) query = query.eq('material_id', opts.materialId);
    // 'oral_followup' sorts after 'analysis', so descending origin puts follow-up cards first.
    if (byOrigin) query = query.order('origin', { ascending: false });
    return query.order('next_review', { ascending: true }).limit(dueLimit(opts.limit));
  };

  let { data, error } = await run(true);
  if (error && isMissingColumn(error)) ({ data, error } = await run(false));
  if (error) throw error;
  const cards = (data || []) as DueCard[];
  // Keep the follow-up cards first even where the database could not sort by origin.
  return cards
    .map((card, position) => ({ card, position }))
    .sort((a, b) => {
      const af = a.card.origin === 'oral_followup' ? 0 : 1;
      const bf = b.card.origin === 'oral_followup' ? 0 : 1;
      return af - bf || a.position - b.position;
    })
    .map(({ card }) => card);
}

/** Exact number of due cards (a HEAD request with count=exact, no rows are transferred). */
export async function countDueCards(userId: string, opts: { materialId?: string } = {}): Promise<number> {
  let query = supabase
    .from('flashcard_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .lte('next_review', new Date().toISOString());
  if (opts.materialId) query = query.eq('material_id', opts.materialId);
  const { count, error } = await query;
  if (error) throw error;
  return typeof count === 'number' && count > 0 ? count : 0;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupeKey(question: string): string {
  return question.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Adds the cards of a material to review, once per question. Cards without a question or an answer
 * are skipped, and so are questions already scheduled for this material or repeated in the batch.
 * Rejects with a Russian message when the existing cards cannot be read or the insert fails.
 */
export async function syncFlashcards(
  userId: string,
  materialId: string,
  cards: Flashcard[],
): Promise<{ inserted: number; skipped: number }> {
  const list = Array.isArray(cards) ? cards : [];
  const existing = await supabase
    .from('flashcard_progress')
    .select('question')
    .eq('user_id', userId)
    .eq('material_id', materialId);
  if (existing.error) {
    console.error('Reading existing review cards failed:', existing.error);
    throw new FlashcardSaveError(SYNC_FAILED, errorCode(existing.error));
  }
  const seen = new Set(
    ((existing.data || []) as Array<{ question?: unknown }>).map((row) => dedupeKey(cleanText(row.question))),
  );

  const rows: Array<{ user_id: string; material_id: string; question: string; answer: string; source_ids: string[] }> = [];
  for (const raw of list) {
    const card = (raw && typeof raw === 'object' ? raw : {}) as unknown as Record<string, unknown>;
    const question = cleanText(card.question ?? card.front);
    const answer = cleanText(card.answer ?? card.back);
    if (!question || !answer) continue;
    const key = dedupeKey(question);
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceIds = Array.isArray(card.source_ids)
      ? Array.from(new Set(card.source_ids.filter((id): id is string => typeof id === 'string' && SOURCE_ID.test(id)))).slice(0, 20)
      : [];
    rows.push({ user_id: userId, material_id: materialId, question, answer, source_ids: sourceIds });
  }

  const skipped = list.length - rows.length;
  if (rows.length === 0) return { inserted: 0, skipped };

  let { error } = await supabase.from('flashcard_progress').insert(rows);
  if (error && isMissingColumn(error)) {
    ({ error } = await supabase.from('flashcard_progress').insert(rows.map(({ source_ids: _ids, ...row }) => row)));
  }
  if (error) {
    console.error('Adding review cards failed:', error);
    throw new FlashcardSaveError(SYNC_FAILED, errorCode(error));
  }
  return { inserted: rows.length, skipped };
}

function reviewError(error: unknown): FlashcardSaveError {
  if (error instanceof FlashcardSaveError) return error;
  const code = errorCode(error);
  if (code === '28000' || code === '42501' || code === '401' || (code !== null && code.startsWith('PGRST30'))) {
    return new FlashcardSaveError(REVIEW_SIGNED_OUT, code);
  }
  if (code === 'P0002' || code === 'PGRST116') return new FlashcardSaveError(REVIEW_CARD_MISSING, code);
  if (code === '22023') return new FlashcardSaveError(REVIEW_INVALID, code);
  return new FlashcardSaveError(REVIEW_SAVE_FAILED, code);
}

function finite(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function reviewResult(raw: unknown, cardId: string): ReviewResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FlashcardSaveError(REVIEW_SAVE_FAILED, 'no_result');
  const row = raw as Record<string, unknown>;
  return {
    card_id: typeof row.card_id === 'string' ? row.card_id : cardId,
    ease_factor: finite(row.ease_factor, 2.5),
    interval_days: finite(row.interval_days, 1),
    repetitions: finite(row.repetitions, 0),
    next_review: typeof row.next_review === 'string' ? row.next_review : null,
    last_reviewed_at: typeof row.last_reviewed_at === 'string' ? row.last_reviewed_at : null,
    duplicate: row.duplicate === true,
  };
}

/** SM-2, identical to the server's review_flashcard. */
export function nextSchedule(
  card: { ease_factor?: number | null; interval_days?: number | null; repetitions?: number | null },
  quality: number,
): { ease_factor: number; interval_days: number; repetitions: number } {
  let ease = finite(card.ease_factor, 2.5);
  let interval = finite(card.interval_days, 1);
  let repetitions = finite(card.repetitions, 0);
  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * ease);
    repetitions += 1;
    ease = Math.max(1.3, ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  } else {
    repetitions = 0;
    interval = 1;
  }
  return { ease_factor: ease, interval_days: interval, repetitions };
}

/** The pre-journal path: read the card, compute SM-2 here and write the schedule back. */
async function legacyUpdate(cardId: string, quality: number): Promise<ReviewResult> {
  const { data: card, error: readError } = await supabase
    .from('flashcard_progress')
    .select('*')
    .eq('id', cardId)
    .single();
  if (readError) throw readError;
  if (!card) throw new FlashcardSaveError(REVIEW_CARD_MISSING, 'not_found');

  const schedule = nextSchedule(card, quality);
  const next = new Date();
  next.setDate(next.getDate() + schedule.interval_days);
  const reviewedAt = new Date().toISOString();
  const values = { ...schedule, next_review: next.toISOString() };

  let { error: updateError } = await supabase
    .from('flashcard_progress')
    .update({ ...values, last_reviewed_at: reviewedAt })
    .eq('id', cardId);
  if (updateError && isMissingColumn(updateError)) {
    ({ error: updateError } = await supabase.from('flashcard_progress').update(values).eq('id', cardId));
  }
  if (updateError) throw updateError;
  return { card_id: cardId, ...values, last_reviewed_at: reviewedAt, duplicate: false };
}

/**
 * Saves one review answer (quality 0..5). Pass the same `clientEventId` when retrying the same
 * answer: the server applies it once. Rejects with FlashcardSaveError (a Russian message for the
 * screen, the database code in `code`).
 */
export async function updateCardProgress(
  cardId: string,
  quality: number,
  opts: { clientEventId?: string; sessionId?: string } = {},
): Promise<ReviewResult> {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) throw new FlashcardSaveError(REVIEW_INVALID, 'quality');
  const clientEventId = opts.clientEventId || newEventId();

  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.rpc('review_flashcard', {
      p_card_id: cardId,
      p_quality: quality,
      p_client_event_id: clientEventId,
      p_local_date: localDate(),
      p_session_id: opts.sessionId && UUID.test(opts.sessionId) ? opts.sessionId : null,
    });
  } catch (error) {
    throw reviewError(error);
  }
  if (response.error) {
    if (errorCode(response.error) !== 'PGRST202') throw reviewError(response.error);
    try {
      return await legacyUpdate(cardId, quality);
    } catch (error) {
      throw reviewError(error);
    }
  }
  return reviewResult(response.data, cardId);
}
