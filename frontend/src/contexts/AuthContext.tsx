import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { whenIdleAfterLoad } from '../lib/idle';
import { hasStoredSession, loadSupabase } from '../lib/supabaseClient';

/**
 * A guest on a screen that needs no account (the landing, /try): the session is read once the page
 * is idle, so the client's file does not compete with the screen. A sign-in link (OAuth, e-mail
 * confirmation, password reset) is read by the client as it starts, so such an address never waits.
 */
function guestMayWait(): boolean {
  const { pathname, search, hash } = window.location;
  if (!(pathname === '/' || pathname === '/try' || pathname.startsWith('/try/'))) return false;
  if (/(?:^|[?&#])(?:code|access_token|refresh_token|token_hash|error|error_description|type)=/.test(`${search}${hash}`)) return false;
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

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    let unsubscribe: (() => void) | null = null;
    loadSupabase().then(
      (supabase) => {
        if (!live) return;
        supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        });
        unsubscribe = () => subscription.unsubscribe();
      },
      (error: unknown) => console.error('Не удалось загрузить клиент Supabase:', error),
    );

    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [wanted]);

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
