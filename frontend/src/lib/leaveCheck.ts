/**
 * «Можно уйти?» for actions that take the user out of the signed-in app without a link (the account menu's «Выйти»):
 * a page holding work not saved (the studio: components/studio/leave.ts) answers — it may save, ask, or say stay. At
 * most one page answers at a time; with none, the action goes on at once.
 */
type Check = () => Promise<boolean>;

let current: Check | null = null;

/** The page's answer while it holds work not saved; the returned function takes it back. */
export function setLeaveCheck(check: Check): () => void {
  current = check;
  return () => {
    if (current === check) current = null;
  };
}

/** true: go on (nothing held, saved, or «Не сохранять»); false: the user stays. A check that throws lets the user go: «Выйти» never sticks. */
export function mayLeave(): Promise<boolean> {
  if (!current) return Promise.resolve(true);
  try {
    return current().catch(() => true);
  } catch {
    return Promise.resolve(true);
  }
}
