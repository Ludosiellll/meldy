import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { letter, nb, QUEUE } from '../copyImport';
import { leadingSpaces, stemParts } from '../stemCode';
import './keys.css';

/**
 * One question the author looks at (Concept 1 §3.2 «Проверить», §3.11 «Ключи»): where it is in the file, what is
 * wrong, the question and its options in the FILE's order and letters (the author edits the file, not studies it).
 * A tap on an option is the answer to the line above it: the right one (a key), or the one to take out (an empty or
 * repeated option). Several right options are ticked, then saved. The current key is marked with a word, not only a
 * colour (spec decision 54). Shared by the import page and «Ключи».
 */

export type TapMode = 'key' | 'keys' | 'drop' | 'none';

export interface KeyAction {
  key: string;
  label: string;
  onClick: () => void;
  /** A detail rather than a step: a grey link. */
  muted?: boolean;
}

interface Props {
  context: string;
  reason?: ReactNode;
  stem: string;
  code?: boolean;
  options: string[];
  kind: 'single' | 'multiple' | 'short';
  answers?: string[];
  /** The key now (file indices): «Ключ» beside each. */
  current?: number[];
  /** Options the file marked (two marked where one is expected). */
  marked?: number[];
  /** Options already taken out (struck through, not tappable). */
  dropped?: number[];
  tapMode: TapMode;
  instruction?: string | null;
  onTap?: (index: number) => void;
  onSaveKeys?: (indices: number[]) => void;
  onSaveForms?: (forms: string[]) => void;
  actions?: KeyAction[];
  busy?: boolean;
  /** Under the question: a line after a change, a doubt's notes. */
  children?: ReactNode;
  headingId?: string;
}

/**
 * The question's own lines: the words, then the code as typed, each line wrapping under its own indentation (as in a
 * «занятие», stemCode.ts: lines that clearly read as code are code even without the import's flag).
 */
function Stem({ text, code }: { text: string; code: boolean }) {
  const parts = stemParts(text, code);
  if (!parts.code) return <p className="kq-stem">{text}</p>;
  return (
    <div className="kq-stem">
      {parts.before ? <p className="kq-stem-lead">{parts.before}</p> : null}
      <div className="kq-code" role="group" aria-label={QUEUE.code}>
        {parts.code.replace(/\t/g, '    ').split('\n').map((line, index) => (
          <span key={index} className="kq-code-line" style={{ '--kq-ind': leadingSpaces(line) } as CSSProperties}>
            {line || '\u00a0'}
          </span>
        ))}
      </div>
      {parts.after ? <p className="kq-stem-lead">{parts.after}</p> : null}
    </div>
  );
}

export default function KeyQuestion({
  context,
  reason,
  stem,
  code = false,
  options,
  kind,
  answers = [],
  current = [],
  marked = [],
  dropped = [],
  tapMode,
  instruction,
  onTap,
  onSaveKeys,
  onSaveForms,
  actions = [],
  busy = false,
  children,
  headingId,
}: Props) {
  const fallbackId = useId();
  const contextId = headingId ?? fallbackId;
  const [ticked, setTicked] = useState<number[]>(current);
  const [forms, setForms] = useState(answers.join('; '));
  const currentKey = current.join(',');
  const answersKey = answers.join('\u0000');
  // Another question (or a saved key) starts from its own key.
  useEffect(() => setTicked(current), [currentKey, stem]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setForms(answers.join('; ')), [answersKey, stem]); // eslint-disable-line react-hooks/exhaustive-deps

  const droppedSet = new Set(dropped);
  const tappable = tapMode !== 'none' && !busy;

  return (
    <article className="kq" aria-labelledby={contextId} aria-busy={busy || undefined}>
      <p id={contextId} className="kq-context">
        {nb(context)}
      </p>
      {reason ? <div className="kq-reason">{reason}</div> : null}
      <Stem text={stem} code={code} />

      {kind === 'short' ? (
        <div className="kq-short">
          <label className="kq-label" htmlFor={`${contextId}-forms`}>
            {QUEUE.shortForms}
          </label>
          <input
            id={`${contextId}-forms`}
            className="kq-input"
            value={forms}
            disabled={busy}
            onChange={(event) => setForms(event.target.value)}
          />
          {onSaveForms ? (
            <button
              type="button"
              className="kq-save"
              disabled={busy || forms.trim() === answers.join('; ')}
              onClick={() =>
                onSaveForms(
                  forms
                    .split(';')
                    .map((form) => form.trim())
                    .filter(Boolean),
                )
              }
            >
              {QUEUE.saveForms}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {instruction ? <p className="kq-instruction">{instruction}</p> : null}
          <ol className="kq-options" data-mode={tapMode}>
            {options.map((option, index) => {
              const isDropped = droppedSet.has(index);
              const isKey = tapMode === 'keys' ? ticked.includes(index) : current.includes(index);
              const isMarked = marked.includes(index) && !isKey;
              const label = option.trim() === '' ? QUEUE.emptyText : option;
              const words = isDropped ? QUEUE.tagDropped : isKey ? QUEUE.tagKey : isMarked ? QUEUE.tagMarked : null;
              return (
                <li key={index}>
                  <button
                    type="button"
                    className="kq-option"
                    data-key={isKey ? '' : undefined}
                    data-marked={isMarked ? '' : undefined}
                    data-dropped={isDropped ? '' : undefined}
                    data-code={code ? '' : undefined}
                    disabled={!tappable || isDropped}
                    aria-pressed={tapMode === 'keys' ? isKey : undefined}
                    onClick={() => {
                      if (tapMode === 'keys') {
                        setTicked((list) => (list.includes(index) ? list.filter((value) => value !== index) : [...list, index].sort((a, b) => a - b)));
                        return;
                      }
                      onTap?.(index);
                    }}
                  >
                    <span className="kq-letter" aria-hidden="true">
                      {tapMode === 'keys' ? <span className="kq-box" data-on={isKey ? '' : undefined} /> : letter(index)}
                    </span>
                    <span className="kq-text">
                      <span className="kq-sr">{`${letter(index)}. `}</span>
                      {label}
                    </span>
                    {words ? <span className="kq-tag">{words}</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
          {tapMode === 'keys' && onSaveKeys ? (
            <button
              type="button"
              className="kq-save"
              disabled={busy || ticked.length === 0 || ticked.join(',') === currentKey}
              onClick={() => onSaveKeys(ticked)}
            >
              {QUEUE.saveKeys}
            </button>
          ) : null}
        </>
      )}

      {children}

      {actions.length > 0 ? (
        <p className="kq-actions">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="sf-link"
              data-muted={action.muted ? '' : undefined}
              disabled={busy}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </p>
      ) : null}
    </article>
  );
}

/** «Проверить · 1 из 11 … Готово»: the line over a queue of questions. */
export function QueueBar({ title, at, of, onDone, doneLabel = QUEUE.done }: { title: string; at: number; of: number; onDone: () => void; doneLabel?: string }) {
  return (
    <div className="kq-bar">
      <p className="kq-bar-title">
        {title}
        {of > 0 ? <span className="kq-bar-at">{` · ${QUEUE.position(at, of)}`}</span> : null}
      </p>
      <button type="button" className="sf-link kq-bar-done" onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}
