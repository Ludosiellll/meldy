import { Link, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, CalendarDays, GraduationCap, Repeat, TrendingUp, type LucideIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, type UserProfile } from '../api/social';
import { ErrorBoundary } from './ErrorBoundary';
import ThemeToggle from './ThemeToggle';
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
import { usePhone } from '../lib/usePhone';
import { containerOfExam, containerTitle, onContainerTitles } from '../lib/containers/titleCache';
import { useMiniApp } from '../lib/telegram/miniApp';
import GuidePulse from './guide/GuidePulse';
import '../styles/paper.css';
import './layout.css';

/**
 * The shell of the interior: one line on top like the landing's navbar — the wordmark, the five
 * sections as pills, «Разобрать лекцию» (the analysis, /analyze: 20 units — named apart from the free «Добавить
 * лекцию» of «Сегодня», which leads to the exam's lectures as text), the daily AI limit (QuotaMeter), «?» and the
 * account button; on tablets a short line with «+ Лекция», the limit's ring and «?»; on phones (up to 639 px) three
 * things only — the wordmark or «‹ Родитель», the limit's ring and the avatar (10_Project/Phone_Declutter_2026-10-08:
 * «+ Лекция» is at the top of «Лекции» and in the lectures of «Сегодня», the guide in the account menu) — and five
 * tabs at the bottom, an icon over a word («Повторение» with a badge of the cards due).
 * The menu is the core of Meldy: «Сегодня», «Экзамены», «Лекции», «Повторение» (with the mistakes
 * diary) and «Прогресс» (with the knowledge map). The window scrolls (not <main>), so a page opens at
 * its top and «назад» returns to where it was.
 *
 * Inside Telegram (lib/telegram/miniApp, meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §5) the shell
 * keeps its sections and drops what makes no sense there: «‹ Родитель» (Telegram's own «Назад» stands in:
 * components/telegram/TelegramChrome), the theme button (Telegram's scheme leads), «Показ на проекторе», the ways to
 * PRO (not sold inside Telegram), «Установить приложение» and «Выйти» (the next launch signs in again).
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

/**
 * The five sections, in the top line on a computer and as the tabs on a phone. «Сегодня» is a calendar, not the sun:
 * the sun is the theme button in the top line (2026-10-10), and one picture on a screen means one thing.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Сегодня', match: /^\/dashboard(\/|$)/, icon: CalendarDays },
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

/**
 * The exam container's pages (App.tsx): /exams/c/:id, and under it /s/:subjectId, /study, /mock, /keys, /settings and
 * «Контрольные» — the list /quizzes, «Новая контрольная» /quizzes/new, a quiz's stats /quizzes/:quizId and its settings
 * /quizzes/:quizId/edit. [1] is the container id, [2] the page under it (undefined on the exam's own page).
 */
const CONTAINER_PAGE =
  /^\/exams\/c\/([^/]+)(?:\/(s\/[^/]+|study|mock|keys|build|studio|settings|quizzes(?:\/[^/]+(?:\/edit)?)?))?\/?$/;
/** An oral exam's pages, /exams/:id and /edit, /draw, /ticket, /report; [1] is the exam id. Never c, new or import. */
const ORAL_EXAM_PAGE = /^\/exams\/(?!(?:c|new|import)(?:\/|$))([^/]+)(?:\/(?:edit|draw|ticket|report))?\/?$/;
/** A container id as ?from=c:<id> may carry it: no slash, dot or other path character. */
const CONTAINER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * «Тянуть билет», the answer screen, «Поговорить о лекции» and the report for the teacher are rooms: the
 * page draws its own top line, no menu and no tab bar (spec 4.3); the report prints without any of it. So are a
 * container's «занятие» (/exams/c/:id/study) and «Как на экзамене» (/exams/c/:id/mock).
 */
export function isRoomPath(pathname: string): boolean {
  const container = CONTAINER_PAGE.exec(pathname);
  if (container) return container[2] === 'study' || container[2] === 'mock';
  return /^\/exams\/[^/]+\/(draw|ticket|report)\/?$/.test(pathname) || /^\/library\/[^/]+\/talk\/?$/.test(pathname);
}

