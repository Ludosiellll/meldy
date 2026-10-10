/**
 * React hooks over the container data (package D1). They call `rememberContainerTitle` / `rememberAttachedExams`
 * (titleCache.ts) whenever an overview or summary loads, and fall back to the device's cache without network.
 *
 * - useContainersOverview: containers_overview for the device's day («Экзамены», «Сегодня»). Without network: the last
 *   one kept for this account (`offline: true`); a database without the container functions: `unavailable: true`
 *   (the screens then show exactly today's oral screens); any other failure: `error` (Russian).
 * - useContainerData: one exam — container_summary, its plan_inputs decoded into the plan's input with the oral
 *   questions and the answers still in the offline queue, and the exam's questions from the device's bank (read again
 *   only when its stamp changed). Without network: the last summary, plan inputs and oral items kept for this account
 *   and exam, with the bank on the device (`offline: true`). The oral sheet failing alone keeps the last oral items.
 *
 * Both start a flush of the offline answer queue when they mount (the queue itself flushes on `online` and when the
 * tab comes back), and read again when the network comes back after an offline read.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  CONTAINER_ERROR_TEXT, ContainerApiError, containerErrorText, fetchOverview, fetchPlanInputs, fetchSummary,
  isContainersUnavailable, isOffline,
} from '../../api/containers';
import type { ContainerSummary, ContainersOverview, PlanInput, PlanInputsWire, TestItem, Uuid } from '../../types/container';
import { localDateKey } from '../../utils/streak';
import { flushAnswers, pendingAnswers } from './answerQueue';
import { bankStamp, getBank, loadBank } from './bankCache';
import { loadOralPlanItems, type OralPlanPart } from './oralPlan';
import { lastContainer, lastOverview, rememberContainer, rememberOverview } from './overviewCache';
import { decodePlanInputs } from './planInputs';
import { rememberAttachedExams, rememberContainerTitle, type AttachedExam } from './titleCache';

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  offline: boolean; // drawn from the device's cache
  unavailable: boolean; // the database has no container functions: show today's screens
  error: string | null;
  reload: () => void;
}

export interface ContainerData {
  summary: ContainerSummary;
  planInput: PlanInput; // for this container, oral questions included; feed it to planDay (lib/containers/plan.ts)
  items: Map<Uuid, TestItem>; // the exam's questions (from the device's bank when fresh)
  oralWithoutPoints: number;
}

type State<T> = Omit<Loadable<T>, 'reload'>;

const LOADING: State<never> = { data: null, loading: true, offline: false, unavailable: false, error: null };
const SIGNED_OUT: State<never> = { data: null, loading: false, offline: false, unavailable: false, error: null };

function browserOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/** The device's IANA zone, the one its local days are counted in. */
export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const noNetwork = () => new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 });

/** Oral exam id → its container and that container's title, for the way back from the oral pages. */
export function attachedFrom(overview: ContainersOverview): Record<string, AttachedExam> {
  const map: Record<string, AttachedExam> = {};
  for (const container of overview.containers) {
    for (const subject of container.subjects ?? []) {
      if (subject.oral_exam_id) map[subject.oral_exam_id] = { containerId: container.id, title: container.title };
    }
  }
  return map;
}

function rememberOverviewTitles(overview: ContainersOverview): void {
  for (const container of overview.containers) rememberContainerTitle(container.id, container.title);
  rememberAttachedExams(attachedFrom(overview));
}

/** The summary's title, and its oral exams in the whole map (the other exams as the last overview had them). */
async function rememberSummaryTitles(userId: string, summary: ContainerSummary): Promise<void> {
  rememberContainerTitle(summary.id, summary.title);
  const last = await lastOverview(userId);
  const map = last ? attachedFrom(last.overview) : {};
  for (const [examId, entry] of Object.entries(map)) if (entry.containerId === summary.id) delete map[examId];
  for (const subject of summary.subjects) {
    if (subject.oral?.exam_id) map[subject.oral.exam_id] = { containerId: summary.id, title: summary.title };
  }
  rememberAttachedExams(map);
}

async function readOverview(userId: string): Promise<State<ContainersOverview>> {
  try {
    if (browserOffline()) throw noNetwork();
    const overview = await fetchOverview(localDateKey());
    if (overview === null) return { ...SIGNED_OUT, unavailable: true };
    rememberOverviewTitles(overview);
    await rememberOverview(userId, overview, null);
    return { ...SIGNED_OUT, data: overview };
  } catch (error) {
    if (isContainersUnavailable(error)) return { ...SIGNED_OUT, unavailable: true };
    if (!isOffline(error)) return { ...SIGNED_OUT, error: containerErrorText(error) };
    const cached = await lastOverview(userId);
    if (!cached) return { ...SIGNED_OUT, offline: true, error: containerErrorText(error) };
    rememberOverviewTitles(cached.overview);
    return { ...SIGNED_OUT, data: cached.overview, offline: true };
  }
}

/** The oral parts of an exam: the author's oral exams, or a member's own copies (none until copied). */
function oralParts(summary: ContainerSummary): Array<{ examId: Uuid; subjectId: Uuid }> {
  const parts: Array<{ examId: Uuid; subjectId: Uuid }> = [];
  for (const subject of summary.subjects) if (subject.oral?.exam_id) parts.push({ examId: subject.oral.exam_id, subjectId: subject.id });
  return parts;
}

