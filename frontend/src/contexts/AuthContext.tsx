import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { AuthChangeEvent, User, Session } from '@supabase/supabase-js';
import { whenIdleAfterLoad } from '../lib/idle';
import { hasStoredSession, keptSession, loadSupabase, signInInAddress } from '../lib/supabaseClient';

/**
 * A guest on a screen that needs no account (the landing, /try): the session is read once the page
 * is idle, so the client's file does not compete with the screen. A sign-in link (OAuth, e-mail
 * confirmation, password reset) is read by the client as it starts, so such an address never waits.
 */
function guestMayWait(): boolean {
  const { pathname } = window.location;
  if (!(pathname === '/' || pathname === '/try' || pathname.startsWith('/try/'))) return false;
  if (signInInAddress()) return false;
  return !hasStoredSession();
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
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [wanted, setWanted] = useState(() => typeof window === 'undefined' || !guestMayWait());

  useEffect(() => {
    if (wanted) return undefined;
    return whenIdleAfterLoad(() => setWanted(true));
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
