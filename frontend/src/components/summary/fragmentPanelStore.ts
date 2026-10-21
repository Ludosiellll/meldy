import { useSyncExternalStore } from 'react';

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
  /** Grows with each opening: the panel takes the focus again. */
  seq: number;
  /** Opened while another opening was on screen: the panel does not slide in again. */
  replaced: boolean;
}

export type FragmentPanelOpen = Omit<FragmentPanelRequest, 'owner' | 'seq' | 'replaced'>;

let state: FragmentPanelRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opens the panel for `owner`, replacing whatever it showed. */
export function openFragmentPanel(owner: string, request: FragmentPanelOpen): void {
  if (request.fragments.length === 0) return;
  seq += 1;
  const current = request.fragments.some((fragment) => fragment.id === request.current) ? request.current : request.fragments[0].id;
  state = { ...request, current, owner, seq, replaced: state !== null };
  emit();
}

/** Another fragment of the same request (the switches at the top of the panel). */
export function showFragment(id: string): void {
  if (!state || state.current === id || !state.fragments.some((fragment) => fragment.id === id)) return;
  state = { ...state, current: id };
  emit();
}

/**
 * Closes the panel (only when `owner` still has it, if given) and gives back the element the focus returns to.
 */
export function closeFragmentPanel(owner?: string): HTMLElement | null {
  if (!state || (owner !== undefined && state.owner !== owner)) return null;
  const target = state.returnTo;
  state = null;
  emit();
  return target;
}

export function fragmentPanelState(): FragmentPanelRequest | null {
  return state;
}

export function useFragmentPanelState(): FragmentPanelRequest | null {
  return useSyncExternalStore(subscribe, fragmentPanelState, () => null);
}
