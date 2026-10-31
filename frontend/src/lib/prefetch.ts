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
import { tryTicketPart } from '../components/example/tryParts';
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

/** The screens a signed-in address may open first, by name (the names are what the tests check). */
const PAGES = {
  Dashboard: SECTIONS[0],
  Exams: SECTIONS[1],
  Library: SECTIONS[2],
  Review: SECTIONS[3],
  Analytics: SECTIONS[4],
  ImportPage: () => import('../pages/container/ImportPage'),
  ContainerPage: () => import('../pages/container/ContainerPage'),
  SubjectPage: () => import('../pages/container/SubjectPage'),
  StudyPage: () => import('../pages/container/StudyPage'),
  MockPage: () => import('../pages/container/MockPage'),
  KeysPage: () => import('../pages/container/KeysPage'),
  BuildPage: () => import('../pages/test/BuildPage'),
  StudioPage: () => import('../pages/test/StudioPage'),
  QuickTestPage: () => import('../pages/test/QuickTestPage'),
  SettingsPage: () => import('../pages/container/SettingsPage'),
  ExamEditor: () => import('../pages/ExamEditor'),
  ExamDraw: () => import('../pages/ExamDraw'),
  ExamReport: () => import('../pages/ExamReport'),
  ExamDetail: () => import('../pages/ExamDetail'),
  MaterialDetail: () => import('../pages/MaterialDetail'),
  LectureTalk: () => import('../pages/LectureTalk'),
  Analyze: () => import('../pages/Analyze'),
  MistakeDiary: () => import('../pages/MistakeDiary'),
  KnowledgeMap: () => import('../pages/KnowledgeMap'),
  Games: () => import('../pages/Games'),
} satisfies Record<string, Loader>;

export type SignedInPage = keyof typeof PAGES;

/**
 * Signed-in addresses that are often the first screen, and their page; the first match wins. The exam container's
 * pages (/exams/import, /exams/c/:id/…) come before the oral exam's /exams/:id, which would match /exams/import too.
 * /exams/new only redirects to /exams/import (App.tsx ExamsNewRedirect): it loads the import page, not the editor.
 */
const SIGNED_IN_PAGES: ReadonlyArray<readonly [RegExp, SignedInPage]> = [
  [/^\/dashboard\/?$/, 'Dashboard'],
  [/^\/exams\/?$/, 'Exams'],
  [/^\/library\/?$/, 'Library'],
  [/^\/review\/?$/, 'Review'],
  [/^\/analytics\/?$/, 'Analytics'],
  [/^\/exams\/(?:import|new)\/?$/, 'ImportPage'],
  [/^\/exams\/c\/[^/]+\/?$/, 'ContainerPage'],
  [/^\/exams\/c\/[^/]+\/s\/[^/]+\/?$/, 'SubjectPage'],
  [/^\/exams\/c\/[^/]+\/study\/?$/, 'StudyPage'],
  [/^\/exams\/c\/[^/]+\/mock\/?$/, 'MockPage'],
  [/^\/exams\/c\/[^/]+\/keys\/?$/, 'KeysPage'],
  [/^\/exams\/c\/[^/]+\/build\/?$/, 'BuildPage'],
  [/^\/exams\/c\/[^/]+\/studio\/?$/, 'StudioPage'],
  [/^\/tests\/quick\/?$/, 'QuickTestPage'],
  [/^\/exams\/c\/[^/]+\/settings\/?$/, 'SettingsPage'],
  [/^\/exams\/[^/]+\/edit\/?$/, 'ExamEditor'],
  [/^\/exams\/[^/]+\/draw\/?$/, 'ExamDraw'],
  [/^\/exams\/[^/]+\/report\/?$/, 'ExamReport'],
  [/^\/exams\/[^/]+\/?$/, 'ExamDetail'],
  [/^\/library\/[^/]+\/?$/, 'MaterialDetail'],
  [/^\/library\/[^/]+\/talk\/?$/, 'LectureTalk'],
  [/^\/analyze\/?$/, 'Analyze'],
  [/^\/mistakes\/?$/, 'MistakeDiary'],
  [/^\/knowledge-map\/?$/, 'KnowledgeMap'],
  [/^\/games\/?$/, 'Games'],
];

