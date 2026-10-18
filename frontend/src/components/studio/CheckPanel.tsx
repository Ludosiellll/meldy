import { useState } from 'react';
import type { Hint } from '../../lib/studio/checker';
import { errorText } from '../containers/copyImport';
import { STUDIO } from './copyStudio';
import type { Studio } from './useStudio';

/**
 * «Проверка теста» (spec §47.6, lib/studio/checker.ts): what to mend before sending and what to think about, each line
 * with «Показать» (the block on the page) and, when one press mends it, «Исправить».
 */
export default function CheckPanel({ studio, hints, onShow }: { studio: Studio; hints: readonly Hint[]; onShow: (blockId: string) => void }) {
  const [working, setWorking] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const groups: Array<{ level: Hint['level']; title: string; list: Hint[] }> = [
    { level: 'fix', title: STUDIO.checkFixGroup, list: hints.filter((hint) => hint.level === 'fix') },
    { level: 'think', title: STUDIO.checkThinkGroup, list: hints.filter((hint) => hint.level === 'think') },
  ];
  const fix = async (hint: Hint) => {
    if (!hint.fix) return;
    setWorking(hint.id);
    setNote(null);
    try {
      await studio.applyFix(hint.fix);
      setNote({ text: STUDIO.checkFixed, bad: false });
    } catch (error) {
      setNote({ text: errorText(error), bad: true });
    } finally {
      setWorking(null);
    }
  };
  return (
    <div className="st-panel-body st-check">
      <h3 className="st-panel-h">{STUDIO.check}</h3>
      <p className="st-lead">{hints.length === 0 ? STUDIO.checkEmpty : STUDIO.checkLead}</p>
      {groups.map((group) =>
        group.list.length === 0 ? null : (
          <section key={group.level} className="st-check-group" data-level={group.level} aria-label={group.title}>
            <p className="st-check-title">
              <span className="st-check-dot" aria-hidden="true" />
              {group.title}
              <span className="st-check-n">{group.list.length}</span>
            </p>
            <ul className="st-check-list">
              {group.list.map((hint) => (
                <li key={hint.id} className="st-check-item">
                  <p className="st-check-text">{hint.message}</p>
                  <p className="st-check-acts">
                    {hint.fix ? (
                      <button type="button" className="st-pill st-pill-small" disabled={working !== null} aria-busy={working === hint.id || undefined} onClick={() => void fix(hint)}>
                        {STUDIO.checkFix}
                      </button>
                    ) : null}
                    {hint.blockId ? (
                      <button type="button" className="sf-link" onClick={() => onShow(hint.blockId as string)}>
                        {STUDIO.checkShow}
                      </button>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      {note ? (
        <p className="st-note" data-bad={note.bad ? '' : undefined} role="status">
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
