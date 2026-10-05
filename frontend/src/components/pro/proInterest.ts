/**
 * What the PRO window reads and writes in Supabase: the account's plan (profiles.is_pro) and the
 * «Сообщить, когда появится» note (table pro_interest, migration
 * 20261004204007_pro_interest: one row per account, the owner adds and reads it, nobody changes it).
 */
import { supabase } from '../../lib/supabase';
import type { ProReason } from '../../lib/plans';

export interface ProState {
  /** null when the profile could not be read: the plan is unknown, not «free». */
  isPro: boolean | null;
  /** The account already asked to be told; false also when that could not be read. */
  interested: boolean;
}

/** Reads the plan and the note together; never throws. */
export async function loadProState(userId: string): Promise<ProState> {
  const [profile, interest] = await Promise.all([
    Promise.resolve(supabase.from('profiles').select('is_pro').eq('id', userId).single()).catch((error: unknown) => ({ data: null, error })),
    Promise.resolve(supabase.from('pro_interest').select('user_id').eq('user_id', userId).maybeSingle()).catch((error: unknown) => ({ data: null, error })),
  ]);
  if (profile.error) console.error('Не удалось проверить тариф:', profile.error);
  const isPro = profile.error || !profile.data ? null : Boolean((profile.data as { is_pro?: unknown }).is_pro);
  return { isPro, interested: !interest.error && Boolean(interest.data) };
}

/**
 * Notes that the account wants PRO once payment works. A second note is a unique violation (23505)
 * of the one-row-per-account key: that means «already noted», not an error.
 */
export async function recordProInterest(userId: string, reason: ProReason): Promise<'recorded' | 'already'> {
  const { error } = await supabase.from('pro_interest').insert({ user_id: userId, reason });
  if (!error) return 'recorded';
  if ((error as { code?: string }).code === '23505') return 'already';
  throw error;
}
