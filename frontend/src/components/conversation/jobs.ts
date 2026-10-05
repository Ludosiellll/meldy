import { useEffect, useRef, useSyncExternalStore } from 'react';
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

const statuses = new Map<string, JobStatus>();
/** Работа запущена, включая окно подтверждения энергии, когда кнопка ещё выглядит обычной. */
const running = new Set<string>();
const errorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
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
 */
export async function runJob(
  kind: JobKind,
  materialId: string,
  task: (begin: () => void) => Promise<void>,
  fallbackMessage: string,
): Promise<void> {
  const key = keyOf(kind, materialId);
  if (running.has(key)) return;
  running.add(key);
  let began = false;
  const begin = () => {
    if (began) return;
    began = true;
    setStatus(key, WORKING);
  };
  try {
    await task(begin);
    if (began) setStatus(key, null);
  } catch (error) {
    setStatus(key, { state: 'error', message: errorMessage(error, fallbackMessage) });
  } finally {
    running.delete(key);
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
  linesListeners.clear();
  emit();
}
