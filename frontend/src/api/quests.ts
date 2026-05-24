import { supabase } from '../lib/supabase';

export type QuestType = 'daily' | 'weekly';
export type TargetType = 'analyze' | 'quiz' | 'chat' | 'mood' | 'exam' | 'review' | 'podcast';

export async function getQuestsWithProgress(userId: string) {
  // 1. Получаем все квесты
  const { data: quests, error: qErr } = await supabase
    .from('quests')
    .select('*');

  if (qErr || !quests) return [];

  // 2. Определяем reset_at для daily и weekly
  const today = new Date().toISOString().split('T')[0];
  
  // Для weekly — найдем следующий понедельник или просто текущую дату начала недели
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Понедельник
  const monday = new Date(now.setDate(diff)).toISOString().split('T')[0];

  // 3. Получаем прогресс пользователя
  const { data: progress, error: pErr } = await supabase
    .from('user_quest_progress')
    .select('*')
    .eq('user_id', userId);

  if (pErr) return quests.map(q => ({ ...q, progress: 0, is_completed: false }));

  return quests.map(q => {
    const resetDate = q.type === 'daily' ? today : monday;
    const prog = progress?.find(p => p.quest_id === q.id && p.reset_at === resetDate);
    return {
      ...q,
      current_count: prog?.current_count || 0,
      is_completed: prog?.is_completed || false,
      reset_at: resetDate
    };
  });
}

export async function updateQuestProgress(userId: string, targetType: TargetType, increment: number = 1) {
  // 1. Находим все квесты этого типа
  const { data: targetQuests } = await supabase
    .from('quests')
    .select('*')
    .eq('target_type', targetType);

  if (!targetQuests || targetQuests.length === 0) return;

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff)).toISOString().split('T')[0];

  for (const quest of targetQuests) {
    const resetAt = quest.type === 'daily' ? today : monday;

    // Пытаемся получить текущий прогресс
    const { data: existing } = await supabase
      .from('user_quest_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('quest_id', quest.id)
      .eq('reset_at', resetAt)
      .maybeSingle();

    if (existing) {
      if (existing.is_completed) continue;

      const newCount = existing.current_count + increment;
      const isCompleted = newCount >= quest.target_count;

      await supabase
        .from('user_quest_progress')
        .update({
          current_count: newCount,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      const isCompleted = increment >= quest.target_count;
      await supabase
        .from('user_quest_progress')
        .insert({
          user_id: userId,
          quest_id: quest.id,
          current_count: increment,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          reset_at: resetAt
        });
    }
  }
}
