import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  createShare,
  fetchShareState,
  revokeShare,
  type CreatedShare,
  type ExamShareState,
  type ShareInfo,
} from '../../../api/examShares';
import { track } from '../../../lib/telemetry';
import './inviteGroup.css';

/**
 * «Пригласить группу» (2026-10-07): the author of a ready exam makes a secret link after ticking the consent; each
 * classmate who opens it gets their own copy of the exam (questions, the lectures' text, the cheat sheet with its
 * answer points) at no AI units. The link is shown once — only its hash is kept — with «Скопировать» and a ready
 * message for the group's chat. Earlier links are listed with how many came in, and can be closed.
 * The server decides whether the exam is ready (backend/exam_shares.py: nothing left to map, every question has
 * its points written or failed the quote check twice); the dialog says what to do otherwise.
 */

interface Props {
  examId: string;
  examTitle: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; state: ExamShareState };

const COPIED_MS = 2000;

function shortDay(iso: string | null): string {
  if (!iso) return '';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '';
  return moment.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function membersPhrase(share: ShareInfo): string {
  return share.members > 0 ? `вошли ${share.members} из ${share.maxMembers}` : 'пока никто не вошёл';
}

/** The message for the group's chat: what the link gives, where to open it, the link last (messengers preview it). */
export function groupMessage(title: string, url: string): string {
  return [
    `Готовимся к экзамену «${title}» в Meldy. По ссылке у каждого будет своя копия: вопросы, лекции и шпаргалка с пунктами ответа. Отвечаете вслух — строки стираются. Ваши ответы видите только вы.`,
    'Откройте ссылку в Chrome или Safari: во встроенном браузере Telegram или Viber вход через Google не работает.',
    url,
  ].join('\n');
}

async function copyText(text: string, field: HTMLInputElement | HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to selecting the text.
  }
  try {
    field?.focus();
    field?.select();
    return typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
  } catch {
    return false;
  }
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => !element.hasAttribute('hidden'));
}

