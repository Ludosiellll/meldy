import { supabase } from './supabase';
import { pluralRu } from '../components/conversation/visuals';

/**
 * Cards a lecture got from ticket answers (finding LIB-6, decision 4 of 2026-10-08).
 *
 * The examiner's follow-up question on a missed point becomes a review card of the lecture the point came
 * from: a flashcard_progress row with origin 'oral_followup' and that lecture's material_id. It is not one of
 * the lecture's own cards (materials.flashcards_json), so «Лекции» said «6 карточек» while «Прогресс», which
 * counts flashcard_progress by material, and «Повторить карточки» of the lecture had 10. The lists now name
 * them apart: «6 карточек · ещё 4 из ответов на билеты».
 */
export const FOLLOWUP_ORIGIN = 'oral_followup';

/** Follow-up cards by lecture id (one request for the whole list). Empty when they cannot be read. */
export async function followupCardsByLecture(userId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!userId) return counts;
  try {
    const { data, error } = await supabase
      .from('flashcard_progress')
      .select('material_id')
      .eq('user_id', userId)
      .eq('origin', FOLLOWUP_ORIGIN)
      .limit(5000);
    if (error || !Array.isArray(data)) return counts;
    for (const row of data as Array<{ material_id?: unknown }>) {
      if (typeof row?.material_id === 'string') counts.set(row.material_id, (counts.get(row.material_id) ?? 0) + 1);
    }
  } catch {
    // An older database without the origin column, or no connection: the lists show the lecture's own cards.
  }
  return counts;
}

/** Follow-up cards of one lecture (a count, no rows). 0 when it cannot be read. */
export async function followupCardsOf(userId: string, materialId: string): Promise<number> {
  if (!userId || !materialId) return 0;
  try {
    const { count, error } = await supabase
      .from('flashcard_progress')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('material_id', materialId)
      .eq('origin', FOLLOWUP_ORIGIN);
    return !error && typeof count === 'number' && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

const NBSP = '\u00a0';

export function cardsWord(count: number): string {
  return `${count}${NBSP}${pluralRu(count, ['карточка', 'карточки', 'карточек'])}`;
}

/** «из ответов на билеты»: short words keep the word after them. */
const FROM_TICKETS = `из${NBSP}ответов на${NBSP}билеты`;

/**
 * «6 карточек · ещё 4 из ответов на билеты»; «6 карточек» without follow-ups; «4 карточки из ответов на
 * билеты» for a lecture with none of its own (loaded as text only); '' for none at all. With no-break spaces
 * where a line must not break.
 */
export function cardsLine(own: number, followups: number): string {
  const mine = Math.max(0, Math.trunc(own) || 0);
  const extra = Math.max(0, Math.trunc(followups) || 0);
  if (mine > 0 && extra > 0) return `${cardsWord(mine)}${NBSP}· ещё${NBSP}${extra} ${FROM_TICKETS}`;
  if (mine > 0) return cardsWord(mine);
  if (extra > 0) return `${cardsWord(extra)} ${FROM_TICKETS}`;
  return '';
}