/** The page a signed-in address fetches together with the shell, or null (it then loads after the shell). */
export function signedInPageOf(pathname: string): SignedInPage | null {
  return SIGNED_IN_PAGES.find(([match]) => match.test(pathname))?.[1] ?? null;
}

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
  const name = signedInPageOf(pathname);
  const page = name ? PAGES[name] : null;
  if (firstRunLikely()) {
    const guide = Promise.all([loadSupabase(), layoutPart.load(), guideClipPart.load()]);
    if (page) void guide.then(() => quiet(page), () => quiet(page));
    else void guide.catch(() => undefined);
    return;
  }
  if (!page) return;
  const both = () => {
    quiet(loadLayout);
    quiet(page);
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
  // The example's next step, whoever opened it: the answer room (components/example/tryParts).
  const trySteps: Loader[] = pathname.startsWith('/try') ? [() => tryTicketPart.load()] : [];
  if (signedIn) {
    // Not «Повторение»: it brings the formula renderer, whose stylesheet declares the formula fonts.
    // Fonts declared on a page that has shown make the browser lay out and paint all its text again,
    // and that late paint would count as the page's largest paint (LCP). It loads when opened.
    const [today, exams, lectures, , progress] = SECTIONS;
    return [...trySteps, loadLayout, today, exams, lectures, progress, () => confirmDialogPart.load(), () => proWindowPart.load(), () => guideClipPart.load()];
  }
  // The landing fetches nothing at idle: on a phone those screens cost more than the landing itself (landing v3,
  // 2026-10-20). It fetches a screen when the visitor points at or touches a link to it (prefetchLink).
  if (pathname === '/') return [];
  // After signing in comes «Сегодня».
  if (pathname === '/login') return [loadRegister, loadLayout, SECTIONS[0]];
  // A new account opens the guide over «Сегодня» first (the mandatory first run).
  if (pathname === '/register') return [loadLogin, loadLayout, SECTIONS[0], () => guideClipPart.load()];
  if (pathname.startsWith('/try')) return [...trySteps, () => confirmDialogPart.load(), loadRegister, loadLogin];
  return [];
}

/** The screens a link on the landing leads to, by the link's path (a public test's /k/<код> is one screen). */
const BY_LINK = {
  '/login': loadLogin,
  '/register': loadRegister,
  '/try': loadTry,
  '/k': () => import('../pages/quiz/QuizTakePage'),
} satisfies Record<string, Loader>;
export type LinkScreen = keyof typeof BY_LINK;

/** Which of those screens a link's address opens, or null. */
export function screenOfLink(href: string): LinkScreen | null {
  const path = href.startsWith('/k/') ? '/k' : href.split(/[?#]/)[0];
  return path in BY_LINK ? (path as LinkScreen) : null;
}

const linked = new Set<LinkScreen>();

/**
 * Fetches the screen a link leads to, once, when the visitor shows the intent to open it (a pointer over the link, a
 * touch, keyboard focus): a few hundred milliseconds ahead of the click, and nothing at idle. On a phone the landing's
 * reel and the small studio take all the processor has; the files of Login, Register and /try, with the stylesheets
 * that make the browser restyle the whole page, came in the middle of them (phone measurements 2026-10-19 and -20).
 */
export function prefetchLink(href: string): void {
  if (typeof window === 'undefined' || !mayFetchAhead()) return;
  const screen = screenOfLink(href);
  if (!screen || linked.has(screen)) return;
  linked.add(screen);
  void BY_LINK[screen]().catch(() => linked.delete(screen));
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
 * visitor opens meanwhile does not wait behind a crowd). The landing has none: its links fetch their
 * screen on the visitor's intent (prefetchLink). Returns the cancel.
 */
export function prefetchLikelyNext(pathname: string, signedIn: boolean): () => void {
  if (typeof window === 'undefined' || !mayFetchAhead()) return () => undefined;
  const loaders = likelyNext(pathname, signedIn);
  if (loaders.length === 0) return () => undefined;
  let stopped = false;
  const fetchAll = () => {
    void (async () => {
      for (const load of loaders) {
        if (stopped) return;
        await load().catch(() => undefined);
      }
    })();
  };
  const cancel = whenIdleAfterLoad(fetchAll);
  return () => {
    stopped = true;
    cancel();
  };
}
