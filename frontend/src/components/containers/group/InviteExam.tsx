import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { createLink, revokeLink } from '../../../api/containers';
import { copyText } from '../../../lib/clipboard';
import { track } from '../../../lib/telemetry';
import type { ContainerSummary, LinkCreated, Uuid } from '../../../types/container';
import { errorText, INVITE, nb } from '../copyImport';
import MembersList from './MembersList';
import GroupBotInvite from '../../telegram/GroupBotInvite';
import { forgetLink, keepLink, keptCode } from './linkStore';
import './group.css';

/**
 * «Пригласить группу» for an exam (spec §9, decisions 24 and 52; Concept 1 §3.12 with the design critique I10): one
 * paragraph about what the group gets, the consent box only when the exam has oral subjects (their lectures and
 * answer points go to the members' copies), «Создать ссылку». The link is shown once — Meldy keeps only its
 * fingerprint — with «Скопировать» and a text for the group's chat; this device keeps the code to show it again.
 * Under it «Вошли 12 из 60 · Кто вошёл» with the members (remove, return) and «Закрыть ссылку».
 *
 * The exam page opens it from «⋯ → Пригласить группу» (package D3b) with its summary; «Настройки» also does.
 */

interface Props {
  summary: ContainerSummary;
  onClose: () => void;
  /** A link made or closed, a member removed: the page reads its summary again. */
  onChanged?: () => void;
}

export interface ExamCounts {
  subjects: number;
  questions: number;
  noKey: number;
  oral: boolean;
}

/** What the group gets: subjects, questions (with variants and oral), questions still without a key. */
export function examCounts(summary: ContainerSummary): ExamCounts {
  return summary.subjects.reduce<ExamCounts>(
    (sum, subject) => ({
      subjects: sum.subjects + 1,
      questions: sum.questions + subject.keyed + subject.no_key + (subject.oral?.questions ?? 0),
      noKey: sum.noKey + subject.no_key,
      oral: sum.oral || Boolean(subject.oral?.exam_id),
    }),
    { subjects: 0, questions: 0, noKey: 0, oral: false },
  );
}

const COPIED_MS = 2000;

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );
}

export default function InviteExam(props: Props) {
  return createPortal(<InviteDialog {...props} />, document.body);
}

