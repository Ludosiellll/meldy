import { supabase } from '../lib/supabase';

/**
 * Дневной лимит ИИ бесплатного аккаунта (в единицах). Счётчик ведёт браузер в таблице
 * ai_usage по дате UTC, поэтому лимит обновляется в 00:00 UTC. Это не защищённая
 * серверная квота, а честная подсказка пользователю (решение 2026-09-24).
 */
export const FREE_DAILY_LIMIT = 100;

/** Событие на window после каждого успешного списания: экраны перечитывают остаток. */
export const AI_USAGE_EVENT = 'ai_usage_updated';

export interface AIUsage {
  id: string;
  user_id: string;
  date: string;
  requests_count: number; // по смыслу — израсходованные единицы за день
}

export interface AILimitStatus {
  /** Хватает ли остатка на действие. При ошибке чтения — true, чтобы не блокировать работу. */
  allowed: boolean;
  isPro: boolean;
  /** Израсходовано сегодня. Имеет смысл только при ok: true. */
  count: number;
  /** false, если профиль или счётчик прочитать не удалось: остаток неизвестен, а не «0 израсходовано». */
  ok: boolean;
}

const UNKNOWN_STATUS: AILimitStatus = { allowed: true, isPro: false, count: 0, ok: false };

/** Ключ дня в ai_usage: дата UTC, как у живого клиента. */
function usageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function usedUnits(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Проверяет, хватит ли дневного лимита на действие стоимостью cost.
 * Любая ошибка чтения (в том числе две строки за один день) даёт ok: false и allowed: true.
 */
export async function checkAILimit(userId: string, cost: number = 1): Promise<AILimitStatus> {
  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_pro')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) {
      console.error('Не удалось прочитать профиль для лимита ИИ:', profileError);
      return { ...UNKNOWN_STATUS };
    }
    if (profile?.is_pro) {
      return { allowed: true, isPro: true, count: 0, ok: true };
    }

    const { data: usage, error: usageError } = await supabase
      .from('ai_usage')
      .select('requests_count')
      .eq('user_id', userId)
      .eq('date', usageDay())
      .maybeSingle();
    if (usageError) {
      console.error('Не удалось прочитать счётчик лимита ИИ:', usageError);
      return { ...UNKNOWN_STATUS };
    }

    const count = usedUnits(usage?.requests_count);
    return { allowed: count + cost <= FREE_DAILY_LIMIT, isPro: false, count, ok: true };
  } catch (err) {
    console.error('Ошибка при проверке лимита ИИ:', err);
    return { ...UNKNOWN_STATUS };
  }
}

function notifyUsageChanged(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(AI_USAGE_EVENT));
    }
  } catch {
    // Событие только обновляет подсказку на экране; его отсутствие ничего не ломает.
  }
}

/** Сколько раз пробуем списать единицы, если строку дня успела изменить параллельная запись. */
const MAX_WRITE_ATTEMPTS = 3;

type WriteOutcome = 'written' | 'changed';

/**
 * Одна попытка списания. Строка дня меняется по принципу «сравнить и записать»: UPDATE
 * проходит, только если счётчик всё ещё равен прочитанному, и возвращает id изменённой
 * строки. Ноль строк значит, что параллельное списание (фоновая разметка, другая вкладка)
 * успело раньше или запись не прошла: тогда 'changed', а не «записано».
 */
async function writeUsage(userId: string, cost: number, day: string): Promise<WriteOutcome> {
  const { data: existing, error: readError } = await supabase
    .from('ai_usage')
    .select('id, requests_count')
    .eq('user_id', userId)
    .eq('date', day)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const seen = existing.requests_count;
    const update = supabase
      .from('ai_usage')
      .update({ requests_count: usedUnits(seen) + cost })
      .eq('id', existing.id);
    const guarded = seen === null || seen === undefined ? update.is('requests_count', null) : update.eq('requests_count', seen);
    const { data, error } = await guarded.select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0 ? 'written' : 'changed';
  }

  const { error } = await supabase
    .from('ai_usage')
    .insert({ user_id: userId, date: day, requests_count: cost });
  if (error) {
    // Параллельное списание успело создать строку дня: перечитываем и прибавляем.
    if ((error as { code?: string }).code === '23505') return 'changed';
    throw error;
  }
  return 'written';
}

/**
 * Списывает cost единиц за сегодня (создаёт строку дня, если её нет). Параллельные
 * списания не теряются: при изменённой строке перечитываем и пробуем снова, до
 * MAX_WRITE_ATTEMPTS раз. AI_USAGE_EVENT уходит только после записи, которая изменила
 * строку. Никогда не бросает исключение.
 */
export async function incrementAIUsage(userId: string, cost: number = 1): Promise<void> {
  if (!(cost > 0)) return; // бесплатное действие ничего не списывает
  try {
    const day = usageDay();
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      if ((await writeUsage(userId, cost, day)) === 'written') {
        notifyUsageChanged();
        return;
      }
    }
    console.error('Не удалось списать единицы лимита ИИ: строка дня не изменилась после повторных попыток');
  } catch (err) {
    console.error('Ошибка при обновлении счётчика ИИ:', err);
  }
}

/** Ближайшие 00:00 UTC после now: тогда начинается новый день счётчика. */
export function nextLimitReset(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Время сброса в местном часовом поясе пользователя, «Ч:ММ» без ведущего нуля у часа
 * («3:00», «7:05», «0:00»), как на листе экзамена и в билете (QA r3 № 2): одно время пишется
 * на всех экранах одинаково. Собирается вручную: результат не зависит от сборки ICU в браузере.
 */
export function formatLimitReset(date: Date): string {
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${date.getHours()}:${mm}`;
}