/**
 * Detail pages keep their one action at the bottom of the screen on phones, so the tab bar steps aside (spec 4.2):
 * also the import page, a container's subject page, «Ключи», its settings and the group link /g/:code. The
 * container's own page keeps the tabs.
 */
export function hidesBottomNav(pathname: string): boolean {
  const container = CONTAINER_PAGE.exec(pathname);
  // The exam page pins its «Начать» bar at the bottom, like an oral exam's page, so no page of a container shows tabs.
  if (container) return true;
  if (/^\/exams\/import\/?$/.test(pathname) || /^\/g\/[^/]+\/?$/.test(pathname)) return true;
  return /^\/exams\/(new|[^/]+(\/edit)?)\/?$/.test(pathname) || /^\/library\/[^/]+\/?$/.test(pathname);
}

/** «‹ Зимняя сессия» to /exams/c/<id>: the title this tab knows (lib/containers/titleCache), else «‹ Назад». */
function backToContainer(containerId: string): { to: string; label: string } {
  return { to: `/exams/c/${containerId}`, label: containerTitle(containerId) ?? 'Назад' };
}

/** The container named by ?from=c:<id> (spec decision 23), when the address carries one. */
function fromContainer(search: string): { to: string; label: string } | null {
  let from: string | null = null;
  try {
    from = new URLSearchParams(search).get('from');
  } catch {
    return null;
  }
  const id = from?.startsWith('c:') ? from.slice(2) : '';
  return CONTAINER_ID.test(id) ? backToContainer(id) : null;
}

/** The container an oral exam lives in (containers_overview, remembered by package D1), when this device knows it. */
function attachedContainer(examId: string): { to: string; label: string } | null {
  const attached = containerOfExam(examId);
  if (!attached || !CONTAINER_ID.test(attached.containerId)) return null;
  return { to: `/exams/c/${attached.containerId}`, label: containerTitle(attached.containerId) ?? attached.title };
}

/**
 * On a phone a page inside a section shows «‹ Родитель» in place of the wordmark (spec 4.2): a lecture,
 * an exam sheet and its editor, the knowledge map (in «Прогресс») and the mistakes diary (in «Повторение»).
 *
 * The exam container (spec decision 23): the pages under /exams/c/:id lead to it, «‹ <its title>»; the exam's own page
 * and the import page lead to «Экзамены». An oral exam's page (/exams/:id, /edit, /draw, /ticket, /report) leads to
 * its container when the address says ?from=c:<id>, or else when the exam lives inside a container (titleCache);
 * ?from=c:<id> also brings the import page back to the container it adds a subject to. `search` is the address's
 * query.
 */
