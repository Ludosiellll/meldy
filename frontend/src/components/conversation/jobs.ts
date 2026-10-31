import { useEffect, useRef, useSyncExternalStore } from 'react';
import { supabase } from '../../lib/supabase';
import { errorMessage } from './persistence';

/**
 * Работы с моделью, которые живут дольше открытой вкладки.
 *
 * «Создать разговор», «Добавить схемы» и «Создать выжимку» идут по 10–30 секунд,
 * а плеер и выжимка видны только на своей вкладке. Поэтому состояние работы
 * хранится здесь, по материалу, а не в компоненте: открытый заново плеер видит
 * «Составляем разговор…», кнопка остаётся недоступной (вторую платную работу не
 * запустить), а готовые реплики доходят до того плеера, который сейчас на экране.
 */

export type JobKind = 'create' | 'visuals' | 'cheatsheet';

export type JobStatus = { state: 'idle' } | { state: 'working' } | { state: 'error'; message: string };

const IDLE: JobStatus = { state: 'idle' };
const WORKING: JobStatus = { state: 'working' };

/** Сколько показываем ошибку прошлой попытки, если её не повторили. */
const ERROR_TTL_MS = 10 * 60 * 1000;
/**
 * Дольше работа не идёт: ответ, которого сервер так и не прислал, больше не держит кнопку (и вторую платную работу)
 * до перезагрузки страницы. Разговор и схемы сервер составляет за 10–60 секунд.
 */
export const JOB_TIMEOUT_MS = 3 * 60 * 1000;
export const JOB_TIMEOUT_MESSAGE = 'Сервер не ответил. Попробуйте ещё раз.';

/** Работу остановили (лекцию удалили, из аккаунта вышли): ничего не сохраняется и ошибки нет. */
export class JobCancelled extends Error {
  constructor() {
    super('job cancelled');
    this.name = 'JobCancelled';
  }
}
class JobTimedOut extends Error {
  constructor() {
    super('job timed out');
    this.name = 'JobTimedOut';
  }
}

const statuses = new Map<string, JobStatus>();
/** Работа запущена, включая окно подтверждения энергии, когда кнопка ещё выглядит обычной. */
const running = new Set<string>();
const errorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
/** Остановка идущих работ: по ключу работы. */
const controllers = new Map<string, AbortController>();
const linesListeners = new Map<string, Set<(lines: unknown[]) => void>>();

const keyOf = (kind: JobKind, materialId: string) => `${kind}\u0000${materialId}`;

function emit() {
  listeners.forEach(listener => listener());
}

