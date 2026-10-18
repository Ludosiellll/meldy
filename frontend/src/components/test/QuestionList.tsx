import type { ReactNode } from 'react';
import type { TestItem } from '../../types/container';
import { KEYS, nb } from '../containers/copyImport';
import BuildCard, { type CardAction } from './BuildCard';
import { BUILD } from './copyTest';

/**
 * The builder's questions of one subject, in order: a card each (BuildCard), or the editor in its place while it is
 * open (the page draws the editor: `renderEditor`). Under a card, the line its last change left and, after «Удалить»,
 * the question whether to delete it. The list knows nothing of the API: the page acts on `onAction`, `onDelete`. Each
 * row carries its question's id (`data-item`): the page brings a saved card into view by it.
 */

export interface CardNote {
  text: string;
  error?: boolean;
  /** Shown, not said: the page's own status line says it already («Вопрос 5 добавлен.» — a new card's line would
      come in with its words, and a screen reader may miss a status region that arrives full). */
  quiet?: boolean;
}

interface Props {
  items: readonly TestItem[];
  /** The question whose request is on its way (or any other id while one is: then the actions wait). */
  busy: string | null;
  notes: Readonly<Record<string, CardNote | undefined>>;
  /** The question that asks whether to delete it. */
  askDelete: string | null;
  /** The exam has members: their answers to a deleted question go too. */
  group: boolean;
  /** The question open in the editor. */
  editing: string | null;
  renderEditor: (item: TestItem, number: number) => ReactNode;
  onAction: (item: TestItem, action: CardAction) => void;
  onDelete: (item: TestItem) => void;
  onKeep: (item: TestItem) => void;
}

export default function QuestionList({ items, busy, notes, askDelete, group, editing, renderEditor, onAction, onDelete, onKeep }: Props) {
  if (items.length === 0) return null;
  return (
    <ol className="tb-list" aria-label={BUILD.list}>
      {items.map((item, index) => {
        if (editing === item.id) {
          return (
            <li key={item.id} data-item={item.id}>
              <div className="tb-edit" data-editing={item.id}>
                {renderEditor(item, index + 1)}
              </div>
            </li>
          );
        }
        const note = notes[item.id];
        const asking = askDelete === item.id;
        return (
          <li key={item.id} data-item={item.id}>
            <BuildCard
              item={item}
              number={index + 1}
              first={index === 0}
              last={index === items.length - 1}
              busy={busy === item.id}
              locked={busy !== null}
              showActions={!asking}
              onAction={(action) => onAction(item, action)}
            >
              {note ? (
                <p className="tb-note" role={note.error ? 'alert' : note.quiet ? undefined : 'status'}>
                  {note.text}
                </p>
              ) : null}
              {asking ? (
                <div className="tb-note tb-confirm">
                  <p>{nb(BUILD.removeAsk(index + 1, group))}</p>
                  <p className="tb-confirm-acts">
                    <button type="button" className="sf-link" disabled={busy === item.id} onClick={() => onDelete(item)}>
                      {KEYS.removeYes}
                    </button>
                    <button type="button" className="sf-link" data-muted="" data-confirm-no={item.id} onClick={() => onKeep(item)}>
                      {KEYS.removeNo}
                    </button>
                  </p>
                </div>
              ) : null}
            </BuildCard>
          </li>
        );
      })}
    </ol>
  );
}