export function backLinkFor(pathname: string, search = ''): { to: string; label: string } | null {
  const container = CONTAINER_PAGE.exec(pathname);
  if (container) return container[2] ? backToContainer(container[1]) : { to: '/exams', label: 'Экзамены' };
  if (/^\/exams\/import\/?$/.test(pathname)) return fromContainer(search) ?? { to: '/exams', label: 'Экзамены' };
  const oral = ORAL_EXAM_PAGE.exec(pathname);
  if (oral) {
    const back = fromContainer(search) ?? attachedContainer(oral[1]);
    if (back) return back;
  }
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

/** The same count on the phone tab: a small badge on the icon, «99+» above 99. */
function TabCount({ value }: { value: number | null }) {
  if (!value) return null;
  return (
    <>
      {' '}
      <span className="sf-tab-n">{value > 99 ? '99+' : value}</span>
    </>
  );
}

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
  const inTelegram = useMiniApp().status === 'on';
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
    if (remainingUnits <= 0 && !isPro && !inTelegram) {
      openProWindow('limit');
      return;
    }
    setIsTokenModalOpen(true);
  };
  const openPro = () => {
    setMenuOpen(false);
    openProWindow('meter');
  };

  const { handleInstallClick, showInstall } = useInstallPWA();
  const due = useDueCount(user?.id, location.pathname);
  const phone = usePhone();
  // A container's title can arrive after the line was drawn (its page or containers_overview remembers it): draw again.
  const [, setTitlesSeen] = useState(0);
  useEffect(() => onContainerTitles(() => setTitlesSeen((count) => count + 1)), []);

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
  // «Разобрать лекцию» — on a phone, whose line has no «+ Лекция», the «Лекции» tab (the link is at the top of its page).
  const spot = guide?.open ? GUIDE_CHAPTERS[guide.index] : null;
  const spotOn = (to: string) => (spot && spot.spot === 'link' && spot.route === to ? '' : undefined);
  const tabSpotOn = (to: string) => spotOn(to) ?? (phone && spot?.spot === 'cta' && to === '/library' ? '' : undefined);

  const avatarUrl = profile?.avatar_url;
  const back = inTelegram ? null : backLinkFor(location.pathname, location.search);
  const onAnalyze = location.pathname.startsWith('/analyze');
  const current = sectionOf(location.pathname);

  const accountMenu = menuOpen && (
    <div ref={menuRef} id={menuId} className="sf-acct" role="dialog" aria-label="Меню аккаунта" tabIndex={-1}>
      <div className="sf-acct-who">
        {name ? <p className="sf-acct-name">{name}</p> : null}
        {/* One line with «…» when it is long; the whole address in the tooltip. */}
        {email ? (
          <p className="sf-acct-mail" title={email}>
            {email}
          </p>
        ) : null}
      </div>
      <Link className="sf-acct-item" to="/profile">Профиль</Link>
      {/* The way to the guide on a phone, whose line has no «?»: the focus goes back to the account button, so the guide
          gives it back there when it closes. */}
      <button
        type="button"
        className="sf-acct-item"
        onClick={() => {
          setMenuOpen(false);
          menuButtonRef.current?.focus();
          guide?.start();
        }}
      >
        Как пользоваться Meldy
      </button>
      {inTelegram ? null : (
        <>
          <div className="sf-acct-sep" />
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
        </>
      )}
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
        onOpenPro={
          inTelegram
            ? undefined
            : () => {
                setIsTokenModalOpen(false);
                openProWindow('meter');
              }
        }
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
                {spotOn(item.to) !== undefined ? <GuidePulse /> : null}
              </Link>
            ))}
          </nav>
          <div className="sf-bar-right">
            {/* On a tablet the same link is «+ Лекция» (a round «+» where the line is short; the full words stay
                for screen readers), so it is not taken for the page's own «Новый экзамен +». A phone hides it and «?»
                (layout.css): its line is the wordmark, the limit and the avatar. */}
            <Link className="sf-nav-cta" to="/analyze" aria-current={onAnalyze ? 'page' : undefined} data-guide-spot={spot?.spot === 'cta' ? '' : undefined}>
              <span className="sf-cta-plus" aria-hidden="true" />
              <span className="sf-cta-t">Разобрать лекцию</span>
              <span className="sf-cta-short" aria-hidden="true">
                Лекция
              </span>
              {spot?.spot === 'cta' ? <GuidePulse /> : null}
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
              aria-label={name ? `${name}: ${inTelegram ? 'профиль, справка' : 'профиль, справка, выход'}` : 'Меню аккаунта'}
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <span className="sf-me" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
              </span>
            </button>
            {/* The theme in one press, right of the account (the owner asked for it there: the menu hid it). Inside
                Telegram the theme is Telegram's. */}
            {inTelegram ? null : <ThemeToggle />}
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
                data-guide-spot={tabSpotOn(item.to)}
              >
                <span className="sf-tab-ico" aria-hidden="true">
                  <Icon strokeWidth={1.9} />
                </span>
                <span className="sf-tab-t">{item.label}</span>
                {item.counter ? <TabCount value={due} /> : null}
                {tabSpotOn(item.to) !== undefined ? <GuidePulse /> : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
