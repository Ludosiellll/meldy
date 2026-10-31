import type { ReactNode } from 'react';
import { KEYS } from '../containers/copyImport';
import TypeChoice from './TypeChoice';
import type { BuildType } from './copyTest';

/**
 * «Добавить вопрос», which asks the kind first (TypeChoice): above the builder's questions and again under the last
 * card (release 47, M2: the next question is written where it will stand), with room for the page's other tools
 * (`children`, drawn after «Добавить вопрос»).
 */

/** Above the list or under it; the page finds each one's buttons by `data-place`. */
export type ToolbarPlace = 'top' | 'end';

interface Props {
  place: ToolbarPlace;
  /** «Добавить вопрос» is offered (not on an empty test: it shows the kinds itself). */
  canAdd: boolean;
  /** The kinds are shown in place of «Добавить вопрос». */
  choosing: boolean;
  onChoosing: (open: boolean) => void;
  onPick: (type: BuildType) => void;
  children?: ReactNode;
  /** The kinds offered (TypeChoice's four by default; the studio's «Список» offers all). */
  types?: readonly BuildType[];
}

export default function BuildToolbar({ place, canAdd, choosing, onChoosing, onPick, children, types }: Props) {
  return (
    <div className="tb-tools" data-place={place}>
      {canAdd && choosing ? (
        <TypeChoice onPick={onPick} onCancel={() => onChoosing(false)} types={types} />
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
    </div>
  );
}
