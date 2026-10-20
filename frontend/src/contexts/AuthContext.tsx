import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { AuthChangeEvent, User, Session } from '@supabase/supabase-js';
import { hasStoredSession, keptSession, loadSupabase, signInInAddress, whenSupabaseLoaded } from '../lib/supabaseClient';

/**
 * A guest on a screen that needs no account (the landing, /try), with no session kept in this browser: the session
 * is read only when something needs it (below), so the client's file does not come with the screen. A sign-in link
 * (OAuth, e-mail confirmation, password reset) is read by the client as it starts, so such an address never waits.
 */
function guestMayWait(): boolean {
  const { pathname } = window.location;
  if (!(pathname === '/' || pathname === '/try' || pathname.startsWith('/try/'))) return false;
  if (signInInAddress()) return false;
  return !hasStoredSession();
}

/**
 * Offline with a complete session kept here: the student is signed in with it at once. The client's own answer waits
 * for the network: with an expired access token auth-js retries the refresh for about a minute before it reports no
 * session (52 s on «Сегодня», usability check of 2026-10-10, m5), and the pages that draw from the device (spec
 * decision 31) waited with it. The client's answer is still taken when it comes (`settle`); a sign-in in the address
 * is never pre-empted.
 */
function keptWhileOffline(): Session | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || navigator.onLine !== false) return null;
  if (signInInAddress()) return null;
  return keptSession();
}

// A signed-in student: the client gates every signed-in screen, so its file is fetched as the app
// starts, ahead of the screen's own files.
if (typeof window !== 'undefined' && hasStoredSession()) void loadSupabase().catch(() => undefined);

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Reads the session now (a guest's landing or /try leaves it until the page is idle). */
  requestSession?: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, loading: true,
  signOut: async () => {},
  requestSession: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(keptWhileOffline);
  const [user, setUser] = useState<User | null>(() => session?.user ?? null);
  const [loading, setLoading] = useState(() => session === null);
  const [wanted, setWanted] = useState(() => typeof window === 'undefined' || !guestMayWait());

  // A guest on the landing or /try with no session kept here has no session for the client to find: its file (58 KB)
  // is not fetched for it (it was, once the page was idle — smoothness audit 20.10). The session is read when a page
  // asks for it (requestSession), when a page that uses the client brings it (sign-in, a lecture: lib/supabase says
  // so), and when a sign-in elsewhere in this browser keeps a session here (another tab).
  useEffect(() => {
    if (wanted) return undefined;
    const read = () => setWanted(true);
    const stopWaiting = whenSupabaseLoaded(read);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || /^sb-.+-auth-token$/.test(event.key)) read();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      stopWaiting();
      window.removeEventListener('storage', onStorage);
    };
  }, [wanted]);

  /**
   * No session from the client while it still keeps one here means its refresh failed for lack of network (auth-js
   * removes the stored session on every other failure): the student stays signed in with the kept session, so the
   * pages that draw from the device open offline (spec decision 31), and the client refreshes it once the network is
   * back. A sign-out never falls back.
   */
  const settle = useCallback((next: Session | null, event?: AuthChangeEvent) => {
    const current = next ?? (event === 'SIGNED_OUT' ? null : keptSession());
    setSession(current);
    setUser(current?.user ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    let unsubscribe: (() => void) | null = null;
    loadSupabase().then(
      (supabase) => {
        if (!live) return;
        supabase.auth.getSession().then(({ data: { session } }) => settle(session));

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => settle(session, event));
        unsubscribe = () => subscription.unsubscribe();
      },
      (error: unknown) => console.error('Не удалось загрузить клиент Supabase:', error),
    );

    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [wanted, settle]);

  const signOut = async () => {
    const supabase = await loadSupabase();
    await supabase.auth.signOut();
  };

  const requestSession = useCallback(() => setWanted(true), []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut, requestSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
