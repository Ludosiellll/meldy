/**
 * The code of the author's group link on this device, for «Вопрос дня» (lib/groups/questionOfDay.ts).
 *
 * The code is secret to the author: Meldy keeps only its sha256 (backend/exam_shares.py), and shows the code once,
 * when the link is made. The device where it was made keeps it (localStorage, meldy_group_links_<exam id>), and so
 * does a device where the author opened the link from the chat (the invitation page knows the link is theirs). A
 * closed link is forgotten. Every read and write is guarded: a browser that keeps nothing just has no link.
 */
import { fetchOwnShareRows, type OwnShareRow } from '../../api/examShares';
import { sha256Hex } from '../sha256';

export const GROUP_LINKS_PREFIX = 'meldy_group_links_';
/** How many links of one exam a device keeps (the newest). */
const KEEP_LINKS = 5;
const CODE_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;

export interface StoredLink {
  code: string;
  /** The link's id when it is known (made here); null when the code came from the invitation page. */
  share: string | null;
}

export function storedGroupLinks(examId: string): StoredLink[] {
  try {
    const raw = window.localStorage.getItem(GROUP_LINKS_PREFIX + examId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((item): item is { code: string; share?: unknown } => typeof item === 'object' && item !== null && CODE_RE.test(String((item as { code?: unknown }).code)))
      .map((item) => ({ code: item.code, share: typeof item.share === 'string' ? item.share : null }))
      .slice(0, KEEP_LINKS);
  } catch {
    return [];
  }
}

function writeLinks(examId: string, links: StoredLink[]): boolean {
  try {
    if (links.length === 0) window.localStorage.removeItem(GROUP_LINKS_PREFIX + examId);
    else window.localStorage.setItem(GROUP_LINKS_PREFIX + examId, JSON.stringify(links.slice(0, KEEP_LINKS)));
    return true;
  } catch {
    return false;
  }
}

/** Keeps the code of the author's link on this device (newest first). False when it is not kept. */
export function rememberGroupLink(examId: string, code: string, share: string | null = null): boolean {
  if (!examId || !CODE_RE.test(code)) return false;
  const rest = storedGroupLinks(examId).filter((link) => link.code !== code && (share === null || link.share !== share));
  return writeLinks(examId, [{ code, share }, ...rest]);
}

/** A closed link is not kept any longer. */
export function forgetGroupLink(examId: string, share: string): void {
  const links = storedGroupLinks(examId);
  const rest = links.filter((link) => link.share !== share);
  if (rest.length !== links.length) writeLinks(examId, rest);
}

// ------------------------------------------------------------------ is there a link, and its code

export interface GroupLink {
  /** The author has an open link of this exam. */
  active: boolean;
  /** The code of an open link that this device keeps; null when it keeps none. */
  code: string | null;
}

/** Matches the codes this device keeps against the open links (by id, or by the stored sha256 of the code). */
export function matchGroupLink(rows: readonly OwnShareRow[], stored: readonly StoredLink[]): GroupLink {
  const open = rows.filter((row) => row.state === 'active');
  if (open.length === 0) return { active: false, code: null };
  const hashes = stored.map((link) => ({ link, hash: sha256Hex(link.code) }));
  for (const row of open) {
    const found = hashes.find(({ link, hash }) => link.share === row.id || hash === row.codeHash);
    if (found) return { active: true, code: found.link.code };
  }
  return { active: true, code: null };
}

/** Whether the author has an open link of the exam, and its code on this device. Throws when unreadable. */
export async function groupLinkFor(examId: string): Promise<GroupLink> {
  const rows = await fetchOwnShareRows(examId);
  return matchGroupLink(rows, storedGroupLinks(examId));
}

/** https://…/join/<код> on this site. */
export function joinUrl(code: string, origin: string = window.location.origin): string {
  return `${origin}/join/${code}`;
}
