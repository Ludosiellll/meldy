import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { fetchMembers, removeMember } from '../../../api/containers';
import type { MemberRow, Uuid } from '../../../types/container';
import { dayText, errorText, MEMBERS } from '../copyImport';
import { useFocusAfter } from '../useFocusAfter';
import './group.css';

/**
 * «Кто вошёл» (spec §9, decision 52): the members by the name they gave in «Профиль» and the day they came in — no
 * progress of anyone. The author removes one («Убрать», the database then refuses their return by the link until
 * «Вернуть») or everyone; a removed member keeps their own answers and stays under «Убраны» with «Вернуть», also when
 * nobody else is left (usability check M1). The list reports a change, so the page re-reads its counts (and «Удалить
 * экзамен» is allowed once nobody is left: MC009).
 *
 * An inline confirm gives «Отмена» the focus and gives it back to «Убрать» when it closes; after a change the focus
 * follows the member to their new row (m9).
 */

interface Props {
  containerId: Uuid;
  onChanged?: () => void;
}

export default function MembersList({ containerId, onChanged }: Props) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const askId = useId();
  const focusAfter = useFocusAfter();

  /**
   * The list's buttons carry `data-key` («remove:<id>», «yes:<id>», «no:<id>», «restore:<id>»; «*» is everyone). A key
   * no longer there (a member returned who had left) falls to the list's first button, so the focus stays in the list.
   */
  const focusKey = (key: string) =>
    focusAfter(() => {
      const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []);
      return buttons.find((button) => button.dataset.key === key) ?? buttons[0];
    });

  const load = useCallback(() => {
    setFailed(false);
    fetchMembers(containerId).then(
      (list) => setRows(list),
      () => setFailed(true),
    );
  }, [containerId]);
  useEffect(load, [load]);

  const active = (rows ?? []).filter((row) => !row.left_at && !row.removed_at);
  const removed = (rows ?? []).filter((row) => row.removed_at);

  const ask = (key: string) => {
    setAsking(key);
    focusKey(`no:${key}`);
  };
  const unask = (key: string) => {
    setAsking(null);
    focusKey(`remove:${key}`);
  };

  const act = async (userId: string | null, restore = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeMember(containerId, userId, restore);
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
      // The pressed button was disabled while the call ran, so the focus left it: it comes back.
      focusKey(restore ? `restore:${userId}` : `yes:${userId ?? '*'}`);
      return;
    }
    setAsking(null);
    onChanged?.();
    try {
      const list = await fetchMembers(containerId);
      setRows(list);
      // The focus follows the member: to «Вернуть» under «Убраны», or back to «Убрать» (everyone: the first of them).
      const moved = userId ?? list.find((row) => (restore ? !row.left_at && !row.removed_at : row.removed_at))?.user_id;
      focusKey(`${restore ? 'remove' : 'restore'}:${moved ?? ''}`);
    } catch {
      // Done, but the list could not be read again: say so rather than show it as it was.
      setFailed(true);
      focusKey('retry');
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <div className="gr-members" ref={rootRef}>
        <p className="gr-line" role="alert">
          {MEMBERS.loadFailed}{' '}
          <button type="button" className="sf-link" data-key="retry" onClick={load}>
            {MEMBERS.retry}
          </button>
        </p>
      </div>
    );
  }
  if (!rows) return <div className="gr-members" aria-busy="true" />;

  return (
    <div className="gr-members" ref={rootRef}>
      {active.length === 0 && removed.length === 0 ? (
        <p className="gr-line" data-muted="">
          {rows.length === 0 ? MEMBERS.empty : MEMBERS.allLeft}
        </p>
      ) : null}
      {active.length > 0 ? (
        <ul className="gr-people" aria-label={MEMBERS.title}>
          {active.map((row) => {
            const name = row.name.trim() || MEMBERS.noName;
            return (
              <li key={row.user_id} className="gr-person">
                <span className="gr-person-name">{name}</span>
                <span className="gr-person-since">{MEMBERS.since(dayText(row.joined_at.slice(0, 10)))}</span>
                {asking === row.user_id ? (
                  <span className="gr-ask" role="group" aria-labelledby={`${askId}${row.user_id}`}>
                    <span id={`${askId}${row.user_id}`}>{MEMBERS.removeAsk(name)}</span>
                    <button type="button" className="sf-link" data-key={`yes:${row.user_id}`} disabled={busy} onClick={() => void act(row.user_id)}>
                      {MEMBERS.removeYes}
                    </button>
                    <button type="button" className="sf-link" data-muted="" data-key={`no:${row.user_id}`} disabled={busy} onClick={() => unask(row.user_id)}>
                      {MEMBERS.removeNo}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="sf-link gr-person-act" data-muted="" data-key={`remove:${row.user_id}`} onClick={() => ask(row.user_id)}>
                    {MEMBERS.remove}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {removed.length > 0 ? (
        <>
          <p className="gr-sub">{MEMBERS.removedTitle}</p>
          <ul className="gr-people" data-muted="">
            {removed.map((row) => (
              <li key={row.user_id} className="gr-person">
                <span className="gr-person-name">{row.name.trim() || MEMBERS.noName}</span>
                <button
                  type="button"
                  className="sf-link gr-person-act"
                  data-key={`restore:${row.user_id}`}
                  disabled={busy}
                  onClick={() => void act(row.user_id, true)}
                >
                  {MEMBERS.restore}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {active.length > 1 ? (
        asking === '*' ? (
          <p className="gr-line gr-ask" role="group" aria-labelledby={`${askId}all`}>
            <span id={`${askId}all`}>{MEMBERS.removeAllAsk(active.length)}</span>
            <button type="button" className="sf-link" data-key="yes:*" disabled={busy} onClick={() => void act(null)}>
              {MEMBERS.removeYes}
            </button>
            <button type="button" className="sf-link" data-muted="" data-key="no:*" disabled={busy} onClick={() => unask('*')}>
              {MEMBERS.removeNo}
            </button>
          </p>
        ) : (
          <p className="gr-line">
            <button type="button" className="sf-link" data-muted="" data-key="remove:*" onClick={() => ask('*')}>
              {MEMBERS.removeAll}
            </button>
          </p>
        )
      ) : null}
      {error ? (
        <p className="gr-line" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
