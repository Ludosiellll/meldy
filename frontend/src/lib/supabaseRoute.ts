/**
 * Путь браузера к Supabase: напрямую (`*.supabase.co`) или запасной — через сайт Meldy
 * (`/sb/…`, backend/supabase_proxy.py), если прямой адрес недоступен: часть операторов в России
 * его не пропускает. Путь выбирается один раз — пробным запросом `auth/v1/health` (до 4 с) — и
 * запоминается на 12 часов (localStorage `meldy_supabase_route`). Если позже прямой путь
 * обрывается сетевой ошибкой, клиент переходит на запасной: чтение повторяется сразу, запись — нет
 * (она могла дойти до базы), её повторит пользователь. Такой переход — на 10 минут, потом путь проверяется
 * снова: обрыв посреди работы чаще значит плохую связь, чем блокировку. Обрыв, пока страница уходит или браузер
 * без сети (`navigator.onLine`), путь не меняет вовсе (живая проверка игры 21.10: после двух перезагрузок или пяти
 * секунд без сети телефон 12 часов ходил через сайт и без Realtime).
 *
 * Вход через Google идёт мимо этого пути: браузер сам открывает адрес Supabase.
 *
 * Ответ 401 с кодом PGRST303 («JWT issued at future»): PostgREST отказал раньше, чем выполнил запрос, потому что
 * время выдачи токена у него ещё впереди — часы сервера входа ушли на секунду вперёд (живая проверка 07.10:
 * «Сегодня» не загрузился сразу после входа). Такой запрос повторяется через 1 и 2 с, запись тоже: она не выполнялась.
 *
 * Запрос, оборванный уходом со страницы (после `pagehide`: перезагрузка, переход на другой адрес, закрытие вкладки),
 * не отвечает ошибкой: слушать её уже некому, а клиент входа supabase-js (auth-js `_handleRequest`) пишет каждую
 * сетевую ошибку в console.error — живая проверка 47.2 видела «TypeError: Failed to fetch» от `auth/v1/user`, когда
 * страница уходила (чанк сборки с клиентом Supabase называется groupLinks-…js). Если страница вернётся из кэша
 * «назад/вперёд» (`pageshow`), ошибка придёт как была. Ошибки, пока страница на месте, — как всегда.
 */

export type SupabaseRoute = 'direct' | 'proxy';

export const ROUTE_STORAGE_KEY = 'meldy_supabase_route';
export const ROUTE_TTL_MS = 12 * 60 * 60 * 1000;
/** Запасной путь, выбранный из-за обрыва посреди работы (не пробой), — до новой проверки прямого. */
export const PROXY_AFTER_FAILURE_TTL_MS = 10 * 60 * 1000;
export const PROBE_TIMEOUT_MS = 4000;
/** Чтение напрямую дольше этого — адрес, видимо, «молчит» (блокировка без отказа): на запасной путь. */
export const DIRECT_READ_TIMEOUT_MS = 15000;
export const PROXY_PREFIX = '/sb';
/** Паузы перед повтором запроса, которому PostgREST ответил PGRST303 (токен «из будущего»). */
export const FUTURE_TOKEN_RETRY_MS: readonly number[] = [1000, 2000];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SupabaseFetchOptions {
  supabaseUrl: string;
  anonKey: string;
  /** Тесты подменяют сеть. */
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Адрес сайта Meldy (по умолчанию — window.location.origin). */
  origin?: () => string;
  /** Пауза перед повтором (тесты подменяют). */
  wait?: (ms: number) => Promise<void>;
  /** Где слышны `pagehide` и `pageshow` (по умолчанию — window; тесты дают свой). */
  page?: Pick<EventTarget, 'addEventListener'> | null;
  /** Есть ли у браузера сеть (по умолчанию — navigator.onLine). */
  online?: () => boolean;
}

interface Stored {
  route: SupabaseRoute;
  /** До какого момента путь в силе (мс). */
  until: number;
}

