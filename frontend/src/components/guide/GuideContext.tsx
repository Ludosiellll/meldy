import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { markOnboardingTourSeen } from '../../api/social';
import { useAuth } from '../../hooks/useAuth';
import { GUIDE_CHAPTERS, chapterIndexFor, mayLeave, type GuideChapter, type GuideChapterId } from './chapters';
import { GUIDE_SEEN_KEY, guideClipPart, guideSeenHere, isNewAccount } from './clipPart';
import { guideDeferred } from './guideLater';

/** Pages where the first run waits: loading a question file, the exam container's group link (/g/<код>) and a quiz link (/k/<код>). */
const WAITING_PATHS: readonly RegExp[] = [/^\/exams\/(import|new)\/?$/, /^\/g\//, /^\/k\//];

export { GUIDE_SEEN_KEY };
/** The profile's `onboarding_status` key. */
export const GUIDE_PROFILE_KEY = 'guide';

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
  /**
   * The first run: the guide is a blocking dialog over the dimmed app. No «Не сейчас»,
   * no ×, Escape does nothing; «Начать» on the last chapter ends it.
   */
  mandatory: boolean;
  /** Opens the guide on a chapter: the given one, else the one of the page, else the first. */
  start: (id?: GuideChapterId) => void;
  close: () => void;
  /** «Начать» of the first run: closes the guide and takes the app to «Сегодня», where the first steps are. */
  finish: () => void;
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
  /** The page has no shell to show the guide in (the ticket room): a first run waits for the next page. */
  shellHidden?: boolean;
  children: ReactNode;
}

/**
 * The guide's state for the signed-in shell. An account that has not seen it, on this device or in the
 * profile, gets it as a blocking dialog the first time the app opens: chapter by chapter, «Дальше»
 * moves the app to the section, and «Начать» at the end marks it seen on the device and in the
 * profile. After that it opens from the «?» button or the account menu as a card the page stays usable
 * under. While it is open it follows the student's own moves between sections and, on «Дальше», moves
 * the app itself — but never away from a page the student has typed, clicked or uploaded on.
 */
export function GuideProvider({ userId, seenInProfile, shellHidden = false, children }: ProviderProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [mandatory, setMandatory] = useState(false);
  const seen = useRef(guideSeenHere());
  const autoTried = useRef(false);
  /** The page the guide took the app to last; null after the student moved on their own. */
  const brought = useRef<string | null>(null);
  /** The student clicked, typed or dropped something on the page since it opened. */
  const touched = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const { user } = useAuth();
  const newAccount = isNewAccount(user?.created_at);

  // A first run is likely (the profile says so, or the account is new and the profile is on its
  // way): the clips are fetched now, so the guide opens with them.
  useEffect(() => {
    if (seen.current) return;
    if (seenInProfile === false || (seenInProfile === null && newAccount)) void guideClipPart.load().catch(() => undefined);
  }, [seenInProfile, newAccount]);

  const markSeen = useCallback(() => {
    if (seen.current) return;
    seen.current = true;
    writeSeen();
    if (userId) void Promise.resolve().then(() => markOnboardingTourSeen(userId, GUIDE_PROFILE_KEY)).catch(() => undefined);
  }, [userId]);

  /**
   * Takes the app to the chapter's section when the page may be left (see mayLeave). A chapter without
   * a page of its own (the limit: its meter is in the top line) leaves the app where it is.
   */
  const bring = useCallback(
    ({ route, match }: GuideChapter) => {
      if (!route || !match) return;
      const here = pathRef.current;
      if (match.test(here)) return;
      if (!mayLeave(here, brought.current, touched.current)) return;
      brought.current = route;
      touched.current = false;
      navigate(route);
    },
    [navigate],
  );

  const start = useCallback((id?: GuideChapterId) => {
    const byId = id ? GUIDE_CHAPTERS.findIndex((chapter) => chapter.id === id) : -1;
    const here = chapterIndexFor(pathRef.current);
    setIndex(byId >= 0 ? byId : here >= 0 ? here : 0);
    brought.current = null;
    touched.current = false;
    setMandatory(false);
    setOpen(true);
  }, []);

  /** The first run: from the first chapter, with the app on «Сегодня» when it may be taken there. */
  const showFirstRun = useCallback(() => {
    brought.current = null;
    touched.current = false;
    setIndex(0);
    setMandatory(true);
    setOpen(true);
    const first = GUIDE_CHAPTERS[0];
    bring(first);
  }, [bring]);

  const close = useCallback(() => {
    setOpen(false);
    setMandatory(false);
    markSeen();
  }, [markSeen]);

  const finish = useCallback(() => {
    const first = GUIDE_CHAPTERS[0];
    close();
    bring(first);
  }, [close, bring]);

  const go = useCallback(
    (next: number) => {
      const target = GUIDE_CHAPTERS[next];
      if (!target) return;
      setIndex(next);
      bring(target);
    },
    [bring],
  );

  // The first time the app opens for an account that has not seen the guide: the first run.
  useEffect(() => {
    if (autoTried.current || seenInProfile === null) return;
    if (seenInProfile || seen.current) {
      autoTried.current = true;
      return;
    }
    if (shellHidden) return;
    autoTried.current = true;
    // Came in by a group link (guideLater.ts): the copy of the exam first, the first run on a later visit. The same for
    // a student who came to load a question file or by an exam's group link: those pages are loaded lazily, so the
    // profile can arrive before their own deferGuideOnce() runs — the path decides here too (spec decision 33: the
    // guide opens after the first session instead).
    if (guideDeferred() || WAITING_PATHS.some((path) => path.test(pathRef.current))) return;
    showFirstRun();
  }, [seenInProfile, shellHidden, showFirstRun]);

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

  const api = useMemo<GuideApi>(
    () => ({ open, index, mandatory, start, close, finish, go }),
    [open, index, mandatory, start, close, finish, go],
  );
  return <GuideContext.Provider value={api}>{children}</GuideContext.Provider>;
}
