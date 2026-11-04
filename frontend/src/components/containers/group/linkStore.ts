/**
 * The code of the author's group link on this device (package D3a). Meldy keeps only the code's sha256
 * (container_links.code_hash) and shows the code once, when the link is made; the device where it was made keeps it
 * (localStorage, meldy_container_links_<container id>), so «Пригласить группу» shows the link again there. A closed
 * link's code stays (20261107090200): opened again with «Открыть снова», the link is on screen again; a code kept more
 * than a year ago goes. Every read and write is guarded: a browser that keeps nothing just has no link to show.
 */

export const CONTAINER_LINKS_PREFIX = 'meldy_container_links_';
const KEEP = 5;
/** A code kept longer than this goes (review of 04.11): a link that old is of an exam long past. */
const KEEP_MS = 365 * 24 * 60 * 60 * 1000;
const CODE = /^[0-9a-hjkmnp-tv-z]{12}$/;

export interface KeptLink {
  link: string;
  code: string;
  /** When it was kept (ms); a code kept before this was stored has none and stays until the list moves on. */
  at?: number;
}

function fresh(entry: KeptLink, now: number): boolean {
  return typeof entry.at !== 'number' || now - entry.at <= KEEP_MS;
}

export function keptLinks(containerId: string): KeptLink[] {
  try {
    const raw = window.localStorage.getItem(CONTAINER_LINKS_PREFIX + containerId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    const kept = list.filter((entry): entry is KeptLink => typeof entry?.link === 'string' && CODE.test(String(entry?.code)));
    const live = kept.filter((entry) => fresh(entry, now));
    if (live.length !== kept.length) write(containerId, live);
    return live.slice(0, KEEP);
  } catch {
    return [];
  }
}

function write(containerId: string, list: KeptLink[]): boolean {
  try {
    if (list.length === 0) window.localStorage.removeItem(CONTAINER_LINKS_PREFIX + containerId);
    else window.localStorage.setItem(CONTAINER_LINKS_PREFIX + containerId, JSON.stringify(list.slice(0, KEEP)));
    return true;
  } catch {
    return false;
  }
}

/** Keeps a new link's code on this device (newest first); false when the browser keeps nothing. */
export function keepLink(containerId: string, link: string, code: string): boolean {
  if (!CODE.test(code)) return false;
  return write(containerId, [{ link, code, at: Date.now() }, ...keptLinks(containerId).filter((entry) => entry.link !== link)]);
}

export function keptCode(containerId: string, link: string): string | null {
  return keptLinks(containerId).find((entry) => entry.link === link)?.code ?? null;
}
