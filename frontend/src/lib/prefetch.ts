/**
 * Fetching ahead. Every screen is a file of its own (App.tsx), so the first screen only carries
 * itself. Two things keep the next steps quick:
 *
 * - a signed-in address fetches the shell (components/Layout) and its page together, instead of
 *   the page only once the shell has arrived; for a new account, what the guide's first run needs
 *   comes first, since it opens over the page (preloadSignedInScreen);
 * - once the first screen has loaded and the browser is idle, the screens a visitor is likely to
 *   open next are fetched one after another (prefetchLikelyNext), so on a good connection they open
 *   at once. Nothing is fetched ahead when the browser asks to save data or the connection is 2G.
 *
 * These imports name the same files as the routes in App.tsx: a file is fetched once, whoever asks.
 * A screen missing from the lists here still opens; it is just fetched when it is opened.
 */
import { confirmDialogPart } from '../contexts/ConfirmContext';
import { proWindowPart } from '../components/pro/ProWindow';
import { guideClipPart, guideSeenHere, isNewAccount } from '../components/guide/clipPart';
import { lazyPart } from './lazyPart';
import { whenIdleAfterLoad } from './idle';
import { loadSupabase, signInInAddress, storedAccountCreatedAt } from './supabaseClient';

type Loader = () => Promise<unknown>;

/** The signed-in shell (menu, guide), a file of its own: App.tsx renders it once it has arrived. */
export const layoutPart = lazyPart(() => import('../components/Layout').then((module) => module.default));

const loadLayout: Loader = () => layoutPart.load();
const loadLogin: Loader = () => import('../pages/Login');
const loadRegister: Loader = () => import('../pages/Register');
const loadTry: Loader = () => import('../pages/TryExample');

/** The five sections of the menu (components/Layout NAV_ITEMS), in its order. */
const SECTIONS: Loader[] = [
  () => import('../pages/Dashboard'),
  () => import('../pages/Exams'),
  () => import('../pages/Library'),
  () => import('../pages/Review'),
  () => import('../pages/Analytics'),
];

/** Signed-in addresses that are often the first screen, and their page; the first match wins. */
const SIGNED_IN_PAGES: ReadonlyArray<readonly [RegExp, Loader]> = [
  [/^\/dashboard\/?$/, SECTIONS[0]],
  [/^\/exams\/?$/, SECTIONS[1]],
  [/^\/library\/?$/, SECTIONS[2]],
  [/^\/review\/?$/, SECTIONS[3]],
  [/^\/analytics\/?$/, SECTIONS[4]],
  [/^\/exams\/new\/?$|^\/exams\/[^/]+\/edit\/?$/, () => import('../pages/ExamEditor')],
  [/^\/exams\/[^/]+\/draw\/?$/, () => import('../pages/ExamDraw')],
  [/^\/exams\/[^/]+\/report\/?$/, () => import('../pages/ExamReport')],
  [/^\/exams\/[^/]+\/?$/, () => import('../pages/ExamDetail')],
  [/^\/library\/[^/]+\/?$/, () => import('../pages/MaterialDetail')],
  [/^\/library\/[^/]+\/talk\/?$/, () => import('../pages/LectureTalk')],
  [/^\/analyze\/?$/, () => import('../pages/Analyze')],
  [/^\/mistakes\/?$/, () => import('../pages/MistakeDiary')],
  [/^\/knowledge-map\/?$/, () => import('../pages/KnowledgeMap')],
];

const quiet = (load: Loader) => {
  void load().catch(() => undefined);
};

/**
 * The page came over HTTP/1.x: the browser then keeps at most six requests per site in flight, so the
 * Supabase client is not crowded out and waiting for it would only add a round trip. Over HTTP/2 or 3
 * every request shares one connection, and the client — the largest file and the one the session waits
 * for — would arrive last.
 */
function sharedConnection(): boolean {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return !/^http\/1/.test(entry?.nextHopProtocol ?? '');
  } catch {
    return true;
  }
}

