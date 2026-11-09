import { supabase } from '../lib/supabase';

/**
 * The request to delete one's account (migration 20261109090100_bot_support.sql): the three functions answer
 * `{requested_at: <timestamp> | null}`. The account is deleted by the author of Meldy by hand, within the days the page
 * names; until then the request can be taken back. A database without the functions (the migration not there yet)
 * answers with an error: the profile then shows no request row at all.
 */
export interface DeletionRequest {
  /** When the open request was made (ISO), or null without one. */
  requestedAt: string | null;
}

function normalize(raw: unknown): DeletionRequest {
  const at = raw && typeof raw === 'object' ? (raw as { requested_at?: unknown }).requested_at : null;
  return { requestedAt: typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null };
}

async function call(name: 'account_deletion_status' | 'account_deletion_request' | 'account_deletion_cancel'): Promise<DeletionRequest> {
  const { data, error } = await supabase.rpc(name);
  if (error) throw error;
  return normalize(data);
}

export const deletionStatus = () => call('account_deletion_status');
export const requestDeletion = () => call('account_deletion_request');
export const cancelDeletion = () => call('account_deletion_cancel');
