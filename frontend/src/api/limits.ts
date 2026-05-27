import { supabase } from '../lib/supabase';

// Лимит запросов для бесплатного аккаунта
export const FREE_DAILY_LIMIT = 10;

export interface AIUsage {
  id: string;
  user_id: string;
  date: string;
  requests_count: number;
}

/**
 * Проверяет, может ли пользователь сделать еще один запрос к ИИ.
 * Возвращает { allowed: true/false, isPro: boolean, count: number }
 */
export async function checkAILimit(userId: string): Promise<{ allowed: boolean; isPro: boolean; count: number }> {
  try {
    // 1. Проверяем статус PRO
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_pro')
      .eq('id', userId)
      .single();

    const isPro = profile?.is_pro || false;

    // Если PRO, лимиты не проверяем (счетчик не важен, но возвращаем 0)
    if (isPro) {
      return { allowed: true, isPro: true, count: 0 };
    }

    // 2. Иначе проверяем кол-во запросов сегодня
    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabase
      .from('ai_usage')
      .select('requests_count')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    const count = usage?.requests_count || 0;

    return {
      allowed: count < FREE_DAILY_LIMIT,
      isPro: false,
      count
    };
  } catch (err) {
    console.error('Ошибка при проверке лимитов:', err);
    // В случае технической ошибки разрешаем, чтобы не блокировать приложение ложными срабатываниями
    return { allowed: true, isPro: false, count: 0 };
  }
}

/**
 * Увеличивает счетчик запросов за сегодня.
 * Если записи нет, создает её.
 */
export async function incrementAIUsage(userId: string): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Пытаемся получить текущую запись
    const { data: existing } = await supabase
      .from('ai_usage')
      .select('id, requests_count')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      // Обновляем
      await supabase
        .from('ai_usage')
        .update({ requests_count: existing.requests_count + 1 })
        .eq('id', existing.id);
    } else {
      // Создаем новую
      await supabase
        .from('ai_usage')
        .insert({
          user_id: userId,
          date: today,
          requests_count: 1
        });
    }
  } catch (err) {
    console.error('Ошибка при обновлении счетчика ИИ:', err);
  }
}
