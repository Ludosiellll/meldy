/**
 * The open fragment in the address (owner 21.10: a reload lost what was open): `?frag=7&frag_for=term-2` while the panel
 * shows fragment 7 of the item `term-2`; a reload, or Back to the page, opens it again (useFragmentPanel). Only these
 * two parameters are touched: the page's own (the tab, the section) belong to the page.
 *
 * Written with the browser's replaceState and the entry's state kept (the router's index in it is what Telegram's
 * «Назад» reads), so opening and closing a fragment never adds a step to Back. Not through the router: its replace makes
 * a new location, and the app's shell scrolls the window to the top on every new location that is not Back
 * (Layout.useWindowScrollMemory), and the whole page would draw again; the page under the panel must not move. The
 * router keeps the address it had, so a page that writes its own parameters later may carry an old `frag` along: a
 * fragment the reader closed is not opened again from it (fragmentPanelStore, dismissed).
 */

export const FRAG_PARAM = 'frag';
export const FRAG_FOR_PARAM = 'frag_for';

function usable(): boolean {
  return typeof window !== 'undefined' && typeof window.history?.replaceState === 'function';
}

/** Changes the search of the address; `change` returns false when there is nothing to change. */
function edit(change: (params: URLSearchParams) => boolean) {
  if (!usable()) return;
  try {
    const url = new URL(window.location.href);
    if (!change(url.searchParams)) return;
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  } catch {
    // A sandboxed frame may refuse: the panel works without the address.
  }
}

/** `?frag=7&frag_for=term-2`: the fragment («7», or the id when it has no number) of the item `key`. */
export function writeFragmentUrl(key: string, fragment: string): void {
  edit((params) => {
    params.set(FRAG_PARAM, fragment);
    params.set(FRAG_FOR_PARAM, key);
    return true;
  });
}

/** Takes the two parameters away, only when they are this item's (another page's address is left alone). */
export function clearFragmentUrl(key: string): void {
  edit((params) => {
    if (params.get(FRAG_FOR_PARAM) !== key) return false;
    params.delete(FRAG_PARAM);
    params.delete(FRAG_FOR_PARAM);
    return true;
  });
}

/** The fragment the address asks this item to show, or null. */
export function readFragmentUrl(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(FRAG_FOR_PARAM) !== key) return null;
    const fragment = params.get(FRAG_PARAM);
    return fragment && fragment.trim() ? fragment.trim() : null;
  } catch {
    return null;
  }
}

/** One fragment of one item on one page: what «the reader closed it» is remembered by. */
export function fragmentPlace(key: string, fragment: string): string {
  const path = typeof window === 'undefined' ? '' : window.location.pathname;
  return `${path}|${key}|${fragment}`;
}
