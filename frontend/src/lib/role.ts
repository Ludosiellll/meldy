/**
 * Who the account is for the app's first screen and menu: a student or a teacher (advice at the final of 20.11; the
 * owner, 21.11: «разделить преподавателей и учеников… функции сохраняются и там и там, но преподавателю облегчить»).
 * Every function stays open to both; the role picks the home page (/teach or «Сегодня») and the menu's items.
 *
 * Kept in the profile's onboarding flags (profiles.onboarding_status: `role_asked`, `teacher`), so it follows the
 * account to another device, and mirrored on this device so the right page opens before the profile is read. null —
 * the account has not been asked yet.
 */
import { useSyncExternalStore } from 'react';
import { getProfile, updateProfile } from '../api/social';

export type Role = 'student' | 'teacher';

export const ROLE_ASKED_FLAG = 'role_asked';
export const ROLE_TEACHER_FLAG = 'teacher';

const key = (userId: string) => `meldy:role:${userId}`;
const listeners = new Set<() => void>();
/** Accounts whose profile has answered in this tab: before that, «not asked» may only mean «not read yet». */
const known = new Set<string>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The role this device remembers for the account; null — none. */
export function storedRole(userId: string | null | undefined): Role | null {
  if (!userId) return null;
  try {
    const value = localStorage.getItem(key(userId));
    return value === 'teacher' || value === 'student' ? value : null;
  } catch {
    return null;
  }
}

function remember(userId: string, role: Role): void {
  try {
    localStorage.setItem(key(userId), role);
  } catch {
    /* storage shut: the role then lasts until the profile is read again */
  }
}

/** The role the profile's flags say; null — the account was never asked. */
export function roleOfFlags(flags: Record<string, boolean> | null | undefined): Role | null {
  if (!flags || !flags[ROLE_ASKED_FLAG]) return null;
  return flags[ROLE_TEACHER_FLAG] ? 'teacher' : 'student';
}

/** The profile has been read: its answer wins over this device's memory; no answer there leaves the memory as it is. */
export function syncRole(userId: string, flags: Record<string, boolean> | null | undefined): void {
  const role = roleOfFlags(flags);
  if (role) remember(userId, role);
  known.add(userId);
  notify();
}

/** The choice: on this device at once, in the profile after it (a failed write leaves the device's memory). */
export async function saveRole(userId: string, role: Role): Promise<void> {
  remember(userId, role);
  known.add(userId);
  notify();
  try {
    const profile = await getProfile(userId);
    if (!profile) return;
    const flags = { ...(profile.onboarding_status ?? {}), [ROLE_ASKED_FLAG]: true, [ROLE_TEACHER_FLAG]: role === 'teacher' };
    await updateProfile(userId, { onboarding_status: flags });
  } catch {
    /* the device remembers; the next choice writes again */
  }
}

/** The account's role, live: null while it has none. */
export function useRole(userId: string | null | undefined): Role | null {
  return useSyncExternalStore(subscribe, () => storedRole(userId), () => null);
}

/** Whether the account may be asked now: its profile has answered and holds no role, and this device remembers none. */
export function useRoleUnasked(userId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(userId && known.has(userId) && storedRole(userId) === null),
    () => false,
  );
}

/** Tests: forget what the tab has learnt. */
export function resetRoleMemory(): void {
  known.clear();
  notify();
}
