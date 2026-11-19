import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import MoreMenu, { type MoreMenuItem } from '../ui/MoreMenu';
import { glue, MENU_MORE, RENAME, RENAME_FIELD, RENAME_HOW } from './copy';

/**
 * The header of the exam page, a subject's page and the test's page, as today's oral exam page draws it: on a computer
 * the crumb («‹ Экзамены» as a white pill), the name, one meta line and the page's actions — at most three white pills
 * (release 47.3, owner 18.10: a row of eight was too many), the rest in «Ещё» as on a phone; on a phone the name with
 * the round «⋯» beside it and one meta line (10_Project/Phone_Declutter_2026-10-08: the top line already says
 * «‹ Экзамены»). `lead` stands first in the row on both (the test's own buttons).
 *
 * With `onRename` the name is changed in place (owner 19.11: «почему нельзя изменить название предмета… например дважды
 * кликнув на название»): a double click on it, the pencil beside it (a computer) or «Переименовать» in the menu turn
 * it into a field in the same letters; Enter or a click away saves, Esc leaves it as it was.
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
  /** Saves a new name; null when saved, else the words of what went wrong (shown under the field). */
  onRename?: (title: string) => Promise<string | null>;
}

/** The longest name the tables take (containers_title_check, container_subjects_title_check). */
export const TITLE_MAX = 200;

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

function Pencil() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 7.5l3 3" />
    </svg>
  );
}

/** «Переименовать» in the menu: before the first danger item («Удалить»), else last. */
export function withRename(actions: HeadAction[], rename: HeadAction): HeadAction[] {
  const at = actions.findIndex((action) => action.danger);
  return at < 0 ? [...actions, rename] : [...actions.slice(0, at), rename, ...actions.slice(at)];
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

export default function PageHead({ title, meta, crumb, actions: given, menuLabel, phone, pills = HEAD_PILLS, lead = null, onRename }: PageHeadProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // The new name stands at once; the page's own (read again after the save) takes over when it comes.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [title]);
  const shownTitle = pending ?? title;
  const inputRef = useRef<HTMLInputElement>(null);
  /** The field counts a click away only once it has the focus itself (a menu gives its own back first). */
  const armed = useRef(false);
  useEffect(() => {
    if (!editing) return undefined;
    armed.current = false;
    const take = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
      armed.current = true;
    };
    const timer = window.setTimeout(take, 40);
    return () => window.clearTimeout(timer);
  }, [editing]);
  const startRename = () => {
    setDraft(shownTitle);
    setRenameError(null);
    setEditing(true);
  };
  const saveRename = async () => {
    if (saving || !onRename) return;
    const next = draft.replace(/\s+/g, ' ').trim();
    if (!next || next === shownTitle) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const failed = await onRename(next);
    setSaving(false);
    if (failed) {
      setRenameError(failed);
      return;
    }
    setPending(next);
    setEditing(false);
  };
  // A phone has no pencil and no double click: its «⋯» has «Переименовать» (a computer's row stays as it is).
  const actions = onRename ? withRename(given, { key: 'rename', label: RENAME, onSelect: startRename, phoneOnly: true }) : given;

  // A phone sizes the heading to its longest word, so the word fits beside the «⋯» (as on the oral page).
  const longestWord = Math.max(1, ...shownTitle.split(/\s+/).map((word) => word.length));
  const sized = phone ? ({ '--ct-h1-word': longestWord } as CSSProperties) : undefined;
  const name = editing ? (
    <h1 className="ct-h1" data-editing="" style={sized}>
      <input
        ref={inputRef}
        className="ct-h1-input"
        value={draft}
        maxLength={TITLE_MAX}
        aria-label={RENAME_FIELD}
        aria-invalid={renameError ? true : undefined}
        disabled={saving}
        enterKeyHint="done"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void saveRename();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            armed.current = false;
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (armed.current) void saveRename();
        }}
      />
    </h1>
  ) : (
    <h1 className="ct-h1" style={sized} title={onRename && !phone ? RENAME_HOW : undefined} onDoubleClick={onRename ? startRename : undefined}>
      {shownTitle}
    </h1>
  );
  const heading =
    onRename && !phone ? (
      <div className="ct-titleline" data-editing={editing ? '' : undefined}>
        {name}
        {editing ? null : (
          <button type="button" className="ct-rename" aria-label={RENAME} title={RENAME} onClick={startRename}>
            <Pencil />
          </button>
        )}
      </div>
    ) : (
      name
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
      {editing && renameError ? (
        <p className="ct-rename-error" role="alert">
          {renameError}
        </p>
      ) : null}
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
