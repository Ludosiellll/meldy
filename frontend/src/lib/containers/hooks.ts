/**
 * React hooks over the container data (package D1). They call `rememberContainerTitle` / `rememberAttachedExams`
 * (titleCache.ts) whenever an overview or summary loads, and fall back to the device's cache without network.
 */
import type { ContainerSummary, ContainersOverview, PlanInput, TestItem, Uuid } from '../../types/container';

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

function notBuilt(name: string): never {
  throw new Error(`lib/containers/hooks.${name}: not built yet (package D1)`);
}

export function useContainersOverview(): Loadable<ContainersOverview> { return notBuilt('useContainersOverview'); }
export function useContainerData(_containerId: Uuid): Loadable<ContainerData> { return notBuilt('useContainerData'); }
