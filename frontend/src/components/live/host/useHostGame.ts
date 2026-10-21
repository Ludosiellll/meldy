/**
 * The teacher's side of a game (CONTRACT §6–§8): the host token from this tab, the state followed by hints and polling
 * (`watchState`), the server's clock, and the host's moves — next, kick, end. A reload reads the token again and picks
 * the game up where it is. States that bring nothing new keep the same objects, so the screen does not re-render on a
 * poll that changed nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { watchState } from '../../../lib/live/api';
import { LiveError, isUnchanged, type GameState, type HostState, type LiveApi } from '../../../lib/live/types';
import { readHostToken } from './hostSession';

export type HostStatus = 'loading' | 'ready' | 'notoken' | 'notfound' | 'denied' | 'error';

export interface HostGame {
  status: HostStatus;
  state: HostState | null;
  offline: boolean;
  busy: boolean;
  /** Milliseconds to add to Date.now() for the server's clock. */
  offset: () => number;
  next(): void;
  kick(playerId: string): Promise<boolean>;
  end(): Promise<boolean>;
  retry(): void;
  /** Reads the state now (a movement game's room saw it change first). */
  refresh(): void;
}

export interface HostGameOptions {
  /**
   * After every live_next, live_kick and live_end has answered (or failed): a movement game's room is told to read the
   * game's state at once (MODE_STAND.md §2, `{"t":"cmd","op":"sync"}`).
   */
  onMoved?: () => void;
}

/** States the host moves on from (CONTRACT §1); countdown and open move by time. */
export function canNext(s: HostState): boolean {
  if (s.state === 'lobby') return s.players > 0;
  return s.state === 'reveal' || s.state === 'leaderboard' || s.state === 'podium';
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** `next` with the parts of `prev` that did not change (rows by player), or `prev` itself when nothing did. */
export function shareState(prev: HostState | null, next: HostState): HostState {
  if (!prev) return next;
  const old = new Map(prev.roster.map((r) => [r.player_id, r]));
  let rosterChanged = next.roster.length !== prev.roster.length;
  const roster = next.roster.map((r, i) => {
    const was = old.get(r.player_id);
    if (was && same(was, r)) {
      if (prev.roster[i] !== was) rosterChanged = true;
      return was;
    }
    rosterChanged = true;
    return r;
  });
  const out: HostState = {
    ...next,
    roster: rosterChanged ? roster : prev.roster,
    question: same(prev.question, next.question) ? prev.question : next.question,
    boss: same(prev.boss, next.boss) ? prev.boss : next.boss,
    result: same(prev.result, next.result) ? prev.result : next.result,
    top: same(prev.top, next.top) ? prev.top : next.top,
    final: same(prev.final, next.final) ? prev.final : next.final,
    settings: same(prev.settings, next.settings) ? prev.settings : next.settings,
    answered_ids: same(prev.answered_ids, next.answered_ids) ? prev.answered_ids : next.answered_ids,
  };
  const keys = Object.keys(out) as (keyof HostState)[];
  const unchanged = keys.every((k) => k === 'now' || out[k] === prev[k]);
  return unchanged ? prev : out;
}

export function useHostGame(gameId: string, api: LiveApi, options: HostGameOptions = {}): HostGame {
  const movedRef = useRef(options.onMoved);
  movedRef.current = options.onMoved;
  const [token] = useState(() => readHostToken(gameId));
  const [status, setStatus] = useState<HostStatus>(token ? 'loading' : 'notoken');
  const [state, setState] = useState<HostState | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef<HostState | null>(null);
  const offsetRef = useRef(0);
  const busyRef = useRef(false);

  const accept = useCallback((got: HostState) => {
    const prev = stateRef.current;
    // Answers to calls sent earlier can come later: the state never goes back (rev only grows).
    if (prev && got.rev < prev.rev) return;
    const shared = shareState(prev, got);
    stateRef.current = shared;
    setOffline(false);
    setStatus('ready');
    if (shared !== prev) setState(shared);
  }, []);

  const fatal = useCallback((e: LiveError) => {
    if (e.code === 'P0002') setStatus('notfound');
    else if (e.code === '42501') setStatus('denied');
    else return false;
    return true;
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let dead = false;
    let stop = () => {};
    api.hostState(gameId, token).then(
      (first) => {
        if (dead || isUnchanged(first)) return;
        accept(first);
        stop = watchState<HostState>({
          api,
          topic: first.topic,
          read: (since) => api.hostState(gameId, token, since),
          onState: accept,
          onError: (e) => {
            if (fatal(e)) stop();
            else setOffline(true);
          },
          fastIn: ['lobby', 'open'],
          onClock: (ms) => {
            offsetRef.current = ms;
          },
        });
      },
      (e: unknown) => {
        if (dead) return;
        const err = e instanceof LiveError ? e : new LiveError('unknown', null, 0);
        if (!fatal(err)) setStatus('error');
      },
    );
    return () => {
      dead = true;
      stop();
    };
  }, [api, gameId, token, accept, fatal, attempt]);

  const refresh = useCallback(() => {
    if (!token) return;
    api.hostState(gameId, token).then(
      (got) => {
        if (!isUnchanged(got)) accept(got);
      },
      () => setOffline(true),
    );
  }, [api, gameId, token, accept]);

  const next = useCallback(() => {
    const s = stateRef.current;
    if (!token || !s || busyRef.current || !canNext(s)) return;
    busyRef.current = true;
    setBusy(true);
    const expect: GameState = s.state;
    api
      .next(gameId, token, expect)
      .then(accept, (e: unknown) => {
        // ML011: the state moved meanwhile (another tab, the server's own 30 s): read it and show it.
        if (e instanceof LiveError && e.code === 'ML011') refresh();
        else setOffline(true);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
        movedRef.current?.();
      });
  }, [api, gameId, token, accept, refresh]);

  const kick = useCallback(
    async (playerId: string) => {
      if (!token) return false;
      try {
        await api.kick(gameId, token, playerId);
        return true;
      } catch {
        return false;
      } finally {
        // Either way, show what the server has now.
        refresh();
        movedRef.current?.();
      }
    },
    [api, gameId, token, refresh],
  );

  const end = useCallback(async () => {
    if (!token) return false;
    try {
      await api.end(gameId, token);
      return true;
    } catch {
      return false;
    } finally {
      refresh();
      movedRef.current?.();
    }
  }, [api, gameId, token, refresh]);

  const retry = useCallback(() => {
    setStatus(token ? 'loading' : 'notoken');
    setAttempt((n) => n + 1);
  }, [token]);

  const offset = useCallback(() => offsetRef.current, []);

  return { status, state, offline, busy, offset, next, kick, end, retry, refresh };
}
