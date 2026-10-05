/**
 * The Supabase client (lib/supabase.ts) is a file of its own, so the first screen of a page that needs
 * no account (the landing, /try) does not carry it. The modules that are part of every first screen
 * (contexts/AuthContext, lib/apiAuth, api/limits) reach it through here; pages import lib/supabase as
 * before.
 */
type Client = (typeof import('./supabase'))['supabase'];

let pending: Promise<Client> | null = null;
let loaded: Client | null = null;
const waiting = new Set<(client: Client) => void>();

/** Fetches the client's file once (again after a failure). */
export function loadSupabase(): Promise<Client> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = import('./supabase').then(
      (module) => {
        loaded = module.supabase;
        const listeners = Array.from(waiting);
        waiting.clear();
        for (const listener of listeners) listener(module.supabase);
        return module.supabase;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
  }
  return pending;
}

/** The client if its file has already been loaded, else null (never fetches it). */
export function supabaseIfLoaded(): Client | null {
  return loaded;
}

/** Calls `listener` with the client once something has loaded it (it does not fetch the client itself). */
export function whenSupabaseLoaded(listener: (client: Client) => void): void {
  if (loaded) listener(loaded);
  else waiting.add(listener);
}

/** Where the client keeps the session in this browser: `sb-<project>-auth-token` (supabase-js default). */
const SESSION_KEY = /^sb-.+-auth-token$/;

/** A session the client keeps in this browser: a signed-in student, or a sign-in on its way. */
export function hasStoredSession(): boolean {
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) ?? '';
      if (key.startsWith('sb-') && key.includes('-auth-token')) return true;
    }
    return false;
  } catch {
    // Storage cannot be read: do not guess, read the session at once.
    return true;
  }
}

interface StoredSession {
  access_token?: unknown;
  user?: { created_at?: unknown } | null;
}

/** The session the client keeps here, read without the client; null without one (or unreadable). */
function storedSession(): StoredSession | null {
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) ?? '';
      if (!SESSION_KEY.test(key)) continue;
      const session = JSON.parse(storage.getItem(key) ?? 'null') as StoredSession | null;
      return session && typeof session === 'object' ? session : null;
    }
  } catch {
    // Unreadable or not JSON: no session.
  }
  return null;
}

/** The access token of the session the client keeps here, read without the client; null without one. */
export function storedAccessToken(): string | null {
  const token = storedSession()?.access_token;
  return typeof token === 'string' ? token : null;
}

/** When the signed-in account was created, from the session kept here; null without one. */
export function storedAccountCreatedAt(): string | null {
  const createdAt = storedSession()?.user?.created_at;
  return typeof createdAt === 'string' ? createdAt : null;
}

/** The address carries a sign-in for the client to complete (OAuth, e-mail confirmation, a reset). */
export function signInInAddress(): boolean {
  const { search, hash } = window.location;
  return /(?:^|[?&#])(?:code|access_token|refresh_token|token_hash|error|error_description|type)=/.test(`${search}${hash}`);
}
