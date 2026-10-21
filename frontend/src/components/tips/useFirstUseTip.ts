import { useCallback, useEffect, useRef, useState } from 'react';
import { getProfile, markOnboardingTourSeen } from '../../api/social';
import { useAuth } from '../../hooks/useAuth';
import { track } from '../../lib/telemetry';
import { GUIDE_PROFILE_KEY, GUIDE_SEEN_KEY, useGuide } from '../guide/GuideContext';
import { tipClipPart } from './clipPart';
import { TIP_KEY_PREFIX, tipProfileKey, type TipId } from './tips';

/** The page settles this long before a tip comes: its content, fonts and header are in place. */
export const TIP_SETTLE_MS = 700;

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** The tip was dismissed or used on this device. */
export function tipSeenHere(id: TipId): boolean {
  return readFlag(TIP_KEY_PREFIX + id);
}

function rememberHere(id: TipId) {
  try {
    window.localStorage.setItem(TIP_KEY_PREFIX + id, '1');
  } catch {
    // Private mode: the profile still remembers it.
  }
}

/** A tip shown on this many visits is put away, as if «Не сейчас» was pressed (finding LIB-4). */
export const TIP_SEEN_VISITS = 2;
/** How many visits showed the tip on this device. */
const viewsKey = (id: TipId) => `${TIP_KEY_PREFIX}views_${id}`;

/** One more visit that showed the tip; the count after it. */
function countVisit(id: TipId): number {
  try {
    const seen = Number.parseInt(window.localStorage.getItem(viewsKey(id)) ?? '0', 10);
    const next = (Number.isFinite(seen) && seen > 0 ? seen : 0) + 1;
    window.localStorage.setItem(viewsKey(id), String(next));
    return next;
  } catch {
    return 1;
  }
}

/** What the profile says, once read: the tip and the guide seen on any device. */
interface ProfileFlags {
  tip: boolean;
  guide: boolean;
}

export interface FirstUseTip {
  /** Show the tip now. */
  show: boolean;
  /**
   * The moment is here and nothing on this device says the tip was put away, but the profile is still being read: a tip
   * that sits inside a page's flow (the move dialog's) keeps its room meanwhile, so nothing jumps when it shows.
   */
  pending: boolean;
  /** «Не сейчас» or Escape: the tip goes away for good. */
  dismiss: () => void;
  /** The student used the feature, from the tip or by themselves: the tip goes away for good. */
  done: () => void;
}

/**
 * Whether a first-use tip is shown now. It is, when the caller says the moment is right (`enabled`:
 * the page is loaded and the feature is in reach) and for ~0.7 s since (`settle`: none for a tip inside a dialog that
 * has just opened); the tip was not dismissed or
 * used on this device (localStorage `meldy_tip_<id>`) or on any other (the profile's
 * `onboarding_status.tip_<id>`, read once when the moment first comes); the guide is not open and its
 * first run is behind (the profile's `guide` or the device's own mark) — the app as a whole comes
 * first, then its features one by one. While the profile is unread or cannot be read nothing is
 * shown, as with the guide's first run.
 *
 * dismiss() and done() write both marks; the tip never comes back. A tip that was only looked at
 * comes once more, on the next visit; shown on TIP_SEEN_VISITS visits it writes both marks as it
 * shows (it stays for that visit, and the next one does not see it); `visits` 1 shows a tip on one visit only (the test's
 * «game»). Statistics: tip_shown once per page visit, tip_action with `action` try or dismiss (try only when the tip
 * was on screen).
 */
export function useFirstUseTip(
  id: TipId,
  { enabled, settle = TIP_SETTLE_MS, visits = TIP_SEEN_VISITS }: { enabled: boolean; settle?: number; visits?: number },
): FirstUseTip {
  const { user } = useAuth();
  const userId = user?.id;
  const guideOpen = Boolean(useGuide()?.open);
  const [closed, setClosed] = useState(() => tipSeenHere(id));
  const [profile, setProfile] = useState<ProfileFlags | null>(null);
  const [settled, setSettled] = useState(false);
  const closedRef = useRef(closed);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  /** The account whose profile was asked for. */
  const asked = useRef<string | null>(null);
  const mounted = useRef(false);
  const reported = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The profile is read once, when the moment first comes (not on a page where the tip has nothing to point at).
  useEffect(() => {
    if (closed || !enabled || !userId || asked.current === userId) return;
    asked.current = userId;
    void Promise.resolve()
      .then(() => getProfile(userId))
      .then((row) => {
        if (!mounted.current || !row) return;
        const flags = row.onboarding_status ?? {};
        const tip = Boolean(flags[tipProfileKey(id)]);
        // Seen on another device: this one remembers it too and does not ask again.
        if (tip) rememberHere(id);
        setProfile({ tip, guide: Boolean(flags[GUIDE_PROFILE_KEY]) });
      })
      .catch(() => undefined);
  }, [closed, enabled, userId, id]);

  const moment = enabled && !closed && Boolean(userId) && !guideOpen;
  useEffect(() => {
    if (!moment) {
      setSettled(false);
      return undefined;
    }
    if (settle <= 0) {
      setSettled(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setSettled(true), settle);
    return () => window.clearTimeout(timer);
  }, [moment, settle]);

  // Read at render: the guide marks this device the moment it is closed, before it re-renders the page.
  const guideSeen = Boolean(profile?.guide) || readFlag(GUIDE_SEEN_KEY);
  const due = moment && profile !== null && !profile.tip && guideSeen;
  const show = due && settled;
  const pending = moment && profile === null && readFlag(GUIDE_SEEN_KEY);
  const showRef = useRef(show);
  showRef.current = show;

  // The clip is fetched while the page settles, so the card comes with it. The move dialog's tip plays a step clip of its
  // own part (MoveExamTip): the cards' clips are not its.
  useEffect(() => {
    if (due && id !== 'move') void tipClipPart.load().catch(() => undefined);
  }, [due, id]);

  useEffect(() => {
    if (!show || reported.current) return;
    reported.current = true;
    track('tip_shown', { id });
    // Seen on two visits is enough: the tip does not come a third time (on any device).
    if (countVisit(id) >= visits && !closedRef.current) {
      rememberHere(id);
      if (userId) void Promise.resolve().then(() => markOnboardingTourSeen(userId, tipProfileKey(id))).catch(() => undefined);
    }
  }, [show, id, userId, visits]);

  const finish = useCallback(
    (action: 'try' | 'dismiss') => {
      const visible = showRef.current;
      if (closedRef.current || profileRef.current?.tip) {
        setClosed(true);
        return;
      }
      closedRef.current = true;
      setClosed(true);
      rememberHere(id);
      if (userId) void Promise.resolve().then(() => markOnboardingTourSeen(userId, tipProfileKey(id))).catch(() => undefined);
      if (action === 'dismiss' || visible) track('tip_action', { id, action });
    },
    [id, userId],
  );

  const dismiss = useCallback(() => finish('dismiss'), [finish]);
  const done = useCallback(() => finish('try'), [finish]);
  return { show, pending, dismiss, done };
}