function InviteDialog({ summary, onClose, onChanged }: Props) {
  const containerId = summary.id as Uuid;
  const titleId = useId();
  const consentId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const counts = useMemo(() => examCounts(summary), [summary]);

  const now = Date.now();
  const links = useMemo(
    () =>
      (summary.owner?.links ?? [])
        .filter((link) => !link.revoked_at && (!link.expires_at || Date.parse(link.expires_at) > now))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.owner?.links],
  );
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const open = links.filter((link) => !closed.has(link.id));
  const [created, setCreated] = useState<(LinkCreated & { kept: boolean }) | null>(null);
  const openLink = created ? null : open[0] ?? null;
  const code = created?.code ?? (openLink ? keptCode(containerId, openLink.id) : null);
  const linkId = created?.link_id ?? openLink?.id ?? null;
  const [wantNew, setWantNew] = useState(false);
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  const [announce, setAnnounce] = useState('');
  const [closing, setClosing] = useState(false);
  const [who, setWho] = useState(false);

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
    if (event.shiftKey && (document.activeElement === first || document.activeElement === boxRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const create = useCallback(async () => {
    if (creating || (counts.oral && !consent)) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createLink(containerId, 60, counts.oral ? INVITE.consent : null);
      const kept = keepLink(containerId, result.link_id, result.code);
      setCreated({ ...result, kept });
      setWantNew(false);
      setAnnounce(INVITE.made);
      track('container.link_created', { oral: counts.oral });
      onChanged?.();
    } catch (failure) {
      setError(errorText(failure, INVITE.errors, INVITE.failed));
    } finally {
      setCreating(false);
    }
  }, [creating, counts.oral, consent, containerId, onChanged]);

  const revoke = async () => {
    if (!linkId) return;
    setError(null);
    try {
      await revokeLink(linkId);
      forgetLink(containerId, linkId);
      setClosed((current) => new Set(current).add(linkId));
      setCreated(null);
      setClosing(false);
      setAnnounce(INVITE.revoked);
      onChanged?.();
    } catch (failure) {
      setError(errorText(failure, INVITE.errors));
    }
  };

  const url = code ? `${window.location.origin}/g/${code}` : '';
  const message = code ? INVITE.message(summary.title, counts.subjects, counts.questions, url) : '';
  const copy = async (what: 'link' | 'text') => {
    const done = await copyText(what === 'link' ? url : message, what === 'link' ? linkRef.current : textRef.current);
    if (done) {
      setCopied(what);
      setAnnounce(what === 'link' ? INVITE.copiedLink : INVITE.copiedText);
    } else setAnnounce(INVITE.copyFailed);
  };

  const seatLink = created ? { members: 0, max_members: 60 } : openLink;
  const members = summary.owner?.members ?? 0;
  const showMake = (!openLink && !created) || wantNew;
  // «Вошли 12 из 60» of the open link; «В экзамене 12 участников» when they came through an earlier link.
  const seatsLine =
    seatLink && !showMake && seatLink.members > 0
      ? INVITE.joined(seatLink.members, seatLink.max_members)
      : members > 0
        ? INVITE.members(members)
        : seatLink && !showMake
          ? INVITE.joined(0, seatLink.max_members)
          : null;

  return (
    <div className="gr-layer">
      <div className="gr-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={boxRef}
        className="gr-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trap}
      >
        <div className="gr-head">
          <h2 id={titleId} className="gr-h">
            {INVITE.title}
          </h2>
          <button type="button" className="gr-x" aria-label={INVITE.close} onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="gr-sr" role="status" aria-live="polite">
          {announce}
        </p>

        <p className="gr-lede">{nb(INVITE.lede(counts.subjects, counts.questions))}</p>
        {counts.noKey > 0 ? <p className="gr-line" data-muted="">{nb(INVITE.noKey(counts.noKey))}</p> : null}

        {code && linkId && !wantNew ? (
          <div className="gr-made">
            <label className="gr-label" htmlFor={`${titleId}-link`}>
              {INVITE.linkLabel}
            </label>
            <div className="gr-row">
              <input id={`${titleId}-link`} ref={linkRef} className="gr-field" readOnly value={url} onFocus={(event) => event.target.select()} />
              <button type="button" className="gr-copy" onClick={() => void copy('link')}>
                {copied === 'link' ? INVITE.copied : INVITE.copy}
              </button>
            </div>
            <label className="gr-label" htmlFor={`${titleId}-text`}>
              {INVITE.textLabel}
            </label>
            <textarea id={`${titleId}-text`} ref={textRef} className="gr-field gr-text" readOnly rows={3} value={message} />
            <button type="button" className="gr-copy gr-copy-text" onClick={() => void copy('text')}>
              {copied === 'text' ? INVITE.copied : INVITE.copyText}
            </button>
            {created ? <p className="gr-once">{created.kept ? INVITE.once : INVITE.onceLost}</p> : null}
          </div>
        ) : null}

        {openLink && !code && !wantNew ? (
          <p className="gr-line">
            {INVITE.openElsewhere}{' '}
            <button type="button" className="sf-link" onClick={() => setWantNew(true)}>
              {INVITE.newLink}
            </button>
          </p>
        ) : null}

        {showMake ? (
          <div className="gr-make">
            {counts.oral ? (
              <label className="gr-consent" htmlFor={consentId}>
                <input id={consentId} type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>{INVITE.consent}</span>
              </label>
            ) : null}
            <button
              type="button"
              className="sf-primary gr-go"
              disabled={creating || (counts.oral && !consent)}
              aria-busy={creating || undefined}
              onClick={() => void create()}
            >
              {creating ? INVITE.creating : INVITE.create}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="gr-note" role="alert">
            {error}
          </p>
        ) : null}

        {seatsLine ? (
          <div className="gr-seats">
            <p className="gr-line">
              {nb(seatsLine)}
              {members > 0 || (seatLink && seatLink.members > 0) ? (
                <>
                  {' · '}
                  <button type="button" className="sf-link" aria-expanded={who} onClick={() => setWho((value) => !value)}>
                    {INVITE.who}
                  </button>
                </>
              ) : null}
            </p>
            {who ? <MembersList containerId={containerId} onChanged={() => onChanged?.()} /> : null}
            {linkId && !showMake ? (
              closing ? (
                <p className="gr-line gr-ask">
                  <span>{INVITE.revokeAsk}</span>
                  <button type="button" className="sf-link" onClick={() => void revoke()}>
                    {INVITE.revokeYes}
                  </button>
                  <button type="button" className="sf-link" data-muted="" onClick={() => setClosing(false)}>
                    {INVITE.revokeNo}
                  </button>
                </p>
              ) : (
                <p className="gr-line">
                  <button type="button" className="sf-link" data-muted="" onClick={() => setClosing(true)}>
                    {INVITE.revoke}
                  </button>
                </p>
              )
            ) : null}
          </div>
        ) : null}
        <GroupBotInvite containerId={containerId} linkOpen={Boolean(linkId) && !showMake} />
      </div>
    </div>
  );
}
