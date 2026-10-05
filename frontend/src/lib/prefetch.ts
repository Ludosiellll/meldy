/**
 * Fetching ahead. Every screen is a file of its own (App.tsx), so the first screen only carries
 * itself. Two things keep the next steps quick:
 *
 * - a signed-in address fetches the shell (components/Layout) and its page together, instead of
 *   the page only once the shell has arrived (preloadSignedInScreen);
 * - once the first screen has loaded and the browser is idle, the screens a visitor is likely to
 *   open next are fetched one after another (prefetchLikelyNext), so on a good connection they open
 *   at once. Nothing is fetched ahead when the browser asks to save data or the connection is 2G.
 *
 * These imports name the same files as the routes in App.tsx: a file is fetched once, whoever asks.
 * A screen missing from the lists here still opens; it is just fetched when it is opened.
 */
import { confirmDialogPart } from '../contexts/ConfirmContext';
import { proWindowPart } from '../components/pro/ProWindow';
import { guideClipPart } from '../components/guide/clipPart';
import { lazyPart } from './lazyPart';
import { whenIdleAfterLoad } from './idle';

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
  [/^\/exams\/[^/]+\/?$/, () => import('../pages/ExamDetail')],
  [/^\/library\/[^/]+\/?$/, () => import('../pages/MaterialDetail')],
  [/^\/analyze\/?$/, () => import('../pages/Analyze')],
  [/^\/mistakes\/?$/, () => import('../pages/MistakeDiary')],
  [/^\/knowledge-map\/?$/, () => import('../pages/KnowledgeMap')],
];

const quiet = (load: Loader) => {
  void load().catch(() => undefined);
};

/**
 * A signed-in address: fetches the shell and the page together, right after the Supabase client
 * (the session is read with it, and the shell and every page import it, so it comes first instead
 * of sharing the line with them). Called while the session is checked; an address that is not in
 * the list loads as before (the page after the shell).
 */
export function preloadSignedInScreen(pathname: string): void {
  const page = SIGNED_IN_PAGES.find(([match]) => match.test(pathname));
  if (!page) return;
  void import('./supabase').then(
    () => {
      quiet(loadLayout);
      quiet(page[1]);
    },
    () => undefined,
  );
}

/** What a visitor is likely to open next from here. */
function likelyNext(pathname: string, signedIn: boolean): Loader[] {
  if (signedIn) {
    return [loadLayout, ...SECTIONS, () => confirmDialogPart.load(), () => proWindowPart.load(), () => guideClipPart.load()];
  }
  if (pathname === '/') return [loadLogin, loadRegister, loadTry];
  // After signing in comes «Сегодня».
  if (pathname === '/login') return [loadRegister, loadLayout, SECTIONS[0]];
  if (pathname === '/register') return [loadLogin, loadLayout, SECTIONS[0]];
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
