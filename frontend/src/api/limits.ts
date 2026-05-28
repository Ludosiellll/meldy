import { supabase } from '../lib/supabase';

// Лимит токенов ИИ для бесплатного аккаунта (в день)
export const FREE_DAILY_LIMIT = 100;

export interface AIUsage {
  id: string;
  user_id: string;
  date: string;
  requests_count: number; // логически теперь это `used_tokens`
}

/**
 * Проверяет, может ли пользователь потратить указанное количество токенов ИИ.
 * Возвращает { allowed: true/false, isPro: boolean, count: number }
 */
export async function checkAILimit(userId: string, cost: number = 1): Promise<{ allowed: boolean; isPro: boolean; count: number }> {
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

    // 2. Иначе проверяем кол-во потраченных токенов сегодня
    const today = new Date().toISOString().split('T')[0];
    const { data: usage } = await supabase
      .from('ai_usage')
      .select('requests_count')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    const count = usage?.requests_count || 0;

    return {
      allowed: (count + cost) <= FREE_DAILY_LIMIT,
      isPro: false,
      count
    };
  } catch (err) {
    console.error('Ошибка при проверке лимитов:', err);
    // В случае технической ошибки разрешаем, чтобы не блокировать приложение
    return { allowed: true, isPro: false, count: 0 };
  }
}

/**
 * Списывает токены ИИ за сегодня.
 * Если записи нет, создает её.
 */
export async function incrementAIUsage(userId: string, cost: number = 1): Promise<void> {
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
      // Обновляем (прибавляем стоимость)
      await supabase
        .from('ai_usage')
        .update({ requests_count: existing.requests_count + cost })
        .eq('id', existing.id);
    } else {
      // Создаем новую с начальной стоимостью
      await supabase
        .from('ai_usage')
        .insert({
          user_id: userId,
          date: today,
          requests_count: cost
        });
    }
  } catch (err) {
    console.error('Ошибка при обновлении счетчика ИИ:', err);
  }
}
