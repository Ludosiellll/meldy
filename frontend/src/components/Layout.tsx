import { Link, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, GraduationCap, Repeat, Sun, TrendingUp, type LucideIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, type UserProfile } from '../api/social';
import { ErrorBoundary } from './ErrorBoundary';
import { useTheme } from '../contexts/ThemeProvider';
import { FREE_DAILY_LIMIT } from '../api/limits';
import { countDueCards } from '../api/flashcards';
import { dailyUnits, openProWindow } from '../lib/plans';
import TokenInfoModal from './TokenInfoModal';
import QuotaMeter, { useAIQuota } from './QuotaMeter';
import RouteLoading from './RouteLoading';
import { useInstallPWA } from '../hooks/useInstallPWA';
import { GuideProvider, GUIDE_PROFILE_KEY, useGuide } from './guide/GuideContext';
import GuidePanel from './guide/GuidePanel';
import { GUIDE_CHAPTERS } from './guide/chapters';
import '../styles/paper.css';
import './layout.css';

/**
 * The shell of the interior: one line on top like the landing's navbar — the wordmark, the five
 * sections as pills, «Добавить лекцию», the daily AI limit (QuotaMeter) and the account button; on
 * phones a short line with «+» and the limit's ring, and five tabs at the bottom, an icon over a word.
 * The menu is the core of Meldy: «Сегодня», «Экзамены», «Лекции», «Повторение» (with the mistakes
 * diary) and «Прогресс» (with the knowledge map). The window scrolls (not <main>), so a page opens at
 * its top and «назад» returns to where it was.
 */

interface NavItem {
  to: string;
  label: string;
  /** The pages of the section: its item is the current one on any of them. */
  match: RegExp;
  /** The tab's picture on a phone (the top line has words only). */
  icon: LucideIcon;
  /** «Повторение 11»: the cards due today. */
  counter?: 'due';
}

/** The five sections, in the top line on a computer and as the tabs on a phone. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Сегодня', match: /^\/dashboard(\/|$)/, icon: Sun },
  { to: '/exams', label: 'Экзамены', match: /^\/exams(\/|$)/, icon: GraduationCap },
  { to: '/library', label: 'Лекции', match: /^\/library(\/|$)/, icon: BookOpen },
  { to: '/review', label: 'Повторение', match: /^\/(review|mistakes)(\/|$)/, icon: Repeat, counter: 'due' },
  { to: '/analytics', label: 'Прогресс', match: /^\/(analytics|knowledge-map)(\/|$)/, icon: TrendingUp },
];

/** The desktop line: «Сегодня · Экзамены · Лекции · Повторение 11 · Прогресс». */
export const DESK_LINKS = NAV_ITEMS;

/** The phone tabs: the same five sections. */
export const PHONE_TABS = NAV_ITEMS;

/** The section whose item is current at `pathname`, or null (the profile, the upload page, …). */
export function sectionOf(pathname: string): NavItem | null {
  return NAV_ITEMS.find((item) => item.match.test(pathname)) ?? null;
}

/** «Тянуть билет» and the answer screen are a room: the page draws its own top line, no menu (spec 4.3). */
export function isRoomPath(pathname: string): boolean {
  return /^\/exams\/[^/]+\/(draw|ticket)\/?$/.test(pathname);
}

/** Detail pages keep their one action at the bottom of the screen on phones, so the tab bar steps aside (spec 4.2). */
export function hidesBottomNav(pathname: string): boolean {
  return /^\/exams\/(new|[^/]+(\/edit)?)\/?$/.test(pathname) || /^\/library\/[^/]+\/?$/.test(pathname);
}

/**
 * On a phone a page inside a section shows «‹ Родитель» in place of the wordmark (spec 4.2): a lecture,
 * an exam sheet and its editor, the knowledge map (in «Прогресс») and the mistakes diary (in «Повторение»).
 */
