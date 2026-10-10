/**
 * The code of the author's group link on this device (package D3a). Meldy keeps only the code's sha256
 * (container_links.code_hash) and shows the code once, when the link is made; the device where it was made keeps it
 * (localStorage, meldy_container_links_<container id>), so «Пригласить группу» shows the link again there. A closed
 * link is forgotten. Every read and write is guarded: a browser that keeps nothing just has no link to show.
 */

export const CONTAINER_LINKS_PREFIX = 'meldy_container_links_';
const KEEP = 5;
const CODE = /^[0-9a-hjkmnp-tv-z]{12}$/;

export interface KeptLink {
  link: string;
  code: string;
}

export function keptLinks(containerId: string): KeptLink[] {
  try {
    const raw = window.localStorage.getItem(CONTAINER_LINKS_PREFIX + containerId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((entry): entry is KeptLink => typeof entry?.link === 'string' && CODE.test(String(entry?.code)))
      .slice(0, KEEP);
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
  return write(containerId, [{ link, code }, ...keptLinks(containerId).filter((entry) => entry.link !== link)]);
}

export function forgetLink(containerId: string, link: string): void {
  const list = keptLinks(containerId);
  const rest = list.filter((entry) => entry.link !== link);
  if (rest.length !== list.length) write(containerId, rest);
}

export function keptCode(containerId: string, link: string): string | null {
  return keptLinks(containerId).find((entry) => entry.link === link)?.code ?? null;
}
