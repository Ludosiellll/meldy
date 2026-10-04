import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { markOnboardingTourSeen } from '../../api/social';
import { GUIDE_CHAPTERS, chapterIndexFor, mayLeave, type GuideChapterId } from './chapters';

/** Remembered on this device as soon as the guide is closed (the profile keeps it for other devices). */
export const GUIDE_SEEN_KEY = 'meldy_guide_seen';
/** The profile's `onboarding_status` key. */
export const GUIDE_PROFILE_KEY = 'guide';

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    window.localStorage.setItem(GUIDE_SEEN_KEY, '1');
  } catch {
    // Private mode: the profile still remembers it.
  }
}

export interface GuideApi {
  open: boolean;
  index: number;
  /** The student opened it (the focus moves into it); false when it opened by itself. */
  asked: boolean;
  /** Opens the guide on a chapter: the given one, else the one of the page, else the first. */
  start: (id?: GuideChapterId) => void;
  close: () => void;
  /** Shows chapter `index`, and takes the app to its section when nothing on the page is in progress. */
  go: (index: number) => void;
}

const GuideContext = createContext<GuideApi | null>(null);

/** The guide of the current page; null outside the signed-in shell. */
export function useGuide(): GuideApi | null {
  return useContext(GuideContext);
}

interface ProviderProps {
  userId?: string;
  /** From the profile: true once the guide was seen on any device; null while the profile loads. */
  seenInProfile: boolean | null;
  children: ReactNode;
}

/**
 * The guide's state for the signed-in shell. It opens by itself once, on «Сегодня», for a student
 * who has not seen it; afterwards from the «?» button or the account menu. While it is open it
 * follows the student's own moves between sections and, on «Дальше», moves the app itself — but
 * never away from a page the student has typed, clicked or uploaded on.
 */
export function GuideProvider({ userId, seenInProfile, children }: ProviderProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [asked, setAsked] = useState(false);
  const seen = useRef(readSeen());
  const autoTried = useRef(false);
  /** The page the guide took the app to last; null after the student moved on their own. */
  const brought = useRef<string | null>(null);
  /** The student clicked, typed or dropped something on the page since it opened. */
  const touched = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const markSeen = useCallback(() => {
    if (seen.current) return;
    seen.current = true;
    writeSeen();
    if (userId) void Promise.resolve().then(() => markOnboardingTourSeen(userId, GUIDE_PROFILE_KEY)).catch(() => undefined);
  }, [userId]);

  const show = useCallback((id: GuideChapterId | undefined, byStudent: boolean) => {
    const byId = id ? GUIDE_CHAPTERS.findIndex((chapter) => chapter.id === id) : -1;
    const here = chapterIndexFor(pathRef.current);
    setIndex(byId >= 0 ? byId : here >= 0 ? here : 0);
    brought.current = null;
    touched.current = false;
    setAsked(byStudent);
    setOpen(true);
  }, []);
  const start = useCallback((id?: GuideChapterId) => show(id, true), [show]);

  const close = useCallback(() => {
    setOpen(false);
    markSeen();
  }, [markSeen]);

  const go = useCallback(
    (next: number) => {
      const target = GUIDE_CHAPTERS[next];
      if (!target) return;
      setIndex(next);
      const here = pathRef.current;
      if (target.match.test(here)) return;
      if (!mayLeave(here, brought.current, touched.current)) return;
      brought.current = target.route;
      touched.current = false;
      navigate(target.route);
    },
    [navigate],
  );

  // Once, on «Сегодня»: a student who has not seen the guide gets it without asking.
  useEffect(() => {
    if (autoTried.current || seenInProfile === null) return;
    if (seenInProfile || seen.current) {
      autoTried.current = true;
      return;
    }
    if (pathname !== '/dashboard') return;
    autoTried.current = true;
    // Opened by itself: it waits in the corner and leaves the focus where it was.
    show('today', false);
  }, [seenInProfile, pathname, show]);

  // The student's own move to another page: the guide follows to that section.
  useEffect(() => {
    if (!open) return;
    if (pathname === brought.current) return;
    brought.current = null;
    touched.current = false;
    const here = chapterIndexFor(pathname);
    if (here >= 0) setIndex(here);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // A click, a key or a drop inside the page marks it as in use.
  useEffect(() => {
    if (!open) return undefined;
    const mark = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.sf-main')) touched.current = true;
    };
    const events = ['pointerdown', 'keydown', 'drop', 'input'] as const;
    events.forEach((name) => document.addEventListener(name, mark, true));
    return () => events.forEach((name) => document.removeEventListener(name, mark, true));
  }, [open]);

  const api = useMemo<GuideApi>(() => ({ open, index, asked, start, close, go }), [open, index, asked, start, close, go]);
  return <GuideContext.Provider value={api}>{children}</GuideContext.Provider>;
}
