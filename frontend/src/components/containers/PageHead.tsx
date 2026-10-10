import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import MoreMenu, { type MoreMenuItem } from '../ui/MoreMenu';
import { glue } from './copy';

/**
 * The header of the exam page and of a subject's page, as today's oral exam page draws it: on a computer the crumb
 * («‹ Экзамены» as a white pill), the name, one meta line and the page's other actions as white pills; on a phone the
 * name with the round «⋯» beside it and one meta line (10_Project/Phone_Declutter_2026-10-08: the top line already says
 * «‹ Экзамены»).
 */
export interface HeadAction extends MoreMenuItem {
  /** Kept off the computer's row (still in the phone's «⋯»). */
  phoneOnly?: boolean;
}

interface PageHeadProps {
  title: string;
  meta: string;
  crumb: { to: string; label: string };
  actions: HeadAction[];
  menuLabel: string;
  phone: boolean;
}

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export default function PageHead({ title, meta, crumb, actions, menuLabel, phone }: PageHeadProps) {
  // A phone sizes the heading to its longest word, so the word fits beside the «⋯» (as on the oral page).
  const longestWord = Math.max(1, ...title.split(/\s+/).map((word) => word.length));
  const heading = (
    <h1 className="ct-h1" style={phone ? ({ '--ct-h1-word': longestWord } as CSSProperties) : undefined}>
      {title}
    </h1>
  );
  const rowActions = actions.filter((action) => !action.phoneOnly);
  return (
    <header className="ct-head">
      <p className="ct-crumb">
        <Link to={crumb.to}>
          <BackArrow />
          {crumb.label}
        </Link>
      </p>
      {phone ? (
        <div className="ct-titlerow">
          {heading}
          {actions.length > 0 ? (
            <div className="ct-more">
              <MoreMenu items={actions} label={menuLabel} variant="round" />
            </div>
          ) : null}
        </div>
      ) : (
        heading
      )}
      <p className="ct-meta">{glue(meta)}</p>
      {!phone && rowActions.length > 0 ? (
        <div className="ct-links">
          {rowActions.map((action) =>
            action.to ? (
              <Link key={action.key} className={action.danger ? 'sf-link ct-quiet' : 'ct-pill-link'} data-muted={action.danger ? '' : undefined} to={action.to}>
                {action.label}
              </Link>
            ) : (
              <button
                key={action.key}
                type="button"
                className={action.danger ? 'sf-link ct-quiet' : 'ct-pill-link'}
                data-muted={action.danger ? '' : undefined}
                onClick={action.onSelect}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </header>
  );
}
