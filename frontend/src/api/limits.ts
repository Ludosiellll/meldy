import { dailyUnits, FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../lib/plans';

/**
 * The Supabase client is a file of its own (see contexts/AuthContext): the event and time helpers
 * below are part of the first screen (the limit dialog, lib/apiAuth), the client is read on a check.
 */
const loadSupabase = () => import('../lib/supabase').then((module) => module.supabase);

/**
 * Дневной лимит ИИ (единицы из lib/plans.ts). С 2026-10-04 единицы списывает сервер: до вызова
 * модели, токеном самого пользователя (backend/quota.py, RPC consume_ai_units), и возвращает их,
 * если модель не дала результата. Браузер ничего не пишет: он показывает остаток (RPC
 * ai_quota_status, запасной путь — строка дня в ai_usage) и предупреждает заранее. Счётчик —
 * строка дня ai_usage по дате UTC, поэтому лимит обновляется в 00:00 UTC. Бесплатно — 100 единиц
 * в сутки, PRO — до 1000.
 */
export const FREE_DAILY_LIMIT = FREE_DAILY_UNITS;
export const PRO_DAILY_LIMIT = PRO_DAILY_UNITS;

/** Событие на window после действия с ИИ: экраны перечитывают остаток. */
export const AI_USAGE_EVENT = 'ai_usage_updated';

/** Сервер отказал по дневному лимиту (429 с code ai_limit): окно лимита (AILimitDialogHost). */
export const AI_LIMIT_EVENT = 'meldy:ai-limit';

/** Текст сервера для отказа по лимиту (backend/quota.py AI_LIMIT_DETAIL). */
export const AI_LIMIT_MESSAGE = 'Дневной лимит ИИ на сегодня исчерпан.';

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
  /** false, если остаток прочитать не удалось: он неизвестен, а не «0 израсходовано». */
  ok: boolean;
  /** Дневной лимит аккаунта: 100, у PRO — 1000. */
  limit: number;
  /** Ближайший сброс счётчика (00:00 UTC). */
  resetsAt: Date;
}

interface Quota {
  isPro: boolean;
  used: number;
  limit: number;
  resetsAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ключ дня в ai_usage: дата UTC, как у сервера. */
function usageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function usedUnits(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function resetTime(value: unknown): Date {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return nextLimitReset();
}

function unknownStatus(): AILimitStatus {
  return { allowed: true, isPro: false, count: 0, ok: false, limit: FREE_DAILY_LIMIT, resetsAt: nextLimitReset() };
}

/** Остаток по серверу: RPC ai_quota_status. null — функции нет или ответ не прочитан. */
async function quotaFromServer(): Promise<Quota | null> {
  const supabase = await loadSupabase();
  const { data, error } = await supabase.rpc('ai_quota_status');
  if (error || !isRecord(data)) return null;
  const limit = Number(data.limit);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return { isPro: data.pro === true, used: usedUnits(data.used), limit: Math.trunc(limit), resetsAt: resetTime(data.resets_at) };
}

/** Запасной путь (сервер ещё без функции): PRO из профиля и строка дня ai_usage. */
async function quotaFromTables(userId: string): Promise<Quota | null> {
  const supabase = await loadSupabase();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_pro')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) {
    console.error('Не удалось прочитать профиль для лимита ИИ:', profileError);
    return null;
  }
  const isPro = profile?.is_pro === true;
  const { data: usage, error: usageError } = await supabase
    .from('ai_usage')
    .select('requests_count')
    .eq('user_id', userId)
    .eq('date', usageDay())
    .maybeSingle();
  if (usageError) {
    console.error('Не удалось прочитать счётчик лимита ИИ:', usageError);
    return null;
  }
  return { isPro, used: usedUnits(usage?.requests_count), limit: dailyUnits(isPro), resetsAt: nextLimitReset() };
}

/**
 * Хватит ли дневного лимита на действие стоимостью cost (0 — только прочитать остаток).
 * Любая ошибка чтения даёт ok: false и allowed: true: решает сервер, работа не блокируется.
 */
export async function checkAILimit(userId: string, cost: number = 1): Promise<AILimitStatus> {
  try {
    let quota: Quota | null = null;
    try {
      quota = await quotaFromServer();
    } catch {
      quota = null; // функции ещё нет или сеть: читаем таблицы
    }
    if (!quota) quota = await quotaFromTables(userId);
    if (!quota) return unknownStatus();
    const price = Math.max(0, Number(cost) || 0);
    return {
      allowed: quota.used + price <= quota.limit,
      isPro: quota.isPro,
      count: quota.used,
      ok: true,
      limit: quota.limit,
      resetsAt: quota.resetsAt,
    };
  } catch (err) {
    console.error('Ошибка при проверке лимита ИИ:', err);
    return unknownStatus();
  }
}

/** После действия с ИИ: верхняя панель и экраны перечитывают остаток (списал его сервер). */
export function notifyAIUsageChanged(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(AI_USAGE_EVENT));
    }
  } catch {
    // Событие только обновляет подсказку на экране; его отсутствие ничего не ломает.
  }
}

/**
 * @deprecated Единицы списывает сервер; браузер больше ничего не пишет. Оставлено для кода,
 * который ещё зовёт старое имя: только сообщает экранам, что остаток изменился.
 */
export async function incrementAIUsage(_userId: string, cost: number = 1): Promise<void> {
  if (cost > 0) notifyAIUsageChanged();
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

// ── Отказ сервера по лимиту ──────────────────────────────────────────────────────────

export interface AILimitInfo {
  /** Израсходовано сегодня и дневной лимит — из ответа сервера (null, если их там нет). */
  used: number | null;
  limit: number | null;
  /** Сколько единиц просило действие (null, если сервер не сказал). */
  units: number | null;
  resetsAt: Date;
  pro: boolean;
}

function countOrNull(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** Остаток на сегодня по ответу сервера (0, если чисел нет). */
export function remainingUnits(info: AILimitInfo): number {
  return info.limit !== null && info.used !== null ? Math.max(0, info.limit - info.used) : 0;
}

/** Тело ответа 429 (или событие error потока) с code ai_limit → сведения для окна; иначе null. */
export function aiLimitFromBody(body: unknown): AILimitInfo | null {
  if (!isRecord(body) || body.code !== 'ai_limit') return null;
  return {
    used: countOrNull(body.used),
    limit: countOrNull(body.limit),
    units: countOrNull(body.units),
    resetsAt: resetTime(body.resets_at),
    pro: body.pro === true,
  };
}

let lastLimitReport = 0;
const LIMIT_REPORT_GAP_MS = 2_000;

/**
 * Показать окно дневного лимита (его рисует AILimitDialogHost). Несколько отказов подряд
 * (параллельные запросы одного действия) — одно окно.
 */
export function reportAILimit(info: AILimitInfo): void {
  const now = Date.now();
  if (now - lastLimitReport < LIMIT_REPORT_GAP_MS) return;
  lastLimitReport = now;
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent<AILimitInfo>(AI_LIMIT_EVENT, { detail: info }));
    }
  } catch {
    // Окно — подсказка; без него ошибка всё равно видна на экране действия.
  }
  notifyAIUsageChanged();
}

/** Для тестов: следующий отказ снова показывает окно. */
export function resetAILimitReportsForTests(): void {
  lastLimitReport = 0;
}