function setStatus(key: string, status: JobStatus | null) {
  const timer = errorTimers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  errorTimers.delete(key);
  if (status === null) statuses.delete(key);
  else statuses.set(key, status);
  if (status?.state === 'error') {
    errorTimers.set(
      key,
      setTimeout(() => {
        if (statuses.get(key) === status) {
          statuses.delete(key);
          errorTimers.delete(key);
          emit();
        }
      }, ERROR_TTL_MS),
    );
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function jobStatus(kind: JobKind, materialId: string | undefined): JobStatus {
  if (!materialId) return IDLE;
  return statuses.get(keyOf(kind, materialId)) ?? IDLE;
}

export function useJobStatus(kind: JobKind, materialId: string | undefined): JobStatus {
  return useSyncExternalStore(
    subscribe,
    () => jobStatus(kind, materialId),
    () => IDLE,
  );
}

export function isJobRunning(kind: JobKind, materialId: string | undefined): boolean {
  return Boolean(materialId) && running.has(keyOf(kind, materialId as string));
}

/**
 * Запускает работу один раз на материал. Пока она идёт (в том числе пока открыто
 * подтверждение энергии), повторный запуск ничего не делает. task вызывает
 * begin(), когда проверки пройдены и работа реально началась: с этого момента
 * все видят «работает». Ошибка задачи становится состоянием 'error' с понятным
 * текстом; если task вернулась, не вызвав begin() (отказ от списания энергии),
 * прежнее состояние не меняется.
 *
 * signal останавливает работу: его передают в запросы (postJson) и проверяют перед сохранением (checkJob). Работу
 * останавливают cancelJobs (лекцию удалили, из аккаунта вышли: тихо, без ошибки) и срок JOB_TIMEOUT_MS (с ошибкой
 * «Сервер не ответил»). До этого работы не останавливались ничем: висящий ответ держал кнопку до перезагрузки.
 */
export async function runJob(
  kind: JobKind,
  materialId: string,
  task: (begin: () => void, signal: AbortSignal) => Promise<void>,
  fallbackMessage: string,
): Promise<void> {
  const key = keyOf(kind, materialId);
  if (running.has(key)) return;
  running.add(key);
  watchSignOut();
  const controller = new AbortController();
  controllers.set(key, controller);
  const timer = setTimeout(() => controller.abort(new JobTimedOut()), JOB_TIMEOUT_MS);
  let began = false;
  const begin = () => {
    if (began || controller.signal.aborted) return;
    began = true;
    setStatus(key, WORKING);
  };
  try {
    await task(begin, controller.signal);
    checkJob(controller.signal);
    if (began) setStatus(key, null);
  } catch (error) {
    const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
    if (reason instanceof JobCancelled) {
      if (began) setStatus(key, null);
    } else if (reason instanceof JobTimedOut) {
      setStatus(key, { state: 'error', message: JOB_TIMEOUT_MESSAGE });
    } else {
      setStatus(key, { state: 'error', message: errorMessage(error, fallbackMessage) });
    }
  } finally {
    clearTimeout(timer);
    if (controllers.get(key) === controller) controllers.delete(key);
    running.delete(key);
  }
}

/** Бросает причину остановки, если работу остановили: перед сохранением и перед тем, как показать результат. */
export function checkJob(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new JobCancelled();
}

/**
 * Останавливает работы материала (без материала — все): их запросы прерываются, ничего не сохраняется, ошибки нет.
 * Лекцию удалили — её подкаст и выжимку некуда сохранять; из аккаунта вышли — работа шла от чужого имени.
 */
export function cancelJobs(materialId?: string): void {
  for (const [key, controller] of [...controllers]) {
    if (materialId !== undefined && key.split('\u0000')[1] !== materialId) continue;
    controllers.delete(key);
    controller.abort(new JobCancelled());
  }
}

let signOutWatched = false;
/** Выход из аккаунта останавливает все работы (подписка один раз, с первой работой). */
function watchSignOut(): void {
  if (signOutWatched) return;
  signOutWatched = true;
  try {
    supabase.auth?.onAuthStateChange?.((event) => {
      if (event === 'SIGNED_OUT') cancelJobs();
    });
  } catch {
    // Без клиента (тесты) выход не наблюдается.
  }
}

/** Новые реплики материала для плееров, которые сейчас на экране. */
export function publishLines(materialId: string, lines: unknown[]) {
  linesListeners.get(materialId)?.forEach(listener => listener(lines));
}

/** Плеер получает реплики, которые закончила работа, запущенная до того, как он открылся. */
export function useLinesFeed(materialId: string | undefined, onLines: (lines: unknown[]) => void) {
  const handler = useRef(onLines);
  handler.current = onLines;
  useEffect(() => {
    if (!materialId) return;
    const listener = (lines: unknown[]) => handler.current(lines);
    let set = linesListeners.get(materialId);
    if (!set) {
      set = new Set();
      linesListeners.set(materialId, set);
    }
    set.add(listener);
    return () => {
      const current = linesListeners.get(materialId);
      current?.delete(listener);
      if (current && current.size === 0) linesListeners.delete(materialId);
    };
  }, [materialId]);
}

/** Для тестов: забыть все работы и подписки. */
export function resetJobsForTests() {
  errorTimers.forEach(timer => clearTimeout(timer));
  errorTimers.clear();
  statuses.clear();
  running.clear();
  controllers.clear();
  linesListeners.clear();
  signOutWatched = false;
  emit();
}