export default function InviteGroup({ examId, examTitle }: Props) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="sf-link"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Пригласить группу
      </button>
      {open &&
        createPortal(
          <InviteDialog
            examId={examId}
            examTitle={examTitle}
            onClose={() => {
              setOpen(false);
              window.setTimeout(() => openerRef.current?.focus(), 0);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function InviteDialog({ examId, examTitle, onClose }: Props & { onClose: () => void }) {
  const titleId = useId();
  const ledeId = useId();
  const consentId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  const [announce, setAnnounce] = useState('');
  const [closing, setClosing] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(() => {
    setPhase({ kind: 'loading' });
    fetchShareState(examId).then(
      (state) => {
        setPhase({ kind: 'loaded', state });
        track('group_invite_open', { ready: state.ready, copy: state.copy, links: state.shares.length });
      },
      (error: unknown) => setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Не получилось. Попробуйте через минуту.' }),
    );
  }, [examId]);

  useEffect(load, [load]);

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      root.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const trap = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !boxRef.current) return;
    const items = focusables(boxRef.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === boxRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const url = created ? `${window.location.origin}${created.path}` : '';
  const message = created ? groupMessage(examTitle, url) : '';

  const create = async () => {
    if (!consent || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createShare(examId);
      setCreated(result);
      setPhase((current) =>
        current.kind === 'loaded' ? { kind: 'loaded', state: { ...current.state, shares: [result.share, ...current.state.shares] } } : current,
      );
      setAnnounce('Ссылка создана. Скопируйте её сейчас: потом её не показать.');
      track('group_link_created');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Не получилось создать ссылку. Попробуйте через минуту.');
    } finally {
      setCreating(false);
    }
  };

  const copy = async (what: 'link' | 'text') => {
    const done = await copyText(what === 'link' ? url : message, what === 'link' ? linkRef.current : textRef.current);
    if (done) {
      setCopied(what);
      setAnnounce(what === 'link' ? 'Ссылка скопирована.' : 'Текст скопирован.');
    } else {
      setAnnounce('Не получилось скопировать: выделите текст и скопируйте его сами.');
    }
  };

  const revoke = async (share: ShareInfo) => {
    setRevokeError(null);
    try {
      const revokedAt = await revokeShare(share.id);
      setPhase((current) =>
        current.kind === 'loaded'
          ? {
              kind: 'loaded',
              state: {
                ...current.state,
                shares: current.state.shares.map((item) =>
                  item.id === share.id ? { ...item, state: 'revoked', revokedAt: revokedAt ?? new Date().toISOString() } : item,
                ),
              },
            }
          : current,
      );
      if (created?.share.id === share.id) setCreated(null);
      setClosing(null);
      setAnnounce('Ссылка закрыта. Копии, которые уже сделали, остаются у однокурсников.');
      track('group_link_revoked');
    } catch (error) {
      setRevokeError(error instanceof Error ? error.message : 'Не получилось закрыть ссылку.');
    }
  };

  const state = phase.kind === 'loaded' ? phase.state : null;
  const blocked = state && (state.copy || !state.ready) ? state.reason?.detail ?? 'Пригласить группу пока нельзя.' : null;

  return (
    <div className="ig-layer">
      <div className="ig-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={boxRef}
        className="ig-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={ledeId}
        tabIndex={-1}
        onKeyDown={trap}
      >
        <div className="ig-head">
          <h2 id={titleId} className="ig-h">
            Пригласить группу
          </h2>
          <button type="button" className="ig-x" aria-label="Закрыть" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p id={ledeId} className="ig-lede">
          Каждый однокурсник получит свою копию экзамена: вопросы, текст ваших лекций и шпаргалку с пунктами ответа. Пункты
          уже записаны, поэтому им вход ничего не стоит. Ваши ответы и прогресс никто не увидит.
        </p>

        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>

        {phase.kind === 'loading' && (
          <p className="ig-wait" role="status">
            Проверяем экзамен…
          </p>
        )}

        {phase.kind === 'error' && (
          <div className="ig-note" role="alert">
            <p>{phase.message}</p>
            <button type="button" className="sf-link" onClick={load}>
              Повторить
            </button>
          </div>
        )}

        {blocked && !created && <p className="ig-note" data-tone="wait">{blocked}</p>}

        {state && !state.copy && state.ready && !created && (
          <div className="ig-make">
            <label className="ig-consent" htmlFor={consentId}>
              <input id={consentId} type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>{state.consent || 'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа. Мои ответы и прогресс никто не увидит.'}</span>
            </label>
            {createError && (
              <p className="ig-note" role="alert">
                {createError}
              </p>
            )}
            <button
              type="button"
              className="sf-primary ig-go"
              disabled={!consent || creating}
              aria-busy={creating || undefined}
              onClick={() => void create()}
            >
              {creating ? 'Создаём ссылку…' : 'Создать ссылку'}
            </button>
          </div>
        )}

        {created && (
          <div className="ig-made">
            <label className="ig-label" htmlFor={`${titleId}-link`}>
              Ссылка для группы
            </label>
            <div className="ig-row">
              <input id={`${titleId}-link`} ref={linkRef} className="ig-field" readOnly value={url} onFocus={(event) => event.target.select()} />
              <button type="button" className="ig-copy" onClick={() => void copy('link')}>
                {copied === 'link' ? 'Скопировано' : 'Скопировать'}
              </button>
            </div>
            <p className="ig-once">
              Ссылку видно только сейчас: Meldy хранит не её, а отпечаток. Потеряете — создайте новую, а эту закройте.
            </p>
            <label className="ig-label" htmlFor={`${titleId}-text`}>
              Текст для беседы группы
            </label>
            <textarea id={`${titleId}-text`} ref={textRef} className="ig-field ig-text" readOnly rows={6} value={message} />
            <button type="button" className="ig-copy ig-copy-text" onClick={() => void copy('text')}>
              {copied === 'text' ? 'Скопировано' : 'Скопировать текст'}
            </button>
          </div>
        )}

        {state && state.shares.length > 0 && (
          <section className="ig-links" aria-labelledby={`${titleId}-links`}>
            <h3 id={`${titleId}-links`} className="ig-h3">
              Ссылки этого экзамена
            </h3>
            {revokeError && (
              <p className="ig-note" role="alert">
                {revokeError}
              </p>
            )}
            <ul>
              {state.shares.map((share) => (
                <li key={share.id} className="ig-link" data-state={share.state}>
                  <span>
                    {`Ссылка от ${shortDay(share.createdAt)} · ${membersPhrase(share)}`}
                    {share.state === 'revoked' && ' · закрыта'}
                    {share.state === 'expired' && ' · срок вышел'}
                  </span>
                  {share.state === 'active' &&
                    (closing === share.id ? (
                      <span className="ig-confirm">
                        <span>По ней больше никто не войдёт, копии останутся у тех, кто уже вошёл.</span>
                        <button type="button" className="sf-link" onClick={() => void revoke(share)}>
                          Да, закрыть
                        </button>
                        <button type="button" className="sf-link" data-muted="" onClick={() => setClosing(null)}>
                          Отмена
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="sf-link" data-muted="" onClick={() => setClosing(share.id)}>
                        Закрыть ссылку
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