function storedRoute(now: number): Stored | null {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { route?: unknown; at?: unknown; ttl?: unknown };
    const ttl = typeof saved.ttl === 'number' && saved.ttl > 0 && saved.ttl <= ROUTE_TTL_MS ? saved.ttl : ROUTE_TTL_MS;
    const fresh = typeof saved.at === 'number' && now - saved.at >= 0 && now - saved.at < ttl;
    return fresh && (saved.route === 'direct' || saved.route === 'proxy') ? { route: saved.route, until: (saved.at as number) + ttl } : null;
  } catch {
    return null;
  }
}

/** Путь, который этот браузер уже выбрал (ещё в силе), или null, пока не выбран. */
export function preferredRoute(now: number = Date.now()): SupabaseRoute | null {
  return storedRoute(now)?.route ?? null;
}

function rememberRoute(route: SupabaseRoute, now: number, ttl: number): void {
  try {
    const saved = ttl === ROUTE_TTL_MS ? { route, at: now } : { route, at: now, ttl };
    window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Без хранилища путь выбирается заново на каждой странице — работает так же.
  }
}

const isRead = (method: string) => method === 'GET' || method === 'HEAD';

/** 401 PostgREST с кодом PGRST303: токен выдан «в будущем» по часам PostgREST, запрос не выполнялся. */
async function futureToken(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = (await response.clone().json()) as { code?: unknown } | null;
    return body?.code === 'PGRST303';
  } catch {
    return false;
  }
}

/** fetch для createClient({ global: { fetch } }): выбирает путь к Supabase. */
export function createSupabaseFetch(options: SupabaseFetchOptions): FetchLike {
  const base = new URL(options.supabaseUrl).origin;
  const rawFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const origin = options.origin ?? (() => (typeof window !== 'undefined' ? window.location.origin : ''));
  const online = options.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const saved = typeof window !== 'undefined' ? storedRoute(now()) : null;
  let route: SupabaseRoute | null = saved?.route ?? null;
  let until = saved?.until ?? 0;
  let probing: Promise<SupabaseRoute> | null = null;

  const choose = (next: SupabaseRoute, ttl: number = ROUTE_TTL_MS) => {
    route = next;
    until = now() + ttl;
    rememberRoute(next, now(), ttl);
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
    if (route && now() < until) return Promise.resolve(route);
    if (route) {
      // Время пути вышло (переход после обрыва — через 10 минут): проверить прямой заново.
      route = null;
      probing = null;
    }
    // Пробный запрос без сети ничего не говорит о блокировке: такой запасной путь — тоже до новой проверки.
    probing ??= probe().then((next) => choose(next, next === 'proxy' && (leaving || !online()) ? PROXY_AFTER_FAILURE_TTL_MS : ROUTE_TTL_MS));
    return probing;
  }

  async function routed(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
      // Страница уходит или сети нет вовсе: прямой путь тут ни при чём.
      if (leaving || !online()) throw error;
      choose('proxy', PROXY_AFTER_FAILURE_TTL_MS);
      if (isRead(method)) return rawFetch(viaSite, init);
      throw error;
    } finally {
      if (timer !== null) clearTimeout(timer);
      caller?.removeEventListener('abort', forward);
    }
  }

  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // Страница уходит: от `pagehide` до `pageshow` (возврат из кэша «назад/вперёд»).
  let leaving = false;
  const held = new Set<() => void>();
  const page = options.page !== undefined ? options.page : typeof window !== 'undefined' ? window : null;
  page?.addEventListener('pagehide', () => {
    leaving = true;
  });
  page?.addEventListener('pageshow', () => {
    leaving = false;
    const waiting = [...held];
    held.clear();
    for (const release of waiting) release();
  });

  /** Оборванный уходом запрос молчит; вернулась страница — ошибка приходит как была. */
  function heldFailure(error: unknown): Promise<never> {
    return new Promise<never>((_, reject) => {
      held.add(() => reject(error));
    });
  }

  async function sendNow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let response = await routed(input, init);
    for (const pause of FUTURE_TOKEN_RETRY_MS) {
      if (init?.signal?.aborted || !(await futureToken(response))) return response;
      await wait(pause);
      response = await routed(input, init);
    }
    return response;
  }

  async function send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      return await sendNow(input, init);
    } catch (error) {
      if (leaving) return heldFailure(error);
      throw error;
    }
  }

  return send;
}
