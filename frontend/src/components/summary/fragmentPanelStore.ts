import { useSyncExternalStore } from 'react';
import { clearFragmentUrl, fragmentPlace, writeFragmentUrl } from './fragmentPanelUrl';

/**
 * The one fragment panel of the app (owner 21.10: «открывать их в виде отдельного блока слева поверх всех блоков… и так
 * в целом во всем приложении»). A lecture fragment opened from anywhere (a term, a section of the summary, a card, a
 * question, the podcast's sheet, «Поговорить о лекции») goes into one panel: on a computer from the left over the page,
 * on a phone as a bottom sheet (FragmentPanel.tsx). There is one request at a time for the whole app, so a second
 * opening replaces the first one and two panels never stack.
 */

export interface PanelFragment {
  /** «S04», or any key unique in the request. */
  id: string;
  /** «Фрагмент 4»; null when the id has no number. */
  number: number | null;
  text: string | undefined;
  /** Word stems underlined in pencil: the words the fragment shares with what opened it. */
  stems?: readonly string[];
  /** Shown whole at once, without «Показать целиком» (the page already showed its start and asked for all of it). */
  whole?: boolean;
}

export interface FragmentPanelRequest {
  /** The component that opened the panel: it draws the panel and marks its chip. */
  owner: string;
  /** Why these fragments, in one or two short sentences. */
  note?: string;
  /** In the order of their numbers; more than one gives the switches at the top. */
  fragments: PanelFragment[];
  /** The id of the fragment on screen. */
  current: string;
  /** Where the focus goes back on close (the chip that opened the panel). */
  returnTo: HTMLElement | null;
  /**
   * The item in the address (`?frag=7&frag_for=term-2`, fragmentPanelUrl.ts): a reload or Back opens it again. Left out
   * where nothing on a reload would show the same item (the podcast's line, the tutor's turn).
   */
  urlKey?: string;
  /** Grows with each opening: the panel takes the focus again. */
  seq: number;
  /** Opened while another opening was on screen: the panel does not slide in again. */
  replaced: boolean;
}

export type FragmentPanelOpen = Omit<FragmentPanelRequest, 'owner' | 'seq' | 'replaced'>;

let state: FragmentPanelRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();
/**
 * The fragments the reader closed on this visit (fragmentPlace): an address the router kept from before the close and a
 * page wrote back with its own parameters does not open them again. Opening one by hand takes it off the list.
 */
const dismissed = new Set<string>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** The fragment as the address says it: «7», or its id when it has no number. */
export function fragmentUrlValue(fragment: Pick<PanelFragment, 'id' | 'number'>): string {
  return fragment.number === null ? fragment.id : String(fragment.number);
}

function shownValue(request: FragmentPanelRequest): string | null {
  const fragment = request.fragments.find((item) => item.id === request.current);
  return fragment ? fragmentUrlValue(fragment) : null;
}

function remember(request: FragmentPanelRequest) {
  const value = shownValue(request);
  if (!request.urlKey || value === null) return;
  dismissed.delete(fragmentPlace(request.urlKey, value));
  writeFragmentUrl(request.urlKey, value);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the reader closed this fragment of this item on this page (an old address must not open it again). */
export function fragmentDismissed(urlKey: string, value: string): boolean {
  return dismissed.has(fragmentPlace(urlKey, value));
}

/** Opens the panel for `owner`, replacing whatever it showed. */
export function openFragmentPanel(owner: string, request: FragmentPanelOpen): void {
  if (request.fragments.length === 0) return;
  seq += 1;
  const current = request.fragments.some((fragment) => fragment.id === request.current) ? request.current : request.fragments[0].id;
  // Another item's address goes before this one's is written (the same item rewrites its own).
  if (state?.urlKey && state.urlKey !== request.urlKey) clearFragmentUrl(state.urlKey);
  state = { ...request, current, owner, seq, replaced: state !== null };
  remember(state);
  emit();
}

/** Another fragment of the same request (the switches at the top of the panel). */
export function showFragment(id: string): void {
  if (!state || state.current === id || !state.fragments.some((fragment) => fragment.id === id)) return;
  state = { ...state, current: id };
  remember(state);
  emit();
}

/**
 * Closes the panel (only when `owner` still has it, if given) and gives back the element the focus returns to.
 * `byReader`: the reader closed it (×, Escape, the dim, the handle), not the page that went away.
 */
export function closeFragmentPanel(owner?: string, byReader = false): HTMLElement | null {
  if (!state || (owner !== undefined && state.owner !== owner)) return null;
  const target = state.returnTo;
  const { urlKey } = state;
  const value = shownValue(state);
  state = null;
  if (urlKey) {
    if (byReader && value !== null) dismissed.add(fragmentPlace(urlKey, value));
    clearFragmentUrl(urlKey);
  }
  emit();
  return target;
}

export function fragmentPanelState(): FragmentPanelRequest | null {
  return state;
}

export function useFragmentPanelState(): FragmentPanelRequest | null {
  return useSyncExternalStore(subscribe, fragmentPanelState, () => null);
}
