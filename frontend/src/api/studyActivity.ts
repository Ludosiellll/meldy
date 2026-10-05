import { format } from 'date-fns';
import { supabase } from '../lib/supabase';

/** The pending activity writes of this tab, one after another (see recordStudyActivity). */
let activityQueue: Promise<void> = Promise.resolve();

/**
 * Adds today's activity to `study_sessions` (one row per user and day). The day is the viewer's
 * local calendar day, the same key «Сегодня» and «Прогресс» read; a UTC date would file activity
 * between midnight and 03:00 Moscow time under yesterday. The day is taken when the call is made,
 * so a write that waits in the queue past midnight still lands on the day of the answer.
 *
 * A write reads the day row and then stores the sum, so two overlapping writes would both read
 * the same count and one answer would be lost. Calls in this tab therefore run one after another,
 * whichever screen makes them; the returned promise settles when this call's write is done.
 * Never throws: activity is a counter, a failed write must not break the screen that called it.
 */
export function recordStudyActivity(userId: string, cardsReviewed: number = 0, materialsAdded: number = 0): Promise<void> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const write = activityQueue
    .then(() => writeStudyActivity(userId, today, cardsReviewed, materialsAdded))
    .catch((error) => console.error('Error recording study activity:', error));
  activityQueue = write;
  return write;
}

async function writeStudyActivity(userId: string, today: string, cardsReviewed: number, materialsAdded: number) {
  try {
    const { data: existing } = await supabase
      .from('study_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('study_sessions')
        .update({
          cards_reviewed: (existing.cards_reviewed || 0) + cardsReviewed,
          materials_added: (existing.materials_added || 0) + materialsAdded
        })
        .eq('id', existing.id);
    } else {
      const { error } = await supabase
        .from('study_sessions')
        .insert({
          user_id: userId,
          date: today,
          cards_reviewed: cardsReviewed,
          materials_added: materialsAdded
        });

      // Обрабатываем возможную гонку уникальности (Unique violation)
      if (error && error.code === '23505') {
        const { data: retryExisting } = await supabase
          .from('study_sessions')
          .select('*')
          .eq('user_id', userId)
          .eq('date', today)
          .maybeSingle();
        if (retryExisting) {
          await supabase
            .from('study_sessions')
            .update({
              cards_reviewed: (retryExisting.cards_reviewed || 0) + cardsReviewed,
              materials_added: (retryExisting.materials_added || 0) + materialsAdded
            })
            .eq('id', retryExisting.id);
        }
      }
    }
  } catch (e) {
    console.error("Error recording study activity:", e);
  }
}
