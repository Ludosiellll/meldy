import { Fragment, useEffect, useRef, useState } from 'react';
import {
  FLAG_NOTES,
  editRow,
  insertQuestion,
  mergeWithNext,
  questionCount,
  removeRow,
  rowIndexOfQuestion,
  rowProblem,
  splitRow,
  toggleSection,
  type PreviewRow,
  type PreviewState,
  type SkippedLine,
} from './previewModel';

interface QuestionPreviewProps {
  state: PreviewState;
  onChange: (next: PreviewState) => void;
  /** Lines the parser dropped, shown at their place with «Это вопрос». */
  skipped: SkippedLine[];
  onSkippedHandled: (key: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  disabled?: boolean;
}

/** The number the department gave a question, else its place in the list. */
function displayNumber(row: PreviewRow, ordinal: number): string {
  const label = row.label.trim().replace(/[.)]\s*$/, '');
  return label || String(ordinal);
}

function RowEditor({
  row,
  hasNext,
  onText,
  onMerge,
  onSplit,
  onToggleKind,
  onRemove,
  onDone,
}: {
  row: PreviewRow;
  hasNext: boolean;
  onText: (text: string) => void;
  onMerge: () => void;
  onSplit: (caret: number | undefined) => void;
  onToggleKind: () => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  const label = row.kind === 'section' ? 'Заголовок раздела' : 'Текст вопроса';
  return (
    <div className="nx-edit">
      <textarea
        ref={ref}
        aria-label={label}
        value={row.text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
            event.preventDefault();
            onDone();
          }
        }}
      />
      <div className="nx-edit-acts">
        {row.kind === 'question' && hasNext && (
          <button type="button" className="sf-link" onClick={onMerge}>
            Склеить со следующей
          </button>
        )}
        {row.kind === 'question' && (
          <button
            type="button"
            className="sf-link"
            onClick={() => {
              const caret = ref.current?.selectionStart;
              onSplit(caret && caret > 0 && caret < row.text.length ? caret : undefined);
            }}
          >
            Разбить
          </button>
        )}
        <button type="button" className="sf-link" onClick={onToggleKind}>
          {row.kind === 'question' ? 'Это заголовок раздела' : 'Это вопрос'}
        </button>
        <button type="button" className="sf-link" onClick={onRemove}>
          Удалить
        </button>
        <button type="button" className="sf-link" data-muted="" onClick={onDone}>
          Готово
        </button>
      </div>
    </div>
  );
}

/**
 * The recognised list on paper, numbered as the department numbered it. A line is edited by a
 * click: fix the text, merge it with the next line, split it, delete it or turn it into a section
 * heading. Parser warnings stand next to their line as pencil-blue notes.
 */
export default function QuestionPreview({
  state,
  onChange,
  skipped,
  onSkippedHandled,
  collapsed,
  onToggleCollapsed,
  disabled = false,
}: QuestionPreviewProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const total = questionCount(state);
  const skippedBefore = new Map<number, SkippedLine[]>();
  for (const line of skipped) skippedBefore.set(line.beforeQuestion, [...(skippedBefore.get(line.beforeQuestion) ?? []), line]);

  const open = (key: string) => {
    if (disabled) return;
    if (collapsed) onToggleCollapsed();
    setEditing(key);
  };

  let ordinal = 0;
  let questionIndex = 0;
  const shown = new Set<number>();
  const notesAt = (index: number) => {
    if (shown.has(index)) return [];
    shown.add(index);
    return (skippedBefore.get(index) ?? []).map((line) => (
      <li key={line.key} className="nx-skip sf-pnote">
        Строка без номера пропущена: «{line.text}».
        <button
          type="button"
          className="sf-link"
          disabled={disabled}
          onClick={() => {
            onChange(insertQuestion(state, rowIndexOfQuestion(state, index), line.text));
            onSkippedHandled(line.key);
          }}
        >
          Это вопрос
        </button>
      </li>
    ));
  };

  return (
    <>
      <div className="sf-sheet nx-paste" data-collapsed={collapsed && total > 8 && !editing ? '' : undefined}>
        <ol className="nx-list" aria-label="Распознанные вопросы">
          {state.rows.map((row, index) => {
            const next = state.rows[index + 1];
            const isQuestion = row.kind === 'question';
            // A line dropped before a section heading stands before that heading.
            const before = notesAt(questionIndex);
            if (isQuestion) {
              ordinal += 1;
              questionIndex += 1;
            }
            const number = isQuestion ? displayNumber(row, ordinal) : '';
            const problem = rowProblem(row);
            const flags = row.flags.filter((flag) => FLAG_NOTES[flag]);
            const editor =
              editing === row.key ? (
                <RowEditor
                  row={row}
                  hasNext={Boolean(next && next.kind === 'question')}
                  onText={(text) => onChange(editRow(state, row.key, text))}
                  onMerge={() => onChange(mergeWithNext(state, row.key))}
                  onSplit={(caret) => onChange(splitRow(state, row.key, caret))}
                  onToggleKind={() => onChange(toggleSection(state, row.key))}
                  onRemove={() => {
                    onChange(removeRow(state, row.key));
                    setEditing(null);
                  }}
                  onDone={() => setEditing(null)}
                />
              ) : null;
            return (
              <Fragment key={row.key}>
                {before}
                {isQuestion ? (
                  <li className="nx-q">
                    <span className="nx-n">{number}</span>
                    <div>
                      {editor ?? (
                        <button type="button" className="nx-t" onClick={() => open(row.key)} disabled={disabled} aria-label={`Изменить вопрос ${number}: ${row.text}`}>
                          {row.text || 'Пустая строка'}
                        </button>
                      )}
                      {!editor &&
                        flags.map((flag) => (
                          <span key={flag} className="nx-warn sf-pnote">
                            {FLAG_NOTES[flag]}
                            {flag === 'long' && (
                              <button type="button" className="sf-link" disabled={disabled} onClick={() => onChange(splitRow(state, row.key))}>
                                Разделить
                              </button>
                            )}
                            {flag === 'short' && (
                              <button type="button" className="sf-link" disabled={disabled} onClick={() => onChange(toggleSection(state, row.key))}>
                                Это заголовок
                              </button>
                            )}
                          </span>
                        ))}
                      {problem && <span className="nx-problem">{problem}</span>}
                    </div>
                  </li>
                ) : (
                  <li className="nx-sec">
                    {editor ?? (
                      <button type="button" className="nx-t" onClick={() => open(row.key)} disabled={disabled} aria-label={`Изменить заголовок раздела: ${row.text}`}>
                        {row.text || 'Пустой заголовок'}
                      </button>
                    )}
                    {problem && !editor && <span className="nx-problem">{problem}</span>}
                  </li>
                )}
              </Fragment>
            );
          })}
          {notesAt(questionIndex)}
        </ol>
      </div>
      {total > 8 && !editing && (
        <div className="nx-acts">
          <button type="button" className="sf-link" onClick={onToggleCollapsed}>
            {collapsed ? `Показать все ${total}` : 'Свернуть список'}
          </button>
        </div>
      )}
    </>
  );
}
