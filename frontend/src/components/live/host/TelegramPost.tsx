/**
 * The lobby's post into a group chat bound to the exam (W1, 20.10), as one compact control of the teacher's: a pill
 * «Отправить в беседу «3-ПО»» (one chat: it posts at once), «Отправить в беседу» (several: a short list opens over it;
 * none bound: how to bind one, told only now — the class never reads setup instructions on the projector). The chats
 * come from `telegram_groups` (api/telegramGroups.ts); the post is `live_tg_post` with the author's session, sent by
 * the bot later («posting», no message id). One post a minute per game: a 429 shows the wait and counts it down. After
 * a post the pill says where it went and `onPosted` tells the lobby, which shows the class where its «Играть» is. With
 * the fake server: one chat, «3-ПО».
 */
import { Check, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/** The chats bound to the exam (the fake server has one), for the lobby and the setup page. */
export function useBoundChats(containerId: string | null, fake: boolean): { load: Load; reload: () => void } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const reload = useCallback(() => {
    if (fake) {
      setLoad({ kind: 'ready', chats: [...FAKE_CHATS] });
      return;
    }
    if (!containerId) {
      setLoad({ kind: 'ready', chats: [] });
      return;
    }
    setLoad({ kind: 'loading' });
    fetchTelegramGroups(containerId).then(
      (data) => setLoad({ kind: 'ready', chats: (data?.groups ?? []).map((g) => ({ chatId: g.chatId, title: g.title })) }),
      () => setLoad({ kind: 'failed' }),
    );
  }, [fake, containerId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { load, reload };
}

export interface TelegramPostProps {
  api: LiveApi;
  gameId: string;
  containerId: string;
  fake: boolean;
  onPosted?: (chat: Chat) => void;
}

export function TelegramPost({ api, gameId, containerId, fake, onPosted }: TelegramPostProps) {
  const { load, reload } = useBoundChats(containerId, fake);
  const [posted, setPosted] = useState<Chat | null>(() => readPosted(gameId));
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const told = useRef(onPosted);
  told.current = onPosted;

  useEffect(() => {
    if (posted) told.current?.(posted);
  }, [posted]);

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

  // The list or the note closes on Esc or a click elsewhere.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  const send = useCallback(
    (chat: Chat) => {
      setOpen(false);
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
  const chats = load.kind === 'ready' ? load.chats.filter((c) => !posted || c.chatId !== posted.chatId) : [];
  const single = load.kind === 'ready' && load.chats.length === 1 ? load.chats[0] : null;

  const press = () => {
    if (single && !posted) send(single);
    else setOpen((o) => !o);
  };
  const label = sending !== null ? TG.sending : posted ? TG.sent(posted.title) : single ? TG.sendTo(single.title) : TG.send;

  let pop = null;
  if (open) {
    if (load.kind === 'failed')
      pop = (
        <>
          <p>{TG.failed}</p>
          <button type="button" className="lvh-btn lvh-btn--white lvh-btn--small" onClick={reload}>
            {TG.retry}
          </button>
        </>
      );
    else if (load.kind === 'ready' && load.chats.length === 0) pop = <p>{TG.none}</p>;
    else if (chats.length > 0)
      pop = (
        <>
          <p>{TG.pick}</p>
          <div className="lvh-tg-chats">
            {chats.slice(0, 5).map((c) => (
              <button key={c.chatId} type="button" className="lvh-btn lvh-btn--white lvh-btn--small" onClick={() => send(c)} disabled={sending !== null || waiting}>
                {TG.sendTo(c.title)}
              </button>
            ))}
          </div>
        </>
      );
  }

  return (
    <div className="lvh-tg" ref={box}>
      <button
        type="button"
        className="lvh-tg-pill"
        data-posted={posted ? '' : undefined}
        onClick={press}
        disabled={load.kind === 'loading' || sending !== null || (waiting && !!single)}
        aria-expanded={single && !posted ? undefined : open}
      >
        {posted ? <Check size={20} strokeWidth={2.6} aria-hidden="true" /> : <Send size={18} strokeWidth={2.4} aria-hidden="true" />}
        <span>{label}</span>
      </button>
      {posted ? (
        <span className="lvh-sr" role="status">
          {TG.posted(posted.title)}
        </span>
      ) : null}
      {error ? (
        <span className="lvh-tg-note" role="alert">
          {error === 'wait' ? TG.wait(left) : error}
        </span>
      ) : null}
      {pop ? (
        <div className="lvh-tg-pop" role="dialog" aria-label={TG.send}>
          {pop}
          <button type="button" className="lvh-tg-close" onClick={() => setOpen(false)} aria-label={TG.close}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
