import type { ReactNode } from 'react';
import { KEYS } from '../containers/copyImport';
import TypeChoice from './TypeChoice';
import type { BuildType } from './copyTest';

/**
 * The row above the builder's questions: «Добавить вопрос», which asks the kind first (TypeChoice), the line an added
 * question leaves, and room for the page's other tools (`children`, drawn after «Добавить вопрос»).
 */

interface Props {
  /** «Добавить вопрос» is offered (not while an editor is open, nor on an empty test: it shows the kinds itself). */
  canAdd: boolean;
  /** The kinds are shown in place of «Добавить вопрос». */
  choosing: boolean;
  onChoosing: (open: boolean) => void;
  onPick: (type: BuildType) => void;
  /** The line after a change made from here («Вопрос 5 добавлен.»). */
  note?: string | null;
  children?: ReactNode;
}

export default function BuildToolbar({ canAdd, choosing, onChoosing, onPick, note = null, children }: Props) {
  // Always drawn, so its status line is in place before a line comes (an empty row and line take no room: build.css).
  return (
    <div className="tb-tools">
      {canAdd && choosing ? (
        <TypeChoice onPick={onPick} onCancel={() => onChoosing(false)} />
      ) : (
        <div className="tb-tools-row">
          {canAdd ? (
            <button type="button" className="ex-secondary ex-new" data-act="add" onClick={() => onChoosing(true)}>
              {KEYS.add}
              <span className="ex-new-dot" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </button>
          ) : null}
          {children}
        </div>
      )}
      <p className="tb-tools-note" role="status">
        {note ?? ''}
      </p>
    </div>
  );
}
