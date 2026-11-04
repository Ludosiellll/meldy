import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { createLink, extendLink, revokeLink } from '../../../api/containers';
import { copyText } from '../../../lib/clipboard';
import { track } from '../../../lib/telemetry';
import type { ContainerSummary, LinkCreated, Uuid } from '../../../types/container';
import { dayText, errorText, INVITE, MEMBERS, nb } from '../copyImport';
import { useFocusAfter } from '../useFocusAfter';
import MembersList from './MembersList';
import GroupBotInvite from '../../telegram/GroupBotInvite';
import InviteQr from './InviteQr';
import { keepLink, keptCode } from './linkStore';
import { byNewest, canExtend, extendedEnd, linkState, localDayOf, type ExamLink } from './links';
import './group.css';

/**
 * «Пригласить группу» for an exam (spec §9, decisions 24 and 52; Concept 1 §3.12 with the design critique I10): one
 * paragraph about what the group gets, the consent box only when the exam has oral subjects (their lectures and
 * answer points go to the members' copies), «Создать ссылку». The link is shown once — Meldy keeps only its
 * fingerprint — with «Скопировать» and a text for the group's chat; this device keeps the code to show it again, closed
 * links' codes too (opened again, the link is on screen again). Under it the link's end and «Продлить», the group's
 * one line, «В экзамене 12 участников · Кто вошёл», with the members (remove, return) and «Закрыть ссылку».
 * «Кто вошёл» stays while anyone ever came in, so a removed member can be returned (usability check M1).
 *
 * Several links can be open (owner, 04.11: a new link made on a device without the old one's code closed the link 19
 * members had joined by, and nothing said so). A new link closes nothing; every other open link is said in one line
 * («Ещё открыта ссылка от 14 октября: по ней вошли 19.») with «Продлить» when that moves its end and «Закрыть её»
 * (a confirm first); «Закрыть ссылку» closes only the link on screen. Closed and expired links are listed under
 * «Закрытые ссылки» with «Открыть снова»: their codes are in the group's chat, so they work again
 * (container_link_extend, 20261107090200).
 *
 * The window changes its size only with the author's own press, never when the server answers (third live check: it
 * jumped once the link came, CLS 0.46 on a phone): «Создать ссылку» draws the link's place at once — the field says
 * «Создаём ссылку…», the text and the group's line are there — and the answer fills it in; while a call is out, the
 * part under the paragraph keeps the height it has, so a closed link or a failure moves nothing either, and the next
 * press gives the room back.
 *
 * The exam page opens it from «⋯ → Пригласить группу» (package D3b; release 47.3: over the page itself, not on the way
 * to «Настройки») with its summary; «Настройки» also does. «Показать QR» puts the link's code over the whole screen
 * (InviteQr).
 */

interface Props {
  summary: ContainerSummary;
  onClose: () => void;
  /** A link made, closed, extended or opened again, a member removed: the page reads its summary again. */
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
/** Closed links listed before «Показать все». */
const SHUT_SHOWN = 3;

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );
}

