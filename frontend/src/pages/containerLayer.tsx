/**
 * The exam container on today's screens («Сегодня», «Экзамены», «Прогресс»): one answer per screen to «does this account
 * have exam containers, and which», read once from package D1's `useContainersOverview`.
 *
 * The first screens of the demo come first (spec §12, «Риск номер один»): whenever the containers cannot be read — the
 * database has no container functions (an old migration), a read fails, the hook crashes, or it does not answer within
 * LAYER_WAIT — the layer is 'off' and the screens draw exactly today's page. Without network the hook answers from the
 * device's copy (`offline`), and the layer is 'on' with that copy (spec decision 31: «нет сети» is not «нет функции»).
 * A later answer still turns the layer on.
 */
import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useContainersOverview, type Loadable } from '../lib/containers/hooks';
import type { ContainersOverview, OverviewContainer, OverviewSubject } from '../types/container';

export type ContainerLayer =
  | { mode: 'loading' }
  /** Today's screens, exactly. */
  | { mode: 'off' }
  | { mode: 'on'; overview: ContainersOverview; offline: boolean };

/**
 * A container's days: the nearest date still ahead (`several` when its subjects have more than one date ahead), else
 * the last one passed (`past`), else none. A subject's date is its test part's (its own, else the container's).
 */
export function containerDays(container: Pick<OverviewContainer, 'exam_date' | 'subjects'>, today: string): { day: string | null; several: boolean; past: boolean } {
  const dates = container.subjects.map((subject) => subject.exam_date).filter((date): date is string => Boolean(date));
  if (dates.length === 0 && container.exam_date) dates.push(container.exam_date);
  const ahead = Array.from(new Set(dates.filter((date) => date >= today))).sort();
  if (ahead.length > 0) return { day: ahead[0], several: ahead.length > 1, past: false };
  if (dates.length > 0) return { day: [...dates].sort()[dates.length - 1], several: false, past: true };
  return { day: null, several: false, past: false };
}

/** How long a screen waits for the containers before it draws today's page (tests shorten it). */
export const LAYER_WAIT = { ms: 2500 };

/**
 * Draws nothing in place of a part that crashed, and says so once: a container part never takes today's page down with
 * it (React has no other way to catch an error thrown while rendering).
 */
export class QuietBoundary extends Component<{ onError?: (error: unknown) => void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('An exam container part failed; the page goes on without it:', error, info.componentStack);
    this.props.onError?.(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children ?? null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const day = (value: unknown): string | null => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

function cleanSubject(raw: unknown, index: number): OverviewSubject | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    position: count(raw.position) || index + 1,
    title: typeof raw.title === 'string' ? raw.title : '',
    exam_date: day(raw.exam_date),
    oral_exam_id: typeof raw.oral_exam_id === 'string' && raw.oral_exam_id !== '' ? raw.oral_exam_id : null,
    has_oral: raw.has_oral === true,
    keyed: count(raw.keyed),
    no_key: count(raw.no_key),
    seen: count(raw.seen),
    two_days: count(raw.two_days),
    open_errors: count(raw.open_errors),
    seen_today: count(raw.seen_today),
    doubted: count(raw.doubted),
    stale: count(raw.stale),
  };
}

function cleanContainer(raw: unknown): OverviewContainer | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || typeof raw.title !== 'string') return null;
  const subjects = (Array.isArray(raw.subjects) ? raw.subjects : []).map(cleanSubject).filter((subject): subject is OverviewSubject => subject !== null);
  const settings = isRecord(raw.settings) ? { minutes_per_day: count(raw.settings.minutes_per_day) || 60, study_weekdays: count(raw.settings.study_weekdays) || 127 } : null;
  return {
    id: raw.id,
    title: raw.title.trim() || 'Экзамен',
    // 20261019090000 (release 47.3): the author's own test is drawn as a test, and kept off «Сегодня»; absent — an exam.
    ...(raw.kind === 'test' || raw.kind === 'exam' ? { kind: raw.kind } : {}),
    exam_date: day(raw.exam_date),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    role: raw.role === 'member' ? 'member' : 'owner',
    items: count(raw.items),
    items_updated_at: typeof raw.items_updated_at === 'string' ? raw.items_updated_at : null,
    subjects,
    answers_today: count(raw.answers_today),
    settings,
  };
}

/**
 * The overview as the screens may trust it: an answer of another shape (a database ahead of or behind this client) is
 * null, so the screens stay today's; a container without an id or a title is left out.
 */
