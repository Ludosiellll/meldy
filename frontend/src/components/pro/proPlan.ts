/**
 * What the PRO window reads and changes in Supabase: the account's plan (profiles.is_pro) and the free
 * demo purchase. There is no payment provider, so «Купить PRO» calls start_pro_demo and PRO is on at
 * once, for free, and the window says so; «Отключить PRO» calls stop_pro_demo (migration
 * 20261005092819_pro_demo_purchase: both act on the caller's own profile row only). The daily AI limit
 * follows on the server (100 units, 1000 with PRO); the top line is told to read it again.
 */
import { supabase } from '../../lib/supabase';
import { notifyAIUsageChanged } from '../../api/limits';

export interface ProState {
  /** null when the profile could not be read: the plan is unknown, not «free». */
  isPro: boolean | null;
}

/** Reads the plan; never throws. */
export async function loadProState(userId: string): Promise<ProState> {
  try {
    const { data, error } = await supabase.from('profiles').select('is_pro').eq('id', userId).single();
    if (error) {
      console.error('Не удалось проверить тариф:', error);
      return { isPro: null };
    }
    return { isPro: data ? Boolean((data as { is_pro?: unknown }).is_pro) : null };
  } catch (error) {
    console.error('Не удалось проверить тариф:', error);
    return { isPro: null };
  }
}

/** The kill switch of the migration: start_pro_demo then refuses everyone with this message. */
export const DEMO_CLOSED_MESSAGE = 'PRO demo closed';

/** start_pro_demo refused because the free demo is closed (not a network or server failure). */
export class ProDemoClosedError extends Error {
  constructor() {
    super(DEMO_CLOSED_MESSAGE);
    this.name = 'ProDemoClosedError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** «Купить PRO»: PRO for this account, now and for free. Returns when it was switched on. */
export async function startProDemo(): Promise<{ since: string | null }> {
  const { data, error } = await supabase.rpc('start_pro_demo');
  if (error) {
    if (String((error as { message?: unknown }).message ?? '').includes(DEMO_CLOSED_MESSAGE)) throw new ProDemoClosedError();
    throw error;
  }
  if (!isRecord(data) || data.pro !== true) throw new Error('start_pro_demo: unexpected answer');
  return { since: typeof data.since === 'string' ? data.since : null };
}

/** «Отключить PRO»: back to the free day, so the demo can be taken again. */
export async function stopProDemo(): Promise<void> {
  const { data, error } = await supabase.rpc('stop_pro_demo');
  if (error) throw error;
  if (!isRecord(data) || data.pro !== false) throw new Error('stop_pro_demo: unexpected answer');
}

/** After a plan change the top line reads the limit (100 or 1000) and the profile again. */
export function announcePlanChange(): void {
  notifyAIUsageChanged();
  try {
    window.dispatchEvent(new Event('profile_updated'));
  } catch {
    // The meter also reads the limit again on the next AI action.
  }
}
