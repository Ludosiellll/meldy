/**
 * Windows over the stage: «Разбор» (each played question with its key and counts; each student's result), «Игроки»
 * (remove a player) and the confirmations. Plain dialogs: the first button takes the focus, Esc closes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RosterRow } from '../../../lib/live/types';
import { Character } from '../art/Character';
import { END, LETTERS, PLAYERS_SHEET, REVIEW, nb } from './copy';
import type { LoggedQuestion } from './hostSession';
import { TileShape } from './Panel';
import { rankRoster } from './Podium';

function Dialog({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);
  return (
    <div className="lvh-dim" onClick={onClose}>
      <div
        ref={box}
        className={`lvh-dialog${wide ? ' lvh-dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmBox({ title, why, yes, no, onYes, onNo, busy }: { title: string; why: string; yes: string; no: string; onYes: () => void; onNo: () => void; busy?: boolean }) {
  return (
    <Dialog label={title} onClose={onNo}>
      <h2 className="lvh-dialog-title">{title}</h2>
      <p className="lvh-dialog-text">{why}</p>
      <div className="lvh-dialog-actions">
        <button type="button" className="lvh-btn lvh-btn--white" onClick={onNo}>
          {no}
        </button>
        <button type="button" className="lvh-btn lvh-btn--red" onClick={onYes} disabled={busy}>
          {yes}
        </button>
      </div>
    </Dialog>
  );
}

export function EndConfirm({ onYes, onNo, busy }: { onYes: () => void; onNo: () => void; busy: boolean }) {
  return <ConfirmBox title={END.ask} why={END.why} yes={END.yes} no={END.cancel} onYes={onYes} onNo={onNo} busy={busy} />;
}

export function KickConfirm({ row, onYes, onNo, busy }: { row: RosterRow; onYes: () => void; onNo: () => void; busy: boolean }) {
  return (
    <ConfirmBox
      title={PLAYERS_SHEET.kickAsk(row.name)}
      why={PLAYERS_SHEET.kickWhy}
      yes={PLAYERS_SHEET.kickYes}
      no={PLAYERS_SHEET.cancel}
      onYes={onYes}
      onNo={onNo}
      busy={busy}
    />
  );
}

export function PlayersSheet({ roster, onKick, onClose }: { roster: RosterRow[]; onKick: (row: RosterRow) => void; onClose: () => void }) {
  const rows = rankRoster(roster);
  return (
    <Dialog label={PLAYERS_SHEET.title(rows.length)} onClose={onClose} wide>
      <div className="lvh-sheet-head">
        <h2 className="lvh-dialog-title">{PLAYERS_SHEET.title(rows.length)}</h2>
        <button type="button" className="lvh-btn lvh-btn--white lvh-btn--small" onClick={onClose}>
          {PLAYERS_SHEET.close}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="lvh-dialog-text">{PLAYERS_SHEET.empty}</p>
      ) : (
        <ul className="lvh-people">
          {rows.map((r) => (
            <li key={r.player_id}>
              <Character look={r.look} size={44} move="none" frozen={r.frozen} />
              <span className="lvh-people-name">{r.name}</span>
              <span className="lvh-people-meta">
                {PLAYERS_SHEET.dmg(r.dmg)}
                {r.frozen ? ` · ${PLAYERS_SHEET.frozen}` : ''}
              </span>
              <button type="button" className="lvh-btn lvh-btn--white lvh-btn--small" onClick={() => onKick(r)}>
                {PLAYERS_SHEET.kick}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function ReviewSheet({ log, roster, asked, onClose }: { log: LoggedQuestion[]; roster: RosterRow[]; asked: number; onClose: () => void }) {
  const [tab, setTab] = useState<'questions' | 'students'>('questions');
  const rows = rankRoster(roster);
  const played = Array.from({ length: Math.max(0, asked) }, (_, qi) => log.find((q) => q.qi === qi) ?? null);
  return (
    <Dialog label={REVIEW.title} onClose={onClose} wide>
      <div className="lvh-sheet-head">
        <h2 className="lvh-dialog-title">{REVIEW.title}</h2>
        <div className="lvh-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'questions'} onClick={() => setTab('questions')}>
            {REVIEW.questions}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'students'} onClick={() => setTab('students')}>
            {REVIEW.students}
          </button>
        </div>
        <button type="button" className="lvh-btn lvh-btn--white lvh-btn--small" onClick={onClose}>
          {REVIEW.close}
        </button>
      </div>
      <div className="lvh-sheet-body" role="tabpanel">
        {tab === 'questions' ? (
          played.length === 0 ? (
            <p className="lvh-dialog-text">{REVIEW.none}</p>
          ) : (
            <ol className="lvh-review">
              {played.map((q, qi) => (
                <li key={qi}>
                  <h3>
                    <span>{qi + 1}.</span> {q ? q.text : REVIEW.missing}
                  </h3>
                  {q ? (
                    <>
                      <ul className="lvh-review-opts">
                        {q.options.map((o, k) => (
                          <li key={k} data-key={q.key === k ? '' : undefined}>
                            <span className={`lvh-review-badge lvh-tile--a${k}`}>
                              <TileShape k={k} />
                              {LETTERS[k]}
                            </span>
                            <span className="lvh-review-text">{o}</span>
                            {q.counts ? <span className="lvh-review-n">{nb(q.counts[k] ?? 0)}</span> : null}
                          </li>
                        ))}
                      </ul>
                      {q.right !== null ? <p className="lvh-review-right">{REVIEW.right(q.right, q.players)}</p> : null}
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )
        ) : (
          <>
            <table className="lvh-table">
              <thead>
                <tr>
                  <th scope="col">{REVIEW.place}</th>
                  <th scope="col">{REVIEW.name}</th>
                  <th scope="col">{REVIEW.rightCol}</th>
                  <th scope="col">{REVIEW.dmg}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.player_id}>
                    <td>{i + 1}</td>
                    <td>
                      <span className="lvh-table-who">
                        <Character look={r.look} size={34} move="none" />
                        {r.name}
                      </span>
                    </td>
                    <td>{REVIEW.of(r.right, Math.max(asked, 0))}</td>
                    <td>{nb(r.dmg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lvh-dialog-note">{REVIEW.note}</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