/** The last oral items kept for these parts (the oral sheet could not be read now). */
function keptOral(kept: OralPlanPart[] | undefined, parts: Array<{ examId: Uuid }>): OralPlanPart[] {
  const wanted = new Set(parts.map((part) => part.examId));
  return (kept ?? []).filter((part) => wanted.has(part.examId));
}

/**
 * The plan's input for this exam. A subject with only an oral part in the plan takes its oral exam's date: the exam row
 * is the only owner of an oral date (spec §3 «Даты»); the test part's date is the subject's, else the exam's common one.
 */
function buildData(summary: ContainerSummary, wire: PlanInputsWire, items: TestItem[], oral: OralPlanPart[], userId: string): ContainerData {
  const planInput = decodePlanInputs(wire, {
    containerId: summary.id,
    tz: deviceZone(),
    now: Date.now(),
    pending: pendingAnswers(userId),
    oral: oral.flatMap((part) => part.items),
  });
  const withTests = new Set(planInput.items.filter((item) => item.f === 't').map((item) => item.s));
  const oralDates = new Map<string, string | null | undefined>(oral.map((part) => [part.subjectId, part.examDate]));
  planInput.subjects = planInput.subjects.map((subject) => {
    const oralDate = oralDates.get(subject.id);
    return !withTests.has(subject.id) && oralDate ? { ...subject, date: oralDate } : subject;
  });
  return {
    summary,
    planInput,
    items: new Map(items.map((item) => [item.id, item])),
    oralWithoutPoints: oral.reduce((sum, part) => sum + part.withoutPoints, 0),
  };
}

async function readContainer(userId: string, containerId: Uuid): Promise<State<ContainerData>> {
  try {
    if (browserOffline()) throw noNetwork();
    const day = localDateKey();
    const [summary, wire] = await Promise.all([fetchSummary(containerId, day), fetchPlanInputs(day, containerId)]);
    await rememberSummaryTitles(userId, summary);
    const parts = oralParts(summary);
    const kept = parts.length > 0 ? await lastContainer(userId, containerId) : null;
    const stamp = bankStamp(summary.items_version.count, summary.items_version.updated_at);
    const [items, oral] = await Promise.all([
      loadBank(containerId, stamp, summary.subjects.map((subject) => subject.id)),
      parts.length > 0 ? loadOralPlanItems(parts, Date.now(), deviceZone()).catch(() => keptOral(kept?.oral, parts)) : Promise.resolve([]),
    ]);
    await rememberContainer(userId, containerId, { summary, plan: wire, oral });
    return { ...SIGNED_OUT, data: buildData(summary, wire, items, oral, userId) };
  } catch (error) {
    if (isContainersUnavailable(error)) return { ...SIGNED_OUT, unavailable: true };
    if (!isOffline(error)) return { ...SIGNED_OUT, error: containerErrorText(error) };
    const kept = await lastContainer(userId, containerId);
    if (!kept) return { ...SIGNED_OUT, offline: true, error: containerErrorText(error) };
    try {
      await rememberSummaryTitles(userId, kept.summary);
      const bank = await getBank(containerId);
      return { ...SIGNED_OUT, data: buildData(kept.summary, kept.plan, bank?.items ?? [], kept.oral, userId), offline: true };
    } catch (failure) {
      return { ...SIGNED_OUT, offline: true, error: containerErrorText(failure) };
    }
  }
}

/** Loads with `read` for the signed-in account, again on `reload` and when the network comes back after an offline read. */
function useLoadable<T>(key: string | null, read: (userId: string) => Promise<State<T>>): Loadable<T> {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<{ key: string; state: State<T> } | null>(null);
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((value) => value + 1), []);
  const current = userId && key ? `${userId}|${key}` : null;

  useEffect(() => {
    if (authLoading || !userId || !current) return undefined;
    let alive = true;
    setState((previous) => (previous && previous.key === current ? { key: current, state: { ...previous.state, loading: true } } : previous));
    void read(userId).then(
      (next) => {
        if (alive) setState({ key: current, state: next });
      },
      (error: unknown) => {
        if (alive) setState({ key: current, state: { ...SIGNED_OUT, error: containerErrorText(error) } });
      },
    );
    void flushAnswers(userId);
    return () => {
      alive = false;
    };
    // `read` is one of the two module functions above, bound per hook: it never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, authLoading, round]);

  const shown = state && state.key === current ? state.state : null;
  const offline = shown?.offline ?? false;
  useEffect(() => {
    if (!offline || typeof window === 'undefined') return undefined;
    window.addEventListener('online', reload);
    return () => window.removeEventListener('online', reload);
  }, [offline, reload]);

  if (authLoading) return { ...LOADING, reload };
  if (!userId || !key) return { ...SIGNED_OUT, reload };
  return { ...(shown ?? LOADING), reload };
}

export function useContainersOverview(): Loadable<ContainersOverview> {
  return useLoadable<ContainersOverview>('overview', readOverview);
}

export function useContainerData(containerId: Uuid): Loadable<ContainerData> {
  const read = useCallback((userId: string) => readContainer(userId, containerId), [containerId]);
  return useLoadable<ContainerData>(containerId ? `container:${containerId}` : null, read);
}
