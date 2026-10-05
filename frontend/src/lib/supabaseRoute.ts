/**
 * Путь браузера к Supabase: напрямую (`*.supabase.co`) или запасной — через сайт Meldy
 * (`/sb/…`, backend/supabase_proxy.py), если прямой адрес недоступен: часть операторов в России
 * его не пропускает. Путь выбирается один раз — пробным запросом `auth/v1/health` (до 4 с) — и
 * запоминается на 12 часов (localStorage `meldy_supabase_route`). Если позже прямой путь
 * обрывается сетевой ошибкой, клиент переходит на запасной: чтение повторяется сразу, запись — нет
 * (она могла дойти до базы), её повторит пользователь.
 *
 * Вход через Google идёт мимо этого пути: браузер сам открывает адрес Supabase.
 */

export type SupabaseRoute = 'direct' | 'proxy';

export const ROUTE_STORAGE_KEY = 'meldy_supabase_route';
export const ROUTE_TTL_MS = 12 * 60 * 60 * 1000;
export const PROBE_TIMEOUT_MS = 4000;
/** Чтение напрямую дольше этого — адрес, видимо, «молчит» (блокировка без отказа): на запасной путь. */
export const DIRECT_READ_TIMEOUT_MS = 15000;
export const PROXY_PREFIX = '/sb';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SupabaseFetchOptions {
  supabaseUrl: string;
  anonKey: string;
  /** Тесты подменяют сеть. */
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Адрес сайта Meldy (по умолчанию — window.location.origin). */
  origin?: () => string;
}

function storedRoute(now: number): SupabaseRoute | null {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { route?: unknown; at?: unknown };
    const fresh = typeof saved.at === 'number' && now - saved.at >= 0 && now - saved.at < ROUTE_TTL_MS;
    return fresh && (saved.route === 'direct' || saved.route === 'proxy') ? saved.route : null;
  } catch {
    return null;
  }
}

function rememberRoute(route: SupabaseRoute, now: number): void {
  try {
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ route, at: now }));
  } catch {
    // Без хранилища путь выбирается заново на каждой странице — работает так же.
  }
}

const isRead = (method: string) => method === 'GET' || method === 'HEAD';

/** fetch для createClient({ global: { fetch } }): выбирает путь к Supabase. */
export function createSupabaseFetch(options: SupabaseFetchOptions): FetchLike {
  const base = new URL(options.supabaseUrl).origin;
  const rawFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const origin = options.origin ?? (() => (typeof window !== 'undefined' ? window.location.origin : ''));
  let route: SupabaseRoute | null = typeof window !== 'undefined' ? storedRoute(now()) : null;
  let probing: Promise<SupabaseRoute> | null = null;

  const choose = (next: SupabaseRoute) => {
    route = next;
    rememberRoute(next, now());
    return next;
  };

  async function probe(): Promise<SupabaseRoute> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      // Любой ответ, даже ошибка, значит, что адрес доступен.
      await rawFetch(`${base}/auth/v1/health`, { headers: { apikey: options.anonKey }, signal: controller.signal });
      return 'direct';
    } catch {
      return 'proxy';
    } finally {
      clearTimeout(timer);
    }
  }

  function decide(): Promise<SupabaseRoute> {
    if (route) return Promise.resolve(route);
    probing ??= probe().then(choose);
    return probing;
  }

  return async function supabaseFetch(input, init) {
    // Только строка или URL нашего проекта: у Request своё тело и заголовки, его не переносим.
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
    const site = origin();
    if (url === null || !site || !url.startsWith(`${base}/`)) return rawFetch(input, init);
    const viaSite = `${site}${PROXY_PREFIX}${url.slice(base.length)}`;
    if ((await decide()) === 'proxy') return rawFetch(viaSite, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const caller = init?.signal ?? null;
    // Чтение ограничено по времени (своим сигналом поверх сигнала вызывающего); запись — нет.
    const controller = isRead(method) ? new AbortController() : null;
    let timedOut = false;
    const forward = () => controller?.abort();
    const timer = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, DIRECT_READ_TIMEOUT_MS)
      : null;
    if (controller && caller) {
      if (caller.aborted) controller.abort();
      else caller.addEventListener('abort', forward, { once: true });
    }
    try {
      return await rawFetch(input, controller ? { ...init, signal: controller.signal } : init);
    } catch (error) {
      if (caller?.aborted || (controller?.signal.aborted && !timedOut)) throw error;
      choose('proxy');
      if (isRead(method)) return rawFetch(viaSite, init);
      throw error;
    } finally {
      if (timer !== null) clearTimeout(timer);
      caller?.removeEventListener('abort', forward);
    }
  };
}