/** «14 октября» of a moment, in the device's zone. */
function dayOf(iso: string | null | undefined): string {
  return dayText(localDayOf(iso));
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
  const saidRef = useRef<HTMLParagraphElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const revokeNoRef = useRef<HTMLButtonElement>(null);
  const otherNoRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const counts = useMemo(() => examCounts(summary), [summary]);
  const focusAfter = useFocusAfter();

  // What this window changed since the page read its summary: a link made here, links closed, extended, opened again.
  const [created, setCreated] = useState<(LinkCreated & { kept: boolean; created_at: string }) | null>(null);
  const [changed, setChanged] = useState<Record<string, Partial<ExamLink>>>({});
  const now = Date.now();
  const links = useMemo(() => {
    const read = summary.owner?.links ?? [];
    const made: ExamLink[] =
      created && !read.some((link) => link.id === created.link_id)
        ? [{ id: created.link_id, created_at: created.created_at, expires_at: created.expires_at ?? null, revoked_at: null, members: 0, max_members: 60, oral: created.oral_subjects }]
        : [];
    return byNewest([...made, ...read].map((link) => (changed[link.id] ? { ...link, ...changed[link.id] } : link)));
  }, [summary.owner?.links, created, changed]);
  const open = links.filter((link) => linkState(link, now) === 'open');
  const shut = links.filter((link) => linkState(link, now) !== 'open');
  const codeOf = (link: ExamLink | null): string | null =>
    !link ? null : created && created.link_id === link.id ? created.code : keptCode(containerId, link.id);
  // The link on screen: the newest open one this device has the code of (one made here first).
  const shown = open.find((link) => codeOf(link) !== null) ?? null;
  const code = codeOf(shown);

  const [wantNew, setWantNew] = useState(false);
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  const [announce, setAnnounce] = useState('');
  const [closing, setClosing] = useState(false);
  const [closingOther, setClosingOther] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [who, setWho] = useState(false);
  const [qr, setQr] = useState(false);
  const [allShut, setAllShut] = useState(false);
  const busy = creating || acting !== null;
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

  /** What a press did, said on screen where the focus goes (so a screen reader reads it once). */
  const tell = (text: string) => {
    setSaid(text);
    setAnnounce('');
    focusAfter(() => saidRef.current);
  };

  const create = async () => {
    if (busy || (counts.oral && !consent)) return;
    setCreating(true);
    setError(null);
    setSaid(null);
    setClosing(false);
    setClosingOther(null);
    setAnnounce(INVITE.creating);
    // The link's place is on screen from the press: the focus waits in its field.
    focusAfter(() => linkRef.current);
    let made = false;
    try {
      // A new link closes nothing: the open ones stay open and are said under it.
      const result = await createLink(containerId, 60, counts.oral ? INVITE.consent : null);
      made = true;
      const kept = keepLink(containerId, result.link_id, result.code);
      setCreated({ ...result, kept, created_at: new Date().toISOString() });
      setWantNew(false);
      setAnnounce(INVITE.made);
      track('container.link_created', { oral: counts.oral, open: open.length });
      focusAfter(() => copyRef.current);
    } catch (failure) {
      setError(errorText(failure, INVITE.errors, INVITE.failed));
      setAnnounce('');
      // «Создать ссылку» gave its place to the link's while it worked: it comes back, and the focus with it.
      focusAfter(() => createRef.current);
    } finally {
      setCreating(false);
      if (made) onChanged?.();
    }
  };

  /** Closes one link: the one on screen («Закрыть ссылку») or another open one («Закрыть её»). */
  const close = async (link: ExamLink, onScreen: boolean) => {
    if (busy) return;
    setActing(link.id);
    setError(null);
    let done = false;
    try {
      await revokeLink(link.id);
      done = true;
      setChanged((current) => ({ ...current, [link.id]: { ...current[link.id], revoked_at: new Date().toISOString() } }));
      if (created?.link_id === link.id) setCreated(null);
      setClosing(false);
      setClosingOther(null);
      setWantNew(false);
      tell(onScreen ? INVITE.revoked : INVITE.closedOther(dayOf(link.created_at)));
    } catch (failure) {
      setError(errorText(failure, INVITE.errors));
    } finally {
      setActing(null);
      if (done) onChanged?.();
    }
  };

  /** «Продлить» an open link, or «Открыть снова» a closed or expired one (container_link_extend). */
  const extend = async (link: ExamLink) => {
    if (busy) return;
    setActing(link.id);
    setError(null);
    let done = false;
    try {
      const result = await extendLink(link.id);
      done = true;
      setChanged((current) => ({ ...current, [link.id]: { ...current[link.id], revoked_at: null, expires_at: result.expires_at } }));
      const until = dayOf(result.expires_at);
      tell(result.reopened ? INVITE.reopened(dayOf(link.created_at), until) : INVITE.extended(until));
      track('container.link_extended', { reopened: result.reopened });
    } catch (failure) {
      setError(errorText(failure, INVITE.errors));
    } finally {
      setActing(null);
      if (done) onChanged?.();
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
  const askOther = (id: string) => {
    setClosingOther(id);
    focusAfter(() => otherNoRef.current);
  };
  const keepOther = (id: string) => {
    setClosingOther(null);
    focusAfter(() => boxRef.current?.querySelector<HTMLElement>(`[data-close="${id}"]`));
  };
  const wantNewLink = () => {
    setWantNew(true);
    setSaid(null);
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

  // While a new link is made its place is the field's: the one there before is said with the others from the press on,
  // so nothing moves when the answer comes.
  const fieldLink = creating ? null : shown;
  const others = open.filter((link) => link !== fieldLink);
  const members = summary.owner?.members ?? 0;
  // Anyone ever in: a seat taken through any link of the exam, closed ones too (a rejoin takes none).
  const everJoined = members > 0 || links.some((link) => link.members > 0);
  const showMake = !creating && (open.length === 0 || wantNew);
  const linkShown = Boolean(shown) && !showMake && !creating;
  // The link on screen, or its place while it is being made (the same lines: the answer only fills them in).
  const linkPlace = creating || linkShown;
  // The group's one line: who is in the exam now; «Пока никто не вошёл» only beside an open link nobody has used yet.
  const seatsLine = everJoined || open.length > 0 || creating ? MEMBERS.inExam(members, everJoined) : null;
  // Every seat of the link on screen taken: said under the group's line, with the way to a new link.
  const full = linkShown && shown && shown.members >= shown.max_members ? shown : null;
  // Open links whose code is not here, while nothing is on screen: said above the way to a new one.
  const elsewhere = !shown && !creating && !wantNew && open.length > 0;
  const shutShown = allShut ? shut : shut.slice(0, SHUT_SHOWN);
  // The end under the field: the link's, or while it is made the one it will get (the line is there from the press).
  const endsAt = creating ? new Date(extendedEnd(summary, now)).toISOString() : fieldLink?.expires_at ?? null;

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
          {said && !creating ? (
            <p ref={saidRef} className="gr-line gr-said" tabIndex={-1}>
              {nb(said)}
            </p>
          ) : null}

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
              <div className="gr-acts">
                <button type="button" className="gr-copy gr-copy-text" disabled={creating} onClick={() => void copy('text')}>
                  {copied === 'text' ? INVITE.copied : INVITE.copyText}
                </button>
                <button type="button" className="gr-qr-b" aria-haspopup="dialog" disabled={creating || !url} onClick={() => setQr(true)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="4" width="6" height="6" rx="1" />
                    <rect x="14" y="4" width="6" height="6" rx="1" />
                    <rect x="4" y="14" width="6" height="6" rx="1" />
                    <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" strokeLinecap="round" />
                  </svg>
                  {INVITE.qr}
                </button>
              </div>
              {created || creating ? <p className="gr-once">{created && !created.kept ? INVITE.onceLost : INVITE.once}</p> : null}
              {endsAt ? (
                <p className="gr-line gr-ends" data-muted="">
                  {nb(INVITE.ends(dayOf(endsAt)))}
                  {fieldLink && canExtend(fieldLink, summary, now) ? (
                    <>
                      {' '}
                      <button type="button" className="sf-link" disabled={busy} onClick={() => void extend(fieldLink)}>
                        {INVITE.extend}
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}

          {elsewhere ? (
            <p className="gr-line">
              {INVITE.openElsewhere(open.length)}{' '}
              <button type="button" className="sf-link" onClick={wantNewLink}>
                {INVITE.newLink}
              </button>
            </p>
          ) : null}

          {showMake ? (
            <div className="gr-make" ref={makeRef}>
              {/* Beside the button that makes it: the new link closes none of the open ones. */}
              {open.length > 0 ? <p className="gr-line">{nb(INVITE.newLinkNote(open.length))}</p> : null}
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

          {others.length > 0 ? (
            <ul className="gr-others" aria-label={INVITE.title}>
              {others.map((link) => {
                const day = dayOf(link.created_at);
                return (
                  <li key={link.id} className="gr-other">
                    <p className="gr-line">
                      {nb(INVITE.otherOpen(day, link.members, linkPlace))}
                      {link.expires_at ? ` ${nb(INVITE.otherEnds(dayOf(link.expires_at)))}` : null}{' '}
                      {canExtend(link, summary, now) ? (
                        <>
                          {/* The dot stays with the word before it: a line never starts with it. */}
                          <span className="gr-keep">
                            <button type="button" className="sf-link" disabled={busy} onClick={() => void extend(link)}>
                              {INVITE.extend}
                            </button>
                            {'\u00a0·'}
                          </span>{' '}
                        </>
                      ) : null}
                      <button type="button" className="sf-link" data-muted="" data-close={link.id} disabled={busy} onClick={() => askOther(link.id)}>
                        {INVITE.closeOther}
                      </button>
                    </p>
                    {closingOther === link.id ? (
                      <p className="gr-line gr-ask" role="group" aria-labelledby={`${titleId}-close-${link.id}`}>
                        <span id={`${titleId}-close-${link.id}`}>{nb(INVITE.closeOtherAsk(day))}</span>
                        <button type="button" className="sf-link" disabled={busy} onClick={() => void close(link, false)}>
                          {INVITE.revokeYes}
                        </button>
                        <button ref={otherNoRef} type="button" className="sf-link" data-muted="" onClick={() => keepOther(link.id)}>
                          {INVITE.revokeNo}
                        </button>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
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
                  {nb(INVITE.full(full.max_members))}{' '}
                  <button type="button" className="sf-link" onClick={wantNewLink}>
                    {INVITE.newLink}
                  </button>
                </p>
              ) : null}
              {who ? <MembersList containerId={containerId} onChanged={() => onChanged?.()} /> : null}
              {linkShown || creating ? (
                closing && fieldLink ? (
                  <p className="gr-line gr-ask" role="group" aria-labelledby={`${titleId}-revoke`}>
                    <span id={`${titleId}-revoke`}>{INVITE.revokeAsk}</span>
                    <button type="button" className="sf-link" disabled={busy} onClick={() => void close(fieldLink, true)}>
                      {INVITE.revokeYes}
                    </button>
                    <button ref={revokeNoRef} type="button" className="sf-link" data-muted="" onClick={keepOpen}>
                      {INVITE.revokeNo}
                    </button>
                  </p>
                ) : (
                  <p className="gr-line">
                    <button ref={revokeRef} type="button" className="sf-link" data-muted="" disabled={busy} onClick={askRevoke}>
                      {INVITE.revoke}
                    </button>
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          {shut.length > 0 ? (
            <div className="gr-shut">
              <h3 className="gr-sub">{INVITE.shut}</h3>
              <ul className="gr-people">
                {shutShown.map((link) => {
                  const state = linkState(link, now);
                  return (
                    <li key={link.id} className="gr-person">
                      <span className="gr-person-name">{nb(INVITE.shutName(dayOf(link.created_at)))}</span>
                      <span className="gr-person-since">
                        {nb(state === 'revoked' ? INVITE.shutRevoked(dayOf(link.revoked_at), link.members) : INVITE.shutExpired(dayOf(link.expires_at), link.members))}
                      </span>
                      <span className="gr-person-act">
                        <button type="button" className="sf-link" disabled={busy} onClick={() => void extend(link)}>
                          {INVITE.reopen}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {shut.length > shutShown.length ? (
                <p className="gr-line">
                  <button type="button" className="sf-link" data-muted="" onClick={() => setAllShut(true)}>
                    {INVITE.shutAll(shut.length)}
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <GroupBotInvite containerId={containerId} linkOpen={open.length > 0 && !showMake && !creating} />
      </div>
      {qr && url ? <InviteQr url={url} title={summary.title} onClose={() => setQr(false)} /> : null}
    </div>
  );
}