export function backLinkFor(pathname: string): { to: string; label: string } | null {
  if (/^\/library\/[^/]+\/?$/.test(pathname)) return { to: '/library', label: 'Лекции' };
  const edit = /^\/exams\/([^/]+)\/edit\/?$/.exec(pathname);
  if (edit) return { to: `/exams/${edit[1]}`, label: 'Лист экзамена' };
  if (/^\/exams\/[^/]+\/?$/.test(pathname)) return { to: '/exams', label: 'Экзамены' };
  if (/^\/knowledge-map\/?$/.test(pathname)) return { to: '/analytics', label: 'Прогресс' };
  if (/^\/mistakes\/?$/.test(pathname)) return { to: '/review', label: 'Повторение' };
  return null;
}

/** What the limit line shows: never below zero; unknown when the counter could not be read. */
export function quotaRemaining(used: number | null, limit: number = FREE_DAILY_LIMIT): number | null {
  if (used === null || !Number.isFinite(used)) return null;
  return Math.max(0, limit - Math.max(0, used));
}

const STAGE_KEY = 'meldy_stage';

function readStage(): boolean {
  try {
    return window.localStorage.getItem(STAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** «Показ на проекторе» (spec 4.7): an explicit switch kept in localStorage, applied as html[data-stage]. */
function useStageMode(): [boolean, () => void] {
  const [stage, setStage] = useState(readStage);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-stage', stage);
  }, [stage]);
  const toggle = useCallback(() => {
    setStage((previous) => {
      const next = !previous;
      try {
        if (next) window.localStorage.setItem(STAGE_KEY, '1');
        else window.localStorage.removeItem(STAGE_KEY);
      } catch {
        // Private mode: the switch lasts for this page only.
      }
      return next;
    });
  }, []);
  return [stage, toggle];
}

function scrollWindowTo(top: number) {
  try {
    window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch {
    window.scrollTo(0, top);
  }
}

/**
 * The window is the scroller: a page opened by a link starts at its top; «назад» and «вперёд»
 * return to the position the page had (BrowserRouter has no ScrollRestoration of its own).
 */
function useWindowScrollMemory(locationKey: string) {
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    if (navigationType === 'POP') {
      const saved = positions.current.get(locationKey);
      if (typeof saved === 'number') scrollWindowTo(saved);
    } else {
      scrollWindowTo(0);
    }
    return () => {
      positions.current.set(locationKey, window.scrollY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey]);
}

/** The cards due today for «Повторение 11»; read again after the screens that change them. */
function useDueCount(userId: string | undefined, pathname: string): number | null {
  const [due, setDue] = useState<number | null>(null);
  const lastFetch = useRef(0);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (!userId) return;
    const from = previousPath.current;
    previousPath.current = pathname;
    const changedThings = /^\/(review|mistakes)(\/|$)|^\/exams\/[^/]+\/ticket/.test(from);
    const fresh = Date.now() - lastFetch.current < 15_000;
    if (lastFetch.current > 0 && fresh && !changedThings) return;
    lastFetch.current = Date.now();
    let cancelled = false;
    countDueCards(userId).then(
      (value) => {
        if (!cancelled) setDue(value);
      },
      () => {
        if (!cancelled) setDue(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId, pathname]);
  return due;
}

function NavCount({ value }: { value: number | null }) {
  if (!value) return null;
  // The space keeps «Повторение 11» one phrase for screen readers; the flex gap does the spacing.
  return (
    <>
      {' '}
      <span className="sf-bar-n">{value}</span>
    </>
  );
}

const THEME_CHOICES: Array<{ value: 'light' | 'dark' | 'system'; label: string }> = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Как в системе' },
];

export default function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const seenInProfile = profile ? Boolean(profile.onboarding_status?.[GUIDE_PROFILE_KEY]) : null;
  return (
    <GuideProvider userId={user?.id} seenInProfile={seenInProfile} shellHidden={isRoomPath(pathname)}>
      <Shell profile={profile} setProfile={setProfile} />
    </GuideProvider>
  );
}

function Shell({ profile, setProfile }: { profile: UserProfile | null; setProfile: (profile: UserProfile) => void }) {
  const { user, signOut } = useAuth();
  const guide = useGuide();
  const location = useLocation();
  const email = user?.email ?? '';
  const name = user?.user_metadata?.full_name || email.split('@')[0] || '';
  const initial = name ? name[0].toUpperCase() : '?';

  // Today's units and the account's day as the server counts them: 100, or 1000 with PRO (ai_quota_status).
  const quota = useAIQuota(user?.id);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const roomMode = isRoomPath(location.pathname);
  const [stageMode, toggleStageMode] = useStageMode();
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const tabsRef = useRef<HTMLElement | null>(null);
  const menuId = useId();
  // The quota's answer knows the plan first after a purchase; the profile is the fallback.
  const isPro = quota.pro ?? Boolean(profile?.is_pro);
  const planKnown = quota.pro !== null || profile !== null;
  const quotaLimit = quota.limit ?? dailyUnits(isPro);
  const remainingUnits = quotaRemaining(quota.used, quotaLimit);
  // The meter: not read — read again; a free day spent — the PRO window; otherwise what the limit is.
  const openQuota = () => {
    if (remainingUnits === null) {
      quota.refetch();
      return;
    }
    setMenuOpen(false);
    if (remainingUnits <= 0 && !isPro) {
      openProWindow('limit');
      return;
    }
    setIsTokenModalOpen(true);
  };
  const openPro = () => {
    setMenuOpen(false);
    openProWindow('meter');
  };

  const { theme, setTheme } = useTheme();
  const { handleInstallClick, showInstall } = useInstallPWA();
  const due = useDueCount(user?.id, location.pathname);

  useWindowScrollMemory(location.key);

  // A link, a tab or «назад» closes the account menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // The first run is a dialog over the app: the line, the page and the tabs cannot be reached under it.
  const blocked = Boolean(guide?.open && guide.mandatory) && !roomMode;
  const tabsShown = !hidesBottomNav(location.pathname);
  useEffect(() => {
    const parts = [barRef.current, mainRef.current, tabsRef.current];
    for (const part of parts) part?.toggleAttribute('inert', blocked);
    if (blocked) setMenuOpen(false);
    return () => {
      for (const part of parts) part?.removeAttribute('inert');
    };
  }, [blocked, tabsShown]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.focus();
    const onPointer = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    const fetchProfile = () => getProfile(userId).then(p => { if (p) setProfile(p); });
    fetchProfile();
    window.addEventListener('profile_updated', fetchProfile);

    return () => {
      window.removeEventListener('profile_updated', fetchProfile);
    };
  }, [user?.id]);

  if (roomMode) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // The guide lights up the section it talks about: its pill in the top line, its tab on a phone, or
  // «Добавить лекцию».
  const spot = guide?.open ? GUIDE_CHAPTERS[guide.index] : null;
  const spotOn = (to: string) => (spot && spot.spot === 'link' && spot.route === to ? '' : undefined);

  const avatarUrl = profile?.avatar_url;
  const back = backLinkFor(location.pathname);
  const onAnalyze = location.pathname.startsWith('/analyze');
  const current = sectionOf(location.pathname);

  const accountMenu = menuOpen && (
    <div ref={menuRef} id={menuId} className="sf-acct" role="dialog" aria-label="Меню аккаунта" tabIndex={-1}>
      <div className="sf-acct-who">
        {name ? <p className="sf-acct-name">{name}</p> : null}
        {email ? <p className="sf-acct-mail">{email}</p> : null}
      </div>
      <Link className="sf-acct-item" to="/profile">Профиль</Link>
      <button
        type="button"
        className="sf-acct-item"
        onClick={() => {
          setMenuOpen(false);
          guide?.start();
        }}
      >
        Как пользоваться Meldy
      </button>
      <div className="sf-acct-sep" />
      <div className="sf-acct-row" role="group" aria-label="Тема">
        <span className="sf-acct-label">Тема</span>
        <span className="sf-acct-themes">
          {THEME_CHOICES.map((choice) => (
            <button key={choice.value} type="button" aria-pressed={theme === choice.value} onClick={() => setTheme(choice.value)}>
              {choice.label}
            </button>
          ))}
        </span>
      </div>
      <button type="button" role="switch" aria-checked={stageMode} onClick={toggleStageMode} className="sf-acct-item">
        <span>Показ на проекторе</span>
        <span className="sf-acct-state">{stageMode ? 'вкл' : 'выкл'}</span>
      </button>
      {/* The daily limit itself is the meter in the line; here only the way to the plan. */}
      {planKnown && !isPro ? (
        <button type="button" className="sf-acct-item sf-acct-pro" onClick={openPro}>
          Что даёт PRO
        </button>
      ) : null}
      {planKnown && isPro ? (
        <button type="button" className="sf-acct-item" onClick={openPro}>
          <span>Тариф PRO</span>
          <span className="sf-acct-state">включён</span>
        </button>
      ) : null}
      {showInstall ? (
        <button type="button" className="sf-acct-item" onClick={() => void handleInstallClick()}>
          Установить приложение
        </button>
      ) : null}
      <div className="sf-acct-sep" />
      <button type="button" className="sf-acct-item" onClick={() => void signOut()}>
        Выйти
      </button>
    </div>
  );

  return (
    <div className="sf-shell" data-back={back ? '' : undefined} data-tabs={tabsShown ? '' : undefined}>
      <TokenInfoModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        usedTokens={quota.used ?? 0}
        isPro={isPro}
        limit={quotaLimit}
        onOpenPro={() => {
          setIsTokenModalOpen(false);
          openProWindow('meter');
        }}
      />

      <header ref={barRef} className="sf-bar">
        <div className="sf-bar-in">
          <Link className="sf-wordmark" to="/dashboard">
            Meldy
          </Link>
          {back ? (
            <Link className="sf-back" to={back.to}>
              <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
              <span className="sf-back-t">{back.label}</span>
            </Link>
          ) : null}
          <nav aria-label="Разделы" className="sf-bar-nav">
            {DESK_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="sf-bar-link"
                aria-current={current === item ? 'page' : undefined}
                data-guide-spot={spotOn(item.to)}
              >
                {item.label}
                {item.counter ? <NavCount value={due} /> : null}
              </Link>
            ))}
          </nav>
          <div className="sf-bar-right">
            {/* On a phone the same link is a round «+» (the words stay for screen readers). */}
            <Link className="sf-nav-cta" to="/analyze" aria-current={onAnalyze ? 'page' : undefined} data-guide-spot={spot?.spot === 'cta' ? '' : undefined}>
              <span className="sf-cta-plus" aria-hidden="true" />
              <span className="sf-cta-t">Добавить лекцию</span>
            </Link>
            <QuotaMeter
              remaining={remainingUnits}
              limit={quotaLimit}
              isPro={isPro}
              loaded={quota.loaded}
              onClick={openQuota}
              spot={spot?.spot === 'meter'}
            />
            {guide ? (
              <button
                type="button"
                className="sf-help"
                aria-label="Как пользоваться Meldy"
                aria-expanded={guide.open}
                onClick={() => (guide.open ? guide.close() : guide.start())}
              >
                ?
              </button>
            ) : null}
            <button
              ref={menuButtonRef}
              type="button"
              className="sf-me-hit"
              aria-label={name ? `${name}: профиль, тема, выход` : 'Меню аккаунта'}
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <span className="sf-me" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
              </span>
            </button>
          </div>
          {accountMenu}
        </div>
      </header>

      <main ref={mainRef} className="sf-main">
        <ErrorBoundary>
          <Suspense fallback={<RouteLoading fullScreen={false} />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      <GuidePanel />

      {tabsShown ? (
        <nav ref={tabsRef} aria-label="Разделы" className="sf-tabbar" data-testid="tab-bar">
          {PHONE_TABS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="sf-tablink"
                aria-current={current === item ? 'page' : undefined}
                data-guide-spot={spotOn(item.to)}
              >
                <span className="sf-tab-ico" aria-hidden="true">
                  <Icon strokeWidth={1.9} />
                </span>
                <span className="sf-tab-t">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
