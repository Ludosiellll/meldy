/**
 * The goal a person chose at the start (UX audit of 21.10): «Готовлюсь к экзамену» or «Даю тест ученикам», in the
 * first-run guide's first card. «Первые шаги» on «Сегодня» then lead with that goal's door. Kept on this device per
 * account; a choice nobody made is null (both doors stand equal, the exam's first as before).
 */
export type Goal = 'exam' | 'test';

export const GOAL_KEY_PREFIX = 'meldy_goal:';

export function readGoal(userId: string | null | undefined): Goal | null {
  if (!userId) return null;
  try {
    const value = window.localStorage.getItem(GOAL_KEY_PREFIX + userId);
    return value === 'exam' || value === 'test' ? value : null;
  } catch {
    return null;
  }
}

export function writeGoal(userId: string | null | undefined, goal: Goal): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(GOAL_KEY_PREFIX + userId, goal);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}
