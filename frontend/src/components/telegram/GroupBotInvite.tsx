import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { GroupCode, TelegramGroup, TelegramGroups } from '../../api/telegramGroups';
import PaperSelect from '../ui/PaperSelect';
import { ty } from '../landing/typo';
import './groupBotInvite.css';

/**
 * «Вопрос дня в Telegram» inside «Пригласить группу» (package T8; Telegram bot spec §4.6 G0, decision 24): the exam's
 * author connects a group chat — the bot then posts one silent question a day there (G1–G4 are the bot's).
 * - A disclosure, as «Кто вошёл» in the same window: nothing is read until it is opened, and the Telegram calls load
 *   with it (api/telegramGroups.ts, T7's `telegram_group_*`).
 * - Open: the spec's G0 paragraph; the chats already connected, each with its hour (9:00 · 12:00 · 15:00 · 18:00) and
 *   «Выключить» / «Включить» (a chat stopped after five empty days turns on again; one whose group link ended is
 *   connected again with a new code); then the hour for a new chat (12:00 by default) and the one blue pill
 *   «Подключить беседу». It asks for a one-hour code and offers «Открыть Telegram» →
 *   `t.me/Meldyteach_bot?startgroup=G<code>` (Telegram asks for the group). The list is read every 3 s until the chat
 *   appears, the hour passes or the author cancels.
 * - Without a linked Telegram: «Сначала подключите Telegram в профиле.»; without an open group link: «Сначала
 *   создайте ссылку для группы.»; while the window shows its own blue pill («Создать ссылку»), none here.
 */

interface Props {
  containerId: string;
  /** An open group link is on screen and the window shows no blue pill of its own. */
  linkOpen: boolean;
}

/** How often the open section reads the chats while a code waits. */
export const POLL_MS = 3000;
const CODE_MS = 60 * 60 * 1000;

/** Russian typesetting: short words and numbers hold on to the next word, a dash never starts a line. */
function glue(text: string): string {
  return ty(text).replace(/(\d) (?=[а-яёА-ЯЁa-zA-Z%])/g, '$1\u00a0');
}

/** Every line of the section (spec G0, word for word where the spec has it; no «!», «ёлочки», « — »). */
export const GROUP_BOT = {
  title: 'Вопрос дня в Telegram',
  lede: 'Раз в день бот пришлёт в беседу один вопрос из экзамена, без звука. Что нажал каждый и ответ из файла видит только он. Ответ участника с Meldy идёт в его счёт по обычному правилу.',
  when: 'Вопрос дня — каждый день в',
  hourLabel: 'Во сколько присылать вопрос дня',
  hour: (hour: number) => `${hour}:00`,
  connect: 'Подключить беседу',
  connecting: 'Готовим ссылку…',
  open: 'Открыть Telegram',
  step: 'В Telegram выберите беседу группы — бот пришлёт в неё первое сообщение.',
  lifetime: 'Ссылка действует час.',
  cancel: 'Отмена',
  expired: 'Ссылка устарела: она действует час. Нажмите «Подключить беседу» ещё раз.',
  ready: 'Ссылка готова: откройте Telegram и выберите беседу.',
  needTelegram: 'Сначала подключите Telegram в профиле.',
  openProfile: 'Открыть профиль',
  needLink: 'Сначала создайте ссылку для группы.',
  loadFailed: 'Не получилось узнать, какие беседы подключены.',
  retry: 'Повторить',
  missing: 'Вопрос дня в Telegram пока недоступен.',
  listLabel: 'Подключённые беседы',
  chat: (title: string | null) => (title ? `«${title}»` : 'Беседа без названия'),
  every: 'Каждый день в',
  off: 'Выключено.',
  stoppedEmpty: 'Остановлено: пять дней подряд никто не ответил.',
  stoppedLink: 'Ссылка группы закрыта — подключите беседу заново.',
  turnOff: 'Выключить',
  turnOn: 'Включить',
  hourOf: (chat: string) => `Час вопроса дня: ${chat}`,
  connected: (chat: string) => `Беседа ${chat} подключена.`,
  changedHour: (chat: string, hour: number) => `${chat}: вопрос дня — в ${hour}:00.`,
  turnedOff: (chat: string) => `${chat}: вопрос дня выключен.`,
  turnedOn: (chat: string) => `${chat}: вопрос дня снова включён.`,
} as const;

