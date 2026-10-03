import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, type UserProfile } from '../api/social';
import { getUnreadCount, subscribeToNotifications, getNotifications, markAllRead, type Notification, getUnreadDMsGrouped } from '../api/chat';
import { ErrorBoundary } from './ErrorBoundary';
import { useTheme } from '../contexts/ThemeProvider';
import { AI_USAGE_EVENT, checkAILimit, FREE_DAILY_LIMIT } from '../api/limits';
import { countDueCards } from '../api/flashcards';
import { supabase } from '../lib/supabase';
import TokenInfoModal from './TokenInfoModal';
import RouteLoading from './RouteLoading';
import { useInstallPWA } from '../hooks/useInstallPWA';
import '../styles/paper.css';

/**
 * The shell of the interior (redesign spec 4.1–4.2): one flat top line like the landing's navbar —
 * the wordmark, six text links, «Добавить лекцию» and the account button; on phones a 52 px line
 * and four text tabs at the bottom. No sidebar, no icons in the menu, no capitals, no badges.
 * The window scrolls (not <main>), so a page opens at its top and «назад» returns to where it was.
 */

type Counter = 'due' | 'mistakes';

interface NavItem {
  to: string;
  label: string;
  counter?: Counter;
}

/** The desktop line: «Сегодня · Экзамены · Библиотека · Повторение 11 · Дневник ошибок 5 · Прогресс». */
export const DESK_LINKS: NavItem[] = [
  { to: '/dashboard', label: 'Сегодня' },
  { to: '/exams', label: 'Экзамены' },
  { to: '/library', label: 'Библиотека' },
  { to: '/review', label: 'Повторение', counter: 'due' },
  { to: '/mistakes', label: 'Дневник ошибок', counter: 'mistakes' },
  { to: '/analytics', label: 'Прогресс' },
];

/** The phone tab bar: the same words, four of them; the rest lives in the account menu. */
export const PHONE_TABS: NavItem[] = DESK_LINKS.slice(0, 4);

/** «Тянуть билет» and the answer screen are a room: the page draws its own top line, no menu (spec 4.3). */
export function isRoomPath(pathname: string): boolean {
  return /^\/exams\/[^/]+\/(draw|ticket)\/?$/.test(pathname);
}

/** Detail pages keep their one action at the bottom of the screen on phones, so the tab bar steps aside (spec 4.2). */
export function hidesBottomNav(pathname: string): boolean {
  return /^\/exams\/(new|[^/]+(\/edit)?)\/?$/.test(pathname) || /^\/library\/[^/]+\/?$/.test(pathname);
}

/** On a phone a detail page shows «‹ Родитель» in place of the wordmark (spec 4.2). */
export function backLinkFor(pathname: string): { to: string; label: string } | null {
  if (/^\/library\/[^/]+\/?$/.test(pathname)) return { to: '/library', label: 'Библиотека' };
  const edit = /^\/exams\/([^/]+)\/edit\/?$/.exec(pathname);
  if (edit) return { to: `/exams/${edit[1]}`, label: 'Лист экзамена' };
  if (/^\/exams\/[^/]+\/?$/.test(pathname)) return { to: '/exams', label: 'Экзамены' };
  return null;
}

/** Screens built as one full-height pane (they size themselves with h-full): the main area gets a height. */
function isPanePath(pathname: string): boolean {
  return /^\/(messages|chat)(\/|$)/.test(pathname);
}

/** What the limit line shows: never below zero; unknown when the counter could not be read. */
export function quotaRemaining(used: number | null): number | null {
  if (used === null || !Number.isFinite(used)) return null;
  return Math.max(0, FREE_DAILY_LIMIT - Math.max(0, used));
}

