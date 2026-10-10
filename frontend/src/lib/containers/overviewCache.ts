/**
 * The last containers_overview and plan_inputs on the device (package D1), for «Сегодня» and «Экзамены» without
 * network (spec decision 31). IndexedDB (lib/containers/deviceDb.ts), per account; memory fallback.
 *
 * Besides the overview, one record per account and exam keeps what the exam's own page and a session need offline:
 * the last container_summary, its plan_inputs and the oral plan items read with them (rememberContainer /
 * lastContainer, used by lib/containers/hooks.ts useContainerData). A record of another layout version is not read.
 */
import type { ContainerSummary, ContainersOverview, PlanInputsWire, Uuid } from '../../types/container';
import { deviceGet, devicePut } from './deviceDb';
import type { OralPlanPart } from './oralPlan';

export const OVERVIEW_CACHE_VERSION = 1;

interface OverviewRecord {
  v: number;
  overview: ContainersOverview;
  plan: PlanInputsWire | null;
  savedAt: number;
}

export interface ContainerRecord {
  summary: ContainerSummary;
  plan: PlanInputsWire;
  oral: OralPlanPart[];
  savedAt: number;
}

function isOverviewRecord(value: unknown): value is OverviewRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OverviewRecord>;
  return record.v === OVERVIEW_CACHE_VERSION && Boolean(record.overview) && Array.isArray(record.overview?.containers);
}

function isContainerRecord(value: unknown): value is ContainerRecord & { v: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ContainerRecord> & { v?: number };
  return (
    record.v === OVERVIEW_CACHE_VERSION &&
    Boolean(record.summary && typeof record.summary.id === 'string') &&
    Boolean(record.plan && Array.isArray(record.plan.items)) &&
    Array.isArray(record.oral)
  );
}

const containerKey = (userId: string, containerId: Uuid) => `${userId}:${containerId}`;

/**
 * Keeps the account's overview, and with it the plan inputs read for every exam (null when none was read this
 * time: the plan inputs kept earlier stay, since they are read less often than the overview).
 */
export async function rememberOverview(userId: string, overview: ContainersOverview, plan: PlanInputsWire | null): Promise<void> {
  if (!userId) return;
  let keep = plan;
  if (keep === null) {
    const stored = await deviceGet<unknown>('overviews', userId);
    keep = isOverviewRecord(stored) ? stored.plan : null;
  }
  const record: OverviewRecord = { v: OVERVIEW_CACHE_VERSION, overview, plan: keep, savedAt: Date.now() };
  await devicePut('overviews', userId, record);
}

export async function lastOverview(userId: string): Promise<{ overview: ContainersOverview; plan: PlanInputsWire | null; savedAt: number } | null> {
  if (!userId) return null;
  const stored = await deviceGet<unknown>('overviews', userId);
  return isOverviewRecord(stored) ? { overview: stored.overview, plan: stored.plan, savedAt: stored.savedAt } : null;
}

/** Keeps what one exam's page read (its summary, plan inputs and oral plan items) for this account. */
export async function rememberContainer(userId: string, containerId: Uuid, data: Omit<ContainerRecord, 'savedAt'>): Promise<void> {
  if (!userId || !containerId) return;
  await devicePut('containers', containerKey(userId, containerId), { v: OVERVIEW_CACHE_VERSION, ...data, savedAt: Date.now() });
}

export async function lastContainer(userId: string, containerId: Uuid): Promise<ContainerRecord | null> {
  if (!userId || !containerId) return null;
  const stored = await deviceGet<unknown>('containers', containerKey(userId, containerId));
  if (!isContainerRecord(stored)) return null;
  return { summary: stored.summary, plan: stored.plan, oral: stored.oral, savedAt: stored.savedAt };
}
