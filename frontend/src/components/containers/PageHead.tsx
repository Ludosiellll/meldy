import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import MoreMenu, { type MoreMenuItem } from '../ui/MoreMenu';
import { glue, MENU_MORE } from './copy';

/**
 * The header of the exam page, a subject's page and the test's page, as today's oral exam page draws it: on a computer
 * the crumb («‹ Экзамены» as a white pill), the name, one meta line and the page's actions — at most three white pills
 * (release 47.3, owner 18.10: a row of eight was too many), the rest in «Ещё» as on a phone; on a phone the name with
 * the round «⋯» beside it and one meta line (10_Project/Phone_Declutter_2026-10-08: the top line already says
 * «‹ Экзамены»). `lead` stands first in the row on both (the test's own buttons).
 */
export interface HeadAction extends MoreMenuItem {
  /** Kept off the computer's row (still in the phone's «⋯»). */
  phoneOnly?: boolean;
}

/** The most pills the computer's row shows; the rest go to «Ещё». */
export const HEAD_PILLS = 3;

interface PageHeadProps {
  title: string;
  meta: string;
  crumb: { to: string; label: string };
  actions: HeadAction[];
  menuLabel: string;
  phone: boolean;
  /** How many of the actions are pills on a computer (the first ones that are not «danger»); the rest go to «Ещё». */
  pills?: number;
  /** The page's own buttons, first in the row (a computer) or under the meta (a phone). */
  lead?: ReactNode;
}

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

/** The computer's row: the first `pills` actions that are not «danger», and the rest (in their order) for «Ещё». */
export function splitActions(actions: HeadAction[], pills: number = HEAD_PILLS): { shown: HeadAction[]; more: HeadAction[] } {
  const row = actions.filter((action) => !action.phoneOnly);
  const shown: HeadAction[] = [];
  const more: HeadAction[] = [];
  for (const action of row) {
    if (!action.danger && shown.length < pills) shown.push(action);
    else more.push(action);
  }
  return { shown, more };
}

export default function PageHead({ title, meta, crumb, actions, menuLabel, phone, pills = HEAD_PILLS, lead = null }: PageHeadProps) {
  // A phone sizes the heading to its longest word, so the word fits beside the «⋯» (as on the oral page).
  const longestWord = Math.max(1, ...title.split(/\s+/).map((word) => word.length));
  const heading = (
    <h1 className="ct-h1" style={phone ? ({ '--ct-h1-word': longestWord } as CSSProperties) : undefined}>
      {title}
    </h1>
  );
  const { shown, more } = splitActions(actions, pills);
  const row = phone ? Boolean(lead) : Boolean(lead) || shown.length > 0 || more.length > 0;
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
      {row ? (
        <div className="ct-links" data-lead={lead ? '' : undefined}>
          {lead}
          {!phone
            ? shown.map((action) =>
                action.to ? (
                  <Link key={action.key} className="ct-pill-link" to={action.to}>
                    {action.label}
                  </Link>
                ) : (
                  <button
                    key={action.key}
                    type="button"
                    className="ct-pill-link"
                    aria-haspopup={action.haspopup ?? undefined}
                    onClick={action.onSelect}
                  >
                    {action.label}
                  </button>
                ),
              )
            : null}
          {!phone && more.length > 0 ? (
            <div className="ct-more-pill">
              <MoreMenu items={more} label={menuLabel} text={MENU_MORE} variant="text" />
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