type Api = typeof import('../../api/telegramGroups');
let apiLoad: Promise<Api> | null = null;
/** The Telegram calls, loaded with the open section (the window itself never needs them). */
function api(): Promise<Api> {
  apiLoad ??= import('../../api/telegramGroups');
  return apiLoad;
}

export default function GroupBotInvite({ containerId, linkOpen }: Props) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="gb">
      <h3 className="gb-h">
        <button type="button" className="gb-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <span>{GROUP_BOT.title}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </h3>
      {open ? <GroupBotPanel id={bodyId} containerId={containerId} linkOpen={linkOpen} /> : null}
    </section>
  );
}

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | { kind: 'ready'; data: TelegramGroups };

/** The moment the server made the code (its end less the hour), to tell a chat connected by it; null when unknown. */
function codeMoment(code: GroupCode): number | null {
  const end = code.expiresAt ? Date.parse(code.expiresAt) : NaN;
  return Number.isFinite(end) ? end - CODE_MS : null;
}

function GroupBotPanel({ id, containerId, linkOpen }: Props & { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [hour, setHour] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState<{ made: GroupCode; known: Set<number>; until: number } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const openRef = useRef<HTMLAnchorElement>(null);
  // One controller for the section's life: no answer lands after it is closed.
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);

  const read = useCallback(async (quiet = false) => {
    if (!quiet) setLoad({ kind: 'loading' });
    try {
      const calls = await api();
      const data = await calls.fetchTelegramGroups(containerId, life.current?.signal);
      if (life.current?.signal.aborted) return null;
      setLoad(data ? { kind: 'ready', data } : { kind: 'missing' });
      return data;
    } catch {
      if (life.current?.signal.aborted) return null;
      if (!quiet) setLoad({ kind: 'failed' });
      return null;
    }
  }, [containerId]);

  // Read on open, and again when the window's link opens or closes.
  useEffect(() => {
    void read();
  }, [read, linkOpen]);

  // While a code waits: read the chats every 3 s until the new one is there, the hour passes, or «Отмена».
  useEffect(() => {
    if (!code) return undefined;
    const moment = codeMoment(code.made);
    const timer = window.setInterval(() => {
      if (Date.now() > code.until) {
        setCode(null);
        setNote(GROUP_BOT.expired);
        return;
      }
      void read(true).then((data) => {
        if (!data) return;
        const fresh = data.groups.find((group) => !code.known.has(group.chatId)
          || (moment !== null && group.boundAt !== null && Date.parse(group.boundAt) >= moment - 2000));
        if (!fresh) return;
        setCode(null);
        setAnnounce(GROUP_BOT.connected(GROUP_BOT.chat(fresh.title)));
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [code, read]);

  useEffect(() => {
    if (code) openRef.current?.focus();
  }, [code]);

  if (load.kind === 'loading') return <div id={id} className="gb-body" aria-busy="true" />;
  if (load.kind === 'missing') {
    return (
      <div id={id} className="gb-body">
        <p className="gb-line" data-muted="">{GROUP_BOT.missing}</p>
      </div>
    );
  }
  if (load.kind === 'failed') {
    return (
      <div id={id} className="gb-body">
        <p className="gb-line" role="alert">
          {GROUP_BOT.loadFailed}{' '}
          <button type="button" className="sf-link" onClick={() => void read()}>
            {GROUP_BOT.retry}
          </button>
        </p>
      </div>
    );
  }

  const data = load.data;
  const chosen = hour ?? data.defaultHour;
  const hours = data.hours.map((value) => ({ value, label: GROUP_BOT.hour(value) }));

  const connect = async () => {
    if (asking) return;
    setAsking(true);
    setError(null);
    setNote(null);
    try {
      const calls = await api();
      const made = await calls.requestGroupCode(containerId, chosen);
      const moment = codeMoment(made);
      setCode({ made, known: new Set(data.groups.map((group) => group.chatId)), until: moment !== null ? moment + CODE_MS : Date.now() + CODE_MS });
      setAnnounce(GROUP_BOT.ready);
    } catch (failure) {
      const calls = await api();
      setError(calls.groupErrorText(failure));
      // The state changed meanwhile (Telegram unlinked, the link closed): read it again for the right lines.
      if (failure instanceof calls.TelegramGroupError && (failure.code === 'not_linked' || failure.code === 'no_link')) void read(true);
    } finally {
      setAsking(false);
    }
  };

  const change = async (group: TelegramGroup, patch: { hour?: number; on?: boolean }) => {
    setBusy(group.chatId);
    setError(null);
    const name = GROUP_BOT.chat(group.title);
    try {
      const calls = await api();
      const next = await calls.setTelegramGroup(group.chatId, patch);
      setLoad({ kind: 'ready', data: { ...data, groups: data.groups.map((g) => (g.chatId === next.chatId ? next : g)) } });
      setAnnounce(patch.hour !== undefined ? GROUP_BOT.changedHour(name, next.hour) : next.on ? GROUP_BOT.turnedOn(name) : GROUP_BOT.turnedOff(name));
    } catch (failure) {
      const calls = await api();
      setError(calls.groupErrorText(failure));
      if (failure instanceof calls.TelegramGroupError && failure.code === 'not_found') void read(true);
    } finally {
      setBusy(null);
    }
  };

  let connectPart: ReactNode = null;
  if (!data.telegramLinked) {
    connectPart = (
      <p className="gb-line">
        {glue(GROUP_BOT.needTelegram)}{' '}
        <Link className="sf-link" to="/profile#telegram">
          {GROUP_BOT.openProfile}
        </Link>
      </p>
    );
  } else if (!data.linkActive) {
    connectPart = <p className="gb-line" data-muted="">{glue(GROUP_BOT.needLink)}</p>;
  } else if (!linkOpen) {
    connectPart = null; // the window is making a link: its blue pill is the one on screen
  } else if (code) {
    connectPart = (
      <div className="gb-panel">
        <p className="gb-step">{glue(GROUP_BOT.step)}</p>
        <div className="gb-acts">
          <a ref={openRef} className="sf-primary gb-open" href={code.made.url} target="_blank" rel="noopener noreferrer">
            {GROUP_BOT.open}
          </a>
          <button type="button" className="sf-link" data-muted="" onClick={() => setCode(null)}>
            {GROUP_BOT.cancel}
          </button>
        </div>
        <p className="gb-fine">{glue(GROUP_BOT.lifetime)}</p>
      </div>
    );
  } else {
    connectPart = (
      <div className="gb-connect">
        <p className="gb-when">
          <span>{glue(GROUP_BOT.when)}</span>
          <PaperSelect ariaLabel={GROUP_BOT.hourLabel} value={chosen} options={hours} onChange={(value) => setHour(value)} disabled={asking} />
        </p>
        {note ? <p className="gb-line" data-muted="">{glue(note)}</p> : null}
        <button type="button" className="sf-primary gb-go" disabled={asking} aria-busy={asking || undefined} onClick={() => void connect()}>
          {asking ? GROUP_BOT.connecting : GROUP_BOT.connect}
        </button>
      </div>
    );
  }

  return (
    <div id={id} className="gb-body">
      <p className="gb-lede">{glue(GROUP_BOT.lede)}</p>
      {data.groups.length > 0 ? (
        <ul className="gb-list" aria-label={GROUP_BOT.listLabel}>
          {data.groups.map((group) => {
            const name = GROUP_BOT.chat(group.title);
            const ended = !group.linkActive || group.offReason === 'link';
            return (
              <li key={group.chatId} className="gb-item">
                <span className="gb-item-text">
                  <span className="gb-item-title">{name}</span>
                  {ended ? (
                    <span className="gb-item-state">{glue(GROUP_BOT.stoppedLink)}</span>
                  ) : group.on ? (
                    <span className="gb-item-state">
                      <span>{GROUP_BOT.every}</span>
                      <PaperSelect
                        ariaLabel={GROUP_BOT.hourOf(name)}
                        value={group.hour}
                        options={hours}
                        onChange={(value) => void change(group, { hour: value })}
                        disabled={busy === group.chatId}
                      />
                    </span>
                  ) : (
                    <span className="gb-item-state">{glue(group.offReason === 'empty' ? GROUP_BOT.stoppedEmpty : GROUP_BOT.off)}</span>
                  )}
                </span>
                {ended ? null : (
                  <button
                    type="button"
                    className="sf-link gb-item-act"
                    data-muted={group.on ? '' : undefined}
                    disabled={busy === group.chatId}
                    aria-label={`${group.on ? GROUP_BOT.turnOff : GROUP_BOT.turnOn}: ${name}`}
                    onClick={() => void change(group, { on: !group.on })}
                  >
                    {group.on ? GROUP_BOT.turnOff : GROUP_BOT.turnOn}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {connectPart}
      {error ? (
        <p className="gb-note" role="alert">
          {glue(error)}
        </p>
      ) : null}
      <p className="gb-sr" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
