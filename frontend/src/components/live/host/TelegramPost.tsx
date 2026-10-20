/**
 * The lobby's «Telegram» line: post the game into a group chat bound to the exam (W1, 20.10). The chats come from
 * `telegram_groups` (api/telegramGroups.ts); the post is `live_tg_post` with the author's session, sent by the bot later
 * («posting», no message id). One post a minute per game: a 429 shows the wait and counts it down. No chat bound: the
 * way to bind one, in plain words. With the fake server: one chat, «3-ПО».
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchTelegramGroups } from '../../../api/telegramGroups';
import { LiveError, type LiveApi } from '../../../lib/live/types';
import { TG } from './copy';

export interface Chat {
  chatId: number;
  title: string | null;
}

export const FAKE_CHATS: readonly Chat[] = [{ chatId: -1001234567890, title: '3-ПО' }];

const KEY = (game: string) => `meldy.live.hostpost.${game}`;

function readPosted(game: string): Chat | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(KEY(game)) ?? 'null') as Chat | null;
    return v && typeof v.chatId === 'number' ? v : null;
  } catch {
    return null;
  }
}

function savePosted(game: string, chat: Chat): void {
  try {
    window.sessionStorage.setItem(KEY(game), JSON.stringify(chat));
  } catch {
    /* storage refused */
  }
}

/** The words for a refused post (CONTRACT §8 codes as W1 gave them for live_tg_post). */
export function postErrorText(e: unknown): string {
  if (!(e instanceof LiveError)) return TG.error.other;
  if (e.code === 'P0002') return e.detail === 'group' ? TG.error.group : TG.error.game;
  return TG.error[e.code] ?? TG.error.other;
}

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; chats: Chat[] };

export function TelegramPost({ api, gameId, containerId, fake }: { api: LiveApi; gameId: string; containerId: string; fake: boolean }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [posted, setPosted] = useState<Chat | null>(() => readPosted(gameId));
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const read = useCallback(() => {
    setLoad({ kind: 'loading' });
    if (fake) {
      setLoad({ kind: 'ready', chats: [...FAKE_CHATS] });
      return;
    }
    fetchTelegramGroups(containerId).then(
      (data) => setLoad({ kind: 'ready', chats: (data?.groups ?? []).map((g) => ({ chatId: g.chatId, title: g.title })) }),
      () => setLoad({ kind: 'failed' }),
    );
  }, [fake, containerId]);
  useEffect(() => {
    read();
  }, [read]);

  // The wait after a 429, a second at a time; the buttons come back when it is over.
  useEffect(() => {
    if (waitUntil === null) return undefined;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= waitUntil) {
        setWaitUntil(null);
        setError(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [waitUntil]);

  const send = useCallback(
    (chat: Chat) => {
      setSending(chat.chatId);
      setError(null);
      api.tgPost(gameId, chat.chatId).then(
        () => {
          setPosted(chat);
          savePosted(gameId, chat);
          setSending(null);
        },
        (e: unknown) => {
          setSending(null);
          if (e instanceof LiveError && e.code === 'ML005') {
            const s = e.retryAfterS;
            setNow(Date.now());
            setWaitUntil(Date.now() + (s ?? 60) * 1000);
            setError('wait');
          } else setError(postErrorText(e));
        },
      );
    },
    [api, gameId],
  );

  const left = waitUntil === null ? null : Math.max(1, Math.ceil((waitUntil - now) / 1000));
  const waiting = waitUntil !== null;
  let body;
  if (load.kind === 'loading') body = null;
  else if (load.kind === 'failed')
    body = (
      <>
        <b>{TG.label}</b> {TG.failed}{' '}
        <button type="button" className="lvh-link" onClick={read}>
          {TG.retry}
        </button>
      </>
    );
  else if (load.chats.length === 0)
    body = (
      <>
        <b>{TG.label}</b> {TG.none}
      </>
    );
  else
    body = (
      <>
        {posted ? (
          <span className="lvh-tg-line">
            <b>{TG.label}</b> {TG.play(posted.title)}
          </span>
        ) : null}
        <span className="lvh-tg-actions">
          {posted ? null : <b>{TG.label}</b>}
          {load.chats
            .filter((c) => !posted || c.chatId !== posted.chatId)
            .slice(0, 3)
            .map((c) => (
              <button key={c.chatId} type="button" className="lvh-btn lvh-btn--white lvh-btn--small" onClick={() => send(c)} disabled={sending !== null || waiting}>
                {sending === c.chatId ? TG.sending : TG.send(c.title)}
              </button>
            ))}
        </span>
      </>
    );
  return (
    <div className="lvh-tg">
      {body}
      {posted ? (
        <p className="lvh-tg-note" role="status">
          {TG.posted(posted.title)}
        </p>
      ) : null}
      {error ? (
        <p className="lvh-tg-note lvh-tg-note--warn" role="alert">
          {error === 'wait' ? TG.wait(left) : error}
        </p>
      ) : null}
    </div>
  );
}
