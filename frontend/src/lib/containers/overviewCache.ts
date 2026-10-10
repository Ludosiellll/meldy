/**
 * The last containers_overview and plan_inputs on the device (package D1), for «Сегодня» and «Экзамены» without
 * network (spec decision 31). IndexedDB, per account; memory fallback.
 */
import type { ContainersOverview, PlanInputsWire } from '../../types/container';

function notBuilt(name: string): never {
  throw new Error(`lib/containers/overviewCache.${name}: not built yet (package D1)`);
}

export async function rememberOverview(_userId: string, _overview: ContainersOverview, _plan: PlanInputsWire | null): Promise<void> { return notBuilt('rememberOverview'); }
export async function lastOverview(_userId: string): Promise<{ overview: ContainersOverview; plan: PlanInputsWire | null; savedAt: number } | null> { return notBuilt('lastOverview'); }
