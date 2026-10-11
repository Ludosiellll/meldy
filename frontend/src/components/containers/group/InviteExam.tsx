import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { createLink, revokeLink } from '../../../api/containers';
import { copyText } from '../../../lib/clipboard';
import { track } from '../../../lib/telemetry';
import type { ContainerSummary, LinkCreated, Uuid } from '../../../types/container';
import { errorText, INVITE, MEMBERS, nb } from '../copyImport';
import { useFocusAfter } from '../useFocusAfter';
import MembersList from './MembersList';
import GroupBotInvite from '../../telegram/GroupBotInvite';
import { forgetLink, keepLink, keptCode } from './linkStore';
import './group.css';

/**
 * «Пригласить группу» for an exam (spec §9, decisions 24 and 52; Concept 1 §3.12 with the design critique I10): one
 * paragraph about what the group gets, the consent box only when the exam has oral subjects (their lectures and
 * answer points go to the members' copies), «Создать ссылку». The link is shown once — Meldy keeps only its
 * fingerprint — with «Скопировать» and a text for the group's chat; this device keeps the code to show it again.
 * Under it the group's one line, «В экзамене 12 участников · Кто вошёл», with the members (remove, return) and
 * «Закрыть ссылку». «Кто вошёл» stays while anyone ever came in, so a removed member can be returned (usability
 * check M1).
 *
 * One link is open at a time (M2): «Закрыть ссылку» closes every open link of the exam, and a new link closes the open
 * ones before it is made (the window says so before «Создать новую ссылку»), so no link stays open unseen. A closed
 * link leaves «Ссылка закрыта…» on screen and the way to a new one.
 *
 * The window changes its size only with the author's own press, never when the server answers (third live check: it
 * jumped once the link came, CLS 0.46 on a phone): «Создать ссылку» draws the link's place at once — the field says
 * «Создаём ссылку…», the text and the group's line are there — and the answer fills it in; while a call is out, the
 * part under the paragraph keeps the height it has, so a closed link or a failure moves nothing either, and the next
 * press gives the room back.
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
  const copyRef = useRef<HTMLButtonElement>(null);
  const makeRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const closedRef = useRef<HTMLParagraphElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const revokeNoRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const counts = useMemo(() => examCounts(summary), [summary]);
  const focusAfter = useFocusAfter();

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
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  const [announce, setAnnounce] = useState('');
  const [closing, setClosing] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [who, setWho] = useState(false);
  const busy = creating || revoking;
  // The height of the part under the paragraph while a call is out, kept until the next press (no jump at the answer).
  const [hold, setHold] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (busy && areaRef.current) setHold(areaRef.current.getBoundingClientRect().height);
  }, [busy]);
  const release = () => {
    if (hold !== null && !busy) setHold(null);
  };

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

  /**
   * Closes every open link of the exam one by one: the one on screen and any other still open (made on another device,
   * or before a new link closed the old ones). `done` collects the closed ones; they stay closed on screen when a later
   * one fails (its error is thrown).
   */
  const closeOpen = async (done: string[]) => {
    const ids = [...new Set([...(created ? [created.link_id] : []), ...open.map((link) => link.id)])];
    try {
      for (const id of ids) {
        await revokeLink(id);
        forgetLink(containerId, id);
        done.push(id);
      }
    } finally {
      if (done.length > 0) {
        setClosed((current) => new Set([...current, ...done]));
        if (created && done.includes(created.link_id)) setCreated(null);
      }
    }
  };

  const create = async () => {
    if (busy || (counts.oral && !consent)) return;
    setCreating(true);
    setError(null);
    setAnnounce(INVITE.creating);
    // The link's place is on screen from the press: the focus waits in its field.
    focusAfter(() => linkRef.current);
    const done: string[] = [];
    let made = false;
    try {
      // The new link replaces the open ones: they close first, so no link stays open unseen.
      await closeOpen(done);
      const result = await createLink(containerId, 60, counts.oral ? INVITE.consent : null);
      made = true;
      const kept = keepLink(containerId, result.link_id, result.code);
      setCreated({ ...result, kept });
      setWantNew(false);
      setRevoked(false);
      setAnnounce(INVITE.made);
      track('container.link_created', { oral: counts.oral });
      focusAfter(() => copyRef.current);
    } catch (failure) {
      setError(errorText(failure, INVITE.errors, INVITE.failed));
      setAnnounce('');
      // «Создать ссылку» gave its place to the link's while it worked: it comes back, and the focus with it.
      focusAfter(() => createRef.current);
    } finally {
      setCreating(false);
      if (made || done.length > 0) onChanged?.();
    }
  };

  const revoke = async () => {
    if (busy || !linkId) return;
    setRevoking(true);
    setError(null);
    const done: string[] = [];
    try {
      await closeOpen(done);
      setClosing(false);
      setWantNew(false);
      setRevoked(true);
      focusAfter(() => closedRef.current);
    } catch (failure) {
      setError(errorText(failure, INVITE.errors));
    } finally {
      setRevoking(false);
      if (done.length > 0) onChanged?.();
    }
  };

  const askRevoke = () => {
    setClosing(true);
    focusAfter(() => revokeNoRef.current);
  };
  const keepOpen = () => {
    setClosing(false);
    focusAfter(() => revokeRef.current);
  };
  const wantNewLink = () => {
    setWantNew(true);
    focusAfter(() => makeRef.current?.querySelector<HTMLElement>('input, button'));
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

  const members = summary.owner?.members ?? 0;
  // Anyone ever in: a seat taken through any link of the exam, closed ones too (a rejoin takes none).
  const everJoined = members > 0 || (summary.owner?.links ?? []).some((link) => link.members > 0);
  const showMake = !creating && ((!openLink && !created) || wantNew);
  // While a new link is made, the old one (closed first) is not on screen any more.
  const linkShown = Boolean(linkId) && !showMake && !creating;
  // The link on screen, or its place while it is being made (the same lines: the answer only fills them in).
  const linkPlace = creating || Boolean(code && linkId && !wantNew);
  // The group's one line: who is in the exam now; «Пока никто не вошёл» only beside a link nobody has used yet.
  const seatsLine = everJoined || linkShown || creating ? MEMBERS.inExam(members, everJoined) : null;
  // Every seat of the open link taken: said under the group's line, with the way to a new link when this device can
  // make one beside the old (without the code here, the line above already offers it).
  const full = linkShown && openLink !== null && openLink.members >= openLink.max_members ? openLink : null;

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
        onPointerDownCapture={release}
        onKeyDownCapture={release}
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

        <div className="gr-area" ref={areaRef} style={hold === null ? undefined : { minHeight: hold }}>
          {linkPlace ? (
            <div className="gr-made" aria-busy={creating || undefined}>
              <label className="gr-label" htmlFor={`${titleId}-link`}>
                {INVITE.linkLabel}
              </label>
              <div className="gr-row">
                <input
                  id={`${titleId}-link`}
                  ref={linkRef}
                  className="gr-field"
                  readOnly
                  value={creating ? '' : url}
                  placeholder={creating ? INVITE.creating : undefined}
                  onFocus={(event) => event.target.select()}
                />
                <button ref={copyRef} type="button" className="gr-copy" disabled={creating} onClick={() => void copy('link')}>
                  <span className="gr-copy-w" aria-hidden={copied === 'link' || undefined}>
                    {INVITE.copy}
                  </span>
                  <span className="gr-copy-w" aria-hidden={copied !== 'link' || undefined}>
                    {INVITE.copied}
                  </span>
                </button>
              </div>
              <label className="gr-label" htmlFor={`${titleId}-text`}>
                {INVITE.textLabel}
              </label>
              <textarea id={`${titleId}-text`} ref={textRef} className="gr-field gr-text" readOnly rows={3} value={creating ? '' : message} />
              <button type="button" className="gr-copy gr-copy-text" disabled={creating} onClick={() => void copy('text')}>
                {copied === 'text' ? INVITE.copied : INVITE.copyText}
              </button>
              {created || creating ? <p className="gr-once">{created && !created.kept ? INVITE.onceLost : INVITE.once}</p> : null}
            </div>
          ) : null}

          {openLink && !code && !wantNew && !creating ? (
            <p className="gr-line">
              {INVITE.openElsewhere} {INVITE.newLinkNote}{' '}
              <button type="button" className="sf-link" onClick={wantNewLink}>
                {INVITE.newLink}
              </button>
            </p>
          ) : null}

          {revoked && !openLink && !created && !creating ? (
            <p ref={closedRef} className="gr-line" tabIndex={-1}>
              {INVITE.revoked}
            </p>
          ) : null}

          {showMake ? (
            <div className="gr-make" ref={makeRef}>
              {/* Beside the button that does it: the new link closes the open one (M2), said again after «Создать новую ссылку». */}
              {wantNew && openLink ? <p className="gr-line">{nb(INVITE.newLinkNote)}</p> : null}
              {counts.oral ? (
                <label className="gr-consent" htmlFor={consentId}>
                  <input id={consentId} type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  <span>{INVITE.consent}</span>
                </label>
              ) : null}
              <button
                ref={createRef}
                type="button"
                className="sf-primary gr-go"
                disabled={busy || (counts.oral && !consent)}
                onClick={() => void create()}
              >
                {INVITE.create}
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
                {everJoined ? (
                  <>
                    {' · '}
                    <button type="button" className="sf-link" aria-expanded={who} onClick={() => setWho((value) => !value)}>
                      {INVITE.who}
                    </button>
                  </>
                ) : null}
              </p>
              {full ? (
                <p className="gr-line">
                  {nb(INVITE.full(full.max_members))}
                  {code ? (
                    <>
                      {' '}
                      <button type="button" className="sf-link" onClick={wantNewLink}>
                        {INVITE.newLink}
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
              {who ? <MembersList containerId={containerId} onChanged={() => onChanged?.()} /> : null}
              {linkShown || creating ? (
                closing ? (
                  <p className="gr-line gr-ask" role="group" aria-labelledby={`${titleId}-revoke`}>
                    <span id={`${titleId}-revoke`}>{INVITE.revokeAsk}</span>
                    <button type="button" className="sf-link" onClick={() => void revoke()}>
                      {INVITE.revokeYes}
                    </button>
                    <button ref={revokeNoRef} type="button" className="sf-link" data-muted="" onClick={keepOpen}>
                      {INVITE.revokeNo}
                    </button>
                  </p>
                ) : (
                  <p className="gr-line">
                    <button ref={revokeRef} type="button" className="sf-link" data-muted="" disabled={creating} onClick={askRevoke}>
                      {INVITE.revoke}
                    </button>
                  </p>
                )
              ) : null}
            </div>
          ) : null}
        </div>
        <GroupBotInvite containerId={containerId} linkOpen={linkShown} />
      </div>
    </div>
  );
}