/**
 * The guide's first run (GuideContext) most likely opens over this screen: the guide was never
 * closed on this device, and the account is new — the session kept here says so, or the address
 * completes a sign-in (an e-mail confirmation, OAuth) before any session is kept. An older account
 * on a new device is left out: its profile almost always says the guide was seen.
 */
function firstRunLikely(): boolean {
  if (guideSeenHere()) return false;
  const createdAt = storedAccountCreatedAt();
  return createdAt !== null ? isNewAccount(createdAt) : signInInAddress();
}

/**
 * A signed-in address: fetches the shell and its page together. Over a shared connection they start
 * right after the Supabase client (the session is read with it, and the shell and every page import
 * it). Called while the session is checked; an address that is not in the list loads as before (the
 * page after the shell).
 *
 * When the guide's first run is likely, it opens first, over the page: what it needs — the client
 * (the profile says whether the guide was seen), the shell and the clips — comes first, the page
 * right after.
 */
export function preloadSignedInScreen(pathname: string): void {
  const page = SIGNED_IN_PAGES.find(([match]) => match.test(pathname));
  if (firstRunLikely()) {
    const guide = Promise.all([loadSupabase(), layoutPart.load(), guideClipPart.load()]);
    if (page) void guide.then(() => quiet(page[1]), () => quiet(page[1]));
    else void guide.catch(() => undefined);
    return;
  }
  if (!page) return;
  const both = () => {
    quiet(loadLayout);
    quiet(page[1]);
  };
  if (!sharedConnection()) {
    both();
    return;
  }
  void loadSupabase().then(both, () => undefined);
}

/**
 * The sign-in is being completed (AuthCallback), and «Сегодня» opens next: its screen is fetched
 * meanwhile, as when it is opened directly. Not with Save-Data or on 2G.
 */
export function preloadAfterSignIn(): void {
  if (typeof window !== 'undefined' && mayFetchAhead()) preloadSignedInScreen('/dashboard');
}

/** What a visitor is likely to open next from here. */
function likelyNext(pathname: string, signedIn: boolean): Loader[] {
  if (signedIn) {
    // Not «Повторение»: it brings the formula renderer, whose stylesheet declares the formula fonts.
    // Fonts declared on a page that has shown make the browser lay out and paint all its text again,
    // and that late paint would count as the page's largest paint (LCP). It loads when opened.
    const [today, exams, lectures, , progress] = SECTIONS;
    return [loadLayout, today, exams, lectures, progress, () => confirmDialogPart.load(), () => proWindowPart.load(), () => guideClipPart.load()];
  }
  if (pathname === '/') return [loadLogin, loadRegister, loadTry];
  // After signing in comes «Сегодня».
  if (pathname === '/login') return [loadRegister, loadLayout, SECTIONS[0]];
  // A new account opens the guide over «Сегодня» first (the mandatory first run).
  if (pathname === '/register') return [loadLogin, loadLayout, SECTIONS[0], () => guideClipPart.load()];
  if (pathname.startsWith('/try')) return [() => confirmDialogPart.load(), loadRegister, loadLogin];
  return [];
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

function mayFetchAhead(): boolean {
  if (import.meta.env.MODE === 'test') return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return false;
  return true;
}

/**
 * Once the first screen is idle, fetches the likely next screens one at a time (so a screen the
 * visitor opens meanwhile does not wait behind a crowd). Returns the cancel.
 */
export function prefetchLikelyNext(pathname: string, signedIn: boolean): () => void {
  if (typeof window === 'undefined' || !mayFetchAhead()) return () => undefined;
  const loaders = likelyNext(pathname, signedIn);
  if (loaders.length === 0) return () => undefined;
  let stopped = false;
  const cancel = whenIdleAfterLoad(() => {
    void (async () => {
      for (const load of loaders) {
        if (stopped) return;
        await load().catch(() => undefined);
      }
    })();
  });
  return () => {
    stopped = true;
    cancel();
  };
}