export function cleanOverview(raw: unknown): ContainersOverview | null {
  if (!isRecord(raw) || !Array.isArray(raw.containers) || !Array.isArray(raw.attached_exam_ids)) return null;
  return {
    v: 1,
    day: day(raw.day) ?? '',
    containers: raw.containers.map(cleanContainer).filter((container): container is OverviewContainer => container !== null),
    attached_exam_ids: raw.attached_exam_ids.filter((id): id is string => typeof id === 'string' && id !== ''),
  };
}

type Settled = Exclude<ContainerLayer, { mode: 'loading' }>;

/** The hook's answer as the layer; null while it has not answered. */
export function layerOf(loadable: Pick<Loadable<ContainersOverview>, 'data' | 'loading' | 'offline' | 'unavailable'> | null | undefined): Settled | null {
  if (!loadable) return { mode: 'off' };
  if (loadable.unavailable) return { mode: 'off' };
  const overview = loadable.data ? cleanOverview(loadable.data) : null;
  if (overview) return { mode: 'on', overview, offline: Boolean(loadable.offline) };
  return loadable.loading ? null : { mode: 'off' };
}

/** What a screen's choices depend on: the mode, the attached exams and whether any container exists (not the network). */
export function layerKey(layer: ContainerLayer): string {
  if (layer.mode !== 'on') return layer.mode;
  const attached = [...layer.overview.attached_exam_ids].sort().join(',');
  return `on|${layer.overview.containers.map((container) => container.id).sort().join(',')}|${attached}`;
}

/** Reads the overview and hands each answer up (and its `reload`); it draws nothing. */
function OverviewProbe({ onLayer, onReload }: { onLayer: (layer: Settled) => void; onReload?: (reload: (() => void) | null) => void }) {
  const loadable = useContainersOverview();
  const { data, loading, offline, unavailable } = loadable ?? { data: null, loading: false, offline: false, unavailable: false };
  const reload = typeof loadable?.reload === 'function' ? loadable.reload : null;
  useEffect(() => {
    onReload?.(reload);
  }, [reload, onReload]);
  useEffect(() => {
    const next = layerOf({ data, loading, offline, unavailable });
    if (next) onLayer(next);
  }, [data, loading, offline, unavailable, onLayer]);
  return null;
}

export interface ContainerLayerHandle {
  layer: ContainerLayer;
  /** Render it once anywhere in the page: it reads the containers and draws nothing. */
  probe: ReactNode;
  /** The first settled answer ('on' or 'off'; 'off' once LAYER_WAIT has passed without one). */
  settled: () => Promise<Settled>;
  /** Reads the overview again (an exam was moved on «Сегодня»). */
  reload: () => void;
}

/** The container layer of one screen. */
export function useContainerLayer(): ContainerLayerHandle {
  const [layer, setLayer] = useState<ContainerLayer>({ mode: 'loading' });
  const latest = useRef<Settled | null>(null);
  const waiters = useRef<Array<(layer: Settled) => void>>([]);

  const settle = useCallback((next: Settled) => {
    latest.current = next;
    for (const resolve of waiters.current.splice(0)) resolve(next);
    setLayer((current) => (current.mode === next.mode && layerKey(current) === layerKey(next) && sameOffline(current, next) && sameOverview(current, next) ? current : next));
  }, []);

  // Too slow: today's page now; a later answer still turns the layer on.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!latest.current) settle({ mode: 'off' });
    }, LAYER_WAIT.ms);
    return () => window.clearTimeout(timer);
  }, [settle]);

  const crashed = useCallback(() => settle({ mode: 'off' }), [settle]);
  const reloadRef = useRef<(() => void) | null>(null);
  const onReload = useCallback((next: (() => void) | null) => {
    reloadRef.current = next;
  }, []);
  const reload = useCallback(() => reloadRef.current?.(), []);

  const settled = useCallback((): Promise<Settled> => {
    if (latest.current) return Promise.resolve(latest.current);
    return new Promise((resolve) => {
      waiters.current.push(resolve);
    });
  }, []);

  const probe = (
    <QuietBoundary onError={crashed}>
      <OverviewProbe onLayer={settle} onReload={onReload} />
    </QuietBoundary>
  );
  return { layer, probe, settled, reload };
}

function sameOffline(a: ContainerLayer, b: ContainerLayer): boolean {
  return (a.mode === 'on' ? a.offline : null) === (b.mode === 'on' ? b.offline : null);
}

function sameOverview(a: ContainerLayer, b: ContainerLayer): boolean {
  return (a.mode === 'on' ? JSON.stringify(a.overview) : null) === (b.mode === 'on' ? JSON.stringify(b.overview) : null);
}
