import { useCallback, useEffect, useState } from 'react';
import { fetchMembers, removeMember } from '../../../api/containers';
import type { MemberRow, Uuid } from '../../../types/container';
import { dayText, errorText, MEMBERS } from '../copyImport';
import './group.css';

/**
 * «Кто вошёл» (spec §9, decision 52): the members by the name they gave in «Профиль» and the day they came in — no
 * progress of anyone. The author removes one («Убрать», the database then refuses their return by the link until
 * «Вернуть») or everyone; a removed member keeps their own answers. The list reports a change, so the page re-reads
 * its counts (and «Удалить экзамен» is allowed once nobody is left: MC009).
 */

interface Props {
  containerId: Uuid;
  onChanged?: (active: number) => void;
}

export default function MembersList({ containerId, onChanged }: Props) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const act = async (userId: string | null, restore = false) => {
    setBusy(true);
    setError(null);
    try {
      await removeMember(containerId, userId, restore);
      setAsking(null);
      const list = await fetchMembers(containerId);
      setRows(list);
      onChanged?.(list.filter((row) => !row.left_at && !row.removed_at).length);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <div className="gr-members">
        <p className="gr-line" role="alert">
          {MEMBERS.loadFailed}{' '}
          <button type="button" className="sf-link" onClick={load}>
            {MEMBERS.retry}
          </button>
        </p>
      </div>
    );
  }
  if (!rows) return <div className="gr-members" aria-busy="true" />;

  return (
    <div className="gr-members">
      {active.length === 0 ? <p className="gr-line" data-muted="">{MEMBERS.empty}</p> : null}
      {active.length > 0 ? (
        <ul className="gr-people" aria-label={MEMBERS.title}>
          {active.map((row) => {
            const name = row.name.trim() || MEMBERS.noName;
            return (
              <li key={row.user_id} className="gr-person">
                <span className="gr-person-name">{name}</span>
                <span className="gr-person-since">{MEMBERS.since(dayText(row.joined_at.slice(0, 10)))}</span>
                {asking === row.user_id ? (
                  <span className="gr-ask">
                    <span>{MEMBERS.removeAsk(name)}</span>
                    <button type="button" className="sf-link" disabled={busy} onClick={() => void act(row.user_id)}>
                      {MEMBERS.removeYes}
                    </button>
                    <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={() => setAsking(null)}>
                      {MEMBERS.removeNo}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="sf-link gr-person-act" data-muted="" onClick={() => setAsking(row.user_id)}>
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
                <button type="button" className="sf-link gr-person-act" disabled={busy} onClick={() => void act(row.user_id, true)}>
                  {MEMBERS.restore}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {active.length > 1 ? (
        asking === '*' ? (
          <p className="gr-line gr-ask">
            <span>{MEMBERS.removeAllAsk(active.length)}</span>
            <button type="button" className="sf-link" disabled={busy} onClick={() => void act(null)}>
              {MEMBERS.removeYes}
            </button>
            <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={() => setAsking(null)}>
              {MEMBERS.removeNo}
            </button>
          </p>
        ) : (
          <p className="gr-line">
            <button type="button" className="sf-link" data-muted="" onClick={() => setAsking('*')}>
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
