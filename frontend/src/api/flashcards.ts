import { Flashcard } from '../types';
import { supabase } from '../lib/supabase';

export async function getDueCards(userId: string) {
  const { data, error } = await supabase
    .from('flashcard_progress')
    .select('*')
    .eq('user_id', userId)
    .lte('next_review', new Date().toISOString())
    .order('next_review', { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function syncFlashcards(userId: string, materialId: string, cards: Flashcard[]) {
  // Добавляет карточки только если их ещё нет
  const existing = await supabase
    .from('flashcard_progress')
    .select('question')
    .eq('material_id', materialId);
  const existingQ = new Set((existing.data || []).map((r: any) => r.question));
  const toInsert = cards
    .filter((c: any) => !existingQ.has(c.question))
    .map((c: any) => ({ user_id: userId, material_id: materialId, question: c.question, answer: c.answer }));
  if (toInsert.length > 0) {
    await supabase.from('flashcard_progress').insert(toInsert);
  }
}

export async function updateCardProgress(cardId: string, quality: number) {
  // SM-2 алгоритм
  const { data: card } = await supabase.from('flashcard_progress').select('*').eq('id', cardId).single();
  if (!card) return;

  let { ease_factor, interval_days, repetitions } = card;
  if (quality >= 3) {
    if (repetitions === 0) interval_days = 1;
    else if (repetitions === 1) interval_days = 6;
    else interval_days = Math.round(interval_days * ease_factor);
    repetitions += 1;
    ease_factor = Math.max(1.3, ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  } else {
    repetitions = 0;
    interval_days = 1;
  }

  const next_review = new Date();
  next_review.setDate(next_review.getDate() + interval_days);

  await supabase.from('flashcard_progress').update({
    ease_factor, interval_days, repetitions,
    next_review: next_review.toISOString()
  }).eq('id', cardId);
}