/** Open entries of the mistake diary (a HEAD request, no rows are transferred). */
async function countOpenMistakes(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('mistake_diary')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_resolved', false);
  if (error) throw error;
  return typeof count === 'number' && count > 0 ? count : 0;
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

/** Due cards and open mistakes for the counters of the line; refreshed after the screens that change them. */
function useNavCounters(userId: string | undefined, pathname: string) {
  const [counts, setCounts] = useState<Record<Counter, number | null>>({ due: null, mistakes: null });
  const lastFetch = useRef(0);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (!userId) return;
    const from = previousPath.current;
    previousPath.current = pathname;
    const changedThings = /^\/(review|mistakes|study-session)(\/|$)|^\/exams\/[^/]+\/ticket/.test(from);
    const fresh = Date.now() - lastFetch.current < 15_000;
    if (lastFetch.current > 0 && fresh && !changedThings) return;
    lastFetch.current = Date.now();
    let cancelled = false;
    Promise.allSettled([countDueCards(userId), countOpenMistakes(userId)]).then(([due, mistakes]) => {
      if (cancelled) return;
      setCounts({
        due: due.status === 'fulfilled' ? due.value : null,
        mistakes: mistakes.status === 'fulfilled' ? mistakes.value : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, pathname]);
  return counts;
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

function notificationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

const THEME_CHOICES: Array<{ value: 'light' | 'dark' | 'system'; label: string }> = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Как в системе' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = user?.email ?? '';
  const name = user?.user_metadata?.full_name || email.split('@')[0] || '';
  const initial = name ? name[0].toUpperCase() : '?';

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  /** Units used today; null while unknown (not read yet, or the counter could not be read). */
  const [usedTokens, setUsedTokens] = useState<number | null>(null);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const roomMode = isRoomPath(location.pathname);
  const [stageMode, toggleStageMode] = useStageMode();
  const refetchTokensRef = useRef<(() => void) | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const remainingUnits = quotaRemaining(usedTokens);
  const quotaLabel = profile?.is_pro
    ? 'Дневной лимит к аккаунту PRO не применяется'
    : remainingUnits === null
      ? 'Дневной лимит: остаток не удалось загрузить. Нажмите, чтобы проверить ещё раз'
      : `Дневной лимит: осталось ${remainingUnits} из ${FREE_DAILY_LIMIT}`;
  const quotaState = profile?.is_pro
    ? 'без лимита'
    : remainingUnits === null
      ? 'проверить'
      : `осталось ${remainingUnits} из ${FREE_DAILY_LIMIT}`;
  const openQuota = () => {
    if (!profile?.is_pro && usedTokens === null) {
      refetchTokensRef.current?.();
      return;
    }
    setMenuOpen(false);
    setIsTokenModalOpen(true);
  };

  const { theme, setTheme } = useTheme();
  const { handleInstallClick, showInstall } = useInstallPWA();
  const counters = useNavCounters(user?.id, location.pathname);

  useWindowScrollMemory(location.key);

  // A link, a tab or «назад» closes the account menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) {
      setNotificationsOpen(false);
      return;
    }
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

    const fetchUnread = () => {
      getUnreadCount(userId).then(setUnreadCount).catch(() => undefined);
      getUnreadDMsGrouped(userId)
        .then(counts => setUnreadDMs(Object.values(counts).reduce((a, b) => a + b, 0)))
        .catch(() => undefined);
    };
    fetchUnread();
    window.addEventListener('notification_read', fetchUnread);
    // New notifications only refresh the counts: the pop-ups led to hidden sections (decision 2026-10-02).
    const unsub = subscribeToNotifications(userId, fetchUnread);

    let tokensRequest = 0;
    const fetchTokens = () => {
      const request = ++tokensRequest;
      checkAILimit(userId, 0)
        .then((res) => {
          if (request === tokensRequest) setUsedTokens(res.ok ? res.count : null);
        })
        .catch(() => {
          if (request === tokensRequest) setUsedTokens(null);
        });
    };
    fetchTokens();
    refetchTokensRef.current = fetchTokens;
    window.addEventListener(AI_USAGE_EVENT, fetchTokens);

    return () => {
      tokensRequest += 1;
      refetchTokensRef.current = null;
      window.removeEventListener('profile_updated', fetchProfile);
      window.removeEventListener('notification_read', fetchUnread);
      window.removeEventListener(AI_USAGE_EVENT, fetchTokens);
      unsub();
    };
  }, [user?.id]);

  const toggleNotifications = async () => {
    if (!user) return;
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (!opening) return;
    try {
      const list = await getNotifications(user.id);
      setNotifications(list);
      if (unreadCount > 0) {
        await markAllRead(user.id);
        setUnreadCount(0);
        setNotifications(prev => (prev ?? []).map(n => ({ ...n, is_read: true })));
      }
    } catch {
      setNotifications([]);
    }
  };

  const openNotification = (item: Notification) => {
    setMenuOpen(false);
    if (item.type === 'message') navigate(item.related_id ? `/messages/${item.related_id}` : '/messages');
    else if (item.type === 'friend_request') navigate('/profile');
  };

  if (roomMode) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    );
  }

  const avatarUrl = profile?.avatar_url;
  const isTeacher = profile?.role === 'teacher';
  const back = backLinkFor(location.pathname);
  const tabsShown = !hidesBottomNav(location.pathname);
  const pane = isPanePath(location.pathname);
  const onAnalyze = location.pathname.startsWith('/analyze');

  const accountMenu = menuOpen && (
    <div ref={menuRef} id={menuId} className="sf-acct" role="dialog" aria-label="Меню аккаунта" tabIndex={-1}>
      <div className="sf-acct-who">
        {name ? <p className="sf-acct-name">{name}</p> : null}
        {email ? <p className="sf-acct-mail">{email}</p> : null}
      </div>
      <Link className="sf-acct-item" to="/profile">Профиль</Link>
      {/* On a phone these three are not in the tab bar. */}
      <Link className="sf-acct-item sf-acct-phone" to="/mistakes">
        <span>Дневник ошибок</span>
        <NavCount value={counters.mistakes} />
      </Link>
      <Link className="sf-acct-item sf-acct-phone" to="/analytics">Прогресс</Link>
      <Link className="sf-acct-item sf-acct-phone" to="/analyze">Добавить лекцию</Link>
      {isTeacher ? (
        <>
          <Link className="sf-acct-item" to="/teacher">Мои группы</Link>
          <Link className="sf-acct-item" to="/messages">
            <span>Диалоги и друзья</span>
            <NavCount value={unreadDMs} />
          </Link>
        </>
      ) : null}
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
      <button type="button" className="sf-acct-item" onClick={openQuota} aria-label={quotaLabel} data-testid="quota-meter">
        <span>Дневной лимит</span>
        <span className="sf-acct-state">{quotaState}</span>
      </button>
      <button type="button" className="sf-acct-item" aria-expanded={notificationsOpen} onClick={() => void toggleNotifications()}>
        <span>Уведомления</span>
        <NavCount value={unreadCount} />
      </button>
      {notificationsOpen ? (
        <div className="sf-acct-notes">
          {notifications === null ? (
            <p className="sf-acct-quiet">Загружаем…</p>
          ) : notifications.length === 0 ? (
            <p className="sf-acct-quiet">Новых уведомлений нет</p>
          ) : (
            <ul>
              {notifications.map((item) => (
                <li key={item.id}>
                  <button type="button" className="sf-acct-note" onClick={() => openNotification(item)}>
                    <span className="sf-acct-note-t">{item.title}</span>
                    {item.body ? <span className="sf-acct-quiet">{item.body}</span> : null}
                    <span className="sf-acct-quiet">{notificationDate(item.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
        usedTokens={usedTokens ?? 0}
        isPro={profile?.is_pro}
      />

      <header className="sf-bar">
        <div className="sf-bar-in">
          <Link className="sf-wordmark" to="/dashboard">
            Meldy
          </Link>
          {back ? (
            <Link className="sf-back" to={back.to}>
              <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
              {back.label}
            </Link>
          ) : null}
          <nav aria-label="Разделы" className="sf-bar-nav">
            {DESK_LINKS.map((item) => (
              <NavLink key={item.to} to={item.to} className="sf-bar-link">
                {item.label}
                {item.counter ? <NavCount value={counters[item.counter]} /> : null}
              </NavLink>
            ))}
          </nav>
          <div className="sf-bar-right">
            <Link className="sf-nav-cta" to="/analyze" aria-current={onAnalyze ? 'page' : undefined}>
              Добавить лекцию
            </Link>
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
              {unreadCount > 0 ? <span className="sr-only">, есть новые уведомления</span> : null}
            </button>
          </div>
          {accountMenu}
        </div>
      </header>

      <main className="sf-main" data-pane={pane ? '' : undefined}>
        <ErrorBoundary>
          <Suspense fallback={<RouteLoading fullScreen={false} />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {tabsShown ? (
        <nav aria-label="Разделы" className="sf-tabbar" data-testid="tab-bar">
          {PHONE_TABS.map((item) => (
            <NavLink key={item.to} to={item.to} className="sf-tablink">
              {item.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
