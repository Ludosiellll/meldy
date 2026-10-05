import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { hasStoredSession } from '../lib/supabaseClient';
import { prefetchLikelyNext } from '../lib/prefetch';

/**
 * Mounted once inside the router (App.tsx): when the first screen is idle, fetches the screens a
 * visitor is likely to open next (lib/prefetch.ts) — once for a guest, and once more after signing in.
 */
export default function IdlePrefetch(): null {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const where = useRef(pathname);
  where.current = pathname;
  // Until the session has been read, a session kept in this browser says who is likely signed in.
  const [stored] = useState(hasStoredSession);
  const signedIn = loading ? stored : Boolean(user);

  useEffect(() => prefetchLikelyNext(where.current, signedIn), [signedIn]);

  return null;
}
